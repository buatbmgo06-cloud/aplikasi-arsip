'use strict';

/**
 * Scan Processor Service
 * ──────────────────────
 * Memantau subfolder "Scan" di dalam ARCHIVE_DIR dan secara otomatis:
 *  1. Mengganti nama file dengan format: Scan_YYYYMMDD_NNN.ext
 *  2. Menambahkan tag "scan" ke record database
 *  3. Mendukung konfigurasi prefix & subfolder via .env
 *
 * Alur kerja:
 *   Epson Scan menyimpan file ke C:\DataArsip\Scan\
 *       ↓  (chokidar deteksi file baru di watcherService)
 *   scanProcessorService.processNewScan() dipanggil
 *       ↓
 *   File di-rename → Scan_20240917_001.pdf
 *       ↓
 *   DB di-update: filename baru + tag "scan"
 */

const fs   = require('fs');
const path = require('path');
const mime = require('mime-types');
const { getDb } = require('../config/database');

// Konfigurasi dari .env (dengan nilai default)
const SCAN_SUBFOLDER = process.env.SCAN_SUBFOLDER || 'Scan';
const SCAN_PREFIX    = process.env.SCAN_PREFIX    || 'Scan';
const SCAN_TAGS      = process.env.SCAN_TAGS      || 'scan,arsip-digital';

/**
 * Mendapatkan path folder scan
 */
function getScanDir(archiveDir) {
  return path.join(archiveDir, SCAN_SUBFOLDER);
}

/**
 * Mengecek apakah sebuah file path berada di dalam folder scan
 */
function isInScanFolder(filePath, archiveDir) {
  const scanDir = getScanDir(archiveDir);
  const resolved = path.resolve(filePath);
  return resolved.startsWith(scanDir + path.sep) || resolved === scanDir;
}

/**
 * Mendapatkan nomor urut hari ini dari database (thread-safe via SQLite transaction)
 * Return: nomor urut berikutnya (dimulai dari 1)
 */
function getNextCounter(db) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // "20240917"

  const upsert = db.transaction(() => {
    const existing = db.prepare(
      `SELECT counter FROM scan_counter WHERE date_key = ?`
    ).get(today);

    if (existing) {
      db.prepare(
        `UPDATE scan_counter SET counter = counter + 1 WHERE date_key = ?`
      ).run(today);
      return existing.counter + 1;
    } else {
      db.prepare(
        `INSERT INTO scan_counter (date_key, counter) VALUES (?, 1)`
      ).run(today);
      return 1;
    }
  });

  return upsert();
}

/**
 * Generate nama file baru dengan format: Prefix_YYYYMMDD_NNN.ext
 * Contoh: Scan_20240917_001.pdf
 */
function generateScanFilename(ext, counter) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const num   = String(counter).padStart(3, '0');
  return `${SCAN_PREFIX}_${today}_${num}${ext ? '.' + ext : ''}`;
}

/**
 * Memproses file scan baru:
 * 1. Rename file
 * 2. Update database (nama baru + tags)
 *
 * Dipanggil oleh watcherService saat file baru masuk ke folder Scan
 *
 * @param {string} absolutePath - Path absolut file asli (sebelum rename)
 * @param {string} archiveDir   - Root folder arsip
 * @returns {Promise<{success:boolean, newPath?:string, newFilename?:string}>}
 */
async function processNewScan(absolutePath, archiveDir) {
  // Pastikan file masih ada (bisa saja sudah dipindah/hapus)
  if (!fs.existsSync(absolutePath)) {
    return { success: false, reason: 'File sudah tidak ada' };
  }

  // Skip file yang sudah sesuai format Scan_YYYYMMDD_NNN
  const basename = path.basename(absolutePath, path.extname(absolutePath));
  const scanPattern = new RegExp(`^${SCAN_PREFIX}_\\d{8}_\\d{3,}$`);
  if (scanPattern.test(basename)) {
    return { success: false, reason: 'File sudah berformat scan, skip' };
  }

  const db = getDb();
  const ext = path.extname(absolutePath).toLowerCase().replace('.', '');

  // Skip file yang bukan dokumen/gambar (misal: file temp .bak, .tmp)
  const ALLOWED_EXTS = ['pdf','jpg','jpeg','png','tif','tiff','bmp','webp','gif'];
  if (!ALLOWED_EXTS.includes(ext)) {
    console.log(`[ScanProcessor] Skip file (ekstensi tidak didukung): ${path.basename(absolutePath)}`);
    return { success: false, reason: 'Ekstensi tidak didukung untuk scan' };
  }

  // Generate nama baru
  const counter     = getNextCounter(db);
  const newFilename = generateScanFilename(ext, counter);
  const newAbsPath  = path.join(path.dirname(absolutePath), newFilename);

  // Rename file di disk
  try {
    fs.renameSync(absolutePath, newAbsPath);
    console.log(`[ScanProcessor] ✅ Renamed: ${path.basename(absolutePath)} → ${newFilename}`);
  } catch (err) {
    console.error(`[ScanProcessor] ❌ Gagal rename: ${err.message}`);
    // CATATAN: Counter TIDAK di-rollback karena operasi counter sudah atomic di dalam transaksi.
    // Jika rename gagal, nomor urut ini dilewati (gap nomor lebih aman dari nomor duplikat
    // yang bisa terjadi bila rollback counter bertabrakan dengan proses lain).
    return { success: false, reason: err.message };
  }

  // Update database: nama baru + tags
  const newRelPath    = path.relative(archiveDir, newAbsPath).replace(/\\/g, '/');
  const oldRelPath    = path.relative(archiveDir, absolutePath).replace(/\\/g, '/');
  const newParentPath = path.relative(archiveDir, path.dirname(newAbsPath)).replace(/\\/g, '/');
  const mimeType      = mime.lookup(newFilename) || 'application/octet-stream';
  const tags          = SCAN_TAGS; // "scan,arsip-digital"

  try {
    // Hapus record lama (jika sudah sempat terindeks dengan nama lama)
    db.prepare(`DELETE FROM files WHERE relative_path = ?`).run(oldRelPath);

    // Insert record baru dengan nama yang benar + tags
    const stat = fs.statSync(newAbsPath);
    db.prepare(`
      INSERT INTO files
        (filename, relative_path, absolute_path, parent_path, file_size, extension, mime_type, mtime, tags)
      VALUES
        (@filename, @relative_path, @absolute_path, @parent_path, @file_size, @extension, @mime_type, @mtime, @tags)
      ON CONFLICT(relative_path) DO UPDATE SET
        filename      = excluded.filename,
        absolute_path = excluded.absolute_path,
        file_size     = excluded.file_size,
        mtime         = excluded.mtime,
        tags          = excluded.tags,
        updated_at    = datetime('now','localtime'),
        is_deleted    = 0
    `).run({
      filename:      newFilename,
      relative_path: newRelPath,
      absolute_path: newAbsPath,
      parent_path:   newParentPath,
      file_size:     stat.size,
      extension:     ext,
      mime_type:     mimeType,
      mtime:         stat.mtime.toISOString(),
      tags,
    });

    console.log(`[ScanProcessor] 🏷️  Tagged: ${newFilename} → [${tags}]`);
  } catch (err) {
    console.error(`[ScanProcessor] ❌ Gagal update DB: ${err.message}`);
    return { success: false, reason: err.message };
  }

  return { success: true, newPath: newAbsPath, newFilename };
}

module.exports = {
  getScanDir,
  isInScanFolder,
  processNewScan,
};
