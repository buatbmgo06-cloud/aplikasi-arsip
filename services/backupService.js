'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// BACKUP SERVICE — Backup otomatis database arsip
//
// archive.db menyimpan seluruh metadata (tag, keranjang, indeks) — jika file
// ini rusak/terhapus, semua data aplikasi hilang. Service ini membuat salinan
// aman secara otomatis:
//   1. Saat server dijalankan (startup)
//   2. Setiap 24 jam selama server berjalan
// Backup lama dipangkas otomatis (retensi 7 salinan terakhir).
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { getDb } = require('../config/database');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const RETENTION = 7;              // jumlah backup yang disimpan
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 jam

let intervalHandle = null;

/**
 * Buat satu file backup database ke folder backups/.
 * Memakai API `db.backup()` better-sqlite3 yang aman dipanggil
 * saat database sedang dipakai (tidak perlu menghentikan server).
 */
async function createBackup() {
  const db = getDb();

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const stamp = new Date()
    .toLocaleString('sv-SE', { hour12: false }) // format "YYYY-MM-DD HH:MM:SS"
    .replace(/[:\s]/g, '-');
  const dest = path.join(BACKUP_DIR, `archive-${stamp}.db`);

  try {
    // db.backup() bersifat asinkron — tunggu sampai benar-benar selesai
    // (tanpa ini, statSync bisa berjalan sebelum file tertulis → ENOENT).
    const backup = db.backup(dest);
    await backup.done;
    const size = fs.statSync(dest).size;
    console.log(`[Backup] Database dibackup: ${path.basename(dest)} (${(size / 1024).toFixed(1)} KB)`);
    pruneOldBackups();
    return { success: true, path: dest, size };
  } catch (err) {
    console.error(`[Backup] Gagal membuat backup: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Hapus backup lama, sisakan RETENTION file terbaru.
 */
function pruneOldBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => /^archive-\d{4}-\d{2}-\d{2}-.*\.db$/.test(f))
      .sort()
      .reverse();

    for (const f of files.slice(RETENTION)) {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
      console.log(`[Backup] Backup lama dihapus: ${f}`);
    }
  } catch (err) {
    console.error(`[Backup] Gagal memangkas backup lama: ${err.message}`);
  }
}

/**
 * Jalankan backup saat startup + interval harian.
 * Dipanggil sekali dari server.js setelah database siap.
 */
function startAutoBackup() {
  createBackup(); // async — jalankan di latar, log muncul saat selesai

  if (!intervalHandle) {
    intervalHandle = setInterval(createBackup, BACKUP_INTERVAL_MS);
    intervalHandle.unref(); // tidak menahan proses saat shutdown
  }
}

/**
 * Hentikan interval (untuk graceful shutdown).
 */
function stopAutoBackup() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { startAutoBackup, stopAutoBackup, createBackup };
