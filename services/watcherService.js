'use strict';

const chokidar = require('chokidar');
const path = require('path');
const {
  upsertSingleFile,
  softDeleteFile,
  upsertSingleFolder,
  softDeleteFolder,
} = require('./indexerService');
const { isInScanFolder, processNewScan } = require('./scanProcessorService');

let watcher = null;

/**
 * Memulai chokidar watcher pada direktori arsip.
 * Semua event (add, change, unlink, addDir, unlinkDir) ditangani
 * dan disinkronkan ke database SQLite.
 *
 * @param {string} archiveDir - Path absolut folder arsip
 * @returns {FSWatcher} instance chokidar watcher
 */
function startWatcher(archiveDir) {
  if (watcher) {
    console.warn('[Watcher] Watcher sudah berjalan, skip inisialisasi ulang.');
    return watcher;
  }

  console.log(`[Watcher] 🔍 Memulai pemantauan realtime: ${archiveDir}`);

  watcher = chokidar.watch(archiveDir, {
    // Abaikan folder tersembunyi, node_modules, dan file sementara
    ignored: [
      /(^|[/\\])\../,      // hidden files/folders (dot files)
      /node_modules/,
      /\$RECYCLE\.BIN/,
      /System Volume Information/,
      /thumbs\.db$/i,
      /desktop\.ini$/i,
      /\.tmp$/i,
      /~\$.*$/,            // file temp Microsoft Office
    ],
    persistent: true,
    ignoreInitial: true,   // skip event untuk file yang sudah ada (sudah di-index saat startup)
    followSymlinks: false,
    awaitWriteFinish: {
      stabilityThreshold: 1500,  // tunggu 1.5 detik setelah file selesai ditulis
      pollInterval: 200,
    },
    depth: undefined,      // unlimited depth
  });

  // ─── Event: File baru ditambahkan ───────────────────────────────────────────
  watcher.on('add', (filePath) => {
    console.log(`[Watcher] ➕ File baru: ${path.relative(archiveDir, filePath)}`);

    // Cek apakah file berada di folder Scan → proses auto-rename & tagging
    if (isInScanFolder(filePath, archiveDir)) {
      processNewScan(filePath, archiveDir).then((result) => {
        if (!result.success) {
          // Jika gagal diproses oleh scan processor, indeks dengan nama asli
          upsertSingleFile(filePath, archiveDir).catch((err) => {
            console.error(`[Watcher] Error indeks fallback: ${err.message}`);
          });
        }
      }).catch((err) => {
        console.error(`[Watcher] Error scan processor: ${err.message}`);
        upsertSingleFile(filePath, archiveDir).catch(() => {});
      });
    } else {
      // File biasa di luar folder Scan
      upsertSingleFile(filePath, archiveDir).catch((err) => {
        console.error(`[Watcher] Error saat menambah file: ${err.message}`);
      });
    }
  });

  // ─── Event: File diubah (modified) ──────────────────────────────────────────
  watcher.on('change', (filePath) => {
    console.log(`[Watcher] ✏️  File berubah: ${path.relative(archiveDir, filePath)}`);
    upsertSingleFile(filePath, archiveDir).catch((err) => {
      console.error(`[Watcher] Error saat update file: ${err.message}`);
    });
  });

  // ─── Event: File dihapus ────────────────────────────────────────────────────
  watcher.on('unlink', (filePath) => {
    console.log(`[Watcher] 🗑️  File dihapus: ${path.relative(archiveDir, filePath)}`);
    softDeleteFile(filePath, archiveDir);
  });

  // ─── Event: Folder baru ditambahkan ─────────────────────────────────────────
  watcher.on('addDir', (dirPath) => {
    if (dirPath === archiveDir) return; // Skip root folder
    console.log(`[Watcher] 📁 Folder baru: ${path.relative(archiveDir, dirPath)}`);
    upsertSingleFolder(dirPath, archiveDir);
  });

  // ─── Event: Folder dihapus ──────────────────────────────────────────────────
  watcher.on('unlinkDir', (dirPath) => {
    console.log(`[Watcher] 🗑️  Folder dihapus: ${path.relative(archiveDir, dirPath)}`);
    softDeleteFolder(dirPath, archiveDir);
  });

  // ─── Event: Error ───────────────────────────────────────────────────────────
  watcher.on('error', (error) => {
    console.error(`[Watcher] ❌ Error: ${error.message}`);
  });

  // ─── Event: Watcher siap ────────────────────────────────────────────────────
  watcher.on('ready', () => {
    console.log('[Watcher] ✅ Watcher siap memantau perubahan realtime.');
  });

  return watcher;
}

/**
 * Menghentikan watcher (dipanggil saat server shutdown)
 */
async function stopWatcher() {
  if (watcher) {
    await watcher.close();
    watcher = null;
    console.log('[Watcher] Watcher dihentikan.');
  }
}

module.exports = { startWatcher, stopWatcher };
