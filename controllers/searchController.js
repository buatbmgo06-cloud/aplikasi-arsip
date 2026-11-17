'use strict';

const { getDb } = require('../config/database');
const { formatFileSize } = require('../utils/formatUtils');

// ─── Konstanta Filter Lanjutan ───────────────────────────────────────────────

// Kelompok tipe file untuk filter `type`.
// Kelompok image/video/audio difilter via mime_type (null), sisanya via daftar ekstensi.
const TYPE_GROUPS = {
  document: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp'],
  image:    null, // mime_type LIKE 'image/%'
  video:    null, // mime_type LIKE 'video/%'
  audio:    null, // mime_type LIKE 'audio/%'
  archive:  ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'],
  code:     ['js', 'ts', 'py', 'html', 'css', 'json', 'xml', 'sql', 'php', 'java', 'c', 'cpp', 'sh', 'bat'],
};

const SORT_FIELDS = ['relevance', 'name', 'date', 'size'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/files/search
 *
 * Pencarian file menggunakan FTS5 (primary) dengan fallback ke LIKE query.
 *
 * Filter lanjutan (semuanya opsional, digabung dengan AND):
 *   q                    — kata kunci full-text
 *   ext                  — ekstensi file, contoh: pdf
 *   type                 — kelompok file: document | image | video | audio | archive | code
 *   folder               — batasi ke subfolder ini beserta isinya (relative path, separator '/')
 *   from, to             — rentang tanggal update file, format YYYY-MM-DD
 *   min_size, max_size   — ukuran file dalam byte
 *   tag                  — file yang memiliki tag ini
 *   sort                 — relevance (default saat ada q) | name | date (default) | size
 *   order                — asc | desc (default desc)
 *   limit, offset        — pagination
 */
function searchFiles(req, res) {
  const db = getDb();
  const query = (req.query.q || '').trim();
  const extFilter = (req.query.ext || '').toLowerCase().trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  const filters = buildAdvancedFilters(req, query, extFilter);
  if (!filters) {
    return res.json({ files: [], total: 0, query: '', message: 'Masukkan kata kunci pencarian atau filter' });
  }

  let files = [];
  let total = 0;

  try {
    if (query) {
      // Coba FTS5 full-text search terlebih dahulu
      files = searchWithFTS(db, query, filters, limit, offset);
      total = countFTS(db, query, filters);
    } else {
      // Filter tanpa kata kunci (ekstensi, tipe, tanggal, ukuran, folder, tag)
      files = db.prepare(`
        SELECT f.id, f.filename, f.relative_path, f.parent_path, f.file_size, f.extension, f.mime_type, f.tags, f.updated_at
        FROM files f
        WHERE ${filters.whereSql}
        ${filters.orderSql}
        LIMIT ? OFFSET ?
      `).all(...filters.params, limit, offset);

      total = db.prepare(`
        SELECT COUNT(*) as count FROM files f WHERE ${filters.whereSql}
      `).get(...filters.params).count;
    }
  } catch (err) {
    // FTS5 mungkin gagal jika query mengandung karakter khusus, fallback ke LIKE
    console.warn(`[Search] FTS5 error, fallback ke LIKE: ${err.message}`);
    files = searchWithLike(db, query, filters, limit, offset);
    total = countLike(db, query, filters);
  }

  return res.json({
    files: files.map(f => ({
      ...f,
      type: 'file',
      file_size_formatted: formatFileSize(f.file_size),
    })),
    total,
    query,
    filters: {
      ...filters.applied,
      sort: filters.sort,
      order: filters.order.toLowerCase(),
    },
    ext_filter: extFilter,
    limit,
    offset,
    has_more: offset + limit < total,
  });
}

// ─── Filter Lanjutan: Builder ────────────────────────────────────────────────

/**
 * Membangun WHERE clause + parameter dari semua filter.
 * Mengembalikan null jika tidak ada filter sama sekali.
 */
function buildAdvancedFilters(req, query, extFilter) {
  const conditions = ['f.is_deleted = 0'];
  const params = [];
  const applied = {};

  // Filter ekstensi
  if (extFilter) {
    conditions.push('f.extension = ?');
    params.push(extFilter);
    applied.ext = extFilter;
  }

  // Filter kelompok tipe file
  const typeFilter = (req.query.type || '').toLowerCase().trim();
  if (typeFilter && typeFilter in TYPE_GROUPS) {
    const extensions = TYPE_GROUPS[typeFilter];
    if (extensions) {
      conditions.push(`f.extension IN (${extensions.map(() => '?').join(',')})`);
      params.push(...extensions);
    } else {
      // Kelompok berbasis mime: image, video, audio
      conditions.push('f.mime_type LIKE ?');
      params.push(`${typeFilter}/%`);
    }
    applied.type = typeFilter;
  }

  // Filter folder (subtree: folder itu sendiri beserta seluruh isinya)
  const folderFilter = sanitizeFolderFilter(req.query.folder || '');
  if (folderFilter) {
    conditions.push("(f.parent_path = ? OR f.parent_path LIKE ? ESCAPE '\\')");
    params.push(folderFilter, `${escapeLike(folderFilter)}/%`);
    applied.folder = folderFilter;
  }

  // Filter rentang tanggal (kolom updated_at, format SQLite 'YYYY-MM-DD HH:MM:SS')
  const fromDate = parseDateParam(req.query.from, false);
  const toDate = parseDateParam(req.query.to, true);
  if (fromDate) {
    conditions.push('f.updated_at >= ?');
    params.push(fromDate);
    applied.from = String(req.query.from).trim();
  }
  if (toDate) {
    conditions.push('f.updated_at <= ?');
    params.push(toDate);
    applied.to = String(req.query.to).trim();
  }

  // Filter ukuran file (byte)
  const minSize = parseSizeParam(req.query.min_size);
  const maxSize = parseSizeParam(req.query.max_size);
  if (minSize !== null) {
    conditions.push('f.file_size >= ?');
    params.push(minSize);
    applied.min_size = minSize;
  }
  if (maxSize !== null) {
    conditions.push('f.file_size <= ?');
    params.push(maxSize);
    applied.max_size = maxSize;
  }

  // Filter tag (tags disimpan sebagai string dipisah koma, contoh: "scan, arsip-digital")
  const tagFilter = (req.query.tag || '').trim().toLowerCase();
  if (tagFilter) {
    conditions.push("(',' || lower(replace(f.tags, ', ', ',')) || ',') LIKE ? ESCAPE '\\'");
    params.push(`%,${escapeLike(tagFilter)},%`);
    applied.tag = tagFilter;
  }

  // Sorting. Nilai sort eksplisit dari klien ikut dihitung sebagai filter aktif
  // agar permintaan sort tanpa filter lain tetap mengembalikan seluruh file.
  const sortRequested = (req.query.sort || '').toLowerCase().trim();
  const sort = SORT_FIELDS.includes(sortRequested) ? sortRequested : (query ? 'relevance' : 'date');
  const order = (req.query.order || '').toLowerCase().trim() === 'asc' ? 'ASC' : 'DESC';

  if (sortRequested) {
    applied.sort = sort;
    applied.order = order.toLowerCase();
  }

  if (!query && Object.keys(applied).length === 0) return null;

  let orderSql;
  switch (sort) {
    case 'relevance':
      // bm25: nilai lebih kecil = lebih relevan
      orderSql = 'ORDER BY rank ASC';
      break;
    case 'name':
      orderSql = `ORDER BY f.filename COLLATE NOCASE ${order}, f.id DESC`;
      break;
    case 'size':
      orderSql = `ORDER BY f.file_size ${order}, f.id DESC`;
      break;
    default: // date
      orderSql = `ORDER BY f.updated_at ${order}, f.id DESC`;
  }

  return { whereSql: conditions.join(' AND '), params, orderSql, sort, order, applied };
}

// ─── Filter Lanjutan: Helper ─────────────────────────────────────────────────

/**
 * Normalisasi & validasi path folder dari query string.
 * Menerima 'subfolder/anak', menolak path traversal ('..', '.').
 */
function sanitizeFolderFilter(raw) {
  if (!raw) return '';
  let cleaned = String(raw).replace(/\\/g, '/').trim();
  if (cleaned.startsWith('/')) cleaned = cleaned.slice(1);
  if (cleaned.endsWith('/')) cleaned = cleaned.slice(0, -1);
  if (!cleaned) return '';
  const segments = cleaned.split('/');
  if (segments.some(s => !s || s === '.' || s === '..')) return '';
  return segments.join('/');
}

/**
 * Validasi parameter tanggal YYYY-MM-DD.
 * Mengembalikan string lengkap 'YYYY-MM-DD HH:MM:SS' untuk perbandingan kolom updated_at.
 */
function parseDateParam(value, endOfDay) {
  const s = (value || '').trim();
  if (!DATE_RE.test(s)) return '';
  const d = new Date(`${s}T00:00:00`);
  if (isNaN(d.getTime())) return '';
  return endOfDay ? `${s} 23:59:59` : `${s} 00:00:00`;
}

/**
 * Validasi parameter ukuran (byte). Mengembalikan integer >= 0, atau null jika tidak valid.
 */
function parseSizeParam(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

/**
 * Escape karakter khusus LIKE (% _ \) agar dicari secara literal.
 * Gunakan bersama `ESCAPE '\'` di query.
 */
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, ch => `\\${ch}`);
}

