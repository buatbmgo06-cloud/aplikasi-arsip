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
  tags: [],
  tagFilter: '',
  folderTree: [],
  previewFile: null,
  debounceTimer: null,
  searchOffset: 0,
  searchTotal: 0,
  isTrash: false,
  trashItems: [],
  tagFileId: null,
  tagDraft: [],
  renameTarget: null, // { type: 'file'|'folder', id, name }
  liveRefreshTimer: null,
  advFilters: {
    type: '',
    folderScope: false,
    dateFrom: '',
    dateTo: '',
    minSize: '',
    maxSize: '',
    sizeUnit: 'MB',
    sort: '',
    order: 'desc',
  },
};

// ─── DOM References ──────────────────────────────────────────────────────────
let DOM = {};

// ─── Icon mapping ─────────────────────────────────────────────────────────
// Emoji diganti ikon SVG (public/images/icon-*.svg) agar tampilan konsisten
// di semua perangkat — emoji bergantung pada font sistem dan bisa tampil
// sebagai kotak kosong di komputer tanpa font emoji.

// Helper: markup ikon SVG berdasarkan nama file di /images
function imgIcon(name) {
  return `<img src="/images/icon-${name}.svg" class="icon-img" alt="" />`;
}

const EXT_ICONS = {
  // Documents
  pdf: { icon: imgIcon('pdf'), color: 'text-red-400', bg: 'bg-red-900/30' },
  doc: { icon: imgIcon('dokumen'), color: 'text-blue-400', bg: 'bg-blue-900/30' },
  docx: { icon: imgIcon('dokumen'), color: 'text-blue-400', bg: 'bg-blue-900/30' },
  xls: { icon: imgIcon('grafik'), color: 'text-green-400', bg: 'bg-green-900/30' },
  xlsx: { icon: imgIcon('grafik'), color: 'text-green-400', bg: 'bg-green-900/30' },
  ppt: { icon: imgIcon('grafik'), color: 'text-orange-400', bg: 'bg-orange-900/30' },
  pptx: { icon: imgIcon('grafik'), color: 'text-orange-400', bg: 'bg-orange-900/30' },
  txt: { icon: imgIcon('dokumen'), color: 'text-gray-300', bg: 'bg-gray-800/50' },
  csv: { icon: imgIcon('grafik'), color: 'text-emerald-400', bg: 'bg-emerald-900/30' },
  // Images
  jpg: { icon: imgIcon('gambar'), color: 'text-purple-400', bg: 'bg-purple-900/30' },
  jpeg: { icon: imgIcon('gambar'), color: 'text-purple-400', bg: 'bg-purple-900/30' },
  png: { icon: imgIcon('gambar'), color: 'text-purple-400', bg: 'bg-purple-900/30' },
  gif: { icon: imgIcon('gambar'), color: 'text-purple-400', bg: 'bg-purple-900/30' },
  webp: { icon: imgIcon('gambar'), color: 'text-purple-400', bg: 'bg-purple-900/30' },
  svg: { icon: imgIcon('gambar'), color: 'text-pink-400', bg: 'bg-pink-900/30' },
  // Video
  mp4: { icon: imgIcon('video'), color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
  avi: { icon: imgIcon('video'), color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
  mov: { icon: imgIcon('video'), color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
  mkv: { icon: imgIcon('video'), color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
  // Audio
  mp3: { icon: imgIcon('musik'), color: 'text-cyan-400', bg: 'bg-cyan-900/30' },
  wav: { icon: imgIcon('musik'), color: 'text-cyan-400', bg: 'bg-cyan-900/30' },
  flac: { icon: imgIcon('musik'), color: 'text-cyan-400', bg: 'bg-cyan-900/30' },
  // Archives
  zip: { icon: imgIcon('zip'), color: 'text-amber-400', bg: 'bg-amber-900/30' },
  rar: { icon: imgIcon('zip'), color: 'text-amber-400', bg: 'bg-amber-900/30' },
  '7z': { icon: imgIcon('zip'), color: 'text-amber-400', bg: 'bg-amber-900/30' },
  // Code
  js: { icon: imgIcon('kode'), color: 'text-yellow-300', bg: 'bg-yellow-900/30' },
  py: { icon: imgIcon('kode'), color: 'text-blue-300', bg: 'bg-blue-900/30' },
  html: { icon: imgIcon('kode'), color: 'text-orange-300', bg: 'bg-orange-900/30' },
  css: { icon: imgIcon('kode'), color: 'text-blue-300', bg: 'bg-blue-900/30' },
};

const DEFAULT_ICON = { icon: imgIcon('folder'), color: 'text-gray-400', bg: 'bg-gray-800/50' };

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
async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);
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
  state.isTrash = false;
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
  if (!query && !ext && !state.tagFilter && !hasAdvancedFilters()) return;
  state.isSearching = true;
  state.isTrash = false;
  state.searchOffset = offset;

  setLoading(true);
  try {
    const params = new URLSearchParams({ limit: 60, offset });
    if (query) params.set('q', query);
    if (ext) params.set('ext', ext);
    if (state.tagFilter) params.set('tag', state.tagFilter);
    getAdvancedQueryParams(params);

    const data = await apiFetch(`/api/files/search?${params}`);
    const newFiles = data.files || [];
    // Pagination: offset > 0 berarti memuat halaman berikutnya, hasil ditambahkan
    state.currentFiles = offset > 0 ? [...state.currentFiles, ...newFiles] : newFiles;
    state.currentFolders = [];
    state.searchTotal = data.total || 0;

    if (offset === 0) {
      state.breadcrumb = [{ name: 'Home', path: '' }, { name: `Hasil pencarian: ${buildSearchLabel(query, ext)}`, path: '' }];
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
  state.isTrash = false;
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

// ─── Render Functions ─────────────────────────────────────────────────────────
function renderStats() {
  if (!state.stats || !DOM.statsContainer) return;
  const s = state.stats;
  DOM.statsContainer.innerHTML = `
    <div class="stat-card">
      <div class="stat-icon">${imgIcon('folder')}</div>
      <div class="stat-value">${(s.total_files || 0).toLocaleString('id-ID')}</div>
      <div class="stat-label">Total File</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">${imgIcon('save')}</div>
      <div class="stat-value">${s.total_size_formatted || '0 B'}</div>
      <div class="stat-label">Total Ukuran</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">${imgIcon('arsip')}</div>
      <div class="stat-value">${(s.total_folders || 0).toLocaleString('id-ID')}</div>
      <div class="stat-label">Total Folder</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">${imgIcon('bookmark')}</div>
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
      ${imgIcon('arsip')} Semua
    </button>
    ${btns}
  `;
}

async function loadTags() {
  try {
    const data = await apiFetch('/api/tags');
    state.tags = data.tags || [];
    renderTagFilters();
  } catch (e) {
    console.error('Gagal memuat tag:', e);
  }
}

function renderTagFilters() {
  if (!DOM.tagFilters) return;
  const topTags = state.tags.slice(0, 12);
  const btns = topTags.map(t => `
    <button class="ext-filter-btn ${state.tagFilter === t.tag ? 'active' : ''}"
            onclick="filterByTag('${escapeAttr(t.tag)}')"
            title="${t.count} file">
      <span>${imgIcon('tag')}</span>
      <span class="tag-name">${escapeHtml(t.tag)}</span>
      <span class="ext-count">${t.count}</span>
    </button>
  `).join('');

  DOM.tagFilters.innerHTML = `
    <button class="ext-filter-btn ${!state.tagFilter ? 'active' : ''}" onclick="filterByTag('')">
      ${imgIcon('bookmark')} Semua
    </button>
    ${btns}
  `;
}

function filterByTag(tag) {
  state.tagFilter = tag;
  renderTagFilters();
  if (state.searchQuery || state.extFilter || tag || hasAdvancedFilters()) {
    searchFiles(state.searchQuery, state.extFilter, 0);
  } else {
    browseFolder(state.currentPath);
  }
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
      <span class="folder-icon">${node.children?.length ? imgIcon('folder-open') : imgIcon('folder')}</span>
      <span class="folder-name">${escapeHtml(node.name)}</span>
    `;
    btn.addEventListener('click', () => {
      browseFolder(node.path);
      // Highlight aktif
      document.querySelectorAll('.folder-tree-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    // Klik kanan di navigasi folder → menu konteks (Buka, Explorer, Rename, Hapus)
    btn.addEventListener('contextmenu', (e) => showContextMenu(e, btn));
    btn.dataset.ctxType = 'folder';
    btn.dataset.ctxId = node.id;
    btn.dataset.ctxName = node.name;
    btn.dataset.ctxPath = node.path;

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
    const isHome = i === 0 && crumb.name === 'Home';

    // Home selalu ditampilkan sebagai tombol agar bisa diklik kembali ke tampilan utama
    if (isHome) {
      return `
        <button class="breadcrumb-home" onclick="browseFolder('')" title="Kembali ke tampilan utama">
          Home
        </button>
      `;
    }

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
        <img src="/images/icon-pencarian.png" alt="Ikon pencarian" class="empty-icon-img" />
        <p class="empty-title">${state.isSearching ? 'Tidak ada hasil ditemukan' : 'Folder kosong'}</p>
        <p class="empty-subtitle">${state.isSearching ? 'Coba kata kunci lain' : 'Tidak ada file atau subfolder di sini'}</p>
      </div>
    `;
    return;
  }

  const isGrid = state.viewMode === 'grid';
  DOM.fileArea.className = isGrid ? 'file-grid' : 'file-list';

  let html = allItems.map(item => {
    if (item.type === 'folder') {
      return renderFolderCard(item, isGrid);
    }
    return renderFileCard(item, isGrid);
  }).join('');

  // Pagination hasil pencarian: tombol muat halaman berikutnya
  if (state.isSearching && state.searchTotal > state.currentFiles.length) {
    html += `
      <div class="load-more-wrap">
        <button class="load-more-btn" onclick="loadMoreResults()">
          ${imgIcon('download')} Muat lebih banyak (${(state.searchTotal - state.currentFiles.length).toLocaleString('id-ID')} lagi)
        </button>
      </div>
    `;
  }

  DOM.fileArea.innerHTML = html;

  // Update result count
  if (DOM.resultCount) {
    const count = state.isSearching
      ? `${state.currentFiles.length} dari ${state.searchTotal} hasil`
      : `${state.currentFolders.length} folder, ${state.currentFiles.length} file`;
    DOM.resultCount.textContent = count;
  }
}

function renderFolderCard(folder, isGrid) {
  const ctxData = `data-ctx-type="folder" data-ctx-id="${folder.id}" data-ctx-name="${escapeAttr(folder.folder_name)}" data-ctx-path="${escapeAttr(folder.relative_path)}"`;
  if (isGrid) {
    return `
      <div class="file-card folder-card" ${ctxData} oncontextmenu="showContextMenu(event, this)">
        <div class="file-icon-wrap bg-yellow-900/30" onclick="browseFolder('${escapeAttr(folder.relative_path)}')">
          <span class="file-icon">${imgIcon('folder-open')}</span>
        </div>
        <div class="file-info" onclick="browseFolder('${escapeAttr(folder.relative_path)}')">
          <p class="file-name" title="${escapeHtml(folder.folder_name)}">${escapeHtml(folder.folder_name)}</p>
          <p class="file-meta">Folder</p>
        </div>
        
      </div>
    `;
  }
  return `
    <div class="file-list-item folder-card" ${ctxData} oncontextmenu="showContextMenu(event, this)">
      <span class="list-icon" onclick="browseFolder('${escapeAttr(folder.relative_path)}')">${imgIcon('folder-open')}</span>
      <div class="list-info" onclick="browseFolder('${escapeAttr(folder.relative_path)}')">
        <p class="file-name">${escapeHtml(folder.folder_name)}</p>
        <p class="file-meta-path">${escapeHtml(folder.relative_path)}</p>
      </div>
      <span class="list-type-badge folder-badge">Folder</span>
      
    </div>
  `;
}

// ─── Format Tanggal ──────────────────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'];
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  const day = d.getDate();
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
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
      <div class="file-card" data-id="${file.id}" data-ctx-type="file" data-ctx-id="${file.id}" data-ctx-name="${escapeAttr(file.filename)}" data-ctx-mime="${escapeAttr(file.mime_type)}" data-ctx-tags="${escapeAttr(tagList.join(', '))}" oncontextmenu="showContextMenu(event, this)">
        <div class="file-icon-wrap ${iconData.bg}">
          <span class="file-icon">${iconData.icon}</span>
        </div>
         <div class="file-info">
          <p class="file-name" title="${escapeHtml(file.filename)}">${escapeHtml(file.filename)}</p>
          <p class="file-meta">${file.file_size_formatted} · .${file.extension || '—'}</p>
          <p class="file-date">${formatDate(file.indexed_at)}</p>
          ${tagsHtml ? `<div class="file-tags">${tagsHtml}</div>` : ''}
        </div>
        <div class="file-actions">
          ${canPreview ? `<button class="action-btn" onclick="openPreview(${file.id}, '${escapeAttr(file.filename)}', '${escapeAttr(file.mime_type)}')">Preview</button>` : ''}
          <a class="action-btn download-btn" href="/api/files/download/${file.id}" download>Unduh</a>
        </div>
      </div>
    `;
  }

  return `
    <div class="file-list-item" data-id="${file.id}" data-ctx-type="file" data-ctx-id="${file.id}" data-ctx-name="${escapeAttr(file.filename)}" data-ctx-mime="${escapeAttr(file.mime_type)}" data-ctx-tags="${escapeAttr(tagList.join(', '))}" oncontextmenu="showContextMenu(event, this)">
      <span class="list-icon ${iconData.color}">${iconData.icon}</span>
      <div class="list-info">
        <p class="file-name">${escapeHtml(file.filename)}</p>
        <p class="file-meta-path">${escapeHtml(file.relative_path)}</p>
        ${tagsHtml ? `<div class="file-tags" style="margin-top:3px;">${tagsHtml}</div>` : ''}
      </div>
      <span class="list-date">${formatDate(file.indexed_at)}</span>
      <span class="list-size">${file.file_size_formatted}</span>
      <span class="list-ext-badge" style="">.${file.extension || '?'}</span>
      <div class="list-actions">
        ${canPreview ? `<button class="action-btn-sm" onclick="openPreview(${file.id}, '${escapeAttr(file.filename)}', '${escapeAttr(file.mime_type)}')">Preview</button>` : ''}
        <a class="action-btn-sm" href="/api/files/download/${file.id}" download>Unduh</a>
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
        <div class="preview-audio-icon">${imgIcon('musik')}</div>
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

// ─── Delete ──────────────────────────────────────────────────────────────────
async function deleteItem(type, id, name) {
  const typeLabel = type === 'folder' ? 'folder' : 'file';
  const msg = type === 'folder'
    ? `Pindahkan folder "${name}" beserta SELURUH isinya ke Keranjang?\n\nFolder bisa dipulihkan lagi lewat tombol Keranjang.`
    : `Pindahkan file "${name}" ke Keranjang?\n\nFile bisa dipulihkan lagi lewat tombol Keranjang.`;

  if (!confirm(msg)) return;

  const endpoint = type === 'folder'
    ? `/api/folders/${id}`
    : `/api/files/${id}`;

  try {
    const result = await apiFetch(endpoint, { method: 'DELETE' });
    // Tampilkan notifikasi sukses
    showNotification(result.message || `${typeLabel} berhasil dihapus`, 'success');
    // Refresh tampilan
    if (state.isSearching) {
      searchFiles(state.searchQuery, state.extFilter, 0);
    } else {
      browseFolder(state.currentPath);
    }
    // Refresh sidebar
    loadStats();
    loadFolderTree();
    loadExtensions();
  } catch (e) {
    showNotification('Gagal menghapus: ' + e.message, 'error');
  }
}

function showNotification(message, type = 'info') {
  // Hapus notifikasi sebelumnya jika ada
  const existing = document.getElementById('appNotification');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.id = 'appNotification';
  div.className = `app-notification app-notification--${type}`;
  div.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:inherit;font-size:18px;cursor:pointer;margin-left:12px;">×</button>
  `;
  document.body.appendChild(div);

  // Auto-dismiss setelah 4 detik
  setTimeout(() => {
    if (div.parentElement) {
      div.classList.add('app-notification--hide');
      setTimeout(() => div.remove(), 300);
    }
  }, 4000);
}

// ─── Upload ──────────────────────────────────────────────────────────────────
function pickUploadFiles() {
  if (state.isSearching || state.isTrash) {
    showNotification('Upload hanya bisa dilakukan di tampilan folder', 'info');
    return;
  }
  DOM.uploadInput.value = '';
  DOM.uploadInput.click();
}

async function uploadFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const formData = new FormData();
  for (const f of files) formData.append('files', f);

  const progress = showUploadProgress(files.length);
  try {
    const result = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/files/upload?path=${encodeURIComponent(state.currentPath)}`);
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          progress.update(Math.round((e.loaded / e.total) * 100));
        }
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText || '{}')); }
          catch { resolve({}); }
        } else {
          let msg = `HTTP ${xhr.status}`;
          try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* abaikan */ }
          reject(new Error(msg));
        }
      });
      xhr.addEventListener('error', () => reject(new Error('Koneksi ke server gagal')));
      xhr.send(formData);
    });

    const baru = (result.uploaded || []).length;
    const timpa = (result.replaced || []).length;
    let msg = `${files.length} file berhasil diupload`;
    if (baru && timpa) msg = `${baru} file baru diupload, ${timpa} file lama ditimpa`;
    else if (timpa) msg = `${timpa} file lama ditimpa`;
    progress.done();
    showNotification(msg, 'success');

    browseFolder(state.currentPath);
    loadStats();
    loadExtensions();
    loadTags();
    loadFolderTree();
  } catch (e) {
    progress.done();
    showNotification('Gagal upload: ' + e.message, 'error');
  }
}

