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

const CACHE_VERSION = 'wasiat-offline-v7'; // diupdate otomatis tiap build
const CACHE_NAME = CACHE_VERSION;
// Cache foto (produk kantin, galeri, logo) SENGAJA tidak diberi nomor versi aplikasi.
// Kalau ikut versi, setiap kali aplikasi diperbarui semua foto akan terhapus dan
// diunduh ulang -- boros kuota dan membuat halaman kasir terasa lambat sesudah tiap
// pembaruan. Isi cache ini aman dipertahankan karena foto yang diganti selalu
// menghasilkan URL baru (ID file Drive-nya berbeda).
const CACHE_IMG = 'wasiat-img-v1';
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
      // Diunduh SATU PER SATU. Sebelumnya memakai cache.addAll(): kalau satu saja berkas
      // (mis. ikon) tidak ada di server, SELURUH pemasangan gagal dan mode offline tidak
      // pernah aktif. Sekarang berkas yang gagal dilewati, sisanya tetap tersimpan.
      return Promise.all(APP_SHELL.map(function(url) {
        return fetch(url, { cache: 'no-cache' }).then(function(res) {
          if (res && res.ok) return cache.put(url, res);
        }).catch(function() { /* lewati berkas yang gagal */ });
      }));
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
          .filter(function(k) { return k !== CACHE_NAME && k !== CACHE_IMG; })
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

  // Foto dari Google Drive (produk kantin, galeri, logo): dilayani dengan strategi
  // cache-first. Foto-foto ini praktis tidak pernah berubah isinya -- kalau Admin
  // mengganti foto, URL-nya ikut berubah karena ID filenya baru. Jadi aman di-cache
  // selamanya, dan ini yang membuat halaman kasir kantin tidak mengunduh ulang foto
  // yang sama setiap kali dibuka. Bonus: foto tetap tampil saat offline.
  if (url.hostname.indexOf('lh3.googleusercontent.com') !== -1 && req.method === 'GET') {
    e.respondWith(
      caches.open(CACHE_IMG).then(function(cache){
        return cache.match(req).then(function(hit){
          if (hit) return hit;
          return fetch(req).then(function(res){
            // Hanya simpan kalau benar-benar berhasil, supaya gambar gagal/rusak
            // tidak ikut tersimpan dan terus tampil rusak.
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          }).catch(function(){
            // Offline dan belum pernah di-cache: biarkan gambar kosong, jangan
            // sampai menggagalkan halaman.
            return new Response('', {status: 504});
          });
        });
      })
    );
    return;
  }

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
    url.hostname.indexOf('jsdelivr.net') !== -1 ||
    url.pathname.indexOf('/push/onesignal/') === 0 ||
    req.method !== 'GET'
  ) return;

  // index.html & navigasi: NETWORK-FIRST
  // Selalu coba ambil versi terbaru, cache sebagai fallback offline
  var isNav = req.mode === 'navigate' ||
              url.pathname === '/' ||
              url.pathname.endsWith('/index.html');

  if (isNav) {
    // Jaringan dulu (supaya selalu versi terbaru), TAPI dengan batas 5 detik bila salinan
    // offline sudah ada. Sebelumnya tanpa batas: di sinyal lemah layar bisa putih lama
    // sebelum akhirnya memakai salinan offline. Unduhan tetap berlanjut di belakang
    // untuk memperbarui salinan.
    function dariCache() {
      return caches.match(req)
        .then(function(c) { return c || caches.match('/index.html'); })
        .then(function(c) { return c || caches.match('/'); });
    }
    var dariJaringan = fetch(req, { cache: 'no-cache' }).then(function(resp) {
      if (resp && resp.status === 200) {
        var salinan1 = resp.clone(), salinan2 = resp.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(req, salinan1);
          // Simpan juga sebagai /index.html supaya alamat dengan parameter apa pun
          // tetap punya cadangan saat offline
          cache.put('/index.html', salinan2);
        });
      }
      return resp;
    });
    e.respondWith(
      dariCache().then(function(cached) {
        if (!cached) return dariJaringan.catch(function() { return new Response('Aplikasi belum pernah dibuka saat online di perangkat ini. Buka sekali dengan internet agar bisa dipakai offline.', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}}); });
        return new Promise(function(resolve) {
          var selesai = false;
          var penanda = setTimeout(function() { if (!selesai) { selesai = true; resolve(cached); } }, 5000);
          dariJaringan.then(function(resp) {
            if (selesai) return;
            selesai = true; clearTimeout(penanda);
            resolve(resp && resp.ok ? resp : cached);
          }).catch(function() {
            if (selesai) return;
            selesai = true; clearTimeout(penanda);
            resolve(cached);
          });
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
          var bolehSimpan = resp && (resp.status === 200 ||
            (resp.type === 'opaque' && /cdnjs\.cloudflare\.com|fonts\.gstatic\.com/.test(url.hostname)));
          if (bolehSimpan) cache.put(req, resp.clone());
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
