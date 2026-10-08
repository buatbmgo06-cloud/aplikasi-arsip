'use strict';

const path = require('path');
const fs = require('fs');
const fsPromises = require('fs/promises');
const { execFile } = require('child_process');
const { getDb } = require('../config/database');
const { formatFileSize } = require('../utils/formatUtils');

const ARCHIVE_DIR = process.env.ARCHIVE_DIR_PATH
  ? path.resolve(process.env.ARCHIVE_DIR_PATH)
  : null;

// ─── Helper: Validasi path agar tidak keluar dari ARCHIVE_DIR ────────────────
function validatePath(requestedPath) {
  if (!ARCHIVE_DIR) throw new Error('ARCHIVE_DIR_PATH belum dikonfigurasi');
  const resolved = path.resolve(ARCHIVE_DIR, requestedPath || '');
  // Security: pastikan path ada di dalam ARCHIVE_DIR
  if (!resolved.startsWith(ARCHIVE_DIR + path.sep) && resolved !== ARCHIVE_DIR) {
    throw new Error('FORBIDDEN: Akses keluar dari direktori arsip tidak diizinkan');
  }
  return resolved;
}

/**
 * GET /api/files/browse?path=subfolder
 * Menampilkan isi folder beserta subfolder di dalamnya
 */
function browseFolder(req, res) {
  const db = getDb();
  const requestedRelPath = (req.query.path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

  // Validasi security
  try {
    validatePath(requestedRelPath);
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }

  // Ambil subfolder di level ini
  const folders = db.prepare(`
    SELECT id, folder_name, relative_path, parent_path, updated_at
    FROM folders
    WHERE parent_path = ? AND is_deleted = 0
    ORDER BY folder_name COLLATE NOCASE ASC
  `).all(requestedRelPath);

  // Ambil file di level ini
  const files = db.prepare(`
    SELECT id, filename, relative_path, parent_path, file_size, extension, mime_type, updated_at, indexed_at
    FROM files
    WHERE parent_path = ? AND is_deleted = 0
    ORDER BY filename COLLATE NOCASE ASC
  `).all(requestedRelPath);

  // Bangun breadcrumb dari path
  const breadcrumb = buildBreadcrumb(requestedRelPath);

  return res.json({
    current_path: requestedRelPath,
    breadcrumb,
    folders: folders.map(f => ({ ...f, type: 'folder' })),
    files: files.map(f => ({
      ...f,
      type: 'file',
      file_size_formatted: formatFileSize(f.file_size),
    })),
    total_folders: folders.length,
    total_files: files.length,
  });
}

/**
 * Membangun array breadcrumb dari relative path
 * Input: "dokumen/2024/laporan"
 * Output: [{name:"Home", path:""}, {name:"dokumen", path:"dokumen"}, ...]
 */
function buildBreadcrumb(relativePath) {
  const crumbs = [{ name: 'Home', path: '' }];
  if (!relativePath) return crumbs;

  const parts = relativePath.split('/').filter(Boolean);
  let accumulated = '';
  for (const part of parts) {
    accumulated = accumulated ? `${accumulated}/${part}` : part;
    crumbs.push({ name: part, path: accumulated });
  }
  return crumbs;
}

/**
 * GET /api/files/download/:id
 * Download file secara aman dengan validasi path
 */
function downloadFile(req, res) {
  const db = getDb();
  const fileId = parseInt(req.params.id, 10);

  if (isNaN(fileId)) {
    return res.status(400).json({ error: 'ID file tidak valid' });
  }

  const file = db.prepare(`
    SELECT * FROM files WHERE id = ? AND is_deleted = 0
  `).get(fileId);

  if (!file) {
    return res.status(404).json({ error: 'File tidak ditemukan' });
  }

  // Validasi path sekali lagi (defense in depth)
  const resolvedPath = path.resolve(file.absolute_path);
  if (!resolvedPath.startsWith(ARCHIVE_DIR + path.sep)) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  // Cek file fisik masih ada
  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'File fisik tidak ditemukan di disk' });
  }

  // Set header Content-Disposition untuk force download
  // Gunakan ukuran aktual dari stat agar Content-Length tidak stale (Bug #4)
  const actualStat = fs.statSync(resolvedPath);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
  res.setHeader('Content-Length', actualStat.size);

  const stream = fs.createReadStream(resolvedPath);
  stream.on('error', (err) => {
    console.error('[Download] Stream error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Gagal membaca file' });
  });
  stream.pipe(res);
}