function showUploadProgress(fileCount) {
  hideUploadProgress();
  const div = document.createElement('div');
  div.id = 'uploadProgress';
  div.className = 'app-notification app-notification--info';
  div.innerHTML = `<span>${imgIcon('upload')} Mengunggah ${fileCount} file… 0%</span>`;
  document.body.appendChild(div);
  return {
    update(pct) {
      const span = div.querySelector('span');
      if (span) span.textContent = `Mengunggah ${fileCount} file… ${pct}%`;
    },
    done() {
      div.remove();
    },
  };
}

function hideUploadProgress() {
  const existing = document.getElementById('uploadProgress');
  if (existing) existing.remove();
}

// ─── Modal Rename ────────────────────────────────────────────────────────────
function openRenameModal(type, id, name) {
  state.renameTarget = { type, id, name };

  DOM.renameTitle.textContent = `Rename ${type === 'folder' ? 'Folder' : 'File'}`;
  DOM.renameInput.value = name;
  DOM.renameError.classList.add('hidden');

  DOM.renameModal.classList.remove('hidden');
  DOM.renameModal.classList.add('flex');
  document.body.style.overflow = 'hidden';
  DOM.renameInput.focus();

  // Pre-select nama dasar (tanpa ekstensi) untuk file
  if (type === 'file') {
    const dot = name.lastIndexOf('.');
    DOM.renameInput.setSelectionRange(0, dot > 0 ? dot : name.length);
  } else {
    DOM.renameInput.setSelectionRange(0, name.length);
  }
}

