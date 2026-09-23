'use strict';

const fs = require('fs/promises');
const path = require('path');
const mime = require('mime-types');
const { getDb } = require('../config/database');

// Ukuran batch untuk bulk insert agar tidak OOM pada folder besar
const BATCH_SIZE = 500;

/**
 * Melakukan scan rekursif seluruh folder arsip dan memasukkan metadata
 * ke database. Menggunakan async iteration agar tidak blocking.
 *
 * @param {string} archiveDir - Path absolut folder arsip
 * @param {Function} [onProgress] - Callback(count) setiap batch selesai
 */
async function initialScan(archiveDir, onProgress) {
  console.log(`[Indexer] Memulai pemindaian awal: ${archiveDir}`);
  const startTime = Date.now();
  let totalFiles = 0;
  let totalFolders = 0;

  const db = getDb();

  // Prepared statements (reusable untuk performa)
  const upsertFile = db.prepare(`
    INSERT INTO files (filename, relative_path, absolute_path, parent_path, file_size, extension, mime_type, mtime)
    VALUES (@filename, @relative_path, @absolute_path, @parent_path, @file_size, @extension, @mime_type, @mtime)
    ON CONFLICT(relative_path) DO UPDATE SET
      filename      = excluded.filename,
      absolute_path = excluded.absolute_path,
      file_size     = excluded.file_size,
      mtime         = excluded.mtime,
      mime_type     = excluded.mime_type,
      updated_at    = datetime('now','localtime'),
      indexed_at    = datetime('now','localtime'),
      is_deleted    = 0
    WHERE files.mtime != excluded.mtime OR files.file_size != excluded.file_size
  `);

  const upsertFolder = db.prepare(`
    INSERT INTO folders (folder_name, relative_path, absolute_path, parent_path)
    VALUES (@folder_name, @relative_path, @absolute_path, @parent_path)
    ON CONFLICT(relative_path) DO UPDATE SET
      updated_at = datetime('now','localtime'),
      is_deleted = 0
  `);

  // Gunakan transaction untuk batch insert (jauh lebih cepat dari insert satu per satu)
  const batchInsertFiles = db.transaction((batch) => {
    for (const record of batch) {
      upsertFile.run(record);
    }
  });

  const batchInsertFolders = db.transaction((batch) => {
    for (const record of batch) {
      upsertFolder.run(record);
    }
  });

  // Rekursif scan dengan queue berbasis iterasi (menghindari stack overflow untuk folder dalam)
  const fileBatch = [];
  const folderBatch = [];
  const queue = [archiveDir];

  while (queue.length > 0) {
    const currentDir = queue.shift();

    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (err) {
      console.warn(`[Indexer] Skip folder (tidak bisa dibaca): ${currentDir} — ${err.message}`);
      continue;
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(archiveDir, absolutePath).replace(/\\/g, '/');
      const parentPath = path.relative(archiveDir, currentDir).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        queue.push(absolutePath);
        folderBatch.push({
          folder_name: entry.name,
          relative_path: relativePath,
          absolute_path: absolutePath,
          parent_path: parentPath,
        });
        totalFolders++;

        if (folderBatch.length >= BATCH_SIZE) {
          batchInsertFolders(folderBatch.splice(0, BATCH_SIZE));
        }
      } else if (entry.isFile()) {
        let stat;
        try {
          stat = await fs.stat(absolutePath);
        } catch {
          continue;
        }

        const ext = path.extname(entry.name).toLowerCase().replace('.', '');
        const mimeType = mime.lookup(entry.name) || 'application/octet-stream';

        fileBatch.push({
          filename: entry.name,
          relative_path: relativePath,
          absolute_path: absolutePath,
          parent_path: parentPath,
          file_size: stat.size,
          extension: ext,
          mime_type: mimeType,
          mtime: stat.mtime.toISOString(),
        });
        totalFiles++;

        if (fileBatch.length >= BATCH_SIZE) {
          batchInsertFiles(fileBatch.splice(0, BATCH_SIZE));
          if (onProgress) onProgress(totalFiles);
          console.log(`[Indexer] Terindeks: ${totalFiles} file, ${totalFolders} folder...`);
        }
      }
    }
  }

  // Flush sisa batch
  if (folderBatch.length > 0) batchInsertFolders(folderBatch);
  if (fileBatch.length > 0) batchInsertFiles(fileBatch);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[Indexer] ✅ Selesai! ${totalFiles} file & ${totalFolders} folder diindeks dalam ${elapsed}s`);

  return { totalFiles, totalFolders };
}

/**
 * Menambah atau memperbarui satu file ke database (dipanggil oleh watcher)
 * @param {string} absolutePath
 * @param {string} archiveDir
 */
async function upsertSingleFile(absolutePath, archiveDir) {
  const db = getDb();
  const relativePath = path.relative(archiveDir, absolutePath).replace(/\\/g, '/');
  const parentPath = path.relative(archiveDir, path.dirname(absolutePath)).replace(/\\/g, '/');
  const filename = path.basename(absolutePath);
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  const mimeType = mime.lookup(filename) || 'application/octet-stream';

  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    return; // File tidak bisa dibaca, skip
  }

  const stmt = db.prepare(`
    INSERT INTO files (filename, relative_path, absolute_path, parent_path, file_size, extension, mime_type, mtime)
    VALUES (@filename, @relative_path, @absolute_path, @parent_path, @file_size, @extension, @mime_type, @mtime)
    ON CONFLICT(relative_path) DO UPDATE SET
      filename      = excluded.filename,
      absolute_path = excluded.absolute_path,
      file_size     = excluded.file_size,
      mtime         = excluded.mtime,
      updated_at    = datetime('now','localtime'),
      indexed_at    = datetime('now','localtime'),
      is_deleted    = 0
  `);

  stmt.run({
    filename,
    relative_path: relativePath,
    absolute_path: absolutePath,
    parent_path: parentPath,
    file_size: stat.size,
    extension: ext,
    mime_type: mimeType,
    mtime: stat.mtime.toISOString(),
  });
}

/**
 * Soft-delete file dari database (file fisik tidak disentuh)
 * @param {string} absolutePath
 * @param {string} archiveDir
 */
function softDeleteFile(absolutePath, archiveDir) {
  const db = getDb();
  const relativePath = path.relative(archiveDir, absolutePath).replace(/\\/g, '/');
  db.prepare(`
    UPDATE files SET is_deleted = 1, updated_at = datetime('now','localtime')
    WHERE relative_path = ?
  `).run(relativePath);
}

/**
 * Upsert folder ke database
 */
function upsertSingleFolder(absolutePath, archiveDir) {
  const db = getDb();
  const relativePath = path.relative(archiveDir, absolutePath).replace(/\\/g, '/');
  const parentPath = path.relative(archiveDir, path.dirname(absolutePath)).replace(/\\/g, '/');
  const folderName = path.basename(absolutePath);

  db.prepare(`
    INSERT INTO folders (folder_name, relative_path, absolute_path, parent_path)
    VALUES (@folder_name, @relative_path, @absolute_path, @parent_path)
    ON CONFLICT(relative_path) DO UPDATE SET
      updated_at = datetime('now','localtime'),
      is_deleted = 0
  `).run({
    folder_name: folderName,
    relative_path: relativePath,
    absolute_path: absolutePath,
    parent_path: parentPath,
  });
}

/**
 * Soft-delete folder dari database
 */
function softDeleteFolder(absolutePath, archiveDir) {
  const db = getDb();
  const relativePath = path.relative(archiveDir, absolutePath).replace(/\\/g, '/');
  db.prepare(`
    UPDATE folders SET is_deleted = 1, updated_at = datetime('now','localtime')
    WHERE relative_path = ?
  `).run(relativePath);
  // Soft-delete semua file dalam folder tersebut
  db.prepare(`
    UPDATE files SET is_deleted = 1, updated_at = datetime('now','localtime')
    WHERE parent_path = ? OR relative_path LIKE ?
  `).run(relativePath, relativePath + '/%');
}

module.exports = {
  initialScan,
  upsertSingleFile,
  softDeleteFile,
  upsertSingleFolder,
  softDeleteFolder,
};