/**
 * GET /api/files/preview/:id
 * Preview/streaming file (PDF, gambar, video, audio)
 * Menggunakan Range request support untuk video/audio
 */
function previewFile(req, res) {
  const db = getDb();
  const fileId = parseInt(req.params.id, 10);

  if (isNaN(fileId)) {
    return res.status(400).json({ error: 'ID file tidak valid' });
  }

  const file = db.prepare(`
    SELECT * FROM files WHERE id = ? AND is_deleted = 0
  `).get(fileId);

  if (!file) {
    return res.status(404).json({ error: 'File tidak ditemukan' });
  }

  const resolvedPath = path.resolve(file.absolute_path);
  if (!resolvedPath.startsWith(ARCHIVE_DIR + path.sep)) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'File fisik tidak ditemukan' });
  }

  const stat = fs.statSync(resolvedPath);
  const fileSize = stat.size;
  const contentType = file.mime_type || 'application/octet-stream';

  // Support Range requests (untuk streaming video/audio)
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });

    fs.createReadStream(resolvedPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `inline; filename="${encodeURIComponent(file.filename)}"`,
    });
    const stream = fs.createReadStream(resolvedPath);
    stream.on('error', (err) => {
      console.error('[Preview] Stream error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Gagal membaca file' });
    });
    stream.pipe(res);
  }
}

/**
 * GET /api/stats
 * Statistik keseluruhan arsip
 */