function closeRenameModal() {
  DOM.renameModal.classList.add('hidden');
  DOM.renameModal.classList.remove('flex');
  DOM.renameError.classList.add('hidden');
  document.body.style.overflow = '';
  state.renameTarget = null;
}

async function saveRename() {
  if (!state.renameTarget) return;

  const newName = DOM.renameInput.value.trim();
  if (!newName) {
    DOM.renameError.textContent = 'Nama tidak boleh kosong';
    DOM.renameError.classList.remove('hidden');
    return;
  }

  try {
    const { type, id } = state.renameTarget;
    const endpoint = type === 'folder' ? `/api/folders/${id}/rename` : `/api/files/${id}/rename`;
    const r = await apiFetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName }),
    });
    showNotification(r.message || 'Berhasil direname', 'success');
    closeRenameModal();

    // Refresh tampilan
    if (state.isSearching) {
      searchFiles(state.searchQuery, state.extFilter, 0);
    } else {
      browseFolder(state.currentPath);
    }
    loadFolderTree();
    loadStats();
  } catch (e) {
    DOM.renameError.textContent = e.message;
    DOM.renameError.classList.remove('hidden');
  }
}

// ─── Keranjang Arsip (Soft Delete) ───────────────────────────────────────────
async function loadTrash() {
  state.isTrash = true;
  state.isSearching = false;

  setLoading(true);
  try {
    const data = await apiFetch('/api/trash?limit=200');
    state.trashItems = data.items || [];
    state.currentFiles = [];
    state.currentFolders = [];
    state.breadcrumb = [
      { name: 'Home', path: '' },
      { name: `Keranjang (${(data.total || 0).toLocaleString('id-ID')})`, path: '' },
    ];
    renderBreadcrumb();
    renderTrashList();
  } catch (e) {
    showError('Gagal memuat keranjang: ' + e.message);
  } finally {
    setLoading(false);
  }
}

