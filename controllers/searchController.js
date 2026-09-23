'use strict';

const { getDb } = require('../config/database');

// ─── Helper: Format ukuran file ─────────────────────────────────────────────
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

/**
 * GET /api/files/search?q=keyword&ext=pdf&limit=50&offset=0
 *
 * Pencarian file menggunakan FTS5 (primary) dengan fallback ke LIKE query.
 * Mendukung filter ekstensi dan pagination.
 */
function searchFiles(req, res) {
  const db = getDb();
  const query = (req.query.q || '').trim();
  const extFilter = (req.query.ext || '').toLowerCase().trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  if (!query && !extFilter) {
    return res.json({ files: [], total: 0, query: '', message: 'Masukkan kata kunci pencarian' });
  }

  let files = [];
  let total = 0;

  try {
    if (query) {
      // Coba FTS5 full-text search terlebih dahulu
      files = searchWithFTS(db, query, extFilter, limit, offset);
      total = countFTS(db, query, extFilter);
    } else if (extFilter) {
      // Filter berdasarkan ekstensi saja
      files = db.prepare(`
        SELECT id, filename, relative_path, parent_path, file_size, extension, mime_type, updated_at
        FROM files
        WHERE extension = ? AND is_deleted = 0
        ORDER BY filename COLLATE NOCASE ASC
        LIMIT ? OFFSET ?
      `).all(extFilter, limit, offset);

      total = db.prepare(`
        SELECT COUNT(*) as count FROM files WHERE extension = ? AND is_deleted = 0
      `).get(extFilter).count;
    }
  } catch (err) {
    // FTS5 mungkin gagal jika query mengandung karakter khusus, fallback ke LIKE
    console.warn(`[Search] FTS5 error, fallback ke LIKE: ${err.message}`);
    files = searchWithLike(db, query, extFilter, limit, offset);
    total = countLike(db, query, extFilter);
  }

  return res.json({
    files: files.map(f => ({
      ...f,
      type: 'file',
      file_size_formatted: formatFileSize(f.file_size),
    })),
    total,
    query,
    ext_filter: extFilter,
    limit,
    offset,
    has_more: offset + limit < total,
  });
}

// FTS5 search
function searchWithFTS(db, query, extFilter, limit, offset) {
  // Sanitasi query untuk FTS5 (hindari karakter khusus yang bisa error)
  const ftsQuery = sanitizeFtsQuery(query);

  if (extFilter) {
    return db.prepare(`
      SELECT f.id, f.filename, f.relative_path, f.parent_path, f.file_size, f.extension, f.mime_type, f.updated_at,
             bm25(files_fts) as rank
      FROM files_fts
      JOIN files f ON files_fts.rowid = f.id
      WHERE files_fts MATCH ? AND f.extension = ? AND f.is_deleted = 0
      ORDER BY rank
      LIMIT ? OFFSET ?
    `).all(ftsQuery, extFilter, limit, offset);
  } else {
    return db.prepare(`
      SELECT f.id, f.filename, f.relative_path, f.parent_path, f.file_size, f.extension, f.mime_type, f.updated_at,
             bm25(files_fts) as rank
      FROM files_fts
      JOIN files f ON files_fts.rowid = f.id
      WHERE files_fts MATCH ? AND f.is_deleted = 0
      ORDER BY rank
      LIMIT ? OFFSET ?
    `).all(ftsQuery, limit, offset);
  }
}

function countFTS(db, query, extFilter) {
  const ftsQuery = sanitizeFtsQuery(query);
  if (extFilter) {
    return db.prepare(`
      SELECT COUNT(*) as count
      FROM files_fts
      JOIN files f ON files_fts.rowid = f.id
      WHERE files_fts MATCH ? AND f.extension = ? AND f.is_deleted = 0
    `).get(ftsQuery, extFilter).count;
  } else {
    return db.prepare(`
      SELECT COUNT(*) as count
      FROM files_fts
      JOIN files f ON files_fts.rowid = f.id
      WHERE files_fts MATCH ? AND f.is_deleted = 0
    `).get(ftsQuery).count;
  }
}

// Fallback: LIKE search
function searchWithLike(db, query, extFilter, limit, offset) {
  const likeQuery = `%${query}%`;
  if (extFilter) {
    return db.prepare(`
      SELECT id, filename, relative_path, parent_path, file_size, extension, mime_type, updated_at
      FROM files
      WHERE (filename LIKE ? OR relative_path LIKE ?) AND extension = ? AND is_deleted = 0
      ORDER BY filename COLLATE NOCASE ASC
      LIMIT ? OFFSET ?
    `).all(likeQuery, likeQuery, extFilter, limit, offset);
  } else {
    return db.prepare(`
      SELECT id, filename, relative_path, parent_path, file_size, extension, mime_type, updated_at
      FROM files
      WHERE (filename LIKE ? OR relative_path LIKE ?) AND is_deleted = 0
      ORDER BY filename COLLATE NOCASE ASC
      LIMIT ? OFFSET ?
    `).all(likeQuery, likeQuery, limit, offset);
  }
}

function countLike(db, query, extFilter) {
  const likeQuery = `%${query}%`;
  if (extFilter) {
    return db.prepare(`
      SELECT COUNT(*) as count FROM files
      WHERE (filename LIKE ? OR relative_path LIKE ?) AND extension = ? AND is_deleted = 0
    `).get(likeQuery, likeQuery, extFilter).count;
  } else {
    return db.prepare(`
      SELECT COUNT(*) as count FROM files
      WHERE (filename LIKE ? OR relative_path LIKE ?) AND is_deleted = 0
    `).get(likeQuery, likeQuery).count;
  }
}

/**
 * Sanitasi query untuk FTS5 agar tidak error pada karakter khusus
 * Membungkus setiap kata dalam tanda kutip
 */
function sanitizeFtsQuery(query) {
  // Remove karakter yang bisa merusak FTS5 syntax
  const cleaned = query.replace(/['"*^(){}[\]|&!:,]/g, ' ').trim();
  if (!cleaned) return '""';
  // Split kata dan bungkus dengan tanda kutip untuk exact prefix match
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.map(w => `"${w}"*`).join(' ');
}

/**
 * GET /api/extensions
 * Daftar ekstensi yang ada di arsip untuk filter UI
 */
function getExtensions(req, res) {
  const db = getDb();
  const extensions = db.prepare(`
    SELECT extension, COUNT(*) as count
    FROM files
    WHERE is_deleted = 0 AND extension != ''
    GROUP BY extension
    ORDER BY count DESC
  `).all();

  return res.json({ extensions });
}

module.exports = { searchFiles, getExtensions };
