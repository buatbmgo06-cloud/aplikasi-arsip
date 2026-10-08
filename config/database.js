'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Pastikan direktori data ada
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'archive.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);

    // Aktifkan WAL mode untuk performa yang lebih baik (concurrent reads)
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -32000'); // 32MB cache
    db.pragma('temp_store = MEMORY');
    db.pragma('foreign_keys = ON');

    initializeSchema(db);
  }
  return db;
}

function initializeSchema(db) {
  // Tabel utama: files
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      filename     TEXT    NOT NULL,
      relative_path TEXT   NOT NULL UNIQUE,
      absolute_path TEXT   NOT NULL,
      parent_path  TEXT    NOT NULL DEFAULT '',
      file_size    INTEGER NOT NULL DEFAULT 0,
      extension    TEXT    NOT NULL DEFAULT '',
      mime_type    TEXT    NOT NULL DEFAULT 'application/octet-stream',
      mtime        TEXT,
      tags         TEXT    NOT NULL DEFAULT '',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      indexed_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      is_deleted   INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Tabel folder
  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_name   TEXT    NOT NULL,
      relative_path TEXT    NOT NULL UNIQUE,
      absolute_path TEXT    NOT NULL,
      parent_path   TEXT    NOT NULL DEFAULT '',
      created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      is_deleted    INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Migrasi: tambah kolom tags jika belum ada (untuk database lama)
  const cols = db.prepare(`PRAGMA table_info(files)`).all().map(c => c.name);
  if (!cols.includes('tags')) {
    db.exec(`ALTER TABLE files ADD COLUMN tags TEXT NOT NULL DEFAULT ''`);
  }

  // Tabel counter untuk auto-numbering file scan per hari
  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_counter (
      date_key TEXT PRIMARY KEY,
      counter  INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Index untuk performa pencarian
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_files_filename     ON files(filename);
    CREATE INDEX IF NOT EXISTS idx_files_parent_path  ON files(parent_path);
    CREATE INDEX IF NOT EXISTS idx_files_extension    ON files(extension);
    CREATE INDEX IF NOT EXISTS idx_files_is_deleted   ON files(is_deleted);
    CREATE INDEX IF NOT EXISTS idx_files_updated_at   ON files(updated_at);
    CREATE INDEX IF NOT EXISTS idx_files_tags         ON files(tags);
    CREATE INDEX IF NOT EXISTS idx_folders_parent_path ON folders(parent_path);
    CREATE INDEX IF NOT EXISTS idx_folders_is_deleted  ON folders(is_deleted);
  `);

  // FTS5 Virtual Table untuk full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
      filename,
      relative_path,
      extension,
      content='files',
      content_rowid='id'
    );
  `);

  // Trigger untuk menjaga FTS tetap sinkron dengan tabel files.
  // CATATAN: Trigger AFTER INSERT aktif untuk INSERT biasa.
  // Trigger AFTER UPDATE aktif untuk UPDATE biasa.
  // INSERT...ON CONFLICT DO UPDATE (UPSERT) TIDAK memicu trigger apapun saat konflik,
  // sehingga FTS di-rebuild secara eksplisit via rebuildFts() setelah scan/upsert.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS files_fts_insert
    AFTER INSERT ON files BEGIN
      INSERT INTO files_fts(rowid, filename, relative_path, extension)
      VALUES (new.id, new.filename, new.relative_path, new.extension);
    END;

    CREATE TRIGGER IF NOT EXISTS files_fts_delete
    AFTER DELETE ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, filename, relative_path, extension)
      VALUES ('delete', old.id, old.filename, old.relative_path, old.extension);
    END;

    CREATE TRIGGER IF NOT EXISTS files_fts_update
    AFTER UPDATE ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, filename, relative_path, extension)
      VALUES ('delete', old.id, old.filename, old.relative_path, old.extension);
      INSERT INTO files_fts(rowid, filename, relative_path, extension)
      VALUES (new.id, new.filename, new.relative_path, new.extension);
    END;
  `);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Rebuild seluruh FTS5 index dari tabel files.
 * Dipanggil setelah initialScan atau setelah upsert tunggal (update file).
 * Aman dijalankan kapan saja — FTS akan konsisten kembali.
 */
function rebuildFts() {
  const database = getDb();
  try {
    database.exec(`INSERT INTO files_fts(files_fts) VALUES('rebuild')`);
  } catch (err) {
    console.error('[DB] Gagal rebuild FTS index:', err.message);
  }
}

module.exports = { getDb, closeDb, rebuildFts };