function renderTrashList() {
  if (!DOM.fileArea) return;

  if (DOM.resultCount) {
    DOM.resultCount.textContent = `${state.trashItems.length} item di keranjang`;
  }

  DOM.fileArea.className = 'file-list';

  if (state.trashItems.length === 0) {
    DOM.fileArea.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${imgIcon('check')}</div>
        <p class="empty-title">Keranjang kosong</p>
        <p class="empty-subtitle">Tidak ada item yang dihapus</p>
      </div>
    `;
    return;
  }

  DOM.fileArea.innerHTML = state.trashItems.map(item => renderTrashItem(item)).join('');
}

function renderTrashItem(item) {
  const isFolder = item.type === 'folder';
  const name = isFolder ? item.folder_name : item.filename;
  const meta = isFolder ? 'Folder' : `${item.file_size_formatted} · .${item.extension || '—'}`;
  return `
    <div class="file-list-item trash-item">
      <span class="list-icon">${isFolder ? imgIcon('folder-open') : imgIcon('arsip')}</span>
      <div class="list-info">
        <p class="file-name">${escapeHtml(name)}</p>
        <p class="file-meta-path">${escapeHtml(item.relative_path)}</p>
      </div>
      <span class="list-date">Dihapus ${formatDate(item.deleted_at)}</span>
      <span class="list-size">${meta}</span>
      <div class="list-actions">
        <button class="action-btn-sm" onclick="restoreTrashItem('${item.type}', ${item.id})">${imgIcon('undo')} Pulihkan</button>
        <button class="action-btn-sm trash-purge-btn" onclick="purgeTrashItem('${item.type}', ${item.id}, '${escapeAttr(name)}')">${imgIcon('trash')} Hapus Permanen</button>
      </div>
    </div>
  `;
}

async function restoreTrashItem(type, id) {
  try {
    const endpoint = type === 'folder' ? `/api/trash/restore-folder/${id}` : `/api/trash/restore/${id}`;
    const r = await apiFetch(endpoint, { method: 'POST' });
    showNotification(r.message || 'Item dipulihkan', 'success');
    await loadTrash();
    loadStats();
    loadFolderTree();
    loadExtensions();
  } catch (e) {
    showNotification('Gagal memulihkan: ' + e.message, 'error');
  }
}

async function purgeTrashItem(type, id, name) {
  const msg = type === 'folder'
    ? `Hapus PERMANEN folder "${name}" beserta SELURUH isinya?\n\nFile fisik juga akan dihapus dan tidak dapat dikembalikan!`
    : `Hapus PERMANEN file "${name}"?\n\nFile fisik juga akan dihapus dan tidak dapat dikembalikan!`;

  if (!confirm(msg)) return;

  try {
    const endpoint = type === 'folder' ? `/api/trash/folders/${id}` : `/api/trash/files/${id}`;
    const r = await apiFetch(endpoint, { method: 'DELETE' });
    showNotification(r.message || 'Item dihapus permanen', 'success');
    await loadTrash();
    loadStats();
  } catch (e) {
    showNotification('Gagal menghapus permanen: ' + e.message, 'error');
  }
}

// ─── Modal Tag ───────────────────────────────────────────────────────────────
async function openTagModal(fileId, filename, currentTags) {
  state.tagFileId = fileId;
  state.tagDraft = Array.isArray(currentTags) ? [...currentTags] : [];

  DOM.tagTitle.textContent = `Atur Tag`;
  DOM.tagFileName.textContent = filename;
  DOM.tagInput.value = '';
  renderTagChips();
  renderTagSuggestions([]);

  DOM.tagModal.classList.remove('hidden');
  DOM.tagModal.classList.add('flex');
  document.body.style.overflow = 'hidden';
  DOM.tagInput.focus();

  await loadTagSuggestions();
}

function closeTagModal() {
  DOM.tagModal.classList.add('hidden');
  DOM.tagModal.classList.remove('flex');
  DOM.tagChips.innerHTML = '';
  DOM.tagSuggestions.innerHTML = '';
  document.body.style.overflow = '';
  state.tagFileId = null;
  state.tagDraft = [];
}

function renderTagChips() {
  DOM.tagChips.innerHTML = state.tagDraft.length
    ? state.tagDraft.map((t, i) => `
        <span class="tag-chip">${escapeHtml(t)}
          <button class="tag-chip-remove" onclick="removeTagDraft(${i})" aria-label="Hapus tag ${escapeAttr(t)}">×</button>
        </span>
      `).join('')
    : '<span class="tag-empty-hint">Belum ada tag</span>';
}

function addTagDraft() {
  const value = DOM.tagInput.value.trim();
  if (!value) return;
  DOM.tagInput.value = '';

  for (const part of value.split(',')) {
    const tag = part.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!tag) continue;
    if (state.tagDraft.some(t => t.toLowerCase() === tag.toLowerCase())) continue;
    if (state.tagDraft.length >= 20) break;
    state.tagDraft.push(tag);
  }
  renderTagChips();
  loadTagSuggestions();
}

function removeTagDraft(index) {
  state.tagDraft.splice(index, 1);
  renderTagChips();
  loadTagSuggestions();
}

function addTagFromSuggestion(tag) {
  DOM.tagInput.value = tag;
  addTagDraft();
}

async function loadTagSuggestions() {
  try {
    const data = await apiFetch('/api/tags');
    const existing = (data.tags || [])
      .filter(t => !state.tagDraft.some(d => d.toLowerCase() === t.tag.toLowerCase()));
    renderTagSuggestions(existing);
  } catch (e) {
    console.error('Gagal memuat saran tag:', e);
  }
}

function renderTagSuggestions(suggestions) {
  DOM.tagSuggestions.innerHTML = suggestions.length
    ? suggestions.map(t => `
        <button type="button" class="tag-suggestion" onclick="addTagFromSuggestion('${escapeAttr(t.tag)}')">
          ${escapeHtml(t.tag)} <span class="tag-suggestion-count">${t.count}</span>
        </button>
      `).join('')
    : '<span class="tag-empty-hint">Belum ada tag terdaftar</span>';
}

async function saveFileTags() {
  if (!state.tagFileId) return;

  try {
    const r = await apiFetch(`/api/files/${state.tagFileId}/tags`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: state.tagDraft.join(', ') }),
    });
    showNotification(r.message || 'Tag disimpan', 'success');
    closeTagModal();
    loadTags();

    // Refresh tampilan agar chip tag terbaru tampil
    if (state.isTrash) {
      loadTrash();
    } else if (state.isSearching) {
      searchFiles(state.searchQuery, state.extFilter, 0);
    } else {
      browseFolder(state.currentPath);
    }
  } catch (e) {
    showNotification('Gagal menyimpan tag: ' + e.message, 'error');
  }
}

async function loadMoreResults() {
  if (state.isLoading) return;
  await searchFiles(state.searchQuery, state.extFilter, state.currentFiles.length);
}

// ─── Live Updates (Auto-Refresh via SSE) ─────────────────────────────────────
// Server mengirim event "archive-change" lewat GET /api/events setiap watcher
// mendeteksi perubahan di folder arsip. Browser merespons dengan me-refresh
// tampilan aktif secara otomatis — tanpa perlu klik manual atau reload.
function initLiveUpdates() {
  if (!window.EventSource) return; // Browser lama: lewati, fitur tidak wajib

  const es = new EventSource('/api/events');

  es.addEventListener('archive-change', () => {
    scheduleLiveRefresh();
  });

  // EventSource otomatis reconnect saat koneksi putus — tidak perlu
  // penanganan khusus; onerror hanya untuk debug di console.
  es.onerror = () => {
    console.warn('Koneksi live update terputus, mencoba ulang otomatis...');
  };
}

function scheduleLiveRefresh() {
  // Debounce: jika sudah ada refresh terjadwal, tunda saja waktunya
  if (state.liveRefreshTimer) clearTimeout(state.liveRefreshTimer);
  state.liveRefreshTimer = setTimeout(() => {
    state.liveRefreshTimer = null;
    refreshCurrentView();
  }, 500);
}

async function refreshCurrentView() {
  try {
    if (state.isTrash) {
      await loadTrash();
    } else if (state.isSearching) {
      await searchFiles(state.searchQuery, state.extFilter, 0);
    } else {
      await browseFolder(state.currentPath);
    }
    loadStats();
    loadFolderTree();
  } catch (e) {
    console.error('Refresh otomatis gagal:', e);
  }
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

// ─── Filter Lanjutan ──────────────────────────────────────────────────────────
const SIZE_UNITS = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };

function hasAdvancedFilters() {
  const f = state.advFilters;
  return !!(f.type || f.dateFrom || f.dateTo || f.minSize || f.maxSize || f.sort);
}

function collectAdvancedFilters() {
  state.advFilters = {
    type: DOM.advType?.value || '',
    folderScope: !!DOM.advFolderScope?.checked,
    dateFrom: DOM.advDateFrom?.value || '',
    dateTo: DOM.advDateTo?.value || '',
    minSize: DOM.advMinSize?.value || '',
    maxSize: DOM.advMaxSize?.value || '',
    sizeUnit: DOM.advSizeUnit?.value || 'MB',
    sort: DOM.advSort?.value || '',
    order: DOM.advOrder?.value || 'desc',
  };
}

function getAdvancedQueryParams(params) {
  const f = state.advFilters;
  const toBytes = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return String(Math.round(n * (SIZE_UNITS[f.sizeUnit] || SIZE_UNITS.MB)));
  };

  if (f.type) params.set('type', f.type);
  if (f.folderScope && state.currentPath) params.set('folder', state.currentPath);
  if (f.dateFrom) params.set('from', f.dateFrom);
  if (f.dateTo) params.set('to', f.dateTo);
  if (f.minSize) {
    const bytes = toBytes(f.minSize);
    if (bytes !== null) params.set('min_size', bytes);
  }
  if (f.maxSize) {
    const bytes = toBytes(f.maxSize);
    if (bytes !== null) params.set('max_size', bytes);
  }
  if (f.sort) {
    params.set('sort', f.sort);
    params.set('order', f.order);
  }
}

function buildSearchLabel(query, ext) {
  const parts = [];
  if (query) parts.push(`"${query}"`);
  if (ext) parts.push(`.${ext}`);
  if (state.tagFilter) parts.push(`#${state.tagFilter}`);
  const f = state.advFilters;
  if (f.type) parts.push(f.type);
  if (f.dateFrom || f.dateTo) parts.push(`${f.dateFrom || '…'}–${f.dateTo || '…'}`);
  if (f.folderScope && state.currentPath) parts.push(`di ${state.currentPath}`);
  return parts.length ? escapeHtml(parts.join(' · ')) : 'filter lanjutan';
}

function applyAdvancedFilters() {
  collectAdvancedFilters();
  searchFiles(state.searchQuery, state.extFilter, 0);
}

function resetAdvancedFilters() {
  if (DOM.advType) DOM.advType.value = '';
  if (DOM.advFolderScope) DOM.advFolderScope.checked = false;
  if (DOM.advDateFrom) DOM.advDateFrom.value = '';
  if (DOM.advDateTo) DOM.advDateTo.value = '';
  if (DOM.advMinSize) DOM.advMinSize.value = '';
  if (DOM.advMaxSize) DOM.advMaxSize.value = '';
  if (DOM.advSizeUnit) DOM.advSizeUnit.value = 'MB';
  if (DOM.advSort) DOM.advSort.value = '';
  if (DOM.advOrder) DOM.advOrder.value = 'desc';
  collectAdvancedFilters();

  if (state.searchQuery || state.extFilter) {
    searchFiles(state.searchQuery, state.extFilter, 0);
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
  updateToolbarMode();
}

// Upload hanya aktif di tampilan folder (bukan hasil pencarian/keranjang)
function updateToolbarMode() {
  if (DOM.btnUpload) {
    const inFolder = !state.isSearching && !state.isTrash;
    DOM.btnUpload.disabled = !inFolder;
    DOM.btnUpload.style.opacity = inFolder ? '1' : '0.4';
    DOM.btnUpload.title = inFolder
      ? 'Unggah file ke folder ini (atau seret file ke area daftar)'
      : 'Upload hanya bisa dilakukan di tampilan folder';
  }
}

function showError(msg) {
  if (DOM.fileArea) {
    DOM.fileArea.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${imgIcon('warning')}</div>
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
    searchInput: document.getElementById('searchInput'),
    fileArea: document.getElementById('fileArea'),
    breadcrumb: document.getElementById('breadcrumb'),
    statsContainer: document.getElementById('statsContainer'),
    extFilters: document.getElementById('extFilters'),
    folderTree: document.getElementById('folderTree'),
    previewModal: document.getElementById('previewModal'),
    previewTitle: document.getElementById('previewTitle'),
    previewContent: document.getElementById('previewContent'),
    previewDownloadBtn: document.getElementById('previewDownloadBtn'),
    loadingSpinner: document.getElementById('loadingSpinner'),
    resultCount: document.getElementById('resultCount'),
    btnGrid: document.getElementById('btnGrid'),
    btnList: document.getElementById('btnList'),
    btnRecent: document.getElementById('btnRecent'),
    // Filter lanjutan
    advType: document.getElementById('advType'),
    advFolderScope: document.getElementById('advFolderScope'),
    advDateFrom: document.getElementById('advDateFrom'),
    advDateTo: document.getElementById('advDateTo'),
    advMinSize: document.getElementById('advMinSize'),
    advMaxSize: document.getElementById('advMaxSize'),
    advSizeUnit: document.getElementById('advSizeUnit'),
    advSort: document.getElementById('advSort'),
    advOrder: document.getElementById('advOrder'),
    btnApplyFilters: document.getElementById('btnApplyFilters'),
    btnResetFilters: document.getElementById('btnResetFilters'),
    // Keranjang & modal tag
    btnTrash: document.getElementById('btnTrash'),
    tagModal: document.getElementById('tagModal'),
    tagTitle: document.getElementById('tagTitle'),
    tagFileName: document.getElementById('tagFileName'),
    tagChips: document.getElementById('tagChips'),
    tagInput: document.getElementById('tagInput'),
    btnAddTag: document.getElementById('btnAddTag'),
    tagSuggestions: document.getElementById('tagSuggestions'),
    btnSaveTags: document.getElementById('btnSaveTags'),
    // Filter tag, upload, rename
    tagFilters: document.getElementById('tagFilters'),
    btnUpload: document.getElementById('btnUpload'),
    uploadInput: document.getElementById('uploadInput'),
    renameModal: document.getElementById('renameModal'),
    renameTitle: document.getElementById('renameTitle'),
    renameInput: document.getElementById('renameInput'),
    renameError: document.getElementById('renameError'),
    btnSaveRename: document.getElementById('btnSaveRename'),
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

  // Filter lanjutan: select langsung menerapkan, tombol Terapkan/Reset manual
  DOM.advType?.addEventListener('change', () => { collectAdvancedFilters(); searchFiles(state.searchQuery, state.extFilter, 0); });
  DOM.advSort?.addEventListener('change', () => { collectAdvancedFilters(); searchFiles(state.searchQuery, state.extFilter, 0); });
  DOM.advOrder?.addEventListener('change', () => { collectAdvancedFilters(); searchFiles(state.searchQuery, state.extFilter, 0); });
  DOM.advDateFrom?.addEventListener('change', applyAdvancedFilters);
  DOM.advDateTo?.addEventListener('change', applyAdvancedFilters);
  DOM.advMinSize?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyAdvancedFilters(); }
  });
  DOM.advMaxSize?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyAdvancedFilters(); }
  });
  DOM.btnApplyFilters?.addEventListener('click', applyAdvancedFilters);
  DOM.btnResetFilters?.addEventListener('click', resetAdvancedFilters);

  // Keranjang arsip
  DOM.btnTrash?.addEventListener('click', loadTrash);

  // Modal tag
  DOM.btnAddTag?.addEventListener('click', addTagDraft);
  DOM.tagInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTagDraft(); }
  });
  DOM.btnSaveTags?.addEventListener('click', saveFileTags);
  DOM.tagModal?.addEventListener('click', (e) => {
    if (e.target === DOM.tagModal) closeTagModal();
  });

  // Upload
  DOM.btnUpload?.addEventListener('click', pickUploadFiles);
  DOM.uploadInput?.addEventListener('change', (e) => {
    if (e.target.files?.length) uploadFiles(e.target.files);
  });

  // Drag & drop upload ke area daftar file
  DOM.fileArea?.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!state.isSearching && !state.isTrash) DOM.fileArea.classList.add('drag-over');
  });
  DOM.fileArea?.addEventListener('dragleave', () => {
    DOM.fileArea.classList.remove('drag-over');
  });
  DOM.fileArea?.addEventListener('drop', (e) => {
    e.preventDefault();
    DOM.fileArea.classList.remove('drag-over');
    if (state.isSearching || state.isTrash) {
      showNotification('Upload hanya bisa dilakukan di tampilan folder', 'info');
      return;
    }
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
  });

  // Modal rename
  DOM.btnSaveRename?.addEventListener('click', saveRename);
  DOM.renameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveRename(); }
  });
  DOM.renameModal?.addEventListener('click', (e) => {
    if (e.target === DOM.renameModal) closeRenameModal();
  });

  // Close modal on backdrop click
  DOM.previewModal?.addEventListener('click', (e) => {
    if (e.target === DOM.previewModal) closePreview();
  });

  // Keyboard shortcut: Escape to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePreview();
      closeTagModal();
      closeRenameModal();
    }
  });

  // Initial data load
  initLiveUpdates();
  Promise.all([
    loadStats(),
    loadExtensions(),
    loadTags(),
    loadFolderTree(),
    browseFolder(''),
  ]).catch(console.error);
});

