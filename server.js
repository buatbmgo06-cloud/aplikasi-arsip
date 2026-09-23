'use strict';

require('dotenv').config();

const express  = require('express');
const path     = require('path');
const os       = require('os');
const fs       = require('fs');
const { getDb, closeDb } = require('./config/database');
const { initialScan }    = require('./services/indexerService');
const { startWatcher, stopWatcher } = require('./services/watcherService');
const apiRouter = require('./routes/api');

// ─── Konfigurasi ─────────────────────────────────────────────────────────────
const PORT        = parseInt(process.env.PORT || '3000', 10);
const ARCHIVE_DIR = process.env.ARCHIVE_DIR_PATH
  ? path.resolve(process.env.ARCHIVE_DIR_PATH)
  : null;
const APP_NAME    = process.env.APP_NAME || 'Local Archive System';

// ─── Validasi ARCHIVE_DIR ────────────────────────────────────────────────────
if (!ARCHIVE_DIR) {
  console.error('❌ ERROR: ARCHIVE_DIR_PATH belum diatur di file .env');
  console.error('   Salin .env.example menjadi .env dan isi dengan path folder arsip Anda.');
  process.exit(1);
}

if (!fs.existsSync(ARCHIVE_DIR)) {
  console.warn(`⚠️  PERINGATAN: Folder arsip tidak ditemukan: ${ARCHIVE_DIR}`);
  console.warn('   Membuat folder tersebut secara otomatis...');
  try {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    console.log(`✅ Folder arsip dibuat: ${ARCHIVE_DIR}`);
  } catch (err) {
    console.error(`❌ Gagal membuat folder arsip: ${err.message}`);
    process.exit(1);
  }
}

// ─── Express App Setup ───────────────────────────────────────────────────────
const app = express();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js',  express.static(path.join(__dirname, 'public', 'js')));

// Parse JSON & URL-encoded body
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Security headers dasar
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────
// API routes
app.use('/api', apiRouter);

// Frontend — Halaman utama
app.get('/', (req, res) => {
  const networkUrl = getNetworkUrl(PORT);
  res.render('index', {
    appName: APP_NAME,
    archiveDir: ARCHIVE_DIR,
    serverUrl: networkUrl || `http://localhost:${PORT}`,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan', path: req.path });
});

// Error handler global
app.use((err, req, res, _next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ─── Helper: Dapatkan IP lokal jaringan ─────────────────────────────────────
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Hanya IPv4, non-internal (bukan 127.0.0.1)
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({ name, address: iface.address });
      }
    }
  }
  return addresses;
}

function getNetworkUrl(port) {
  const ips = getLocalIpAddresses();
  if (ips.length === 0) return null;
  return `http://${ips[0].address}:${port}`;
}

// ─── Startup ─────────────────────────────────────────────────────────────────
async function startup() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║        LOCAL ARCHIVE SYSTEM v1.0         ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Inisialisasi database
  try {
    getDb(); // Trigger schema initialization
    console.log('✅ Database SQLite siap');
  } catch (err) {
    console.error('❌ Gagal inisialisasi database:', err.message);
    process.exit(1);
  }

  // Initial scan folder arsip
  console.log(`📁 Folder arsip: ${ARCHIVE_DIR}\n`);
  try {
    const result = await initialScan(ARCHIVE_DIR);
    console.log(`📊 Hasil scan: ${result.totalFiles} file, ${result.totalFolders} folder\n`);
  } catch (err) {
    console.error('❌ Gagal melakukan scan awal:', err.message);
    // Lanjutkan meski scan gagal, bukan error fatal
  }

  // Mulai chokidar watcher
  try {
    startWatcher(ARCHIVE_DIR);
  } catch (err) {
    console.error('⚠️  Gagal memulai file watcher:', err.message);
  }

  // Jalankan HTTP server (bind ke 0.0.0.0 untuk LAN access)
  const server = app.listen(PORT, '0.0.0.0', () => {
    const localIps = getLocalIpAddresses();

    console.log('🚀 Server berjalan!\n');
    console.log(`   Local:   http://localhost:${PORT}`);
    for (const ip of localIps) {
      console.log(`   Network: http://${ip.address}:${PORT}  (${ip.name})`);
    }
    console.log('\n📂 Seret file ke folder arsip untuk sinkronisasi otomatis.');
    console.log('   Tekan Ctrl+C untuk menghentikan server.\n');
  });

  // ─── Graceful Shutdown ───────────────────────────────────────────────────
  async function shutdown(signal) {
    console.log(`\n[Server] Menerima sinyal ${signal}, shutdown graceful...`);
    server.close(() => {
      console.log('[Server] HTTP server dihentikan.');
    });
    await stopWatcher();
    closeDb();
    console.log('[Server] Selesai. Sampai jumpa! 👋');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  // Handle uncaught exceptions agar server tidak crash tiba-tiba
  process.on('uncaughtException', (err) => {
    console.error('[Server] Uncaught Exception:', err);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[Server] Unhandled Rejection:', reason);
  });
}

startup();
