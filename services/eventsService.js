'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS SERVICE — Hub Server-Sent Events (SSE)
//
// Meneruskan notifikasi perubahan arsip dari watcher ke semua browser
// yang terbuka, sehingga daftar file bisa di-refresh otomatis (realtime)
// tanpa perlu reload manual.
// ─────────────────────────────────────────────────────────────────────────────

const clients = new Set();

// Debounce broadcast: event watcher yang datang bertubi-tubi (misal copy
// banyak file sekaligus) digabung menjadi SATU pesan "archive-change",
// sehingga browser hanya refresh sekali.
let debounceTimer = null;
let pendingChanges = 0;
const DEBOUNCE_MS = 800;

/**
 * Terima koneksi SSE baru dari browser.
 * Dipanggil oleh route GET /api/events.
 */
function addClient(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Event pertama: konfirmasi koneksi terbuka
  res.write('event: connected\ndata: {}\n\n');

  clients.add(res);
  console.log(`[Events] Browser terhubung via SSE (total: ${clients.size})`);

  // Bersihkan client saat koneksi ditutup
  req.on('close', () => {
    clients.delete(res);
    console.log(`[Events] Browser terputus (total: ${clients.size})`);
  });
}

/**
 * Tandai bahwa ada perubahan di arsip. Dipanggil oleh watcherService
 * setelah database selesai di-update. Broadcast di-debounce.
 */
function notifyChange() {
  pendingChanges++;
  if (debounceTimer) return;

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const count = pendingChanges;
    pendingChanges = 0;
    broadcast(count);
  }, DEBOUNCE_MS);
}

/**
 * Kirim event "archive-change" ke semua browser yang terhubung.
 */
function broadcast(changes) {
  if (clients.size === 0) return;

  const payload =
    `event: archive-change\n` +
    `data: ${JSON.stringify({ changes, at: new Date().toISOString() })}\n\n`;

  for (const res of clients) {
    try {
      res.write(payload);
    } catch (err) {
      // Koneksi sudah mati — buang dari daftar
      clients.delete(res);
    }
  }
}

// Keep-alive: komentar ping tiap 25 detik agar koneksi idle tidak
// diputus oleh proxy/perangkat jaringan. `.unref()` agar tidak
// menahan proses server saat shutdown.
setInterval(() => {
  for (const res of clients) {
    try {
      res.write(': ping\n\n');
    } catch (err) {
      clients.delete(res);
    }
  }
}, 25000).unref();

/**
 * Jumlah browser yang sedang terhubung (untuk log/debug).
 */
function clientCount() {
  return clients.size;
}

module.exports = { addClient, notifyChange, clientCount };