// Expose functions needed by inline HTML onclick handlers
window.browseFolder = browseFolder;
window.filterByExt = filterByExt;
window.applyAdvancedFilters = applyAdvancedFilters;
window.resetAdvancedFilters = resetAdvancedFilters;
window.openPreview = openPreview;
window.closePreview = closePreview;
window.setViewMode = setViewMode;
window.loadRecentFiles = loadRecentFiles;
window.deleteItem = deleteItem;
window.showContextMenu = showContextMenu;
window.loadTrash = loadTrash;
window.restoreTrashItem = restoreTrashItem;
window.purgeTrashItem = purgeTrashItem;
window.closeTagModal = closeTagModal;
window.addTagDraft = addTagDraft;
window.removeTagDraft = removeTagDraft;
window.addTagFromSuggestion = addTagFromSuggestion;
window.loadMoreResults = loadMoreResults;
window.filterByTag = filterByTag;
window.closeRenameModal = closeRenameModal;

// ─── Context Menu ──────────────────────────────────────────────────────────────
let ctxMenu = null;

function createContextMenu() {
  if (ctxMenu) return ctxMenu;
  const div = document.createElement('div');
  div.id = 'contextMenu';
  div.className = 'ctx-menu hidden';
  document.body.appendChild(div);
  ctxMenu = div;

  // Tutup menu saat klik di luar
  document.addEventListener('click', () => hideContextMenu());
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('[data-ctx-type]')) hideContextMenu();
  });
  document.addEventListener('scroll', () => hideContextMenu(), true);
  return ctxMenu;
}

