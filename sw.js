// Service Worker aplikasi WASIAT.
//
// STRATEGI:
// - Halaman utama (navigasi/index.html): NETWORK-FIRST -- selalu coba ambil versi
//   terbaru dari internet dulu (supaya update aplikasi/fitur baru tidak pernah
//   "macet" di versi lama), baru kalau gagal (offline) baru pakai cache.
// - Aset statis (ikon, manifest): CACHE-FIRST -- supaya aplikasi tetap bisa
//   dibuka & tampil normal walau sedang offline.
// - Data absensi/hafalan/nilai ke Apps Script (script.google.com) TIDAK PERNAH
//   disentuh service worker ini -- selalu langsung ke jaringan, supaya data yang
//   dilihat guru/wali santri selalu yang terbaru, tidak pernah basi dari cache.
//
// Naikkan CACHE_NAME (misal jadi wasiat-v3) setiap kali ingin memaksa semua
// pengguna mengambil ulang seluruh aset statis dari awal.

const CACHE_NAME = 'wasiat-v3';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE_NAME).then(function (c) { return c.addAll(APP_SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  const url = new URL(req.url);

  // Jangan pernah intercept panggilan ke Apps Script -- selalu langsung ke jaringan.
  if (url.hostname.indexOf('script.google.com') !== -1 || url.hostname.indexOf('googleusercontent.com') !== -1) {
    return;
  }
  if (req.method !== 'GET') return;

  // Halaman utama: network-first, supaya pembaruan aplikasi langsung kepakai.
  const isNavigasi = req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html');
  if (isNavigasi) {
    e.respondWith(
      fetch(req).then(function (resp) {
        const salinan = resp.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, salinan); });
        return resp;
      }).catch(function () {
        return caches.match(req).then(function (cached) { return cached || caches.match('/index.html'); });
      })
    );
    return;
  }

  // Aset statis lain (ikon, manifest, dsb): cache-first supaya instan & tetap
  // tampil offline, tapi tetap diperbarui di cache di belakang layar.
  e.respondWith(
    caches.match(req).then(function (cached) {
      const jaringan = fetch(req).then(function (resp) {
        if (resp && resp.status === 200) {
          const salinan = resp.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, salinan); });
        }
        return resp;
      }).catch(function () { return cached; });
      return cached || jaringan;
    })
  );
});
