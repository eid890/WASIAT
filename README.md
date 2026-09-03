# WASIAT
### Aplikasi Manajemen Pesantren — Pondok Pesantren Wihdatul Ummah Poso

**WASIAT** (Wihdatul Ummah Smart Islamic Administration Technology) adalah aplikasi manajemen pesantren berbasis PWA yang mencakup absensi, hafalan, nilai, pelanggaran, kantin, SPP, modul ajar, jurnal mengajar, dan website publik pesantren.

---

## File dalam Repository ini

| File | Fungsi |
|---|---|
| `index.html` | Seluruh aplikasi frontend |
| `manifest.json` | Konfigurasi PWA |
| `sw.js` | Service Worker (offline support) |
| `vercel.json` | Konfigurasi Vercel |
| `icon-192.png` | Ikon 192×192 |
| `icon-512.png` | Ikon 512×512 |
| `icon-192-maskable.png` | Ikon maskable 192×192 |
| `icon-512-maskable.png` | Ikon maskable 512×512 |
| `apple-touch-icon.png` | Ikon iPhone/iPad |
| `favicon-32.png` | Favicon browser |

> Semua file harus di ROOT repository (tidak dalam folder apapun)

---

## LANGKAH 1 — Buat Apps Script (Backend)

1. Buka script.google.com → New Project → nama: WASIAT Backend
2. Hapus semua isi → tempel isi file Code.gs → Simpan
3. Aktifkan Drive API: klik "+" di Services → Drive API (v2) → Add
4. Deploy → New Deployment → Web App → Execute as: Me → Anyone → Deploy → Authorize → salin URL
5. Run → pilih fungsi setupAwal → jalankan sekali
6. Project Settings → Script Properties → tambah: ANTHROPIC_API_KEY = (API key Anda)

---

## LANGKAH 2 — Upload ke GitHub

1. github.com → New repository → nama: wasiat-app → Create
2. Upload SEMUA 11 file ke root repo (index.html + manifest.json + sw.js + vercel.json + README.md + 6 file .png)
3. Commit changes

---

## LANGKAH 3 — Deploy ke Vercel

1. vercel.com → Sign up with GitHub → Add New → Project → pilih repo → Import → Deploy
2. Dapat URL seperti: https://wasiat-app.vercel.app

---

## LANGKAH 4 — Isi WEBAPP_URL (WAJIB)

Di GitHub, edit index.html, cari:
```
var WEBAPP_URL = "PASTE_URL_WEBAPP_ANDA_DI_SINI";
```
Ganti dengan URL dari Langkah 1 → Commit → Vercel auto-deploy ulang

---

## LANGKAH 5 — Setup Awal di Aplikasi

1. Buka URL Vercel → login Admin → Ringkasan → Perbaiki/Migrasi Skema
2. Isi data: Guru, Santri, Rombel, Halaqoh, Mata Pelajaran, Role Akses

---

## Install di HP

Android: Buka URL → tap "Instal Aplikasi WASIAT"
iPhone: Buka URL di Safari → Share → Add to Home Screen
