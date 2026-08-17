# WASIAT — Aplikasi Absensi & Hafalan Santri
Pondok Pesantren Wihdatul Ummah Poso, Sulawesi Tengah

Folder ini berisi versi **PWA (Progressive Web App)** dari aplikasi WASIAT, siap
di-deploy ke **Vercel** lewat **GitHub** — bisa di-*install* di HP guru dan wali
santri seperti aplikasi biasa, dan tetap bisa dipakai walau sinyal internet
sedang hilang sebentar.

Backend-nya **tetap sama seperti sebelumnya**: Google Apps Script + Google
Sheets. Yang berubah cuma cara aplikasi ini di-hosting (dulu ditempel di widget
Blogger, sekarang jadi website sendiri).

---

## Isi folder ini

| File | Fungsi |
|---|---|
| `index.html` | Aplikasi utamanya (satu file, sama seperti versi Blogger, ditambah dukungan PWA) |
| `manifest.json` | Identitas aplikasi saat di-install: nama **WASIAT**, ikon, warna |
| `sw.js` | Service worker — bikin aplikasi bisa dibuka instan & tetap muncul saat offline |
| `vercel.json` | Pengaturan cache supaya update aplikasi selalu sampai ke pengguna |
| `icon-192.png`, `icon-512.png`, `icon-192-maskable.png`, `icon-512-maskable.png`, `apple-touch-icon.png`, `favicon-32.png` | Ikon aplikasi dari logo pesantren, semuanya **rata sejajar** dengan `index.html` (sengaja TIDAK dimasukkan folder, supaya upload ke GitHub tidak pernah gagal) |

---

## LANGKAH 1 — Simpan ke GitHub

1. Buka [github.com](https://github.com) → login/daftar (gratis).
2. Klik **New repository** → beri nama misal `wasiat-app` → pilih **Private** atau
   **Public** (bebas) → **Create repository**.
3. Di halaman repo kosong itu, klik **uploading an existing file** →
   **pilih SEMUA file sekaligus** (10 file: `index.html`, `manifest.json`, `sw.js`,
   `vercel.json`, `README.md`, dan 6 file ikon `.png`) → drag & drop atau klik
   "choose your files" dan pilih semuanya bersamaan → **Commit changes**.

   ⚠️ **Penting:** semua file harus ada **langsung di halaman utama repo**
   (tidak di dalam folder apapun). Kalau setelah upload Anda lihat ada folder
   seperti `icons/` muncul di repo, berarti prosesnya salah — hapus dan upload
   ulang dengan memilih file .png satu-satu (bukan folder).

*(Kalau sudah terbiasa pakai Git dari komputer, bisa juga `git init`, `git add .`,
`git commit`, `git push` — hasilnya sama saja, dan cara ini pasti tidak ada
masalah struktur folder.)*

---

## LANGKAH 2 — Deploy ke Vercel

1. Buka [vercel.com](https://vercel.com) → **Sign up** → pilih **Continue with GitHub**
   (supaya otomatis tersambung ke akun GitHub Anda).
2. Klik **Add New... → Project**.
3. Pilih repo `wasiat-app` yang tadi dibuat → klik **Import**.
4. Biarkan semua pengaturan default (Vercel otomatis mendeteksi ini situs statis,
   tidak perlu Build Command apapun) → klik **Deploy**.
5. Tunggu ± 30 detik → selesai. Anda akan dapat alamat seperti
   `https://wasiat-app.vercel.app` — inilah alamat aplikasi Anda yang baru.

*(Kalau nanti punya domain sendiri, misal `wasiat.ponpes-wihdatulummah.sch.id`,
bisa dihubungkan lewat menu **Settings → Domains** di Vercel.)*

---

## LANGKAH 3 — Sambungkan ke Apps Script (WAJIB)

1. Buka file `index.html` di GitHub (klik file-nya → ikon pensil untuk edit).
2. Cari baris ini (dekat awal bagian `<script>`):
   ```js
   var WEBAPP_URL = "PASTE_URL_WEBAPP_ANDA_DI_SINI";
   ```
3. Ganti bagian `"PASTE_URL_WEBAPP_ANDA_DI_SINI"` dengan URL Web App Apps Script
   Anda yang sudah pernah di-deploy sebelumnya (yang formatnya
   `https://script.google.com/macros/s/xxxxx/exec`).
4. **Commit changes** langsung di GitHub → Vercel otomatis mendeteksi perubahan
   dan men-deploy ulang sendiri (± 30 detik, tanpa perlu klik apa-apa di Vercel).

---

## Cara pakai fitur PWA (install ke HP)

**Android / Chrome / Edge:**
Buka alamat Vercel Anda di HP → akan muncul tombol mengambang
**"📲 Instal Aplikasi WASIAT"** di pojok kiri bawah → tap → ikon WASIAT
(logo pesantren) muncul di layar utama HP, terbuka seperti aplikasi biasa
(tanpa address bar browser).

**iPhone / Safari:**
iOS tidak mengizinkan tombol install otomatis dari browser (batasan Apple,
bukan batasan aplikasi ini). Caranya manual tapi tetap mudah:
Buka alamat Vercel di Safari → tombol **Share/Bagikan** (kotak dengan panah
ke atas) → **Add to Home Screen / Tambah ke Layar Utama** → selesai, ikon
WASIAT muncul di HP.

---

## Cara kerja mode offline & auto-sinkron

- **Tampilan aplikasi** (halaman, tombol, menu) disimpan otomatis di HP setelah
  dibuka pertama kali — jadi walau sinyal hilang, aplikasi tetap bisa dibuka
  (bukan layar putih/error).
- **Isi Absensi, Isi Hafalan, dan Input Nilai** tetap bisa disimpan walau
  sedang offline — datanya disimpan sementara di HP, muncul lencana kuning
  mengambang **"X data belum tersinkron"** di pojok kanan bawah.
- Begitu HP tersambung internet lagi, data itu **otomatis terkirim sendiri**
  ke Google Sheets tanpa perlu buka ulang aplikasi. Bisa juga tap lencana
  kuning itu untuk memaksa coba kirim ulang sekarang.
- **Yang TIDAK bisa dilakukan offline**: melihat data (riwayat, rekap, rapor,
  saldo kantin, dll) — ini wajar, karena data itu memang tersimpan di Google
  Sheets di internet, bukan di HP, jadi harus online untuk membacanya.

---

## Catatan jujur soal batasan

- Backend Apps Script **tetap butuh internet** untuk membaca/menulis ke Google
  Sheets — tidak ada cara membuat Google Sheets bekerja 100% offline. Yang
  offline hanyalah: (1) tampilan aplikasinya, dan (2) antrian data yang
  *belum sempat* dikirim.
- Widget Blogger versi lama (`Blogger.html`) **masih tetap bisa dipakai**
  kalau Anda mau — tidak wajib pindah semuanya ke Vercel. Tapi untuk fitur
  **install ke HP (PWA)**, itu hanya bisa lewat versi Vercel ini, karena
  Blogger tidak mengizinkan widget menambahkan manifest/service worker.