function showContextMenu(e, el) {
  e.preventDefault();
  e.stopPropagation();

  const menu = createContextMenu();
  const type = el.dataset.ctxType;
  const id = el.dataset.ctxId;
  const name = el.dataset.ctxName;
  const mime = el.dataset.ctxMime || '';
  const ext = (el.dataset.ctxExt || name.split('.').pop() || '').toLowerCase();
  const ctxPath = el.dataset.ctxPath || '';
  const previewType = type === 'file' ? getPreviewType(mime) : null;

  let items = '';

  if (type === 'file') {
    // ── Buka (default)
    items += `
      <button class="ctx-item" onclick="ctxAction('open-default', ${id})">
        <span class="ctx-item-icon">${imgIcon('play')}</span> Buka (Aplikasi Default)
      </button>`;

    // ── Buka Dengan... (submenu hover)
    const apps = getOpenWithApps(ext, mime);
    items += `
      <div class="ctx-submenu-wrap">
        <button class="ctx-item ctx-item--has-sub">
          <span><span class="ctx-item-icon">${imgIcon('monitor')}</span> Buka Dengan...</span>
        </button>
        <div class="ctx-submenu">
          <div class="ctx-submenu-header">Pilih Aplikasi</div>
          ${apps.map(a => `
            <button class="ctx-item" onclick="ctxAction('openwithapp', ${id}, null, null, '${a.key}')">
              <span class="ctx-app-badge ctx-app-badge--${a.color}">${a.icon}</span>
              ${escapeHtml(a.label)}
            </button>
          `).join('')}
          <div class="ctx-divider"></div>
          <button class="ctx-item" onclick="ctxAction('openwith-dialog', ${id})">
            <span class="ctx-app-badge ctx-app-badge--gray">${imgIcon('folder-open')}</span>
            Pilih Aplikasi Lain...
          </button>
        </div>
      </div>`;

    items += `<div class="ctx-divider"></div>`;

    // ── Preview
    if (previewType) {
      items += `
        <button class="ctx-item" onclick="ctxAction('preview', ${id}, '${escapeAttr(name)}', '${escapeAttr(mime)}')">
          <span class="ctx-item-icon"><img src="/images/icon-pencarian.png" class="ctx-icon-img" alt="" /></span> Preview
        </button>`;
    }

    // ── Atur Tag
    const ctxTags = (el.dataset.ctxTags || '').split(',').map(t => t.trim()).filter(Boolean);
    items += `
      <button class="ctx-item" onclick="ctxAction('tags', ${id}, '${escapeAttr(name)}', null, null, '${escapeAttr(ctxTags.join(', '))}')">
        <span class="ctx-item-icon">${imgIcon('tag')}</span> Atur Tag...
      </button>`;

    // ── Rename
    items += `
      <button class="ctx-item" onclick="ctxAction('rename-file', ${id}, '${escapeAttr(name)}')">
        <span class="ctx-item-icon">${imgIcon('pencil')}</span> Rename
      </button>`;

    // ── Unduh
    items += `
      <button class="ctx-item" onclick="ctxAction('download', ${id})">
        <span class="ctx-item-icon">${imgIcon('download')}</span> Unduh
      </button>`;

    items += `<div class="ctx-divider"></div>`;

    // ── Hapus
    items += `
      <button class="ctx-item ctx-item--danger" onclick="ctxAction('delete-file', ${id}, '${escapeAttr(name)}')">
        <span class="ctx-item-icon">${imgIcon('trash')}</span> Hapus
      </button>`;

  } else if (type === 'folder') {
    items += `
      <button class="ctx-item" onclick="ctxAction('browse', 0, '${escapeAttr(ctxPath)}')">
        <span class="ctx-item-icon">${imgIcon('folder-open')}</span> Buka Folder
      </button>
      <button class="ctx-item" onclick="ctxAction('explorer', ${id})">
        <span class="ctx-item-icon">${imgIcon('arsip')}</span> Buka di Explorer
      </button>
      <div class="ctx-divider"></div>
      <button class="ctx-item" onclick="ctxAction('rename-folder', ${id}, '${escapeAttr(name)}')">
        <span class="ctx-item-icon">${imgIcon('pencil')}</span> Rename
      </button>
      <button class="ctx-item ctx-item--danger" onclick="ctxAction('delete-folder', ${id}, '${escapeAttr(name)}')">
        <span class="ctx-item-icon">${imgIcon('trash')}</span> Hapus
      </button>`;
  }

  menu.innerHTML = items;
  menu.classList.remove('hidden');

  // Posisikan menu agar tidak keluar layar
  const menuW = 225;
  const menuH = menu.offsetHeight || 200;
  let x = e.clientX;
  let y = e.clientY;
  if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 8;
  if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 8;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  // Cek apakah submenu keluar layar kanan → tampilkan ke kiri
  requestAnimationFrame(() => {
    const sub = menu.querySelector('.ctx-submenu');
    if (sub) {
      const rect = sub.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) sub.classList.add('ctx-submenu--left');
    }
  });
}

