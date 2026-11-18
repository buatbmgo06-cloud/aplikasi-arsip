# Local Archive System

Aplikasi manajemen arsip dokumen berbasis **Full Local Storage** menggunakan Node.js. Berjalan 100% offline di jaringan lokal (LAN) tanpa ketergantungan cloud.

## Fitur Utama

- 📁 **Auto-Sync** — Memindai folder arsip saat startup & sinkronisasi realtime via chokidar
- 🔍 **Full-Text Search** — Pencarian cepat menggunakan SQLite FTS5
- 🎛️ **Filter Lanjutan** — Filter tipe file, folder, rentang tanggal, ukuran, tag, dan sorting hasil
- 📑 **Muat Lebih Banyak** — Pagination hasil pencarian tanpa reload halaman
- 🏷️ **Manajemen Tag** — Tambah/hapus tag per file lewat menu klik-kanan, dengan saran tag
- 🔖 **Filter Tag** — Daftar tag di sidebar, klik untuk memfilter hasil pencarian
- ⬆️ **Upload & Rename** — Unggah file (tombol atau drag-and-drop) dan rename file/folder dari UI
- 🗑️ **Keranjang Arsip** — Hapus = soft delete; pulihkan atau hapus permanen lewat keranjang
- ✅ **Seleksi Massal** — Mode pilih banyak file (grid & list) → hapus, tag massal, atau unduh semua sebagai ZIP
- 💾 **Backup Otomatis** — Database dibackup saat startup & setiap 24 jam ke folder `backups/` (retensi 7 salinan)
- 🔄 **Auto-Refresh Realtime** — File yang dicopy/dihapus langsung dari Explorer otomatis muncul/hilang di browser via Server-Sent Events
- 🖱️ **Buka Cepat** — Klik dua kali file untuk langsung membukanya dengan aplikasi default Windows (seperti Explorer); menu klik-kanan juga menyediakan "Buka Dengan..." untuk memilih aplikasi tertentu
- ⬇️ **Download** — Unduh file aman via browser
- 📂 **Explorer Navigation** — Navigasi folder dengan breadcrumb & folder tree
- 🌐 **LAN Sharing** — Akses dari perangkat lain di jaringan yang sama
- 🔒 **Aman** — Proteksi Directory Traversal, 100% lokal

## Tech Stack

| Layer | Teknologi |
|-------|-----------|
| Backend | Node.js + Express.js |
| Database | SQLite (better-sqlite3) + FTS5 |
| File Watcher | chokidar |
| Frontend | Vanilla JS + Custom CSS (dark theme) |
| Template | EJS |

## Cara Menjalankan

### 1. Prasyarat

- Node.js v18+ atau v20+
- npm

### 2. Setup

```bash
# Clone atau copy ke folder tujuan
cd local-archive-app

# Install dependencies
npm install

# Buat file .env dari template
copy .env.example .env   # Windows
# atau
cp .env.example .env     # Linux/Mac
```

### 3. Konfigurasi

Edit file `.env`:

```env
PORT=3000
ARCHIVE_DIR_PATH=C:/DataArsip
APP_NAME=Local Archive System
```

> Ganti `C:/DataArsip` dengan path folder arsip Anda yang sebenarnya.

### 4. Jalankan

```bash
# Mode production
npm start

# Mode development (auto-restart)
npm run dev
```

Output di terminal:

```
╔══════════════════════════════════════════╗
║        LOCAL ARCHIVE SYSTEM v1.0         ║
╚══════════════════════════════════════════╝

✅ Database SQLite siap
[Indexer] Memulai pemindaian awal: C:/DataArsip
[Indexer] ✅ Selesai! 1234 file & 45 folder diindeks dalam 2.31s

 Server berjalan!

   Local:   http://localhost:3000
   Network: http://192.168.1.100:3000  (Wi-Fi)
```

## Struktur Proyek

