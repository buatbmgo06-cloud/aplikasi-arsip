/**
 * Local Archive System — Frontend App
 * Vanilla JS SPA with no framework dependencies
 */

'use strict';

// ─── State ──────────────────────────────────────────────────────────────────
const state = {
  currentPath: '',
  searchQuery: '',
  extFilter: '',
  viewMode: 'grid', // 'grid' | 'list'
  isSearching: false,
  isLoading: false,
  searchResults: null,
  currentFiles: [],
  currentFolders: [],
  breadcrumb: [{ name: 'Home', path: '' }],
  stats: null,
  extensions: [],
  folderTree: [],
  previewFile: null,
  debounceTimer: null,
  searchOffset: 0,
  searchTotal: 0,
};

// ─── DOM References ──────────────────────────────────────────────────────────
let DOM = {};

// ─── Icon mapping ─────────────────────────────────────────────────────────
const EXT_ICONS = {
  // Documents
  pdf: { icon: '📄', color: 'text-red-400', bg: 'bg-red-900/30' },
  doc: { icon: '📝', color: 'text-blue-400', bg: 'bg-blue-900/30' },
  docx: { icon: '📝', color: 'text-blue-400', bg: 'bg-blue-900/30' },
  xls: { icon: '📊', color: 'text-green-400', bg: 'bg-green-900/30' },
  xlsx: { icon: '📊', color: 'text-green-400', bg: 'bg-green-900/30' },
  ppt: { icon: '📊', color: 'text-orange-400', bg: 'bg-orange-900/30' },
  pptx: { icon: '📊', color: 'text-orange-400', bg: 'bg-orange-900/30' },
  txt: { icon: '📃', color: 'text-gray-300', bg: 'bg-gray-800/50' },
  csv: { icon: '📊', color: 'text-emerald-400', bg: 'bg-emerald-900/30' },
  // Images
  jpg: { icon: '🖼️', color: 'text-purple-400', bg: 'bg-purple-900/30' },
  jpeg: { icon: '🖼️', color: 'text-purple-400', bg: 'bg-purple-900/30' },
  png: { icon: '🖼️', color: 'text-purple-400', bg: 'bg-purple-900/30' },
  gif: { icon: '🖼️', color: 'text-purple-400', bg: 'bg-purple-900/30' },
  webp: { icon: '🖼️', color: 'text-purple-400', bg: 'bg-purple-900/30' },
  svg: { icon: '🎨', color: 'text-pink-400', bg: 'bg-pink-900/30' },
  // Video
  mp4: { icon: '🎬', color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
  avi: { icon: '🎬', color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
  mov: { icon: '🎬', color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
  mkv: { icon: '🎬', color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
  // Audio
  mp3: { icon: '🎵', color: 'text-cyan-400', bg: 'bg-cyan-900/30' },
  wav: { icon: '🎵', color: 'text-cyan-400', bg: 'bg-cyan-900/30' },
  flac: { icon: '🎵', color: 'text-cyan-400', bg: 'bg-cyan-900/30' },
  // Archives
  zip: { icon: '🗜️', color: 'text-amber-400', bg: 'bg-amber-900/30' },
  rar: { icon: '🗜️', color: 'text-amber-400', bg: 'bg-amber-900/30' },
  '7z': { icon: '🗜️', color: 'text-amber-400', bg: 'bg-amber-900/30' },
  // Code
  js: { icon: '💻', color: 'text-yellow-300', bg: 'bg-yellow-900/30' },
  py: { icon: '💻', color: 'text-blue-300', bg: 'bg-blue-900/30' },
  html: { icon: '💻', color: 'text-orange-300', bg: 'bg-orange-900/30' },
  css: { icon: '💻', color: 'text-blue-300', bg: 'bg-blue-900/30' },
};

const DEFAULT_ICON = { icon: '📁', color: 'text-gray-400', bg: 'bg-gray-800/50' };

function getFileIcon(ext) {
  return EXT_ICONS[ext?.toLowerCase()] || DEFAULT_ICON;
}

// Preview-able MIME types
const PREVIEWABLE = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'],
  pdf: ['application/pdf'],
  video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
  audio: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/flac', 'audio/aac'],
  text: ['text/plain', 'text/csv', 'text/html', 'text/css', 'application/json'],
};

function getPreviewType(mimeType) {
  for (const [type, mimes] of Object.entries(PREVIEWABLE)) {
    if (mimes.includes(mimeType)) return type;
  }
  return null;
}

// ─── API Calls ───────────────────────────────────────────────────────────────
async function apiFetch(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(err.error || 'API Error');
  }
  return response.json();
}

async function loadStats() {
  try {
    state.stats = await apiFetch('/api/stats');
    renderStats();
  } catch (e) {
    console.error('Gagal memuat stats:', e);
  }
}

async function loadExtensions() {
  try {
    const data = await apiFetch('/api/extensions');
    state.extensions = data.extensions || [];
    renderExtensionFilters();
  } catch (e) {
    console.error('Gagal memuat ekstensi:', e);
  }
}

async function loadFolderTree() {
  try {
    const data = await apiFetch('/api/folder-tree');
    state.folderTree = data.tree || [];
    renderFolderTree(state.folderTree, DOM.folderTree, 0);
  } catch (e) {
    console.error('Gagal memuat folder tree:', e);
  }
}

async function browseFolder(folderPath) {
  state.isSearching = false;
  state.searchQuery = '';
  DOM.searchInput.value = '';
  state.currentPath = folderPath;

  setLoading(true);
  try {
    const data = await apiFetch(`/api/files/browse?path=${encodeURIComponent(folderPath)}`);
    state.currentFolders = data.folders || [];
    state.currentFiles = data.files || [];
    state.breadcrumb = data.breadcrumb || [{ name: 'Home', path: '' }];
    renderBreadcrumb();
    renderFileGrid();
  } catch (e) {
    showError('Gagal memuat folder: ' + e.message);
  } finally {
    setLoading(false);
  }
}

async function searchFiles(query, ext, offset = 0) {
  if (!query && !ext) return;
  state.isSearching = true;
  state.searchOffset = offset;

  setLoading(true);
  try {
    const params = new URLSearchParams({ limit: 60, offset });
    if (query) params.set('q', query);
    if (ext) params.set('ext', ext);

    const data = await apiFetch(`/api/files/search?${params}`);
    state.currentFiles = data.files || [];
    state.currentFolders = [];
    state.searchTotal = data.total || 0;

    if (offset === 0) {
      state.breadcrumb = [{ name: 'Home', path: '' }, { name: `Hasil pencarian: "${query || ext}"`, path: '' }];
    }
    renderBreadcrumb();
    renderFileGrid();
  } catch (e) {
    showError('Gagal mencari file: ' + e.message);
  } finally {
    setLoading(false);
  }
}

async function loadRecentFiles() {
  setLoading(true);
  try {
    const data = await apiFetch('/api/recent?limit=40');
    state.currentFiles = data.files || [];
    state.currentFolders = [];
    state.isSearching = true;
    state.breadcrumb = [{ name: 'Home', path: '' }, { name: 'File Terbaru', path: '' }];
    renderBreadcrumb();
    renderFileGrid();
  } catch (e) {
    showError('Gagal memuat file terbaru: ' + e.message);
  } finally {
    setLoading(false);
  }
}

async function loadScannedFiles() {
  setLoading(true);
  try {
    const data = await apiFetch('/api/scan/recent?limit=60');
    state.currentFiles = data.files || [];
    state.currentFolders = [];
    state.isSearching = true;

    const todayInfo = data.today
      ? ` · Hari ini: ${data.today.count} file`
      : '';
    state.breadcrumb = [
      { name: 'Home', path: '' },
      { name: `📷 Hasil Scan${todayInfo}`, path: '' },
    ];
    renderBreadcrumb();
    renderFileGrid();

    // Update tombol scan dengan info hari ini
    if (DOM.btnScan && data.today) {
      DOM.btnScan.title = `Scan hari ini: ${data.today.count} file (${data.today.total_size_formatted})`;
    }
  } catch (e) {
    showError('Gagal memuat file scan: ' + e.message);
  } finally {
    setLoading(false);
  }
}

// ─── Render Functions ─────────────────────────────────────────────────────────
function renderStats() {
  if (!state.stats || !DOM.statsContainer) return;
  const s = state.stats;
  DOM.statsContainer.innerHTML = `
    <div class="stat-card">
      <div class="stat-icon">📁</div>
      <div class="stat-value">${(s.total_files || 0).toLocaleString('id-ID')}</div>
      <div class="stat-label">Total File</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">💾</div>
      <div class="stat-value">${s.total_size_formatted || '0 B'}</div>
      <div class="stat-label">Total Ukuran</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">🗂️</div>
      <div class="stat-value">${(s.total_folders || 0).toLocaleString('id-ID')}</div>
      <div class="stat-label">Total Folder</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">🔖</div>
      <div class="stat-value">${(s.total_extensions || 0).toLocaleString('id-ID')}</div>
      <div class="stat-label">Jenis File</div>
    </div>
  `;
}

function renderExtensionFilters() {
  if (!DOM.extFilters) return;
  const topExts = state.extensions.slice(0, 12);
  const btns = topExts.map(e => {
    const icon = getFileIcon(e.extension);
    return `
      <button class="ext-filter-btn ${state.extFilter === e.extension ? 'active' : ''}"
              onclick="filterByExt('${e.extension}')"
              title="${e.count} file">
        <span>${icon.icon}</span>
        <span>.${e.extension}</span>
        <span class="ext-count">${e.count}</span>
      </button>
    `;
  }).join('');

  DOM.extFilters.innerHTML = `
    <button class="ext-filter-btn ${!state.extFilter ? 'active' : ''}" onclick="filterByExt('')">
      🗂️ Semua
    </button>
    ${btns}
  `;
}

function renderFolderTree(nodes, container, depth) {
  if (!container) return;
  container.innerHTML = '';
  if (!nodes || nodes.length === 0) {
    if (depth === 0) container.innerHTML = '<p class="text-gray-500 text-xs px-3 py-2">Tidak ada folder</p>';
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'folder-tree-list';

  for (const node of nodes) {
    const li = document.createElement('li');
    li.style.paddingLeft = `${depth * 12}px`;

    const btn = document.createElement('button');
    btn.className = `folder-tree-item ${state.currentPath === node.path ? 'active' : ''}`;
    btn.innerHTML = `
      <span class="folder-icon">${node.children?.length ? '📂' : '📁'}</span>
      <span class="folder-name">${escapeHtml(node.name)}</span>
    `;
    btn.addEventListener('click', () => {
      browseFolder(node.path);
      // Highlight aktif
      document.querySelectorAll('.folder-tree-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });

    li.appendChild(btn);

    if (node.children && node.children.length > 0) {
      const childContainer = document.createElement('div');
      renderFolderTree(node.children, childContainer, depth + 1);
      li.appendChild(childContainer);
    }

    ul.appendChild(li);
  }

  container.appendChild(ul);
}

function renderBreadcrumb() {
  if (!DOM.breadcrumb) return;
  DOM.breadcrumb.innerHTML = state.breadcrumb.map((crumb, i) => {
    const isLast = i === state.breadcrumb.length - 1;
    if (isLast) {
      return `<span class="breadcrumb-current">${escapeHtml(crumb.name)}</span>`;
    }
    return `
      <button class="breadcrumb-link" onclick="browseFolder('${crumb.path}')">
        ${escapeHtml(crumb.name)}
      </button>
      <span class="breadcrumb-sep">›</span>
    `;
  }).join('');
}

function renderFileGrid() {
  if (!DOM.fileArea) return;

  const allItems = [...state.currentFolders, ...state.currentFiles];

  if (allItems.length === 0) {
    DOM.fileArea.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <p class="empty-title">${state.isSearching ? 'Tidak ada hasil ditemukan' : 'Folder kosong'}</p>
        <p class="empty-subtitle">${state.isSearching ? 'Coba kata kunci lain' : 'Tidak ada file atau subfolder di sini'}</p>
      </div>
    `;
    return;
  }

  const isGrid = state.viewMode === 'grid';
  DOM.fileArea.className = isGrid ? 'file-grid' : 'file-list';

  DOM.fileArea.innerHTML = allItems.map(item => {
    if (item.type === 'folder') {
      return renderFolderCard(item, isGrid);
    }
    return renderFileCard(item, isGrid);
  }).join('');

  // Update result count
  if (DOM.resultCount) {
    const count = state.isSearching
      ? `${state.currentFiles.length} dari ${state.searchTotal} hasil`
      : `${state.currentFolders.length} folder, ${state.currentFiles.length} file`;
    DOM.resultCount.textContent = count;
  }
}

function renderFolderCard(folder, isGrid) {
  if (isGrid) {
    return `
      <div class="file-card folder-card" onclick="browseFolder('${escapeAttr(folder.relative_path)}')">
        <div class="file-icon-wrap bg-yellow-900/30">
          <span class="file-icon">📂</span>
        </div>
        <div class="file-info">
          <p class="file-name" title="${escapeHtml(folder.folder_name)}">${escapeHtml(folder.folder_name)}</p>
          <p class="file-meta">Folder</p>
        </div>
      </div>
    `;
  }
  return `
    <div class="file-list-item folder-card" onclick="browseFolder('${escapeAttr(folder.relative_path)}')">
      <span class="list-icon">📂</span>
      <div class="list-info">
        <p class="file-name">${escapeHtml(folder.folder_name)}</p>
        <p class="file-meta-path">${escapeHtml(folder.relative_path)}</p>
      </div>
      <span class="list-type-badge folder-badge">Folder</span>
    </div>
  `;
}

function renderFileCard(file, isGrid) {
  const iconData = getFileIcon(file.extension);
  const previewType = getPreviewType(file.mime_type);
  const canPreview = !!previewType;
  const tagList = Array.isArray(file.tag_list)
    ? file.tag_list
    : (file.tags ? file.tags.split(',').map(t => t.trim()).filter(Boolean) : []);
  const tagsHtml = tagList.map(t =>
    `<span class="file-tag ${t === 'scan' ? 'file-tag--scan' : ''}">${escapeHtml(t)}</span>`
  ).join('');

  if (isGrid) {
    return `
      <div class="file-card" data-id="${file.id}">
        <div class="file-icon-wrap ${iconData.bg}">
          <span class="file-icon">${iconData.icon}</span>
          ${canPreview ? `<button class="preview-btn" onclick="openPreview(${file.id}, '${escapeAttr(file.filename)}', '${escapeAttr(file.mime_type)}')" title="Preview">👁️</button>` : ''}
        </div>
        <div class="file-info">
          <p class="file-name" title="${escapeHtml(file.filename)}">${escapeHtml(file.filename)}</p>
          <p class="file-meta">${file.file_size_formatted} · .${file.extension || '—'}</p>
          ${tagsHtml ? `<div class="file-tags">${tagsHtml}</div>` : ''}
        </div>
        <div class="file-actions">
          ${canPreview ? `<button class="action-btn" onclick="openPreview(${file.id}, '${escapeAttr(file.filename)}', '${escapeAttr(file.mime_type)}')">👁️ Preview</button>` : ''}
          <a class="action-btn download-btn" href="/api/files/download/${file.id}" download>⬇️ Unduh</a>
        </div>
      </div>
    `;
  }

  return `
    <div class="file-list-item" data-id="${file.id}">
      <span class="list-icon ${iconData.color}">${iconData.icon}</span>
      <div class="list-info">
        <p class="file-name">${escapeHtml(file.filename)}</p>
        <p class="file-meta-path">${escapeHtml(file.relative_path)}</p>
        ${tagsHtml ? `<div class="file-tags" style="margin-top:3px;">${tagsHtml}</div>` : ''}
      </div>
      <span class="list-size">${file.file_size_formatted}</span>
      <span class="list-ext-badge" style="">.${file.extension || '?'}</span>
      <div class="list-actions">
        ${canPreview ? `<button class="action-btn-sm" onclick="openPreview(${file.id}, '${escapeAttr(file.filename)}', '${escapeAttr(file.mime_type)}')">👁️</button>` : ''}
        <a class="action-btn-sm" href="/api/files/download/${file.id}" download>⬇️</a>
      </div>
    </div>
  `;
}

// ─── Preview Modal ────────────────────────────────────────────────────────────
function openPreview(fileId, filename, mimeType) {
  const previewType = getPreviewType(mimeType);
  const previewUrl = `/api/files/preview/${fileId}`;
  const downloadUrl = `/api/files/download/${fileId}`;

  let contentHtml = '';

  if (previewType === 'image') {
    contentHtml = `<img src="${previewUrl}" alt="${escapeHtml(filename)}" class="preview-image" />`;
  } else if (previewType === 'pdf') {
    contentHtml = `<iframe src="${previewUrl}" class="preview-iframe" title="${escapeHtml(filename)}"></iframe>`;
  } else if (previewType === 'video') {
    contentHtml = `
      <video controls class="preview-video" autoplay>
        <source src="${previewUrl}" type="${mimeType}">
        Browser tidak mendukung video ini.
      </video>`;
  } else if (previewType === 'audio') {
    contentHtml = `
      <div class="preview-audio-wrap">
        <div class="preview-audio-icon">🎵</div>
        <p class="preview-audio-name">${escapeHtml(filename)}</p>
        <audio controls class="preview-audio">
          <source src="${previewUrl}" type="${mimeType}">
        </audio>
      </div>`;
  } else if (previewType === 'text') {
    // Fetch dan tampilkan konten teks
    contentHtml = `<div class="preview-text-loader" data-url="${previewUrl}">Memuat...</div>`;
  }

  DOM.previewTitle.textContent = filename;
  DOM.previewContent.innerHTML = contentHtml;
  DOM.previewDownloadBtn.href = downloadUrl;
  DOM.previewModal.classList.remove('hidden');
  DOM.previewModal.classList.add('flex');
  document.body.style.overflow = 'hidden';

  // Load text content jika teks
  const textLoader = DOM.previewContent.querySelector('.preview-text-loader');
  if (textLoader) {
    fetch(previewUrl)
      .then(r => r.text())
      .then(text => {
        textLoader.outerHTML = `<pre class="preview-text">${escapeHtml(text.substring(0, 50000))}</pre>`;
      })
      .catch(() => {
        textLoader.innerHTML = '<p class="text-red-400">Gagal memuat konten file.</p>';
      });
  }
}

function closePreview() {
  DOM.previewModal.classList.add('hidden');
  DOM.previewModal.classList.remove('flex');
  DOM.previewContent.innerHTML = '';
  document.body.style.overflow = '';
}

// ─── Filter & View Controls ──────────────────────────────────────────────────
function filterByExt(ext) {
  state.extFilter = ext;
  renderExtensionFilters();
  if (state.searchQuery || ext) {
    searchFiles(state.searchQuery, ext);
  } else {
    browseFolder(state.currentPath);
  }
}

function setViewMode(mode) {
  state.viewMode = mode;
  DOM.btnGrid.classList.toggle('active', mode === 'grid');
  DOM.btnList.classList.toggle('active', mode === 'list');
  renderFileGrid();
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function setLoading(isLoading) {
  state.isLoading = isLoading;
  if (DOM.loadingSpinner) {
    DOM.loadingSpinner.classList.toggle('hidden', !isLoading);
  }
}

function showError(msg) {
  if (DOM.fileArea) {
    DOM.fileArea.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p class="empty-title">Terjadi Kesalahan</p>
        <p class="empty-subtitle">${escapeHtml(msg)}</p>
      </div>
    `;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

// ─── Debounced Search ─────────────────────────────────────────────────────────
function handleSearchInput(value) {
  state.searchQuery = value.trim();
  clearTimeout(state.debounceTimer);

  if (!state.searchQuery && !state.extFilter) {
    state.isSearching = false;
    browseFolder(state.currentPath);
    return;
  }

  state.debounceTimer = setTimeout(() => {
    searchFiles(state.searchQuery, state.extFilter, 0);
  }, 350);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Map DOM elements
  DOM = {
    searchInput:      document.getElementById('searchInput'),
    fileArea:         document.getElementById('fileArea'),
    breadcrumb:       document.getElementById('breadcrumb'),
    statsContainer:   document.getElementById('statsContainer'),
    extFilters:       document.getElementById('extFilters'),
    folderTree:       document.getElementById('folderTree'),
    previewModal:     document.getElementById('previewModal'),
    previewTitle:     document.getElementById('previewTitle'),
    previewContent:   document.getElementById('previewContent'),
    previewDownloadBtn: document.getElementById('previewDownloadBtn'),
    loadingSpinner:   document.getElementById('loadingSpinner'),
    resultCount:      document.getElementById('resultCount'),
    btnGrid:          document.getElementById('btnGrid'),
    btnList:          document.getElementById('btnList'),
    btnRecent:        document.getElementById('btnRecent'),
    btnScan:          document.getElementById('btnScan'),
  };

  // Event listeners
  DOM.searchInput?.addEventListener('input', (e) => handleSearchInput(e.target.value));
  DOM.searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      DOM.searchInput.value = '';
      handleSearchInput('');
    }
  });

  DOM.btnGrid?.addEventListener('click', () => setViewMode('grid'));
  DOM.btnList?.addEventListener('click', () => setViewMode('list'));
  DOM.btnRecent?.addEventListener('click', loadRecentFiles);
  DOM.btnScan?.addEventListener('click', loadScannedFiles);

  // Close modal on backdrop click
  DOM.previewModal?.addEventListener('click', (e) => {
    if (e.target === DOM.previewModal) closePreview();
  });

  // Keyboard shortcut: Escape to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePreview();
  });

  // Initial data load
  Promise.all([
    loadStats(),
    loadExtensions(),
    loadFolderTree(),
    browseFolder(''),
  ]).catch(console.error);
});

// Expose functions needed by inline HTML onclick handlers
window.browseFolder   = browseFolder;
window.filterByExt    = filterByExt;
window.openPreview    = openPreview;
window.closePreview   = closePreview;
window.setViewMode    = setViewMode;
window.loadRecentFiles   = loadRecentFiles;
window.loadScannedFiles  = loadScannedFiles;
