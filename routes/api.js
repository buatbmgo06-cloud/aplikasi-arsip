'use strict';

const express = require('express');
const router = express.Router();

const {
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
  // Aksi massal
  bulkTagFiles,
  bulkDownloadFiles,
  // Tag
  getFileTags,
  updateFileTags,
  // Keranjang (soft delete)
  getTrash,
  restoreFile,
  restoreFolder,
  purgeFile,
  purgeFolder,
} = require('../controllers/archiveController');

const { searchFiles, getExtensions, listTags } = require('../controllers/searchController');
const { addClient } = require('../services/eventsService');

// ─── Live Updates (SSE) ──────────────────────────────────────────────────────
// GET /api/events — stream Server-Sent Events: dikirim event "archive-change"
// setiap watcher mendeteksi perubahan di folder arsip (dengan debounce).
router.get('/events', (req, res) => addClient(req, res));

// ─── Aksi Massal ─────────────────────────────────────────────────────────────
// CATATAN: route '/files/bulk/...' harus terdaftar SEBELUM route '/files/:id'
// agar 'bulk' tidak tertelan sebagai parameter :id.
// PUT /api/files/bulk/tags  body: { ids: [...], tags: "a, b" } — tag massal
router.put('/files/bulk/tags', bulkTagFiles);

// POST /api/files/bulk/download  body: { ids: [...] } — unduh ZIP massal
router.post('/files/bulk/download', bulkDownloadFiles);

// ─── Browse & Navigation ────────────────────────────────────────────────────
// GET /api/files/browse?path=subfolder/path
router.get('/files/browse', browseFolder);

// ─── Search ─────────────────────────────────────────────────────────────────
// GET /api/files/search?q=keyword&ext=pdf&limit=50&offset=0
router.get('/files/search', searchFiles);

// ─── File Operations ─────────────────────────────────────────────────────────
// GET /api/files/download/:id
router.get('/files/download/:id', downloadFile);

// GET /api/files/preview/:id
router.get('/files/preview/:id', previewFile);

// ─── Stats & Metadata ────────────────────────────────────────────────────────
// GET /api/stats
router.get('/stats', getStats);

// GET /api/recent?limit=20
router.get('/recent', getRecentFiles);

// GET /api/folder-tree
router.get('/folder-tree', getFolderTree);

// GET /api/extensions
router.get('/extensions', getExtensions);

// GET /api/tags — daftar semua tag + jumlah file
router.get('/tags', listTags);

// ─── Tag ─────────────────────────────────────────────────────────────────────
// GET /api/files/:id/tags — tag milik satu file
router.get('/files/:id/tags', getFileTags);

// PUT /api/files/:id/tags  body: { tags: "a, b, c" } — ganti seluruh tag file
router.put('/files/:id/tags', updateFileTags);

// ─── Keranjang (Soft Delete) ─────────────────────────────────────────────────
// GET /api/trash?limit=100&offset=0 — daftar item di keranjang
router.get('/trash', getTrash);

// POST /api/trash/restore/:id — pulihkan file
router.post('/trash/restore/:id', restoreFile);

// POST /api/trash/restore-folder/:id — pulihkan folder beserta isinya
router.post('/trash/restore-folder/:id', restoreFolder);

// DELETE /api/trash/files/:id — hapus permanen file (fisik + database)
router.delete('/trash/files/:id', purgeFile);

// DELETE /api/trash/folders/:id — hapus permanen folder (fisik + database)
router.delete('/trash/folders/:id', purgeFolder);

// ─── Scan ────────────────────────────────────────────────────────────────────
// GET /api/scan/recent?limit=20  — file hasil scan terbaru
router.get('/scan/recent', getScannedFiles);

// ─── Rename ──────────────────────────────────────────────────────────────────
// PATCH /api/files/:id/rename  body: { newName }
router.patch('/files/:id/rename', renameFile);

// PATCH /api/folders/:id/rename  body: { newName }
router.patch('/folders/:id/rename', renameFolder);

// ─── Upload ──────────────────────────────────────────────────────────────────
// POST /api/files/upload?path=subfolder — multipart/form-data, field: "files"
router.post('/files/upload', uploadFiles);

// ─── Delete ──────────────────────────────────────────────────────────────────
// DELETE /api/files/bulk  body: { ids: [1, 2, 3] }
// CATATAN: harus terdaftar SEBELUM router '/files/:id' agar tidak tertangkap param :id
router.delete('/files/bulk', bulkDeleteFiles);

// DELETE /api/files/:id  — hapus file (soft-delete, masuk keranjang)
router.delete('/files/:id', deleteFile);

// DELETE /api/folders/:id  — hapus folder beserta isinya (soft-delete, masuk keranjang)
router.delete('/folders/:id', deleteFolder);

// ─── Open External ──────────────────────────────────────────────────────────
// POST /api/files/open/:id  — buka file dengan aplikasi default sistem
router.post('/files/open/:id', openFileExternal);

// POST /api/files/openwith/:id  — buka dialog "Open With" Windows
router.post('/files/openwith/:id', openFileWithDialog);

// POST /api/files/openwithapp/:id?app=notepad  — buka dengan aplikasi spesifik
router.post('/files/openwithapp/:id', openFileWithApp);

// POST /api/folders/open/:id  — buka folder di Windows Explorer
router.post('/folders/open/:id', openFolderInExplorer);

// ─── Health Check ────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    archive_dir: process.env.ARCHIVE_DIR_PATH || 'NOT CONFIGURED',
  });
});

module.exports = router;
