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

// ─── Health Check ────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    archive_dir: process.env.ARCHIVE_DIR_PATH || 'NOT CONFIGURED',
  });
});

module.exports = router;