```
local-archive-app/
├── config/
│   └── database.js          # SQLite init + FTS5 schema
├── controllers/
│   ├── archiveController.js # Browse, download, preview, stats
│   └── searchController.js  # FTS5 & LIKE search
├── services/
│   ├── indexerService.js    # Initial scan + per-file upsert
│   ├── watcherService.js    # chokidar event handlers
│   └── backupService.js     # Backup otomatis database (startup + 24 jam)
├── routes/
│   └── api.js               # REST API routes
├── views/
│   └── index.ejs            # Frontend template
├── public/
│   ├── js/app.js            # Vanilla JS SPA logic
│   ├── css/custom.css       # Dark theme CSS
│   └── images/icon-*.svg    # Ikon UI (SVG stroke konsisten)
├── data/                    # Database SQLite (auto-created)
├── backups/                 # Backup database otomatis (gitignored)
├── .env.example
├── server.js                # Entry point
└── package.json
```

## 🔌 API Endpoints

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/files/browse?path=subfolder` | Isi folder |
| GET | `/api/files/search?q=keyword&ext=pdf` | Pencarian |
| GET | `/api/files/download/:id` | Download file |
| GET | `/api/files/preview/:id` | Preview/stream |
| GET | `/api/stats` | Statistik arsip |
| GET | `/api/recent?limit=20` | File terbaru |
| GET | `/api/folder-tree` | Tree folder |
| GET | `/api/extensions` | Daftar ekstensi |
| GET | `/api/tags` | Daftar semua tag + jumlah file |
| GET | `/api/files/:id/tags` | Tag milik satu file |
| PUT | `/api/files/:id/tags` | Ganti tag satu file (`{ "tags": "a, b" }`) |
| PUT | `/api/files/bulk/tags` | Tag massal — digabung dengan tag lama (`{ "ids": [1,2], "tags": "a, b" }`) |
| POST | `/api/files/bulk/download` | Unduh banyak file sebagai ZIP (`{ "ids": [1,2] }`) |
| DELETE | `/api/files/bulk` | Soft delete massal (`{ "ids": [1,2] }`) |
| POST | `/api/files/upload?path=sub` | Upload file (multipart, field `files`) |
| PATCH | `/api/files/:id/rename` | Rename file (`{ "newName": "..." }`) |
| PATCH | `/api/folders/:id/rename` | Rename folder |
| GET | `/api/trash` | Item di keranjang (soft delete) |
| POST | `/api/trash/restore/:id` | Pulihkan file dari keranjang |
| POST | `/api/trash/restore-folder/:id` | Pulihkan folder beserta isinya |
| DELETE | `/api/trash/files/:id` | Hapus permanen file |
| DELETE | `/api/trash/folders/:id` | Hapus permanen folder |
| GET | `/api/health` | Health check |
| GET | `/api/events` | Stream SSE — event `archive-change` saat folder arsip berubah |

### Filter Lanjutan pada `/api/files/search`

Semua parameter opsional dan digabung dengan AND:

| Parameter | Nilai | Keterangan |
|-----------|-------|------------|
| `q` | teks | Kata kunci full-text (FTS5, fallback LIKE) |
| `ext` | `pdf` | Ekstensi file |
| `type` | `document`, `image`, `video`, `audio`, `archive`, `code` | Kelompok tipe file |
| `folder` | `subfolder/anak` | Batasi ke folder ini beserta isinya |
| `from`, `to` | `YYYY-MM-DD` | Rentang tanggal update file |
| `min_size`, `max_size` | byte | Rentang ukuran file |
| `tag` | teks | File yang memiliki tag ini |
| `sort` | `relevance`, `name`, `date`, `size` | Urutan hasil (default: relevansi saat ada `q`, selain itu tanggal) |
| `order` | `asc`, `desc` | Arah sorting (default: `desc`) |

## Keamanan

- **Directory Traversal**: Semua path divalidasi dengan `path.resolve()` + `startsWith(ARCHIVE_DIR)`
- **Soft Delete**: Hapus file/folder hanya menandai `is_deleted=1` — file fisik tetap ada dan bisa dipulihkan lewat Keranjang; penghapusan fisik hanya terjadi lewat "Hapus Permanen" di keranjang
- **No Cloud**: Zero koneksi ke internet, data 100% tersimpan lokal
