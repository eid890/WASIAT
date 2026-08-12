// Service Worker aplikasi WASIAT.
// PRINSIP PENTING:
// - Yang di-cache HANYA "kulit" aplikasi (HTML/CSS/JS/ikon) supaya aplikasi bisa
//   dibuka instan dan tetap muncul walau sedang offline.
// - Data absensi/hafalan/nilai TIDAK PERNAH di-cache di sini -- semua panggilan ke
//   Apps Script (script.google.com / googleusercontent.com) selalu diteruskan
//   langsung ke jaringan, tidak pernah diambil dari cache, supaya data yang dilihat
//   guru/wali santri selalu yang terbaru.
// - Naikkan CACHE_VERSION setiap kali isi index.html/manifest berubah signifikan,
//   supaya pengguna lama otomatis dapat versi terbaru.

const CACHE_VERSION = 'wasiat-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_VERSION; })
            .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  const url = new URL(req.url);

  // Jangan pernah intercept/cache panggilan ke Apps Script (data absensi/hafalan/nilai
  // harus selalu real-time dari jaringan, tidak boleh basi/dari cache).
  if (url.hostname.indexOf('script.google.com') !== -1 || url.hostname.indexOf('googleusercontent.com') !== -1) {
    return;
  }
  // Hanya proses request GET untuk kulit aplikasi (CSS/JS/gambar/HTML sendiri).
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then(function (cached) {
      const jaringan = fetch(req).then(function (resp) {
        if (resp && resp.status === 200) {
          const salinan = resp.clone();
          caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, salinan); });
        }
        return resp;
      }).catch(function () {
        // Offline & tidak ada di cache -> fallback ke index.html (biar app shell tetap muncul)
        return cached || caches.match('/index.html');
      });
      // Strategi: tampilkan cache dulu (kalau ada) supaya instan, tapi tetap perbarui
      // cache di belakang layar dari jaringan (stale-while-revalidate).
      return cached || jaringan;
    })
  );
});
