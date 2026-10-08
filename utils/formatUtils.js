'use strict';

/**
 * Memformat ukuran file dalam bytes ke format yang mudah dibaca
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

module.exports = { formatFileSize };