function hideContextMenu() {
  if (ctxMenu) ctxMenu.classList.add('hidden');
}

// ─── getOpenWithApps: Rekomendasi aplikasi berdasarkan ekstensi ──────────────
function getOpenWithApps(ext, mime) {
  const isText = ['txt', 'csv', 'log', 'json', 'xml', 'html', 'css', 'js', 'md', 'ini', 'cfg'].includes(ext);
  const isImage = mime?.startsWith('image/');
  const isDoc = ['doc', 'docx', 'odt', 'rtf'].includes(ext);
  const isSheet = ['xls', 'xlsx', 'ods', 'csv'].includes(ext);
  const isPpt = ['ppt', 'pptx', 'odp'].includes(ext);

  const apps = [];

  if (isDoc || isPpt || isSheet) {
    apps.push({ key: 'wordpad', icon: imgIcon('dokumen'), label: 'WordPad', color: 'blue' });
  }
  if (isText || isDoc) {
    apps.push({ key: 'notepad', icon: imgIcon('dokumen'), label: 'Notepad', color: 'gray' });
  }
  if (isImage) {
    apps.push({ key: 'mspaint', icon: imgIcon('pencil'), label: 'Paint', color: 'orange' });
    apps.push({ key: 'photos', icon: imgIcon('gambar'), label: 'Foto Windows', color: 'purple' });
  }
  if (!isImage && !isText) {
    apps.push({ key: 'notepad', icon: imgIcon('dokumen'), label: 'Notepad', color: 'gray' });
  }

  // Selalu tampilkan di Explorer
  apps.push({ key: 'explorer', icon: imgIcon('folder'), label: 'Windows Explorer', color: 'green' });

  return apps;
}