function getStats(req, res) {
  const db = getDb();

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_files,
      SUM(file_size) as total_size,
      COUNT(DISTINCT parent_path) as total_folders_with_files,
      COUNT(DISTINCT extension) as total_extensions,
      MAX(indexed_at) as last_indexed
    FROM files
    WHERE is_deleted = 0
  `).get();

  const folderCount = db.prepare(`
    SELECT COUNT(*) as count FROM folders WHERE is_deleted = 0
  `).get();

  // Top 5 ekstensi terbanyak
  const topExtensions = db.prepare(`
    SELECT extension, COUNT(*) as count, SUM(file_size) as total_size
    FROM files
    WHERE is_deleted = 0 AND extension != ''
    GROUP BY extension
    ORDER BY count DESC
    LIMIT 5
  `).all();

  return res.json({
    total_files: stats.total_files || 0,
    total_size: stats.total_size || 0,
    total_size_formatted: formatFileSize(stats.total_size || 0),
    total_folders: folderCount.count || 0,
    total_extensions: stats.total_extensions || 0,
    last_indexed: stats.last_indexed,
    top_extensions: topExtensions.map(e => ({
      ...e,
      total_size_formatted: formatFileSize(e.total_size || 0),
    })),
  });
}

/**
 * GET /api/recent?limit=20
 * File terbaru yang ditambahkan/diubah
 */
function getRecentFiles(req, res) {
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

  const files = db.prepare(`
    SELECT id, filename, relative_path, parent_path, file_size, extension, mime_type, updated_at, indexed_at
    FROM files
    WHERE is_deleted = 0
    ORDER BY indexed_at DESC
    LIMIT ?
  `).all(limit);

  return res.json({
    files: files.map(f => ({
      ...f,
      type: 'file',
      file_size_formatted: formatFileSize(f.file_size),
    })),
  });
}

/**
 * GET /api/folder-tree
 * Struktur folder tree untuk sidebar navigasi
 */
function getFolderTree(req, res) {
  const db = getDb();

  const folders = db.prepare(`
    SELECT folder_name, relative_path, parent_path
    FROM folders
    WHERE is_deleted = 0
    ORDER BY relative_path COLLATE NOCASE ASC
  `).all();

  // Bangun tree structure
  const tree = buildTree(folders);
  return res.json({ tree });
}

function buildTree(folders) {
  const nodeMap = {};
  const roots = [];

  for (const folder of folders) {
    nodeMap[folder.relative_path] = {
      name: folder.folder_name,
      path: folder.relative_path,
      children: [],
    };
  }

  for (const folder of folders) {
    const node = nodeMap[folder.relative_path];
    if (folder.parent_path === '' || !nodeMap[folder.parent_path]) {
      roots.push(node);
    } else {
      nodeMap[folder.parent_path].children.push(node);
    }
  }

  return roots;
}

/**
 * GET /api/scan/recent?limit=30
 * File hasil scan terbaru (yang memiliki tag 'scan')
 */
function getScannedFiles(req, res) {
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 200);

  const files = db.prepare(`
    SELECT id, filename, relative_path, parent_path, file_size, extension,
           mime_type, tags, updated_at, indexed_at
    FROM files
    WHERE tags LIKE '%scan%' AND is_deleted = 0
    ORDER BY indexed_at DESC
    LIMIT ?
  `).all(limit);

  // Statistik scan hari ini
  const todayCount = db.prepare(`
    SELECT COUNT(*) as count, SUM(file_size) as total_size
    FROM files
    WHERE tags LIKE '%scan%'
      AND is_deleted = 0
      AND date(indexed_at) = date('now', 'localtime')
  `).get();

  return res.json({
    files: files.map(f => ({
      ...f,
      type: 'file',
      file_size_formatted: formatFileSize(f.file_size),
      tag_list: f.tags ? f.tags.split(',').map(t => t.trim()) : [],
    })),
    total: files.length,
    today: {
      date: new Date().toISOString().slice(0, 10),
      count: todayCount.count || 0,
      total_size_formatted: formatFileSize(todayCount.total_size || 0),
    },
  });
}

/**
 * DELETE /api/files/:id
 * Menghapus file secara permanen (fisik + soft-delete di database)
 */
async function deleteFile(req, res) {
  const db = getDb();
  const fileId = parseInt(req.params.id, 10);

  if (isNaN(fileId)) {
    return res.status(400).json({ error: 'ID file tidak valid' });
  }

  const file = db.prepare(`
    SELECT * FROM files WHERE id = ? AND is_deleted = 0
  `).get(fileId);

  if (!file) {
    return res.status(404).json({ error: 'File tidak ditemukan' });
  }

  // Validasi path (defense in depth)
  const resolvedPath = path.resolve(file.absolute_path);
  if (!resolvedPath.startsWith(ARCHIVE_DIR + path.sep) && resolvedPath !== ARCHIVE_DIR) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  // Hapus file fisik dari disk
  try {
    if (fs.existsSync(resolvedPath)) {
      await fsPromises.unlink(resolvedPath);
    }
  } catch (err) {
    console.error('[Delete] Gagal menghapus file fisik:', err);
    return res.status(500).json({ error: 'Gagal menghapus file dari disk: ' + err.message });
  }

  // Soft-delete di database
  db.prepare(`
    UPDATE files SET is_deleted = 1, updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(fileId);

  console.log(`[Delete] File dihapus: ${file.relative_path}`);
  return res.json({
    success: true,
    message: `File "${file.filename}" berhasil dihapus`,
    deleted: { id: file.id, filename: file.filename, relative_path: file.relative_path },
  });
}

/**
 * DELETE /api/folders/:id
 * Menghapus folder beserta isinya secara permanen (fisik + soft-delete di database)
 */
