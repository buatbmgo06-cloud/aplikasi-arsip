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
} = require('../controllers/archiveController');

const { searchFiles, getExtensions } = require('../controllers/searchController');

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

// ─── Scan ────────────────────────────────────────────────────────────────────
// GET /api/scan/recent?limit=20  — file hasil scan terbaru
router.get('/scan/recent', getScannedFiles);

// ─── Delete ──────────────────────────────────────────────────────────────────
// DELETE /api/files/:id  — hapus file (fisik + database)
router.delete('/files/:id', deleteFile);

// DELETE /api/folders/:id  — hapus folder beserta isinya (fisik + database)
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