async function ctxAction(action, id, nameOrPath, mime, appKey, tagsCsv) {
  hideContextMenu();

  switch (action) {
    case 'preview':
      openPreview(id, nameOrPath, mime);
      break;
    case 'tags': {
      const currentTags = (tagsCsv || '').split(',').map(t => t.trim()).filter(Boolean);
      openTagModal(id, nameOrPath, currentTags);
      break;
    }
    case 'rename-file':
    case 'rename-folder':
      openRenameModal(action === 'rename-folder' ? 'folder' : 'file', id, nameOrPath);
      break;
    case 'download':
      window.location.href = `/api/files/download/${id}`;
      break;
    case 'open-default':
    case 'open':
      try {
        const r = await apiFetch(`/api/files/open/${id}`, { method: 'POST' });
        showNotification(r.message || 'File dibuka', 'success');
      } catch (e) {
        showNotification('Gagal membuka file: ' + e.message, 'error');
      }
      break;
    case 'openwith-dialog':
      try {
        const r = await apiFetch(`/api/files/openwith/${id}`, { method: 'POST' });
        showNotification(r.message || 'Dialog dibuka', 'success');
      } catch (e) {
        showNotification('Gagal membuka dialog: ' + e.message, 'error');
      }
      break;
    case 'openwithapp':
      try {
        const r = await apiFetch(`/api/files/openwithapp/${id}?app=${encodeURIComponent(appKey)}`, { method: 'POST' });
        showNotification(r.message || 'File dibuka', 'success');
      } catch (e) {
        showNotification('Gagal membuka file: ' + e.message, 'error');
      }
      break;
    case 'explorer':
      try {
        const r = await apiFetch(`/api/folders/open/${id}`, { method: 'POST' });
        showNotification(r.message || 'Folder dibuka', 'success');
      } catch (e) {
        showNotification('Gagal membuka folder: ' + e.message, 'error');
      }
      break;
    case 'browse':
      browseFolder(nameOrPath);
      break;
    case 'delete-file':
      deleteItem('file', id, nameOrPath);
      break;
    case 'delete-folder':
      deleteItem('folder', id, nameOrPath);
      break;
  }
}

window.ctxAction = ctxAction;