async function deleteFolder(req, res) {
  const db = getDb();
  const folderId = parseInt(req.params.id, 10);

  if (isNaN(folderId)) {
    return res.status(400).json({ error: 'ID folder tidak valid' });
  }

  const folder = db.prepare(`
    SELECT * FROM folders WHERE id = ? AND is_deleted = 0
  `).get(folderId);

  if (!folder) {
    return res.status(404).json({ error: 'Folder tidak ditemukan' });
  }

  // Validasi path (defense in depth)
  const resolvedPath = path.resolve(folder.absolute_path);
  if (!resolvedPath.startsWith(ARCHIVE_DIR + path.sep) && resolvedPath !== ARCHIVE_DIR) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  // Hitung jumlah item yang akan dihapus untuk informasi user
  const childFiles = db.prepare(`
    SELECT COUNT(*) as count FROM files
    WHERE (parent_path = ? OR parent_path LIKE ?) AND is_deleted = 0
  `).get(folder.relative_path, folder.relative_path + '/%');

  const childFolders = db.prepare(`
    SELECT COUNT(*) as count FROM folders
    WHERE (parent_path = ? OR parent_path LIKE ? OR relative_path = ?) AND is_deleted = 0
  `).get(folder.relative_path, folder.relative_path + '/%', folder.relative_path);

  // Hapus folder fisik dari disk (rekursif)
  try {
    if (fs.existsSync(resolvedPath)) {
      await fsPromises.rm(resolvedPath, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('[Delete] Gagal menghapus folder fisik:', err);
    return res.status(500).json({ error: 'Gagal menghapus folder dari disk: ' + err.message });
  }

  // Soft-delete di database: folder itu sendiri + semua subfolder + semua file di dalamnya
  const softDeleteAll = db.transaction(() => {
    // Soft-delete folder ini
    db.prepare(`
      UPDATE folders SET is_deleted = 1, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(folderId);

    // Soft-delete subfolder yang ada di dalamnya
    db.prepare(`
      UPDATE folders SET is_deleted = 1, updated_at = datetime('now','localtime')
      WHERE (parent_path = ? OR parent_path LIKE ?) AND is_deleted = 0
    `).run(folder.relative_path, folder.relative_path + '/%');

    // Soft-delete semua file di dalamnya
    db.prepare(`
      UPDATE files SET is_deleted = 1, updated_at = datetime('now','localtime')
      WHERE (parent_path = ? OR parent_path LIKE ?) AND is_deleted = 0
    `).run(folder.relative_path, folder.relative_path + '/%');
  });

  softDeleteAll();

  console.log(`[Delete] Folder dihapus: ${folder.relative_path} (${childFiles.count} file, ${childFolders.count} folder)`);
  return res.json({
    success: true,
    message: `Folder "${folder.folder_name}" berhasil dihapus`,
    deleted: {
      id: folder.id,
      folder_name: folder.folder_name,
      relative_path: folder.relative_path,
      files_deleted: childFiles.count,
      folders_deleted: childFolders.count,
    },
  });
}

/**
 * POST /api/files/open/:id
 * Membuka file dengan aplikasi default sistem (Windows)
 */
function openFileExternal(req, res) {
  const db = getDb();
  const fileId = parseInt(req.params.id, 10);

  if (isNaN(fileId)) {
    return res.status(400).json({ error: 'ID file tidak valid' });
  }

  const file = db.prepare(`
    SELECT * FROM files WHERE id = ? AND is_deleted = 0
  `).get(fileId);

  if (!file) {
    return res.status(404).json({ error: 'File tidak ditemukan' });
  }

  const resolvedPath = path.resolve(file.absolute_path);
  if (!resolvedPath.startsWith(ARCHIVE_DIR + path.sep) && resolvedPath !== ARCHIVE_DIR) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'File fisik tidak ditemukan' });
  }

  // Gunakan execFile (bukan exec) untuk menghindari command injection
  // 'start' adalah perintah internal cmd.exe, jadi harus via cmd /c
  execFile('cmd.exe', ['/c', 'start', '', resolvedPath], { windowsHide: true }, (err) => {
    if (err) {
      console.error('[Open] Gagal membuka file:', err);
      return res.status(500).json({ error: 'Gagal membuka file: ' + err.message });
    }
    console.log(`[Open] File dibuka: ${file.relative_path}`);
    return res.json({ success: true, message: `File "${file.filename}" dibuka` });
  });
}

/**
 * POST /api/files/openwith/:id
 * Membuka dialog "Open With" Windows agar user bisa memilih aplikasi
 */
function openFileWithDialog(req, res) {
  const db = getDb();
  const fileId = parseInt(req.params.id, 10);

  if (isNaN(fileId)) {
    return res.status(400).json({ error: 'ID file tidak valid' });
  }

  const file = db.prepare(`
    SELECT * FROM files WHERE id = ? AND is_deleted = 0
  `).get(fileId);

  if (!file) {
    return res.status(404).json({ error: 'File tidak ditemukan' });
  }

  const resolvedPath = path.resolve(file.absolute_path);
  if (!resolvedPath.startsWith(ARCHIVE_DIR + path.sep) && resolvedPath !== ARCHIVE_DIR) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'File fisik tidak ditemukan' });
  }

  // Membuka dialog "Open With" Windows via rundll32
  execFile(
    'rundll32.exe',
    ['shell32.dll,OpenAs_RunDLL', resolvedPath],
    { windowsHide: false },
    (err) => {
      if (err) {
        console.error('[OpenWith] Gagal membuka dialog:', err);
        return res.status(500).json({ error: 'Gagal membuka dialog: ' + err.message });
      }
    }
  );

  // Langsung respon ke client (tidak perlu tunggu dialog ditutup user)
  console.log(`[OpenWith] Dialog dibuka untuk: ${file.relative_path}`);
  return res.json({ success: true, message: `Dialog "Buka Dengan" dibuka untuk "${file.filename}"` });
}

/**
 * POST /api/files/openwithapp/:id
 * Membuka file dengan aplikasi spesifik (misal: notepad, wordpad)
 * Query param: ?app=notepad | ?app=wordpad | ?app=mspaint | dll.
 */
function openFileWithApp(req, res) {
  const db = getDb();
  const fileId = parseInt(req.params.id, 10);

  if (isNaN(fileId)) {
    return res.status(400).json({ error: 'ID file tidak valid' });
  }

  // Daftar aplikasi yang diizinkan (whitelist keamanan)
  const ALLOWED_APPS = {
    notepad:  'notepad.exe',
    wordpad:  'write.exe',
    mspaint:  'mspaint.exe',
    explorer: 'explorer.exe',
    photos:   'ms-photos:',   // Windows Photos (via URI)
  };

  const appKey = (req.query.app || '').toLowerCase().trim();
  if (!appKey || !ALLOWED_APPS[appKey]) {
    return res.status(400).json({
      error: 'Aplikasi tidak valid',
      allowed: Object.keys(ALLOWED_APPS),
    });
  }

  const file = db.prepare(`
    SELECT * FROM files WHERE id = ? AND is_deleted = 0
  `).get(fileId);

  if (!file) {
    return res.status(404).json({ error: 'File tidak ditemukan' });
  }

  const resolvedPath = path.resolve(file.absolute_path);
  if (!resolvedPath.startsWith(ARCHIVE_DIR + path.sep) && resolvedPath !== ARCHIVE_DIR) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'File fisik tidak ditemukan' });
  }

  const appExe = ALLOWED_APPS[appKey];

  // URI scheme (ms-photos:) — buka via start
  if (appExe.startsWith('ms-')) {
    execFile('cmd.exe', ['/c', 'start', '', appExe + 'fileactivation?filePath=' + encodeURIComponent(resolvedPath)],
      { windowsHide: true }, () => {});
  } else {
    execFile(appExe, [resolvedPath], { windowsHide: false }, (err) => {
      if (err) {
        console.error(`[OpenWithApp] Gagal membuka dengan ${appExe}:`, err);
      }
    });
  }

  console.log(`[OpenWithApp] "${file.filename}" dibuka dengan ${appExe}`);
  return res.json({ success: true, message: `File dibuka dengan ${appKey}` });
}

/**
 * POST /api/folders/open/:id
 * Membuka folder di Windows Explorer
 */
function openFolderInExplorer(req, res) {
  const db = getDb();
  const folderId = parseInt(req.params.id, 10);

  if (isNaN(folderId)) {
    return res.status(400).json({ error: 'ID folder tidak valid' });
  }

  const folder = db.prepare(`
    SELECT * FROM folders WHERE id = ? AND is_deleted = 0
  `).get(folderId);

  if (!folder) {
    return res.status(404).json({ error: 'Folder tidak ditemukan' });
  }

  const resolvedPath = path.resolve(folder.absolute_path);
  if (!resolvedPath.startsWith(ARCHIVE_DIR + path.sep) && resolvedPath !== ARCHIVE_DIR) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'Folder tidak ditemukan di disk' });
  }

  // Gunakan execFile untuk menghindari command injection (Bug #3)
  execFile('explorer.exe', [resolvedPath], { windowsHide: false }, (err) => {
    if (err) {
      // explorer.exe sering return exit code 1 meski sukses — abaikan
    }
    console.log(`[Open] Folder dibuka di Explorer: ${folder.relative_path}`);
    return res.json({ success: true, message: `Folder "${folder.folder_name}" dibuka di Explorer` });
  });
}

module.exports = {
  browseFolder,
  downloadFile,
  previewFile,
  getStats,
  getRecentFiles,
  getFolderTree,
  getScannedFiles,
  deleteFile,
  deleteFolder,
  openFileExternal,
  openFileWithDialog,
  openFileWithApp,
  openFolderInExplorer,
};
