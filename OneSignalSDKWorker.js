// Service worker milik OneSignal -- WAJIB ada di hosting (Vercel) supaya push
// notification bisa diterima saat aplikasi sedang tertutup.
//
// PENTING soal penempatan: file ini sengaja diletakkan di folder /push/onesignal/
// dan BUKAN di root. Alasannya, aplikasi WASIAT sudah punya service worker sendiri
// (/sw.js) yang mengurus mode offline. Kalau service worker OneSignal juga dipasang
// di root, keduanya akan berebut cakupan (scope) yang sama dan salah satu bisa
// menonaktifkan yang lain -- akibatnya mode offline ATAU notifikasi jadi mati.
//
// Dengan diletakkan di folder terpisah, OneSignal hanya menguasai /push/onesignal/
// sementara /sw.js tetap menguasai seluruh aplikasi. Keduanya berjalan berdampingan.
//
// Jangan pindahkan atau ganti nama file ini tanpa mengubah juga serviceWorkerPath
// dan serviceWorkerParam di index.html.
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
