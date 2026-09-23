'use strict';

const path = require('path');
const fs = require('fs');
const { getDb } = require('../config/database');

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

// ─── Helper: Format ukuran file ─────────────────────────────────────────────
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
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
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
  res.setHeader('Content-Length', file.file_size);

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
    fs.createReadStream(resolvedPath).pipe(res);
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
  const today = new Date().toISOString().slice(0, 10);
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
      date: today,
      count: todayCount.count || 0,
      total_size_formatted: formatFileSize(todayCount.total_size || 0),
    },
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
};
