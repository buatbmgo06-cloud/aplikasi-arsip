# Local Archive System

Aplikasi manajemen arsip dokumen berbasis **Full Local Storage** menggunakan Node.js. Berjalan 100% offline di jaringan lokal (LAN) tanpa ketergantungan cloud.

## Fitur Utama

- 📁 **Auto-Sync** — Memindai folder arsip saat startup & sinkronisasi realtime via chokidar
- 🔍 **Full-Text Search** — Pencarian cepat menggunakan SQLite FTS5
- 📂 **Explorer Navigation** — Navigasi folder dengan breadcrumb & folder tree
- 👁️ **File Preview** — Preview PDF, gambar, video, audio langsung di browser
- ⬇️ **Download** — Unduh file aman via browser
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

🚀 Server berjalan!

   Local:   http://localhost:3000
   Network: http://192.168.1.100:3000  (Wi-Fi)
```

## 📁 Struktur Proyek

```
local-archive-app/
├── config/
│   └── database.js          # SQLite init + FTS5 schema
├── controllers/
│   ├── archiveController.js # Browse, download, preview, stats
│   └── searchController.js  # FTS5 & LIKE search
├── services/
│   ├── indexerService.js    # Initial scan + per-file upsert
│   └── watcherService.js    # chokidar event handlers
├── routes/
│   └── api.js               # REST API routes
├── views/
│   └── index.ejs            # Frontend template
├── public/
│   ├── js/app.js            # Vanilla JS SPA logic
│   └── css/custom.css       # Dark theme CSS
├── data/                    # Database SQLite (auto-created)
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
| GET | `/api/health` | Health check |

## 🔒 Keamanan

- **Directory Traversal**: Semua path divalidasi dengan `path.resolve()` + `startsWith(ARCHIVE_DIR)`
- **Soft Delete**: File yang dihapus hanya ditandai `is_deleted=1`, tidak ada penghapusan fisik
- **No Cloud**: Zero koneksi ke internet, data 100% tersimpan lokal
