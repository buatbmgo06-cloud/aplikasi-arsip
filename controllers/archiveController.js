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
    SELECT id, filename, relative_path, parent_path, file_size, extension, mime_type, tags, updated_at, indexed_at
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
    SELECT id, filename, relative_path, parent_path, file_size, extension, mime_type, tags, updated_at, indexed_at
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
 * Soft-delete: file ditandai is_deleted=1 dan dipindah ke Keranjang.
 * File fisik TIDAK dihapus — bisa dipulihkan lewat /api/trash/restore/:id.
 */
function deleteFile(req, res) {
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

  // Soft-delete: file fisik tetap ada di disk, bisa dipulihkan dari Keranjang
  db.prepare(`
    UPDATE files SET is_deleted = 1, updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(fileId);

  console.log(`[Delete] File dipindah ke Keranjang: ${file.relative_path}`);
  return res.json({
    success: true,
    message: `File "${file.filename}" dipindahkan ke Keranjang`,
    deleted: { id: file.id, filename: file.filename, relative_path: file.relative_path },
  });
}

/**
 * DELETE /api/folders/:id
 * Soft-delete: folder beserta isinya ditandai is_deleted=1 dan dipindah ke Keranjang.
 * Folder fisik TIDAK dihapus — bisa dipulihkan lewat /api/trash/restore-folder/:id.
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

  // Soft-delete di database: folder itu sendiri + semua subfolder + semua file di dalamnya.
  // Folder & file fisik tetap ada di disk, bisa dipulihkan dari Keranjang.
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

  console.log(`[Delete] Folder dipindah ke Keranjang: ${folder.relative_path} (${childFiles.count} file, ${childFolders.count} folder)`);
  return res.json({
    success: true,
    message: `Folder "${folder.folder_name}" beserta isinya dipindahkan ke Keranjang`,
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

// ─────────────────────────────────────────────────────────────────────────────
// RENAME
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validasi nama file/folder: tidak boleh kosong, path traversal, atau separator
 */
function validateNewName(name) {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new Error('Nama tidak boleh kosong');
  }
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error('Nama mengandung karakter tidak diizinkan (path traversal)');
  }
  return name.trim();
}

/**
 * PATCH /api/files/:id/rename  body: { newName }
 */
function renameFile(req, res) {
  const db = getDb();
  const fileId = parseInt(req.params.id, 10);

  if (isNaN(fileId)) {
    return res.status(400).json({ error: 'ID file tidak valid' });
  }

  let newName;
  try {
    newName = validateNewName(req.body.newName);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const file = db.prepare(`SELECT * FROM files WHERE id = ? AND is_deleted = 0`).get(fileId);
  if (!file) {
    return res.status(404).json({ error: 'File tidak ditemukan' });
  }

  const oldAbsolute = path.resolve(file.absolute_path);
  if (!fs.existsSync(oldAbsolute)) {
    return res.status(404).json({ error: 'File fisik tidak ditemukan di disk' });
  }

  // Bangun path baru
  const dir = path.dirname(oldAbsolute);
  const newAbsolute = path.join(dir, newName);

  // Pastikan masih di dalam ARCHIVE_DIR
  if (!newAbsolute.startsWith(ARCHIVE_DIR + path.sep) && newAbsolute !== ARCHIVE_DIR) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  // Rename fisik
  try {
    fs.renameSync(oldAbsolute, newAbsolute);
  } catch (err) {
    console.error('[Rename] Gagal rename file fisik:', err);
    return res.status(500).json({ error: 'Gagal rename file fisik: ' + err.message });
  }

  // Hitung relative_path & absolute_path baru
  const newRelative = path.posix.join(
    file.relative_path.substring(0, file.relative_path.lastIndexOf('/')),
    newName
  ).replace(/^\//, '');
  // Tangani kasus file di root (relative_path tidak mengandung '/')
  const oldRelDir = file.relative_path.includes('/')
    ? file.relative_path.substring(0, file.relative_path.lastIndexOf('/'))
    : '';
  const computedNewRelative = oldRelDir ? `${oldRelDir}/${newName}` : newName;

  // Update DB
  db.prepare(`
    UPDATE files
    SET filename = ?, relative_path = ?, absolute_path = ?,
        updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(newName, computedNewRelative, newAbsolute, fileId);

  console.log(`[Rename] File: "${file.filename}" → "${newName}"`);
  return res.json({ success: true, message: `File berhasil direname menjadi "${newName}"`, newName });
}

/**
 * PATCH /api/folders/:id/rename  body: { newName }
 */
function renameFolder(req, res) {
  const db = getDb();
  const folderId = parseInt(req.params.id, 10);

  if (isNaN(folderId)) {
    return res.status(400).json({ error: 'ID folder tidak valid' });
  }

  let newName;
  try {
    newName = validateNewName(req.body.newName);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const folder = db.prepare(`SELECT * FROM folders WHERE id = ? AND is_deleted = 0`).get(folderId);
  if (!folder) {
    return res.status(404).json({ error: 'Folder tidak ditemukan' });
  }

  const oldAbsolute = path.resolve(folder.absolute_path);
  if (!fs.existsSync(oldAbsolute)) {
    return res.status(404).json({ error: 'Folder fisik tidak ditemukan di disk' });
  }

  // Bangun path baru
  const parentDir = path.dirname(oldAbsolute);
  const newAbsolute = path.join(parentDir, newName);

  if (!newAbsolute.startsWith(ARCHIVE_DIR + path.sep) && newAbsolute !== ARCHIVE_DIR) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  // Rename fisik
  try {
    fs.renameSync(oldAbsolute, newAbsolute);
  } catch (err) {
    console.error('[Rename] Gagal rename folder fisik:', err);
    return res.status(500).json({ error: 'Gagal rename folder fisik: ' + err.message });
  }

  const oldRelative = folder.relative_path; // e.g. "parent/oldname"
  const parentRelative = folder.parent_path; // e.g. "parent"
  const newRelative = parentRelative ? `${parentRelative}/${newName}` : newName;

  // Update folder itu sendiri
  db.prepare(`
    UPDATE folders
    SET folder_name = ?, relative_path = ?, absolute_path = ?,
        updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(newName, newRelative, newAbsolute, folderId);

  // Update child folders — relative_path diawali oldRelative
  const childFolders = db.prepare(`
    SELECT id, relative_path, absolute_path
    FROM folders
    WHERE (relative_path = ? OR relative_path LIKE ?) AND is_deleted = 0 AND id != ?
  `).all(oldRelative, oldRelative + '/%', folderId);

  for (const cf of childFolders) {
    const updatedRel = newRelative + cf.relative_path.substring(oldRelative.length);
    const updatedAbs = path.join(ARCHIVE_DIR, updatedRel);
    db.prepare(`
      UPDATE folders SET relative_path = ?, absolute_path = ?,
      updated_at = datetime('now','localtime') WHERE id = ?
    `).run(updatedRel, updatedAbs, cf.id);
  }

  // Update child files
  const childFiles = db.prepare(`
    SELECT id, relative_path, parent_path, absolute_path
    FROM files
    WHERE (parent_path = ? OR parent_path LIKE ?) AND is_deleted = 0
  `).all(oldRelative, oldRelative + '/%');

  for (const cf of childFiles) {
    const updatedRel = newRelative + cf.relative_path.substring(oldRelative.length);
    const updatedParent = newRelative + cf.parent_path.substring(oldRelative.length);
    const updatedAbs = path.join(ARCHIVE_DIR, updatedRel);
    db.prepare(`
      UPDATE files SET relative_path = ?, parent_path = ?, absolute_path = ?,
      updated_at = datetime('now','localtime') WHERE id = ?
    `).run(updatedRel, updatedParent, updatedAbs, cf.id);
  }

  console.log(`[Rename] Folder: "${folder.folder_name}" → "${newName}" (${childFolders.length} subfolder, ${childFiles.length} file diperbarui)`);
  return res.json({ success: true, message: `Folder berhasil direname menjadi "${newName}"`, newName });
}

// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD (multer diskStorage)
// ─────────────────────────────────────────────────────────────────────────────

const multer = require('multer');
const mime  = require('mime-types');

/**
 * Multer storage dengan destination dinamis dari query ?path=
 * Validasi dilakukan SEBELUM storage init di uploadFiles handler.
 */
const multerStorage = multer.diskStorage({
  destination(req, _file, cb) {
    const targetPath = (req.query.path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    let destDir;
    try {
      destDir = validatePath(targetPath);
    } catch (err) {
      return cb(err);
    }
    // Buat dir kalau belum ada
    fs.mkdirSync(destDir, { recursive: true });
    cb(null, destDir);
  },
  filename(_req, file, cb) {
    // Gunakan nama asli (hindari overwrite dengan suffix timestamp jika sudah ada)
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, originalName);
  },
});

const multerUpload = multer({ storage: multerStorage });

/**
 * POST /api/files/upload?path=subfolder
 * multipart/form-data, field name: "files" (multiple)
 */
function uploadFiles(req, res) {
  const targetPath = (req.query.path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

  // Validasi target path terlebih dahulu
  let destDir;
  try {
    destDir = validatePath(targetPath);
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }

  multerUpload.array('files')(req, res, (err) => {
    if (err) {
      console.error('[Upload] Multer error:', err);
      return res.status(500).json({ error: 'Upload gagal: ' + err.message });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Tidak ada file yang diupload' });
    }

    const db = getDb();
    const uploaded = [];
    const replaced = [];

    for (const f of req.files) {
      const filename    = f.originalname ? Buffer.from(f.originalname, 'latin1').toString('utf8') : f.filename;
      const absPath     = f.path;
      const relPath     = path.relative(ARCHIVE_DIR, absPath).replace(/\\/g, '/');
      const parentPath  = targetPath;
      const fileSize    = f.size;
      const ext         = path.extname(filename).replace('.', '').toLowerCase();
      const mimeType    = mime.lookup(filename) || f.mimetype || 'application/octet-stream';

      try {
        // Cek apakah file dengan relative_path yang sama sudah ada:
        // multer menimpa file fisik, jadi DB harus ikut di-update (upsert),
        // bukan INSERT biasa yang gagal karena UNIQUE constraint.
        const existing = db.prepare('SELECT id FROM files WHERE relative_path = ?').get(relPath);

        db.prepare(`
          INSERT INTO files (filename, relative_path, absolute_path, parent_path, file_size, extension, mime_type, is_deleted, indexed_at)
          VALUES (@filename, @relative_path, @absolute_path, @parent_path, @file_size, @extension, @mime_type, 0, datetime('now','localtime'))
          ON CONFLICT(relative_path) DO UPDATE SET
            filename      = excluded.filename,
            absolute_path = excluded.absolute_path,
            parent_path   = excluded.parent_path,
            file_size     = excluded.file_size,
            extension     = excluded.extension,
            mime_type     = excluded.mime_type,
            is_deleted    = 0,
            updated_at    = datetime('now','localtime'),
            indexed_at    = datetime('now','localtime')
        `).run({
          filename,
          relative_path: relPath,
          absolute_path: absPath,
          parent_path: parentPath,
          file_size: fileSize,
          extension: ext,
          mime_type: mimeType,
        });

        // UPSERT (ON CONFLICT) tidak memicu trigger FTS — update manual seperti indexerService
        if (existing) {
          try {
            db.prepare(`
              INSERT INTO files_fts(files_fts, rowid, filename, relative_path, extension)
              VALUES ('delete', ?, ?, ?, ?)
            `).run(existing.id, filename, relPath, ext);
          } catch {
            // Rowid mungkin belum ada di FTS — abaikan, insert di bawah tetap jalan
          }
          db.prepare(`
            INSERT INTO files_fts(rowid, filename, relative_path, extension)
            VALUES (?, ?, ?, ?)
          `).run(existing.id, filename, relPath, ext);
        }

        const item = {
          id: existing ? existing.id : null,
          filename,
          relative_path: relPath,
          parent_path: parentPath,
          file_size: fileSize,
          extension: ext,
          mime_type: mimeType,
        };
        if (existing) {
          item.id = db.prepare('SELECT id FROM files WHERE relative_path = ?').get(relPath)?.id || existing.id;
          replaced.push(item);
        } else {
          item.id = item.id || db.prepare('SELECT id FROM files WHERE relative_path = ?').get(relPath)?.id;
          uploaded.push(item);
        }
      } catch (dbErr) {
        console.error('[Upload] DB upsert error:', dbErr);
        // Lanjutkan ke file berikutnya, error ditampilkan di log
      }
    }

    console.log(`[Upload] ${uploaded.length} file baru & ${replaced.length} ditimpa di "${targetPath || 'root'}"`);
    return res.json({ success: true, uploaded, replaced, count: uploaded.length + replaced.length });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK DELETE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DELETE /api/files/bulk  body: { ids: [1, 2, 3] }
 */
async function bulkDeleteFiles(req, res) {
  const db  = getDb();
  const ids = req.body.ids;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids harus berupa array yang tidak kosong' });
  }

  let deleted = 0;
  const errors = [];

  for (const rawId of ids) {
    const fileId = parseInt(rawId, 10);
    if (isNaN(fileId)) {
      errors.push({ id: rawId, error: 'ID tidak valid' });
      continue;
    }

    const file = db.prepare(`SELECT * FROM files WHERE id = ? AND is_deleted = 0`).get(fileId);
    if (!file) {
      errors.push({ id: fileId, error: 'File tidak ditemukan atau sudah dihapus' });
      continue;
    }

    const resolvedPath = path.resolve(file.absolute_path);
    if (!resolvedPath.startsWith(ARCHIVE_DIR + path.sep) && resolvedPath !== ARCHIVE_DIR) {
      errors.push({ id: fileId, filename: file.filename, error: 'Akses ditolak' });
      continue;
    }

    // Soft-delete: file fisik tetap ada di disk, bisa dipulihkan dari Keranjang
    db.prepare(`
      UPDATE files SET is_deleted = 1, updated_at = datetime('now','localtime') WHERE id = ?
    `).run(fileId);

    deleted++;
  }

  console.log(`[BulkDelete] Dipindah ke Keranjang: ${deleted}, Gagal: ${errors.length}`);
  return res.json({ success: true, deleted, errors });
}

// ─────────────────────────────────────────────────────────────────────────────
// TAG
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalisasi daftar tag: trim, hapus kosong, dedupe (case-insensitive),
 * maksimal 20 tag dan 40 karakter per tag.
 */
function normalizeTags(raw) {
  if (Array.isArray(raw)) raw = raw.join(',');
  if (typeof raw !== 'string') return [];
  const seen = new Set();
  const result = [];
  for (const part of raw.split(',')) {
    const tag = part.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= 20) break;
  }
  return result;
}

/**
 * GET /api/files/:id/tags
 * Daftar tag milik satu file.
 */
function getFileTags(req, res) {
  const db = getDb();
  const fileId = parseInt(req.params.id, 10);

  if (isNaN(fileId)) {
    return res.status(400).json({ error: 'ID file tidak valid' });
  }

  const file = db.prepare(`
    SELECT id, filename, tags FROM files WHERE id = ? AND is_deleted = 0
  `).get(fileId);

  if (!file) {
    return res.status(404).json({ error: 'File tidak ditemukan' });
  }

  return res.json({
    id: file.id,
    filename: file.filename,
    tags: normalizeTags(file.tags || ''),
  });
}

/**
 * PUT /api/files/:id/tags   body: { tags: "a, b, c" }
 * Mengganti seluruh tag milik satu file.
 */
function updateFileTags(req, res) {
  const db = getDb();
  const fileId = parseInt(req.params.id, 10);

  if (isNaN(fileId)) {
    return res.status(400).json({ error: 'ID file tidak valid' });
  }

  const file = db.prepare(`
    SELECT id, filename, tags FROM files WHERE id = ? AND is_deleted = 0
  `).get(fileId);

  if (!file) {
    return res.status(404).json({ error: 'File tidak ditemukan' });
  }

  const tags = normalizeTags(req.body?.tags ?? '');
  const tagsString = tags.join(', ');

  db.prepare(`
    UPDATE files SET tags = ?, updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(tagsString, fileId);

  console.log(`[Tag] "${file.filename}": "${file.tags || '-'}" → "${tagsString || '-'}"`);
  return res.json({
    success: true,
    id: file.id,
    filename: file.filename,
    tags,
    message: `Tag "${file.filename}" diperbarui (${tags.length} tag)`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// KERANJANG ARSIP (SOFT DELETE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/trash?limit=100&offset=0
 * Daftar file & folder yang dihapus (is_deleted = 1), terbaru dulu.
 */
function getTrash(req, res) {
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const files = db.prepare(`
    SELECT id, filename, relative_path, parent_path, file_size, extension, mime_type,
           updated_at AS deleted_at
    FROM files
    WHERE is_deleted = 1
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const folders = db.prepare(`
    SELECT id, folder_name, relative_path, parent_path,
           updated_at AS deleted_at
    FROM folders
    WHERE is_deleted = 1
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const totalFiles = db.prepare(`SELECT COUNT(*) as count FROM files WHERE is_deleted = 1`).get().count;
  const totalFolders = db.prepare(`SELECT COUNT(*) as count FROM folders WHERE is_deleted = 1`).get().count;

  const items = [
    ...folders.map(f => ({ ...f, type: 'folder' })),
    ...files.map(f => ({
      ...f,
      type: 'file',
      file_size_formatted: formatFileSize(f.file_size),
    })),
  ].sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));

  return res.json({
    items,
    total: totalFiles + totalFolders,
    total_files: totalFiles,
    total_folders: totalFolders,
    limit,
    offset,
  });
}

/**
 * POST /api/trash/restore/:id
 * Pulihkan satu file dari keranjang. Folder induknya ikut dipulihkan
 * jika masih berstatus terhapus agar file muncul kembali di browse.
 */
function restoreFile(req, res) {
  const db = getDb();
  const fileId = parseInt(req.params.id, 10);

  if (isNaN(fileId)) {
    return res.status(400).json({ error: 'ID file tidak valid' });
  }

  const file = db.prepare(`
    SELECT * FROM files WHERE id = ? AND is_deleted = 1
  `).get(fileId);

  if (!file) {
    return res.status(404).json({ error: 'File tidak ada di keranjang' });
  }

  const restore = db.transaction(() => {
    // Pulihkan rantai folder induk (jika ikut terhapus)
    if (file.parent_path) {
      db.prepare(`
        UPDATE folders SET is_deleted = 0, updated_at = datetime('now','localtime')
        WHERE is_deleted = 1 AND (relative_path = ? OR ? LIKE relative_path || '/%')
      `).run(file.parent_path, file.parent_path);
    }

    db.prepare(`
      UPDATE files SET is_deleted = 0, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(fileId);
  });

  restore();

  const physicalExists = fs.existsSync(path.resolve(file.absolute_path));
  console.log(`[Trash] File dipulihkan: ${file.relative_path}`);
  return res.json({
    success: true,
    message: physicalExists
      ? `File "${file.filename}" dipulihkan`
      : `File "${file.filename}" dipulihkan (catatan: file fisik tidak ditemukan di disk)`,
    physical_exists: physicalExists,
  });
}

/**
 * POST /api/trash/restore-folder/:id
 * Pulihkan folder beserta seluruh subfolder dan file di dalamnya.
 */
function restoreFolder(req, res) {
  const db = getDb();
  const folderId = parseInt(req.params.id, 10);

  if (isNaN(folderId)) {
    return res.status(400).json({ error: 'ID folder tidak valid' });
  }

  const folder = db.prepare(`
    SELECT * FROM folders WHERE id = ? AND is_deleted = 1
  `).get(folderId);

  if (!folder) {
    return res.status(404).json({ error: 'Folder tidak ada di keranjang' });
  }

  const restore = db.transaction(() => {
    // Pulihkan rantai folder induk di atas folder ini
    if (folder.parent_path) {
      db.prepare(`
        UPDATE folders SET is_deleted = 0, updated_at = datetime('now','localtime')
        WHERE is_deleted = 1 AND (relative_path = ? OR ? LIKE relative_path || '/%')
      `).run(folder.parent_path, folder.parent_path);
    }

    // Pulihkan folder ini + seluruh subfoldernya
    db.prepare(`
      UPDATE folders SET is_deleted = 0, updated_at = datetime('now','localtime')
      WHERE is_deleted = 1 AND (relative_path = ? OR relative_path LIKE ?)
    `).run(folder.relative_path, folder.relative_path + '/%');

    // Pulihkan semua file di dalamnya
    db.prepare(`
      UPDATE files SET is_deleted = 0, updated_at = datetime('now','localtime')
      WHERE is_deleted = 1 AND (parent_path = ? OR parent_path LIKE ?)
    `).run(folder.relative_path, folder.relative_path + '/%');
  });

  restore();

  console.log(`[Trash] Folder dipulihkan: ${folder.relative_path}`);
  return res.json({
    success: true,
    message: `Folder "${folder.folder_name}" beserta isinya dipulihkan`,
  });
}

/**
 * DELETE /api/trash/files/:id
 * Hapus permanen: file fisik dihapus dari disk dan baris database dihapus.
 */
async function purgeFile(req, res) {
  const db = getDb();
  const fileId = parseInt(req.params.id, 10);

  if (isNaN(fileId)) {
    return res.status(400).json({ error: 'ID file tidak valid' });
  }

  const file = db.prepare(`
    SELECT * FROM files WHERE id = ? AND is_deleted = 1
  `).get(fileId);

  if (!file) {
    return res.status(404).json({ error: 'File tidak ada di keranjang' });
  }

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
    console.error('[Trash] Gagal menghapus file fisik:', err);
    return res.status(500).json({ error: 'Gagal menghapus file dari disk: ' + err.message });
  }

  // Hapus baris database (trigger FTS menangani index-nya)
  db.prepare(`DELETE FROM files WHERE id = ?`).run(fileId);

  console.log(`[Trash] File dihapus permanen: ${file.relative_path}`);
  return res.json({
    success: true,
    message: `File "${file.filename}" dihapus permanen`,
  });
}

/**
 * DELETE /api/trash/folders/:id
 * Hapus permanen folder beserta isinya: rekursif dari disk + database.
 */
async function purgeFolder(req, res) {
  const db = getDb();
  const folderId = parseInt(req.params.id, 10);

  if (isNaN(folderId)) {
    return res.status(400).json({ error: 'ID folder tidak valid' });
  }

  const folder = db.prepare(`
    SELECT * FROM folders WHERE id = ? AND is_deleted = 1
  `).get(folderId);

  if (!folder) {
    return res.status(404).json({ error: 'Folder tidak ada di keranjang' });
  }

  const resolvedPath = path.resolve(folder.absolute_path);
  if (!resolvedPath.startsWith(ARCHIVE_DIR + path.sep) && resolvedPath !== ARCHIVE_DIR) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  // Hapus folder fisik dari disk (rekursif)
  try {
    if (fs.existsSync(resolvedPath)) {
      await fsPromises.rm(resolvedPath, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('[Trash] Gagal menghapus folder fisik:', err);
    return res.status(500).json({ error: 'Gagal menghapus folder dari disk: ' + err.message });
  }

  // Hapus baris database (folder + subfolder + file)
  const purgeAll = db.transaction(() => {
    db.prepare(`
      DELETE FROM folders WHERE relative_path = ? OR relative_path LIKE ?
    `).run(folder.relative_path, folder.relative_path + '/%');

    db.prepare(`
      DELETE FROM files WHERE parent_path = ? OR parent_path LIKE ?
    `).run(folder.relative_path, folder.relative_path + '/%');
  });

  purgeAll();

  console.log(`[Trash] Folder dihapus permanen: ${folder.relative_path}`);
  return res.json({
    success: true,
    message: `Folder "${folder.folder_name}" beserta isinya dihapus permanen`,
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
  // New features
  renameFile,
  renameFolder,
  uploadFiles,
  bulkDeleteFiles,
  // Tag
  getFileTags,
  updateFileTags,
  // Keranjang (soft delete)
  getTrash,
  restoreFile,
  restoreFolder,
  purgeFile,
  purgeFolder,
};