// ─── FTS5 search ─────────────────────────────────────────────────────────────
function searchWithFTS(db, query, filters, limit, offset) {
  const ftsQuery = sanitizeFtsQuery(query);
  return db.prepare(`
    SELECT f.id, f.filename, f.relative_path, f.parent_path, f.file_size, f.extension, f.mime_type, f.tags, f.updated_at,
           bm25(files_fts) as rank
    FROM files_fts
    JOIN files f ON files_fts.rowid = f.id
    WHERE files_fts MATCH ? AND ${filters.whereSql}
    ${filters.orderSql}
    LIMIT ? OFFSET ?
  `).all(ftsQuery, ...filters.params, limit, offset);
}

function countFTS(db, query, filters) {
  const ftsQuery = sanitizeFtsQuery(query);
  return db.prepare(`
    SELECT COUNT(*) as count
    FROM files_fts
    JOIN files f ON files_fts.rowid = f.id
    WHERE files_fts MATCH ? AND ${filters.whereSql}
  `).get(ftsQuery, ...filters.params).count;
}

// ─── Fallback: LIKE search ───────────────────────────────────────────────────
function searchWithLike(db, query, filters, limit, offset) {
  const likeQuery = `%${query}%`;
  const whereSql = `${filters.whereSql} AND (f.filename LIKE ? OR f.relative_path LIKE ?)`;
  const params = [...filters.params, likeQuery, likeQuery];

  return db.prepare(`
    SELECT f.id, f.filename, f.relative_path, f.parent_path, f.file_size, f.extension, f.mime_type, f.tags, f.updated_at
    FROM files f
    WHERE ${whereSql}
    ${filters.orderSql}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
}

function countLike(db, query, filters) {
  const likeQuery = `%${query}%`;
  const whereSql = `${filters.whereSql} AND (f.filename LIKE ? OR f.relative_path LIKE ?)`;
  const params = [...filters.params, likeQuery, likeQuery];

  return db.prepare(`
    SELECT COUNT(*) as count FROM files f WHERE ${whereSql}
  `).get(...params).count;
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
 * GET /api/tags
 * Daftar seluruh tag unik beserta jumlah file-nya (untuk saran di UI tag).
 */
function listTags(req, res) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT tags FROM files
    WHERE is_deleted = 0 AND tags != ''
  `).all();

  const counts = {};
  for (const row of rows) {
    for (const part of row.tags.split(',')) {
      const tag = part.trim().toLowerCase();
      if (!tag) continue;
      counts[tag] = (counts[tag] || 0) + 1;
    }
  }

  const tags = Object.entries(counts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  return res.json({ tags });
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

module.exports = { searchFiles, getExtensions, listTags };
