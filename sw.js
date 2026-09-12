// Service Worker WASIAT — strategi cache + notifikasi update otomatis
//
// STRATEGI:
// - index.html: NETWORK-FIRST — selalu ambil terbaru, cache sebagai fallback offline
// - Aset statis (ikon, manifest): CACHE-FIRST — instan, update di background
// - Panggilan ke Apps Script: TIDAK di-intercept — selalu langsung ke jaringan
//
// Auto-update: saat versi baru deploy, SW baru aktif & kirim pesan ke semua tab
// supaya user bisa reload tanpa harus tutup browser manual.
//
// CACHE_VERSION diisi otomatis saat build — ubah ini kalau mau paksa re-cache semua.

const CACHE_VERSION = 'wasiat-offline-v3'; // diupdate otomatis tiap build
const CACHE_NAME = CACHE_VERSION;
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-192-maskable.png',
  '/icon-512-maskable.png',
  '/apple-touch-icon.png',
  '/favicon-32.png'
];

// ============ INSTALL ============
// Ambil semua aset shell, lalu langsung aktif (tidak tunggu tab lama ditutup)
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(APP_SHELL);
    })
    // CATATAN: skipWaiting() sengaja TIDAK dipanggil di sini.
    // Kalau dipanggil, versi baru langsung aktif dan memicu controllerchange di tab
    // yang sedang terbuka -> halaman reload paksa. Itu berbahaya untuk guru yang
    // sedang mengisi absensi/hafalan tapi belum menekan Simpan. Sekarang versi baru
    // MENUNGGU sampai user menekan "Perbarui Sekarang" di banner (aplikasi mengirim
    // pesan SKIP_WAITING), jadi reload selalu atas persetujuan user.
  );
});

// ============ ACTIVATE ============
// Hapus cache versi lama, ambil kontrol semua tab yang terbuka
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(k) { return k !== CACHE_NAME; })
          .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim(); // ambil kontrol tab yang sudah terbuka
    }).then(function() {
      // Beritahu semua tab bahwa versi baru sudah aktif → tab bisa tampilkan notif
      return self.clients.matchAll({ type: 'window' }).then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
        });
      });
    })
  );
});

// ============ FETCH ============
self.addEventListener('fetch', function(e) {
  var req = e.request;
  var url = new URL(req.url);

  // Jangan intercept: Apps Script, Google APIs, OneSignal (push), request non-GET
  //
  // OneSignal WAJIB dikecualikan: permintaan ke servernya harus selalu langsung ke
  // jaringan (tidak boleh dijawab dari cache), dan folder /push/onesignal/ adalah
  // wilayah service worker milik OneSignal sendiri -- kalau ikut di-cache di sini,
  // pendaftaran push bisa memakai berkas lama dan notifikasi gagal diterima.
  if (
    url.hostname.indexOf('script.google.com') !== -1 ||
    url.hostname.indexOf('googleusercontent.com') !== -1 ||
    url.hostname.indexOf('googleapis.com') !== -1 ||
    url.hostname.indexOf('onesignal.com') !== -1 ||
    url.pathname.indexOf('/push/onesignal/') === 0 ||
    req.method !== 'GET'
  ) return;

  // index.html & navigasi: NETWORK-FIRST
  // Selalu coba ambil versi terbaru, cache sebagai fallback offline
  var isNav = req.mode === 'navigate' ||
              url.pathname === '/' ||
              url.pathname.endsWith('/index.html');

  if (isNav) {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then(function(resp) {
          // Simpan versi terbaru ke cache untuk offline
          if (resp && resp.status === 200) {
            var salinan = resp.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(req, salinan);
            });
          }
          return resp;
        })
        .catch(function() {
          // Offline: pakai cache
          return caches.match(req).then(function(cached) {
            return cached || caches.match('/index.html');
          });
        })
    );
    return;
  }

  // Aset statis: STALE-WHILE-REVALIDATE
  // Langsung pakai cache (instan), tapi update cache di background
  e.respondWith(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.match(req).then(function(cached) {
        var jaringan = fetch(req).then(function(resp) {
          if (resp && resp.status === 200) {
            cache.put(req, resp.clone());
          }
          return resp;
        }).catch(function() { return cached; });

        return cached || jaringan;
      });
    })
  );
});

// ============ MESSAGE ============
// Terima perintah dari tab (misal: "skipWaiting sekarang")
self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
