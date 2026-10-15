/**************************************************************
 * APLIKASI ABSENSI & HAFALAN SANTRI - BACKEND (Code.gs) v3 - TAHAP 1
 * Arsitektur: Apps Script Web App (JSON API) + Blogger.html (frontend)
 *
 * CARA DEPLOY:
 * 1. script.google.com -> New project -> paste seluruh isi file ini.
 * 2. Jalankan fungsi setupAwal() SEKALI dari editor (klik Run).
 * 3. Deploy > New deployment > Web app (Execute as: Me, Access: Anyone)
 * 4. Copy URL Web App -> isi ke WEBAPP_URL di Blogger.html
 *
 * PERUBAHAN BESAR DI VERSI INI (sesuai permintaan):
 * - TIDAK ADA LAGI perhitungan kelas/semester otomatis dari tahun masuk.
 *   Kelas 100% manual lewat menu Kelola Rombel / Kelola Halaqoh / Pindah Kelas.
 * - Tahun ajaran BARU otomatis MENYALIN (copy) sheet: Santri, Guru,
 *   MataPelajaran, DaftarKelasRombel, Rombel, Halaqoh, HalaqohAnggota,
 *   RoleAkses dari tahun ajaran yang SEDANG AKTIF saat tombol "Buat
 *   Tahun Ajaran" ditekan.
 * - Sheet Absensi, Hafalan, dan Nilai SELALU dibuat KOSONG di tahun
 *   ajaran baru -- data historis tahun lalu tetap aman & utuh di
 *   spreadsheet lamanya, tidak pernah ikut berubah.
 * - Rombel akademik (sheet Rombel) dan Rombel tahfidz/halaqoh (sheet
 *   Halaqoh + HalaqohAnggota) adalah 2 sistem terpisah. Nama kelas
 *   dan nama halaqoh bebas diberi nama apa saja oleh Admin/Mudir.
 **************************************************************/

const PROP = PropertiesService.getScriptProperties();

// ============================================================
// CACHE RINGAN UNTUK DATA YANG SERING DIBACA, JARANG BERUBAH
//
// Optimasi murni -- tidak mengubah perilaku fitur apa pun. Beberapa data (Pengaturan,
// daftar Slide, daftar Template Flyer) dibaca ulang dari Spreadsheet di HAMPIR SETIAP
// permintaan (Pengaturan misalnya dibaca di nyaris semua halaman), padahal isinya jarang
// berubah -- hanya saat Admin menyimpan sesuatu. CacheService menyimpan salinannya di
// memori selama beberapa menit, jadi permintaan berikutnya tidak perlu membaca ulang
// seluruh sheet dari awal.
//
// Prinsip keamanan yang dijaga ketat di sini:
// 1. Setiap fungsi cache dibungkus try/catch penuh. Kalau CacheService gagal (kuota,
//    data terlalu besar, dll), fungsi mengembalikan null/false secara diam-diam --
//    pemanggilnya lalu membaca Sheet seperti biasa. Caching TIDAK PERNAH bisa membuat
//    fitur berhenti bekerja, paling buruk hanya secepat sebelum ada cache.
// 2. Setiap data yang di-cache PASTI dihapus cache-nya (invalidasi) tepat saat ada
//    fungsi yang menyimpan perubahan pada data itu -- sehingga perubahan Admin selalu
//    terlihat SEKETIKA di permintaan berikutnya, tidak pernah menunggu kedaluwarsa.
// 3. TTL (masa berlaku) di bawah ini hanya jaring pengaman kalau langkah 2 di atas
//    entah bagaimana terlewat -- bukan mekanisme utama.
function cacheAmbil(key) {
  try {
    const teks = CacheService.getScriptCache().get(key);
    return teks ? JSON.parse(teks) : null;
  } catch (e) { return null; }
}
function cacheSimpan(key, data, ttlDetik) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(data), ttlDetik || 300);
  } catch (e) { /* diam-diam gagal -- data tetap benar, hanya tidak ter-cache */ }
}
function cacheHapus(key) {
  try { CacheService.getScriptCache().remove(key); } catch (e) { /* aman diabaikan */ }
}
const MASTER_KEY = 'MASTER_SS_ID';
const AKTIF_KEY  = 'TAHUN_AJARAN_AKTIF_ID'; // ID spreadsheet Absensi semester aktif
const KANTIN_AKTIF_KEY = 'KANTIN_SS_AKTIF_ID'; // ID spreadsheet Kantin semester aktif
const SPP_AKTIF_KEY = 'SPP_SS_AKTIF_ID';       // ID spreadsheet SPP (SATU seumur hidup, tidak per semester)

const SHEET_SANTRI          = 'Santri';
const SHEET_GURU            = 'Guru';
const SHEET_MAPEL           = 'MataPelajaran';
const SHEET_DAFTAR_KELAS    = 'DaftarKelasRombel';
const SHEET_ROMBEL          = 'Rombel';
const SHEET_HALAQOH         = 'Halaqoh';
const SHEET_HALAQOH_ANGGOTA = 'HalaqohAnggota';
const SHEET_ABSENSI         = 'Absensi';
const SHEET_HAFALAN         = 'Hafalan';
const SHEET_PROGRES_HAFALAN_AWAL = 'ProgresHafalanAwal'; // Baseline hafalan sebelum aplikasi digunakan
const SHEET_NILAI           = 'Nilai'; // struktur disiapkan, UI input menyusul Tahap 2
const SHEET_REKAP_NILAI     = 'RekapNilai'; // sheet gabungan nilai semua santri x semua mapel, konek ke Rapor
const SHEET_ROLE            = 'RoleAkses';
const SHEET_PENGGANTIAN     = 'PenggantianGuru'; // catatan guru pengganti per tanggal (transaksional, fresh tiap tahun ajaran)

// ============ MODUL KANTIN (satu database yang sama dengan Absensi -- BUKAN spreadsheet
// terpisah) -- data Santri (Saldo/Limit/PIN Transaksi) menyatu di sheet Santri yang sudah
// ada, supaya tidak ada dua sumber data santri yang bisa tabrakan/beda-beda. ============
const SHEET_BARANG              = 'Barang';               // master jualan per pemilik -- ikut disalin ke tahun ajaran baru (SHEETS_DISALIN)
const SHEET_SALDO_PEMILIK       = 'SaldoPemilik';          // saldo uang pemilik barang -- ikut disalin (TIDAK PERNAH direset, ini uang sungguhan)
const SHEET_TRANSAKSI_KANTIN    = 'TransaksiKantin';       // riwayat belanja -- fresh tiap semester
const SHEET_RIWAYAT_SALDO_PEMILIK = 'RiwayatSaldoPemilik'; // log penarikan saldo pemilik -- fresh tiap semester
const SHEET_PENGAJUAN_TOPUP     = 'PengajuanTopUpSaldo';   // pengajuan tambah saldo santri dari wali -- fresh tiap semester
const SHEET_PENGAJUAN_TARIK     = 'PengajuanPenarikanSaldo'; // pengajuan tarik saldo dari pemilik barang -- fresh tiap semester
const SHEET_PENDAPATAN_PONDOK   = 'PendapatanPondok';      // rekap pendapatan pondok dari kantin (potongan + biaya admin) -- di Kantin SS
const BIAYA_ADMIN_TOPUP_KEY     = 'BIAYA_ADMIN_TOPUP';     // Script Property: nominal biaya admin per top-up (default 0)

// ============ MODUL SPP (satu database yang sama dengan Santri, terhubung via NISN --
// TIDAK ada data santri duplikat di sini, cuma Biaya SPP + status 36 bulan) ============
const SHEET_SPP = 'SPP'; // ikut disalin & TIDAK PERNAH direset -- riwayat SPP berjalan lintas tahun ajaran (3 tahun/36 bulan)
const SHEET_JAM_PELAJARAN   = 'JamPelajaran'; // master jumlah jam per mapel/halaqoh, acuan rekap jam mengajar guru
const SHEET_TAHUN           = 'TahunAjaran';   // hanya di Master -- sekarang menyimpan daftar SEMESTER
// Alias lebih deskriptif (konstanta sama, nama beda supaya kode baru lebih terbaca)
const SHEET_SEMESTER        = 'TahunAjaran';   // sama dengan SHEET_TAHUN, pakai ini di kode baru

const SHEET_PENGATURAN      = 'Pengaturan';    // hanya di Master
const SHEET_SLIDE           = 'Slide';         // hanya di Master -- slide pengumuman di bagian atas aplikasi
const SHEET_PELANGGARAN_SS  = 'PelanggaranSpreadsheet'; // hanya di Master -- daftar spreadsheet Pelanggaran (mirip TahunAjaran)
const SHEET_MODUL_AJAR      = 'ModulAjar';     // hanya di Master -- metadata file modul ajar per mapel + ringkasan AI
const SHEET_RPP_PERTEMUAN   = 'RPPPertemuan';  // hanya di Master -- detail per pertemuan (topik, langkah, media)
const SHEET_JURNAL_MENGAJAR = 'JurnalMengajar';// di spreadsheet Absensi aktif -- jurnal harian guru per sesi mengajar
const SHEET_SOP             = 'SOP';           // hanya di Master -- SOP mengajar & penanganan pelanggaran
const SHEET_KELOMPOK_MAPEL  = 'KelompokMapel'; // hanya di Master -- pengelompokan mapel untuk rapor (A/B/C)
const SHEET_DEFAULT_JURNAL  = 'DefaultJurnal'; // hanya di Master -- teks default jurnal (umum + per mapel)

// ============ KEUANGAN BENDAHARA (semua di Master SS -- lintas tahun ajaran) ============
const SHEET_KAS_UMUM        = 'KasUmum';       // Buku Kas Umum: semua pemasukan & pengeluaran harian
const SHEET_KATEGORI_KAS    = 'KategoriKas';   // Kategori/jenis transaksi (SPP, DSP, Daftar Ulang, dll)
const SHEET_ANGGARAN        = 'Anggaran';       // Pagu anggaran per kegiatan/kategori per periode
const SHEET_TARIF           = 'TarifPembayaran';// Tarif SPP/DSP/DaftarUlang per kelas/angkatan

// Kunci Script Properties untuk spreadsheet terpisah baru
const KEUANGAN_AKTIF_KEY    = 'KEUANGAN_SS_AKTIF_ID'; // spreadsheet Keuangan Bendahara
const SHEET_ARTIKEL         = 'Artikel'; // hanya di Master -- artikel/berita untuk halaman depan (website publik)
const SHEET_FITUR_BERANDA   = 'FiturBeranda'; // hanya di Master -- Program Unggulan & Fasilitas di halaman depan (dengan foto)
const PELANGGARAN_AKTIF_KEY = 'PELANGGARAN_SS_AKTIF_ID';

const HARI_LIST = ['Minggu','Senin','Selasa','Rabu','Kamis',"Jum'at",'Sabtu'];
const STATUS_LIST = ['Hadir','Sakit','Izin','Izin Pulang','Alpa'];
// Tasmi' = memperdengarkan hafalan (biasanya per juz) di hadapan pengampu/penguji.
// Dihitung setoran sah & santri hadir, tapi TIDAK menambah progres halaman baru --
// progres juz tetap hanya dari Sabaq (lihat getProgressHafalan).
const JENIS_HAFALAN_SETOR = ['Sabaq','Sabqi','Manzil','Murojaah','Tahsin',"Tasmi'"];
const JENIS_HAFALAN_NONSETOR = ['Tidak Setor','Izin','Izin Pulang','Sakit','Ghaib'];
// Untuk rekap kehadiran halaqoh: jenis-jenis ini dianggap HADIR (termasuk "Tidak Setor",
// karena santri tetap hadir di halaqoh meski hari itu tidak menyetor hafalan). Hanya
// Izin/Sakit/Ghaib yang dihitung sebagai status tersendiri (bukan Hadir).
const JENIS_HAFALAN_DIANGGAP_HADIR = ['Sabaq','Sabqi','Manzil','Murojaah','Tahsin',"Tasmi'",'Tidak Setor'];

// Logo default pesantren (disematkan langsung di kode supaya selalu tampil di
// setiap laporan PDF tanpa bergantung pada link eksternal yang bisa mati/berubah).
// Bisa diganti nanti lewat menu Admin > Tampilan/Logo (LogoURL) -- kalau LogoURL
// diisi, PDF akan pakai logo dari URL itu; kalau kosong, pakai logo bawaan ini.
const LOGO_DEFAULT_BASE64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBAUEBAYFBQUGBgYHCQ4JCQgICRINDQoOFRIWFhUSFBQXGiEcFxgfGRQUHScdHyIjJSUlFhwpLCgkKyEkJST/2wBDAQYGBgkICREJCREkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCT/wAARCADwAPADASIAAhEBAxEB/8QAHAABAAEFAQEAAAAAAAAAAAAAAAcDBAUGCAEC/8QAThAAAQIEAwQEBg4JAwIHAAAAAQIDAAQFEQchMQYSE0EUIlFxCDJhYoGxFzM0N0JSVXJzkZKhtNIWGCNTVFaTlJUkwdEVQ0SDorLh8PH/xAAbAQEAAQUBAAAAAAAAAAAAAAAABgEDBAUHAv/EADcRAAECAwUFBgQGAwEAAAAAAAEAAgMEEQUhMUFRBhJhgbETcZGhwfAVItHhFBYyNDXxM1JTsv/aAAwDAQACEQMRAD8A6phCEESEIQRIQhBEhCEESEIQRIQhBEhCPh99qWZcffcQ002krWtZslKQLkknQQRHn2pZlbz7iGmm0la1rUEpSkZkknQR9IWlxCVoUFJULhQNwR2xzFiXiVWMYK8jYrYpp12mLXuqUnq9Msc1rPwWRrnrqeQi6woxYqWHVWVsNtyl2XlWHOC08/40meSVHm0dQrlfs0IulIR4haXEJWhQUlQuCDcER7BEhCEESEIQRIQhBEhCEESEIQRIQhBEhCEESEIQRIQhBEhCEESEIQRIQj4eebl2lvPOIbabSVLWs2SkDMkk6CCI881LMreecQ002krWtZslKRmSSdBHM2JeJdXxfrzexOxLbrtNcXurWm6emEarUfgsp1z11PIQxNxMq+LldRsRsS267TXF7i1o6vTSDmpR+CynXPXU8hEyYX4X0vDOjFCCiYqT6QqcnlCxWRnupv4qByHpMEwXuF+GFLwzoxbbKJipPpCpydULFZHwU/FQOQ9Jzi1xZwlp+JVLDrZblazLoPRZu2Shrw121QfrBzHMHXMRsRTV1OUikuESIO688n/vnsHm+vu1uMOMR+icKjVl79hkmXmFn2vsSo/F7Dy7tNubGmBL9vS/TOnvJR0bTShm/wANW7Deyrp91o2FOK9Sw4q6thtuUuy8owvhNPPG6pI8gTzaPI8r9mnSiFpdQlaFBSFAEKSbgjtjQMWcJqdiVSw4gtytZl0Hos3bIjXhrtqg/WNRzBinCrFap4bVdWw23KXZeUYXwmnXs1SR5Anm0dQeXdpqFIl0tCPG3EOoS42pK0KAKVJNwQeYj2CJCEIIkIQgiQhCCJCEIIkIQgiQhCCJCEIIkUjNMA2Lzdx54iqY4y2Zw9mMSsQq9SGKi3IKZdmZniONlYID+7awI+N90EXZHS5f9+19sQ6XL/v2vtiOcf1Tan/Ncp/Zr/PD9U2p/wA1yn9mv88FVdHdLl/37X2xDpcv+/a+2I5x/VNqf81yn9mv88P1Tan/ADXKf2a/zwRdGOT8o02pxyZYQhAKlKU4AEgakm8c14nYm1bFquI2H2Ibdepzq9xa0dUzpGqlH4LKdc9dTyEXH6ptT/muU/s1/niW8MMLaThlSVoaWmaqT4vNzyk7pXb4KR8FA7L56mComF2F1LwyoxQkomKm+kGcniLb1s91N/FQOznqY1PEbEU1ZTlIpDpEkOq88k+3nsHm+vu19xGxGNVU5SKQ6RJA7rz6T7f5o83192sdRLLHsjdpHji/IepXPdo9o9+srKm7M68Bw1OaQhCJOoMpMw5xHMmWqNWXiZfJLEws+19iVH4vYeXdpnsV8J6diVSgtJblaxLoPRZy2RGvDXbVB+sajmDCsSVhziOZEtUasu3lsksTCz7V2JUfi9h5d2kXtex61jwB3j1Cnezm0e7SVmjdkfQ+hWjYV4q1PDOsK2H25Q6xJsr4TbruZkidAT8Jo6gjTu06RROyriErRMMqSoXBCwQRGk4pYT0rEynIK1pk6owP9NPJRvEDmhY+Eg9l8jmOd4o/VNqf81yn9mv88RRdBXR3S5f9+19sQ6XL/v2vtiOcf1Tan/Ncp/Zr/PD9U2p/zXKf2a/zwRdHdLl/37X2xDpcv+/a+2I5x/VNqf8ANcp/Zr/PD9U2p/zXKf2a/wA8EXRwmmCbB5u/zxFWOMdqcPJjDTb6g0mYqLc+p9yWmQ422WwkF/dtYk/F++OzhBUSEIQRIQhBEhCEESEIQRDHNHg/e/NtN9FN/iUx0uY5o8H735tpvopv8SmCqpq2/wBs5jY9qSXLyrUx0lSweIojd3QNLd8ab7NtR+SZT+qqMjjf7mpHz3fUmIliXWVZstGlmxIjak111XOdoLanZaefCgxKNFLqDQcFJPs21H5JlP6qoezbUfkmU/qqiNoRsvg8n/p5n6rS/mS0v+vkPopJ9m2o/JMp/VVGJ2lxQqu0NPMgGWpJpZ/a8FRJcHxbnQeuNMj5DiC4psLSVpAJTfMA6G0emWXKQ3BzWCo714i29aEZhhuiEg43D0C+oR8uuJZQpazupSN490Upya6NJOTSG1P7iN8JTqof/mcZzntaCScFqmQnPIAGJpzVeEY+Wqjs4+0lqQmkMKJJedb3Ra2RF+3uj4k6lMzM8qWXLFtLbjgUsWKSkW3bG973OeVotCZhmlM7sFkGRitrvUFBU3jj9FkgtClKSFJKk6gHMd8e3ztz7Iw6qkaW/OLnpfh79ltBhsqC0i9yVAWvzN9IqB50zqHmSg9OaaLe+nNtKTdd/JZV++PImm4Z6dPfFXDZ7xflS45HAm/hf4KSdnMU6tQKcmRWy1Ott5NqeUQpCfi3Go7OyMp7NtR+SZT+qqIwl5pL8uh9Vm0uE7u8rUXNvrGcVox3WZJxTvlmN+ay225aMBohCIQBdkcOSkn2baj8kyn9VUPZtqPyTKf1VRG0Ip8Hk/8ATzP1VfzJaX/XyH0Uk+zbUfkmU/qqjcsP9tJnbBudXMSjMv0ZSAOGone3gdb90QJEs4H+56x89r1KjW2tZstBlnRIbKG7XULdbP21OzM8yFGiVaa3UGh4KN/CF9+DZj6GV/EqjpcRzR4QvvwbMfQyv4lUdLiIiujJCEIKiQhCCJCEIIkIQgiGOaPB+9+bab6Kb/EpjpcxzR4P3vzbTfRTf4lMFVSTjf7mpHz3fUmIliWsb/c1I+e76kxEsTyw/wBm3n1K5LtT/JP5dAkIR8PvIl2XHnFBKEJKiSbCw8sbYkAVKjzQXGgXrhSG1lV90JJUE62tyjFSDgExJrl3Zicl3mVjiuC6kAEWClc87ixzjyX/AOozsy1PpQltnfIbQ4ndWWzqV+TsSM75xk5WX6K0Ub+8VLU4SBui5PIchGGC6M4OAoB9uq2bg2WhlhIJOWlxGmIuOPBY1miMTEzMOTLb7jBcKmmnlEJuc1HdHInt7IyT0q0+wGFBSWrW3EKKQR2Zcoqwi9Dl2MBAGKxYs5FiODicMOC8UhK0FCkgpItukZWinLpYQkoYbQgNEt2SkC3Mj74TUy1Jy633lbqEDPt7oxFErTMxNTDCwpCn3lON353Ay78otRpqFDishuIq731XqFAiRITntrQe+iztz2xbmQlzMuTIQUvON8IrCj4vkGgivCMpzGuxCxmRHM/SaLHVBl9PRgywh2UY6y2gkKUqwsAAfJ5RmI9p9XYnHS2HCpS1LU2dy3VSQLHsUOYOecZCLKblJRqbaqS2HOM2SkuMpJJBFusBqIxnw3MdvsN2YOnBZsKKyKzsojb6GhGuN/ec1ewixYn1MSaX6opmVU4shKSbWHIHy2F4upZxx5hK3Wg0o8greBHIg+WLzIrXXDFY0SXewEnAGlfpryVSJZwP9z1j57PqVETRLOB/uesfPa9So1tufs3cuoW62W/kofP/AMlRv4QvvwbMfQyv4lUdLiOaPCF9+DZj6GV/EqjpcRA11tIQhBUSEIQRIQhBEhCPFrS0hS1qCUpFyomwA7YIvHHENNqccUlCEjeUpRsABqTHM/g8vNzGMG0bzK0uNuMTS0LSbhSTMpII8ljFTFbFWpYk1dOw2w6HZiUfc4TrrJsZ0jUA8mhqTzt2ayxhPhRT8NKSVLLczWJlA6XN2yA14aOxA+85nkARY/G/3NSPnu+pMRLG+4q7Wye0E9LyMj+0akivefByWo2BCfILa840KOgWPDdDlGNeKG/quQ7Rx4ca0Ij4ZqLh4ABWjtTaamFMlCyEeOQk3T5baqT5Re3OLautPzklwZdhx8L3VoU0tICVDMFV+WmkfNcDkyyejzLQEvdTyLftBoeodUnKwPljLC1hYWHZ2ReIMYvhON3vv/tYoLZcQ47B82hrlTu8sl8s7/Bb4l+Jujev22zj6jxSkoSVrUEpSLlSjYARgZ3aIuBXQ1cJhJsZhSblR7EJ7fKY9TM3Clm1iH6n34LGgS0SYcdwXeSzrjrbQu4tKO86xauVaWQSE7yynxjYAJ7ybWjWkVFxxtangej6FRUeKtXZvf8A0Dsi2W+zNKQ2GnmxcBLbagUg9xGvljRxtoLh2Q8ffvRbWFZDR+upWXrNTRUae6hpF0NrSorCsr300z1jDUzq1CXUkFRSsEC9r2zis+uXDEw2ytwpZQEgFIsesLq11JjL1nYeq7KCnzVSMsWZwkILKyoj9mF5ggfBWMxcXyveNHNTL40yyI+lbupW3lpfcgPDBcPUK8l6/Lv5bigsaoBG8PQbH6ou2ahKvi6XgOVlZRp73RXWkTG9MKULIWbJBJAyJ7x6oqS8+3xBZCku2sl1xw9Y8gu1rjvjcQbeiB27FoVq4llQyKsBHvit0j2NSla1NtvFIUlpwGxZULNKPZ5h7soz9OqzFRCkAFp9Hjsr8Yf8iNzKWpAmTutNDoffktZM2fFgjexCVhl1+TDbLXEWXEqGQIBBuLg6i+RtnYxZylbmZkupcl1pcac3Siw3lr14Qv2Cx3/TzjMxjZ+Vdl51qoybRccNmn202BcTyPoOvaO6LsxDe13asJ4932V2TjQ3M7CI0VvIJ1050p7qsikkpBULG2YvexiWsD/c9Y+ez6lREwvYXFjzHZG84XbXymzk8/KTwCJedKP298m1C4F/Ib68osWvCdElHNYKm7qsjZ6PDg2gx8Q0F/mCFqnhGPNy2LWzj7y0ttNS0stalaJSJhRJPksDHS7Lzcwyh5lxDjTiQtC0G6VJOYII1EaVijhdS8TKMELKJepsJJk55IuUXz3VW8ZB7OWoiG8M8TKvhFXV7E7btutU1te6ha+sZO+ikn4TJ1y01HMRAF19dOQj4ZeamWUPMuIdacSFoWg3SpJzBBGoj7giQhCCJCEeLWltBWtQSlIuSTYAQRFrS2hS1qCUpFySbACOa8V8VqliNV07DbDJdmJV9zguvM5GdPNIPJoalXO3Zr7ixivUcRKsNhthkuzEs+vguvMazquaUnk0OauduzWU8JcJafhtS+K7w5qtTCB0qbtkka8NF9ED7zmeQBF9YTYTU/DWlb7hbmqzMIHSpu2QGvDRfRA+85nkBgcR8RzOF2jUZ3/Ti6ZiYQfbO1KT8XtPPu19xHxH6XxaNRnv2GaZiYQfbO1KT2dp592sZxKrHsilI8cdw9SoBtHtHvVlJU3Zn0HqUizmatKy7bxSsOOsndLV91SjcCwv36xeRY11lyZpEy020XlqRupQBc6i9vLa8SOOXiGSzGhUMlGw3RWtiYEjOmfvRUqG2XmXKg6n9pNr3xvAXSgZIGQ9PpjJxb099uZkmXWmy2gpsEH4NsrfdFSYdLEu66nxkIUod4EUghrIQON1a651XqaLokdwIpfSmmQHLBa5Wqm5Oz4kpdzhstKO+scyNSfIPXGNdnukOBPRmVoB3W0lNiL+UWzMGJKbSw+osO7ykhOmeZufVHsnJTSZltZl3OqSrTsBMQOYjzEeJvOB+Y6ZVoByUohw4MJm62ny+6815NPS2/wQwrcaukbjpGfM5g8/9o9lDKh0ubswC2hS/GSdBly7TFHoM2f/AA7t+6KzMjNJamCZdwXQAMvOEY7e1c/eLfLTkrp3A2m95r4SmX6LMhsvElCQQsC1t4dkXExVp2t1VubqMwt93dS3vEAWSlG6AAMhkBFuJd+XlZpbjK0DhixUOe8I2ja7Z3Z/Z+ap8rSahMzU+tKVzLSyFJQFMpWkghIAN1Ebt1ZAZjSPBB34dRT+yrzWkwohBuHHgtal+iKZeQOkkbm/nujxT/8AJihvyw0YdV85wD1CK8nIzQdzl3AC2sZp80xR6BN/wzv2Yq5sQtBDPL3qrQLN4/N5qs6+24wh5Mq2VJPDXvlSuXVOvZceiPoTz7rXFbUlp5ghV0JAunT7vUY+WZKa4Mwgy7maARlzCh/yYSclNCZQDLubqroVcciLRdaY28KAiugpfrd4rwezAN4uW20qoJqUml+wSsdVaRyUP9ucXnONa2VQ/LzL7Tra0JcbChvC2YNvUY2SJzZsw6PLNe8X58lFp+C2FHLWYYhYei1Ppsw4w5MrdcY3kDdQd1wXuFk6XIIsO+MxGFnJUSVWkFS7wkZd3qupSAEOFOaUHsJBV9UZqLkoXgFj8QVctEQy5sWFcHCtNL6HKmPepEw6xGNJU3SKu6TJE7rL6jmx5D5vq7tNsxQwvpeJtGCFlEvUmElUnPJFygnPdVbxkHmPSIg+JEw6xGNIU3Sau6VSJO608rVjyHzfV3RpLXsferHgC/MeoUo2d2j7OkrNG7I6cDw0OXctGw0xLrGEFdXsTts263TW17qVquoydzktJ+EyrXLTUcxHTTD7Uyy2+w4h1pxIWhaFApUk5ggjURpeJ+GFKxNoobcKGKiykqk55IuUE57qreMg8x6RnEM4bYlVjB+vObFbatOt0xC91K1XV0O5yWg/CZOuWmo5iIkuhYrp2EfDD7U0w2+w4h1pxIWhaFXSpJFwQRqDH3BEJABJNgI5rxbxaqGIFVTsNsPxJiWmHOA68wbKnVc0JPJsWN1c7Hlr0pHP+NGC0xJTS9tdiUOy80yvpEzKy3VUlQz4zVtDzKRrqOYJFv2EeEkhhvTOK7w5qtTKAJmaAySP3bfYkfWTmeQGHxIxGMyXaLR3SGRdExMJPj9qEns7Tz0j7wWxql9vJZFHrC22NoGUXy6qZxI+GjsV2p9Iy0vsRsOBPhysUZoCZ8Z+XQPbfOSPjeTn367OyXS7ZgGPy0rxWi2hZNulCJTHPWnBRBCPSCCQRYiPI6AuRJHw8yh9soXvAdqVFJHcRpH3CKEAihVWuLTUYr4ZZbl2UMtJCG20hKUjkI9eaDzLjRyC0lP1i0fUIpuim7km+d7eretBZbUlEzLLFnEp085Bz+68eSRCZpq+QJ3Se/L/AHjYq5SFqmBUZU7q05uixOnwgBr5RGDeZk0pD7an3GlHLdAG4ewk39Ec+m5GJLRKHBuHEVr/AGpjAmmR2bwz8jp9FZlJSSkixGRitL5tTKe1u/1KEV5lyXcAmUSxIWbL3nD1V+jt1+uPJSYRx0oEsyA4Cgk7x1Fu3ttGG2G1sSm8L+/PksgvJZWnTJUWPaJn5if/AHCEn7pR6fUYqpd35WaTwWm1BAzQmxvvDyxtW1NR2ZnJWiCitSqJplKkzCWJYtpI4abbxIBKt4KuLq5neztAAB0O/wB1K9tbvMiOJpTzuC1GRycKvitLP/pP/MUAMovGZlKZZ5wysuLgNiwIvfM8+wRSDzKjYyiSTl1VqH/MeSxu60b3X6cF5DjvE06Iz1ZaYXyIS2O8m/qEJPqv8Tk0kuH0DL77RWfMsAiVS2+FJVdQQoK65ytpnbT64rs07pJMlJu7zpILxUjJA7LjLL7zF+HAc57WsvI640Vp0UBpLrq9NVebISyt+YmSOqEhoHtOp/2jZYoyco3IyyJdodVA1OqjzJ8pitE9s+V/DS7YRxGPeonPTHbxi8YZKjNyUvPJQiZbDiUK3wCTa9renWK0IRlhoBJAvKxy9xAaTcEhCPpCVLUEpBUpRsABckxVeQKqQsOMQ10pxqjVRanJJaghl05lknRPlT6u6NvxQwvpeJNH4L+7LVKXBMpOhNy2fiq7UHmPSM4s8OsOk0ZLdWqzYVPqF2mVZiXHafO9Ua5jdjajZJtzZ3Z11LtcdG668nrCSB9bh5DlqeQMAtaJAfMEwB36E8F13Z6DNwpQNmj3DMDQ+7umhYY4nVXCXaF7Yja4KVTWX+DdKuIZJZ0KbeM2bg21F7gaiOoEqCgCNDnEHYI4JLpbje121rSnas6eNLSr/WMuTnxHL6uHXPxe/Sco1i3qQhCCKAMacFZiVml7abFIcYm2V9ImZWW6qgoZ8Zq2iuZSNdRzB2fBbGqX28lkUasLbYr7KPmpnEj4aByV2p9Iy0liIBxpwVfYmV7abFNuMTjK+kTMpLdVW8M+M1bRXMpGuozuCRbtiNhwKgHKxRmrTXjPy6R7d5yfO8nPv1iAgpJBFiOUSdgtjUxt1LIo1acbYr7SMj4qZ1I+EnsV2p9Iy0yWI2HIqQcrFHatNjrPsJHt3nJ87yc+/WS2Ra+5SBHN2R04HgoPtHs52lZqVHzZjXiOOoz78YehHpBSSCCCMiDHkS5c9SBISCSQABck8oQyUCNRmDFCg4rxLiFGyXEE9gULxjZ6hNPLU9LkMPLHXBTdtz5yf9xFWaxI2n2SZak52n0Sv0xPVZXUJIKWlPJBUCCLco+5TFjYyobqKvsfN0tRPWfo85cD/wAteURqZtaGXGDNwiKe6jBTWW2aiOhiYkY4IOopyOPRYE0V2VUtTiS20RZbeawsear1XsR5YsTKy9ithEy8E5qFwlSO8AH6xEkyDezG0ZA2b2uknH1aSVVSZR8+QKPVUe6LOtbMv0mZSir0pUq9fqLcQAFHzXE5K9BjGbJyczQS7wDoceX2CszEOek6umYZpqLx9fErR3uE7KvzTDdg4AHbquUL3h9x1+uLSnp351lNibqtYc8jG2TtIlFMPq4awooJNlnO2Yv6Y17ZyUanJ4pdCiEtlQ3VWsch/vGJNWdEhzUKGaVd6G/JW4E5DfAe8VoPoqe626G5RqWdcUi5Vwl3G8ddRoLWvFaVlWC4W5Z1wzBFt8J30tnyEanygZRs7VKk0hLCJffCzZLeat89gTz+qNi/RJ2lSaZqtzVN2akyLpVUHA2tQ81pPWJ8htGY+zYUuQ6ZiAcr+VL+apLxY838srDc7pzJqOS0ST2bdSesvgJORc1cUOwDRI+sxnJaUl6ewGmUJabGZudT2knWK85tzhxRSUtGu7SvJOrYElLq9J68YsY0vF8S+zuw2zso4s2bU82qad+0oiEG05OWNJaGSdT7K2Ttmp2YbvTUUMboL/HDqsilxCzZK0KNr9VQMfUfCJmqzzjk7WptEzPPkFfDQEIbHJCQOQj1Lra1qQlxClo8ZIUCU945RKIL3OYHRBQnJQuZhMZFc2C7eaM9eK+oQj1KVLUEpBUomwAFyTF5Y6JSVqCUgqUTYAC5JiZcOsOk0ZLdWqzYM+RvNMq0lx2nzvVHmHOHQpCW6vV2wZ4jeZZVowO0+d6u+MDjbjY3se05s/s+6l2uups46nrCSB5ntcPIctTyBiFr2v2lYEA3ZnXu4dV0TZzZ3sqTU0PmyGnE8enfh5jbjY3sg05s9s86l2uup3XHU9YSQPrcPIctTyBxuCOCblPcb2v2uaU7VHDxpaVf6xYJz4rl9XDe9j4vfp5glgm5Iut7X7XtKdqbquNLSr/WLJOfFcvq4dQD4uuuk6xG1NkhCEESEIQRIQhBFAWNWCj7cyvbPYttxidaX0iZlJbqqKhnxmraKGpSNdRncHaMD8YDiBKLpFVTuVySa31rSmyJlsEDfHxVXIuPLcdglUxzR4PwtjLtMBl+ym/xKYIt4xjoMjT5uTqUs3wnpwrDwT4qikDrW7c8+2I2iWsb/c1I+e76kxEsT6xXudKMLjXHqVyPaaG2HaMQMFMD4gKjOuPsyjzks1xX0oJbRe28rlGpUasv0acckqgpJsN91DY33OIo3UpR5WGvIZDWNzjC1yioeZceYZBBJdmGWk2XNEDqpv2X1H+8e5+DFJbGhG9uXv3TIq3ZMxAAdLTDbn55191pxOIxWVcbl6hKlKwh+XeT3pWk84wyNiKKkZsvL+c6Yx0jWZyiFyVnWUqLd5mZWHN4ISoDdQkfBN7C0bPIz7FRY40upRAJSpKk2UhQ1BHIxSG+WnCO0aC4ZEX+a9R4U7ZwJgvIhnMG46YcPJYV/YOjupsgTDXzXN77jGUo89tjskwZWlVlqp005KplURxWVDsAN7egiL6EItkSkQfop3XKkvtHaEE/5N4aG/7+axk9tjTU5ztEnKG/brNJUX5Vz5ij1kdx3h5RGIpdcoNLmXt1+ZmA8QpKZZnfc3eSBvWAPlOQ8ukbStKXEFC0pUk6pULg+iKMrT5SRKjKyrLBUbktoAJjHNmRgW7sSoGBIqRXT74LI+Lyb6xIkCjjiGmjXd4pUcsc19NbYbTllTOzVKlNmGnBuqnX1ceecHzyOr3JSIwK9i256ZVN1apz1QmnDdbri+so95ufvjY4RehWNLNO88bx1Ktx9pZ143IRENoyaKfdYIbE0S1ujuny8ZUXlK2fp9GW4uUaUFryK1q3iB2A8hGSteMDVdpW2235enpddmbLQ24lF0cRIuU+UgXMXXwpSWpELQDldfyWPCmLQnqwREc4HGpNOfBXlWrbFLUhpZIWtO8VbwAaTpvm+ufIZmMHs5IuLmZGZbk+BwUr482ld0zgOluZJOZvpHzTpVFYnVdGn3ZlpDKHEzT7QcWw4T1kAqFs9bco2mTlGpCVblmAQ22LC+p8pjGhNfNxRFf+kYYajPliPqBmzESHZ0Ay8O97sa1FxByu1wNdaYE1okrBqiSU7NztRmGuI/JlAZ3tEFQN1W7csuyI1iWcD/c9Y+ez6lRctpxbJvLTp1Cs7Mw2vtGGHCuPkCrXHTF53YOVbolHSo1qea4iXim6ZZskp3x8ZZIIA5WueQOCwSwTclHm9sNr2lvVJ1XHlpWY6ymic+K5fVw6gHxdTnpr3hC+/Bsx9DK/iVR0uIgK66kIQgqJCEIIkIQgiQhCCIY5o8H735tpvopv8SmOlzHNHg/e/NtN9FN/iUwVVJON/uakfPd9SYiWJaxv9zUj57vqTESxPLD/AGbefUrku1P8k/l0CQhCNuo6sZVaG3PhLjKkMPpdS9co3kuqSMt8cxGuTzNYpqlb6n0ocmkuLmWyEh51SgO24QBcDtOsZnaidm5US6JZT7V1b2+2L8Q3tuaHPPescjYiKje0DHB3p5KQ2XltIWE3Cw2LqWRyFwe3lGkmmQIkVzalrhnl78PNSmQiTcKAx+6IjTlmKe8L8MLrrZe0E9IzFRL7LU3JyTm4p1v9msE6JAOSrXAjKmsySJvojjpQ/wBQbqknxli4F+3KKczR5Sepz0uz+xRMLExvoFzv3Ct6x7tIxr+z9QbmGp1t9icmhM9Id4n7JKrJ3UgWva2cXazUE3fMPGl5wz01zWOGyEwPm+R140qQBQnFoqd6uGIWxLWhspC1pTvHdTvG1z2Dyx8dIY3wjjtb5JATvi5I1yjG1mXnJmXp8wmV4j0tMIfcYQsE5A3CScjGCd2fqi92baluHMlcw+hJULoUpSd1J8pG9F2PORWOoyGThrhd5qxKWbAisDokUNN4yxv44XY8Vs5rVNuUidYWoIU5uoVvEpSLk5d0WMxtVKNNyT6GnXJeZ3lKcAtwkJIBUR3mMOnY6b3C2gtslAdShZVpfdKTlyPXB74yreykqClU27xWGi6UtW3UgLIOZvysYxxHnolQGBvsa88lmGVsqCQTEL8buR0zrSl+tVYO1qqKm0qLJKKfNbr5ZV1XG1mybI1ORveM0zRG5evPVJst7rrdikp6yXOaknlcaxboqFJo8gJiQR0lG+mXKmDvLNgbAk62EWiavUZuqIMuhLrEu6Crgq9uYcySrd521JjyxzIZHau33VBFL6Y+nTivb2RYrT+HZ2bKEEm6uBpTI72HeMgVsoASLJAA1sBaEenWPI3Si5KRLOB/uesfPZ9SoiaJZwP9z1j57XqVGptz9m7l1CkGy38lD5/+So38IX34NmPoZX8SqOlxHNHhC+/Bsx9DK/iVR0uIga62kIQgqJCEIIkIQgiQhCCIY5o8H735tpvopv8AEpjpcxzR4P3vzbTfRTf4lMFVSRjf7mpHz3fUmImjonazY2S2vRLInH5hkS5UU8EgXvbW4PZGuewrRP4+o/aR+WJVZlrS8vLthxCaiuXFQC3NnpybnHRoQG6aZ6ABQzCJm9hWifx9R+0j8sPYVon8fUftI/LGf8elNT4LUflK0NB4qGgSNCRGFn9l5SZbf6OVMOu5AklSE3UCoBN8t62don/2FaJ/H1H7SPyxi9o8HEStOVMUWYmZiYb6xZe3TxE9ibAZ+uPDrVkZghj89R65K6ywLVkwYsLK+41rThmoLn5OszE/JTLrTKmpVxvqMOHmrrLseVsrHSMczVa5LOoaWpxKV8VKOKm9g2oqUs383Id0bopKkKKVJKVJNiCLEGPDY6gHvjKfZ5J3mRCD79FgQrYDW9nFgtIHlj35mq1NnaOpmmtzJVLurcsSNxNwN0qJASvrcr6EdkZenVKZqrc4llTCFtlvhL3SU9ZAVcjU6nsi9cpsi6koXJSykkhRBaTYnt0iq2y0ypSm20IUu28Ui17Cwv6I9QZaO0jffUfYrxMz0rEaezhAOywpiD0BC1N2tVTokjMOzyEJmVupXw0hsJKcgN6yjyPKPF06r1N9SC667KKedQHF3CkNrRkRe28nMdxHljb0IS2AlCEpAzASALR9AFRsASTFv4cXf5IhIu9454q8LabD/wAMIA35DMmmAF4F2KwLGzrswSqpvJUkqbVwGSS3dAI56XvoIy8rJy0i3w5ZhDKM8kjy3iVNmMHxPU5M1W35mWdd6yGGrAoT51wc/JyjMewrRP4+o/aR+WMVtpSEu4tbeRnSvms99i2tOMDnCjTlWnl9b1DMImb2FaJ/H1H7SPyw9hWifx9R+0j8sXfj0pqfBY/5StDQeKhmJZwP9z1j57PqVF77CtE/j6j9pH5Y2PZPYyS2QRNJk35h4TJSVcYg23b2tYDtjX2na0vMS7ocMmpplxW3sPZ6clJxkeKBuiueoIUD+EL78GzH0Mr+JVHS4jmjwhffg2Y+hlfxKo6XERZT9IQhBUSEIQRIQhBEhCEEQxyPIUXFHYzbKsVjZ3ZqqIdmX5hsOqkeKlbanSrIHtsDeOuIQRc0fp14QPyHPf4hMP068IH5Dnv8QmOl4QVVzR+nXhA/Ic9/iEw/TrwgfkOe/wAQmOl4QRczL28x/QkrVRJ0JSLk/wDSE6RvODGOLe2tqFtCpqXrqb8NYTuImwNbDksc089RzAmCILxswScn3XNr9kGlNVRtXGmZVjql4jPit20cGth43fqVFuWIuHSaylyrUlsJnwLuspyEwO0ed64htSFIUUrSUqSbEEWIMSHgljaja5tvZ7aF1LVcbG606rqidA9Tg5jnqOYGxYi4dJrSV1akthM+kXdaGQmB2jzvXEksi1+zpAjm7I6fbooTtFs521ZqVHzZjXiOPXvxhiEfS0KbUULSUqSbEEWIPYY8AJNgLmJcud0yQAk2AJMS/hxhyKeG6zWGrzRspiXWPavOUPjeTl36eYcYciQDVZrDP+pICmJdY9q7FKHxuwcu/Swxpxpl9hJZdGo7jb9feR85Mmk/DV2q7E+k5axO2LX36wIBuzOvALoWzmznZ0mpoX5DTieOgy78GNGNbGwTCqRRlNTFfdTc7w3kSaT8JY5qPJPpOWsetbfY+vtIdbos6pC0hSVCkJzB0MZvBXBaYmJlG2u2jbj848vpEtKzPWVvHPjO31UdQk6anOwE/wARlTlc0fp14QPyHPf4hMP068IH5Dnv8QmOl4QRc0fp14QPyHPf4hMP068IH5Dnv8QmOl4QRcjVKjYpbabX0er7RbNVRbss8w3xEyPCShtLoUbgdlybx1yIQgqJCEIIkIQgiQhCCJCEIIkIQgiQhCCJCEIIkIQgigvG3BFdRdc2u2QaU1VG1caZlWOqXyM+I3bRwa2Hjd+uQwSxtRta23s7tE6lquNjdaeV1ROgepwcxz1HMCZIg3G3BFdTcc2t2RaU1VWzxpmVZ6pfIz4jdtHBa+Xjd+pFuWImHSa0hyq0lsJnwLutDITA7fneuLXDnDjoHDrNZZ/1PjMS6x7V5yh8bsHLv0wmCWNyNq0N7ObRuparjY3WXl9UTgHLyODmOeo5iMhjTjRL7AyiqTSVtv7QPouAc0yaT8NY+N2J9Jy12AtOOIH4et3nTTuWnNhShm/xhb82mVdaa/3ivMacaJfYKVXSKQtt+vvIvn1kyaT8NY5q7E+k5a6rgtgtMTc0jbXbVDj828vpEtKzPWUVHPjO31VzCTpqeQHmC2C8xOzSNtttUOvzTy+kS0rM9ZSlHPjO31PMJOmp5AdAxr1uEhCEESEIQRIQhBEhCEESEIQRIQhBEhCEESEIQRIQhBEhCEESEIQRIQhBEhCEEUHY2YJLqrjm1uyTRaqzR40xKs9UzBGfERbRwWv53frjsF8Fpmem0ba7bNuvTLq+kS0pNXK1KOfGevnfmEnvPIR0FCCJCEIIkIQgiQhCCJCEIIkIQgiQhCCJCEIIv//Z';

// Sheet yang IKUT DISALIN ke tahun ajaran baru (data acuan/master, bukan transaksi harian)
const SHEETS_DISALIN = [SHEET_SANTRI, SHEET_GURU, SHEET_MAPEL, SHEET_DAFTAR_KELAS, SHEET_ROMBEL, SHEET_HALAQOH, SHEET_HALAQOH_ANGGOTA, SHEET_ROLE, SHEET_JAM_PELAJARAN];
const KANTIN_SHEETS_DISALIN = [SHEET_BARANG, SHEET_SALDO_PEMILIK]; // ikut disalin/tidak pernah reset, di spreadsheet Kantin sendiri

function norm(s){ return String(s == null ? '' : s).trim(); }

// ============ ENTRY POINT WEB APP ============
function doGet(e) {
  try {
    const action = e.parameter.action;
    if (!action) {
      return ContentService.createTextOutput(JSON.stringify({ok:true,msg:'API Absensi & Hafalan Santri aktif'}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // Aksi penting tidak boleh dipanggil lewat alamat GET tanpa token
    if (typeof AMAN_ !== 'undefined') { const tolakGet = AMAN_.periksa(action, e.parameter, e.parameter.token); if (tolakGet) return jsonOut(tolakGet); }
    return jsonOut(safeRoute(action, e.parameter));
  } catch (err) {
    return jsonOut({ok:false, error: String(err)});
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    // Modul Persuratan (folder /surat/) memakai jalur sendiri -- fitur WASIAT lain tidak tersentuh
    if (body.modul === 'surat') {
      if (typeof SURAT_ === 'undefined') return jsonOut({ok:false, error:'Modul persuratan belum terpasang di server. Perbarui Code.gs.'});
      return jsonOut(SURAT_.tangani(body));
    }
    // Fitur lanjutan (laporan bulanan, kondisi pondok, peringatan dini, jadwal, kartu, rapor, PPDB)
    if (body.modul === 'premium') {
      if (typeof PRM_ === 'undefined') return jsonOut({ok:false, error:'Fitur ini belum terpasang di server. Perbarui Code.gs.'});
      const hasilPrm = PRM_.tangani(body);
      if (typeof AMAN_ !== 'undefined') AMAN_.catat('premium', body.action, body.payload || {}, body.token, hasilPrm);
      return jsonOut(hasilPrm);
    }
    // Modul Keuangan resmi (kwitansi ber-QR, pengajuan dana, laporan resmi) -- jalur sendiri
    if (body.modul === 'keuangan') {
      if (typeof KEU_ === 'undefined') return jsonOut({ok:false, error:'Modul keuangan belum terpasang di server. Perbarui Code.gs.'});
      const hasilKeu = KEU_.tangani(body);
      if (typeof AMAN_ !== 'undefined') AMAN_.catat('keuangan', body.action, body.payload || {}, body.token, hasilKeu);
      return jsonOut(hasilKeu);
    }
    // Keamanan: aksi penting wajib token sesi (lihat AMAN_). Aksi harian tidak diubah.
    const payloadUtama = body.payload || {};
    if (typeof AMAN_ !== 'undefined') {
      const tolak = AMAN_.periksa(body.action, payloadUtama, body.token);
      if (tolak) return jsonOut(tolak);
      if (body.action === 'cekSesiAktif') payloadUtama._token = String(body.token || '');
    }
    const hasilUtama = body.action === 'getLogAktivitas' && typeof AMAN_ !== 'undefined' ? AMAN_.apiLogAktivitas(payloadUtama) : routeIdempoten_(body.action, payloadUtama);
    if (body.action === 'getMasterData' && typeof AMAN_ !== 'undefined') return jsonOut(AMAN_.saringMaster(payloadUtama.sheet, hasilUtama));
    // Catatan aktivitas: hanya aksi penting yang berhasil (lihat AMAN_.catat)
    if (typeof AMAN_ !== 'undefined') AMAN_.catat('', body.action, payloadUtama, body.token, hasilUtama);
    return jsonOut(hasilUtama);
  } catch (err) {
    return jsonOut({ok:false, error: String(err)});
  }
}

// ======================================================================
// PENCEGAH KIRIMAN GANDA (untuk data yang dikirim dari mode offline)
//
// Di sinyal lemah bisa terjadi: server SUDAH menyimpan data, tapi jawabannya hilang
// di jalan. Aplikasi mengira gagal, lalu mengirim ulang dari antrian. Untuk absensi &
// hafalan aman (datanya ditimpa), tapi pelanggaran/izin/tasmi' akan tercatat dua kali.
//
// Setiap kiriman membawa kunci unik (_idem). Kunci yang sudah pernah BERHASIL diingat
// 6 jam -- kiriman ulang dengan kunci sama langsung dijawab dengan hasil sebelumnya
// tanpa menyimpan lagi. Kiriman TANPA kunci (versi aplikasi lama) diproses seperti biasa.
// ======================================================================
const AKSI_IDEMPOTEN = ['submitAbsensi','submitAbsensiHalaqoh','submitAbsensiHarian','submitHafalan',
  'submitNilai','simpanJurnal','updateAbsensi','updateHafalan','updateNilai',
  'savePencatatanPelanggaran','catatPelanggaranPembina','simpanTugasPembina',
  'ajukanIzinGuru','simpanRiwayatTasmi'];

function routeIdempoten_(action, p) {
  const kunci = norm(p && p._idem);
  if (!kunci || AKSI_IDEMPOTEN.indexOf(action) === -1) return safeRoute(action, p);
  const ck = 'idem_' + kunci.slice(0, 80);
  let cache;
  try { cache = CacheService.getScriptCache(); } catch (e) { return safeRoute(action, p); }

  // Periksa & tandai "sedang diproses" di dalam kunci singkat, supaya dua kiriman
  // yang tiba bersamaan tidak sama-sama lolos.
  const lock = LockService.getScriptLock();
  let terkunci = false;
  try { lock.waitLock(10000); terkunci = true; } catch (e) {}
  try {
    const ada = cache.get(ck);
    if (ada === '__proses__') {
      return {ok:false, error:'Data yang sama sedang diproses server. Akan dicoba lagi otomatis.', _sedangDiproses:true};
    }
    if (ada) {
      try { const lama = JSON.parse(ada); lama._duplikatDiabaikan = true; return lama; } catch (e) {}
    }
    cache.put(ck, '__proses__', 300);
  } catch (e) {
    // CacheService bermasalah: tetap proses seperti biasa daripada menolak data
  } finally {
    if (terkunci) lock.releaseLock();
  }

  const hasil = safeRoute(action, p);
  try {
    if (hasil && hasil.ok) cache.put(ck, JSON.stringify(hasil).slice(0, 90000), 21600);
    else cache.remove(ck); // ditolak -> boleh dikirim ulang setelah diperbaiki
  } catch (e) {}
  return hasil;
}

function safeRoute(action, p) {
  try { return route(action, p); }
  catch (err) { return {ok:false, error: 'Server error: ' + String(err)}; }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function route(action, p) {
  switch (action) {
    case 'login': return apiLogin(p.loginId, p.pin);
    case 'getTahunAjaranList': return {ok:true, data: getTahunAjaranList()};
    case 'createTahunAjaran': return apiCreateTahunAjaran(p.nama);
    case 'setTahunAjaranAktif': return apiSetTahunAjaranAktif(p.id);
    case 'migrasiSkemaLama': return apiMigrasiSkemaLama();

    case 'getPengaturan': return {ok:true, data: getPengaturanPublik_()};
    case 'getVersiData': return apiGetVersiData();
    // Notifikasi push (OneSignal)
    case 'kirimPushManual':      return apiKirimPushManual(p);
    case 'pasangTriggerNotif':   return apiPasangTriggerNotif(p.aktif === true || p.aktif === 'true');
    case 'statusTriggerNotif':   return apiStatusTriggerNotif();
    case 'simpanPengaturan':       return apiSimpanPengaturan(p);
    case 'getPengaturanBatch':     return apiGetPengaturanBatch(p);
    case 'simpanPengaturanBatch':  return apiSimpanPengaturanBatch(p);
    case 'getSlideList': return {ok:true, data: getSlideList()};
    case 'getSlideAktif': return {ok:true, data: getSlideAktifUntukRole(p.level)};
    case 'saveSlide': return apiSaveSlide(p);
    case 'deleteSlide': return apiDeleteSlide(p);
    case 'uploadSlideImage': return apiUploadSlideImage(p);
    case 'uploadFileKeDrive': return apiUploadFileKeDrive(p);
    case 'getArtikelList': return {ok:true, data: getArtikelList(p.hanyaPublished)};
    case 'saveArtikel': return apiSaveArtikel(p);
    case 'deleteArtikel': return apiDeleteArtikel(p);
    case 'getFiturBerandaList': return {ok:true, data: getFiturBerandaList()};
    case 'saveFiturBeranda': return apiSaveFiturBeranda(p);
    case 'deleteFiturBeranda': return apiDeleteFiturBeranda(p);
    // Modul Ajar
    case 'getModulAjarList': return {ok:true, data: getModulAjarList(p.mapel, p.kelas)};
    case 'saveModulAjar': return apiSaveModulAjar(p);
    case 'deleteModulAjar': return apiDeleteModulAjar(p);
    case 'prosesTeksModulAjar': return apiProsesTeksModulAjar(p);
    // RPP Pertemuan
    case 'getRPPList': return {ok:true, data: getRPPList(p.mapel, p.kelas)};
    case 'saveRPP': return apiSaveRPP(p);
    case 'deleteRPP': return apiDeleteRPP(p);
    case 'getRPPSebelahnya': return {ok:true, data: getRPPSebelahnya(p.mapel, p.kelas, Number(p.noPertemuan), p.arah)};
    // Jurnal Mengajar
    case 'getJurnalHariIni': return {ok:true, data: getJurnalHariIni(p.tanggal, p.pengampu)};
    case 'getJurnalGuru': return {ok:true, data: getJurnalGuru(p.pengampu, p.tglMulai, p.tglAkhir)};
    case 'getRekapJurnalAdmin': return {ok:true, data: getRekapJurnalAdmin(p.tglMulai, p.tglAkhir, p.pengampu, p.mapel)};
    case 'getStatusJurnalHariIni': return {ok:true, data: getStatusJurnalHariIni()};
    case 'tambahSaldoSantriManual': return apiTambahSaldoSantriManual(p);
    case 'tarikSaldoSantriBendahara': return apiTarikSaldoSantriBendahara(p);
    case 'getBiayaAdminTopup': return {ok:true, data: getBiayaAdminTopup()};
    case 'setBiayaAdminTopup': return apiSetBiayaAdminTopup(p);
    case 'getRekapPendapatanPondok': return {ok:true, data: getRekapPendapatanPondok(p.tglMulai, p.tglAkhir, p.jenis)};
    case 'get5TransaksiTerbaruSantri': return {ok:true, data: get5TransaksiTerbaruSantri(p.nisn)};
    case 'getAllTransaksiSantri': return {ok:true, data: getAllTransaksiSantri(p.nisn, p.tglMulai, p.tglAkhir)};
    case 'getRiwayatMutasiSaldoSantri': return {ok:true, data: getRiwayatMutasiSaldoSantri(p.nisn, p.tglMulai, p.tglAkhir)};
    case 'getRiwayatMutasiSaldoAdmin':  return {ok:true, data: getRiwayatMutasiSaldoAdmin(p.tglMulai, p.tglAkhir)};
    case 'getNotifBadge': return {ok:true, data: getNotifBadge()};
    // Keuangan Bendahara
    case 'getDashboardKeuangan': return {ok:true, data: getDashboardKeuangan(p.bulan, p.tahun)};
    case 'getKasUmumList': return {ok:true, data: getKasUmumList(p.bulan, p.tahun, p.kategori)};
    case 'tambahTransaksiKas': return apiTambahTransaksiKas(p);
    case 'hapusTransaksiKas': return apiHapusTransaksiKas(p);
    case 'getKategoriKasList': return {ok:true, data: getKategoriKasList()};
    case 'saveKategoriKas': return apiSaveKategoriKas(p);
    case 'deleteKategoriKas': return apiDeleteKategoriKas(p);
    case 'getAnggaranList': return {ok:true, data: getAnggaranList(p.tahun)};
    case 'saveAnggaran': return apiSaveAnggaran(p);
    case 'deleteAnggaran': return apiDeleteAnggaran(p);
    case 'getTarifList': return {ok:true, data: getTarifList()};
    case 'saveTarif': return apiSaveTarif(p);
    case 'deleteTarif': return apiDeleteTarif(p);
    case 'getLaporanBulanan': return {ok:true, data: getLaporanBulanan(p.tahun)};
    case 'getBKUBulanan': return {ok:true, data: getBKUBulanan(p.bulan, p.tahun)};
    case 'getRekapSPPBendahara': return {ok:true, data: getRekapSPPBendahara(p.kelas)};
    case 'getTunggakanSantri': return {ok:true, data: getTunggakanSantri()};
    case 'kirimTagihanSppSatuSantri': return apiKirimTagihanSppSatuSantri(p);
    case 'kirimTagihanSppMassal': return apiKirimTagihanSppMassal();
    case 'simpanJurnal': return apiSimpanJurnal(p);
    case 'getDefaultJurnal': return {ok:true, data: getDefaultJurnal(p.mapel)};
    case 'getDefaultJurnalList': return {ok:true, data: getDefaultJurnalList()};
    case 'saveDefaultJurnal': return apiSaveDefaultJurnal(p);
    case 'deleteDefaultJurnal': return apiDeleteDefaultJurnal(p);
    // SOP
    case 'getSOPList': return {ok:true, data: getSOPList(p.kategori)};
    case 'saveSOP': return apiSaveSOP(p);
    case 'deleteSOP': return apiDeleteSOP(p);
    case 'getBarangList': return {ok:true, data: getBarangList()};
    case 'saveBarang': return apiSaveBarang(p);
    case 'deleteBarang': return apiDeleteBarang(p);
    case 'getBarangSaya': return {ok:true, data: getBarangSaya(p.pemilik)};
    case 'saveBarangSaya': return apiSaveBarangSaya(p);
    case 'deleteBarangSaya': return apiDeleteBarangSaya(p);
    case 'getPersenPotonganKantin': return {ok:true, persen: persenPotonganKantin()};
    // Kas Kelas (wali kelas)
    case 'terimaKasKelas':          return apiTerimaKasKelas(p);
    case 'catatPengeluaranKasKelas': return apiCatatPengeluaranKasKelas(p);
    case 'getRekapKasKelas':        return apiGetRekapKasKelas(p);
    case 'hapusKasKelas':           return apiHapusKasKelas(p);
    // Flyer Tasmi' Hafalan
    case 'getTemplateFlyer':   return apiGetTemplateFlyer();
    case 'saveTemplateFlyer':  return apiSaveTemplateFlyer(p);
    case 'hapusTemplateFlyer': return apiHapusTemplateFlyer(p);
    case 'gambarKeBase64':     return apiGambarKeBase64(p);
    case 'getSantriUntukFlyer': return apiGetSantriUntukFlyer(p);
    // Riwayat Tasmi'
    case 'simpanRiwayatTasmi': return apiSimpanRiwayatTasmi(p);
    case 'getRiwayatTasmi':    return apiGetRiwayatTasmi(p);
    case 'hapusRiwayatTasmi':  return apiHapusRiwayatTasmi(p);
    // Laporan wali santri
    case 'getKehadiranHarianSantri':  return apiGetKehadiranHarianSantri(p);
    case 'getKetidakhadiranMapel':    return apiGetKetidakhadiranMapel(p);
    case 'getRiwayatHafalanBulan':    return apiGetRiwayatHafalanBulan(p);
    // Perbaikan kolom Kategori
    case 'cekKategoriKosong':        return apiCekKategoriKosong(p);
    case 'perbaikiKategoriTransaksi': return apiPerbaikiKategoriTransaksi(p);
    case 'getDiagnostikUkuranData': return apiGetDiagnostikUkuranData(p);
    case 'getInfoLayarMasjid': return apiGetInfoLayarMasjid(p);
    case 'loginImamMasjid': return apiLoginImamMasjid(p);
    case 'tarikSaldoPemilikManual': return apiTarikSaldoPemilikManual(p);
    case 'getDaftarSaldoPemilik': return apiGetDaftarSaldoPemilik();
    case 'kirimPushUji': return apiKirimPushUji(p);
    case 'cekStatusWablas': return apiCekStatusWablas(p);
    case 'kirimWATes': return apiKirimWATes(p);
    case 'getInfoPengaturanWA': return apiGetInfoPengaturanWA(p);
    // Kehadiran mengajar guru, izin, dan SP
    case 'getRekapKehadiranGuru': return apiGetRekapKehadiranGuru(p);
    case 'getNotifKehadiranGuru': return apiGetNotifKehadiranGuru(p);
    case 'getKehadiranSaya':      return apiGetKehadiranSaya(p);
    case 'ajukanIzinGuru':        return apiAjukanIzinGuru(p);
    case 'getIzinGuru':           return apiGetIzinGuru(p);
    case 'prosesIzinGuru':        return apiProsesIzinGuru(p);
    case 'batalkanIzinGuru':      return apiBatalkanIzinGuru(p);
    case 'lampirkanBuktiIzin':   return apiLampirkanBuktiIzin(p);
    case 'getTiketSusulan':      return apiGetTiketSusulan(p);
    case 'getDaftarSP':           return apiGetDaftarSP(p);
    case 'terbitkanSP':           return apiTerbitkanSP(p);
    case 'batalkanSP':            return apiBatalkanSP(p);
    case 'tandaiSPDibaca':        return apiTandaiSPDibaca(p);
    case 'getLiburPondok':        return apiGetLiburPondok();
    case 'simpanLiburPondok':     return apiSimpanLiburPondok(p);
    case 'hapusLiburPondok':      return apiHapusLiburPondok(p);
    case 'getSantriUntukTransaksiKantin': return {ok:true, data: getSantriUntukTransaksiKantin()};
    case 'prosesTransaksiKantin': return apiProsesTransaksiKantin(p);
    case 'getRiwayatTransaksiPemilik': return {ok:true, data: getRiwayatTransaksiPemilik(p.pemilik, p.tglMulai, p.tglAkhir)};
    case 'getRiwayatSaldoPemilikSaya': return {ok:true, data: getRiwayatSaldoPemilikSaya(p.pemilik)};
    case 'setLimitHarianSantri': return apiSetLimitHarianSantri(p);
    case 'setLimitHarianAdmin': return apiSetLimitHarianSantri(p);
    case 'getSaldoPemilikSaya': return {ok:true, data: getSaldoPemilikSaya(p.pemilik)};
    case 'ajukanPenarikanSaldo': return apiAjukanPenarikanSaldo(p);
    case 'getSppList': return {ok:true, data: getSppList()};
    case 'setBiayaSpp': return apiSetBiayaSpp(p);
    case 'setBebasSpp': return apiSetBebasSpp(p);
    case 'toggleSppBulan': return apiToggleSppBulan(p);
    case 'importSpp': return apiImportSpp(p);
    case 'getRiwayatPenarikanSaya': return {ok:true, data: getRiwayatPenarikanSaya(p.pemilik)};
    case 'getSemuaPengajuanTarik': return {ok:true, data: getSemuaPengajuanTarik(p.hanyaPending)};
    case 'getSemuaPengajuanTopUp': return {ok:true, data: getSemuaPengajuanTopUp(p.hanyaPending)};
    case 'setujuiPenarikan': return apiSetujuiPenarikan(p);
    case 'tolakPenarikan': return apiTolakPenarikan(p);
    case 'setujuiTopUp': return apiSetujuiTopUp(p);
    case 'tolakTopUp': return apiTolakTopUp(p);
    case 'getSaldoSantriKantin': return {ok:true, data: getSaldoSantriKantin(p.nisn)};
    case 'getRiwayatTransaksiSantriKantin': return {ok:true, data: getRiwayatTransaksiSantriKantin(p.nisn, p.tglMulai, p.tglAkhir)};
    case 'ajukanTopUpSaldo': return apiAjukanTopUpSaldo(p);
    case 'getSppSaya': return {ok:true, data: getSppSaya(p.nisn)};
    case 'validasiPinTransaksiSantri': return apiValidasiPinTransaksiSantri(p);
    case 'validasiPinPengguna': return apiValidasiPinPengguna(p);
    case 'gantiPinTransaksiSantri': return apiGantiPinTransaksiSantri(p);
    case 'getPelanggaranSSList': return {ok:true, data: getPelanggaranSSList()};
    case 'buatPelanggaranSSBaru': return apiBuatPelanggaranSSBaru(p.nama);
    case 'setPelanggaranSSAktif': return apiSetPelanggaranSSAktif(p.id);
    case 'getMasterPelanggaran': return {ok:true, data: getMasterPelanggaranList(p.pelanggaranSSId)};
    case 'getMasterPrestasi': return {ok:true, data: getMasterPrestasiList(p.pelanggaranSSId)};
    case 'saveMasterPelPrestasi': return apiSaveMasterPelPrestasi(p);
    case 'deleteMasterPelPrestasi': return apiDeleteMasterPelPrestasi(p);
    case 'savePencatatanPelanggaran': return apiSavePencatatanPelanggaran(p);
    case 'getRekapPoinSantri': return {ok:true, data: getRekapPoinSantri(p.bulan, p.tahun, p.pelanggaranSSId)};
    case 'getRiwayatPelanggaranSantri': return {ok:true, data: getRiwayatPelanggaranSantri(p.nisn, p.pelanggaranSSId)};
    case 'resetPoinSatuSantri': return apiResetPoinSatuSantri(p);
    case 'resetSemuaPoinSantri': return apiResetSemuaPoinSantri();

    // ---- Jadwal & Absensi Akademik ----
    case 'getJadwalGuru': return {ok:true, data: getJadwalGuruHariIni(p.pengampu)};
    case 'getSantriDiajarGuru': return {ok:true, data: getSantriDiajarGuru(p.pengampu)};
    case 'getJadwalSantri': return {ok:true, data: getJadwalSantri(p.nisn)};
    case 'getSantriUntukAbsen': return apiGetSantriUntukAbsen(p.kelas);
    case 'submitAbsensi': return apiSubmitAbsensi(p);
    case 'submitAbsensiHalaqoh': return apiSubmitAbsensiHalaqoh(p);
    case 'getSantriHalaqohByGender': return {ok:true, data: getSantriHalaqohByGender(p.namaHalaqoh, p.gender)};
    case 'getRekapAbsensiHalaqoh': return {ok:true, data: getRekapAbsensiHalaqoh(p.namaHalaqoh, p.waktuHalaqoh, p.tglMulai, p.tglAkhir, p.gender)};
    case 'getRekapSemuaHalaqoh': return {ok:true, data: getRekapSemuaHalaqoh(p.waktuHalaqoh, p.tglMulai, p.tglAkhir)};
    case 'getDataRaporHalaqoh': return {ok:true, data: getDataRaporHalaqoh(p.nisn, p.tglMulai, p.tglAkhir)};
    case 'getRekapAbsensiGuru': return {ok:true, data: getRekapAbsensiGuru(p.pengampu, p.mapel, p.tglMulai, p.tglAkhir)};
    case 'getRekapHafalanHalaqoh': return {ok:true, data: getRekapHafalanHalaqoh(p.namaHalaqoh, p.tglMulai, p.tglAkhir)};
    case 'getRingkasanHalaqohHariIni': return {ok:true, data: getRingkasanHalaqohHariIni(p.namaHalaqoh, p.waktu)};
    case 'getSantriHalaqohGuru': return {ok:true, data: getSantriHalaqohGuru(p.pengampu)};
    case 'getRiwayatMapel': return {ok:true, data: getRiwayatAbsensi(p)};
    case 'updateAbsensi': return apiUpdateAbsensi(p);
    case 'deleteAbsensi': return apiDeleteAbsensi(p);
    case 'getRekapSantri': return {ok:true, data: getRekapSantri(p.nisn, p.tahunAjaranId)};
    case 'getNotifikasiMingguan': return {ok:true, data: getNotifikasiMingguan(p.nisn, p.tahunAjaranId)};
    case 'getRekapGuruBulanan': return {ok:true, data: getRekapGuruBulanan(p.bulan, p.tahun)};
    case 'getAbsensiGuruPerMapel': return {ok:true, data: getAbsensiGuruPerMapel(p.bulan, p.tahun)};
    case 'getRekapJamMengajarGuru': return {ok:true, data: getRekapJamMengajarGuru(p.pengampu, p.bulan, p.tahun, p.tahunAjaranId)};
    case 'getDaftarPenggantian': return {ok:true, data: getDaftarPenggantian(p.tahunAjaranId)};
    case 'tambahPenggantian': return apiTambahPenggantian(p);
    case 'hapusPenggantian': return apiHapusPenggantian(p);

    case 'getDashboardAdmin': return {ok:true, data: getDashboardAdmin()};
    case 'getMasterData': return {ok:true, data: getMasterData(p.sheet)};
    case 'saveMasterRow': return apiSaveMasterRow(p);
    case 'deleteMasterRow': return apiDeleteMasterRow(p);

    // ---- ROMBEL AKADEMIK ----
    case 'getDaftarKelasRombel': return {ok:true, data: getDaftarKelasRombel()};
    case 'getDetailRombel': return {ok:true, data: getDetailRombel(p.kelas)};
    case 'buatRombelBaru': return apiBuatRombelBaru(p);
    case 'hapusRombel': return apiHapusRombel(p);
    case 'editWaliKelas': return apiEditWaliKelas(p);
    case 'tambahSantriKeRombel': return apiTambahSantriKeRombel(p);
    case 'pindahSantriRombel': return apiPindahSantriRombel(p);
    case 'hapusSantriDariRombel': return apiHapusSantriDariRombel(p);
    case 'getSantriBelumPunyaRombel': return {ok:true, data: getSantriBelumPunyaRombel()};

    // ---- HALAQOH TAHFIDZ ----
    case 'getHalaqohList': return {ok:true, data: getHalaqohList()};
    case 'getDetailHalaqoh': return {ok:true, data: getDetailHalaqoh(p.namaHalaqoh)};
    case 'buatHalaqohBaru': return apiBuatHalaqohBaru(p);
    case 'editHalaqoh': return apiEditHalaqoh(p);
    case 'hapusHalaqoh': return apiHapusHalaqoh(p);
    case 'tambahSantriKeHalaqoh': return apiTambahSantriKeHalaqoh(p);
    case 'pindahSantriHalaqoh': return apiPindahSantriHalaqoh(p);
    case 'hapusSantriDariHalaqoh': return apiHapusSantriDariHalaqoh(p);
    case 'getSantriBelumPunyaHalaqoh': return {ok:true, data: getSantriBelumPunyaHalaqoh()};
    case 'getHalaqohGuru': return {ok:true, data: getHalaqohGuru(p.pengampu, p.waktu)};

    // ---- HAFALAN ----
    case 'getSantriUntukHafalan': return apiGetSantriUntukHafalan(p.namaHalaqoh, p.waktu, p.tanggal, p.pengampu);
    case 'submitHafalan': return apiSubmitHafalan(p);
    case 'getRiwayatHafalan': return {ok:true, data: getRiwayatHafalan(p)};
    case 'getRiwayatAbsensiSantri': return apiGetRiwayatAbsensiSantri(p);
    case 'updateHafalan': return apiUpdateHafalan(p);
    case 'deleteHafalan': return apiDeleteHafalan(p);
    case 'pindahSesiHafalan': return apiPindahSesiHafalan(p);
    case 'getRiwayatPindahSesi': return apiGetRiwayatPindahSesi(p);
    case 'getRekapHafalanSantri': return {ok:true, data: getRekapHafalanSantri(p.nisn, p.tahunAjaranId)};
    case 'getRekapKehadiranHalaqoh': return {ok:true, data: getRekapKehadiranHalaqoh(p.nisn, p.tahunAjaranId)};
    case 'getGrafikHafalanSantri': return {ok:true, data: getGrafikHafalanSantri(p.nisn, p.tanggalMulai, p.tanggalAkhir, p.tahunAjaranId)};
    case 'getOpsiRekapHafalanBulanan': return apiGetOpsiRekapHafalanBulanan(p);
    case 'getRekapHafalanBulanan': return apiGetRekapHafalanBulanan(p);
    case 'getTargetHafalan': return apiGetTargetHafalan(p);
    case 'simpanTargetHafalan': return apiSimpanTargetHafalan(p);

    // ---- NILAI (UTS/UAS/Tugas/Keterampilan) & RAPOR ----
    case 'getMapelGuru': return {ok:true, data: getMapelGuru(p.pengampu)};
    case 'getRekapSantriGuru': return apiGetRekapSantriGuru(p);
    case 'submitNilai': return apiSubmitNilai(p);
    case 'getRiwayatNilai': return {ok:true, data: getRiwayatNilai(p)};
    case 'updateNilai': return apiUpdateNilai(p);
    case 'deleteNilai': return apiDeleteNilai(p);
    case 'getRekapNilaiSantri': return {ok:true, data: getRekapNilaiSantri(p.nisn, p.tahunAjaranId)};
    case 'getRekapNilaiRapor': return {ok:true, data: getRekapNilaiRapor(p.mapel, p.kelas, p.pengampu)};
    case 'getMapelUntukKelas': return {ok:true, data: getMapelUntukKelas(p.kelas)};
    case 'getRekapAbsensiKelas': return {ok:true, data: getRekapAbsensiKelas(p.kelas, p.mapel, p.tglMulai, p.tglAkhir)};
    case 'getRekapHafalanPerKelas': return {ok:true, data: getRekapHafalanPerKelas(p.kelas)};
    case 'getPelanggaranPerKelas': return {ok:true, data: getPelanggaranPerKelas(p.kelas)};
    // Rapor per santri
    case 'getKelompokMapelList': return {ok:true, data: getKelompokMapelList()};
    case 'saveKelompokMapel': return apiSaveKelompokMapel(p);
    case 'deleteKelompokMapel': return apiDeleteKelompokMapel(p);
    case 'getRaporSantriLengkap': return {ok:true, data: getRaporSantriLengkap(p.nisn, p.kelas)};
    case 'cekSesiAktif': return apiCekSesiAktif(p);
    case 'getDaftarSpreadsheet': return apiGetDaftarSpreadsheet();
    case 'getSantriHarian': return apiGetSantriHarian(p);
    case 'submitAbsensiHarian': return apiSubmitAbsensiHarian(p);
    case 'getRekapAbsensiHarian': return apiGetRekapAbsensiHarian(p);
    case 'getStatusPondok': return apiGetStatusPondok(p);
    case 'getTopSantriBulan': return apiGetTopSantriBulan(p);
    case 'getSantriBeruntun': return apiGetSantriBeruntun(p);
    case 'gantiNisn': return apiGantiNisn(p);
    case 'getRiwayatGantiNisn': return apiGetRiwayatGantiNisn(p);
    case 'penjagaNisn': return apiPenjagaNisn(p);
    case 'prosesMutasiSantri': return apiProsesMutasiSantri(p);
    case 'batalkanMutasi': return apiBatalkanMutasi(p);
    case 'ubahCatatanMutasi': return apiUbahCatatanMutasi(p);
    case 'getRekapMutasi': return apiGetRekapMutasi(p);
    case 'kirimNotifBelanja': return apiKirimNotifBelanja(p);
    case 'versiServer': return apiVersiServer();
    case 'statusKolomNamaSpp': return apiStatusKolomNamaSpp(p);
    case 'siapkanKolomNamaSpp': return apiSiapkanKolomNamaSpp(p);
    case 'getProgressHafalan':      return apiGetProgressHafalan(p);
    case 'getProgressHafalanMassal': return apiGetProgressHafalanMassal(p);
    case 'getProgresAwal':          return apiGetProgresAwal(p);
    case 'simpanProgresAwal':       return apiSimpanProgresAwal(p);
    case 'hapusProgresAwal':        return apiHapusProgresAwal(p);
    // Perizinan santri
    case 'ajukanIzin':          return apiAjukanIzin(p);
    case 'getDaftarIzin':       return apiGetDaftarIzin(p);
    case 'approveIzin':         return apiApproveIzin(p);
    case 'tolakIzin':           return apiTolakIzin(p);
    case 'konfirmasiKembali':   return apiKonfirmasiKembali(p);
    case 'getIzinSantriSaya':   return apiGetIzinSantriSaya(p);
    case 'catatPelanggaranPembina': return apiCatatPelanggaranPembina(p);
    // Tugas Harian Pembina
    case 'getDaftarTugasPembina':   return apiGetDaftarTugasPembina(p);
    case 'simpanTugasPembina':      return apiSimpanTugasPembina(p);
    case 'toggleAktifTugas':        return apiToggleAktifTugas(p);
    case 'hapusTugasPembina':       return apiHapusTugasPembina(p);
    case 'getTugasHariIni':         return apiGetTugasHariIni(p);
    case 'centangTugas':            return apiCentangTugas(p);
    case 'uploadFotoTugas':         return apiUploadFotoTugas(p);
    case 'getRekapTugasPembina':    return apiGetRekapTugasPembina(p);
    case 'getHistoryTugasPembina':  return apiGetHistoryTugasPembina(p);
    case 'getRingkasanTugasPembina': return apiGetRingkasanTugasPembina(p);
    case 'terapkanTugasSK':         return apiTerapkanTugasSK(p);
    case 'getRaporSantri': return {ok:true, data: getRaporSantri(p.nisn, p.tahunAjaranId)};
    case 'refreshRekapNilai': return apiRefreshRekapNilai();

    // ---- SANTRI: manual + import + export ----
    case 'tambahSantriManual': return apiTambahSantriManual(p);
    case 'ubahIdentitasSantri': return apiUbahIdentitasSantri(p);
    case 'ubahProfilGuru': return apiUbahProfilGuru(p);
    case 'importSantriMassal': return apiImportSantriMassal(p);
    case 'getSemuaSantri': return {ok:true, data: getSemuaSantriLengkap()};

    case 'generatePDF': return apiGeneratePDF(p);
    case 'getWaLink': return {ok:true, data: buildWaLink(p.noWa, p.pesan)};

    // ---- SALDO & TRANSAKSI KANTIN ----
    case 'getSaldoSantri': return getSaldoSantri(p.nisn);
    case 'getRiwayatTransaksiSantri': return getRiwayatTransaksiSantri(p);
    case 'getDaftarSheetKantin': return apiGetDaftarSheetKantin(p);

    default: return {ok:false, error:'Aksi tidak dikenal: ' + action};
  }
}

// ============ SETUP AWAL (jalankan manual 1x) ============
function setupAwal() {
  if (PROP.getProperty(MASTER_KEY)) { Logger.log('Master sudah ada: ' + PROP.getProperty(MASTER_KEY)); return; }
  const master = SpreadsheetApp.create('MASTER - Aplikasi Absensi & Hafalan Santri');
  const shTahun = master.getActiveSheet();
  shTahun.setName(SHEET_TAHUN);
  shTahun.appendRow(['Nama Tahun Ajaran','Spreadsheet ID (Absensi)','Aktif','Tanggal Dibuat','Spreadsheet ID (Kantin)','Spreadsheet ID (SPP)','Spreadsheet ID (Pelanggaran)','Folder ID']);
  shTahun.setFrozenRows(1);

  const shPengaturan = master.insertSheet(SHEET_PENGATURAN);
  shPengaturan.appendRow(['Key','Value']);
  shPengaturan.appendRow(['NamaPesantren','Pondok Pesantren Wihdatul Ummah Poso']);
  shPengaturan.appendRow(['LogoURL','']);
  shPengaturan.appendRow(['WarnaTema','#0d9488']);
  shPengaturan.appendRow(['KantinSpreadsheetId','1PaTAnCXt-pTK05V8XmI9DHxPO3dJbbKC7uWzCLTqrRI']);
  shPengaturan.appendRow(['KantinSheetSantri','Data Santri']);
  shPengaturan.appendRow(['KantinSheetTransaksi','transaksi']);
  shPengaturan.appendRow(['IzinkanGantiTanggal','false']);
  shPengaturan.appendRow(['SlideJedaDetik','5']);
  shPengaturan.setFrozenRows(1);

  const shSlide = master.insertSheet(SHEET_SLIDE);
  shSlide.appendRow(['Judul','URL Gambar','Tautan (opsional)','Tampil Untuk','Urutan','Aktif','Tanggal Dibuat']);
  shSlide.setFrozenRows(1);

  const shPelSS = master.insertSheet(SHEET_PELANGGARAN_SS);
  shPelSS.appendRow(['Nama','Spreadsheet ID','Aktif','Tanggal Dibuat']);
  shPelSS.setFrozenRows(1);

  shPengaturan.appendRow(['FonnteToken','']);
  shPengaturan.appendRow(['GrupPengajarWA','']);
  shPengaturan.appendRow(['ModalPoinSantri','25']);
  shPengaturan.appendRow(['DeskripsiSingkat','Pondok Pesantren yang mendidik generasi penghafal Al-Quran dengan akhlak mulia.']);
  shPengaturan.appendRow(['AlamatPesantren','']);
  shPengaturan.appendRow(['NoTeleponPesantren','']);
  shPengaturan.appendRow(['EmailPesantren','']);
  shPengaturan.appendRow(['InfoPPDB','Pendaftaran santri baru dibuka setiap tahun ajaran. Hubungi panitia untuk informasi lebih lanjut.']);
  shPengaturan.appendRow(['LinkPPDBEksternal','']);
  shPengaturan.appendRow(['Visi','Terwujudnya generasi penghafal Al-Quran yang berakhlak mulia dan berwawasan global.']);
  shPengaturan.appendRow(['Misi','Menyelenggarakan pendidikan Islam terpadu yang berorientasi pada mutu, kemandirian, dan pembentukan karakter islami.']);
  shPengaturan.appendRow(['HeroImageURL','']);
  shPengaturan.appendRow(['IkonJadwalSholat','']);
  shPengaturan.appendRow(['IkonAlQuran','']);
  shPengaturan.appendRow(['IkonDzikir','']);
  shPengaturan.appendRow(['TaglineHero','Pendidikan Islam Terpadu']);
  shPengaturan.appendRow(['IkonWhatsApp','']);

  const shArtikel = master.insertSheet(SHEET_ARTIKEL);
  shArtikel.appendRow(['Judul','Konten','Gambar URL','Kategori','Tanggal Publish','Penulis','Status','Waktu Input']);
  shArtikel.setFrozenRows(1);

  const shFitur = master.insertSheet(SHEET_FITUR_BERANDA);
  shFitur.appendRow(['Kategori','Judul','Deskripsi','Gambar URL','Urutan']);
  shFitur.setFrozenRows(1);
  shFitur.getRange(2,1,7,5).setValues([
    ['Program','Tahfidz Al-Quran','Program hafalan Al-Quran terpantau berkelanjutan, dengan pencatatan setoran & progres tiap santri secara berkala.','',1],
    ['Program','Akademik Terpadu','Kurikulum umum & agama seimbang, dibina langsung oleh tenaga pengajar berpengalaman.','',2],
    ['Program','Karakter & Kepemimpinan','Pembinaan akhlak dan kedisiplinan santri secara konsisten menuju generasi berakhlak mulia.','',3],
    ['Fasilitas','Asrama','','',1],
    ['Fasilitas','Masjid','','',2],
    ['Fasilitas','Perpustakaan','','',3],
    ['Fasilitas','Lapangan Olahraga','','',4]
  ]);

  // ---- Administrasi Guru: Modul Ajar, RPP Pertemuan, SOP, Default Jurnal ----
  const shModul = master.insertSheet(SHEET_MODUL_AJAR);
  shModul.appendRow(['ID','Mapel','Kelas','Kurikulum','NamaFile','Kategori','URLAsli','RingkasanAI','IsiLengkap','WaktuUpload','DiuploadOleh']);
  shModul.setFrozenRows(1);

  const shRPP = master.insertSheet(SHEET_RPP_PERTEMUAN);
  shRPP.appendRow(['ID','Mapel','Kelas','Kurikulum','NamaBab','NoPertemuan','TopikPertemuan','AlokasiJP','Pendahuluan','Inti','Penutup','LinkVideo','LinkSlide','LinkBukuAjar','CatatanGuru','WaktuInput','DibuatOleh']);
  shRPP.setFrozenRows(1);

  const shSOP = master.insertSheet(SHEET_SOP);
  shSOP.appendRow(['ID','Judul','Kategori','Isi','Urutan','WaktuInput']);
  shSOP.setFrozenRows(1);
  shSOP.getRange(2,1,2,6).setValues([
    ['SOP001','SOP Mengajar','Mengajar','1. Baca RPP pertemuan hari ini\n2. Siapkan media pembelajaran\n3. Awali dengan doa dan absensi\n4. Sampaikan materi sesuai langkah RPP\n5. Isi jurnal mengajar setelah selesai',1,new Date()],
    ['SOP002','SOP Penanganan Pelanggaran','Pelanggaran','1. Catat pelanggaran di aplikasi segera\n2. Panggil santri untuk klarifikasi\n3. Berikan teguran sesuai bobot pelanggaran\n4. Hubungi wali santri bila perlu\n5. Laporkan ke Mudir bila berulang',1,new Date()]
  ]);

  const shDefJurnal = master.insertSheet(SHEET_DEFAULT_JURNAL);
  shDefJurnal.appendRow(['Mapel','TeksDefault','WaktuUpdate']);
  shDefJurnal.setFrozenRows(1);
  shDefJurnal.appendRow(['__UMUM__','Pembelajaran berlangsung sesuai RPP yang telah disiapkan. Materi disampaikan dengan metode yang sesuai. Santri mengikuti kegiatan pembelajaran dengan tertib dan kondusif. Tujuan pembelajaran tercapai sesuai target.',new Date()]);

  PROP.setProperty(MASTER_KEY, master.getId());

  const folder = DriveApp.createFolder('Tahun Ajaran 2024/2025');

  const idBaru = buatSpreadsheetPertamaDenganDummy('2024/2025');
  daftarkanTahunAjaran('2024/2025', idBaru, true);
  PROP.setProperty(AKTIF_KEY, idBaru);
  refreshRekapNilaiAman();

  const ssKantinBaru = SpreadsheetApp.create('KANTIN - 2024/2025');
  const shBarangAwal = ssKantinBaru.getActiveSheet().setName(SHEET_BARANG);
  shBarangAwal.appendRow(['Nama Barang','Harga','Potongan','Pemilik','No WA Pemilik']);
  shBarangAwal.setFrozenRows(1);
  const shSaldoPemilikAwal = ssKantinBaru.insertSheet(SHEET_SALDO_PEMILIK);
  shSaldoPemilikAwal.appendRow(['Nama Pemilik','No WA','Saldo']);
  shSaldoPemilikAwal.setFrozenRows(1);
  buatSheetKantinKosong(ssKantinBaru);
  const idKantinBaru = ssKantinBaru.getId();
  PROP.setProperty(KANTIN_AKTIF_KEY, idKantinBaru);

  const ssSppBaru = SpreadsheetApp.create('SPP - 2024/2025');
  const shSppAwal = ssSppBaru.getActiveSheet().setName(SHEET_SPP);
  shSppAwal.appendRow(headerSPP());
  shSppAwal.setFrozenRows(1);
  const idSppBaru = ssSppBaru.getId();
  PROP.setProperty(SPP_AKTIF_KEY, idSppBaru);

  const idPelSS = buatSpreadsheetPelanggaranBaru('2024/2025');
  daftarkanPelanggaranSS('Pelanggaran 2024/2025', idPelSS, true);
  PROP.setProperty(PELANGGARAN_AKTIF_KEY, idPelSS);

  // Perbarui baris TahunAjaran dengan ID Kantin/SPP/Pelanggaran/Folder, dan kelompokkan
  // ke-4 spreadsheet ke dalam satu folder Drive yang sama.
  const shTahunUpdate = master.getSheetByName(SHEET_TAHUN);
  shTahunUpdate.getRange(2,5,1,4).setValues([[idKantinBaru, idSppBaru, idPelSS, folder.getId()]]);
  [idBaru, idKantinBaru, idSppBaru, idPelSS].forEach(function(id){
    try { DriveApp.getFileById(id).moveTo(folder); } catch (e) { /* diamkan, tidak boleh gagalkan setup */ }
  });

  Logger.log('Master ID: ' + master.getId());
  Logger.log('Tahun Ajaran 2024/2025 ID: ' + idBaru);
  Logger.log('Kantin SS ID: ' + idKantinBaru);
  Logger.log('SPP SS ID: ' + idSppBaru);
  Logger.log('Pelanggaran SS ID: ' + idPelSS);

  // Setup trigger otomatis pengisian jurnal default (jam 23:00 tiap hari)
  try { setupTriggerJurnalDefault(); Logger.log('Trigger jurnal default: aktif'); }
  catch(e) { Logger.log('Trigger jurnal default: gagal (atur manual jika perlu) -- ' + e.message); }

  // Setup sheet keuangan Bendahara
  setupSheetKeuangan(master);
}

// ============ KEUANGAN BENDAHARA ============
// Prinsip: satu pintu input (KasUmum) → semua laporan terbentuk otomatis.
// KasUmum di Master SS supaya riwayat keuangan tidak hilang saat ganti tahun ajaran.

// ---- HELPER ----
function bulanTahunSkrg() {
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  return { bulan: Number(Utilities.formatDate(now,tz,'M')), tahun: Number(Utilities.formatDate(now,tz,'yyyy')) };
}
function normBulanTahun(bulan, tahun) {
  const bt = bulanTahunSkrg();
  return { bulan: Number(bulan)||bt.bulan, tahun: Number(tahun)||bt.tahun };
}
const BULAN_INDO_KEU = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

// ---- KATEGORI KAS ----
function getKategoriKasList() {
  const sh = getMasterSS().getSheetByName(SHEET_KATEGORI_KAS);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.filter(r => r[0]).map((r,i) => ({
    rowIndex:i+2, id:norm(r[0]), nama:norm(r[1]), jenis:norm(r[2]), keterangan:norm(r[3])
  }));
}
function apiSaveKategoriKas(p) {
  const sh = getMasterSS().getSheetByName(SHEET_KATEGORI_KAS);
  const id = p.id || 'KAT'+Utilities.getUuid().replace(/-/g,'').substring(0,6).toUpperCase();
  const baris = [id, norm(p.nama), norm(p.jenis)||'Pemasukan', norm(p.keterangan)];
  if (p.rowIndex && Number(p.rowIndex)>1) sh.getRange(Number(p.rowIndex),1,1,4).setValues([baris]);
  else sh.appendRow(baris);
  return {ok:true, id:id};
}
function apiDeleteKategoriKas(p) { getMasterSS().getSheetByName(SHEET_KATEGORI_KAS).deleteRow(Number(p.rowIndex)); return {ok:true}; }

// ---- TARIF PEMBAYARAN ----
function getTarifList() {
  const sh = getMasterSS().getSheetByName(SHEET_TARIF);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.filter(r => r[0]).map((r,i) => ({
    rowIndex:i+2, id:norm(r[0]), kelas:norm(r[1]), jenisTarif:norm(r[2]), nominal:Number(r[3])||0, keterangan:norm(r[4])
  }));
}
function apiSaveTarif(p) {
  const sh = getMasterSS().getSheetByName(SHEET_TARIF);
  const id = p.id || 'TRF'+Utilities.getUuid().replace(/-/g,'').substring(0,6).toUpperCase();
  const baris = [id, norm(p.kelas), norm(p.jenisTarif), Number(p.nominal)||0, norm(p.keterangan)];
  if (p.rowIndex && Number(p.rowIndex)>1) sh.getRange(Number(p.rowIndex),1,1,5).setValues([baris]);
  else sh.appendRow(baris);
  return {ok:true, id:id};
}
function apiDeleteTarif(p) { getMasterSS().getSheetByName(SHEET_TARIF).deleteRow(Number(p.rowIndex)); return {ok:true}; }

// ---- KAS UMUM ----
function getKasUmumList(bulan, tahun, kategori) {
  const bt = normBulanTahun(bulan, tahun);
  const sh = getMasterSS().getSheetByName(SHEET_KAS_UMUM);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  return rows.filter(r => r[0]).map((r,i) => ({
    rowIndex:i+2,
    noRef:norm(r[0]), tanggal: r[1] instanceof Date ? Utilities.formatDate(r[1],tz,'yyyy-MM-dd') : norm(r[1]),
    bulan: r[1] instanceof Date ? Number(Utilities.formatDate(r[1],tz,'M')) : 0,
    tahun: r[1] instanceof Date ? Number(Utilities.formatDate(r[1],tz,'yyyy')) : 0,
    jenis:norm(r[2]), kategori:norm(r[3]), uraian:norm(r[4]),
    nominal:Number(r[5])||0, dicatatOleh:norm(r[6]), noKwitansi:norm(r[7]), kelas:norm(r[8])
  })).filter(x => {
    if (x.bulan !== bt.bulan || x.tahun !== bt.tahun) return false;
    if (kategori && x.kategori !== kategori) return false;
    return true;
  }).sort((a,b) => a.tanggal.localeCompare(b.tanggal));
}

function apiTambahTransaksiKas(p) {
  const sh = getMasterSS().getSheetByName(SHEET_KAS_UMUM);
  const tz = Session.getScriptTimeZone();
  const tanggal = norm(p.tanggal) || Utilities.formatDate(new Date(),tz,'yyyy-MM-dd');
  // Bulan yang bukunya sudah ditutup (menunggu/sudah disahkan Mudir) tidak boleh diubah
  if (typeof KEU_ !== 'undefined' && KEU_.bulanTerkunci(tanggal)) return {ok:false, error:'Buku kas bulan ini sudah ditutup (laporan bulan ini atau sesudahnya sudah diajukan/disahkan). Minta Mudir membuka kembali bila perlu koreksi.'};
  // Uang belanja/saldo kantin santri = titipan wali, bukan kas pondok (yang masuk kas hanya keuntungannya)
  if (typeof KEU_ !== 'undefined' && KEU_.uangTitipanSantri(p.kategori, p.uraian)) return {ok:false, error:KEU_.pesanTitipan()};
  // Buat nomor referensi otomatis: REF-YYYYMM-XXXX
  // Urutan diambil dari nomor terbesar yang ada (bukan jumlah baris), supaya tidak
  // pernah sama dengan nomor lama setelah ada transaksi yang dihapus.
  const lastRow = sh.getLastRow();
  let maxUrut = lastRow;
  if (lastRow > 1) sh.getRange(2,1,lastRow-1,1).getValues().forEach(function(r){ const m = String(r[0]).match(/-(\d+)$/); if (m && Number(m[1]) > maxUrut) maxUrut = Number(m[1]); });
  const urut = String(maxUrut + 1).padStart(4,'0');
  const noRef = norm(p.noRef) || ('REF-'+tanggal.substring(0,7).replace('-','')+'-'+urut);
  const noKwitansi = norm(p.noKwitansi) || ('KWT-'+noRef.replace('REF-',''));

  sh.appendRow([noRef, new Date(tanggal), norm(p.jenis)||'Pemasukan', norm(p.kategori),
    norm(p.uraian), Number(p.nominal)||0, norm(p.dicatatOleh), noKwitansi, norm(p.kelas)]);
  return {ok:true, noRef:noRef, noKwitansi:noKwitansi};
}

function apiHapusTransaksiKas(p) {
  if (!p.rowIndex) return {ok:false, error:'rowIndex wajib'};
  const sh = getMasterSS().getSheetByName(SHEET_KAS_UMUM);
  const baris = Number(p.rowIndex);
  let noRef = '';
  if (baris >= 2 && baris <= sh.getLastRow()) {
    const v = sh.getRange(baris, 1, 1, 2).getValues()[0];
    noRef = norm(v[0]);
    // Pengaman: baris yang dimaksud harus sama dengan yang tampil di layar
    if (p.noRef && noRef !== norm(p.noRef)) return {ok:false, error:'Data transaksi sudah berubah. Muat ulang daftar lalu coba lagi.'};
    if (typeof KEU_ !== 'undefined' && KEU_.bulanTerkunci(v[1])) return {ok:false, error:'Buku kas bulan ini sudah ditutup. Minta Mudir membuka kembali bila perlu koreksi.'};
  }
  sh.deleteRow(baris);
  // Kwitansi resmi untuk transaksi ini otomatis berstatus DIBATALKAN (QR ikut menunjukkannya)
  if (noRef && typeof KEU_ !== 'undefined') KEU_.setelahHapusKas(noRef, p.oleh || '');
  return {ok:true};
}

// ---- ANGGARAN KEGIATAN ----
function getAnggaranList(tahun) {
  const sh = getMasterSS().getSheetByName(SHEET_ANGGARAN);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  const th = Number(tahun) || new Date().getFullYear();
  return rows.filter(r => r[0] && (Number(r[4])||0) === th).map((r,i) => ({
    rowIndex:i+2, id:norm(r[0]), namaKegiatan:norm(r[1]), kategori:norm(r[2]),
    pagu:Number(r[3])||0, tahun:Number(r[4])||0, keterangan:norm(r[5])
  }));
}
function apiSaveAnggaran(p) {
  const sh = getMasterSS().getSheetByName(SHEET_ANGGARAN);
  const id = p.id || 'ANG'+Utilities.getUuid().replace(/-/g,'').substring(0,6).toUpperCase();
  const baris = [id, norm(p.namaKegiatan), norm(p.kategori), Number(p.pagu)||0, Number(p.tahun)||new Date().getFullYear(), norm(p.keterangan)];
  if (p.rowIndex && Number(p.rowIndex)>1) sh.getRange(Number(p.rowIndex),1,1,6).setValues([baris]);
  else sh.appendRow(baris);
  return {ok:true, id:id};
}
function apiDeleteAnggaran(p) { getMasterSS().getSheetByName(SHEET_ANGGARAN).deleteRow(Number(p.rowIndex)); return {ok:true}; }

// ---- DASHBOARD KEUANGAN ----
function getDashboardKeuangan(bulan, tahun) {
  const bt = normBulanTahun(bulan, tahun);
  const transaksi = getKasUmumList(bt.bulan, bt.tahun, '');
  let pemasukanBulan=0, pengeluaranBulan=0;
  transaksi.forEach(t => {
    if (t.jenis==='Pemasukan') pemasukanBulan += t.nominal;
    else pengeluaranBulan += t.nominal;
  });

  // Saldo kumulatif (semua transaksi s.d. bulan ini)
  const allSh = getMasterSS().getSheetByName(SHEET_KAS_UMUM);
  let saldoKumulatif = 0;
  if (allSh) {
    const tz = Session.getScriptTimeZone();
    const allRows = allSh.getDataRange().getValues(); allRows.shift();
    allRows.filter(r => r[0]).forEach(r => {
      const tgl = r[1] instanceof Date ? r[1] : new Date(r[1]);
      const bln = tgl.getMonth()+1, thn = tgl.getFullYear();
      if (thn < bt.tahun || (thn===bt.tahun && bln<=bt.bulan)) {
        if (norm(r[2])==='Pemasukan') saldoKumulatif += Number(r[5])||0;
        else saldoKumulatif -= Number(r[5])||0;
      }
    });
  }

  // Ringkasan per kategori bulan ini
  const perKat = {};
  transaksi.forEach(t => {
    if (!perKat[t.kategori]) perKat[t.kategori] = {kategori:t.kategori, jenis:t.jenis, total:0, jumlah:0};
    perKat[t.kategori].total += t.nominal;
    perKat[t.kategori].jumlah++;
  });

  // Anggaran vs realisasi tahun ini
  const anggaranList = getAnggaranList(bt.tahun);
  const realisasiKat = {};
  const allTahun = getMasterSS().getSheetByName(SHEET_KAS_UMUM);
  if (allTahun) {
    const allR = allTahun.getDataRange().getValues(); allR.shift();
    allR.filter(r => r[0]).forEach(r => {
      const thn = r[1] instanceof Date ? r[1].getFullYear() : 0;
      if (thn===bt.tahun) { const k=norm(r[3]); realisasiKat[k]=(realisasiKat[k]||0)+(Number(r[5])||0); }
    });
  }
  const anggaranRealisasi = anggaranList.map(a => ({
    ...a, realisasi:realisasiKat[a.kategori]||0,
    persen: a.pagu>0 ? Math.round(((realisasiKat[a.kategori]||0)/a.pagu)*100) : 0
  }));

  return {
    bulan:bt.bulan, tahun:bt.tahun, namaBulan:BULAN_INDO_KEU[bt.bulan-1],
    pemasukanBulan, pengeluaranBulan, surplusBulan:pemasukanBulan-pengeluaranBulan,
    saldoKumulatif, jumlahTransaksi:transaksi.length,
    perKategori:Object.values(perKat), anggaranRealisasi
  };
}

// ---- LAPORAN BULANAN (semua bulan dalam satu tahun) ----
function getLaporanBulanan(tahun) {
  const th = Number(tahun) || new Date().getFullYear();
  const sh = getMasterSS().getSheetByName(SHEET_KAS_UMUM);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  const perBulan = {};
  for (let i=1;i<=12;i++) perBulan[i] = {bulan:i, namaBulan:BULAN_INDO_KEU[i-1], pemasukan:0, pengeluaran:0};
  rows.filter(r => r[0]).forEach(r => {
    const tgl = r[1] instanceof Date ? r[1] : new Date(r[1]);
    if (tgl.getFullYear()!==th) return;
    const bln = tgl.getMonth()+1;
    if (norm(r[2])==='Pemasukan') perBulan[bln].pemasukan += Number(r[5])||0;
    else perBulan[bln].pengeluaran += Number(r[5])||0;
  });
  let saldoKumulatif = 0;
  return Object.values(perBulan).map(b => {
    saldoKumulatif += b.pemasukan - b.pengeluaran;
    return {...b, surplus:b.pemasukan-b.pengeluaran, saldoKumulatif};
  });
}

// ---- BKU BULANAN (detail untuk cetak) ----
function getBKUBulanan(bulan, tahun) {
  const bt = normBulanTahun(bulan, tahun);
  const transaksi = getKasUmumList(bt.bulan, bt.tahun, '');
  // Saldo awal = kumulatif s.d. bulan sebelumnya
  let saldoAwal = 0;
  const sh = getMasterSS().getSheetByName(SHEET_KAS_UMUM);
  if (sh) {
    const allRows = sh.getDataRange().getValues(); allRows.shift();
    allRows.filter(r => r[0]).forEach(r => {
      const tgl = r[1] instanceof Date ? r[1] : new Date(r[1]);
      const bln = tgl.getMonth()+1, thn = tgl.getFullYear();
      if (thn < bt.tahun || (thn===bt.tahun && bln < bt.bulan)) {
        if (norm(r[2])==='Pemasukan') saldoAwal += Number(r[5])||0;
        else saldoAwal -= Number(r[5])||0;
      }
    });
  }
  let saldoBerjalan = saldoAwal;
  const baris = transaksi.map((t,i) => {
    if (t.jenis==='Pemasukan') saldoBerjalan += t.nominal;
    else saldoBerjalan -= t.nominal;
    return {...t, no:i+1, saldoBerjalan};
  });
  const totalPemasukan = transaksi.filter(t=>t.jenis==='Pemasukan').reduce((s,t)=>s+t.nominal,0);
  const totalPengeluaran = transaksi.filter(t=>t.jenis==='Pengeluaran').reduce((s,t)=>s+t.nominal,0);
  return { bulan:bt.bulan, tahun:bt.tahun, namaBulan:BULAN_INDO_KEU[bt.bulan-1],
    saldoAwal, totalPemasukan, totalPengeluaran, saldoAkhir:saldoAwal+totalPemasukan-totalPengeluaran, baris };
}

// ---- REKAP SPP PER KELAS (untuk Bendahara) ----
function getRekapSPPBendahara(kelas) {
  const sppList = getSppList();
  const filtered = kelas ? sppList.filter(s => {
    // Cek kelas santri dari data Santri (via Rombel)
    return true; // filter di frontend lebih fleksibel
  }) : sppList;
  return filtered.map(s => {
    const due = bulanJatuhTempoSPP(s.tahunMasuk);
    let lunas=0, belum=0, totalTunggakan=0;
    for (let m=1;m<=due;m++) {
      if (s.months[m-1]) lunas++;
      else { belum++; totalTunggakan += s.biaya; }
    }
    return { nisn:s.nisn, nama:s.nama, tahunMasuk:s.tahunMasuk, biaya:s.biaya,
      lunas, belum, totalTunggakan, persenLunas: due>0?Math.round(lunas/due*100):0 };
  });
}

// ---- TUNGGAKAN SANTRI (semua jenis tagihan) ----
function getTunggakanSantri() {
  const sppList = getSppList();
  const result = [];
  sppList.forEach(s => {
    // Santri yang dibebaskan (beasiswa/dhuafa/kebijakan Mudir) tidak pernah dianggap
    // menunggak -- dilewati di sini supaya tidak muncul di daftar tunggakan Admin,
    // tidak menerima pengingat WA/push, dan tidak ikut dihitung ke total tunggakan pondok.
    if (s.bebas) return;
    const due = bulanJatuhTempoSPP(s.tahunMasuk, s.tanggalKeluar || '');
    let tunggakanSPP = 0;
    const bulanTunggak = [];
    for (let m=1;m<=due;m++) {
      if (!s.months[m-1]) { tunggakanSPP += s.biaya; bulanTunggak.push(labelBulanSPP(m,s.tahunMasuk)); }
    }
    if (tunggakanSPP > 0) result.push({
      nisn:s.nisn, nama:s.nama, noWa:s.noWa,
      tunggakanSPP, bulanTunggak, jumlahBulan:bulanTunggak.length,
      status: s.status || ''   // 'Lulus' / 'Mutasi Keluar' bila sudah bukan santri aktif
    });
  });
  return result.sort((a,b) => b.tunggakanSPP - a.tunggakanSPP);
}

function buildPesanTagihanSPP(nama, bulanTunggak, totalTunggakan) {
  const p = getPengaturan();
  const namaPesantren = p.NamaPesantren || 'Pondok Pesantren';
  return 'Assalamualaikum Wr. Wb.\n\nYth. Orang Tua/Wali Santri *' + nama + '*\n\n' +
    'Kami dari Pesantren *' + namaPesantren + '* ingin mengingatkan bahwa pembayaran SPP berikut masih belum lunas:\n\n' +
    bulanTunggak.map(function(b){ return '• ' + b; }).join('\n') + '\n\n' +
    'Total tunggakan: *Rp' + totalTunggakan.toLocaleString('id-ID') + '*\n\n' +
    'Mohon segera melakukan pembayaran. Untuk informasi lebih lanjut hubungi pihak pesantren.\n\n' +
    'Jazakumullah khairan.';
}

function apiKirimTagihanSppSatuSantri(p) {
  if (jenisWANonaktif_()['spp_tagihan_manual']) return {ok:false, error:'Pengiriman tagihan SPP lewat tombol sedang dinonaktifkan. Aktifkan di menu Pengaturan WhatsApp.'};
  if (!waTerkonfigurasi_()) return {ok:false, error:'WhatsApp belum diatur. Isi token Wablas atau Fonnte di menu Pengaturan WhatsApp.'};
  const nisn = norm(p.nisn);
  if (!nisn) return {ok:false, error:'NISN wajib diisi'};
  const tunggakan = getTunggakanSantri();
  const santri = tunggakan.find(t => t.nisn === nisn);
  if (!santri) return {ok:false, error:'Santri ini tidak memiliki tunggakan'};
  if (!santri.noWa) return {ok:false, error:'No WA wali santri ini tidak terdaftar'};
  const pesan = buildPesanTagihanSPP(santri.nama, santri.bulanTunggak, santri.tunggakanSPP);
  kirimWAKategori_('spp_tagihan_manual', santri.noWa, pesan);
  return {ok:true};
}

function apiKirimTagihanSppMassal() {
  if (jenisWANonaktif_()['spp_tagihan_manual']) return {ok:false, error:'Pengiriman tagihan SPP lewat tombol sedang dinonaktifkan. Aktifkan di menu Pengaturan WhatsApp.'};
  if (!waTerkonfigurasi_()) return {ok:false, error:'WhatsApp belum diatur. Isi token Wablas atau Fonnte di menu Pengaturan WhatsApp.'};
  const tunggakan = getTunggakanSantri();
  let terkirim = 0;
  tunggakan.forEach(function(t){
    if (!t.noWa || t.status) return; // massal: santri keluar/lulus dilewati
    const pesan = buildPesanTagihanSPP(t.nama, t.bulanTunggak, t.tunggakanSPP);
    kirimWAKategori_('spp_tagihan_manual', t.noWa, pesan);
    terkirim++;
    Utilities.sleep(300);
  });
  return {ok:true, terkirim:terkirim};
}


// ---- SETUP SHEET KEUANGAN (dipanggil dari setupAwal & migrasi) ----
function setupSheetKeuangan(masterSS) {
  if (!masterSS.getSheetByName(SHEET_KATEGORI_KAS)) {
    const sh = masterSS.insertSheet(SHEET_KATEGORI_KAS);
    sh.appendRow(['ID','Nama Kategori','Jenis','Keterangan']); sh.setFrozenRows(1);
    sh.getRange(2,1,8,4).setValues([
      ['KAT001','SPP','Pemasukan','Pembayaran SPP bulanan santri'],
      ['KAT002','DSP','Pemasukan','Dana Sumbangan Pendidikan'],
      ['KAT003','Daftar Ulang','Pemasukan','Pembayaran daftar ulang'],
      ['KAT004','Iuran Kegiatan','Pemasukan','Iuran kegiatan pesantren'],
      ['KAT005','Donasi/Infak','Pemasukan','Donasi dan infak dari luar'],
      ['KAT006','Operasional','Pengeluaran','Biaya operasional harian'],
      ['KAT007','Kegiatan','Pengeluaran','Biaya kegiatan pesantren'],
      ['KAT008','Gaji & Honor','Pengeluaran','Gaji dan honor ustadz/ustadzah'],
    ]);
  }
  if (!masterSS.getSheetByName(SHEET_TARIF)) {
    const sh = masterSS.insertSheet(SHEET_TARIF);
    sh.appendRow(['ID','Kelas/Angkatan','Jenis Tarif','Nominal','Keterangan']); sh.setFrozenRows(1);
  }
  if (!masterSS.getSheetByName(SHEET_KAS_UMUM)) {
    const sh = masterSS.insertSheet(SHEET_KAS_UMUM);
    sh.appendRow(['No. Ref','Tanggal','Jenis','Kategori','Uraian','Nominal','Dicatat Oleh','No. Kwitansi','Kelas']); sh.setFrozenRows(1);
  }
  if (!masterSS.getSheetByName(SHEET_ANGGARAN)) {
    const sh = masterSS.insertSheet(SHEET_ANGGARAN);
    sh.appendRow(['ID','Nama Kegiatan','Kategori','Pagu','Tahun','Keterangan']); sh.setFrozenRows(1);
  }
}

// ============ MIGRASI SKEMA LAMA (aman untuk data yang sudah ada) ============
// PRINSIP UTAMA: fungsi ini TIDAK PERNAH menghapus atau menimpa data yang sudah ada.
// Ia hanya MENAMBAH sheet/kolom yang belum ada, sesuai skema versi terbaru:
// - Sheet Santri: tambah kolom "Jenis Kelamin" bila belum ada (kolom lain tidak disentuh)
// - Sheet DaftarKelasRombel: dibuat & diisi otomatis dari kelas-kelas yang sudah ada
//   di sheet Rombel (kalau sheet ini belum ada sama sekali)
// - Sheet Halaqoh, HalaqohAnggota, Hafalan, Nilai, RekapNilai: dibuat kosong bila
//   belum ada (tidak mengubah apapun kalau sudah ada)
// - Sheet Absensi: tambah 5 kolom nilai sikap SEBELUM kolom "Waktu Input" bila
//   belum ada -- semua data lama (tanggal, status kehadiran, dst) tetap utuh
//
// CARA PAKAI: jalankan fungsi ini SEKALI dari editor Apps Script (klik Run), atau
// klik tombol "Perbaiki/Migrasi Skema Lama" di menu Admin > Ringkasan pada aplikasi.
// Aman dijalankan berkali-kali -- kalau skema sudah sesuai, tidak melakukan apa-apa.
function migrasiSkemaLama() {
  const ss = getAktifSS();
  const log = [];

  // 0) Sheet Slide di MASTER (fitur slide pengumuman) -- dicek terpisah karena
  // sheet ini ada di spreadsheet Master, bukan di spreadsheet tahun ajaran.
  const masterSS = getMasterSS();
  if (!masterSS.getSheetByName(SHEET_SLIDE)) {
    const shSlideBaru = masterSS.insertSheet(SHEET_SLIDE);
    shSlideBaru.appendRow(['Judul','URL Gambar','Tautan (opsional)','Tampil Untuk','Urutan','Aktif','Tanggal Dibuat']);
    shSlideBaru.setFrozenRows(1);
    log.push('Slide (Master): dibuat kosong. Atur lewat menu Kelola Slide.');
  } else {
    log.push('Slide (Master): sudah ada, tidak diubah.');
  }

  // 0b) Sheet PelanggaranSpreadsheet + pengaturan WhatsApp di MASTER (fitur Catat
  // Pelanggaran), plus buat spreadsheet Pelanggaran pertama otomatis kalau belum ada.
  if (!masterSS.getSheetByName(SHEET_PELANGGARAN_SS)) {
    const shPelSSBaru = masterSS.insertSheet(SHEET_PELANGGARAN_SS);
    shPelSSBaru.appendRow(['Nama','Spreadsheet ID','Aktif','Tanggal Dibuat']);
    shPelSSBaru.setFrozenRows(1);
    log.push('PelanggaranSpreadsheet (Master): dibuat kosong.');

    const shPengaturanCek = masterSS.getSheetByName(SHEET_PENGATURAN);
    const pRows = shPengaturanCek.getDataRange().getValues();
    const keyAda = {}; pRows.forEach(r => keyAda[r[0]] = true);
    if (!keyAda['FonnteToken']) shPengaturanCek.appendRow(['FonnteToken','']);
    if (!keyAda['GrupPengajarWA']) shPengaturanCek.appendRow(['GrupPengajarWA','']);
    if (!keyAda['ModalPoinSantri']) shPengaturanCek.appendRow(['ModalPoinSantri','25']);

    const idPelSSBaru = buatSpreadsheetPelanggaranBaru('Awal');
    daftarkanPelanggaranSS('Pelanggaran Awal', idPelSSBaru, true);
    PROP.setProperty(PELANGGARAN_AKTIF_KEY, idPelSSBaru);
    log.push('Spreadsheet Pelanggaran pertama dibuat & diaktifkan otomatis. Atur lewat menu Kelola Pelanggaran.');
  } else {
    log.push('PelanggaranSpreadsheet (Master): sudah ada, tidak diubah.');
  }

  // 0c) Sheet Artikel (untuk halaman depan/beranda publik)
  if (!masterSS.getSheetByName(SHEET_ARTIKEL)) {
    const shArtikelBaru = masterSS.insertSheet(SHEET_ARTIKEL);
    shArtikelBaru.appendRow(['Judul','Konten','Gambar URL','Kategori','Tanggal Publish','Penulis','Status','Waktu Input']);
    shArtikelBaru.setFrozenRows(1);
    log.push('Artikel (Master): dibuat kosong. Atur lewat menu Kelola Artikel/Website.');
  } else {
    log.push('Artikel (Master): sudah ada, tidak diubah.');
  }

  // 0c-2) Pengaturan info website -- dicek TERPISAH dari sheet Artikel di atas supaya
  // key baru (misal Ikon tombol melayang) tetap ditambahkan walau sheet Artikel sudah
  // pernah dibuat sebelumnya (bukan cuma sekali di migrasi pertama).
  {
    const shPengaturanCek2 = masterSS.getSheetByName(SHEET_PENGATURAN);
    const pRows2 = shPengaturanCek2.getDataRange().getValues();
    const keyAda2 = {}; pRows2.forEach(r => keyAda2[r[0]] = true);
    if (!keyAda2['DeskripsiSingkat']) shPengaturanCek2.appendRow(['DeskripsiSingkat','Pondok Pesantren yang mendidik generasi penghafal Al-Quran dengan akhlak mulia.']);
    if (!keyAda2['AlamatPesantren']) shPengaturanCek2.appendRow(['AlamatPesantren','']);
    if (!keyAda2['NoTeleponPesantren']) shPengaturanCek2.appendRow(['NoTeleponPesantren','']);
    if (!keyAda2['EmailPesantren']) shPengaturanCek2.appendRow(['EmailPesantren','']);
    if (!keyAda2['InfoPPDB']) shPengaturanCek2.appendRow(['InfoPPDB','Pendaftaran santri baru dibuka setiap tahun ajaran. Hubungi panitia untuk informasi lebih lanjut.']);
    if (!keyAda2['LinkPPDBEksternal']) shPengaturanCek2.appendRow(['LinkPPDBEksternal','']);
    if (!keyAda2['Visi']) shPengaturanCek2.appendRow(['Visi','Terwujudnya generasi penghafal Al-Quran yang berakhlak mulia dan berwawasan global.']);
    if (!keyAda2['Misi']) shPengaturanCek2.appendRow(['Misi','Menyelenggarakan pendidikan Islam terpadu yang berorientasi pada mutu, kemandirian, dan pembentukan karakter islami.']);
    if (!keyAda2['HeroImageURL']) shPengaturanCek2.appendRow(['HeroImageURL','']);
    if (!keyAda2['IkonJadwalSholat']) shPengaturanCek2.appendRow(['IkonJadwalSholat','']);
    if (!keyAda2['IkonAlQuran']) shPengaturanCek2.appendRow(['IkonAlQuran','']);
    if (!keyAda2['IkonDzikir']) shPengaturanCek2.appendRow(['IkonDzikir','']);
    if (!keyAda2['TaglineHero']) shPengaturanCek2.appendRow(['TaglineHero','Pendidikan Islam Terpadu']);
    if (!keyAda2['IkonWhatsApp']) shPengaturanCek2.appendRow(['IkonWhatsApp','']);
    log.push('Pengaturan info website: dicek/dilengkapi (aman, hanya menambah key yang belum ada).');
  }

  // 0d) Sheet FiturBeranda (Program Unggulan & Fasilitas dengan foto di halaman depan)
  if (!masterSS.getSheetByName(SHEET_FITUR_BERANDA)) {
    const shFiturBaru = masterSS.insertSheet(SHEET_FITUR_BERANDA);
    shFiturBaru.appendRow(['Kategori','Judul','Deskripsi','Gambar URL','Urutan']);
    shFiturBaru.setFrozenRows(1);
    shFiturBaru.getRange(2,1,7,5).setValues([
      ['Program','Tahfidz Al-Quran','Program hafalan Al-Quran terpantau berkelanjutan, dengan pencatatan setoran & progres tiap santri secara berkala.','',1],
      ['Program','Akademik Terpadu','Kurikulum umum & agama seimbang, dibina langsung oleh tenaga pengajar berpengalaman.','',2],
      ['Program','Karakter & Kepemimpinan','Pembinaan akhlak dan kedisiplinan santri secara konsisten menuju generasi berakhlak mulia.','',3],
      ['Fasilitas','Asrama','','',1],
      ['Fasilitas','Masjid','','',2],
      ['Fasilitas','Perpustakaan','','',3],
      ['Fasilitas','Lapangan Olahraga','','',4]
    ]);
    log.push('FiturBeranda (Master): dibuat dengan data awal Program Unggulan & Fasilitas. Atur/tambah foto lewat menu Kelola Fitur Halaman Depan.');
  } else {
    log.push('FiturBeranda (Master): sudah ada, tidak diubah.');
  }

  // 0e) Sheet Administrasi Guru di Master -- ModulAjar, RPPPertemuan, SOP, DefaultJurnal
  if (!masterSS.getSheetByName(SHEET_MODUL_AJAR)) {
    const shMA = masterSS.insertSheet(SHEET_MODUL_AJAR);
    shMA.appendRow(['ID','Mapel','Kelas','Kurikulum','NamaFile','Kategori','URLAsli','RingkasanAI','IsiLengkap','WaktuUpload','DiuploadOleh']);
    shMA.setFrozenRows(1); log.push('ModulAjar (Master): dibuat kosong.');
  } else { log.push('ModulAjar (Master): sudah ada.'); }

  if (!masterSS.getSheetByName(SHEET_RPP_PERTEMUAN)) {
    const shRPP = masterSS.insertSheet(SHEET_RPP_PERTEMUAN);
    shRPP.appendRow(['ID','Mapel','Kelas','Kurikulum','NamaBab','NoPertemuan','TopikPertemuan','AlokasiJP','Pendahuluan','Inti','Penutup','LinkVideo','LinkSlide','LinkBukuAjar','CatatanGuru','WaktuInput','DibuatOleh']);
    shRPP.setFrozenRows(1); log.push('RPPPertemuan (Master): dibuat kosong.');
  } else { log.push('RPPPertemuan (Master): sudah ada.'); }

  if (!masterSS.getSheetByName(SHEET_SOP)) {
    const shSOP = masterSS.insertSheet(SHEET_SOP);
    shSOP.appendRow(['ID','Judul','Kategori','Isi','Urutan','WaktuInput']);
    shSOP.setFrozenRows(1);
    shSOP.getRange(2,1,2,6).setValues([
      ['SOP001','SOP Mengajar','Mengajar','1. Baca RPP pertemuan hari ini\n2. Siapkan media pembelajaran\n3. Awali dengan doa dan absensi\n4. Sampaikan materi sesuai langkah RPP\n5. Isi jurnal mengajar setelah selesai',1,new Date()],
      ['SOP002','SOP Penanganan Pelanggaran','Pelanggaran','1. Catat pelanggaran di aplikasi segera\n2. Panggil santri untuk klarifikasi\n3. Berikan teguran sesuai bobot pelanggaran\n4. Hubungi wali santri bila perlu\n5. Laporkan ke Mudir bila berulang',1,new Date()]
    ]);
    log.push('SOP (Master): dibuat dengan 2 SOP awal (Mengajar & Pelanggaran). Edit lewat menu Kelola SOP.');
  } else { log.push('SOP (Master): sudah ada.'); }

  if (!masterSS.getSheetByName(SHEET_DEFAULT_JURNAL)) {
    const shDJ = masterSS.insertSheet(SHEET_DEFAULT_JURNAL);
    shDJ.appendRow(['Mapel','TeksDefault','WaktuUpdate']);
    shDJ.setFrozenRows(1);
    shDJ.appendRow(['__UMUM__','Pembelajaran berlangsung sesuai RPP yang telah disiapkan. Materi disampaikan dengan metode yang sesuai. Santri mengikuti kegiatan pembelajaran dengan tertib dan kondusif. Tujuan pembelajaran tercapai sesuai target.',new Date()]);
    log.push('DefaultJurnal (Master): dibuat dengan 1 teks default umum. Tambah/edit lewat menu Default Jurnal.');
  } else { log.push('DefaultJurnal (Master): sudah ada.'); }

  // JurnalMengajar di spreadsheet Absensi aktif
  if (!ss.getSheetByName(SHEET_JURNAL_MENGAJAR)) {
    const shJ = ss.insertSheet(SHEET_JURNAL_MENGAJAR);
    shJ.appendRow(['Tanggal','Hari','Mapel','Kelas','Jam Ke','Pengampu','IDRPPPertemuan','MateriDisampaikan','Metode','Hambatan','TindakLanjut','CatatanTambahan','StatusJurnal','WaktuInput']);
    shJ.setFrozenRows(1); log.push('JurnalMengajar (Absensi): dibuat kosong.');
  } else { log.push('JurnalMengajar (Absensi): sudah ada.'); }

  // 0f) Sheet Keuangan Bendahara (di Master SS)
  const katBelumAda = !masterSS.getSheetByName(SHEET_KATEGORI_KAS);
  setupSheetKeuangan(masterSS);
  if (katBelumAda) log.push('Keuangan Bendahara: sheet KasUmum, KategoriKas, Anggaran, TarifPembayaran dibuat (8 kategori default sudah diisi). Atur tarif SPP lewat menu Kelola Tarif di dashboard Bendahara.');
  else log.push('Keuangan Bendahara: sheet sudah ada, tidak diubah.');

  // 1) Santri: pastikan ada kolom "Jenis Kelamin"
  const shSantri = ss.getSheetByName(SHEET_SANTRI);
  if (shSantri) {
    const headerSantri = shSantri.getRange(1,1,1,shSantri.getLastColumn()).getValues()[0];
    if (headerSantri.indexOf('Jenis Kelamin') === -1) {
      const idxNoWa = headerSantri.indexOf('No WA Ortu');
      if (idxNoWa === -1) {
        shSantri.getRange(1, headerSantri.length + 1).setValue('Jenis Kelamin');
        log.push('Santri: kolom "Jenis Kelamin" ditambahkan di akhir (kolom lain tidak berubah).');
      } else {
        shSantri.insertColumnBefore(idxNoWa + 1);
        shSantri.getRange(1, idxNoWa + 1).setValue('Jenis Kelamin');
        log.push('Santri: kolom "Jenis Kelamin" disisipkan sebelum "No WA Ortu". Data NISN/Nama/Tahun Masuk/No WA Ortu tidak berubah, isi Jenis Kelamin kosong -- lengkapi manual atau lewat menu Data Santri.');
      }
    } else {
      log.push('Santri: skema sudah sesuai, tidak ada perubahan.');
    }
  } else {
    log.push('PERHATIAN: sheet Santri tidak ditemukan sama sekali.');
  }

  // 1b) Santri: pastikan ada kolom Kantin (Saldo/Limit/PIN Transaksi) -- ditambah di
  // AKHIR kolom yang sudah ada, tidak pernah menyisipkan/mengubah kolom lama.
  if (shSantri) {
    const headerSantri2 = shSantri.getRange(1,1,1,shSantri.getLastColumn()).getValues()[0];
    const kolomKantinBaru = ['Saldo Kantin','Limit Harian Kantin','PIN Transaksi'].filter(function(k){ return headerSantri2.indexOf(k) === -1; });
    if (kolomKantinBaru.length) {
      shSantri.getRange(1, headerSantri2.length + 1, 1, kolomKantinBaru.length).setValues([kolomKantinBaru]);
      log.push('Santri: kolom Kantin ('+kolomKantinBaru.join(', ')+') ditambahkan di akhir. Data lain tidak berubah.');
    } else {
      log.push('Santri: kolom Kantin sudah lengkap, tidak ada perubahan.');
    }
  }

  // 1c) KANTIN & SPP -- versi terbaru aplikasi ini memisahkan Kantin dan SPP jadi
  // spreadsheet SENDIRI (bukan lagi sheet di dalam spreadsheet Absensi). Migrasi ini
  // mendeteksi tahun ajaran yang belum punya spreadsheet Kantin/SPP terpisah (baik
  // instalasi baru maupun instalasi lama yang sempat punya sheet Kantin/SPP tertanam
  // di dalam Absensi), lalu membuatkan spreadsheet terpisah + memindahkan datanya kalau
  // ada, TANPA PERNAH menghapus data lama secara paksa.
  {
    const shTahunMig = getMasterSS().getSheetByName(SHEET_TAHUN);
    const tahunRows = shTahunMig.getDataRange().getValues();
    const idxBarisIni = tahunRows.findIndex(function(r,i){ return i>0 && r[1] === ss.getId(); });

    if (idxBarisIni === -1) {
      log.push('Kantin/SPP: baris tahun ajaran untuk spreadsheet ini tidak ditemukan di Master, dilewati (jarang terjadi, cek manual kalau ini muncul).');
    } else {
      const baris = tahunRows[idxBarisIni];
      const namaTahun = norm(baris[0]);
      let idKantinBaris = norm(baris[4]);
      let idSppBaris = norm(baris[5]);
      let idPelBaris = norm(baris[6]);
      let idFolderBaris = norm(baris[7]);
      const isAktif = baris[2] === true;

      if (!idKantinBaris) {
        const ssKantinBaru = SpreadsheetApp.create('KANTIN - ' + namaTahun);
        const shBarangLama = ss.getSheetByName(SHEET_BARANG);
        if (shBarangLama) { const c = shBarangLama.copyTo(ssKantinBaru); c.setName(SHEET_BARANG); }
        else { const nb = ssKantinBaru.getActiveSheet().setName(SHEET_BARANG); nb.appendRow(['Nama Barang','Harga','Potongan','Pemilik','No WA Pemilik']); nb.setFrozenRows(1); }
        const shSaldoPemilikLama = ss.getSheetByName(SHEET_SALDO_PEMILIK);
        if (shSaldoPemilikLama) { const c2 = shSaldoPemilikLama.copyTo(ssKantinBaru); c2.setName(SHEET_SALDO_PEMILIK); }
        else { const ns = ssKantinBaru.insertSheet(SHEET_SALDO_PEMILIK); ns.appendRow(['Nama Pemilik','No WA','Saldo']); ns.setFrozenRows(1); }
        const shTKLama = ss.getSheetByName(SHEET_TRANSAKSI_KANTIN);
        if (shTKLama) { const c3 = shTKLama.copyTo(ssKantinBaru); c3.setName(SHEET_TRANSAKSI_KANTIN); }
        else { const nt = ssKantinBaru.insertSheet(SHEET_TRANSAKSI_KANTIN); nt.appendRow(headerTransaksiKantin()); nt.setFrozenRows(1); }
        const shRPLama = ss.getSheetByName(SHEET_RIWAYAT_SALDO_PEMILIK);
        if (shRPLama) { const c4 = shRPLama.copyTo(ssKantinBaru); c4.setName(SHEET_RIWAYAT_SALDO_PEMILIK); }
        else { const nr = ssKantinBaru.insertSheet(SHEET_RIWAYAT_SALDO_PEMILIK); nr.appendRow(['Tanggal','Waktu','Nama Pemilik','Jenis','Nominal','Saldo Sebelum','Saldo Sekarang','Keterangan','Status']); nr.setFrozenRows(1); }
        const shPTLama = ss.getSheetByName(SHEET_PENGAJUAN_TOPUP);
        if (shPTLama) { const c5 = shPTLama.copyTo(ssKantinBaru); c5.setName(SHEET_PENGAJUAN_TOPUP); }
        else { const npt = ssKantinBaru.insertSheet(SHEET_PENGAJUAN_TOPUP); npt.appendRow(['Tanggal','Waktu','NISN','Nama Santri','Nominal','No WA Wali','Status','Waktu Diproses','Diproses Oleh']); npt.setFrozenRows(1); }
        const shPTrLama = ss.getSheetByName(SHEET_PENGAJUAN_TARIK);
        if (shPTrLama) { const c6 = shPTrLama.copyTo(ssKantinBaru); c6.setName(SHEET_PENGAJUAN_TARIK); }
        else { const nptr = ssKantinBaru.insertSheet(SHEET_PENGAJUAN_TARIK); nptr.appendRow(['Tanggal','Waktu','Nama Pemilik','No WA','Nominal','Status','Waktu Diproses','Diproses Oleh']); nptr.setFrozenRows(1); }
        ssKantinBaru.getSheets().forEach(function(sh){
          var nm = sh.getName();
          if ([SHEET_BARANG,SHEET_SALDO_PEMILIK,SHEET_TRANSAKSI_KANTIN,SHEET_RIWAYAT_SALDO_PEMILIK,SHEET_PENGAJUAN_TOPUP,SHEET_PENGAJUAN_TARIK].indexOf(nm) === -1) ssKantinBaru.deleteSheet(sh);
        });
        idKantinBaris = ssKantinBaru.getId();
        shTahunMig.getRange(idxBarisIni+1, 5).setValue(idKantinBaris);
        if (isAktif) PROP.setProperty(KANTIN_AKTIF_KEY, idKantinBaris);
        log.push('Kantin: dipisah jadi spreadsheet baru "KANTIN - '+namaTahun+'" (data lama, kalau ada di dalam Absensi, ikut disalin -- sheet lama di Absensi TIDAK dihapus, aman dibiarkan/dihapus manual nanti).');
      } else {
        log.push('Kantin: sudah punya spreadsheet terpisah, tidak diubah.');
      }

      if (!idSppBaris) {
        const ssSppBaru = SpreadsheetApp.create('SPP - ' + namaTahun);
        const shSppLama = ss.getSheetByName(SHEET_SPP);
        const shSppTarget = ssSppBaru.getActiveSheet().setName(SHEET_SPP);
        if (shSppLama && shSppLama.getLastRow() > 0) {
          const nilai = shSppLama.getRange(1,1,shSppLama.getLastRow(), shSppLama.getLastColumn()).getValues();
          shSppTarget.getRange(1,1,nilai.length,nilai[0].length).setValues(nilai);
        } else {
          shSppTarget.appendRow(headerSPP());
        }
        shSppTarget.setFrozenRows(1);
        idSppBaris = ssSppBaru.getId();
        shTahunMig.getRange(idxBarisIni+1, 6).setValue(idSppBaris);
        if (isAktif) PROP.setProperty(SPP_AKTIF_KEY, idSppBaris);
        log.push('SPP: dipisah jadi spreadsheet baru "SPP - '+namaTahun+'" (data lama, kalau ada di dalam Absensi, ikut disalin).');
      } else {
        log.push('SPP: sudah punya spreadsheet terpisah, tidak diubah.');
      }

      // Kaitkan Pelanggaran yang sedang aktif ke baris tahun ajaran ini (kalau belum
      // terkait) supaya nanti "Aktifkan Tahun Ajaran" bisa memindahkan Pelanggaran juga.
      if (!idPelBaris) {
        const idPelAktifSaatIni = PROP.getProperty(PELANGGARAN_AKTIF_KEY);
        if (idPelAktifSaatIni) {
          idPelBaris = idPelAktifSaatIni;
          shTahunMig.getRange(idxBarisIni+1, 7).setValue(idPelBaris);
          log.push('Pelanggaran: dikaitkan ke spreadsheet Pelanggaran yang sedang aktif saat ini.');
        }
      }

      // Kelompokkan ke dalam satu folder Drive kalau belum ada foldernya.
      if (!idFolderBaris) {
        try {
          const folderBaru = DriveApp.createFolder('Tahun Ajaran ' + namaTahun);
          [ss.getId(), idKantinBaris, idSppBaris, idPelBaris].forEach(function(id){
            if (!id) return;
            try { DriveApp.getFileById(id).moveTo(folderBaru); } catch (e) { /* diamkan */ }
          });
          shTahunMig.getRange(idxBarisIni+1, 8).setValue(folderBaru.getId());
          log.push('Folder Drive "Tahun Ajaran '+namaTahun+'" dibuat, ke-4 spreadsheet dikelompokkan ke dalamnya.');
        } catch (e) {
          log.push('PERHATIAN: gagal membuat folder Drive pengelompokan (' + e.message + '). Spreadsheet tetap berfungsi normal, cuma belum terkelompok rapi di Drive.');
        }
      }
    }
  }

  // 2) DaftarKelasRombel: buat kalau belum ada, isi otomatis dari data Rombel lama
  let shDaftarKelas = ss.getSheetByName(SHEET_DAFTAR_KELAS);
  if (!shDaftarKelas) {
    shDaftarKelas = ss.insertSheet(SHEET_DAFTAR_KELAS);
    shDaftarKelas.appendRow(['Kelas','Wali Kelas']);
    shDaftarKelas.setFrozenRows(1);
    const shRombel = ss.getSheetByName(SHEET_ROMBEL);
    if (shRombel && shRombel.getLastRow() > 1) {
      const rowsRombel = shRombel.getDataRange().getValues();
      const headerRombel = rowsRombel[0];
      const idxKelas = headerRombel.indexOf('Kelas');
      const idxWali = headerRombel.indexOf('Wali Kelas');
      const kelasMap = {};
      for (let i=1;i<rowsRombel.length;i++) {
        if (idxKelas === -1) break;
        const kelas = norm(rowsRombel[i][idxKelas]);
        if (!kelas || kelasMap[kelas] !== undefined) continue;
        kelasMap[kelas] = idxWali !== -1 ? norm(rowsRombel[i][idxWali]) : '';
      }
      const kelasRows = Object.keys(kelasMap).map(k => [k, kelasMap[k]]);
      if (kelasRows.length) shDaftarKelas.getRange(2,1,kelasRows.length,2).setValues(kelasRows);
      log.push('DaftarKelasRombel: dibuat baru dan diisi otomatis dari ' + kelasRows.length + ' kelas yang ditemukan di sheet Rombel yang sudah ada. Data Rombel lama tidak diubah sama sekali.');
    } else {
      log.push('DaftarKelasRombel: dibuat kosong (belum ada data Rombel untuk disalin).');
    }
  } else {
    log.push('DaftarKelasRombel: sudah ada, tidak diubah.');
  }

  // 3) Rombel: hanya diperiksa, TIDAK PERNAH diubah/dihapus kolomnya
  const shRombel2 = ss.getSheetByName(SHEET_ROMBEL);
  if (shRombel2) {
    const headerRombel2 = shRombel2.getRange(1,1,1,shRombel2.getLastColumn()).getValues()[0];
    if (headerRombel2.indexOf('NISN') === -1 || headerRombel2.indexOf('Kelas') === -1) {
      log.push('PERHATIAN: header sheet Rombel tidak dikenali ('+headerRombel2.join(', ')+'). Periksa manual, tidak diubah otomatis untuk menghindari risiko.');
    } else {
      log.push('Rombel: kompatibel. Kolom tambahan lama seperti "Wali Kelas" (jika ada) dibiarkan apa adanya, tidak dihapus.');
    }
  }

  // 4) Halaqoh & HalaqohAnggota: buat kosong kalau belum ada sama sekali
  if (!ss.getSheetByName(SHEET_HALAQOH)) {
    const sh = ss.insertSheet(SHEET_HALAQOH);
    sh.appendRow(['Nama Halaqoh','Pengampu','Waktu','Gender']);
    sh.setFrozenRows(1);
    log.push('Halaqoh: dibuat kosong. Isi lewat menu Kelola Halaqoh.');
  } else {
    log.push('Halaqoh: sudah ada, tidak diubah.');
  }
  if (!ss.getSheetByName(SHEET_HALAQOH_ANGGOTA)) {
    const sh = ss.insertSheet(SHEET_HALAQOH_ANGGOTA);
    sh.appendRow(['NISN','Nama Santri','Halaqoh']);
    sh.setFrozenRows(1);
    log.push('HalaqohAnggota: dibuat kosong.');
  } else {
    log.push('HalaqohAnggota: sudah ada, tidak diubah.');
  }

  // 5) Absensi: tambah 5 kolom nilai sikap SEBELUM "Waktu Input" bila belum ada.
  // Data lama (Tanggal s/d Keterangan, dan Waktu Input) tetap utuh -- hanya disisipi kolom baru kosong.
  const shAbsensi = ss.getSheetByName(SHEET_ABSENSI);
  if (shAbsensi) {
    const headerAbsensi2 = shAbsensi.getRange(1,1,1,shAbsensi.getLastColumn()).getValues()[0];
    if (headerAbsensi2.indexOf('Sikap1') === -1) {
      const idxWaktuInput = headerAbsensi2.indexOf('Waktu Input');
      const kolomBaru = ['Sikap1','Sikap2','Sikap3','Sikap4','Nilai Sikap'];
      if (idxWaktuInput === -1) {
        const startCol = headerAbsensi2.length + 1;
        shAbsensi.getRange(1, startCol, 1, 5).setValues([kolomBaru]);
        log.push('Absensi: header "Waktu Input" tidak ditemukan, 5 kolom nilai sikap ditambahkan di akhir sheet.');
      } else {
        shAbsensi.insertColumnsBefore(idxWaktuInput + 1, 5);
        shAbsensi.getRange(1, idxWaktuInput + 1, 1, 5).setValues([kolomBaru]);
        log.push('Absensi: 5 kolom nilai sikap disisipkan sebelum "Waktu Input". Semua data kehadiran lama (Tanggal, Status, dst) tidak berubah -- hanya kolom baru yang kosong untuk pertemuan lama (wajar, karena sikap belum pernah dinilai saat itu).');
      }
    } else {
      log.push('Absensi: skema sudah sesuai, tidak ada perubahan.');
    }
  } else {
    log.push('PERHATIAN: sheet Absensi tidak ditemukan sama sekali.');
  }

  // 6) Hafalan: buat kosong kalau belum ada; kalau sudah ada tapi belum punya kolom "Nilai",
  // sisipkan kolom itu sebelum "Waktu Input" (data lama tidak berubah, hanya kolom baru kosong).
  const shHafalanMigrasi = ss.getSheetByName(SHEET_HAFALAN);
  if (!shHafalanMigrasi) {
    const sh = ss.insertSheet(SHEET_HAFALAN); sh.appendRow(headerHafalan()); sh.setFrozenRows(1);
    log.push('Hafalan: dibuat kosong.');
  } else {
    const headerHafalanLama = shHafalanMigrasi.getRange(1,1,1,shHafalanMigrasi.getLastColumn()).getValues()[0];
    if (headerHafalanLama.indexOf('Nilai') === -1) {
      const idxWaktuInputH = headerHafalanLama.indexOf('Waktu Input');
      if (idxWaktuInputH === -1) {
        shHafalanMigrasi.getRange(1, headerHafalanLama.length + 1).setValue('Nilai');
        log.push('Hafalan: kolom "Nilai" ditambahkan di akhir.');
      } else {
        shHafalanMigrasi.insertColumnBefore(idxWaktuInputH + 1);
        shHafalanMigrasi.getRange(1, idxWaktuInputH + 1).setValue('Nilai');
        log.push('Hafalan: kolom "Nilai" disisipkan sebelum "Waktu Input". Catatan hafalan lama tidak berubah, hanya kolom baru yang kosong (wajar, karena penilaian belum ada saat itu).');
      }
    } else {
      log.push('Hafalan: sudah ada, tidak diubah.');
    }
  }

  if (!ss.getSheetByName(SHEET_NILAI)) {
    const sh = ss.insertSheet(SHEET_NILAI); sh.appendRow(headerNilai()); sh.setFrozenRows(1);
    log.push('Nilai: dibuat kosong.');
  } else { log.push('Nilai: sudah ada, tidak diubah.'); }

  if (!ss.getSheetByName(SHEET_REKAP_NILAI)) {
    const sh = ss.insertSheet(SHEET_REKAP_NILAI); sh.appendRow(headerRekapNilai()); sh.setFrozenRows(1);
    log.push('RekapNilai: dibuat kosong.');
  } else { log.push('RekapNilai: sudah ada, tidak diubah.'); }

  // 7) JamPelajaran: master acuan jumlah jam per Mapel/Halaqoh untuk rekap jam mengajar guru
  if (!ss.getSheetByName(SHEET_JAM_PELAJARAN)) {
    const sh = ss.insertSheet(SHEET_JAM_PELAJARAN);
    sh.appendRow(['Jenis','Nama','Jumlah Jam']);
    sh.setFrozenRows(1);
    const defaultJam = [
      // Halaqoh
      ['Halaqoh','Subuh',3],
      ['Halaqoh','Duha',4],
      ['Halaqoh','Maghrib',2],
      // Mata Pelajaran Umum
      ['Mata Pelajaran','Bahasa Indonesia',2],
      ['Mata Pelajaran','Ilmu Pengetahuan Alam',2],
      ['Mata Pelajaran','Ilmu Pengetahuan Sosial',2],
      ['Mata Pelajaran','Matematika',2],
      ['Mata Pelajaran','Bahasa Inggris',2],
      ['Mata Pelajaran','Pendidikan Kewarganegaraan',2],
      ['Mata Pelajaran','PKn',2],
      // Mata Pelajaran Kepesantrenan
      ['Mata Pelajaran','Al Qurán/Tahsin',2],
      ['Mata Pelajaran','Al Quran/Tahsin',2],
      ['Mata Pelajaran','Hadist',2],
      ['Mata Pelajaran','Aqidah',2],
      ['Mata Pelajaran','Akhlaq',2],
      ['Mata Pelajaran','Fiqih',2],
      ['Mata Pelajaran','Tarikh/SKI',2],
      ['Mata Pelajaran','Bahasa Arab',2],
      ['Mata Pelajaran',"Ekskul Mufrodat & Do'a",2],
      // Ekstrakulikuler
      ['Ekstrakulikuler','Bela Diri',2],
    ];
    sh.getRange(2,1,defaultJam.length,3).setValues(defaultJam);
    log.push('JamPelajaran: dibuat dengan data lengkap sesuai pesantren. Halaqoh Duha Jumat putra otomatis 2 jam. Sesuaikan jam per mapel di menu Kelola Jam Pelajaran.');
  } else {
    log.push('JamPelajaran: sudah ada, tidak diubah.');
  }

  // 8) PenggantianGuru: catatan guru pengganti per tanggal
  if (!ss.getSheetByName(SHEET_PENGGANTIAN)) {
    const sh = ss.insertSheet(SHEET_PENGGANTIAN);
    sh.appendRow(headerPenggantian());
    sh.setFrozenRows(1);
    log.push('PenggantianGuru: dibuat kosong. Atur lewat menu Kelola Guru Pengganti.');
  } else {
    log.push('PenggantianGuru: sudah ada, tidak diubah.');
  }

  // ---- MASTER SS: buat kalau belum ada (instalasi lama) ----
  const masterIdLama = PROP.getProperty(MASTER_KEY);
  if (!masterIdLama) {
    try {
      const masterBaru = inisialisasiMasterSS();
      log.push('Master SS: BARU DIBUAT ("WASIAT Master SS") -- berisi pengaturan, daftar semester, RPP, SOP, Keuangan Bendahara. ID: ' + masterBaru.getId());
    } catch(e) {
      log.push('Master SS: GAGAL dibuat (' + e.message + '). Coba jalankan migrasi lagi.');
    }
  } else {
    log.push('Master SS: sudah ada (ID: ' + masterIdLama.substring(0,12) + '...), tidak diubah.');
  }

  // ---- SPP GLOBAL: buat kalau belum ada ----
  const sppId = PROP.getProperty(SPP_AKTIF_KEY);
  if (!sppId) {
    try {
      const idSppBaru = inisialisasiSPPSS();
      log.push('SPP: BARU DIBUAT ("WASIAT SPP (Global - Lintas Semester)") -- satu spreadsheet ini dipakai terus lintas semester, tidak pernah direset. ID: ' + idSppBaru.substring(0,12) + '...');
    } catch(e) {
      log.push('SPP: GAGAL dibuat (' + e.message + '). Coba jalankan migrasi lagi.');
    }
  } else {
    log.push('SPP: sudah ada (ID: ' + sppId.substring(0,12) + '...), tidak diubah. Riwayat SPP aman.');
  }

  // ---- BLOK AMAN: Sheet keuangan Bendahara di Master SS ----
  // Tidak membuat spreadsheet baru, hanya sheet di Master yang sudah ada.
  // Aman untuk instalasi lama karena Master SS sudah dibuat di atas.
  try {
    const katAda = !!masterSS.getSheetByName(SHEET_KATEGORI_KAS);
    setupSheetKeuangan(masterSS);
    if (!katAda) log.push('Keuangan Bendahara: sheet KasUmum, KategoriKas, Anggaran, TarifPembayaran dibuat di Master SS. Fitur Bendahara siap digunakan.');
    else log.push('Keuangan Bendahara: sheet sudah ada, tidak diubah.');
  } catch(e) {
    log.push('Keuangan Bendahara: GAGAL membuat sheet (' + e.message + '). Coba jalankan migrasi lagi.');
  }

  // ---- BLOK AMAN: Sheet JurnalMengajar di Absensi aktif ----
  if (!ss.getSheetByName(SHEET_JURNAL_MENGAJAR)) {
    try {
      const shJB = ss.insertSheet(SHEET_JURNAL_MENGAJAR);
      shJB.appendRow(['Tanggal','Hari','Mapel','Kelas','Jam Ke','Pengampu','IDRPPPertemuan','MateriDisampaikan','Metode','Hambatan','TindakLanjut','CatatanTambahan','StatusJurnal','WaktuInput']);
      shJB.setFrozenRows(1);
      log.push('JurnalMengajar: sheet baru dibuat di spreadsheet Absensi. Fitur jurnal guru siap digunakan.');
    } catch(e) { log.push('JurnalMengajar: GAGAL (' + e.message + ').'); }
  } else { log.push('JurnalMengajar: sudah ada, tidak diubah.'); }

  // ---- BLOK AMAN: Sheet RPP & Modul Ajar di Master SS ----
  if (!masterSS.getSheetByName(SHEET_MODUL_AJAR)) {
    try {
      const shMA = masterSS.insertSheet(SHEET_MODUL_AJAR);
      shMA.appendRow(['ID','Mapel','Kelas','Kurikulum','NamaFile','Kategori','URLAsli','RingkasanAI','IsiLengkap','WaktuUpload','DiuploadOleh']);
      shMA.setFrozenRows(1);
      log.push('ModulAjar: sheet baru dibuat di Master SS.');
    } catch(e) { log.push('ModulAjar: GAGAL (' + e.message + ').'); }
  } else { log.push('ModulAjar: sudah ada.'); }

  if (!masterSS.getSheetByName(SHEET_RPP_PERTEMUAN)) {
    try {
      const shRPPB = masterSS.insertSheet(SHEET_RPP_PERTEMUAN);
      shRPPB.appendRow(['ID','Mapel','Kelas','Kurikulum','NamaBab','NoPertemuan','TopikPertemuan','AlokasiJP','Pendahuluan','Inti','Penutup','LinkVideo','LinkSlide','LinkBukuAjar','CatatanGuru','WaktuInput','DibuatOleh']);
      shRPPB.setFrozenRows(1);
      log.push('RPPPertemuan: sheet baru dibuat di Master SS.');
    } catch(e) { log.push('RPPPertemuan: GAGAL (' + e.message + ').'); }
  } else { log.push('RPPPertemuan: sudah ada.'); }

  if (!masterSS.getSheetByName(SHEET_DEFAULT_JURNAL)) {
    try {
      const shDJB = masterSS.insertSheet(SHEET_DEFAULT_JURNAL);
      shDJB.appendRow(['Mapel','TeksDefault','WaktuUpdate']);
      shDJB.setFrozenRows(1);
      shDJB.appendRow(['__UMUM__','Pembelajaran berlangsung sesuai RPP yang telah disiapkan. Materi disampaikan dengan metode yang sesuai. Santri mengikuti kegiatan pembelajaran dengan tertib dan kondusif.',new Date()]);
      log.push('DefaultJurnal: sheet baru dibuat dengan 1 teks default umum.');
    } catch(e) { log.push('DefaultJurnal: GAGAL (' + e.message + ').'); }
  } else { log.push('DefaultJurnal: sudah ada.'); }

  if (!masterSS.getSheetByName(SHEET_SOP)) {
    try {
      const shSOPB = masterSS.insertSheet(SHEET_SOP);
      shSOPB.appendRow(['ID','Judul','Kategori','Isi','Urutan','WaktuInput']);
      shSOPB.setFrozenRows(1);
      shSOPB.getRange(2,1,2,6).setValues([
        ['SOP001','SOP Mengajar','Mengajar','1. Baca RPP pertemuan hari ini\n2. Siapkan media pembelajaran\n3. Awali dengan doa dan absensi\n4. Sampaikan materi sesuai langkah RPP\n5. Isi jurnal mengajar setelah selesai',1,new Date()],
        ['SOP002','SOP Penanganan Pelanggaran','Pelanggaran','1. Catat pelanggaran di aplikasi segera\n2. Panggil santri untuk klarifikasi\n3. Berikan teguran sesuai bobot pelanggaran\n4. Hubungi wali santri bila perlu\n5. Laporkan ke Mudir bila berulang',1,new Date()]
      ]);
      log.push('SOP: sheet baru dibuat dengan 2 SOP awal.');
    } catch(e) { log.push('SOP: GAGAL (' + e.message + ').'); }
  } else { log.push('SOP: sudah ada.'); }

  // ---- BLOK AMAN: Cek sheet Hafalan/Absensi/Nilai masih ada & header lengkap ----
  // Ini hanya verifikasi, TIDAK mengubah data yang ada.
  const shAbsenCek = ss.getSheetByName(SHEET_ABSENSI);
  if (shAbsenCek && shAbsenCek.getLastRow() > 0) {
    const hAbsen = shAbsenCek.getRange(1,1,1,shAbsenCek.getLastColumn()).getValues()[0];
    log.push('Absensi: OK, ' + (shAbsenCek.getLastRow()-1) + ' baris data, ' + hAbsen.length + ' kolom header.');
  } else { log.push('Absensi: sheet ada tapi kosong atau belum ada.'); }

  const shHafalanCek = ss.getSheetByName(SHEET_HAFALAN);
  if (shHafalanCek && shHafalanCek.getLastRow() > 0) {
    log.push('Hafalan: OK, ' + (shHafalanCek.getLastRow()-1) + ' baris data.');
  } else { log.push('Hafalan: sheet ada tapi kosong atau belum ada.'); }

  const shNilaiCek = ss.getSheetByName(SHEET_NILAI);
  if (shNilaiCek) {
    log.push('Nilai: OK, ' + (shNilaiCek.getLastRow()-1) + ' baris data.');
  }

  // ---- PERINGATAN UNTUK DATA YANG PERLU DIPERHATIKAN ----
  const santriCek = ss.getSheetByName(SHEET_SANTRI);
  if (santriCek) {
    const jmlSantri = santriCek.getLastRow()-1;
    log.push('Data Santri: ' + jmlSantri + ' santri terdaftar. TIDAK diubah oleh migrasi ini.');
  }

  // ---- Migrasi kolom TipeAbsen & WaktuHalaqoh di sheet Absensi ----
  const shAbsenMig = ss.getSheetByName(SHEET_ABSENSI);
  if (shAbsenMig && shAbsenMig.getLastRow() > 0) {
    const headerAbsen = shAbsenMig.getRange(1,1,1,shAbsenMig.getLastColumn()).getValues()[0];
    if (!headerAbsen.includes('TipeAbsen')) {
      const nextCol = headerAbsen.length + 1;
      shAbsenMig.getRange(1, nextCol).setValue('TipeAbsen');
      shAbsenMig.getRange(1, nextCol+1).setValue('WaktuHalaqoh');
      // Isi 'Akademik' untuk semua baris lama
      if (shAbsenMig.getLastRow() > 1) {
        const jmlBaris = shAbsenMig.getLastRow() - 1;
        shAbsenMig.getRange(2, nextCol, jmlBaris, 1).setValue('Akademik');
      }
      log.push('Absensi: kolom TipeAbsen dan WaktuHalaqoh ditambahkan. Data lama ditandai "Akademik".');
    } else { log.push('Absensi: kolom TipeAbsen sudah ada.'); }
  }

  // ---- Pastikan role Pembina ada di migrasi ----
  log.push('Role Pembina: tambahkan manual di sheet RoleAkses untuk akun pembina.');

  // ---- Kolom WaliKelas di sheet Guru (untuk role Wali Kelas) ----
  tambahKolomWaliKelas(ss);
  log.push('Guru: kolom WaliKelas ditambahkan kalau belum ada. Isi nama kelas di kolom ini untuk menugaskan Wali Kelas.');

  // ---- Sheet KelompokMapel di Master SS ----
  if (!masterSS.getSheetByName(SHEET_KELOMPOK_MAPEL)) {
    setupSheetKelompokMapel(masterSS);
    log.push('KelompokMapel: sheet baru dibuat di Master SS dengan pengelompokan mapel default (A=Umum, B=Kepesantrenan, C=Muatan Lokal). Admin/Mudir bisa edit di menu Kelola Rapor.');
  } else { log.push('KelompokMapel: sudah ada.'); }

  // ---- SOP default jika belum ada ----
  const masterSS2 = getMasterSS();
  const shSOP = masterSS2.getSheetByName(SHEET_SOP);
  if (!shSOP || shSOP.getLastRow() <= 1) {
    const sh = shSOP || masterSS2.insertSheet(SHEET_SOP);
    if (sh.getLastRow() === 0) sh.appendRow(['ID','Judul','Kategori','Isi','Urutan','Waktu']);
    const sopDefault = [
      ['SOP001','Persiapan Mengajar','Mengajar','1. Siapkan materi dan RPP sebelum masuk kelas.\n2. Pastikan media pembelajaran tersedia.\n3. Datang tepat waktu sesuai jadwal.',1],
      ['SOP002','Pengisian Jurnal Mengajar','Mengajar','1. Isi jurnal setiap selesai mengajar di aplikasi WASIAT.\n2. Cantumkan materi yang diajarkan, jumlah santri hadir, dan catatan penting.\n3. Batas pengisian jurnal pukul 23:00 hari yang sama.',2],
      ['SOP003','Prosedur Ketidakhadiran','Mengajar','1. Laporkan ketidakhadiran minimal 1 hari sebelumnya ke Mudir.\n2. Tentukan guru pengganti dan laporkan ke Admin agar diinput di aplikasi.\n3. Guru pengganti wajib mengisi absensi dan jurnal.',3],
      ['SOP004','Penanganan Santri Tidak Hadir','Halaqoh','1. Catat ketidakhadiran santri di aplikasi saat absensi.\n2. Sistem akan otomatis kirim notifikasi WA ke orang tua.\n3. Tindak lanjut bila tidak hadir lebih dari 3 hari berturut-turut.',1],
    ];
    sopDefault.forEach(function(s){ sh.appendRow([s[0],s[1],s[2],s[3],s[4],new Date()]); });
    log.push('SOP: sheet dibuat dengan 4 SOP default. Tambah/edit di menu Admin → Kelola SOP.');
  } else {
    log.push('SOP: sudah ada '+String(shSOP.getLastRow()-1)+' item.');
  }

  Logger.log(log.join('\n'));
  return log;
}

function apiMigrasiSkemaLama() {
  const log = migrasiSkemaLama();
  return {ok:true, log: log};
}

// ============ MASTER SPREADSHEET HELPER ============
function getMasterSS() {
  let id = PROP.getProperty(MASTER_KEY);
  if (!id) {
    // INSTALASI LAMA: Master SS belum ada karena setupAwal belum dijalankan.
    // Buat otomatis supaya migrasi bisa berjalan tanpa perlu jalankan setupAwal.
    Logger.log('Master SS belum ada -- membuat otomatis...');
    const master = inisialisasiMasterSS();
    id = master.getId();
  }
  return bukaSS_(id);
}

// Buat Master SS dari nol -- dipanggil kalau belum ada (instalasi lama / pertama kali).
// Aman dipanggil berkali-kali: cek dulu sebelum buat.
function inisialisasiMasterSS() {
  let id = PROP.getProperty(MASTER_KEY);
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch(e) { /* ID rusak, buat ulang */ }
  }

  const master = SpreadsheetApp.create('WASIAT Master SS');
  id = master.getId();
  PROP.setProperty(MASTER_KEY, id);

  // Buat semua sheet yang diperlukan di Master SS
  const shPengaturan = master.getActiveSheet().setName(SHEET_PENGATURAN);
  shPengaturan.appendRow(['Key','Value']);
  shPengaturan.setFrozenRows(1);
  // Isi pengaturan default
  const defaultPengaturan = [
    ['NamaPesantren','Pondok Pesantren Wihdatul Ummah Poso'],
    ['LogoURL',''], ['WarnaTema','#0d9488'], ['FonnteToken',''],
    ['GrupPengajarWA',''], ['ModalPoinSantri','100'],
    ['IzinkanGantiTanggal','false'], ['SlideJedaDetik','5'],
    ['DeskripsiSingkat','Pendidikan Islam Terpadu'],
    ['AlamatPesantren','Poso, Sulawesi Tengah'], ['NoTeleponPesantren',''],
    ['EmailPesantren',''], ['InfoPPDB',''],
    ['LinkPPDBEksternal',''], ['Visi',''], ['Misi',''],
    ['HeroImageURL',''], ['TaglineHero',''],
    ['IkonJadwalSholat',''], ['IkonAlQuran',''],
    ['IkonDzikir',''], ['IkonWhatsApp','']
  ];
  shPengaturan.getRange(2,1,defaultPengaturan.length,2).setValues(defaultPengaturan);

  const shTahun = master.insertSheet(SHEET_TAHUN);
  shTahun.appendRow(['Nama Semester/TA','Spreadsheet ID (Absensi)','Aktif','Tanggal Dibuat',
    'Spreadsheet ID (Kantin)','Spreadsheet ID (SPP)','Spreadsheet ID (Pelanggaran)','Folder ID']);
  shTahun.setFrozenRows(1);

  // Coba deteksi spreadsheet Absensi yang sudah ada dari Script Properties lama
  const idAbsensiLama = PROP.getProperty(AKTIF_KEY);
  if (idAbsensiLama) {
    shTahun.appendRow(['Semester Aktif (Lama)', idAbsensiLama, true, new Date(), '', '', '', '']);
    Logger.log('Master SS: mendaftarkan spreadsheet Absensi lama ID=' + idAbsensiLama);
  }

  master.insertSheet(SHEET_SLIDE).appendRow(['Gambar URL','Tautan','Keterangan','Aktif']);
  master.insertSheet(SHEET_ARTIKEL).appendRow(['Judul','Konten','Gambar URL','Kategori','Tanggal Publish','Penulis','Status','Waktu Input']);
  master.insertSheet(SHEET_FITUR_BERANDA).appendRow(['Kategori','Judul','Deskripsi','Gambar URL','Urutan']);
  master.insertSheet(SHEET_PELANGGARAN_SS).appendRow(['Nama','Spreadsheet ID','Aktif','Tanggal Dibuat']);
  master.insertSheet(SHEET_MODUL_AJAR).appendRow(['ID','Mapel','Kelas','Kurikulum','NamaFile','Kategori','URLAsli','RingkasanAI','IsiLengkap','WaktuUpload','DiuploadOleh']);
  master.insertSheet(SHEET_RPP_PERTEMUAN).appendRow(['ID','Mapel','Kelas','Kurikulum','NamaBab','NoPertemuan','TopikPertemuan','AlokasiJP','Pendahuluan','Inti','Penutup','LinkVideo','LinkSlide','LinkBukuAjar','CatatanGuru','WaktuInput','DibuatOleh']);
  master.insertSheet(SHEET_SOP).appendRow(['ID','Judul','Kategori','Isi','Urutan','WaktuInput']);
  const shDJ = master.insertSheet(SHEET_DEFAULT_JURNAL);
  shDJ.appendRow(['Mapel','TeksDefault','WaktuUpdate']);
  shDJ.appendRow(['__UMUM__','Pembelajaran berlangsung sesuai RPP. Santri mengikuti dengan tertib.',new Date()]);
  setupSheetKeuangan(master);

  Logger.log('Master SS berhasil dibuat: ' + id);
  return master;
}

// Inisialisasi spreadsheet SPP global (satu seumur hidup, lintas semester).
// Dipanggil dari migrasi kalau SPP belum ada.
function inisialisasiSPPSS() {
  let id = PROP.getProperty(SPP_AKTIF_KEY);
  if (id) {
    try { SpreadsheetApp.openById(id); return id; } catch(e) { /* ID rusak */ }
  }
  const ssSpp = SpreadsheetApp.create('WASIAT SPP (Global - Lintas Semester)');
  const shSpp = ssSpp.getActiveSheet().setName(SHEET_SPP);
  shSpp.appendRow(headerSPP());
  shSpp.setFrozenRows(1);
  id = ssSpp.getId();
  PROP.setProperty(SPP_AKTIF_KEY, id);

  // Catat ID SPP di baris TahunAjaran yang aktif di Master SS (kalau sudah ada)
  try {
    const shTA = getMasterSS().getSheetByName(SHEET_TAHUN);
    const rows = shTA.getDataRange().getValues();
    for (let i=1;i<rows.length;i++) {
      if (rows[i][2] === true) { shTA.getRange(i+1,6).setValue(id); break; }
    }
  } catch(e) {}

  Logger.log('SPP SS global berhasil dibuat: ' + id);
  return id;
}

function getTahunAjaranList() {
  const sh = getMasterSS().getSheetByName(SHEET_TAHUN);
  const data = sh.getDataRange().getValues(); data.shift();
  return data.map(r => ({nama:r[0], id:r[1], aktif:r[2], tanggal:r[3], idKantin:r[4]||'', idSpp:r[5]||'', idPelanggaran:r[6]||'', idFolder:r[7]||''}));
}

// idKantin/idSpp/idPelanggaran/idFolder opsional -- diisi kalau tahun ajaran ini
// dibuat dengan sistem baru (4 spreadsheet terpisah dalam 1 folder). Tahun ajaran lama
// (sebelum perombakan ini) akan kosong sampai migrasi dijalankan.
function daftarkanTahunAjaran(nama, id, aktif, idKantin, idSpp, idPelanggaran, idFolder) {
  const sh = getMasterSS().getSheetByName(SHEET_TAHUN);
  if (aktif) {
    const rows = sh.getDataRange().getValues();
    for (let i=1;i<rows.length;i++) sh.getRange(i+1,3).setValue(false);
  }
  sh.appendRow([nama, id, !!aktif, new Date(), idKantin||'', idSpp||'', idPelanggaran||'', idFolder||'']);
}

function apiCreateTahunAjaran(nama) {
  nama = norm(nama);
  if (!nama) return {ok:false, error:'Nama semester wajib diisi (contoh: Semester 1 TA 2026/2027)'};
  const list = getTahunAjaranList();
  if (list.some(t => norm(t.nama) === nama)) return {ok:false, error:'Semester "'+nama+'" sudah ada'};
  const hasil = buatSemuaSpreadsheetSemesterBaru(nama);
  daftarkanTahunAjaran(nama, hasil.idAbsensi, false, hasil.idKantin, '', hasil.idPelanggaran, hasil.idFolder);
  daftarkanPelanggaranSS(nama, hasil.idPelanggaran, false);
  return {ok:true, id: hasil.idAbsensi, namaFolder: nama};
}

function apiSetTahunAjaranAktif(id) {
  const sh = getMasterSS().getSheetByName(SHEET_TAHUN);
  if (!sh) return {ok:false, error:'Sheet tidak ditemukan. Coba jalankan Migrasi Skema di Admin.'};

  const rows = sh.getDataRange().getValues();
  let found = false, rowData = null;
  for (let i=1;i<rows.length;i++) {
    const match = rows[i][1] === id;
    sh.getRange(i+1,3).setValue(match);
    if (match) { found = true; rowData = rows[i]; }
  }
  if (!found) return {ok:false, error:'Semester tidak ditemukan'};
  PROP.setProperty(AKTIF_KEY, id);
  // Aktifkan Kantin dan Pelanggaran yang terhubung ke semester ini.
  // SPP TIDAK ikut berubah -- satu spreadsheet SPP berjalan lintas semester.
  if (rowData[4]) PROP.setProperty(KANTIN_AKTIF_KEY, rowData[4]);
  if (rowData[6]) { try { apiSetPelanggaranSSAktif(rowData[6]); } catch (e) {} }
  return {ok:true};
}

// Sidik jari satu sheet: dipakai untuk mendeteksi ADA perubahan data, bukan untuk
// mengetahui apa yang berubah. Memakai jumlah baris/kolom + hash MD5 seluruh isinya,
// jadi perubahan di tengah data (misal nama santri diedit) ikut terdeteksi.
function sidikJariSheet(ss, namaSheet) {
  try {
    const sh = ss.getSheetByName(namaSheet);
    if (!sh) return '0';
    const rng = sh.getDataRange();
    if (rng.getNumRows() < 1) return '0';
    const nilai = rng.getValues();
    const teks = nilai.map(r => r.join('\u0001')).join('\u0002');
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, teks, Utilities.Charset.UTF_8);
    // Ambil 8 byte pertama saja -- cukup untuk membandingkan "berubah / tidak berubah"
    // dan membuat hasilnya jauh lebih ringkas untuk dikirim ke aplikasi.
    let hex = '';
    for (let i = 0; i < 8 && i < digest.length; i++) {
      hex += ('0' + (digest[i] & 0xFF).toString(16)).slice(-2);
    }
    return nilai.length + 'x' + (nilai[0] ? nilai[0].length : 0) + '-' + hex;
  } catch (e) {
    return 'err';
  }
}

// Penanda versi PER KELOMPOK DATA. Aplikasi membandingkan hanya kelompok yang
// berkaitan dengan role yang sedang dipakai, supaya notifikasi "tersedia pembaruan"
// muncul saat memang relevan -- bukan setiap kali ada guru lain menyimpan absensi.
//
// Sheet transaksional (Absensi, Hafalan, Nilai, Jurnal, transaksi kantin) SENGAJA
// tidak masuk sini: isinya berubah sepanjang hari oleh banyak orang, dan perubahan
// itu tidak mengubah apa yang bisa dikerjakan user, jadi tidak layak jadi notifikasi.
function apiGetVersiData() {
  const cache = CacheService.getScriptCache();
  const KUNCI = 'wasiatVersiDataV2';
  try {
    const tersimpan = cache.get(KUNCI);
    if (tersimpan) return {ok:true, versi: JSON.parse(tersimpan), dariCache: true};
  } catch (e) { /* cache bermasalah: hitung langsung */ }

  let versi = {};
  try {
    const ss = getAktifSS();
    const master = getMasterSS();
    versi = {
      santri:        sidikJariSheet(ss, SHEET_SANTRI),
      guru:          sidikJariSheet(ss, SHEET_GURU),
      mapel:         sidikJariSheet(ss, SHEET_MAPEL),
      kelas:         sidikJariSheet(ss, SHEET_DAFTAR_KELAS) + '|' + sidikJariSheet(ss, SHEET_ROMBEL),
      halaqoh:       sidikJariSheet(ss, SHEET_HALAQOH) + '|' + sidikJariSheet(ss, SHEET_HALAQOH_ANGGOTA),
      jadwal:        sidikJariSheet(ss, SHEET_JAM_PELAJARAN),
      roleakses:     sidikJariSheet(ss, SHEET_ROLE),
      tugaspembina:  sidikJariSheet(ss, SHEET_TUGAS_PEMBINA),
      pengaturan:    sidikJariSheet(master, SHEET_PENGATURAN),
      sop:           sidikJariSheet(master, SHEET_SOP)
    };
  } catch (e) {
    // Jangan sampai menggagalkan aplikasi -- kembalikan kosong, aplikasi akan
    // menganggap "tidak ada perubahan" dan tetap berjalan normal.
    return {ok:true, versi:{}, gagalBaca:true};
  }
  // Cache 2 menit: menghitung sidik jari beberapa sheet cukup berat, dan data master
  // tidak berubah setiap detik. Ini melindungi kuota Apps Script saat banyak
  // perangkat memeriksa bersamaan.
  try { cache.put(KUNCI, JSON.stringify(versi), 120); } catch (e) {}
  return {ok:true, versi: versi};
}

// Spreadsheet yang sudah dibuka dalam SATU permintaan disimpan sementara, supaya tidak
// dibuka ulang berkali-kali (tiap SpreadsheetApp.openById memakan waktu). Hanya hidup
// selama satu permintaan -- permintaan berikutnya selalu membuka ulang (data selalu baru).
const _cacheSS_ = {};
function bukaSS_(id) {
  if (!_cacheSS_[id]) _cacheSS_[id] = SpreadsheetApp.openById(id);
  return _cacheSS_[id];
}

function getAktifSS() {
  let id = PROP.getProperty(AKTIF_KEY);
  if (!id) {
    const list = getTahunAjaranList();
    const a = list.find(x => x.aktif === true);
    if (!a) throw new Error('Belum ada tahun ajaran aktif. Buka menu Setting Tahun Ajaran.');
    id = a.id;
    PROP.setProperty(AKTIF_KEY, id);
  }
  return bukaSS_(id);
}

// Spreadsheet KANTIN terpisah dari Absensi -- data Santri tetap satu-satunya di
// Absensi, spreadsheet ini cuma simpan Barang/Saldo/Transaksi/Pengajuan, merujuk NISN
// balik ke Absensi saat butuh nama/No WA santri.
function getAktifKantinSS() {
  let id = PROP.getProperty(KANTIN_AKTIF_KEY);
  if (!id) {
    const list = getTahunAjaranList();
    const a = list.find(x => x.aktif === true);
    if (a && a.idKantin) { id = a.idKantin; PROP.setProperty(KANTIN_AKTIF_KEY, id); }
  }
  // FALLBACK BACKWARD COMPATIBLE: kalau spreadsheet Kantin terpisah belum ada
  // (instalasi lama, belum dimigrasi), gunakan spreadsheet Absensi yang sudah ada.
  // Ini memastikan fitur Kantin tetap berjalan walau migrasi belum dilakukan.
  if (!id) return getAktifSS();
  try { return bukaSS_(id); }
  catch(e) { return getAktifSS(); } // fallback kalau ID rusak/terhapus
}

// Spreadsheet SPP terpisah dari Absensi -- sama prinsipnya seperti Kantin di atas.
function getAktifSppSS() {
  let id = PROP.getProperty(SPP_AKTIF_KEY);
  if (!id) {
    const list = getTahunAjaranList();
    const a = list.find(x => x.aktif === true);
    if (a && a.idSpp) { id = a.idSpp; PROP.setProperty(SPP_AKTIF_KEY, id); }
  }
  // FALLBACK BACKWARD COMPATIBLE: sama seperti Kantin di atas.
  if (!id) return getAktifSS();
  try { return bukaSS_(id); }
  catch(e) { return getAktifSS(); }
}

// ============ PENGATURAN ============
function getPengaturan() {
  const cached = cacheAmbil('pengaturan_v1');
  if (cached) return cached;
  const sh = getMasterSS().getSheetByName(SHEET_PENGATURAN);
  const rows = sh.getDataRange().getValues(); rows.shift();
  const obj = {}; rows.forEach(r => obj[r[0]] = r[1]);
  // Logo bawaan (disematkan di kode) dipakai otomatis di layar (login/sidebar) selama
  // Admin belum mengisi LogoURL sendiri lewat menu Tampilan/Logo -- sama seperti yang
  // dipakai default di setiap PDF, supaya identitas visual konsisten di mana-mana.
  obj.LogoDataUriDefault = 'data:image/jpeg;base64,' + LOGO_DEFAULT_BASE64;
  cacheSimpan('pengaturan_v1', obj, 300);
  return obj;
}
// ======================================================================
// NILAI RAHASIA DI PENGATURAN (token WA, API key notifikasi)
//
// Endpoint getPengaturan bisa dipanggil tanpa login (dipakai halaman depan). Sebelumnya
// endpoint itu mengembalikan SELURUH pengaturan, termasuk token WA & API key -- siapa
// pun yang membuka situs bisa membacanya. Sekarang nilai rahasia:
//   - TIDAK PERNAH dikirim ke aplikasi; yang dikirim hanya tanda "sudah tersimpan"
//   - kolom rahasia yang dikirim KOSONG saat menyimpan berarti "jangan diubah"
//   - untuk menghapus, aplikasi mengirim penanda khusus __HAPUS__
// Kode server tetap memakai getPengaturan() apa adanya, jadi pengiriman WA/notifikasi
// tidak terpengaruh.
// ======================================================================
const KUNCI_RAHASIA = ['FonnteToken', 'WablasToken', 'WablasSecretKey', 'OneSignalApiKey'];
const PENANDA_HAPUS_RAHASIA = '__HAPUS__';

function getPengaturanPublik_() {
  const asli = getPengaturan();
  const salin = {};
  const tersimpan = {};
  Object.keys(asli).forEach(function(k){
    if (KUNCI_RAHASIA.indexOf(k) !== -1) { tersimpan[k] = !!norm(asli[k]); return; }
    salin[k] = asli[k];
  });
  salin._rahasiaTersimpan = tersimpan;
  return salin;
}
// Mengubah nilai yang akan disimpan: null = lewati (jangan diubah)
function nilaiSimpanPengaturan_(key, val) {
  if (KUNCI_RAHASIA.indexOf(key) === -1) return val;
  const v = String(val == null ? '' : val).trim();
  if (v === '') return null;                      // kosong = tidak diubah
  if (v === PENANDA_HAPUS_RAHASIA) return '';     // hapus
  return v;
}

function apiSimpanPengaturan(p) {
  if (String(p.key || '').indexOf('KasirMode') === 0 && !adminAtauMudir(p.oleh)) return {ok:false, error:'Pengaturan cara bayar kasir hanya bisa diubah Admin/Mudir.'};
  const nilai = nilaiSimpanPengaturan_(p.key, p.value);
  if (nilai === null) return {ok:true, tidakDiubah:true};
  p = {key: p.key, value: nilai};
  const sh = getMasterSS().getSheetByName(SHEET_PENGATURAN);
  const rows = sh.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) { if (rows[i][0] === p.key) { sh.getRange(i+1,2).setValue(p.value); cacheHapus('pengaturan_v1'); return {ok:true}; } }
  sh.appendRow([p.key, p.value]);
  cacheHapus('pengaturan_v1'); // invalidasi seketika -- perubahan Admin langsung terlihat, tidak menunggu TTL
  return {ok:true};
}

// Ambil banyak key sekaligus. Memakai getPengaturan() (yang sudah ter-cache) sebagai
// sumber datanya, bukan membaca sheet lagi secara terpisah -- menghindari dua kali baca
// sheet yang sama untuk kebutuhan yang identik.
function apiGetPengaturanBatch(p) {
  const obj = getPengaturan();
  const keys = p.keys || [];
  const hasil = {};
  const tersimpan = {};
  keys.forEach(function(k){
    // Nilai rahasia tidak pernah dikirim -- cukup tanda apakah sudah tersimpan
    if (KUNCI_RAHASIA.indexOf(k) !== -1) { tersimpan[k] = !!norm(obj[k]); hasil[k] = undefined; return; }
    var v = obj[k];
    // Boolean: "true"/"false"/true/false → boolean
    if (v === true || v === 'TRUE' || v === 'true' || v === '1') hasil[k] = true;
    else if (v === false || v === 'FALSE' || v === 'false' || v === '0') hasil[k] = false;
    else if (v === undefined || v === '') hasil[k] = undefined;
    else hasil[k] = v;
  });
  hasil._rahasiaTersimpan = tersimpan;
  return {ok:true, data: hasil};
}

// Simpan banyak key sekaligus
function apiSimpanPengaturanBatch(p) {
  const data = p.data || {};
  // Cara bayar kasir (termasuk bayar TANPA PIN) hanya boleh diubah Admin/Mudir
  if (Object.keys(data).some(function(k){ return k.indexOf('KasirMode') === 0; }) && !adminAtauMudir(p.oleh)) {
    return {ok:false, error:'Pengaturan cara bayar kasir hanya bisa diubah Admin/Mudir.'};
  }
  const sh = getMasterSS().getSheetByName(SHEET_PENGATURAN);
  const rows = sh.getDataRange().getValues();
  // Token yang baru diisi menentukan penyedia "otomatis" (yang paling akhir diisi dipakai)
  if (nilaiSimpanPengaturan_('WablasToken', data.WablasToken)) data.WAPenyediaTerakhir = 'wablas';
  if (nilaiSimpanPengaturan_('FonnteToken', data.FonnteToken)) data.WAPenyediaTerakhir = 'fonnte';
  Object.keys(data).forEach(function(key) {
    var val = nilaiSimpanPengaturan_(key, data[key]);
    if (val === null) return; // kolom rahasia dikosongkan = tidak diubah
    var found = false;
    for (var i=1;i<rows.length;i++) {
      if (rows[i][0] === key) { sh.getRange(i+1,2).setValue(String(val)); rows[i][1] = String(val); found = true; break; }
    }
    if (!found) { sh.appendRow([key, String(val)]); rows.push([key, String(val)]); }
  });
  cacheHapus('pengaturan_v1'); // invalidasi seketika, sama seperti apiSimpanPengaturan
  return {ok:true};
}

// ============ SLIDE PENGUMUMAN (tampil di bagian atas aplikasi, disimpan di Master) ============
// Disimpan di Master (bukan per tahun ajaran) karena pengumuman sifatnya berlaku umum
// saat ini, bukan riwayat historis per tahun ajaran.
function getSlideList() {
  const cached = cacheAmbil('slidelist_v1');
  if (cached) return cached;
  const sh = getMasterSS().getSheetByName(SHEET_SLIDE);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  const hasil = rows.map((r,i) => ({
    rowIndex: i+2, judul: norm(r[0]), gambar: norm(r[1]), tautan: norm(r[2]),
    tampilUntuk: norm(r[3]) || 'Semua', urutan: Number(r[4])||0,
    aktif: r[5] === true || norm(r[5]).toLowerCase() === 'true'
  })).sort((a,b) => a.urutan - b.urutan);
  cacheSimpan('slidelist_v1', hasil, 300);
  return hasil;
}

// Dipakai frontend untuk menampilkan slide sesuai role yang sedang login. Hanya
// mengembalikan slide yang aktif & valid gambarnya -- ringan dan cepat.
function getSlideAktifUntukRole(level) {
  level = norm(level);
  return getSlideList().filter(s => s.aktif && s.gambar && (s.tampilUntuk === 'Semua' || s.tampilUntuk.split(',').map(norm).indexOf(level) !== -1));
}

function apiSaveSlide(p) {
  const gambar = norm(p.gambar);
  if (!gambar) return {ok:false, error:'URL Gambar wajib diisi'};
  const sh = getMasterSS().getSheetByName(SHEET_SLIDE);
  const aktifBool = (p.aktif === true || p.aktif === 'true');
  const baris = [norm(p.judul), gambar, norm(p.tautan), norm(p.tampilUntuk) || 'Semua', Number(p.urutan)||0, aktifBool];
  if (p.rowIndex && Number(p.rowIndex) > 1) {
    sh.getRange(Number(p.rowIndex), 1, 1, 6).setValues([baris]);
  } else {
    sh.appendRow(baris.concat([new Date()]));
  }
  cacheHapus('slidelist_v1'); // invalidasi seketika
  return {ok:true};
}

function apiDeleteSlide(p) {
  getMasterSS().getSheetByName(SHEET_SLIDE).deleteRow(Number(p.rowIndex));
  cacheHapus('slidelist_v1');
  return {ok:true};
}

// ============ ARTIKEL / BERITA (untuk halaman depan / website publik) ============
// hanyaPublished=true dipakai halaman depan publik (sebelum login) -- cuma tampilkan
// yang statusnya "Published". Admin/Mudir lihat SEMUA (termasuk Draft) untuk dikelola.
function getArtikelList(hanyaPublished) {
  const sh = getMasterSS().getSheetByName(SHEET_ARTIKEL);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  let list = rows.map((r,i) => ({
    rowIndex: i+2, judul: norm(r[0]), konten: norm(r[1]), gambar: norm(r[2]), kategori: norm(r[3]) || 'Berita',
    tanggalPublish: (r[4] instanceof Date) ? Utilities.formatDate(r[4], tz, 'yyyy-MM-dd') : norm(r[4]),
    penulis: norm(r[5]), status: norm(r[6]) || 'Draft'
  })).filter(a => a.judul);
  if (hanyaPublished) list = list.filter(a => a.status === 'Published');
  return list.sort((a,b) => (b.tanggalPublish||'').localeCompare(a.tanggalPublish||''));
}

function apiSaveArtikel(p) {
  const judul = norm(p.judul);
  if (!judul) return {ok:false, error:'Judul wajib diisi'};
  const sh = getMasterSS().getSheetByName(SHEET_ARTIKEL);
  const baris = [judul, norm(p.konten), norm(p.gambar), norm(p.kategori)||'Berita', p.tanggalPublish || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'), norm(p.penulis), norm(p.status)||'Draft'];
  if (p.rowIndex && Number(p.rowIndex) > 1) {
    sh.getRange(Number(p.rowIndex), 1, 1, 7).setValues([baris]);
  } else {
    sh.appendRow(baris.concat([new Date()]));
  }
  return {ok:true};
}

function apiDeleteArtikel(p) {
  getMasterSS().getSheetByName(SHEET_ARTIKEL).deleteRow(Number(p.rowIndex));
  return {ok:true};
}

// ============ FITUR BERANDA (Program Unggulan & Fasilitas, dengan foto, di halaman depan) ============
function getFiturBerandaList() {
  const sh = getMasterSS().getSheetByName(SHEET_FITUR_BERANDA);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.map((r,i) => ({
    rowIndex: i+2, kategori: norm(r[0])||'Program', judul: norm(r[1]), deskripsi: norm(r[2]), gambar: norm(r[3]), urutan: Number(r[4])||0
  })).filter(x => x.judul).sort((a,b) => a.urutan - b.urutan);
}

function apiSaveFiturBeranda(p) {
  const judul = norm(p.judul);
  if (!judul) return {ok:false, error:'Judul wajib diisi'};
  const sh = getMasterSS().getSheetByName(SHEET_FITUR_BERANDA);
  const baris = [norm(p.kategori)||'Program', judul, norm(p.deskripsi), norm(p.gambar), Number(p.urutan)||0];
  if (p.rowIndex && Number(p.rowIndex) > 1) {
    sh.getRange(Number(p.rowIndex), 1, 1, 5).setValues([baris]);
  } else {
    sh.appendRow(baris);
  }
  return {ok:true};
}

function apiDeleteFiturBeranda(p) {
  getMasterSS().getSheetByName(SHEET_FITUR_BERANDA).deleteRow(Number(p.rowIndex));
  return {ok:true};
}

// ============ ADMINISTRASI GURU: MODUL AJAR ============
// File modul ajar (Word/PDF) diunggah ke Google Drive lewat mekanisme yang sudah ada
// (apiUploadSlideImage -- hanya nama fungsi yang sama, file apapun bisa). Setelah URL
// Drive didapat, teks diekstrak dan dikirim ke Claude API untuk dibuat ringkasan.
// Ringkasan + isi lengkap tersimpan di sheet ModulAjar di Master Spreadsheet.

function getModulAjarList(mapel, kelas) {
  const sh = getMasterSS().getSheetByName(SHEET_MODUL_AJAR);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.map((r,i) => ({
    rowIndex:i+2, id:norm(r[0]), mapel:norm(r[1]), kelas:norm(r[2]), kurikulum:norm(r[3]),
    namaFile:norm(r[4]), kategori:norm(r[5]), urlAsli:norm(r[6]),
    ringkasanAI:norm(r[7]), isiLengkap:norm(r[8]),
    waktuUpload:r[9], diuploadOleh:norm(r[10])
  })).filter(x => x.namaFile && (!mapel || x.mapel===mapel) && (!kelas || x.kelas===kelas));
}

// Setelah file diunggah ke Drive (urlAsli sudah ada), ekstrak teks dari Drive
// menggunakan Google Docs API (untuk .docx) atau DriveApp text extraction (untuk PDF).
// Kemudian kirim ke Claude API untuk buat ringkasan + simpan hasilnya.
function apiSaveModulAjar(p) {
  const sh = getMasterSS().getSheetByName(SHEET_MODUL_AJAR);
  const id = p.id || 'MA' + Utilities.getUuid().replace(/-/g,'').substring(0,8).toUpperCase();
  const baris = [id, norm(p.mapel), norm(p.kelas), norm(p.kurikulum)||'Merdeka',
    norm(p.namaFile), norm(p.kategori)||'Modul Ajar', norm(p.urlAsli),
    norm(p.ringkasanAI)||'', norm(p.isiLengkap)||'', new Date(), norm(p.diuploadOleh)];

  if (p.rowIndex && Number(p.rowIndex) > 1) {
    sh.getRange(Number(p.rowIndex), 1, 1, baris.length).setValues([baris]);
    return {ok:true, id:id, rowIndex:Number(p.rowIndex)};
  } else {
    sh.appendRow(baris);
    return {ok:true, id:id, rowIndex:sh.getLastRow()};
  }
}

function apiDeleteModulAjar(p) {
  getMasterSS().getSheetByName(SHEET_MODUL_AJAR).deleteRow(Number(p.rowIndex));
  return {ok:true};
}

// Ekstrak teks dari file Google Drive (fileId), lalu kirim ke Claude API untuk
// dibuat ringkasan + simpan hasilnya ke baris ModulAjar.
// Proses ini hanya dipanggil sekali saat upload -- hasilnya disimpan permanen.
function apiProsesTeksModulAjar(p) {
  const rowIndex = Number(p.rowIndex);
  const fileId = norm(p.fileId);
  if (!fileId || !rowIndex) return {ok:false, error:'fileId dan rowIndex wajib diisi'};

  // Cek apakah Drive Advanced Service aktif -- wajib untuk ekstrak teks dari .docx/.pdf
  if (typeof Drive === 'undefined') {
    return {ok:false, error:'Drive API belum diaktifkan. Buka Apps Script Editor → Extensions → Apps Script → Services → tambahkan "Drive API" (v2). Setelah itu coba lagi.'};
  }


  try {
    // Konversi ke Google Docs untuk ekstrak teks bersih dari .docx / .pdf
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    const mimeType = blob.getContentType();

    if (mimeType === 'application/pdf') {
      const doc = Drive.Files.insert({title:'_tmp_extract_', mimeType:'application/vnd.google-apps.document'}, blob);
      teksIsi = DocumentApp.openById(doc.id).getBody().getText();
      Drive.Files.trash(doc.id);
    } else {
      // .docx dan format Office lainnya
      const docFile = Drive.Files.insert({title:'_tmp_extract_', mimeType:'application/vnd.google-apps.document'}, blob);
      teksIsi = DocumentApp.openById(docFile.id).getBody().getText();
      Drive.Files.trash(docFile.id);
    }
    // Batasi 12000 karakter untuk mencegah timeout
    if (teksIsi.length > 12000) teksIsi = teksIsi.substring(0, 12000) + '\n\n[...teks dipotong untuk keperluan ringkasan]';
  } catch(e) {
    return {ok:false, error:'Gagal mengekstrak teks dari file: ' + e.message};
  }

  // Panggil Claude API untuk buat ringkasan (pakai claude-sonnet-4-6 -- lebih cepat)
  let ringkasan = '';
  try {
    const resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method:'post', contentType:'application/json',
      headers:{'x-api-key': PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY') || '',
               'anthropic-version':'2023-06-01'},
      payload: JSON.stringify({
        model:'claude-sonnet-4-6', max_tokens:600,
        messages:[{role:'user', content:
          'Buat ringkasan singkat (maksimal 5 poin, masing-masing 1-2 kalimat) dari dokumen modul ajar/RPP berikut ini. ' +
          'Fokus pada: tujuan pembelajaran, materi utama, dan hal penting yang perlu diketahui guru. ' +
          'Gunakan Bahasa Indonesia yang jelas dan ringkas. Format: poin-poin dengan tanda • di awal.\n\n' +
          'DOKUMEN:\n' + teksIsi
        }]
      }),
      muteHttpExceptions:true
    });
    const hasil = JSON.parse(resp.getContentText());
    if (hasil.content && hasil.content[0]) ringkasan = hasil.content[0].text;
  } catch(e) {
    ringkasan = '(Ringkasan AI tidak tersedia -- ' + e.message + ')';
  }

  // Simpan isi lengkap + ringkasan ke sheet
  const sh = getMasterSS().getSheetByName(SHEET_MODUL_AJAR);
  sh.getRange(rowIndex, 8).setValue(ringkasan);    // kolom RingkasanAI
  sh.getRange(rowIndex, 9).setValue(teksIsi);      // kolom IsiLengkap
  return {ok:true, ringkasan:ringkasan, panjangTeks:teksIsi.length};
}

// ============ ADMINISTRASI GURU: RPP PERTEMUAN ============
function getRPPList(mapel, kelas) {
  const sh = getMasterSS().getSheetByName(SHEET_RPP_PERTEMUAN);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.map((r,i) => ({
    rowIndex:i+2, id:norm(r[0]), mapel:norm(r[1]), kelas:norm(r[2]), kurikulum:norm(r[3]),
    namaBab:norm(r[4]), noPertemuan:Number(r[5])||0, topik:norm(r[6]), alokasiJP:Number(r[7])||2,
    pendahuluan:norm(r[8]), inti:norm(r[9]), penutup:norm(r[10]),
    linkVideo:norm(r[11]), linkSlide:norm(r[12]), linkBukuAjar:norm(r[13]),
    catatanGuru:norm(r[14]), waktuInput:r[15], dibuatOleh:norm(r[16])
  })).filter(x => x.topik && (!mapel || x.mapel===mapel) && (!kelas || x.kelas===kelas))
    .sort((a,b) => a.noPertemuan - b.noPertemuan);
}

function apiSaveRPP(p) {
  const sh = getMasterSS().getSheetByName(SHEET_RPP_PERTEMUAN);
  const id = p.id || 'RPP' + Utilities.getUuid().replace(/-/g,'').substring(0,8).toUpperCase();
  const baris = [id, norm(p.mapel), norm(p.kelas), norm(p.kurikulum)||'Merdeka',
    norm(p.namaBab), Number(p.noPertemuan)||0, norm(p.topik), Number(p.alokasiJP)||2,
    norm(p.pendahuluan), norm(p.inti), norm(p.penutup),
    norm(p.linkVideo), norm(p.linkSlide), norm(p.linkBukuAjar),
    norm(p.catatanGuru), new Date(), norm(p.dibuatOleh)];

  if (p.rowIndex && Number(p.rowIndex) > 1) {
    sh.getRange(Number(p.rowIndex), 1, 1, baris.length).setValues([baris]);
  } else {
    sh.appendRow(baris);
  }
  return {ok:true, id:id};
}

function apiDeleteRPP(p) {
  getMasterSS().getSheetByName(SHEET_RPP_PERTEMUAN).deleteRow(Number(p.rowIndex));
  return {ok:true};
}

// Cari RPP pertemuan sebelum/sesudah dari yang sedang aktif.
function getRPPSebelahnya(mapel, kelas, noPertemuan, arah) {
  const list = getRPPList(mapel, kelas);
  const idx = list.findIndex(r => r.noPertemuan === noPertemuan);
  if (idx === -1) return null;
  const target = arah === 'sebelum' ? list[idx-1] : list[idx+1];
  return target || null;
}

// ============ ADMINISTRASI GURU: JURNAL MENGAJAR ============
function getDefaultJurnal(mapel) {
  const sh = getMasterSS().getSheetByName(SHEET_DEFAULT_JURNAL);
  if (!sh) return 'Pembelajaran berlangsung sesuai RPP. Santri mengikuti dengan tertib.';
  const rows = sh.getDataRange().getValues(); rows.shift();
  // Cari default khusus mapel dulu, kalau tidak ada pakai __UMUM__
  const khusus = rows.find(r => norm(r[0]).toLowerCase() === norm(mapel).toLowerCase());
  if (khusus && khusus[1]) return norm(khusus[1]);
  const umum = rows.find(r => norm(r[0]) === '__UMUM__');
  return umum ? norm(umum[1]) : 'Pembelajaran berlangsung sesuai RPP. Santri mengikuti dengan tertib.';
}

function getJurnalHariIni(tanggal, pengampu) {
  const sh = getAktifSS().getSheetByName(SHEET_JURNAL_MENGAJAR);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  return rows.map((r,i) => ({
    rowIndex:i+2, tanggal:r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]),
    hari:norm(r[1]), mapel:norm(r[2]), kelas:norm(r[3]), jamKe:norm(r[4]), pengampu:norm(r[5]),
    idRPP:norm(r[6]), materiDisampaikan:norm(r[7]), metode:norm(r[8]),
    hambatan:norm(r[9]), tindakLanjut:norm(r[10]), catatanTambahan:norm(r[11]),
    statusJurnal:norm(r[12]), waktuInput:r[13]
  })).filter(x => x.tanggal === tanggal && (!pengampu || x.pengampu === pengampu));
}

// Riwayat jurnal seorang guru dalam rentang tanggal -- dipakai halaman
// "Riwayat Jurnal" di dashboard Guru, dan rekap Admin/Mudir.
function getJurnalGuru(pengampu, tglMulai, tglAkhir) {
  const sh = getAktifSS().getSheetByName(SHEET_JURNAL_MENGAJAR);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  return rows.map((r,i) => ({
    rowIndex:i+2,
    tanggal:r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]),
    hari:norm(r[1]), mapel:norm(r[2]), kelas:norm(r[3]), jamKe:norm(r[4]), pengampu:norm(r[5]),
    idRPP:norm(r[6]), materiDisampaikan:norm(r[7]), metode:norm(r[8]),
    hambatan:norm(r[9]), tindakLanjut:norm(r[10]), catatanTambahan:norm(r[11]),
    statusJurnal:norm(r[12])
  })).filter(x => {
    if (norm(pengampu) && x.pengampu !== norm(pengampu)) return false;
    if (tglMulai && x.tanggal < tglMulai) return false;
    if (tglAkhir && x.tanggal > tglAkhir) return false;
    return true;
  }).sort((a,b) => b.tanggal.localeCompare(a.tanggal));
}

// Rekap jurnal semua guru -- dipakai Admin/Mudir untuk monitoring
function getRekapJurnalAdmin(tglMulai, tglAkhir, pengampu, mapel) {
  return getJurnalGuru(pengampu||'', tglMulai, tglAkhir).filter(function(j){
    return !mapel || j.mapel === norm(mapel);
  });
}

// Cek status jurnal hari ini: siapa yang belum mengisi (berdasarkan sesi absensi yg sudah ada)
function getStatusJurnalHariIni() {
  const ss = getAktifSS();
  const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  const absenRows = nilaiCatatanUnik_(ss.getSheetByName(SHEET_ABSENSI)); absenRows.shift();
  const sesiAda = {};
  absenRows.forEach(function(r){
    const td = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
    if (td !== today) return;
    const key = norm(r[5])+'|'+norm(r[3])+'|'+norm(r[4]);
    sesiAda[key] = {pengampu:norm(r[5]), mapel:norm(r[3]), kelas:norm(r[4])};
  });

  const jurnalAda = {};
  const shJ = ss.getSheetByName(SHEET_JURNAL_MENGAJAR);
  if (shJ) {
    const jRows = nilaiCatatanUnik_(shJ); jRows.shift();
    jRows.forEach(function(r){
      const td = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
      if (td !== today) return;
      jurnalAda[norm(r[5])+'|'+norm(r[2])+'|'+norm(r[3])] = norm(r[12]);
    });
  }

  const result = [];
  Object.keys(sesiAda).forEach(function(key){
    const s = sesiAda[key];
    const statusJurnal = jurnalAda[key] || '';
    result.push({
      pengampu: s.pengampu, mapel: s.mapel, kelas: s.kelas,
      sudahIsiJurnal: !!statusJurnal,
      statusJurnal: statusJurnal || 'Belum diisi'
    });
  });
  return result;
}

// Notif badge untuk navbar: jumlah pengajuan saldo pending + sesi belum isi jurnal hari ini
function getNotifBadge() {
  let jurnalBelumIsi = 0, pengajuanPending = 0;
  try {
    const statusJurnal = getStatusJurnalHariIni();
    jurnalBelumIsi = statusJurnal.filter(function(s){ return !s.sudahIsiJurnal; }).length;
  } catch(e) {}
  try {
    const shTarik = getAktifKantinSS().getSheetByName(SHEET_PENGAJUAN_TARIK);
    if (shTarik) {
      const rows = shTarik.getDataRange().getValues(); rows.shift();
      pengajuanPending += rows.filter(function(r){ return norm(r[5])==='Pending'; }).length;
    }
    const shTopUp = getAktifKantinSS().getSheetByName(SHEET_PENGAJUAN_TOPUP);
    if (shTopUp) {
      const rows2 = shTopUp.getDataRange().getValues(); rows2.shift();
      pengajuanPending += rows2.filter(function(r){ return norm(r[6])==='Pending'; }).length;
    }
  } catch(e) {}
  return { jurnalBelumIsi, pengajuanPending, total: jurnalBelumIsi + pengajuanPending };
}

// Admin tambah saldo santri langsung tanpa perlu proses WA/pengajuan
// ============ KANTIN: FITUR BARU ============

// ---- Helper: catat pendapatan pondok ----
function catatPendapatanPondok(jenis, keterangan, nominal, nisn, namaSantri, referensi) {
  const ssKantin = getAktifKantinSS();
  let shPP = ssKantin.getSheetByName(SHEET_PENDAPATAN_PONDOK);
  if (!shPP) {
    shPP = ssKantin.insertSheet(SHEET_PENDAPATAN_PONDOK);
    shPP.appendRow(['Tanggal','Waktu','Jenis','Keterangan','Nominal','NISN Santri','Nama Santri','Referensi']);
    shPP.setFrozenRows(1);
  }
  const tz = Session.getScriptTimeZone();
  const tgl = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const wkt = Utilities.formatDate(new Date(), tz, 'HH:mm:ss');
  shPP.appendRow([tgl, wkt, jenis, keterangan, nominal, nisn||'', namaSantri||'', referensi||'']);

  // Otomatis masuk ke Keuangan Bendahara juga (KasUmum di Master SS)
  try {
    const masterSS = getMasterSS();
    let shKas = masterSS.getSheetByName(SHEET_KAS_UMUM);
    if (!shKas) { setupSheetKeuangan(masterSS); shKas = masterSS.getSheetByName(SHEET_KAS_UMUM); }
    const noRef = 'KANTIN-' + tgl.replace(/-/g,'') + '-' + (shKas.getLastRow()).toString().padStart(4,'0');
    shKas.appendRow([noRef, new Date(tgl), 'Pemasukan', 'Pendapatan Kantin',
      keterangan + (namaSantri?' ('+namaSantri+')':''), nominal, 'Sistem Kantin',
      'KWT-'+noRef, '']);
  } catch(e) { Logger.log('Gagal catat ke KasUmum: ' + e.message); }
}

// ---- Biaya Admin Top-up ----
function getBiayaAdminTopup() {
  return Number(PROP.getProperty(BIAYA_ADMIN_TOPUP_KEY)) || 0;
}
function apiSetBiayaAdminTopup(p) {
  const nominal = Number(p.nominal) || 0;
  if (nominal < 0) return {ok:false, error:'Biaya admin tidak boleh negatif'};
  PROP.setProperty(BIAYA_ADMIN_TOPUP_KEY, String(nominal));
  return {ok:true, nominal:nominal};
}

// ---- Tarik Saldo Santri oleh Bendahara ----
function apiTarikSaldoSantriBendahara(p) {
  const nisn = norm(p.nisn), nominal = Number(p.nominal)||0;
  const keterangan = norm(p.keterangan)||'Tarik Tunai';
  const oleh = norm(p.oleh)||'Bendahara';
  if (!nisn || nominal <= 0) return {ok:false, error:'NISN dan nominal wajib diisi'};

  const lock = kunciTransaksi_();
  try { lock.waitLock(30000); } catch(e) { return {ok:false, error:'Server sedang memproses transaksi lain. Data BELUM tersimpan -- silakan tekan tombolnya sekali lagi.'}; }
  try {
    const ss = getAktifSS();
    const shSantri = ss.getSheetByName(SHEET_SANTRI);
    const rows = shSantri.getDataRange().getValues();
    const header = rows[0];
    const iSaldo = header.indexOf('Saldo Kantin'), iNoWa = 4;
    for (let i=1;i<rows.length;i++) {
      if (norm(rows[i][0]) !== nisn) continue;
      const nama = norm(rows[i][1]);
      const saldoSebelum = Number(rows[i][iSaldo])||0;
      if (saldoSebelum < nominal) return {ok:false, error:'Saldo tidak mencukupi (saldo: Rp'+saldoSebelum.toLocaleString('id-ID')+')'};
      const saldoSekarang = saldoSebelum - nominal;
      shSantri.getRange(i+1, iSaldo+1).setValue(saldoSekarang);
      const tz = Session.getScriptTimeZone();
      const tgl = Utilities.formatDate(new Date(),tz,'yyyy-MM-dd');
      const wkt = Utilities.formatDate(new Date(),tz,'HH:mm:ss');
      // Catat ke TransaksiKantin
      getAktifKantinSS().getSheetByName(SHEET_TRANSAKSI_KANTIN).appendRow(
        [tgl, wkt, nisn, nama, nominal, 'Penarikan', keterangan, 1, 0, oleh, 0, saldoSebelum, saldoSekarang]);
      // Kirim WA ke ortu kalau WhatsApp (Wablas) diatur
      const noWa = norm(rows[i][iNoWa]);
      if (noWa) {
        const pesan = 'Assalamualaikum Wr. Wb.\n\nYth. Orang Tua/Wali Santri *'+nama+'*\n\n' +
          'Informasi penarikan saldo:\n' +
          'Keterangan: *'+keterangan+'*\n' +
          'Nominal: *Rp'+nominal.toLocaleString('id-ID')+'*\n' +
          'Saldo sebelum: Rp'+saldoSebelum.toLocaleString('id-ID')+'\n' +
          'Saldo sekarang: *Rp'+saldoSekarang.toLocaleString('id-ID')+'*\n\n' +
          'Dicatat oleh: '+oleh+'\n' +
          'Waktu: '+tgl+' '+wkt+'\n\nJazakumullah khairan.';
        kirimWAKategori_('saldo_tarik', noWa, pesan);
      }
      try {
        kirimPushKeWali(nisn, '\uD83D\uDCB8 Penarikan Saldo',
          nama + ': ' + keterangan + ' ' + rp(nominal) + '. Sisa saldo: ' + rp(saldoSekarang) + '.');
      } catch(e) { Logger.log('Notif wali tarik saldo gagal: ' + e.message); }
      return {ok:true, nama:nama, saldoSebelum:saldoSebelum, saldoSekarang:saldoSekarang};
    }
    return {ok:false, error:'Santri tidak ditemukan'};
  } finally { lock.releaseLock(); }
}

// ---- Rekap Pendapatan Pondok dari Kantin ----
function getRekapPendapatanPondok(tglMulai, tglAkhir, jenis) {
  const ssKantin = getAktifKantinSS();
  const shPP = ssKantin.getSheetByName(SHEET_PENDAPATAN_PONDOK);
  if (!shPP) return [];
  const rows = shPP.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  return rows.filter(r => {
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
    if (tglMulai && tgl < tglMulai) return false;
    if (tglAkhir && tgl > tglAkhir) return false;
    if (jenis && norm(r[2]) !== jenis) return false;
    return !!tgl;
  }).map((r,i) => ({
    rowIndex:i+2,
    tanggal: r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]),
    waktu:formatWaktu(r[1],tz), jenis:norm(r[2]), keterangan:norm(r[3]),
    nominal:Number(r[4])||0, nisn:norm(r[5]), namaSantri:norm(r[6]), referensi:norm(r[7])
  })).sort((a,b) => b.tanggal.localeCompare(a.tanggal));
}

// ---- 5 Transaksi Terbaru Santri (untuk dashboard Wali) ----
function get5TransaksiTerbaruSantri(nisn) {
  nisn = norm(nisn);
  const sh = getAktifKantinSS().getSheetByName(SHEET_TRANSAKSI_KANTIN);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  return rows.filter(r => norm(r[2]) === nisn)
    .map(r => ({
      tanggal: r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]),
      waktu:formatWaktu(r[1],tz), nominal:Number(r[4])||0,
      kategori:norm(r[5]), keterangan:norm(r[6]),
      saldoSebelum:Number(r[11])||0, saldoSekarang:Number(r[12])||0
    }))
    .sort((a,b) => (b.tanggal+b.waktu).localeCompare(a.tanggal+a.waktu))
    .slice(0, 5);
}

// ---- Semua Transaksi Santri (untuk tombol Lihat Semua di Wali) ----
function getAllTransaksiSantri(nisn, tglMulai, tglAkhir) {
  nisn = norm(nisn);
  const sh = getAktifKantinSS().getSheetByName(SHEET_TRANSAKSI_KANTIN);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  return rows.filter(r => {
    if (norm(r[2]) !== nisn) return false;
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
    if (tglMulai && tgl < tglMulai) return false;
    if (tglAkhir && tgl > tglAkhir) return false;
    return true;
  }).map(r => ({
    tanggal: r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]),
    waktu:formatWaktu(r[1],tz), nominal:Number(r[4])||0,
    kategori:norm(r[5]), keterangan:norm(r[6]),
    saldoSebelum:Number(r[11])||0, saldoSekarang:Number(r[12])||0
  })).sort((a,b) => (b.tanggal+b.waktu).localeCompare(a.tanggal+a.waktu));
}

// ---- Riwayat MUTASI SALDO (Tarik + Tambah saja, bukan belanja) ----
function getRiwayatMutasiSaldoSantri(nisn, tglMulai, tglAkhir) {
  nisn = norm(nisn);
  const sh = getAktifKantinSS().getSheetByName(SHEET_TRANSAKSI_KANTIN);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  const KATEGORI_MUTASI = ['Top Up Saldo','Penarikan'];
  return rows.filter(r => {
    if (norm(r[2]) !== nisn) return false;
    // Kategori kosong pada data lama ditebak dari kolom lain, supaya riwayat mutasi
    // saldo tidak tampil kosong untuk transaksi yang sebenarnya ada.
    const kategoriBaris = norm(r[5]) || tebakKategoriTransaksi(r[6], r[9], r[10]);
    if (KATEGORI_MUTASI.indexOf(kategoriBaris) === -1) return false;
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
    if (tglMulai && tgl < tglMulai) return false;
    if (tglAkhir && tgl > tglAkhir) return false;
    return true;
  }).map(r => ({
    tanggal: r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]),
    waktu: norm(r[1]), nominal: Number(r[4])||0,
    kategori: norm(r[5]), keterangan: norm(r[6]),
    dicatatOleh: norm(r[9]),
    saldoSebelum: Number(r[11])||0, saldoSekarang: Number(r[12])||0
  })).sort((a,b) => (b.tanggal+b.waktu).localeCompare(a.tanggal+a.waktu));
}

// ---- Riwayat MUTASI SALDO semua santri (untuk Bendahara/Admin) ----
function getRiwayatMutasiSaldoAdmin(tglMulai, tglAkhir) {
  const sh = getAktifKantinSS().getSheetByName(SHEET_TRANSAKSI_KANTIN);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  const KATEGORI_MUTASI = ['Top Up Saldo','Penarikan'];
  return rows.filter(r => {
    // Kategori kosong pada data lama ditebak dari kolom lain (lihat catatan di
    // tebakKategoriTransaksi), supaya rekap mutasi saldo Admin tidak tampil kosong.
    const kategoriBaris = norm(r[5]) || tebakKategoriTransaksi(r[6], r[9], r[10]);
    if (KATEGORI_MUTASI.indexOf(kategoriBaris) === -1) return false;
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
    if (tglMulai && tgl < tglMulai) return false;
    if (tglAkhir && tgl > tglAkhir) return false;
    return true;
  }).map(r => ({
    tanggal: r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]),
    waktu: norm(r[1]), nisn: norm(r[2]), namaSantri: norm(r[3]),
    nominal: Number(r[4])||0, kategori: norm(r[5]), keterangan: norm(r[6]),
    dicatatOleh: norm(r[9]),
    saldoSebelum: Number(r[11])||0, saldoSekarang: Number(r[12])||0
  })).sort((a,b) => (b.tanggal+b.waktu).localeCompare(a.tanggal+a.waktu));
}

function apiTambahSaldoSantriManual(p) {
  const nisn = norm(p.nisn), nominal = Number(p.nominal)||0, oleh = norm(p.oleh);
  const keterangan = norm(p.keterangan) || 'Top-Up Saldo Kantin';
  if (!nisn || nominal <= 0) return {ok:false, error:'NISN dan nominal wajib diisi'};
  const lock = kunciTransaksi_();
  try { lock.waitLock(30000); } catch(e) { return {ok:false, error:'Server sedang memproses transaksi lain. Data BELUM tersimpan -- silakan tekan tombolnya sekali lagi.'}; }
  try {
    const ss = getAktifSS();
    const shSantri = ss.getSheetByName(SHEET_SANTRI);
    const rows = shSantri.getDataRange().getValues();
    const header = rows[0];
    const iSaldo = header.indexOf('Saldo Kantin');
    const iNoWa = header.indexOf('No WA Ortu') > -1 ? header.indexOf('No WA Ortu') : 4;
    for (let i=1;i<rows.length;i++) {
      if (norm(rows[i][0]) === nisn) {
        const nama = norm(rows[i][1]);
        const saldoSebelum = Number(rows[i][iSaldo])||0;
        const saldoBaru = saldoSebelum + nominal;
        shSantri.getRange(i+1, iSaldo+1).setValue(saldoBaru);
        // Catat ke TransaksiKantin
        const tz = Session.getScriptTimeZone();
        const tgl = Utilities.formatDate(new Date(),tz,'yyyy-MM-dd');
        const wkt = Utilities.formatDate(new Date(),tz,'HH:mm:ss');
        const shTK = getAktifKantinSS().getSheetByName(SHEET_TRANSAKSI_KANTIN);
        shTK.appendRow([tgl, wkt, nisn, nama, nominal, 'Top Up Saldo',
          keterangan + ' (oleh ' + oleh + ')', 1, 0, '', 0, saldoSebelum, saldoBaru]);
        // Kirim notifikasi WA ke orang tua
        let waKirim = false;
        const noWa = norm(rows[i][iNoWa]);
        if (noWa) {
          try {
            const pesan = 'Assalamualaikum Wr. Wb.\n\nYth. Orang Tua/Wali Santri *' + nama + '*\n\n' +
              'Informasi penambahan saldo kantin:\n' +
              'Keterangan: *' + keterangan + '*\n' +
              'Nominal: *Rp' + nominal.toLocaleString('id-ID') + '*\n' +
              'Saldo sebelum: Rp' + saldoSebelum.toLocaleString('id-ID') + '\n' +
              'Saldo sekarang: *Rp' + saldoBaru.toLocaleString('id-ID') + '*\n\n' +
              'Dicatat oleh: ' + oleh + '\n' +
              'Waktu: ' + tgl + ' ' + wkt + '\n\nJazakumullah khairan.';
            kirimWAKategori_('saldo_tambah', noWa, pesan);
            waKirim = true;
          } catch(e) { Logger.log('Gagal kirim WA: ' + e.message); }
        }
        try {
          kirimPushKeWali(nisn, '\uD83D\uDCB0 Saldo Ditambahkan',
            nama + ': ' + keterangan + ' ' + rp(nominal) + '. Saldo sekarang: ' + rp(saldoBaru) + '.');
        } catch(e) { Logger.log('Notif wali top up gagal: ' + e.message); }
        return {ok:true, saldoBaru:saldoBaru, saldoSebelum:saldoSebelum, nama:nama, waKirim:waKirim};
      }
    }
    return {ok:false, error:'Santri tidak ditemukan'};
  } finally { lock.releaseLock(); }
}

function apiSimpanJurnal(p) {
  const sh = getAktifSS().getSheetByName(SHEET_JURNAL_MENGAJAR);
  if (!sh) return {ok:false, error:'Sheet tidak ditemukan. Coba jalankan Migrasi Skema di Admin.'};

  const tz = Session.getScriptTimeZone();
  const tanggal = norm(p.tanggal) || Utilities.formatDate(new Date(),tz,'yyyy-MM-dd');
  const hari = norm(p.hari) || ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][new Date().getDay()];
  const status = norm(p.statusJurnal) || 'Diisi Guru';

  // Cek apakah sudah ada jurnal untuk sesi ini (tanggal+mapel+kelas+pengampu)
  const rows = sh.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) {
    const td = rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0],tz,'yyyy-MM-dd') : norm(rows[i][0]);
    if (td===tanggal && norm(rows[i][2])===norm(p.mapel) && norm(rows[i][3])===norm(p.kelas) && norm(rows[i][5])===norm(p.pengampu)) {
      sh.getRange(i+1,1,1,14).setValues([[tanggal,hari,norm(p.mapel),norm(p.kelas),norm(p.jamKe),norm(p.pengampu),
        norm(p.idRPP),norm(p.materiDisampaikan),norm(p.metode),norm(p.hambatan),norm(p.tindakLanjut),
        norm(p.catatanTambahan),status,new Date()]]);
      return {ok:true, mode:'update'};
    }
  }
  sh.appendRow([tanggal,hari,norm(p.mapel),norm(p.kelas),norm(p.jamKe),norm(p.pengampu),
    norm(p.idRPP),norm(p.materiDisampaikan),norm(p.metode),norm(p.hambatan),norm(p.tindakLanjut),
    norm(p.catatanTambahan),status,new Date()]);
  return {ok:true, mode:'insert'};
}

// Trigger otomatis: dijalankan tiap malam (jam 23:00) untuk mengisi jurnal default
// pada sesi absensi yang guru lupa isi jurnalnya hari itu.
function isiJurnalDefaultOtomatis() {
  const ss = getAktifSS();
  const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const hari = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][new Date().getDay()];

  // Ambil semua sesi absensi hari ini
  const shAbsen = ss.getSheetByName(SHEET_ABSENSI);
  const absenRows = nilaiCatatanUnik_(shAbsen); absenRows.shift();
  const sesiHariIni = {};
  absenRows.forEach(r => {
    const td = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
    if (td !== today) return;
    const kunci = norm(r[3])+'|'+norm(r[4])+'|'+norm(r[5]); // mapel|kelas|pengampu
    sesiHariIni[kunci] = {mapel:norm(r[3]), kelas:norm(r[4]), jamKe:norm(r[2]), pengampu:norm(r[5])};
  });

  // Ambil jurnal yang sudah diisi hari ini
  const jurnalAda = {};
  const jurnalList = getJurnalHariIni(today, '');
  jurnalList.forEach(j => { jurnalAda[j.mapel+'|'+j.kelas+'|'+j.pengampu] = true; });

  // Isi jurnal default untuk sesi yang belum punya jurnal
  let diisi = 0;
  Object.keys(sesiHariIni).forEach(kunci => {
    if (jurnalAda[kunci]) return;
    const sesi = sesiHariIni[kunci];
    const teksDefault = getDefaultJurnal(sesi.mapel);
    apiSimpanJurnal({
      tanggal:today, hari:hari, mapel:sesi.mapel, kelas:sesi.kelas, jamKe:sesi.jamKe,
      pengampu:sesi.pengampu, idRPP:'', materiDisampaikan:teksDefault,
      metode:'Sesuai RPP', hambatan:'-', tindakLanjut:'-', catatanTambahan:'',
      statusJurnal:'Default Otomatis'
    });
    diisi++;
  });
  Logger.log('Jurnal default otomatis: ' + diisi + ' sesi diisi.');
  return diisi;
}

// ============ ADMINISTRASI GURU: SOP ============
function getSOPList(kategori) {
  const sh = getMasterSS().getSheetByName(SHEET_SOP);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.map((r,i) => ({rowIndex:i+2, id:norm(r[0]), judul:norm(r[1]), kategori:norm(r[2]), isi:norm(r[3]), urutan:Number(r[4])||0}))
    .filter(x => x.judul && (!kategori || x.kategori===kategori))
    .sort((a,b) => a.urutan-b.urutan);
}

function apiSaveSOP(p) {
  const sh = getMasterSS().getSheetByName(SHEET_SOP);
  const id = p.id || 'SOP' + Utilities.getUuid().replace(/-/g,'').substring(0,8).toUpperCase();
  const baris = [id, norm(p.judul), norm(p.kategori)||'Mengajar', norm(p.isi), Number(p.urutan)||1, new Date()];
  if (p.rowIndex && Number(p.rowIndex) > 1) sh.getRange(Number(p.rowIndex),1,1,6).setValues([baris]);
  else sh.appendRow(baris);
  return {ok:true, id:id};
}

function apiDeleteSOP(p) { getMasterSS().getSheetByName(SHEET_SOP).deleteRow(Number(p.rowIndex)); return {ok:true}; }

// ============ ADMINISTRASI GURU: DEFAULT JURNAL ============
function getDefaultJurnalList() {
  const sh = getMasterSS().getSheetByName(SHEET_DEFAULT_JURNAL);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.map((r,i) => ({rowIndex:i+2, mapel:norm(r[0]), teksDefault:norm(r[1])}));
}

function apiSaveDefaultJurnal(p) {
  const sh = getMasterSS().getSheetByName(SHEET_DEFAULT_JURNAL);
  if (!sh) return {ok:false, error:'Sheet tidak ditemukan. Coba jalankan Migrasi Skema di Admin.'};

  const mapel = norm(p.mapel) || '__UMUM__';
  const rows = sh.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) {
    if (norm(rows[i][0]) === mapel) { sh.getRange(i+1,2).setValue(norm(p.teksDefault)); sh.getRange(i+1,3).setValue(new Date()); return {ok:true, mode:'update'}; }
  }
  sh.appendRow([mapel, norm(p.teksDefault), new Date()]);
  return {ok:true, mode:'insert'};
}

function apiDeleteDefaultJurnal(p) {
  const sh = getMasterSS().getSheetByName(SHEET_DEFAULT_JURNAL);
  if (!sh) return {ok:false, error:'Sheet tidak ditemukan. Coba jalankan Migrasi Skema di Admin.'};

  const rows = sh.getDataRange().getValues();
  if (norm(rows[Number(p.rowIndex)-1][0]) === '__UMUM__') return {ok:false, error:'Default umum tidak boleh dihapus, hanya boleh diedit.'};
  sh.deleteRow(Number(p.rowIndex));
  return {ok:true};
}

// Daftarkan trigger otomatis pengisian jurnal default (dipanggil sekali dari setupAwal)
function setupTriggerJurnalDefault() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction()==='isiJurnalDefaultOtomatis') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('isiJurnalDefaultOtomatis').timeBased().atHour(23).everyDays(1).inTimezone(Session.getScriptTimeZone()).create();
}

// ============ KANTIN: MASTER BARANG (satu database yang sama dengan Absensi) ============
// Kolom "Foto" ditambahkan otomatis di posisi terakhir kalau belum ada, sehingga sheet
// Barang yang sudah berjalan tidak perlu diubah manual dan kolom lama tidak bergeser.
function pastikanKolomFotoBarang(sh) {
  try {
    const header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
    if (header.indexOf('Foto') !== -1) return header.indexOf('Foto') + 1;
    const kolomBaru = header.length + 1;
    sh.getRange(1, kolomBaru).setValue('Foto');
    return kolomBaru;
  } catch (e) {
    return 6; // posisi default kalau gagal membaca header
  }
}

function getBarangList() {
  const sh = getAktifKantinSS().getSheetByName(SHEET_BARANG);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.map((r,i) => ({
    rowIndex: i+2, nama: norm(r[0]), harga: Number(r[1])||0, potongan: Number(r[2])||0,
    pemilik: norm(r[3]), noWaPemilik: norm(r[4]), foto: norm(r[5])
  })).filter(x => x.nama);
}

// Potongan untuk pondok dari tiap barang kantin. Dihitung dari harga bersih yang
// ingin diterima pemilik: potongan = persen x harga bersih (default 10%, artinya
// tiap Rp1.000 dipotong Rp100). Santri membayar harga bersih + potongan.
//
// Sengaja dihitung DI SERVER, bukan di aplikasi, supaya besarannya seragam untuk
// semua pemilik dan tidak bisa diubah dari sisi perangkat.
function persenPotonganKantin() {
  const p = getPengaturan();
  const v = Number(p.PersenPotonganKantin);
  return (v > 0 && v < 100) ? v : 10;
}

function hitungPotonganKantin(hargaBersih) {
  const bersih = Number(hargaBersih) || 0;
  if (bersih <= 0) return 0;
  return Math.round(bersih * persenPotonganKantin() / 100);
}

function apiSaveBarang(p) {
  const nama = norm(p.nama);
  if (!nama) return {ok:false, error:'Nama barang wajib diisi'};

  // hargaBersih = uang yang diterima pemilik. Harga jual ke santri = bersih + potongan.
  // Cara lama (mengirim 'harga' langsung) tetap didukung supaya pemanggil lama -- kalau
  // masih ada -- tidak rusak.
  let hargaBersih = Number(p.hargaBersih);
  let potongan, hargaJual;

  if (hargaBersih > 0) {
    // Mode potongan hanya boleh ditentukan Admin/Mudir. Pengecualian: '__warisan__'
    // adalah penanda internal dari apiSaveBarangSaya yang meneruskan pengaturan yang
    // SUDAH ditetapkan Admin sebelumnya -- bukan pilihan baru dari pemilik.
    const bolehAturPotongan = (norm(p.oleh) === '__warisan__') || adminAtauMudir(p.oleh);
    const mode = bolehAturPotongan ? norm(p.modePotongan) : '';

    if (mode === 'pondok') {
      // Barang milik pondok: seluruh uang masuk ke pondok, pemilik tidak menerima apa pun.
      // Di sini hargaBersih diperlakukan sebagai harga jual apa adanya.
      hargaJual = hargaBersih;
      potongan = hargaBersih;
    } else if (mode === 'nol') {
      hargaJual = hargaBersih;
      potongan = 0;
    } else if (mode === 'manual') {
      potongan = Math.max(0, Number(p.potonganManual) || 0);
      hargaJual = hargaBersih + potongan;
    } else {
      potongan = hitungPotonganKantin(hargaBersih);
      hargaJual = hargaBersih + potongan;
    }
  } else {
    hargaJual = Number(p.harga) || 0;
    potongan = Number(p.potongan) || 0;
  }

  if (hargaJual <= 0) return {ok:false, error:'Harga wajib diisi dan lebih dari 0'};
  if (potongan > hargaJual) return {ok:false, error:'Potongan tidak boleh lebih besar dari harga jual.'};

  const sh = getAktifKantinSS().getSheetByName(SHEET_BARANG);
  pastikanKolomFotoBarang(sh);
  const baris = [nama, hargaJual, potongan, norm(p.pemilik), norm(p.noWaPemilik), norm(p.foto)];
  if (p.rowIndex && Number(p.rowIndex) > 1) {
    sh.getRange(Number(p.rowIndex), 1, 1, 6).setValues([baris]);
  } else {
    sh.appendRow(baris);
  }
  return {ok:true, hargaJual: hargaJual, potongan: potongan};
}

// Verifikasi bahwa nama pengirim benar-benar Admin atau Mudir menurut RoleAkses.
// Dipakai untuk membatasi pengaturan potongan manual -- pemeriksaannya di server,
// bukan hanya menyembunyikan pilihan di tampilan.
function adminAtauMudir(nama) {
  nama = norm(nama);
  if (!nama) return false;
  try {
    const sh = getAktifSS().getSheetByName(SHEET_ROLE);
    if (!sh) return false;
    const rows = sh.getDataRange().getValues(); rows.shift();
    return rows.some(function(r){
      if (normNama(norm(r[0])) !== normNama(nama)) return false;
      const level = norm(r[3]);
      return level.indexOf('Admin') !== -1 || level.indexOf('Mudir') !== -1;
    });
  } catch (e) { return false; }
}

// ---- Versi khusus Pemilik Barang: hanya boleh mengelola barang miliknya sendiri ----
// Nama pemilik diverifikasi ke RoleAkses, dan untuk edit/hapus dipastikan barangnya
// memang miliknya -- supaya seorang pemilik tidak bisa mengubah dagangan pemilik lain.
function pemilikBarangTerdaftar(nama) {
  nama = norm(nama);
  if (!nama) return false;
  const sh = getAktifSS().getSheetByName(SHEET_ROLE);
  if (!sh) return false;
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.some(function(r){
    return normNama(norm(r[0])) === normNama(nama) && norm(r[3]).indexOf('PemilikBarang') !== -1;
  });
}

function barangMilik(rowIndex, pemilik) {
  const sh = getAktifKantinSS().getSheetByName(SHEET_BARANG);
  const baris = Number(rowIndex);
  if (!(baris > 1) || baris > sh.getLastRow()) return false;
  const nilai = sh.getRange(baris, 1, 1, 5).getValues()[0];
  return normNama(norm(nilai[3])) === normNama(norm(pemilik));
}

function apiSaveBarangSaya(p) {
  const pemilik = norm(p.pemilik);
  if (!pemilikBarangTerdaftar(pemilik)) {
    return {ok:false, error:'Akun Anda tidak terdaftar sebagai Pemilik Barang.'};
  }
  if (p.rowIndex && Number(p.rowIndex) > 1 && !barangMilik(p.rowIndex, pemilik)) {
    return {ok:false, error:'Barang ini bukan milik Anda, tidak bisa diubah.'};
  }

  // Kalau Admin/Mudir sudah menetapkan potongan khusus untuk barang ini (barang milik
  // pondok, atau dibebaskan dari potongan), pengaturan itu DIPERTAHANKAN saat pemilik
  // mengedit. Tanpa ini, pemilik yang sekadar mengganti foto akan membuat potongannya
  // diam-diam kembali ke hitungan otomatis -- dan pemasukan pondok jadi salah.
  let modeWarisan = '', potonganWarisan = 0;
  if (p.rowIndex && Number(p.rowIndex) > 1) {
    try {
      const shB = getAktifKantinSS().getSheetByName(SHEET_BARANG);
      const lama = shB.getRange(Number(p.rowIndex), 1, 1, 3).getValues()[0];
      const hargaLama = Number(lama[1]) || 0;
      const potLama = Number(lama[2]) || 0;
      const bersihLama = hargaLama - potLama;
      if (potLama > 0 && potLama === hargaLama) {
        modeWarisan = 'pondok';               // seluruhnya milik pondok
      } else if (potLama === 0) {
        modeWarisan = 'nol';                  // sengaja dibebaskan dari potongan
      } else if (potLama !== hitungPotonganKantin(bersihLama)) {
        modeWarisan = 'manual';               // nominal khusus dari Admin
        potonganWarisan = potLama;
      }
    } catch (e) { /* gagal baca: pakai perhitungan otomatis */ }
  }

  // Pemilik dipaksa ke namanya sendiri, apa pun yang dikirim aplikasi.
  // 'oleh' sengaja tidak diisi dari p: pemilik tidak boleh menentukan mode potongan
  // sendiri, hanya mewarisi yang sudah ditetapkan Admin.
  return apiSaveBarang({
    rowIndex: p.rowIndex, nama: p.nama, hargaBersih: p.hargaBersih,
    pemilik: pemilik, noWaPemilik: p.noWaPemilik, foto: p.foto,
    modePotongan: modeWarisan, potonganManual: potonganWarisan,
    oleh: modeWarisan ? '__warisan__' : ''
  });
}

function apiDeleteBarangSaya(p) {
  const pemilik = norm(p.pemilik);
  if (!pemilikBarangTerdaftar(pemilik)) {
    return {ok:false, error:'Akun Anda tidak terdaftar sebagai Pemilik Barang.'};
  }
  if (!barangMilik(p.rowIndex, pemilik)) {
    return {ok:false, error:'Barang ini bukan milik Anda, tidak bisa dihapus.'};
  }
  getAktifKantinSS().getSheetByName(SHEET_BARANG).deleteRow(Number(p.rowIndex));
  return {ok:true};
}

function apiDeleteBarang(p) {
  getAktifKantinSS().getSheetByName(SHEET_BARANG).deleteRow(Number(p.rowIndex));
  return {ok:true};
}

// ============ KANTIN: TRANSAKSI (checkout oleh Pemilik Barang, PIN Transaksi santri) ============
function getBarangSaya(pemilik) {
  pemilik = norm(pemilik);
  return getBarangList().filter(function(b){ return b.pemilik === pemilik; });
}

// Dipakai Pemilik Barang untuk cari santri saat checkout -- HANYA nama & NISN yang
// dikirim, tidak pernah mengekspos saldo/PIN santri lewat daftar ini.
function getSantriUntukTransaksiKantin() {
  const sh = getAktifSS().getSheetByName(SHEET_SANTRI);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues();
  const header = rows[0];
  const iSaldo = header.indexOf('Saldo Kantin');
  const iLimit = header.indexOf('Limit Harian Kantin');
  rows.shift();
  return rows.filter(r => r[0]).map(r => ({
    nisn: norm(r[0]),
    nama: norm(r[1]),
    saldo: iSaldo > -1 ? (Number(r[iSaldo]) || 0) : 0,
    limitHarian: iLimit > -1 ? (Number(r[iLimit]) || 0) : 0
  }));
}

function hitungTotalBelanjaHariIniSantri(nisn, tanggalStr) {
  const sh = getAktifKantinSS().getSheetByName(SHEET_TRANSAKSI_KANTIN);
  const tz = Session.getScriptTimeZone();
  // Transaksi selalu ditambahkan di bawah, jadi transaksi HARI INI ada di bagian paling
  // bawah sheet. Dibaca dari bawah per blok 400 baris, berhenti begitu satu blok sudah
  // tidak memuat transaksi hari ini -- tidak perlu membaca seluruh riwayat semester
  // (yang terus bertambah dan membuat kasir makin lambat).
  const n = sh.getLastRow(), BLOK = 400;
  const rows = [];
  for (let akhir = n; akhir >= 2; akhir -= BLOK) {
    const awal = Math.max(2, akhir - BLOK + 1);
    const blok = sh.getRange(awal, 1, akhir - awal + 1, 11).getValues();
    let adaHariIni = false;
    blok.forEach(function(r){
      const v = r[0];
      const t = (v instanceof Date) ? tglKunciCatatan_(v, tz) : norm(v).slice(0, 10);
      if (t === tanggalStr) { adaHariIni = true; rows.push(r); }
      else if (t > tanggalStr) adaHariIni = true; // tanggal lebih baru (jaga-jaga): teruskan membaca
    });
    if (!adaHariIni) break;
  }
  let total = 0;
  rows.forEach(function(r){
    if (norm(r[2]) !== nisn) return;
    // Kategori kosong (data dari versi aplikasi terdahulu) ditebak dari kolom lain.
    // Tanpa ini, limit jajan harian tidak berfungsi sama sekali untuk data lama --
    // semua belanja tidak terhitung karena penyaringnya mencari kata 'Kantin'.
    const kategori = norm(r[5]) || tebakKategoriTransaksi(r[6], r[9], r[10]);
    if (kategori !== 'Kantin') return;
    const d = (r[0] instanceof Date) ? r[0] : new Date(r[0]);
    if (Utilities.formatDate(d, tz, 'yyyy-MM-dd') === tanggalStr) total += Number(r[4]) || 0;
  });
  return total;
}

// Proses satu transaksi belanja: validasi PIN Transaksi santri, cek limit harian & saldo,
// potong saldo santri, catat ke TransaksiKantin, tambahkan ke SaldoPemilik. Dibungkus
// LockService supaya aman dari race-condition kalau ada 2 kasir memproses bersamaan.
// ---------- Cara bayar di kasir (diatur Admin/Mudir) ----------
//   nisn_pin : ketik NISN / scan kartu QR + PIN Transaksi (cara lama, selalu tersedia
//              bila Admin/Mudir belum mengatur apa pun)
//   nama_pin : pilih nama santri dari pencarian + PIN Transaksi
//   cepat    : pilih nama santri dari pencarian, TANPA PIN. Bila belanja diwakilkan
//              teman, nama teman dipilih dari pencarian (bukan diketik bebas) dan
//              tercatat di transaksi serta dikabarkan ke wali -- mencegah kecurangan.
const METODE_KASIR_ = ['nisn_pin', 'nama_pin', 'cepat'];
function metodeKasirDiizinkan_() {
  // Bila pengaturan gagal dibaca, hanya cara paling aman (NISN/QR + PIN) yang diizinkan
  let pg = {};
  try { pg = getPengaturan() || {}; } catch (e) { return ['nisn_pin']; }
  const daftar = norm(pg.KasirModeIzin).split(',').map(function(x){ return x.trim(); })
    .filter(function(x){ return METODE_KASIR_.indexOf(x) !== -1; });
  return daftar.length ? daftar : ['nisn_pin'];
}
function labelMetodeKasir_(m) {
  return m === 'cepat' ? 'Pilih nama, tanpa PIN' : (m === 'nama_pin' ? 'Pilih nama + PIN' : 'NISN/QR + PIN');
}

function apiProsesTransaksiKantin(p) {
  const nisn = norm(p.nisn), pinInput = norm(p.pinTransaksi), pemilik = norm(p.pemilik);
  const items = p.items || [];
  const metode = METODE_KASIR_.indexOf(norm(p.metode)) !== -1 ? norm(p.metode) : 'nisn_pin';
  if (metodeKasirDiizinkan_().indexOf(metode) === -1) {
    return {ok:false, error:'Cara bayar "' + labelMetodeKasir_(metode) + '" tidak diizinkan oleh Admin/Mudir. Gunakan cara bayar lain.'};
  }
  const tanpaPin = metode === 'cepat';
  if (!nisn) return {ok:false, error:'Santri wajib dipilih'};
  if (!tanpaPin && !pinInput) return {ok:false, error:'Santri dan PIN Transaksi wajib diisi'};
  if (!items.length) return {ok:false, error:'Keranjang kosong'};
  const wakilNisn = tanpaPin ? norm(p.wakilNisn) : '';
  if (wakilNisn && wakilNisn === nisn) return {ok:false, error:'Teman yang mewakili tidak boleh santri yang sama.'};

  const lock = kunciTransaksi_();
  try { lock.waitLock(30000); } catch (e) { return {ok:false, error:'Server sedang memproses transaksi lain. Data BELUM tersimpan -- silakan tekan tombolnya sekali lagi.'}; }
  try {
    const ss = getAktifSS();
    const ssKantin = getAktifKantinSS();
    const shSantri = ss.getSheetByName(SHEET_SANTRI);
    const santriRows = shSantri.getDataRange().getValues();
    const header = santriRows[0];
    const iSaldo = header.indexOf('Saldo Kantin'), iLimit = header.indexOf('Limit Harian Kantin'), iPin = header.indexOf('PIN Transaksi');
    let rowIdx = -1;
    for (let i=1;i<santriRows.length;i++) { if (norm(santriRows[i][0]) === nisn) { rowIdx = i+1; break; } }
    if (rowIdx === -1) return {ok:false, error:'Data santri tidak ditemukan'};
    const row = santriRows[rowIdx-1];
    const namaSantri = norm(row[1]);
    if (!tanpaPin) {
      const pinTersimpan = norm(row[iPin]);
      if (!pinTersimpan) return {ok:false, error:'Santri ini belum punya PIN Transaksi. Minta Admin mengaturnya dulu di menu Data Santri.'};
      if (pinTersimpan !== pinInput) return {ok:false, error:'PIN Transaksi salah'};
    }
    // Teman yang mewakili harus santri terdaftar (dipilih dari pencarian, bukan diketik bebas)
    let namaWakil = '';
    if (wakilNisn) {
      const w = santriRows.find(function(r, i){ return i > 0 && norm(r[0]) === wakilNisn; });
      if (!w) return {ok:false, error:'Teman yang mewakili tidak ditemukan di data santri.'};
      namaWakil = norm(w[1]);
    }
    const caraBayar = labelMetodeKasir_(metode) + (namaWakil ? ' · diwakili ' + namaWakil + ' (' + wakilNisn + ')' : '');

    const saldo = Number(row[iSaldo]) || 0;
    const limit = Number(row[iLimit]) || 0;
    const total = items.reduce(function(s,it){ return s + (Number(it.harga)*Number(it.jumlah)); }, 0);
    const tz = Session.getScriptTimeZone();
    const todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

    if (limit > 0) {
      const sudahBelanja = hitungTotalBelanjaHariIniSantri(nisn, todayStr);
      if (sudahBelanja + total > limit) {
        return {ok:false, error:'Melebihi limit harian! Limit: Rp'+limit.toLocaleString('id-ID')+', sudah dipakai: Rp'+sudahBelanja.toLocaleString('id-ID')+', sisa: Rp'+Math.max(limit-sudahBelanja,0).toLocaleString('id-ID')};
      }
    }
    if (total > saldo) return {ok:false, error:'Saldo santri tidak mencukupi (saldo: Rp'+saldo.toLocaleString('id-ID')+', belanja: Rp'+total.toLocaleString('id-ID')+')'};

    const saldoSekarang = saldo - total;
    shSantri.getRange(rowIdx, iSaldo+1).setValue(saldoSekarang);

    const waktu = Utilities.formatDate(new Date(), tz, 'HH:mm:ss');
    const shTK = ssKantin.getSheetByName(SHEET_TRANSAKSI_KANTIN);
    let masukPemilikTotal = 0, totalPotongan = 0;
    const rowsTK = items.map(function(it){
      const nominal = Number(it.harga) * Number(it.jumlah);
      const potongan = (Number(it.potongan)||0) * Number(it.jumlah);
      const masuk = nominal - potongan;
      masukPemilikTotal += masuk;
      totalPotongan += potongan;
      return [todayStr, waktu, nisn, namaSantri, nominal, 'Kantin', it.nama, it.jumlah, potongan, pemilik, masuk, saldo, saldoSekarang, caraBayar];
    });
    // Kolom ke-14 "Cara Bayar" (tambahan; kolom lama tidak berubah urutannya)
    try { if (norm(shTK.getRange(1, 14).getValue()) !== 'Cara Bayar') shTK.getRange(1, 14).setValue('Cara Bayar'); } catch (e) {}
    shTK.getRange(shTK.getLastRow()+1, 1, rowsTK.length, 14).setValues(rowsTK);

    if (pemilik && masukPemilikTotal > 0) {
      const shSaldoPemilik = ssKantin.getSheetByName(SHEET_SALDO_PEMILIK);
      const spRows = shSaldoPemilik.getDataRange().getValues();
      let found = -1;
      for (let i=1;i<spRows.length;i++) { if (norm(spRows[i][0]) === pemilik) { found = i+1; break; } }
      if (found === -1) shSaldoPemilik.appendRow([pemilik, norm(p.noWaPemilik), masukPemilikTotal]);
      else shSaldoPemilik.getRange(found,3).setValue((Number(spRows[found-1][2])||0) + masukPemilikTotal);
    }

    // Catat potongan sebagai pendapatan pondok (kalau ada)
    if (totalPotongan > 0) {
      try {
        catatPendapatanPondok('Potongan Barang',
          'Potongan dari ' + items.length + ' item belanja ' + namaSantri + ' (Pemilik: ' + pemilik + ')',
          totalPotongan, nisn, namaSantri, 'TRX-' + todayStr + '-' + nisn);
      } catch(e) { Logger.log('Gagal catat pendapatan pondok: ' + e.message); }
    }

    // Notifikasi push ke wali -- tidak boleh mempengaruhi hasil transaksi.
    // Aplikasi kasir versi baru (notifTerpisah) mengirimkannya lewat permintaan TERPISAH
    // setelah struk tampil, jadi kasir tidak ikut menunggu pengiriman notifikasi.
    const daftarItem = items.map(function(it){ return it.nama + ' x' + it.jumlah; }).join(', ');
    const isiNotif = namaSantri + ' belanja ' + rp(total) + ' (' + daftarItem + ')' +
      (tanpaPin ? (namaWakil ? ', dibayarkan tanpa PIN & diwakili ' + namaWakil : ', dibayarkan tanpa PIN') : '') +
      '. Sisa saldo: ' + rp(saldoSekarang) + '.';
    let tokenNotif = '';
    if (p.notifTerpisah) {
      try {
        tokenNotif = 'nb_' + Utilities.getUuid();
        CacheService.getScriptCache().put(tokenNotif, JSON.stringify({nisn: nisn, isi: isiNotif}), 1800);
      } catch (e) { tokenNotif = ''; }
    }
    if (!tokenNotif) {
      try { kirimPushKeWali(nisn, '\uD83D\uDED2 Belanja Kantin', isiNotif); }
      catch(e) { Logger.log('Notif wali belanja gagal: ' + e.message); }
    }

    return {ok:true, saldoSekarang: saldoSekarang, namaSantri: namaSantri, total: total, tokenNotif: tokenNotif, caraBayar: caraBayar, namaWakil: namaWakil};
  } finally {
    lock.releaseLock();
  }
}

// Kirim notifikasi belanja yang ditunda (dipanggil aplikasi kasir SETELAH transaksi
// selesai). Hanya bisa dipakai sekali per transaksi, dengan token dari server -- tidak
// bisa dipakai untuk mengirim notifikasi palsu.
function apiKirimNotifBelanja(p) {
  const token = norm(p && p.token);
  if (!/^nb_[0-9a-f-]{20,}$/i.test(token)) return {ok:false, error:'Token tidak valid'};
  const cache = CacheService.getScriptCache();
  const isi = cache.get(token);
  if (!isi) return {ok:true, terkirim:false};
  cache.remove(token);
  try {
    const d = JSON.parse(isi);
    kirimPushKeWali(d.nisn, '\uD83D\uDED2 Belanja Kantin', d.isi);
  } catch (e) { Logger.log('Notif belanja tertunda gagal: ' + e.message); }
  return {ok:true, terkirim:true};
}

function getRiwayatTransaksiPemilik(pemilik, tglMulai, tglAkhir) {
  pemilik = norm(pemilik);
  const sh = getAktifKantinSS().getSheetByName(SHEET_TRANSAKSI_KANTIN);
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  return rows.map(function(r){
    const d = (r[0] instanceof Date) ? r[0] : new Date(r[0]);
    return { tanggal: Utilities.formatDate(d,tz,'yyyy-MM-dd'), waktu: norm(r[1]), pemilik: norm(r[9]),
      namaSantri: norm(r[3]), namaBarang: norm(r[6]), jumlah: Number(r[7])||0,
      nominal: Number(r[4])||0, potongan: Number(r[8])||0, masuk: Number(r[10])||0 };
  }).filter(function(x){
    if (x.pemilik !== pemilik) return false;
    if (tglMulai && x.tanggal < tglMulai) return false;
    if (tglAkhir && x.tanggal > tglAkhir) return false;
    return true;
  }).sort(function(a,b){ return b.tanggal.localeCompare(a.tanggal) || b.waktu.localeCompare(a.waktu); });
}

function getSaldoPemilikSaya(pemilik) {
  pemilik = norm(pemilik);
  const sh = getAktifKantinSS().getSheetByName(SHEET_SALDO_PEMILIK);
  const rows = sh.getDataRange().getValues(); rows.shift();
  for (let i=0;i<rows.length;i++) { if (norm(rows[i][0]) === pemilik) return Number(rows[i][2]) || 0; }
  return 0;
}

// Riwayat naik-turun saldo pemilik (dari RiwayatSaldoPemilik)
function getRiwayatSaldoPemilikSaya(pemilik) {
  pemilik = norm(pemilik);
  const sh = getAktifKantinSS().getSheetByName(SHEET_RIWAYAT_SALDO_PEMILIK);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  return rows.filter(r => norm(r[2]) === pemilik).map(r => ({
    tanggal: r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]),
    waktu: norm(r[1]), jenis: norm(r[3]), nominal: Number(r[4])||0,
    saldoSebelum: Number(r[5])||0, saldoSekarang: Number(r[6])||0, keterangan: norm(r[7])
  })).sort((a,b) => b.tanggal.localeCompare(a.tanggal));
}

// Set limit harian belanja santri (bisa dipanggil oleh Wali maupun Admin)
function apiSetLimitHarianSantri(p) {
  const nisn = norm(p.nisn), limit = Number(p.limit)||0;
  if (!nisn) return {ok:false, error:'NISN wajib diisi'};
  const ss = getAktifSS();
  const shSantri = ss.getSheetByName(SHEET_SANTRI);
  const rows = shSantri.getDataRange().getValues();
  const header = rows[0];
  let iLimit = header.indexOf('Limit Harian Kantin');
  if (iLimit === -1) {
    // Kolom belum ada, tambahkan
    iLimit = header.length;
    shSantri.getRange(1, iLimit+1).setValue('Limit Harian Kantin');
  }
  for (let i=1;i<rows.length;i++) {
    if (norm(rows[i][0]) === nisn) {
      shSantri.getRange(i+1, iLimit+1).setValue(limit);
      return {ok:true};
    }
  }
  return {ok:false, error:'Santri tidak ditemukan'};
}



// Pemilik mengajukan tarik saldo -- status "Pending" sampai disetujui Bendahara/Mudir
// (tahap berikutnya). Saldo BELUM dipotong di sini, baru dipotong saat disetujui.
function apiAjukanPenarikanSaldo(p) {
  const pemilik = norm(p.pemilik), noWa = norm(p.noWa), nominal = Number(p.nominal) || 0;
  if (!pemilik || nominal <= 0) return {ok:false, error:'Nominal wajib diisi dan lebih dari 0'};
  const saldoSaya = getSaldoPemilikSaya(pemilik);
  if (nominal > saldoSaya) return {ok:false, error:'Saldo tidak mencukupi (saldo Anda: Rp'+saldoSaya.toLocaleString('id-ID')+')'};
  const sh = getAktifKantinSS().getSheetByName(SHEET_PENGAJUAN_TARIK);
  const tz = Session.getScriptTimeZone();
  sh.appendRow([Utilities.formatDate(new Date(),tz,'yyyy-MM-dd'), Utilities.formatDate(new Date(),tz,'HH:mm:ss'), pemilik, noWa, nominal, 'Pending', '', '']);
  return {ok:true};
}

function getRiwayatPenarikanSaya(pemilik) {
  pemilik = norm(pemilik);
  const sh = getAktifKantinSS().getSheetByName(SHEET_PENGAJUAN_TARIK);
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  return rows.map(function(r,i){
    const d = (r[0] instanceof Date) ? r[0] : new Date(r[0]);
    return { rowIndex:i+2, tanggal: Utilities.formatDate(d,tz,'yyyy-MM-dd'), waktu: norm(r[1]), pemilik: norm(r[2]), nominal: Number(r[4])||0, status: norm(r[5]) };
  }).filter(function(x){ return x.pemilik === pemilik; }).sort(function(a,b){ return b.tanggal.localeCompare(a.tanggal); });
}

// ============ BENDAHARA/MUDIR: PERSETUJUAN SALDO ============
// Menampilkan SEMUA pengajuan (tarik saldo pemilik & tambah saldo santri) lintas
// pemilik/santri, supaya Bendahara/Mudir bisa lihat & setujui dari satu tempat.
function getSemuaPengajuanTarik(hanyaPending) {
  const sh = getAktifKantinSS().getSheetByName(SHEET_PENGAJUAN_TARIK);
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  let list = rows.map(function(r,i){
    const d = (r[0] instanceof Date) ? r[0] : new Date(r[0]);
    return { rowIndex:i+2, tanggal: Utilities.formatDate(d,tz,'yyyy-MM-dd'), waktu: norm(r[1]), pemilik: norm(r[2]), noWa: norm(r[3]), nominal: Number(r[4])||0, status: norm(r[5]) };
  });
  if (hanyaPending) list = list.filter(function(x){ return x.status === 'Pending'; });
  return list.sort(function(a,b){ return b.tanggal.localeCompare(a.tanggal) || b.waktu.localeCompare(a.waktu); });
}

function getSemuaPengajuanTopUp(hanyaPending) {
  const sh = getAktifKantinSS().getSheetByName(SHEET_PENGAJUAN_TOPUP);
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  let list = rows.map(function(r,i){
    const d = (r[0] instanceof Date) ? r[0] : new Date(r[0]);
    return { rowIndex:i+2, tanggal: Utilities.formatDate(d,tz,'yyyy-MM-dd'), waktu: norm(r[1]), nisn: norm(r[2]), namaSantri: norm(r[3]), nominal: Number(r[4])||0, noWaWali: norm(r[5]), status: norm(r[6]) };
  });
  if (hanyaPending) list = list.filter(function(x){ return x.status === 'Pending'; });
  return list.sort(function(a,b){ return b.tanggal.localeCompare(a.tanggal) || b.waktu.localeCompare(a.waktu); });
}

// Setujui pengajuan TARIK SALDO PEMILIK: potong SaldoPemilik, catat ke RiwayatSaldoPemilik,
// tandai baris pengajuan jadi "Disetujui", kirim WA (kalau WhatsApp diatur).
function apiSetujuiPenarikan(p) {
  const rowIndex = Number(p.rowIndex);
  const disetujuiOleh = norm(p.disetujuiOleh);
  const lock = kunciTransaksi_();
  try { lock.waitLock(30000); } catch(e) { return {ok:false, error:'Server sedang memproses transaksi lain. Data BELUM tersimpan -- silakan tekan tombolnya sekali lagi.'}; }
  try {
    const ss = getAktifKantinSS();
    const shTarik = ss.getSheetByName(SHEET_PENGAJUAN_TARIK);
    const rows = shTarik.getDataRange().getValues();
    if (rowIndex < 2 || rowIndex > rows.length) return {ok:false, error:'Pengajuan tidak ditemukan'};
    const r = rows[rowIndex-1];
    if (norm(r[5]) !== 'Pending') return {ok:false, error:'Pengajuan ini sudah diproses sebelumnya'};
    const pemilik = norm(r[2]), noWa = norm(r[3]), nominal = Number(r[4]) || 0;

    const shSaldo = ss.getSheetByName(SHEET_SALDO_PEMILIK);
    const spRows = shSaldo.getDataRange().getValues();
    let foundRow = -1, saldoSebelum = 0;
    for (let i=1;i<spRows.length;i++) { if (norm(spRows[i][0]) === pemilik) { foundRow = i+1; saldoSebelum = Number(spRows[i][2])||0; break; } }
    if (foundRow === -1) return {ok:false, error:'Data saldo pemilik tidak ditemukan'};
    if (nominal > saldoSebelum) return {ok:false, error:'Saldo pemilik tidak mencukupi lagi (saldo saat ini: Rp'+saldoSebelum.toLocaleString('id-ID')+')'};

    const saldoSekarang = saldoSebelum - nominal;
    shSaldo.getRange(foundRow, 3).setValue(saldoSekarang);

    const tz = Session.getScriptTimeZone();
    const waktuStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
    shTarik.getRange(rowIndex,6).setValue('Disetujui');
    shTarik.getRange(rowIndex,7).setValue(waktuStr);
    shTarik.getRange(rowIndex,8).setValue(disetujuiOleh);

    const shRiwayat = ss.getSheetByName(SHEET_RIWAYAT_SALDO_PEMILIK);
    shRiwayat.appendRow([Utilities.formatDate(new Date(),tz,'yyyy-MM-dd'), Utilities.formatDate(new Date(),tz,'HH:mm:ss'), pemilik, 'Penarikan', nominal, saldoSebelum, saldoSekarang, 'Disetujui oleh '+disetujuiOleh, 'Disetujui']);

    if (noWa) {
      kirimWAKategori_('saldo_pemilik', noWa, 'Assalamualaikum Wr. Wb.\n\n*PENARIKAN SALDO DISETUJUI*\n\nHalo *'+pemilik+'*,\nPengajuan tarik saldo Anda sebesar Rp'+nominal.toLocaleString('id-ID')+' telah disetujui.\n\nSisa saldo: Rp'+saldoSekarang.toLocaleString('id-ID')+'\n\nWassalamualaikum Wr. Wb.');
    }
    return {ok:true};
  } finally {
    lock.releaseLock();
  }
}

function apiTolakPenarikan(p) {
  const rowIndex = Number(p.rowIndex);
  const sh = getAktifKantinSS().getSheetByName(SHEET_PENGAJUAN_TARIK);
  const rows = sh.getDataRange().getValues();
  if (rowIndex < 2 || rowIndex > rows.length) return {ok:false, error:'Pengajuan tidak ditemukan'};
  if (norm(rows[rowIndex-1][5]) !== 'Pending') return {ok:false, error:'Pengajuan ini sudah diproses sebelumnya'};
  const tz = Session.getScriptTimeZone();
  sh.getRange(rowIndex,6).setValue('Ditolak');
  sh.getRange(rowIndex,7).setValue(Utilities.formatDate(new Date(),tz,'yyyy-MM-dd HH:mm:ss'));
  sh.getRange(rowIndex,8).setValue(norm(p.diprosesOleh));
  return {ok:true};
}

// Setujui pengajuan TAMBAH SALDO SANTRI: tambahkan ke Saldo Kantin santri (di sheet
// Santri yang sama), tandai baris pengajuan jadi "Disetujui", kirim WA ke wali.
function apiSetujuiTopUp(p) {
  const rowIndex = Number(p.rowIndex);
  const disetujuiOleh = norm(p.disetujuiOleh);
  const lock = kunciTransaksi_();
  try { lock.waitLock(30000); } catch(e) { return {ok:false, error:'Server sedang memproses transaksi lain. Data BELUM tersimpan -- silakan tekan tombolnya sekali lagi.'}; }
  try {
    const ss = getAktifSS();
    const ssKantin = getAktifKantinSS();
    const shTopUp = ssKantin.getSheetByName(SHEET_PENGAJUAN_TOPUP);
    const rows = shTopUp.getDataRange().getValues();
    if (rowIndex < 2 || rowIndex > rows.length) return {ok:false, error:'Pengajuan tidak ditemukan'};
    const r = rows[rowIndex-1];
    if (norm(r[6]) !== 'Pending') return {ok:false, error:'Pengajuan ini sudah diproses sebelumnya'};
    const nisn = norm(r[2]), namaSantri = norm(r[3]), nominalDiajukan = Number(r[4]) || 0, noWaWali = norm(r[5]);

    // Hitung biaya admin dan nominal bersih yang masuk ke saldo santri
    const biayaAdmin = getBiayaAdminTopup();
    const nominalBersih = Math.max(nominalDiajukan - biayaAdmin, 0);

    const shSantri = ss.getSheetByName(SHEET_SANTRI);
    const santriRows = shSantri.getDataRange().getValues();
    const header = santriRows[0];
    const iSaldo = header.indexOf('Saldo Kantin');
    let rowSantri = -1, saldoSebelum = 0;
    for (let i=1;i<santriRows.length;i++) {
      if (norm(santriRows[i][0]) === nisn) { rowSantri = i+1; saldoSebelum = Number(santriRows[i][iSaldo])||0; break; }
    }
    if (rowSantri === -1) return {ok:false, error:'Data santri tidak ditemukan'};

    const saldoSekarang = saldoSebelum + nominalBersih;
    shSantri.getRange(rowSantri, iSaldo+1).setValue(saldoSekarang);

    const tz = Session.getScriptTimeZone();
    const tglStr = Utilities.formatDate(new Date(),tz,'yyyy-MM-dd');
    const wktStr = Utilities.formatDate(new Date(),tz,'HH:mm:ss');
    shTopUp.getRange(rowIndex,7).setValue('Disetujui');
    shTopUp.getRange(rowIndex,8).setValue(tglStr+' '+wktStr);
    shTopUp.getRange(rowIndex,9).setValue(disetujuiOleh);

    // Catat ke TransaksiKantin (nominal bersih yang masuk saldo)
    const shTK = ssKantin.getSheetByName(SHEET_TRANSAKSI_KANTIN);
    shTK.appendRow([tglStr, wktStr, nisn, namaSantri, nominalBersih, 'Top Up Saldo',
      'Top Up (Bruto: Rp'+nominalDiajukan.toLocaleString('id-ID')+
      (biayaAdmin>0?', Admin: Rp'+biayaAdmin.toLocaleString('id-ID'):'')+') oleh '+disetujuiOleh,
      1, 0, '', 0, saldoSebelum, saldoSekarang]);

    // Catat biaya admin sebagai pendapatan pondok (kalau ada)
    if (biayaAdmin > 0) {
      catatPendapatanPondok('Biaya Admin Top-up',
        'Biaya admin top-up saldo ' + namaSantri,
        biayaAdmin, nisn, namaSantri, 'TOPUP-'+tglStr+'-'+nisn);
    }

    // Kirim WA notifikasi lengkap dengan rincian biaya admin
    if (noWaWali) {
      const p = getPengaturan();
      const namaPesantren = p.NamaPesantren || 'Pondok Pesantren';
      let pesan = 'Assalamualaikum Wr. Wb.\n\n' +
        'Alhamdulillah, saldo ananda *' + namaSantri + '* berhasil di Top Up!\n\n' +
        'Nominal Top Up: Rp' + nominalDiajukan.toLocaleString('id-ID') + '\n';
      if (biayaAdmin > 0) {
        pesan += 'Biaya Admin: Rp' + biayaAdmin.toLocaleString('id-ID') + '\n' +
          'Saldo masuk: Rp' + nominalBersih.toLocaleString('id-ID') + '\n';
      }
      pesan += 'Saldo sebelum: Rp' + saldoSebelum.toLocaleString('id-ID') + '\n' +
        'Saldo sekarang: *Rp' + saldoSekarang.toLocaleString('id-ID') + '*\n\n' +
        'Diproses oleh: ' + disetujuiOleh + '\n' +
        'Waktu: ' + tglStr + ' ' + wktStr + '\n\n' +
        'Jazakumullah khairan. - ' + namaPesantren;
      kirimWAKategori_('saldo_tambah', noWaWali, pesan);
    }
    return {ok:true, saldoSekarang:saldoSekarang, biayaAdmin:biayaAdmin, nominalBersih:nominalBersih};
  } finally {
    lock.releaseLock();
  }
}

function apiTolakTopUp(p) {
  const rowIndex = Number(p.rowIndex);
  const sh = getAktifKantinSS().getSheetByName(SHEET_PENGAJUAN_TOPUP);
  const rows = sh.getDataRange().getValues();
  if (rowIndex < 2 || rowIndex > rows.length) return {ok:false, error:'Pengajuan tidak ditemukan'};
  if (norm(rows[rowIndex-1][6]) !== 'Pending') return {ok:false, error:'Pengajuan ini sudah diproses sebelumnya'};
  const tz = Session.getScriptTimeZone();
  sh.getRange(rowIndex,7).setValue('Ditolak');
  sh.getRange(rowIndex,8).setValue(Utilities.formatDate(new Date(),tz,'yyyy-MM-dd HH:mm:ss'));
  sh.getRange(rowIndex,9).setValue(norm(p.diprosesOleh));
  return {ok:true};
}

// ======================================================================
// PENGIRIMAN WHATSAPP -- lewat WABLAS
//
// Semua pengiriman WA di WASIAT melewati kirimWA_() di bawah. Pengaturannya (alamat
// server, token, secret key) diisi Admin di menu Kelola Pelanggaran > Pengaturan
// WhatsApp -- TIDAK ditulis di kode, supaya tidak ikut tersebar bila berkas kode
// diunggah ke GitHub.
//
// Masa peralihan: selama token Wablas belum diisi, token Fonnte lama (kalau masih ada)
// tetap dipakai supaya notifikasi WA tidak berhenti mendadak. Begitu token Wablas
// diisi, Fonnte tidak dipakai lagi sama sekali.
// ======================================================================
const NAMA_SHEET_LOG_WA = 'Log Gagal WA';

// Semua JENIS pesan WA otomatis. Admin/Mudir bisa mematikan jenis tertentu di menu
// Pengaturan WhatsApp. Bawaannya SEMUA AKTIF (yang dimatikan disimpan di WANonaktif),
// supaya tidak ada pesan yang tiba-tiba berhenti setelah pembaruan.
const JENIS_PESAN_WA = [
  {k:'spp_tagihan_otomatis', grup:'SPP', label:'Pengingat tagihan SPP otomatis (terjadwal)', ke:'Wali santri'},
  {k:'spp_tagihan_manual',   grup:'SPP', label:'Tagihan SPP yang dikirim lewat tombol', ke:'Wali santri'},
  {k:'spp_lunas',            grup:'SPP', label:'Konfirmasi pembayaran SPP berhasil', ke:'Wali santri'},
  {k:'spp_laporan_admin',    grup:'SPP', label:'Laporan pengingat SPP untuk Admin/Bendahara', ke:'Admin, Mudir, Bendahara'},
  {k:'saldo_tambah',         grup:'Kantin & Saldo', label:'Saldo santri bertambah (top-up)', ke:'Wali santri'},
  {k:'saldo_tarik',          grup:'Kantin & Saldo', label:'Penarikan saldo santri', ke:'Wali santri'},
  {k:'topup_ke_bendahara',   grup:'Kantin & Saldo', label:'Pengajuan top-up baru', ke:'Bendahara'},
  {k:'saldo_pemilik',        grup:'Kantin & Saldo', label:'Penarikan saldo pemilik barang', ke:'Pemilik barang'},
  {k:'pelanggaran',          grup:'Pelanggaran', label:'Notifikasi pelanggaran anak', ke:'Wali santri'},
  {k:'poin_habis',           grup:'Pelanggaran', label:'Poin santri habis', ke:'Wali santri'},
  {k:'poin_habis_grup',      grup:'Pelanggaran', label:'Poin santri habis (ke grup pengajar)', ke:'Grup WA pengajar'},
  {k:'absen_mapel',          grup:'Kehadiran Santri', label:'Santri tidak hadir di pelajaran', ke:'Wali santri'},
  {k:'absen_harian',         grup:'Kehadiran Santri', label:'Santri alpa di absensi harian asrama', ke:'Wali santri'},
  {k:'izin_santri_pengajuan',grup:'Perizinan Santri', label:'Pengajuan izin pulang santri', ke:'Wali santri'},
  {k:'izin_santri_keputusan',grup:'Perizinan Santri', label:'Izin santri disetujui / ditolak', ke:'Wali santri'},
  {k:'izin_santri_kembali',  grup:'Perizinan Santri', label:'Konfirmasi santri sudah kembali', ke:'Wali santri'},
  {k:'guru_kehadiran',       grup:'Kehadiran Guru', label:'Izin guru & Surat Peringatan (rincian di menu Kehadiran Guru & SP)', ke:'Guru, Mudir, Admin'},
  {k:'persuratan',           grup:'Persuratan', label:'Surat, persetujuan & disposisi dari aplikasi Persuratan', ke:'Wali santri, guru, pengurus, Mudir'},
  {k:'kwitansi',             grup:'Keuangan', label:'Kwitansi resmi pembayaran', ke:'Wali santri'},
  {k:'keuangan_pengajuan',   grup:'Keuangan', label:'Pengajuan dana & pengesahan laporan keuangan', ke:'Mudir, Bendahara, pengaju'},
  {k:'konfirmasi_transfer',  grup:'Keuangan', label:'Konfirmasi transfer wali (masuk ke Bendahara, penolakan ke wali)', ke:'Bendahara, wali santri'},
  {k:'laporan_bulanan',      grup:'Wali Santri', label:'Kabar laporan perkembangan bulanan sudah tersedia', ke:'Wali santri'},
  {k:'ppdb',                 grup:'PPDB', label:'Status pendaftaran santri baru (PPDB online)', ke:'Calon wali santri'}
];
function jenisWANonaktif_() {
  const s = norm(getPengaturan().WANonaktif);
  const hasil = {};
  s.split(',').map(function(x){ return x.trim(); }).filter(Boolean).forEach(function(k){ hasil[k] = true; });
  return hasil;
}

function konfigWA_() {
  const p = getPengaturan();
  return {
    host: (norm(p.WablasHost) || 'https://jkt.wablas.com').replace(/\/+$/, ''),
    token: norm(p.WablasToken),
    secret: norm(p.WablasSecretKey),
    fonnte: norm(p.FonnteToken),
    pilihan: norm(p.WAPenyedia) || 'otomatis',       // otomatis | wablas | fonnte
    terakhir: norm(p.WAPenyediaTerakhir)             // token yang paling akhir diisi
  };
}
// Penyedia yang BENAR-BENAR dipakai.
// Otomatis: kalau hanya satu token terisi, itu yang dipakai. Kalau keduanya terisi,
// dipakai yang tokennya paling akhir diisi -- sesuai kebiasaan "isi token Fonnte berarti
// pakai Fonnte, isi token Wablas berarti pakai Wablas".
// Pilihan tegas (wablas/fonnte) tidak diam-diam beralih ke penyedia lain: kalau token
// penyedia yang dipilih kosong, pengiriman gagal dengan pesan yang jelas.
function penyediaWAAktif_(k) {
  k = k || konfigWA_();
  if (k.pilihan === 'wablas') return k.token ? 'wablas' : '';
  if (k.pilihan === 'fonnte') return k.fonnte ? 'fonnte' : '';
  if (k.token && k.fonnte) return k.terakhir === 'fonnte' ? 'fonnte' : 'wablas';
  return k.token ? 'wablas' : (k.fonnte ? 'fonnte' : '');
}
function waTerkonfigurasi_() { return !!penyediaWAAktif_(); }

// Wablas mewajibkan format internasional tanpa "+" (62812...). Nomor di data pondok
// banyak yang ditulis 0812..., jadi dinormalkan di sini.
function normalNomorWA_(t) {
  let n = String(t || '').trim();
  if (/@g\.us$/i.test(n)) return n;             // ID grup: biarkan apa adanya
  n = n.replace(/[^0-9]/g, '');
  if (n.indexOf('0') === 0) n = '62' + n.slice(1);
  else if (n.indexOf('8') === 0) n = '62' + n;
  return n;
}
// ID grup WA: berakhiran @g.us, atau deret angka yang jauh lebih panjang dari nomor HP
function adalahGrupWA_(t) {
  const n = String(t || '').trim();
  return /@g\.us$/i.test(n) || /^\d{17,}$/.test(n.replace(/[^0-9]/g, '')) || /^\d+-\d+$/.test(n);
}

// Kirim satu pesan. Mengembalikan {ok, error, via}. Tidak pernah melempar error --
// kegagalan WA tidak boleh menggagalkan proses utama (simpan pelanggaran, SPP, dll).
function kirimWA_(target, pesan, kategori) {
  // Jenis pesan yang dimatikan Admin/Mudir: dilewati diam-diam (bukan kegagalan)
  if (kategori && jenisWANonaktif_()[kategori]) return {ok:false, dilewati:true, error:'Jenis pesan ini dinonaktifkan Admin/Mudir'};
  const daftar = String(target || '').split(',').map(function(x){ return x.trim(); }).filter(Boolean);
  if (!daftar.length) return {ok:false, error:'Nomor tujuan kosong'};
  const k = konfigWA_();
  const via = penyediaWAAktif_(k);
  if (!via) {
    return {ok:false, error: k.pilihan === 'wablas' ? 'Wablas dipilih, tetapi token Wablas belum diisi'
      : (k.pilihan === 'fonnte' ? 'Fonnte dipilih, tetapi token Fonnte belum diisi' : 'WhatsApp belum diatur (token Wablas/Fonnte kosong)')};
  }
  let semuaOk = true, galat = '';
  daftar.forEach(function(t){
    const h = via === 'wablas' ? kirimSatuWablas_(k, t, pesan) : kirimSatuFonnte_(k, t, pesan);
    if (!h.ok) { semuaOk = false; galat = h.error; }
  });
  return {ok: semuaOk, error: galat, via: via};
}

function kirimSatuWablas_(k, target, pesan) {
  const grup = adalahGrupWA_(target);
  const tujuan = grup ? String(target).trim().replace(/@g\.us$/i, '') : normalNomorWA_(target);
  let teks = '';
  try {
    const resp = UrlFetchApp.fetch(k.host + (grup ? '/api/send-group' : '/api/send-message'), {
      method: 'post', contentType: 'application/json',
      headers: { 'Authorization': k.secret ? (k.token + '.' + k.secret) : k.token },
      payload: JSON.stringify({ phone: tujuan, message: String(pesan || '') }),
      muteHttpExceptions: true
    });
    teks = resp.getContentText();
    let json = null;
    try { json = JSON.parse(teks); } catch (e) {}
    if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300 && json && json.status !== false) return {ok:true};
    const galat = (json && json.message) ? String(json.message) : ('HTTP ' + resp.getResponseCode() + ': ' + teks.slice(0, 200));
    catatGagalWA_(tujuan, pesan, galat);
    return {ok:false, error: galat};
  } catch (err) {
    catatGagalWA_(tujuan, pesan, 'Error: ' + err);
    return {ok:false, error: String(err)};
  }
}

function kirimSatuFonnte_(k, target, pesan) {
  try {
    const resp = UrlFetchApp.fetch('https://api.fonnte.com/send', {
      method:'post', contentType:'application/json',
      headers: {'Authorization': k.fonnte},
      payload: JSON.stringify({target: target, message: pesan}),
      muteHttpExceptions: true
    });
    const teks = resp.getContentText();
    let json = null; try { json = JSON.parse(teks); } catch (e) {}
    // Fonnte membalas HTTP 200 walau gagal; status sebenarnya ada di field "status"
    if (resp.getResponseCode() === 200 && !(json && json.status === false)) return {ok:true};
    const galat = (json && (json.reason || json.detail)) ? String(json.reason || json.detail) : ('Fonnte HTTP ' + resp.getResponseCode());
    catatGagalWA_(target, pesan, 'Fonnte: ' + galat);
    return {ok:false, error: galat};
  } catch (err) { catatGagalWA_(target, pesan, 'Fonnte error: ' + err); return {ok:false, error: String(err)}; }
}

// Catat kegagalan ke sheet "Log Gagal WA" (spreadsheet Master). Kalau Wablas menolak
// karena IP server tidak terdaftar, IP barunya diambil dari pesan error supaya Admin
// tahu IP mana yang harus didaftarkan di dashboard Wablas.
function catatGagalWA_(nomor, pesan, galat) {
  try {
    const ss = getMasterSS();
    let sh = ss.getSheetByName(NAMA_SHEET_LOG_WA);
    if (!sh) { sh = ss.insertSheet(NAMA_SHEET_LOG_WA); sh.appendRow(['Waktu','Nomor','Pesan','Error','IP Baru Terdeteksi']); }
    const m = String(galat || '').match(/Your IP \(([\d.]+)\)/i) || String(galat || '').match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
    sh.appendRow([new Date(), String(nomor), String(pesan || '').slice(0, 300), String(galat || '').slice(0, 500), m ? m[1] : '']);
  } catch (e) { Logger.log('Gagal mencatat log WA: ' + e.message); }
}

// Status untuk dashboard Admin: apakah dalam 24 jam terakhir ada kegagalan karena IP.
function getStatusWablas() {
  try {
    const sh = getMasterSS().getSheetByName(NAMA_SHEET_LOG_WA);
    if (!sh || sh.getLastRow() <= 1) return {ok:true, adaMasalah:false};
    const d = sh.getRange(sh.getLastRow(), 1, 1, 5).getValues()[0];
    const waktu = d[0] instanceof Date ? d[0] : new Date(d[0]);
    const selisihJam = (new Date() - waktu) / 3600000;
    if (!(selisihJam <= 24) || !d[4]) return {ok:true, adaMasalah:false};
    return {ok:true, adaMasalah:true, ipBaru: String(d[4]), errorMsg: String(d[3]),
      waktu: Utilities.formatDate(waktu, Session.getScriptTimeZone(), 'dd MMM yyyy HH:mm')};
  } catch (e) { return {ok:true, adaMasalah:false}; }
}
function apiGetInfoPengaturanWA(p) {
  if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Hanya Admin/Mudir.'};
  const k = konfigWA_();
  const mati = jenisWANonaktif_();
  return {ok:true, host: k.host, pilihan: k.pilihan, terakhir: k.terakhir,
    adaWablas: !!k.token, adaSecret: !!k.secret, adaFonnte: !!k.fonnte, dipakai: penyediaWAAktif_(k),
    jenis: JENIS_PESAN_WA.map(function(j){ return {k:j.k, grup:j.grup, label:j.label, ke:j.ke, aktif: !mati[j.k]}; }),
    grupPengajar: norm(getPengaturan().GrupPengajarWA), status: getStatusWablas()};
}

function apiCekStatusWablas(p) {
  if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Tidak berwenang.'};
  return getStatusWablas();
}
// Kirim pesan uji dari halaman pengaturan -- hasilnya ditampilkan apa adanya supaya
// Admin langsung tahu penyebabnya bila gagal (token salah, IP belum terdaftar, dll).
function apiKirimWATes(p) {
  if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Hanya Admin/Mudir.'};
  if (!norm(p.nomor)) return {ok:false, error:'Isi nomor tujuan.'};
  const via = penyediaWAAktif_();
  const h = kirimWA_(p.nomor, 'Tes pengiriman WhatsApp dari aplikasi WASIAT (lewat ' + (via === 'fonnte' ? 'Fonnte' : 'Wablas') + '). Bila pesan ini sampai, pengaturan WhatsApp sudah benar.');
  return h.ok ? {ok:true, via: via} : {ok:false, error: h.error, via: via};
}

// Nama lama tetap ada supaya semua pemanggil yang sudah berjalan tidak perlu diubah.
function kirimWAUmum(target, pesan, kategori) { kirimWA_(target, pesan, kategori); }
function kirimWAKategori_(kategori, target, pesan) {
  if (_antreanNotifTerkunci_) { _antreanNotifTerkunci_.push(['wa', kategori, target, pesan]); return; }
  kirimWA_(target, pesan, kategori);
}

// ----------------------------------------------------------------------
// KUNCI TRANSAKSI + NOTIFIKASI DITUNDA
// Pengiriman WA/notifikasi bisa memakan beberapa detik (apalagi bila server WA lambat).
// Dulu WA dikirim SAMBIL memegang kunci, sehingga transaksi lain (tambah saldo, kasir
// kantin, penarikan) ikut menunggu lalu gagal "Sistem sibuk". Sekarang, selama kunci
// dipegang, WA/notifikasi hanya DICATAT, lalu dikirim begitu kunci dilepas -- datanya
// tersimpan lebih dulu, isi pesannya tetap sama persis.
// ----------------------------------------------------------------------
let _antreanNotifTerkunci_ = null;
function kunciTransaksi_() {
  const lock = LockService.getScriptLock();
  return {
    waitLock: function(ms) { lock.waitLock(ms); if (!_antreanNotifTerkunci_) _antreanNotifTerkunci_ = []; },
    tryLock: function(ms) { const ok = lock.tryLock(ms); if (ok && !_antreanNotifTerkunci_) _antreanNotifTerkunci_ = []; return ok; },
    hasLock: function() { return lock.hasLock(); },
    releaseLock: function() {
      try { lock.releaseLock(); } finally { kirimAntreanNotif_(); }
    }
  };
}
function kirimAntreanNotif_() {
  const antre = _antreanNotifTerkunci_;
  _antreanNotifTerkunci_ = null;
  if (!antre || !antre.length) return;
  antre.forEach(function(x){
    try {
      if (x[0] === 'wa') kirimWA_(x[2], x[3], x[1]);
      else if (x[0] === 'pushWali') kirimPushKeWali(x[1], x[2], x[3]);
    } catch (e) { Logger.log('Kirim notifikasi tertunda gagal: ' + e.message); }
  });
}
function kirimWAFonnteUmum(target, pesan) { kirimWA_(target, pesan); }

// ============ SPP: BIAYA BULANAN & STATUS PEMBAYARAN (36 bulan / 3 tahun dari TahunMasuk) ============
const BULAN_INDO_SPP = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

function headerSPP(){
  var h = ['NISN','Nama Santri','Biaya SPP'];
  for (var i=1;i<=36;i++) h.push('Bulan'+i);
  return h;
}

// ======================================================================
// KOLOM SHEET SPP -- dicari berdasarkan JUDUL, bukan posisi
//
// Sheet SPP dulu berstruktur tetap: NISN | Biaya SPP | Bulan1..Bulan36 | BebasSPP.
// Kolom "Nama Santri" kini disisipkan setelah NISN supaya sheet mudah dibaca langsung
// di Google Sheets. Semua fungsi SPP memakai pemeta ini, sehingga tetap benar baik
// sebelum maupun sesudah kolom Nama ditambahkan.
//
// Nama Santri hanya KETERANGAN untuk dibaca manusia: sumber kebenarannya tetap sheet
// Santri, dan nama di sini diselaraskan otomatis (lihat getSppList).
// ======================================================================
// PENTING -- fungsi ini HANYA MEMBACA susunan kolom, tidak pernah mengubahnya.
// Penyisipan kolom Nama Santri dilakukan terpisah & sengaja (apiSiapkanKolomNamaSpp),
// dipicu Admin/Mudir dari aplikasi versi terbaru. Alasannya: pemicu terjadwal
// (pengingat SPP) langsung memakai kode yang baru DISIMPAN, sedangkan aplikasi web baru
// memakai kode baru setelah DI-DEPLOY. Bila kolom disisipkan otomatis di sela waktu itu,
// aplikasi web versi lama (yang membaca berdasarkan posisi) akan menulis status lunas
// ke bulan yang salah.
function kolomSpp_(sh) {
  const header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(function(x){ return norm(x); });
  const cari = function(nama){ return header.indexOf(nama) + 1; };
  const iNama = cari('Nama Santri');
  let iBiaya = cari('Biaya SPP');
  if (!iBiaya) { const b = header.findIndex(function(h){ return /biaya/i.test(h); }); iBiaya = b > -1 ? b + 1 : (iNama ? 3 : 2); }
  let iBulan1 = cari('Bulan1');
  if (!iBulan1) iBulan1 = iBiaya + 1;
  return {nisn: 1, nama: iNama, biaya: iBiaya, bulan1: iBulan1, bebas: pastikanKolomBebasSPP(sh)};
}

// Versi kode server -- dipakai aplikasi untuk memastikan Code.gs terbaru sudah di-deploy
// sebelum menjalankan perubahan struktur (mis. menambah kolom Nama Santri).
const VERSI_SERVER = '2026.10.18-a';
function apiVersiServer() { return {ok:true, versi: VERSI_SERVER}; }

function apiStatusKolomNamaSpp(p) {
  const sh = getAktifSppSS().getSheetByName(SHEET_SPP);
  if (!sh) return {ok:true, ada:true};
  return {ok:true, ada: kolomSpp_(sh).nama > 0};
}

// Menyisipkan kolom "Nama Santri" setelah NISN -- dijalankan SEKALI oleh Admin/Mudir.
function apiSiapkanKolomNamaSpp(p) {
  if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Hanya Admin/Mudir.'};
  const sh = getAktifSppSS().getSheetByName(SHEET_SPP);
  if (!sh) return {ok:false, error:'Sheet SPP tidak ditemukan.'};
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return {ok:false, error:'Sistem sedang sibuk, coba lagi.'}; }
  try {
    let header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(function(x){ return norm(x); });
    if (header.indexOf('Nama Santri') !== -1) return {ok:true, sudahAda:true};
    if (norm(header[0]).toUpperCase() !== 'NISN') return {ok:false, error:'Kolom pertama sheet SPP bukan NISN. Susunan sheet tidak dikenali, kolom tidak ditambahkan.'};
    // Simpan cadangan susunan lama di sheet terpisah sebelum mengubah apa pun
    try {
      const nama = 'Cadangan SPP ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH.mm');
      sh.copyTo(sh.getParent()).setName(nama);
    } catch (e) { return {ok:false, error:'Gagal membuat cadangan sheet SPP, kolom tidak ditambahkan: ' + e.message}; }
    sh.insertColumnAfter(1);
    sh.getRange(1, 2).setValue('Nama Santri');
    const diisi = isiNamaSpp_(sh, 2);
    return {ok:true, diisi: diisi};
  } finally { lock.releaseLock(); }
}

// Baris baru sheet SPP sesuai susunan kolom yang berlaku
function barisBaruSpp_(k, nisn, nama, biaya, bulan36) {
  const panjang = Math.max(k.bulan1 - 1 + 36, k.bebas || 0);
  const baris = new Array(panjang).fill('');
  baris[k.nisn - 1] = nisn;
  if (k.nama) baris[k.nama - 1] = nama || '';
  baris[k.biaya - 1] = biaya;
  (bulan36 || []).slice(0, 36).forEach(function(v, i){ baris[k.bulan1 - 1 + i] = v; });
  return baris;
}

function petaNamaSantri_() {
  const peta = {};
  const sh = getAktifSS().getSheetByName(SHEET_SANTRI);
  if (sh && sh.getLastRow() > 1) sh.getDataRange().getValues().slice(1).forEach(function(r){ if (norm(r[0])) peta[norm(r[0])] = norm(r[1]); });
  // Santri yang sudah keluar/lulus tetap bernama di sheet SPP (riwayat pembayarannya tetap ada)
  const kel = petaMutasiKeluar_();
  Object.keys(kel).forEach(function(n){ if (!peta[n]) peta[n] = kel[n].nama + ' (' + (kel[n].jenis === 'Lulus' ? 'Lulus' : 'Keluar') + ')'; });
  return peta;
}

// Isi / selaraskan kolom Nama Santri dengan sheet Santri. Hanya menulis bila ada yang
// berbeda, dan sekaligus satu kolom (bukan per sel) supaya ringan.
function isiNamaSpp_(sh, kolomNama) {
  if (!kolomNama || sh.getLastRow() < 2) return 0;
  const peta = petaNamaSantri_();
  const jml = sh.getLastRow() - 1;
  const nisn = sh.getRange(2, 1, jml, 1).getValues();
  const lama = sh.getRange(2, kolomNama, jml, 1).getValues();
  let beda = 0;
  const baru = nisn.map(function(r, i){
    const n = norm(r[0]);
    const nama = n ? (peta[n] || '(NISN tidak ada di data Santri)') : '';
    if (norm(lama[i][0]) !== nama) beda++;
    return [nama];
  });
  if (beda) sh.getRange(2, kolomNama, jml, 1).setValues(baru);
  return beda;
}

// Kolom "BebasSPP" ditambahkan otomatis di posisi terakhir (setelah 36 kolom bulan)
// kalau belum ada. Dipakai untuk santri yang dibebaskan dari kewajiban SPP (misal
// beasiswa, dhuafa, atau kebijakan Mudir) -- sengaja disimpan sebagai kolom terpisah,
// bukan menghapus data biaya/bulan yang sudah ada, supaya kalau status bebasnya
// dicabut suatu saat, riwayat pembayaran sebelumnya tidak hilang.
function pastikanKolomBebasSPP(sh) {
  var header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  var idx = header.indexOf('BebasSPP');
  if (idx !== -1) return idx + 1;
  var kolomBaru = header.length + 1;
  sh.getRange(1, kolomBaru).setValue('BebasSPP');
  return kolomBaru;
}

/** Label "Agustus 2026" dari nomor bulan (1-36) relatif ke TahunMasuk santri */
/** Bulan 1 = Juli tahun masuk (awal tahun ajaran pesantren)
 *  Bulan 12 = Juni tahun berikutnya
 *  Bulan 13 = Juli tahun berikutnya, dst.
 *  Total 36 bulan = 3 tahun ajaran */
function labelBulanSPP(idx, tahunMasuk){
  // Konversi index (1-36) ke bulan kalender + offset tahun
  // idx=1  → Juli tahun masuk       (month=6, year=tahunMasuk)
  // idx=6  → Desember tahun masuk   (month=11, year=tahunMasuk)
  // idx=7  → Januari tahun masuk+1  (month=0, year=tahunMasuk+1)
  // idx=12 → Juni tahun masuk+1     (month=5, year=tahunMasuk+1)
  var offsetDariJuli = idx - 1;               // 0..35
  var totalBulanKalender = 6 + offsetDariJuli; // Juli=6, +offset
  var yearOffset = Math.floor(totalBulanKalender / 12);
  var monthIdx = totalBulanKalender % 12;
  var year = parseInt(tahunMasuk) + yearOffset;
  return BULAN_INDO_SPP[monthIdx] + ' ' + year;
}

/** Berapa bulan (relatif hari ini) yang sudah jatuh tempo untuk satu santri */
/** Berapa bulan (relatif hari ini) yang sudah jatuh tempo untuk satu santri.
 *  Bulan 1 = Juli tahun masuk. Setiap bulan yang sudah lewat dianggap jatuh tempo. */
function bulanJatuhTempoSPP(tahunMasuk, sampaiTanggal){
  // sampaiTanggal (opsional, 'yyyy-MM-dd'): untuk santri yang sudah keluar/lulus, tagihan
  // berhenti di bulan ia keluar -- tidak terus bertambah setelahnya.
  var today = new Date();
  if (sampaiTanggal) { var q = String(sampaiTanggal).split('-').map(Number); if (q.length === 3 && q[0]) today = new Date(q[0], q[1]-1, q[2]); }
  var maxIdx = 0;
  for (var m=1; m<=36; m++){
    // Hitung tanggal awal bulan ke-m
    // Bulan 1 = Juli (month=6), Bulan 7 = Januari tahun berikutnya (month=0)
    var totalBulanKalender = 6 + (m - 1);
    var yearOffset = Math.floor(totalBulanKalender / 12);
    var monthIdx = totalBulanKalender % 12;
    var d = new Date(parseInt(tahunMasuk) + yearOffset, monthIdx, 1);
    if (d <= today) maxIdx = m; else break;
  }
  return maxIdx;
}

// Ambil semua data SPP, digabung dengan Nama/No WA/TahunMasuk dari sheet Santri yang
// sudah ada (satu database, TIDAK ada data santri yang diduplikasi di sini).
function getSppList(){
  const ss = getAktifSS();
  const santriRows = ss.getSheetByName(SHEET_SANTRI).getDataRange().getValues();
  const santriMap = {};
  for (var i=1;i<santriRows.length;i++){
    var nisnS = norm(santriRows[i][0]);
    if (!nisnS) continue;
    santriMap[nisnS] = { nama: norm(santriRows[i][1]), tahunMasuk: santriRows[i][2], noWa: norm(santriRows[i][4]) };
  }
  const shSpp = getAktifSppSS().getSheetByName(SHEET_SPP);
  if (!shSpp) return [];
  const k = kolomSpp_(shSpp);
  const rows = shSpp.getDataRange().getValues(); rows.shift();
  // Selaraskan kolom Nama Santri bila ada yang berbeda (santri ganti nama/NISN, baris baru)
  const kel = petaMutasiKeluar_();
  const petaNama = petaNamaSantri_();
  if (k.nama) {
    const perluSelaras = rows.some(function(r){
      const n = norm(r[0]); if (!n) return false;
      const seharusnya = petaNama[n] || '(NISN tidak ada di data Santri)';
      return norm(r[k.nama - 1]) !== seharusnya;
    });
    if (perluSelaras) { try { isiNamaSpp_(shSpp, k.nama); } catch (e) {} }
  }
  return rows.filter(function(r){ return r[0]; }).map(function(r){
    const nisn = norm(r[0]);
    let info = santriMap[nisn], status = '', tanggalKeluar = '';
    if (!info && kel[nisn]) {
      // Santri sudah keluar/lulus: data diambil dari salinan saat mutasi
      let d = null; try { d = JSON.parse(kel[nisn]._data); } catch (e) {}
      const row = d && d.row ? d.row : [];
      info = { nama: kel[nisn].nama, tahunMasuk: row[2] || new Date().getFullYear(), noWa: norm(row[4]) };
      status = kel[nisn].jenis; tanggalKeluar = kel[nisn].tanggal;
    }
    info = info || { nama:'(NISN tidak ditemukan di data Santri)', tahunMasuk: new Date().getFullYear(), noWa:'' };
    return { nisn: nisn, nama: info.nama, noWa: info.noWa, tahunMasuk: info.tahunMasuk, biaya: Number(r[k.biaya-1])||0,
             months: r.slice(k.bulan1-1, k.bulan1-1+36), bebas: String(r[k.bebas-1]).toUpperCase() === 'TRUE',
             status: status, tanggalKeluar: tanggalKeluar };
  });
}

// Atur/ubah biaya SPP bulanan seorang santri -- kalau santri ini belum punya baris SPP
// sama sekali, otomatis dibuatkan barisnya (36 bulan kosong).
function apiSetBiayaSpp(p){
  const nisn = norm(p.nisn);
  const biaya = Number(p.biaya) || 0;
  if (!nisn) return {ok:false, error:'NISN wajib diisi'};
  if (biaya <= 0) return {ok:false, error:'Biaya SPP wajib diisi dan lebih dari 0'};
  const sh = getAktifSppSS().getSheetByName(SHEET_SPP);
  if (!sh) return {ok:false, error:'Sheet SPP tidak ditemukan. Jalankan Migrasi Skema dulu.'};
  const k = kolomSpp_(sh);
  const rows = sh.getDataRange().getValues();
  for (var i=1;i<rows.length;i++){
    if (norm(rows[i][0]) === nisn) { sh.getRange(i+1, k.biaya).setValue(biaya); return {ok:true}; }
  }
  sh.appendRow(barisBaruSpp_(k, nisn, petaNamaSantri_()[nisn] || '', biaya, []));
  return {ok:true};
}

// Tandai satu bulan LUNAS / batalkan (klik lagi buat kosongkan). Begitu baru saja
// ditandai LUNAS, otomatis kirim WA konfirmasi ke wali santri (kalau WhatsApp diatur
// dan No WA Ortu terisi).
function apiToggleSppBulan(p){
  const nisn = norm(p.nisn);
  const bulan = Number(p.bulan);
  if (!nisn || bulan < 1 || bulan > 36) return {ok:false, error:'Data tidak valid'};
  const ss = getAktifSS();
  const sh = getAktifSppSS().getSheetByName(SHEET_SPP);
  if (!sh) return {ok:false, error:'Sheet SPP tidak ditemukan. Jalankan Migrasi Skema di menu Admin.'};
  const kSpp = kolomSpp_(sh);
  const rows = sh.getDataRange().getValues();
  var rowIdx = -1, biayaBaris = 0;
  for (var i=1;i<rows.length;i++){ if (norm(rows[i][0]) === nisn) { rowIdx = i+1; biayaBaris = Number(rows[i][kSpp.biaya-1])||0; break; } }
  if (rowIdx === -1) return {ok:false, error:'Santri ini belum punya data SPP. Atur biaya SPP dulu di menu "Atur Biaya SPP".'};

  // Kolom Bulan ke-N dicari dari posisi judul "Bulan1" (lihat kolomSpp_)
  const col = kSpp.bulan1 - 1 + bulan;
  const nilaiSekarang = sh.getRange(rowIdx, col).getValue();
  var nilaiBaru, jadiLunas = false;
  if (norm(nilaiSekarang)) {
    nilaiBaru = '';
  } else {
    const tz = Session.getScriptTimeZone();
    nilaiBaru = 'Lunas (' + Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy') + ')';
    jadiLunas = true;
  }
  sh.getRange(rowIdx, col).setValue(nilaiBaru);

  if (jadiLunas) {
    const santriRows = ss.getSheetByName(SHEET_SANTRI).getDataRange().getValues();
    for (var k=1;k<santriRows.length;k++){
      if (norm(santriRows[k][0]) === nisn) {
        var nama = norm(santriRows[k][1]);
        var noWa = norm(santriRows[k][4]);
        var tahunMasuk = santriRows[k][2];
        if (noWa) {
          kirimWAKategori_('spp_lunas', noWa, 'Assalamualaikum Wr. Wb.\n\nYth. Orang Tua/Wali Santri *'+nama+'*\n\nAlhamdulillah, pembayaran SPP bulan *'+labelBulanSPP(bulan, tahunMasuk)+'* telah berhasil diproses.\n\nJumlah: Rp'+biayaBaris.toLocaleString('id-ID')+'\nStatus: LUNAS \u2713\n\nJazakumullah khairan atas kerjasamanya.');
        }
        // Push ke wali. Sengaja DI LUAR syarat noWa di atas: push tidak butuh nomor
        // telepon, jadi tetap terkirim walau nomor WA santri belum terisi.
        try {
          kirimPushKeWali(nisn, '\u2705 SPP Lunas',
            'Pembayaran SPP ' + labelBulanSPP(bulan, tahunMasuk) + ' untuk ' + nama + ' sebesar ' + rp(biayaBaris) + ' sudah tercatat LUNAS. Jazakumullah khairan.');
        } catch(e) { Logger.log('Notif wali SPP lunas gagal: ' + e.message); }
        break;
      }
    }
  }
  return {ok:true, nilaiBaru: nilaiBaru};
}

// Import data SPP massal dari hasil copy-paste Excel (dipisah TAB). Karena skema ID
// pada sistem SPP lama biasanya BEDA dengan NISN di sistem ini, pencocokan santri
// dilakukan berdasarkan NAMA (dicek ke data Santri yang sudah ada) -- bukan berdasarkan
// ID lama, supaya tidak ada data santri ganda. Baris dengan nama yang tidak ditemukan
// atau bertabrakan (lebih dari satu santri nama sama persis) DILEWATI dan dilaporkan,
// tidak pernah ditebak sembarangan.
// Mendukung 2 format kolom (dideteksi otomatis dari jumlah kolom):
//  - Format lama (leluasa, boleh langsung copy dari sistem SPP lama):
//      ID, NAMA, NoHP, BiayaSPP, TahunMasuk, Bulan1 ... Bulan36
//  - Format ringkas:
//      NAMA, BiayaSPP, Bulan1 ... Bulan36
function apiImportSpp(p) {
  // Mode preview: hanya parsing + cocokkan ke database, TIDAK simpan
  // Mode simpan: setelah user konfirmasi di preview
  const raw = String(p.tsv || '');
  if (!raw.trim()) return {ok:false, error:'Data yang ditempel masih kosong'};
  const lines = raw.split(/\r?\n/).filter(function(l){ return l.trim() !== ''; });
  if (!lines.length) return {ok:false, error:'Data kosong'};

  const firstCells = lines[0].split('\t');
  const firstCellLower = (firstCells[0]||'').toString().trim().toLowerCase();
  const hasHeader = firstCellLower === 'id' || firstCellLower === 'nama' || firstCellLower === 'nisn' || firstCellLower === 'name';
  // Bila ada baris judul yang memuat "Bulan1", kolom dibaca BERDASARKAN JUDUL -- supaya
  // data yang disalin langsung dari sheet SPP (dengan/tanpa kolom Nama Santri dan
  // BebasSPP) terbaca benar. Tebakan dari jumlah kolom hanya dipakai bila tanpa judul.
  var petaJudul = null;
  if (hasHeader) {
    var judul = firstCells.map(function(x){ return String(x||'').trim().toLowerCase().replace(/\s+/g,' '); });
    var iB1 = judul.indexOf('bulan1');
    if (iB1 === -1) iB1 = judul.indexOf('bulan 1');
    if (iB1 > -1) {
      var cariJudul = function(uji){ for (var q=0;q<judul.length;q++) { if (uji(judul[q])) return q; } return -1; };
      petaJudul = {
        nisn: cariJudul(function(h){ return h === 'nisn' || h === 'id'; }),
        nama: cariJudul(function(h){ return h === 'nama' || h === 'nama santri' || h === 'name'; }),
        biaya: cariJudul(function(h){ return h.indexOf('biaya') > -1; }),
        bulan1: iB1
      };
    }
  }
  if (hasHeader) lines.shift();
  if (!lines.length) return {ok:false, error:'Tidak ada data setelah baris header'};

  // Ambil DATABASE SANTRI (sumber kebenaran utama)
  const ss = getAktifSS();
  const shSantri = ss.getSheetByName(SHEET_SANTRI);
  if (!shSantri) return {ok:false, error:'Sheet Santri tidak ditemukan. Jalankan Migrasi Skema dulu.'};
  const santriRows = shSantri.getDataRange().getValues();

  // Normalisasi nama untuk pencocokan yang sangat toleran
  function normImport(s) {
    return norm(s).toLowerCase()
      .replace(/['\u2018\u2019\u201B\u2032`]/g,'')  // apostrof
      .replace(/\./g,' ')                             // titik → spasi (Moh. → Moh)
      .replace(/\s*-\s*/g,' ')                        // tanda hubung → spasi
      .replace(/\s+/g,' ').trim();
  }

  // Buat index database santri dengan berbagai varian normalisasi
  const nisnIndex = {};
  const namaIndexDB = {}; // nama_ternorm → [nisn]

  for (var i=1;i<santriRows.length;i++) {
    var nisnDB = norm(santriRows[i][0]);
    var namaDB = norm(santriRows[i][1]);
    if (!nisnDB) continue;
    nisnIndex[nisnDB] = {nisn:nisnDB, nama:namaDB};

    // Simpan dengan normalisasi standar dan toleran
    var namaL1 = namaDB.toLowerCase();           // standar
    var namaL2 = normImport(namaDB);             // toleran
    [namaL1, namaL2].forEach(function(key){
      if (!namaIndexDB[key]) namaIndexDB[key] = [];
      if (namaIndexDB[key].indexOf(nisnDB) === -1) namaIndexDB[key].push(nisnDB);
    });
  }

  // Ambil data SPP yang sudah ada
  const shSpp = getAktifSppSS().getSheetByName(SHEET_SPP);
  const sppExisting = {};
  if (shSpp) {
    const sppRows = shSpp.getDataRange().getValues();
    for (var j=1;j<sppRows.length;j++) {
      if (sppRows[j][0]) sppExisting[norm(sppRows[j][0])] = j+1;
    }
  }

  // Fungsi cari santri dengan multi-strategi matching
  function cariSantri(nisnImport, namaImport) {
    // Strategi 1: cocok NISN persis
    if (nisnImport && nisnIndex[nisnImport]) {
      return {cocok: nisnIndex[nisnImport], cara: 'nisn'};
    }

    if (!namaImport) return null;

    var namaImportNorm1 = namaImport.toLowerCase();    // standar
    var namaImportNorm2 = normImport(namaImport);      // toleran

    // Strategi 2: cocok nama persis (standar)
    if (namaIndexDB[namaImportNorm1] && namaIndexDB[namaImportNorm1].length === 1) {
      return {cocok: nisnIndex[namaIndexDB[namaImportNorm1][0]], cara: 'nama_persis'};
    }

    // Strategi 3: cocok nama toleran (hapus titik/apostrof/tanda hubung)
    if (namaIndexDB[namaImportNorm2] && namaIndexDB[namaImportNorm2].length === 1) {
      return {cocok: nisnIndex[namaIndexDB[namaImportNorm2][0]], cara: 'nama_toleran'};
    }

    // Strategi 4: fuzzy — semua kata kunci ada di nama DB
    var kataCari = namaImportNorm2.split(' ').filter(function(k){ return k.length > 2; });
    var matches = Object.keys(nisnIndex).filter(function(nisn){
      var namaDB = normImport(nisnIndex[nisn].nama);
      return kataCari.every(function(kata){ return namaDB.indexOf(kata) !== -1; });
    });
    if (matches.length === 1) {
      return {cocok: nisnIndex[matches[0]], cara: 'nama_fuzzy'};
    }
    if (matches.length > 1) {
      return {duplikat: matches.map(function(n){ return nisnIndex[n].nama; })};
    }

    // Strategi 5: cocok nama pertama + nama terakhir saja
    var kata = namaImportNorm2.split(' ').filter(function(k){ return k.length > 2; });
    if (kata.length >= 2) {
      var depan = kata[0], belakang = kata[kata.length-1];
      var matches2 = Object.keys(nisnIndex).filter(function(nisn){
        var namaDB = normImport(nisnIndex[nisn].nama);
        return namaDB.indexOf(depan) !== -1 && namaDB.indexOf(belakang) !== -1;
      });
      if (matches2.length === 1) {
        return {cocok: nisnIndex[matches2[0]], cara: 'nama_depan_belakang'};
      }
    }

    return null;
  }

  // Parse setiap baris data import
  var preview = [], tidakCocok = [], duplikatNama = [];
  lines.forEach(function(line, idx){
    var cells = line.split('\t');
    var nisnImport, namaImport, biaya, months;

    if (petaJudul) {
      nisnImport = petaJudul.nisn > -1 ? norm(cells[petaJudul.nisn]) : '';
      namaImport = petaJudul.nama > -1 ? norm(cells[petaJudul.nama]) : '';
      biaya = petaJudul.biaya > -1 ? (Number(String(cells[petaJudul.biaya]||'').replace(/[^0-9]/g,'')) || 0) : 0;
      months = cells.slice(petaJudul.bulan1, petaJudul.bulan1 + 36);
    } else

    // Deteksi format: 38+ kolom = format lama (ID/NISN, NAMA, NoHP, Biaya, TahunMasuk, B1..B36)
    //                 38 kolom  = NISN, NAMA, Biaya, B1..B36 (format baru)
    //                 <38 kolom = NAMA, Biaya, B1..B36 (ringkas) atau NISN, Biaya, B1..B36
    if (cells.length >= 40) {
      nisnImport = norm(cells[0]);
      namaImport = norm(cells[1]);
      biaya = Number(cells[3]) || 0;
      months = cells.slice(5, 41);
    } else if (cells.length >= 38) {
      nisnImport = norm(cells[0]);
      namaImport = norm(cells[1]);
      biaya = Number(cells[2]) || 0;
      months = cells.slice(3, 39);
    } else {
      // Format ringkas: kolom pertama bisa NISN atau nama
      var col0 = norm(cells[0]);
      var isNisn = /^\d{8,15}$/.test(col0); // NISN biasanya 10 digit angka
      if (isNisn) {
        nisnImport = col0;
        namaImport = norm(cells[1]) || '';
        biaya = Number(cells[2]) || 0;
        months = cells.slice(3, 39);
      } else {
        nisnImport = '';
        namaImport = col0;
        biaya = Number(cells[1]) || 0;
        months = cells.slice(2, 38);
      }
    }

    while (months.length < 36) months.push('');
    var bulanBersih = months.map(function(m){
      var s = String(m||'').trim().toLowerCase();
      return (s === 'l' || s === 'lunas' || s.indexOf('lunas') === 0) ? 'Lunas' : '';
    });
    var jumlahLunas = bulanBersih.filter(function(x){return x==='Lunas';}).length;

    // Cari santri di DATABASE menggunakan multi-strategi
    var hasil = cariSantri(nisnImport, namaImport);
    var cocok = null, statusCocok = '';

    if (!hasil) {
      tidakCocok.push({baris:idx+1, nisn:nisnImport||'-', nama:namaImport||'-'});
      return;
    }
    if (hasil.duplikat) {
      duplikatNama.push({baris:idx+1, nama:namaImport, pilihan:hasil.duplikat});
      return;
    }
    cocok = hasil.cocok;
    statusCocok = hasil.cara;

    preview.push({
      nisn: cocok.nisn,
      nama: cocok.nama,
      biaya: biaya,
      months: bulanBersih,
      jumlahLunas: jumlahLunas,
      statusCocok: statusCocok,
      sudahAdaSpp: !!sppExisting[cocok.nisn],
    });
  });

  // Mode PREVIEW: kembalikan hasil tanpa simpan
  if (!p.konfirmasi) {
    return {
      ok: true,
      mode: 'preview',
      preview: preview,
      tidakCocok: tidakCocok,
      duplikatNama: duplikatNama,
      totalBaris: lines.length,
    };
  }

  // Mode SIMPAN: setelah user konfirmasi
  if (!shSpp) return {ok:false, error:'Sheet SPP tidak ditemukan. Jalankan Migrasi Skema dulu.'};
  var ditambah = 0, diperbarui = 0;
  const kImp = kolomSpp_(shSpp);
  const namaImp = petaNamaSantri_();
  preview.forEach(function(item){
    if (sppExisting[item.nisn]) {
      // Tulis hanya kolom NISN..Bulan36 -- kolom BebasSPP yang sudah diatur tidak tertimpa
      var baris = barisBaruSpp_(kImp, item.nisn, namaImp[item.nisn] || '', item.biaya, item.months).slice(0, kImp.bulan1 - 1 + 36);
      shSpp.getRange(sppExisting[item.nisn], 1, 1, baris.length).setValues([baris]);
      diperbarui++;
    } else {
      var baris = barisBaruSpp_(kImp, item.nisn, namaImp[item.nisn] || '', item.biaya, item.months);
      shSpp.appendRow(baris);
      sppExisting[item.nisn] = shSpp.getLastRow();
      ditambah++;
    }
  });

  return {
    ok: true,
    mode: 'simpan',
    ditambah: ditambah,
    diperbarui: diperbarui,
    dilewati: tidakCocok.length + duplikatNama.length,
    tidakCocok: tidakCocok,
    duplikatNama: duplikatNama,
  };
}

// ============================================================
// TRIGGER PENGINGAT SPP TERJADWAL
// Cara pakai: buka Apps Script → Run → setupTriggerPengingatSPP
// Trigger akan otomatis kirim WA ke semua yang menunggak
// setiap tanggal 7 dan 20 setiap bulan pukul 08.00
// ============================================================

/**
 * Jalankan fungsi ini SEKALI dari menu Run di Apps Script Editor
 * untuk memasang trigger otomatis pengingat SPP.
 * Setelah terpasang, tidak perlu dijalankan lagi.
 */
function setupTriggerPengingatSPP() {
  // Hapus trigger lama kalau ada (hindari duplikat)
  hapusTriggerPengingatSPP();

  // Trigger tanggal 7 setiap bulan pukul 08.00-09.00
  ScriptApp.newTrigger('jalankanPengingatSPP')
    .timeBased()
    .onMonthDay(7)
    .atHour(8)
    .create();

  // Trigger tanggal 20 setiap bulan pukul 08.00-09.00
  ScriptApp.newTrigger('jalankanPengingatSPP')
    .timeBased()
    .onMonthDay(20)
    .atHour(8)
    .create();

  Logger.log('✅ Trigger pengingat SPP berhasil dipasang.');
  Logger.log('   → Akan berjalan setiap tanggal 7 dan 20 pukul 08.00.');
  Logger.log('   → Cek menu Triggers di Apps Script Editor untuk konfirmasi.');

  // Kirim notif ke Admin/Mudir bahwa trigger sudah terpasang
  try {
    const sh = getAktifSS().getSheetByName(SHEET_ROLE);
    if (sh) {
      const rows = sh.getDataRange().getValues(); rows.shift();
      rows.forEach(function(r) {
        const roles = norm(r[3]).split(',').map(function(s){ return s.trim(); });
        if ((roles.indexOf('Admin') !== -1 || roles.indexOf('Mudir') !== -1) && norm(r[1])) {
          kirimWAKategori_('spp_laporan_admin', norm(r[1]),
            '✅ *WASIAT: Trigger Pengingat SPP Terpasang*\n\n' +
            'Pengingat SPP otomatis sudah aktif.\n' +
            'Sistem akan kirim WA ke wali santri yang menunggak setiap:\n' +
            '• Tanggal 7 setiap bulan pukul 08.00\n' +
            '• Tanggal 20 setiap bulan pukul 08.00\n\n' +
            'Untuk menonaktifkan, jalankan fungsi *hapusTriggerPengingatSPP* di Apps Script.'
          );
        }
      });
    }
  } catch(e) { Logger.log('Notif admin gagal: ' + e.message); }
}

/**
 * Jalankan fungsi ini untuk menghapus/menonaktifkan trigger pengingat SPP.
 */
function hapusTriggerPengingatSPP() {
  const triggers = ScriptApp.getProjectTriggers();
  let hapus = 0;
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'jalankanPengingatSPP') {
      ScriptApp.deleteTrigger(t);
      hapus++;
    }
  });
  Logger.log(hapus > 0
    ? '✅ ' + hapus + ' trigger pengingat SPP berhasil dihapus.'
    : 'ℹ️ Tidak ada trigger pengingat SPP yang aktif.');
}

/**
 * Fungsi ini DIJALANKAN OTOMATIS oleh trigger setiap tanggal 7 dan 20.
 * Tidak perlu dijalankan manual.
 */
function jalankanPengingatSPP() {
  // Dimatikan Admin/Mudir: tidak mengirim tagihan dan tidak mengirim laporan
  // "sekian tagihan terkirim" yang menyesatkan.
  if (jenisWANonaktif_()['spp_tagihan_otomatis']) { Logger.log('Pengingat SPP otomatis dinonaktifkan -- dilewati.'); return; }
  const tz = Session.getScriptTimeZone();
  const hari = Utilities.formatDate(new Date(), tz, 'dd MMMM yyyy');
  const jam  = Utilities.formatDate(new Date(), tz, 'HH:mm');

  Logger.log('=== Pengingat SPP Otomatis ===');
  Logger.log('Dijalankan: ' + hari + ' ' + jam);

  // Ambil data tunggakan
  const tunggakan = getTunggakanSantri();

  if (!tunggakan.length) {
    Logger.log('ℹ️ Tidak ada santri yang menunggak. Tidak ada WA yang dikirim.');
    return;
  }

  Logger.log('Jumlah santri menunggak: ' + tunggakan.length);

  let terkirim = 0, gagal = 0, tanpaWA = 0;

  tunggakan.forEach(function(s) {
    // Santri yang sudah keluar/lulus tidak dikirimi pengingat otomatis (tagihan tetap
    // terlihat di daftar tunggakan, dan bisa ditagih manual per santri bila perlu).
    if (s.status) return;
    // Push ke wali dikirim lebih dulu dan TIDAK bergantung pada nomor WA. Ini penting:
    // sebelumnya santri yang nomor WA-nya belum terdaftar dilewati sama sekali, jadi
    // walinya tidak pernah diingatkan. Dengan push, mereka tetap dapat pemberitahuan.
    try {
      kirimPushKeWali(s.nisn, '\uD83D\uDCB3 Pengingat Pembayaran SPP',
        'Tunggakan SPP ' + s.nama + ': ' + rp(s.tunggakanSPP) + ' (' + s.jumlahBulan + ' bulan). Mohon segera diselesaikan. Jazakumullah khairan.');
    } catch(e) { Logger.log('Notif wali tagihan SPP gagal: ' + e.message); }

    if (!s.noWa) {
      Logger.log('\u26A0\uFE0F ' + s.nama + ': No WA tidak terdaftar, WA dilewati (push tetap dikirim).');
      tanpaWA++;
      return;
    }

    try {
      const pesan = buildPesanTagihanSPP(s.nama, s.bulanTunggak, s.tunggakanSPP);
      kirimWAKategori_('spp_tagihan_otomatis', s.noWa, pesan);
      Logger.log('✅ Terkirim ke ' + s.nama + ' (' + s.noWa + ')');
      terkirim++;
      // Jeda 1 detik antar pengiriman agar tidak dibatasi penyedia WA
      Utilities.sleep(1000);
    } catch(e) {
      Logger.log('❌ Gagal kirim ke ' + s.nama + ': ' + e.message);
      gagal++;
    }
  });

  // Buat laporan dan kirim ke Admin/Mudir
  const laporan =
    '📊 *Laporan Pengingat SPP Otomatis*\n' +
    'Tanggal: ' + hari + ' ' + jam + '\n\n' +
    '✅ Terkirim : ' + terkirim + ' santri\n' +
    '❌ Gagal    : ' + gagal + ' santri\n' +
    '⚠️ Tanpa WA : ' + tanpaWA + ' santri\n' +
    '📋 Total    : ' + tunggakan.length + ' santri menunggak\n\n' +
    (gagal > 0 ? '_Ada pengiriman yang gagal. Cek log di Apps Script Editor._' : '_Semua pengiriman berhasil._');

  try {
    const sh = getAktifSS().getSheetByName(SHEET_ROLE);
    if (sh) {
      const rows = sh.getDataRange().getValues(); rows.shift();
      rows.forEach(function(r) {
        const roles = norm(r[3]).split(',').map(function(s){ return s.trim(); });
        if ((roles.indexOf('Admin') !== -1 || roles.indexOf('Mudir') !== -1 ||
             roles.indexOf('Bendahara') !== -1) && norm(r[1])) {
          kirimWAKategori_('spp_laporan_admin', norm(r[1]), laporan);
        }
      });
    }
  } catch(e) { Logger.log('Laporan ke admin gagal: ' + e.message); }

  Logger.log('=== Selesai. Terkirim: ' + terkirim + ', Gagal: ' + gagal + ', Tanpa WA: ' + tanpaWA + ' ===');
}

/**
 * (Opsional) Fungsi untuk TEST kirim pengingat manual tanpa menunggu trigger.
 * Jalankan dari Apps Script Editor untuk uji coba.
 */
function testKirimPengingatSPP() {
  Logger.log('--- TEST MODE: Simulasi pengingat SPP ---');
  const tunggakan = getTunggakanSantri();
  Logger.log('Santri menunggak: ' + tunggakan.length);
  tunggakan.slice(0, 3).forEach(function(s) {
    const pesan = buildPesanTagihanSPP(s.nama, s.bulanTunggak, s.tunggakanSPP);
    Logger.log('--- Pesan untuk ' + s.nama + ' (' + (s.noWa || 'TANPA WA') + ') ---');
    Logger.log(pesan);
    Logger.log('---');
  });
  Logger.log('Test selesai. Jalankan setupTriggerPengingatSPP() untuk mengaktifkan.');
}


function getNoWABendahara() {
  const sh = getAktifSS().getSheetByName(SHEET_ROLE);
  const rows = sh.getDataRange().getValues(); rows.shift();
  for (let i=0;i<rows.length;i++) {
    const roles = norm(rows[i][3]).split(',').map(function(s){ return s.trim(); });
    if (roles.indexOf('Bendahara') !== -1) return norm(rows[i][1]);
  }
  return '';
}

function getSaldoSantriKantin(nisn) {
  nisn = norm(nisn);
  const rows = getAktifSS().getSheetByName(SHEET_SANTRI).getDataRange().getValues();
  const header = rows[0];
  const iSaldo = header.indexOf('Saldo Kantin'), iLimit = header.indexOf('Limit Harian Kantin');
  for (let i=1;i<rows.length;i++) {
    if (norm(rows[i][0]) === nisn) return { nama: norm(rows[i][1]), saldo: Number(rows[i][iSaldo])||0, limit: Number(rows[i][iLimit])||0 };
  }
  return { nama:'', saldo:0, limit:0 };
}

// Format kolom waktu dari spreadsheet menjadi string "HH:mm".
// Kolom waktu di Google Sheets BISA berupa: objek Date, string "13:44:11",
// atau string kosong. Kalau langsung di-String() pada objek Date, hasilnya
// "Sat Dec 30 1899 ..." -- itulah yang tampil di screenshot.
function formatWaktu(nilaiWaktu, tz) {
  if (!nilaiWaktu) return '';
  if (nilaiWaktu instanceof Date) {
    // Ambil HH:mm saja; detiknya tidak perlu ditampilkan ke pengguna
    return Utilities.formatDate(nilaiWaktu, tz || Session.getScriptTimeZone(), 'HH:mm');
  }
  // Sudah berupa string: ambil hanya HH:mm (2 segmen pertama)
  return String(nilaiWaktu).split(':').slice(0, 2).join(':');
}

function getRiwayatTransaksiSantriKantin(nisn, tglMulai, tglAkhir) {
  nisn = norm(nisn);
  const sh = getAktifKantinSS().getSheetByName(SHEET_TRANSAKSI_KANTIN);
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  return rows.map(function(r){
    const d = (r[0] instanceof Date) ? r[0] : new Date(r[0]);
    return { tanggal: Utilities.formatDate(d,tz,'yyyy-MM-dd'), waktu: formatWaktu(r[1],tz), nisn: norm(r[2]), kategori: norm(r[5]),
      namaBarang: norm(r[6]), jumlah: Number(r[7])||0, nominal: Number(r[4])||0, saldoSekarang: Number(r[12])||0 };
  }).filter(function(x){
    if (x.nisn !== nisn) return false;
    if (tglMulai && x.tanggal < tglMulai) return false;
    if (tglAkhir && x.tanggal > tglAkhir) return false;
    return true;
  }).sort(function(a,b){ return b.tanggal.localeCompare(a.tanggal) || b.waktu.localeCompare(a.waktu); });
}

// Wali mengajukan tambah saldo -- status "Pending" sampai Bendahara/Mudir menyetujui
// (setelah menerima bukti transfer). Otomatis kirim notifikasi WA ke Bendahara (kalau
// WhatsApp diatur DAN ada akun ber-role Bendahara dengan No WA terisi).
function apiAjukanTopUpSaldo(p) {
  const nisn = norm(p.nisn), namaSantri = norm(p.namaSantri), nominal = Number(p.nominal) || 0, noWaWali = norm(p.noWaWali);
  if (!nisn || nominal <= 0) return {ok:false, error:'Nominal wajib diisi dan lebih dari 0'};
  const sh = getAktifKantinSS().getSheetByName(SHEET_PENGAJUAN_TOPUP);
  const tz = Session.getScriptTimeZone();
  sh.appendRow([Utilities.formatDate(new Date(),tz,'yyyy-MM-dd'), Utilities.formatDate(new Date(),tz,'HH:mm:ss'), nisn, namaSantri, nominal, noWaWali, 'Pending', '', '']);

  const noWaBendahara = getNoWABendahara();
  if (noWaBendahara) {
    kirimWAKategori_('topup_ke_bendahara', noWaBendahara, 'Assalamualaikum Wr. Wb.\n\n*PENGAJUAN TAMBAH SALDO*\n\nSantri: *'+namaSantri+'*\nNominal: Rp'+nominal.toLocaleString('id-ID')+'\n\nMohon dicek bukti transfer dari wali santri, lalu setujui lewat dashboard Bendahara.\n\nWassalamualaikum Wr. Wb.');
  }
  return {ok:true, noWaBendahara: noWaBendahara};
}

// Orang tua mengatur/mengubah limit belanja harian anaknya sendiri (0 = tanpa limit).
// Status SPP SATU santri saja -- dipakai dashboard Wali Santri, tidak pernah
// mengekspos data SPP santri lain lewat aksi ini.
function getSppSaya(nisn) {
  nisn = norm(nisn);
  const santriRows = getAktifSS().getSheetByName(SHEET_SANTRI).getDataRange().getValues();
  let tahunMasuk = new Date().getFullYear();
  for (let i=1;i<santriRows.length;i++) { if (norm(santriRows[i][0]) === nisn) { tahunMasuk = santriRows[i][2]; break; } }

  const shSpp = getAktifSppSS().getSheetByName(SHEET_SPP);
  const k = kolomSpp_(shSpp);
  const rows = shSpp.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) {
    if (norm(rows[i][0]) === nisn) {
      const bebas = String(rows[i][k.bebas-1]).toUpperCase() === 'TRUE';
      const biaya = Number(rows[i][k.biaya-1]) || 0;
      // Santri yang dibebaskan TIDAK PERNAH ditampilkan sebagai menunggak, terlepas
      // dari isi tabel 36 bulannya -- inilah perbaikan untuk santri yang seharusnya
      // dibebaskan (beasiswa/dhuafa) tapi sebelumnya tetap tercatat menunggak.
      if (bebas) {
        return { adaSpp:true, bebas:true, biaya:biaya, bulanTunggakan:[], totalTunggakan:0 };
      }
      const months = rows[i].slice(k.bulan1-1, k.bulan1-1+36);
      const due = bulanJatuhTempoSPP(tahunMasuk);
      const bulanTunggakan = [];
      for (let m=1;m<=due;m++) { if (!months[m-1]) bulanTunggakan.push(labelBulanSPP(m, tahunMasuk)); }
      return { adaSpp:true, bebas:false, biaya:biaya, bulanTunggakan:bulanTunggakan, totalTunggakan: bulanTunggakan.length*biaya };
    }
  }
  return { adaSpp:false, bebas:false, biaya:0, bulanTunggakan:[], totalTunggakan:0 };
}

// Tandai/cabut status bebas SPP seorang santri. Hanya Admin/Mudir yang boleh
// mengubah ini -- diverifikasi di server, bukan sekadar disembunyikan di tampilan.
// Kalau santri belum punya baris SPP sama sekali, baris baru dibuat dengan biaya 0
// supaya status bebasnya tetap bisa disimpan.
function apiSetBebasSpp(p) {
  if (!adminAtauMudir(p.oleh)) {
    return {ok:false, error:'Hanya Admin/Mudir yang boleh mengatur pembebasan SPP.'};
  }
  const nisn = norm(p.nisn);
  if (!nisn) return {ok:false, error:'Santri wajib dipilih.'};
  const bebas = (p.bebas === true || p.bebas === 'true');

  const sh = getAktifSppSS().getSheetByName(SHEET_SPP);
  if (!sh) return {ok:false, error:'Sheet SPP tidak ditemukan.'};
  const k = kolomSpp_(sh);
  const iBebas = k.bebas;
  const rows = sh.getDataRange().getValues();
  let rowIdx = -1;
  for (let i=1;i<rows.length;i++) { if (norm(rows[i][0]) === nisn) { rowIdx = i+1; break; } }

  if (rowIdx === -1) {
    // Belum ada baris SPP untuk santri ini -- buat baru dengan biaya 0 supaya status
    // bebasnya tetap tersimpan. Admin tetap bisa mengisi biaya normal nanti kalau
    // status bebasnya dicabut.
    sh.appendRow(barisBaruSpp_(k, nisn, petaNamaSantri_()[nisn] || '', 0, []));
    rowIdx = sh.getLastRow();
  }
  sh.getRange(rowIdx, iBebas).setValue(bebas ? 'TRUE' : 'FALSE');
  return {ok:true, bebas: bebas};
}

// ============ KANTIN: "PINJAM LAYAR" -- Pemilik Barang bisa cek akun santri (Tahap 6) ============
// HANYA validasi PIN Transaksi (tidak memproses transaksi apapun) -- dipakai supaya
// santri bisa masuk ke akunnya sendiri lewat perangkat Pemilik Barang.
function apiValidasiPinTransaksiSantri(p) {
  const nisn = norm(p.nisn), pin = norm(p.pin);
  if (!nisn || !pin) return {ok:false, error:'Santri dan PIN wajib diisi'};
  const rows = getAktifSS().getSheetByName(SHEET_SANTRI).getDataRange().getValues();
  const header = rows[0];
  const iPin = header.indexOf('PIN Transaksi');
  for (let i=1;i<rows.length;i++) {
    if (norm(rows[i][0]) === nisn) {
      const pinTersimpan = norm(rows[i][iPin]);
      if (!pinTersimpan) return {ok:false, error:'Santri ini belum punya PIN Transaksi. Minta Admin mengaturnya dulu di menu Data Santri.'};
      if (pinTersimpan !== pin) return {ok:false, error:'PIN salah'};
      return {ok:true, nama: norm(rows[i][1])};
    }
  }
  return {ok:false, error:'Data santri tidak ditemukan'};
}

// Santri mengganti PIN TRANSAKSI-nya sendiri (terpisah total dari PIN login akun Wali
// Santri di RoleAkses -- keduanya sengaja tidak pernah saling memengaruhi).
function apiGantiPinTransaksiSantri(p) {
  const nisn = norm(p.nisn), pinBaru = norm(p.pinBaru);
  if (!nisn || !pinBaru) return {ok:false, error:'PIN baru wajib diisi'};
  const sh = getAktifSS().getSheetByName(SHEET_SANTRI);
  const rows = sh.getDataRange().getValues();
  const header = rows[0];
  const iPin = header.indexOf('PIN Transaksi');
  for (let i=1;i<rows.length;i++) {
    if (norm(rows[i][0]) === nisn) { sh.getRange(i+1, iPin+1).setValue(pinBaru); return {ok:true}; }
  }
  return {ok:false, error:'Data santri tidak ditemukan'};
}

// Unggah gambar slide dari perangkat Admin langsung ke Google Drive (folder khusus),
// otomatis dibagikan "siapa saja yang punya link boleh lihat" supaya tampil untuk
// SEMUA role (Admin/Mudir/Guru/WaliSantri) tanpa perlu hosting eksternal manapun.
// Catatan: percobaan pertama mungkin minta Admin menyetujui izin akses Google Drive
// tambahan untuk skrip ini (wajar, karena baru pertama kali dipakai).
// Upload file (Word/PDF/apapun) ke Google Drive -- dipakai batch upload Modul Ajar.
// Menyimpan ke folder "WASIAT - Modul Ajar" di Drive, kalau belum ada otomatis dibuat.
function apiUploadFileKeDrive(p) {
  const base64 = p.base64, mimeType = p.mimeType||'application/octet-stream', fileName = p.fileName||'file';
  if (!base64) return {ok:false, error:'Data file kosong'};

  try {
    // Cari atau buat folder Modul Ajar
    const prop = PropertiesService.getScriptProperties();
    let folderId = prop.getProperty('MODUL_AJAR_FOLDER_ID');
    let folder;
    if (folderId) {
      try { folder = DriveApp.getFolderById(folderId); }
      catch(e) { folderId = null; }
    }
    if (!folderId) {
      const nama = 'WASIAT - Modul Ajar & RPP';
      const cari = DriveApp.getFoldersByName(nama);
      folder = cari.hasNext() ? cari.next() : DriveApp.createFolder(nama);
      prop.setProperty('MODUL_AJAR_FOLDER_ID', folder.getId());
    }

    // Upload file
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, fileName);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return {ok:true, fileId:file.getId(), url:'https://drive.google.com/file/d/'+file.getId()+'/view'};
  } catch(e) {
    return {ok:false, error:'Gagal upload ke Drive: '+e.message};
  }
}

function apiUploadSlideImage(p) {
  try {
    if (!p.base64) return {ok:false, error:'Data gambar kosong, coba pilih ulang filenya.'};
    const mimeType = p.mimeType || 'image/jpeg';
    const bytes = Utilities.base64Decode(p.base64);
    const namaFile = p.fileName || ('slide_' + new Date().getTime() + '.jpg');
    const blob = Utilities.newBlob(bytes, mimeType, namaFile);
    const folder = getOrBuatFolderSlide();
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const url = 'https://lh3.googleusercontent.com/d/' + file.getId();
    return {ok:true, url: url};
  } catch (err) {
    return {ok:false, error: 'Gagal mengunggah gambar: ' + err};
  }
}

function getOrBuatFolderSlide() {
  const namaFolder = 'Slide Aplikasi Absensi Santri';
  const folders = DriveApp.getFoldersByName(namaFolder);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(namaFolder);
}

// ============ MODUL CATAT PELANGGARAN & PRESTASI SANTRI ============
// Data santri & guru TIDAK diduplikasi di sini -- selalu memakai data Santri/Guru dari
// spreadsheet Absensi yang sudah ada (aktif tahun ajaran), supaya tidak ada dua sumber
// data yang bisa beda. Yang disimpan terpisah cuma catatan pelanggaran/prestasi & poinnya.

function getMasterPelanggaranList(pelanggaranSSId) {
  const sh = getPelanggaranSSTarget(pelanggaranSSId).getSheetByName(SHEET_MASTER_PELANGGARAN);
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.map((r,i) => ({rowIndex:i+2, nama: norm(r[0]), poin: Number(r[1])||0})).filter(x => x.nama);
}
function getMasterPrestasiList(pelanggaranSSId) {
  const sh = getPelanggaranSSTarget(pelanggaranSSId).getSheetByName(SHEET_MASTER_PRESTASI);
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.map((r,i) => ({rowIndex:i+2, nama: norm(r[0]), poin: Number(r[1])||0})).filter(x => x.nama);
}
function apiSaveMasterPelPrestasi(p) {
  const sh = getPelanggaranAktifSS().getSheetByName(p.jenis === 'Prestasi' ? SHEET_MASTER_PRESTASI : SHEET_MASTER_PELANGGARAN);
  const nama = norm(p.nama); const poin = Number(p.poin) || 0;
  if (!nama) return {ok:false, error:'Nama wajib diisi'};
  if (p.rowIndex && Number(p.rowIndex) > 1) {
    sh.getRange(Number(p.rowIndex),1,1,2).setValues([[nama, poin]]);
  } else {
    sh.appendRow([nama, poin]);
  }
  return {ok:true};
}
function apiDeleteMasterPelPrestasi(p) {
  const sh = getPelanggaranAktifSS().getSheetByName(p.jenis === 'Prestasi' ? SHEET_MASTER_PRESTASI : SHEET_MASTER_PELANGGARAN);
  sh.deleteRow(Number(p.rowIndex));
  return {ok:true};
}

function getModalPoinSantri() {
  const v = getPengaturan().ModalPoinSantri;
  return v ? (Number(v)||25) : 25;
}

// Kirim WA otomatis lewat Fonnte (kalau token sudah diatur Admin). Selalu dicatat di
// sheet LogNotifikasi (berhasil maupun gagal) supaya bisa ditelusuri.
function kirimWALogPelanggaran(target, pesan, kategori) {
  let shLog = null;
  try { shLog = getPelanggaranAktifSS().getSheetByName(SHEET_LOG_NOTIF); } catch (e) {}
  const h = kirimWA_(target, pesan, kategori);
  if (h.dilewati) { if (shLog) shLog.appendRow([new Date(), target || '-', String(pesan || '').substring(0,200), 'Dilewati: dinonaktifkan Admin/Mudir']); return; }
  if (shLog) shLog.appendRow([new Date(), target || '-', String(pesan || '').substring(0,200),
    h.ok ? ('Berhasil (' + h.via + ')') : ('Gagal: ' + h.error)]);
}
function kirimWAFonnte(target, pesan) { kirimWALogPelanggaran(target, pesan); }
function kirimWALogKategori_(kategori, target, pesan) { kirimWALogPelanggaran(target, pesan, kategori); }

// Simpan pencatatan pelanggaran/prestasi + otomatis update poin bulan berjalan +
// kirim notifikasi WA (kalau ada pelanggaran, dan/atau kalau poin sampai habis).
function apiSavePencatatanPelanggaran(p) {
  const nisn = norm(p.nisn), namaSantri = norm(p.namaSantri);
  const pelanggaran = norm(p.pelanggaran), poinPelanggaran = Number(p.poinPelanggaran)||0;
  const prestasi = norm(p.prestasi), poinPrestasi = Number(p.poinPrestasi)||0;
  const namaPencatat = norm(p.namaPencatat);
  if (!nisn || !namaSantri) return {ok:false, error:'Santri wajib dipilih'};
  if (!pelanggaran && !prestasi) return {ok:false, error:'Harus mengisi minimal satu Pelanggaran atau Prestasi'};

  const ss = getPelanggaranAktifSS();
  const tanggal = p.tanggal || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  ss.getSheetByName(SHEET_PENCATATAN_PEL).appendRow([tanggal, nisn, namaSantri, pelanggaran||'-', poinPelanggaran, prestasi||'-', poinPrestasi, namaPencatat, new Date()]);

  // Cari data kelas santri (untuk baris PoinSantri) dari sheet Santri di spreadsheet aktif
  let kelasSantri = '';
  try {
    const santriRows = getAktifSS().getSheetByName(SHEET_SANTRI).getDataRange().getValues();
    for (let i=1;i<santriRows.length;i++) { if (norm(santriRows[i][0]) === nisn) { break; } }
  } catch(e) {}
  try {
    const rombelRows = getAktifSS().getSheetByName(SHEET_ROMBEL).getDataRange().getValues();
    for (let i=1;i<rombelRows.length;i++) { if (norm(rombelRows[i][0]) === nisn) { kelasSantri = norm(rombelRows[i][2]); break; } }
  } catch(e) {}

  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const bulan = now.getMonth()+1, tahun = now.getFullYear();
  const shPoin = ss.getSheetByName(SHEET_POIN_SANTRI);
  const poinRows = shPoin.getDataRange().getValues();
  let rowIdx = -1;
  for (let i=1;i<poinRows.length;i++) {
    if (norm(poinRows[i][0]) === nisn && Number(poinRows[i][4]) === bulan && Number(poinRows[i][5]) === tahun) { rowIdx = i+1; break; }
  }
  const modal = getModalPoinSantri();
  let poinLama = modal, statusLama = 'Aktif';
  if (rowIdx === -1) {
    shPoin.appendRow([nisn, namaSantri, kelasSantri, modal, bulan, tahun, 'Aktif']);
    rowIdx = shPoin.getLastRow();
  } else {
    poinLama = Number(poinRows[rowIdx-1][3]) || 0;
    statusLama = norm(poinRows[rowIdx-1][6]);
  }
  const net = poinPrestasi - poinPelanggaran;
  let poinBaru = Math.max(0, poinLama + net);
  const statusBaru = poinBaru <= 0 ? 'Habis' : 'Aktif';
  shPoin.getRange(rowIdx,4).setValue(poinBaru);
  shPoin.getRange(rowIdx,7).setValue(statusBaru);

  // Notifikasi WA ke orang tua (kalau ada pelanggaran & No WA Ortu tercatat)
  let noWaOrtu = '';
  try {
    const santriRows2 = getAktifSS().getSheetByName(SHEET_SANTRI).getDataRange().getValues();
    for (let i=1;i<santriRows2.length;i++) { if (norm(santriRows2[i][0]) === nisn) { noWaOrtu = norm(santriRows2[i][4]); break; } }
  } catch(e) {}

  if (pelanggaran && noWaOrtu) {
    const pesan = 'Assalamualaikum Wr. Wb.\n\nYth. Orang Tua/Wali dari *'+namaSantri+'*\n\nPada tanggal '+tanggal+', ananda tercatat melakukan pelanggaran:\n\n*'+pelanggaran+'* (-'+poinPelanggaran+' poin)\n\nSisa poin bulan ini: *'+poinBaru+' / '+modal+' poin*\nStatus: '+(statusBaru==='Habis'?'*HABIS*':'Aktif')+'\n\nDemikian info ini kami sampaikan sebagai bahan nasihat dan penguatan bagi ananda.\n\nWassalamualaikum Wr. Wb.\n_Notifikasi otomatis dari aplikasi pondok_';
    kirimWALogKategori_('pelanggaran', noWaOrtu, pesan);
  }
  // Push ke wali -- di luar syarat noWaOrtu karena push tidak butuh nomor telepon.
  if (pelanggaran) {
    try {
      kirimPushKeWali(nisn, '\u26A0\uFE0F Catatan Pelanggaran',
        namaSantri + ' tercatat: ' + pelanggaran + ' (-' + poinPelanggaran + ' poin) pada ' + tanggal + '. Sisa poin bulan ini: ' + poinBaru + '/' + modal + '.');
    } catch(e) { Logger.log('Notif wali pelanggaran gagal: ' + e.message); }
  }
  if (statusBaru === 'Habis' && statusLama !== 'Habis') {
    try {
      kirimPushKeWali(nisn, '\uD83D\uDD34 Poin Santri Habis',
        'Poin ' + namaSantri + ' telah habis (0 poin) bulan ini. Ananda akan mendapat pembinaan sesuai aturan pondok.');
    } catch(e) { Logger.log('Notif wali poin habis gagal: ' + e.message); }
    if (noWaOrtu) {
      kirimWALogKategori_('poin_habis', noWaOrtu, 'Assalamualaikum Wr. Wb.\n\n*NOTIFIKASI POIN HABIS*\n\nPoin santri *'+namaSantri+'* telah *HABIS* (0 poin) pada bulan ini.\n\nDengan demikian ananda akan mendapat pembinaan sesuai aturan pondok. Untuk koordinasi bisa menghubungi pengurus.\n\nWassalamualaikum Wr. Wb.');
    }
    const grup = getPengaturan().GrupPengajarWA;
    if (grup) kirimWALogKategori_('poin_habis_grup', grup, '*PERHATIAN - POIN HABIS*\n\nSantri: *'+namaSantri+'*\nKelas: '+kelasSantri+'\nSisa Poin: 0 / '+modal);
  }
  return {ok:true, poinTerbaru: poinBaru, status: statusBaru};
}

function getRekapPoinSantri(bulan, tahun, pelanggaranSSId) {
  const now = new Date();
  bulan = Number(bulan) || (now.getMonth()+1); tahun = Number(tahun) || now.getFullYear();
  const sh = getPelanggaranSSTarget(pelanggaranSSId).getSheetByName(SHEET_POIN_SANTRI);
  const rows = sh.getDataRange().getValues(); rows.shift();
  const modal = getModalPoinSantri();
  const data = rows.filter(r => Number(r[4])===bulan && Number(r[5])===tahun)
    .map(r => ({nisn:norm(r[0]), nama:norm(r[1]), kelas:norm(r[2]), poin:Number(r[3])||0, status:norm(r[6])}));
  return { bulan: bulan, tahun: tahun, modal: modal, data: data,
    totalAktif: data.filter(d=>d.status==='Aktif').length, totalHabis: data.filter(d=>d.status==='Habis').length };
}

// Riwayat pelanggaran/prestasi seorang santri. Bisa lintas spreadsheet Pelanggaran lama
// dengan menyebut pelanggaranSSId, atau kosongkan untuk pakai yang aktif sekarang.
function getRiwayatPelanggaranSantri(nisn, pelanggaranSSId) {
  nisn = norm(nisn);
  const sh = getPelanggaranSSTarget(pelanggaranSSId).getSheetByName(SHEET_PENCATATAN_PEL);
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  return rows.map((r,i) => {
    const d = (r[0] instanceof Date) ? r[0] : new Date(r[0]);
    return { rowIndex:i+2, tanggal: Utilities.formatDate(d,tz,'yyyy-MM-dd'), nisn:norm(r[1]), nama:norm(r[2]),
      pelanggaran:norm(r[3]), poinPelanggaran:Number(r[4])||0, prestasi:norm(r[5]), poinPrestasi:Number(r[6])||0, pencatat:norm(r[7]) };
  }).filter(x => x.nisn === nisn).sort((a,b) => b.tanggal.localeCompare(a.tanggal));
}

function apiResetPoinSatuSantri(p) {
  const nisn = norm(p.nisn);
  const now = new Date();
  const sh = getPelanggaranAktifSS().getSheetByName(SHEET_POIN_SANTRI);
  const rows = sh.getDataRange().getValues();
  const modal = getModalPoinSantri();
  for (let i=1;i<rows.length;i++) {
    if (norm(rows[i][0]) === nisn && Number(rows[i][4])===now.getMonth()+1 && Number(rows[i][5])===now.getFullYear()) {
      sh.getRange(i+1,4).setValue(modal); sh.getRange(i+1,7).setValue('Aktif');
      return {ok:true};
    }
  }
  return {ok:false, error:'Data poin santri ini untuk bulan sekarang tidak ditemukan'};
}
function apiResetSemuaPoinSantri() {
  const now = new Date();
  const sh = getPelanggaranAktifSS().getSheetByName(SHEET_POIN_SANTRI);
  const rows = sh.getDataRange().getValues();
  const modal = getModalPoinSantri();
  let count = 0;
  for (let i=1;i<rows.length;i++) {
    if (Number(rows[i][4])===now.getMonth()+1 && Number(rows[i][5])===now.getFullYear()) {
      sh.getRange(i+1,4).setValue(modal); sh.getRange(i+1,7).setValue('Aktif'); count++;
    }
  }
  return {ok:true, jumlah: count};
}

// ============ HEADER TIAP SHEET (dipakai saat membuat sheet baru kosong) ============
function headerAbsensi(){ return ['Tanggal','Hari','Jam Ke','Mapel','Kelas','Pengampu','NISN','Nama Santri','Status','Keterangan','Sikap1','Sikap2','Sikap3','Sikap4','Nilai Sikap','Waktu Input','TipeAbsen','WaktuHalaqoh']; }
function headerHafalan(){ return ['Tanggal','Waktu','Halaqoh','Pengampu','NISN','Nama Santri','Jenis Hafalan','Surah','Ayat','Juz','Halaman Ke','Nilai','Waktu Input']; }
function headerNilai(){ return ['Tanggal','Pengajar','Mapel','Kelas','NISN','Nama Santri','Jenis Nilai','Nilai','Waktu Input']; }
function headerRekapNilai(){ return ['NISN','Nama','Kelas','Mapel','Rata Tugas','Persen Kehadiran','Nilai UTS','Nilai UAS','Nilai Pengetahuan','Rata Sikap','Rata Keterampilan','Waktu Diperbarui']; }
function headerPenggantian(){ return ['Tanggal','Jenis Sesi','Mapel','Kelas','Jam Ke','Halaqoh','Waktu','Guru Asli','Guru Pengganti','Keterangan','Waktu Input']; }

function buatSheetTransaksiKosong(ss) {
  const shA = ss.insertSheet(SHEET_ABSENSI); shA.appendRow(headerAbsensi()); shA.setFrozenRows(1);
  const shH = ss.insertSheet(SHEET_HAFALAN); shH.appendRow(headerHafalan()); shH.setFrozenRows(1);
  const shN = ss.insertSheet(SHEET_NILAI);   shN.appendRow(headerNilai());   shN.setFrozenRows(1);
  const shR = ss.insertSheet(SHEET_REKAP_NILAI); shR.appendRow(headerRekapNilai()); shR.setFrozenRows(1);
  const shP = ss.insertSheet(SHEET_PENGGANTIAN); shP.appendRow(headerPenggantian()); shP.setFrozenRows(1);
  const shJ = ss.insertSheet(SHEET_JURNAL_MENGAJAR);
  shJ.appendRow(['Tanggal','Hari','Mapel','Kelas','Jam Ke','Pengampu','IDRPPPertemuan','MateriDisampaikan','Metode','Hambatan','TindakLanjut','CatatanTambahan','StatusJurnal','WaktuInput']);
  shJ.setFrozenRows(1);
}

// Sheet Kantin yang fresh tiap tahun ajaran (transaksi & pengajuan) -- dipanggil pada
// spreadsheet KANTIN sendiri (ssKantin), terpisah dari spreadsheet Absensi.
function buatSheetKantinKosong(ssKantin) {
  const shTK = ssKantin.insertSheet(SHEET_TRANSAKSI_KANTIN); shTK.appendRow(headerTransaksiKantin()); shTK.setFrozenRows(1);
  const shRP = ssKantin.insertSheet(SHEET_RIWAYAT_SALDO_PEMILIK); shRP.appendRow(['Tanggal','Waktu','Nama Pemilik','Jenis','Nominal','Saldo Sebelum','Saldo Sekarang','Keterangan','Status']); shRP.setFrozenRows(1);
  const shPT = ssKantin.insertSheet(SHEET_PENGAJUAN_TOPUP); shPT.appendRow(['Tanggal','Waktu','NISN','Nama Santri','Nominal','No WA Wali','Status','Waktu Diproses','Diproses Oleh']); shPT.setFrozenRows(1);
  const shPTr = ssKantin.insertSheet(SHEET_PENGAJUAN_TARIK); shPTr.appendRow(['Tanggal','Waktu','Nama Pemilik','No WA','Nominal','Status','Waktu Diproses','Diproses Oleh']); shPTr.setFrozenRows(1);
  const shPP = ssKantin.insertSheet(SHEET_PENDAPATAN_PONDOK);
  shPP.appendRow(['Tanggal','Waktu','Jenis','Keterangan','Nominal','NISN Santri','Nama Santri','Referensi']);
  shPP.setFrozenRows(1);
}

function headerTransaksiKantin(){ return ['Tanggal','Waktu','NISN','Nama Santri','Nominal','Kategori','Nama Barang','Jumlah','Potongan','Pemilik','Masuk Pemilik','Saldo Sebelum','Saldo Sekarang']; }

// ============ TAHUN AJARAN BARU = 4 SPREADSHEET SEKALIGUS (Absensi, Kantin, SPP,
// Pelanggaran) DALAM SATU FOLDER DRIVE -- data induk (Santri/Guru/Role) tetap cuma di
// Absensi, spreadsheet lain merujuk NISN balik ke situ, TIDAK ada data duplikat. ============
function buatSemuaSpreadsheetSemesterBaru(namaSemester) {
  const folder = DriveApp.createFolder(namaSemester);
  const ssLama = getAktifSS();

  // 1) ABSENSI -- data induk disalin, Absensi/Hafalan/Nilai/Jurnal SELALU kosong per semester
  const ssBaruAbsensi = SpreadsheetApp.create('ABSENSI - ' + namaSemester);
  SHEETS_DISALIN.forEach(function(namaSheet) {
    const shLama = ssLama.getSheetByName(namaSheet);
    if (!shLama) return;
    const shBaru = shLama.copyTo(ssBaruAbsensi);
    shBaru.setName(namaSheet);
  });
  ssBaruAbsensi.getSheets().forEach(function(sh){
    if (SHEETS_DISALIN.indexOf(sh.getName()) === -1) ssBaruAbsensi.deleteSheet(sh);
  });
  buatSheetTransaksiKosong(ssBaruAbsensi);

  // 2) KANTIN -- Barang & SaldoPemilik DISALIN, transaksi KOSONG
  let ssLamaKantin = null;
  try {
    const idKantinLama = PROP.getProperty(KANTIN_AKTIF_KEY);
    if (idKantinLama) ssLamaKantin = SpreadsheetApp.openById(idKantinLama);
  } catch(e) {}

  const ssBaruKantin = SpreadsheetApp.create('KANTIN - ' + namaSemester);
  if (ssLamaKantin) {
    KANTIN_SHEETS_DISALIN.forEach(function(namaSheet) {
      const shLama = ssLamaKantin.getSheetByName(namaSheet);
      if (!shLama) return;
      const shBaru = shLama.copyTo(ssBaruKantin);
      shBaru.setName(namaSheet);
    });
  } else {
    const shB = ssBaruKantin.getActiveSheet().setName(SHEET_BARANG);
    shB.appendRow(['Nama Barang','Harga','Potongan','Pemilik','No WA Pemilik']); shB.setFrozenRows(1);
    const shS = ssBaruKantin.insertSheet(SHEET_SALDO_PEMILIK);
    shS.appendRow(['Nama Pemilik','No WA','Saldo']); shS.setFrozenRows(1);
  }
  ssBaruKantin.getSheets().forEach(function(sh){
    if (KANTIN_SHEETS_DISALIN.indexOf(sh.getName()) === -1) ssBaruKantin.deleteSheet(sh);
  });
  buatSheetKantinKosong(ssBaruKantin);

  // 3) PELANGGARAN -- MasterPelanggaran disalin, catatan KOSONG
  const idPelanggaran = buatSpreadsheetPelanggaranBaru(namaSemester);

  // 4) SPP -- TIDAK DIBUAT ULANG, pakai SPP yang sudah ada lintas semester

  // Kelompokkan ke folder
  [ssBaruAbsensi.getId(), ssBaruKantin.getId(), idPelanggaran].forEach(function(id){
    try { DriveApp.getFileById(id).moveTo(folder); } catch(e) {}
  });

  return {
    idAbsensi: ssBaruAbsensi.getId(),
    idKantin: ssBaruKantin.getId(),
    idPelanggaran: idPelanggaran,
    idFolder: folder.getId()
  };
}

// Backward compatible alias
function buatSemuaSpreadsheetTahunAjaranBaru(nama) { return buatSemuaSpreadsheetSemesterBaru(nama); }

// ============ MANAJEMEN SPREADSHEET PELANGGARAN (terpisah dari spreadsheet Absensi) ============
// Prinsip sama seperti Tahun Ajaran: admin bisa buat spreadsheet Pelanggaran baru kapan
// saja (misal karena data sudah terlalu besar atau mau reset), tapi spreadsheet LAMA
// tetap bisa diakses untuk lihat riwayat -- tidak pernah hilang.
const SHEET_MASTER_PELANGGARAN = 'MasterPelanggaran';
const SHEET_MASTER_PRESTASI    = 'MasterPrestasi';
const SHEET_PENCATATAN_PEL     = 'Pencatatan';
const SHEET_POIN_SANTRI        = 'PoinSantri';
const SHEET_LOG_NOTIF          = 'LogNotifikasi';

function getPelanggaranSSList() {
  const sh = getMasterSS().getSheetByName(SHEET_PELANGGARAN_SS);
  const data = sh.getDataRange().getValues(); data.shift();
  return data.map(r => ({nama:r[0], id:r[1], aktif:r[2], tanggal:r[3]}));
}

function daftarkanPelanggaranSS(nama, id, aktif) {
  const sh = getMasterSS().getSheetByName(SHEET_PELANGGARAN_SS);
  if (aktif) {
    const rows = sh.getDataRange().getValues();
    for (let i=1;i<rows.length;i++) sh.getRange(i+1,3).setValue(false);
  }
  sh.appendRow([nama, id, !!aktif, new Date()]);
}

// Membuat spreadsheet Pelanggaran baru. Daftar jenis Pelanggaran & Prestasi (master)
// ikut disalin dari spreadsheet aktif SEKARANG (kalau ada) supaya admin tidak perlu
// input ulang -- tapi Pencatatan & PoinSantri SELALU mulai kosong (data baru).
function buatSpreadsheetPelanggaranBaru(nama) {
  const ssBaru = SpreadsheetApp.create('PELANGGARAN - ' + nama);
  let ssLama = null;
  try { ssLama = getPelanggaranAktifSS(); } catch (e) { ssLama = null; }

  const shPel = ssBaru.insertSheet(SHEET_MASTER_PELANGGARAN);
  shPel.appendRow(['Nama Pelanggaran','Poin']);
  shPel.setFrozenRows(1);
  const shPres = ssBaru.insertSheet(SHEET_MASTER_PRESTASI);
  shPres.appendRow(['Nama Prestasi','Poin']);
  shPres.setFrozenRows(1);

  if (ssLama) {
    const dataPelLama = ssLama.getSheetByName(SHEET_MASTER_PELANGGARAN);
    if (dataPelLama && dataPelLama.getLastRow() > 1) {
      const rows = dataPelLama.getRange(2,1,dataPelLama.getLastRow()-1,2).getValues();
      if (rows.length) shPel.getRange(2,1,rows.length,2).setValues(rows);
    }
    const dataPresLama = ssLama.getSheetByName(SHEET_MASTER_PRESTASI);
    if (dataPresLama && dataPresLama.getLastRow() > 1) {
      const rows2 = dataPresLama.getRange(2,1,dataPresLama.getLastRow()-1,2).getValues();
      if (rows2.length) shPres.getRange(2,1,rows2.length,2).setValues(rows2);
    }
  } else {
    // spreadsheet Pelanggaran pertama kali -- isi contoh awal supaya tidak kosong total
    shPel.getRange(2,1,10,2).setValues([
      ['Terlambat shalat berjamaah',2],['Tidak hadir shalat berjamaah',5],['Membawa HP ke kamar',10],
      ['Keluar pondok tanpa izin',8],['Berkelahi',15],['Berkata kasar',3],['Tidak mengerjakan tugas/hafalan',2],
      ['Membolos pelajaran',10],['Merusak fasilitas pondok',12],['Tidak memakai seragam lengkap',1]
    ]);
    shPres.getRange(2,1,6,2).setValues([
      ['Hafalan Juz 30',5],['Juara kelas',10],['Juara lomba tahfidz',15],
      ['Menjadi imam shalat berjamaah',2],['Aktif kegiatan kebersihan',2],['Membantu teman kesulitan',1]
    ]);
  }

  const shCatat = ssBaru.insertSheet(SHEET_PENCATATAN_PEL);
  shCatat.appendRow(['Tanggal','NISN','Nama Santri','Pelanggaran','Poin Pelanggaran','Prestasi','Poin Prestasi','Nama Pencatat','Waktu Input']);
  shCatat.setFrozenRows(1);
  const shPoin = ssBaru.insertSheet(SHEET_POIN_SANTRI);
  shPoin.appendRow(['NISN','Nama Santri','Kelas','Poin','Bulan','Tahun','Status']);
  shPoin.setFrozenRows(1);
  const shLog = ssBaru.insertSheet(SHEET_LOG_NOTIF);
  shLog.appendRow(['Timestamp','Target','Pesan','Status']);
  shLog.setFrozenRows(1);

  ssBaru.getSheets().forEach(function(sh){
    const nm = sh.getName();
    if ([SHEET_MASTER_PELANGGARAN, SHEET_MASTER_PRESTASI, SHEET_PENCATATAN_PEL, SHEET_POIN_SANTRI, SHEET_LOG_NOTIF].indexOf(nm) === -1) {
      ssBaru.deleteSheet(sh);
    }
  });
  return ssBaru.getId();
}

function apiBuatPelanggaranSSBaru(nama) {
  nama = norm(nama);
  if (!nama) return {ok:false, error:'Nama wajib diisi'};
  const list = getPelanggaranSSList();
  if (list.some(t => norm(t.nama) === nama)) return {ok:false, error:'Nama ini sudah dipakai'};
  const id = buatSpreadsheetPelanggaranBaru(nama);
  daftarkanPelanggaranSS(nama, id, false);
  return {ok:true, id: id};
}

function apiSetPelanggaranSSAktif(id) {
  const sh = getMasterSS().getSheetByName(SHEET_PELANGGARAN_SS);
  if (!sh) return {ok:false, error:'Sheet tidak ditemukan. Coba jalankan Migrasi Skema di Admin.'};

  const rows = sh.getDataRange().getValues();
  let found = false;
  for (let i=1;i<rows.length;i++) {
    const match = rows[i][1] === id;
    sh.getRange(i+1,3).setValue(match);
    if (match) found = true;
  }
  if (!found) return {ok:false, error:'Spreadsheet Pelanggaran tidak ditemukan'};
  PROP.setProperty(PELANGGARAN_AKTIF_KEY, id);
  return {ok:true};
}

function getPelanggaranAktifSS() {
  const id = PROP.getProperty(PELANGGARAN_AKTIF_KEY);
  if (!id) throw new Error('Belum ada spreadsheet Pelanggaran aktif. Hubungi Admin.');
  return bukaSS_(id);
}

// pelanggaranSSId opsional: kalau diisi, baca dari spreadsheet Pelanggaran TERTENTU
// (misal untuk lihat riwayat lama). Kalau kosong, pakai yang aktif sekarang.
function getPelanggaranSSTarget(pelanggaranSSId) {
  if (pelanggaranSSId) return SpreadsheetApp.openById(pelanggaranSSId);
  return getPelanggaranAktifSS();
}

// ============ TAHUN AJARAN PERTAMA (hanya dipakai setupAwal) - berisi data dummy ============
function buatSpreadsheetPertamaDenganDummy(namaTahunAjaran) {
  const ss = SpreadsheetApp.create('ABSENSI - ' + namaTahunAjaran);

  const shSantri = ss.getActiveSheet().setName(SHEET_SANTRI);
  shSantri.appendRow(['NISN','Nama','Tahun Masuk','Jenis Kelamin','No WA Ortu','Saldo Kantin','Limit Harian Kantin','PIN Transaksi']);
  shSantri.setFrozenRows(1);
  const dummySantri = [
    ['0011223301','Ahmad Fauzan',2023,'Laki-laki','6281234500001'],
    ['0011223302','Muhammad Rizky',2023,'Laki-laki','6281234500002'],
    ['0011223303','Siti Aminah',2023,'Perempuan','6281234500003'],
    ['0011223304','Nur Hidayah',2024,'Perempuan','6281234500004'],
    ['0011223305','Abdul Rahman',2024,'Laki-laki','6281234500005'],
    ['0011223306','Fatimah Azzahra',2022,'Perempuan','6281234500006'],
  ];
  shSantri.getRange(2,1,dummySantri.length,5).setValues(dummySantri);

  const shGuru = ss.insertSheet(SHEET_GURU);
  shGuru.appendRow(['Nama','No WA']);
  shGuru.setFrozenRows(1);
  const dummyGuru = [ ['Ust. Hamzah','6281298760001'], ['Ustzh. Khadijah','6281298760002'], ['Ust. Umar','6281298760003'] ];
  shGuru.getRange(2,1,dummyGuru.length,2).setValues(dummyGuru);

  const shDaftarKelas = ss.insertSheet(SHEET_DAFTAR_KELAS);
  shDaftarKelas.appendRow(['Kelas','Wali Kelas']);
  shDaftarKelas.setFrozenRows(1);
  const dummyKelas = [ ['Kelas 7','Ust. Hamzah'], ['Kelas 8','Ustzh. Khadijah'], ['Kelas 9','Ust. Umar'] ];
  shDaftarKelas.getRange(2,1,dummyKelas.length,2).setValues(dummyKelas);

  const shMapel = ss.insertSheet(SHEET_MAPEL);
  shMapel.appendRow(['Nama Mapel','Kelas','Pengampu','Hari','Jam Ke']);
  shMapel.setFrozenRows(1);
  const dummyMapel = [
    ['Fiqih','Kelas 7','Ustzh. Khadijah','Senin',1],
    ['Bahasa Arab','Kelas 7','Ust. Umar','Selasa',1],
    ['Aqidah','Kelas 8','Ustzh. Khadijah','Rabu',2],
    ['Fiqih','Kelas 9','Ust. Umar','Kamis',1],
  ];
  shMapel.getRange(2,1,dummyMapel.length,5).setValues(dummyMapel);

  const shRombel = ss.insertSheet(SHEET_ROMBEL);
  shRombel.appendRow(['NISN','Nama Santri','Kelas']);
  shRombel.setFrozenRows(1);
  const dummyRombel = [
    ['0011223301','Ahmad Fauzan','Kelas 7'],
    ['0011223302','Muhammad Rizky','Kelas 7'],
    ['0011223303','Siti Aminah','Kelas 7'],
    ['0011223304','Nur Hidayah','Kelas 8'],
    ['0011223305','Abdul Rahman','Kelas 8'],
    ['0011223306','Fatimah Azzahra','Kelas 9'],
  ];
  shRombel.getRange(2,1,dummyRombel.length,3).setValues(dummyRombel);

  const shHalaqoh = ss.insertSheet(SHEET_HALAQOH);
  shHalaqoh.appendRow(['Nama Halaqoh','Pengampu','Waktu','Gender']);
  shHalaqoh.setFrozenRows(1);
  const dummyHalaqoh = [
    ['Tahfidz A','Ust. Hamzah','Subuh','Laki-laki'],
    ['Tahfidz B','Ustzh. Khadijah','Maghrib','Perempuan'],
  ];
  shHalaqoh.getRange(2,1,dummyHalaqoh.length,4).setValues(dummyHalaqoh);

  const shHalaqohAnggota = ss.insertSheet(SHEET_HALAQOH_ANGGOTA);
  shHalaqohAnggota.appendRow(['NISN','Nama Santri','Halaqoh']);
  shHalaqohAnggota.setFrozenRows(1);
  const dummyHalaqohAnggota = [
    ['0011223301','Ahmad Fauzan','Tahfidz A'],
    ['0011223302','Muhammad Rizky','Tahfidz A'],
    ['0011223305','Abdul Rahman','Tahfidz A'],
    ['0011223303','Siti Aminah','Tahfidz B'],
    ['0011223304','Nur Hidayah','Tahfidz B'],
    ['0011223306','Fatimah Azzahra','Tahfidz B'],
  ];
  shHalaqohAnggota.getRange(2,1,dummyHalaqohAnggota.length,3).setValues(dummyHalaqohAnggota);

  const shRole = ss.insertSheet(SHEET_ROLE);
  shRole.appendRow(['Nama','No WA','PIN','Level','NISN Anak']);
  shRole.setFrozenRows(1);
  const dummyRole = [
    ['Ust. Hamzah','6281298760001','1111','Guru',''],
    ['Ustzh. Khadijah','6281298760002','2222','Guru',''],
    ['Ust. Umar','6281298760003','3333','Guru',''],
    ['Admin Pesantren','6281200000001','0000','Admin',''],
    ['Mudir','6281200000002','9999','Mudir',''],
    ['Wali Ahmad Fauzan','6281234500001','1234','WaliSantri','0011223301'],
    ['Wali Nur Hidayah','6281234500004','5678','WaliSantri','0011223304'],
  ];
  shRole.getRange(2,1,dummyRole.length,5).setValues(dummyRole);

  const shJam = ss.insertSheet(SHEET_JAM_PELAJARAN);
  shJam.appendRow(['Jenis','Nama','Jumlah Jam']);
  shJam.setFrozenRows(1);
  const dummyJam = [
    ['Halaqoh','Subuh',3],
    ['Halaqoh','Duha',4],
    ['Halaqoh','Maghrib',2],
    ['Mapel','Fiqih',2],
    ['Mapel','Bahasa Arab',2],
    ['Mapel','Aqidah',2],
  ];
  shJam.getRange(2,1,dummyJam.length,3).setValues(dummyJam);

  buatSheetTransaksiKosong(ss);
  isiDummyAbsensi(ss);
  isiDummyHafalan(ss);
  return ss.getId();
}

function isiDummyAbsensi(ss) {
  const shAbsensi = ss.getSheetByName(SHEET_ABSENSI);
  const rombelRows = ss.getSheetByName(SHEET_ROMBEL).getDataRange().getValues(); rombelRows.shift();
  const mapelRows  = ss.getSheetByName(SHEET_MAPEL).getDataRange().getValues(); mapelRows.shift();
  const rows = [];
  const today = new Date();
  for (let d = 6; d >= 0; d--) {
    const tgl = new Date(today); tgl.setDate(today.getDate() - d);
    const namaHari = HARI_LIST[tgl.getDay()];
    mapelRows.forEach(m => {
      const [mapel, kelas, pengampu, hari, jamKe] = m;
      if (hari !== namaHari) return;
      rombelRows.filter(r => r[0] && String(r[2]) === String(kelas)).forEach(s => {
        const [nisn, nama] = s;
        const rnd = Math.random();
        const status = rnd > 0.9 ? 'Alpa' : (rnd > 0.8 ? 'Izin' : (rnd > 0.72 ? 'Sakit' : 'Hadir'));
        const s1=4,s2=4,s3= rnd>0.85?3:4, s4=4;
        const nilaiSikap = Math.round(((s1+s2+s3+s4)*100/16)*100)/100;
        rows.push([tgl, namaHari, jamKe, mapel, kelas, pengampu, nisn, nama, status, '', s1,s2,s3,s4,nilaiSikap, new Date()]);
      });
    });
  }
  if (rows.length) shAbsensi.getRange(shAbsensi.getLastRow()+1,1,rows.length,16).setValues(rows);
}

function isiDummyHafalan(ss) {
  const shHafalan = ss.getSheetByName(SHEET_HAFALAN);
  const anggotaRows = ss.getSheetByName(SHEET_HALAQOH_ANGGOTA).getDataRange().getValues(); anggotaRows.shift();
  const halaqohRows = ss.getSheetByName(SHEET_HALAQOH).getDataRange().getValues(); halaqohRows.shift();
  const rows = [];
  const today = new Date();
  const contohSurah = ['An-Naba','An-Naziat','Abasa','At-Takwir'];
  for (let d = 4; d >= 0; d--) {
    const tgl = new Date(today); tgl.setDate(today.getDate() - d);
    halaqohRows.forEach(h => {
      const [namaHalaqoh, pengampu, waktu] = h;
      anggotaRows.filter(a => a[0] && a[2] === namaHalaqoh).forEach((a, idx) => {
        const [nisn, nama] = a;
        const halamanKe = 3 + d + idx;
        const ayatMulai = (idx*5) + 1;
        const ayatRange = ayatMulai + ' - ' + (ayatMulai + 4);
        const nilaiDummy = 80 + (idx*5 % 20);
        rows.push([tgl, waktu, namaHalaqoh, pengampu, nisn, nama, 'Sabaq', contohSurah[idx % contohSurah.length], ayatRange, 30, Math.min(halamanKe,22), nilaiDummy, new Date()]);
      });
    });
  }
  if (rows.length) shHafalan.getRange(shHafalan.getLastRow()+1,1,rows.length,13).setValues(rows);
}

// ============ LOGIN ============
// Token masuk otomatis ke Persuratan. Tidak pernah menggagalkan login WASIAT.
function tokenSuratWasiat_(nama) {
  try { return (typeof SURAT_ !== 'undefined' && nama) ? SURAT_.tokenUntukNama(nama) : ''; } catch (e) { return ''; }
}

function apiLogin(loginId, pin) {
  loginId = norm(loginId); pin = norm(pin);
  if (!loginId || !pin) return {ok:false, error:'Nama/No WA dan PIN wajib diisi'};
  // Cegah tebak-tebakan PIN: 5 kali salah -> tunggu 10 menit
  if (typeof AMAN_ !== 'undefined' && AMAN_.cekGagalLogin(loginId)) return {ok:false, error:'Terlalu banyak percobaan PIN salah. Silakan coba lagi 10 menit lagi.'};
  const sh = getAktifSS().getSheetByName(SHEET_ROLE);
  const rows = sh.getDataRange().getValues(); rows.shift();
  const found = rows.find(r => (norm(r[0]) === loginId || norm(r[1]) === loginId) && norm(r[2]) === pin);
  if (typeof AMAN_ !== 'undefined') AMAN_.catatGagalLogin(loginId, !!found);
  if (!found) return {ok:false, error:'Nama/No WA atau PIN salah'};

  const roles = norm(found[3]).split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  if (!roles.length) return {ok:false, error:'Akun ini belum diatur role aksesnya. Hubungi Admin.'};

  // Ambil data WaliKelas dari sheet Guru (kolom ke-5, index 4 atau 5)
  let waliKelas = '';
  try {
    const shGuru = getAktifSS().getSheetByName(SHEET_GURU);
    if (shGuru) {
      const guruRows = shGuru.getDataRange().getValues();
      const guruHeader = guruRows[0];
      const iWaliKelas = guruHeader.indexOf('WaliKelas');
      if (iWaliKelas > -1) {
        const guruRow = guruRows.slice(1).find(r => normNama(norm(r[0])) === normNama(norm(found[0])));
        if (guruRow) waliKelas = norm(guruRow[iWaliKelas]);
      }
    }
  } catch(e) {}

  // NISN Anak boleh berisi lebih dari satu NISN dipisah koma (mendukung 1 akun wali
  // untuk >1 anak). nisnAnak (tunggal, string mentah) tetap dipertahankan apa adanya
  // supaya bagian kode lama yang mungkin masih membacanya langsung tidak berubah
  // perilakunya. nisnAnakList adalah pecahannya sebagai array, dipakai fitur ganti anak.
  const nisnAnakList = norm(found[4]).split(',').map(function(s){ return s.trim(); }).filter(Boolean);

  return {ok:true, user: {
    nama: norm(found[0]), noWa: norm(found[1]),
    roles: roles, level: roles[0],
    nisnAnak: norm(found[4]),
    nisnAnakList: nisnAnakList,
    waliKelas: waliKelas,  // kelas yang ditangani sebagai Wali Kelas
    tokenSurat: tokenSuratWasiat_(norm(found[0]))  // masuk otomatis ke aplikasi Persuratan (/surat/)
  }};
}

// Isi kolom "Jam Ke" di jadwal bisa berupa satu angka (1), atau beberapa jam dalam satu
// sel ("1,2", "1 & 2", "1-3", "1 dan 2"). Dipecah jadi daftar angka supaya tiap jam
// pelajaran tersimpan & terhitung sendiri-sendiri. Isi yang tidak berisi angka
// dikembalikan apa adanya (perilaku lama).
function pecahJamKe_(v) {
  if (v === '' || v === null || v === undefined) return [];
  if (typeof v === 'number') return isNaN(v) ? [] : [v];
  const t = String(v).trim();
  if (/^\d+$/.test(t)) return [Number(t)];
  const rentang = t.match(/^(\d+)\s*(?:-|s\.?d\.?|sampai|–)\s*(\d+)$/i);
  if (rentang) {
    const a = Number(rentang[1]), b = Number(rentang[2]);
    if (b >= a && b - a < 12) { const h = []; for (let i = a; i <= b; i++) h.push(i); return h; }
  }
  const angka = t.match(/\d+/g);
  if (angka && angka.length) {
    const h = [];
    angka.map(Number).forEach(function(n){ if (h.indexOf(n) === -1) h.push(n); });
    return h;
  }
  return [v];
}

// ============ JADWAL GURU HARI INI (akademik) ============
function getJadwalGuruHariIni(pengampu) {
  pengampu = norm(pengampu);
  const tz = Session.getScriptTimeZone();
  const hariIniTanggal = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const namaHariIni = HARI_LIST[new Date().getDay()];
  const sh = getAktifSS().getSheetByName(SHEET_MAPEL);
  const rows = sh.getDataRange().getValues(); rows.shift();

  const penggantianHariIni = getDaftarPenggantian().filter(function(x){
    return x.tanggal === hariIniTanggal && x.jenisSesi === 'Mapel';
  });
  // Kunci dinormalkan (huruf besar/kecil, titik, spasi) supaya penulisan nama yang
  // sedikit berbeda -- mis. "Ust Ahmad" vs "Ust. Ahmad" -- tetap dikenali sebagai
  // guru yang sama. Sebelumnya dicocokkan apa adanya, sehingga jadwal yang sudah
  // digantikan kadang masih muncul di dashboard guru aslinya.
  const kunciGanti = function(mapel, kelas, jamKe, guru){
    return normNama(mapel)+'|'+normNama(kelas)+'|'+String(Number(jamKe))+'|'+normNamaGuru_(guru);
  };
  const sudahDigantikan = {};
  penggantianHariIni.forEach(function(x){
    sudahDigantikan[kunciGanti(x.mapel, x.kelas, x.jamKe, x.guruAsli)] = true;
  });

  // Ambil SEMUA jadwal guru ini (semua hari, termasuk yang tidak ada harinya)
  const semuaJadwal = rows
    .filter(r => normNama(norm(r[2])) === normNama(pengampu))
    .filter(function(r){
      // Khusus hari ini: filter yang sudah digantikan
      if (normNama(norm(r[3])) === normNama(namaHariIni)) {
        return !sudahDigantikan[kunciGanti(r[0], r[1], r[4], pengampu)];
      }
      return true;
    })
    .reduce(function(hasil, r){
      // Satu baris jadwal bisa memuat beberapa jam ("1,2") -- dipecah per jam
      const daftarJam = pecahJamKe_(r[4]);
      (daftarJam.length ? daftarJam : [r[4]]).forEach(function(jk){
        hasil.push({
          mapel:norm(r[0]), kelas:norm(r[1]), pengampu:norm(r[2]),
          hari:norm(r[3]), jamKe:jk, pengganti:false,
          hariIni: normNama(norm(r[3])) === normNama(namaHariIni),
          tanpaHari: !norm(r[3]) // jadwal yang belum diisi harinya
        });
      });
      return hasil;
    }, []);

  // Jadwal penggantian hari ini (guru ini menggantikan guru lain)
  const jadwalPengganti = penggantianHariIni
    .filter(function(x){ return samaGuru_(x.guruPengganti, pengampu); })
    .map(function(x){
      return {mapel:x.mapel, kelas:x.kelas, pengampu:pengampu,
        hari:namaHariIni, jamKe:x.jamKe, pengganti:true,
        guruAsli:x.guruAsli, hariIni:true, tanpaHari:false};
    });

  const semua = semuaJadwal.concat(jadwalPengganti);
  return kelompokkanJadwalPerSesiLengkap(semua, namaHariIni);
}

function kelompokkanJadwalPerSesiLengkap(daftar, namaHariIni) {
  const kelompok = {};
  const urutanKey = [];
  daftar.forEach(function(item){
    // Kunci dinormalkan: "Fiqih" dan "fiqih " di dua baris jadwal tetap jadi SATU kartu,
    // supaya guru cukup sekali mengisi absen untuk semua jam ke- mapel itu.
    const key = normNama(item.mapel) + '|' + normNama(item.kelas) + '|' + normNama(item.hari) + '|' +
      (item.pengganti ? ('P|'+normNamaGuru_(item.guruAsli||'')) : 'A');
    if (!kelompok[key]) {
      kelompok[key] = {
        mapel: item.mapel, kelas: item.kelas, pengampu: item.pengampu,
        hari: item.hari, pengganti: item.pengganti, guruAsli: item.guruAsli||'',
        jamKeList: [], hariIni: item.hariIni, tanpaHari: item.tanpaHari
      };
      urutanKey.push(key);
    }
    const jl = kelompok[key].jamKeList;
    if (!jl.some(function(x){ return String(x) === String(item.jamKe); })) jl.push(item.jamKe);
    // Kalau salah satu jamKe-nya hari ini, tandai sebagai hari ini
    if (item.hariIni) kelompok[key].hariIni = true;
  });
  urutanKey.forEach(function(k){
    kelompok[k].jamKeList.sort(function(a,b){
      const na = Number(a), nb = Number(b);
      return (isNaN(na) || isNaN(nb)) ? String(a).localeCompare(String(b)) : na - nb;
    });
  });
  const result = urutanKey.map(k => kelompok[k]);
  // Urutkan: hari ini dulu, lalu per hari (Senin-Ahad)
  const urutanHari = ['Senin','Selasa','Rabu','Kamis',"Jum'at",'Jumat','Sabtu','Ahad','Minggu',''];
  result.sort(function(a,b){
    if (a.hariIni && !b.hariIni) return -1;
    if (!a.hariIni && b.hariIni) return 1;
    const ia = urutanHari.indexOf(a.hari), ib = urutanHari.indexOf(b.hari);
    return ia - ib;
  });
  return result;
}

// Gabungkan baris jadwal yang mapel+kelasnya sama (misal guru masuk jam ke-1 dan
// jam ke-2 dengan mapel yang sama) jadi SATU kartu jadwal dengan daftar jam ke
// (jamKeList) -- supaya guru cukup isi absen SEKALI untuk semua jam itu, tapi tetap
// tersimpan sebagai baris terpisah per jam ke di sheet Absensi (lihat apiSubmitAbsensi)
// supaya hitungan jam mengajar untuk penggajian tetap akurat, persis seperti kalau
// diisi satu-satu.
function kelompokkanJadwalPerSesi(daftar) {
  const kelompok = {};
  const urutanKey = [];
  daftar.forEach(function(item){
    const key = item.mapel + '|' + item.kelas + '|' + (item.pengganti ? ('P|' + item.guruAsli) : 'A');
    if (!kelompok[key]) {
      kelompok[key] = { mapel: item.mapel, kelas: item.kelas, pengampu: item.pengampu, hari: item.hari,
        pengganti: item.pengganti, guruAsli: item.guruAsli || '', jamKeList: [] };
      urutanKey.push(key);
    }
    kelompok[key].jamKeList.push(item.jamKe);
  });
  return urutanKey.map(function(key){
    kelompok[key].jamKeList.sort(function(a,b){ return a-b; });
    return kelompok[key];
  }).sort(function(a,b){ return a.jamKeList[0] - b.jamKeList[0]; });
}

// "Santri Saya": daftar semua santri yang diajar guru ini, digabung dari kelas akademik
// yang ia ampu (sheet MataPelajaran+Rombel) dan halaqoh tahfidz yang ia ampu (sheet
// Halaqoh+HalaqohAnggota). Satu santri bisa muncul dengan beberapa kelas/halaqoh.
function getSantriDiajarGuru(pengampu) {
  pengampu = norm(pengampu);
  const ss = getAktifSS();
  const mapelRows = ss.getSheetByName(SHEET_MAPEL).getDataRange().getValues(); mapelRows.shift();
  const kelasGuru = {};
  mapelRows.forEach(r => { if (norm(r[2]) === pengampu) kelasGuru[norm(r[1])] = true; });

  const halaqohRows = ss.getSheetByName(SHEET_HALAQOH).getDataRange().getValues(); halaqohRows.shift();
  const halaqohGuru = {};
  halaqohRows.forEach(r => { if (pengampuCocok(daftarPengampu(r[1]), pengampu)) halaqohGuru[norm(r[0])] = true; });

  const rombelRows = ss.getSheetByName(SHEET_ROMBEL).getDataRange().getValues(); rombelRows.shift();
  const halaqohAnggotaRows = ss.getSheetByName(SHEET_HALAQOH_ANGGOTA).getDataRange().getValues(); halaqohAnggotaRows.shift();

  const santriMap = {};
  rombelRows.forEach(r => {
    if (!r[0]) return;
    const kelas = norm(r[2]);
    if (!kelasGuru[kelas]) return;
    const nisn = norm(r[0]);
    if (!santriMap[nisn]) santriMap[nisn] = {nisn:nisn, nama:norm(r[1]), kelas:[], halaqoh:[]};
    if (santriMap[nisn].kelas.indexOf(kelas) === -1) santriMap[nisn].kelas.push(kelas);
  });
  halaqohAnggotaRows.forEach(r => {
    if (!r[0]) return;
    const halaqoh = norm(r[2]);
    if (!halaqohGuru[halaqoh]) return;
    const nisn = norm(r[0]);
    if (!santriMap[nisn]) santriMap[nisn] = {nisn:nisn, nama:norm(r[1]), kelas:[], halaqoh:[]};
    if (santriMap[nisn].halaqoh.indexOf(halaqoh) === -1) santriMap[nisn].halaqoh.push(halaqoh);
  });
  return Object.keys(santriMap).map(k => santriMap[k]).sort((a,b) => a.nama.localeCompare(b.nama));
}

function apiGetSantriUntukAbsen(kelas) {
  kelas = norm(kelas);
  if (!kelas) return {ok:false, error:'Kelas tidak valid'};
  const ss = getAktifSS();
  const shRombel = ss.getSheetByName(SHEET_ROMBEL);
  const shSantri = ss.getSheetByName(SHEET_SANTRI);
  if (!shRombel) return {ok:false, error:'Sheet Rombel belum ada. Jalankan Migrasi Skema di menu Admin.'};
  if (!shSantri) return {ok:false, error:'Sheet Santri belum ada. Jalankan Migrasi Skema di menu Admin.'};
  const rombelRows = shRombel.getDataRange().getValues(); rombelRows.shift();
  const santriRows = shSantri.getDataRange().getValues(); santriRows.shift();
  const mapSantri = {}; santriRows.forEach(r => mapSantri[norm(r[0])] = r);
  const daftar = rombelRows.filter(r => r[0] && norm(r[2]) === kelas).map(r => {
    const s = mapSantri[norm(r[0])];
    return { nisn: norm(r[0]), nama: norm(r[1]) || (s? norm(s[1]) : ''), noWaOrtu: s ? norm(s[4]) : '' };
  });
  if (!daftar.length) return {ok:true, data: [], peringatan: 'Belum ada santri terdaftar di rombel "'+kelas+'". Minta Admin/Mudir menambahkan santri lewat menu Kelola Rombel.'};
  return {ok:true, data: daftar};
}

// ============ JADWAL SANTRI (wali santri) - kelas 100% dari Rombel ============
function getJadwalSantri(nisn) {
  nisn = norm(nisn);
  const ss = getAktifSS();
  const santriRows = ss.getSheetByName(SHEET_SANTRI).getDataRange().getValues(); santriRows.shift();
  const santri = santriRows.find(r => norm(r[0]) === nisn);
  if (!santri) return {error:'Santri tidak ditemukan'};

  const rombelRows = ss.getSheetByName(SHEET_ROMBEL).getDataRange().getValues(); rombelRows.shift();
  const keanggotaan = rombelRows.find(r => norm(r[0]) === nisn);
  const kelasAktif = keanggotaan ? norm(keanggotaan[2]) : '';

  let jadwal = [];
  if (kelasAktif) {
    const mapelRows = ss.getSheetByName(SHEET_MAPEL).getDataRange().getValues(); mapelRows.shift();
    jadwal = mapelRows.filter(r => norm(r[1]) === kelasAktif)
      .sort((a,b)=> HARI_LIST.indexOf(a[3])-HARI_LIST.indexOf(b[3]) || a[4]-b[4])
      .map(r => ({mapel:norm(r[0]), pengampu:norm(r[2]), hari:norm(r[3]), jamKe:r[4]}));
  }
  const halaqohRows = ss.getSheetByName(SHEET_HALAQOH_ANGGOTA).getDataRange().getValues(); halaqohRows.shift();
  const anggotaHalaqoh = halaqohRows.find(r => norm(r[0]) === nisn);

  return { nama: norm(santri[1]), kelas: kelasAktif || '(belum masuk rombel)', jadwal: jadwal,
    belumMasukRombel: !keanggotaan, halaqoh: anggotaHalaqoh ? norm(anggotaHalaqoh[2]) : '' };
}

// ============ SUBMIT / EDIT / HAPUS ABSENSI (dengan nilai sikap) ============
function hitungNilaiSikap(s1,s2,s3,s4){
  s1=Number(s1)||0; s2=Number(s2)||0; s3=Number(s3)||0; s4=Number(s4)||0;
  return Math.round(((s1+s2+s3+s4)*100/16)*100)/100;
}

// Tolak pencatatan untuk tanggal yang BELUM terjadi. Dipakai absensi mapel, absensi
// halaqoh, dan setoran hafalan -- ketiganya dihitung sebagai jam mengajar guru, jadi
// mengisi jadwal yang harinya belum tiba sama dengan mengklaim jam yang belum diajar.
// Diperiksa di SERVER (bukan hanya di aplikasi) supaya tidak bisa diakali dengan
// mengubah jam HP atau memanggil API langsung.
// Tanggal yang sudah lewat tetap diterima: itu jalur sah untuk absen susulan dan untuk
// data yang dikirim belakangan dari mode offline.
function tolakTanggalMasaDepan(tanggal) {
  const hariIni = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const t = String(tanggal || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return 'Format tanggal tidak valid.';
  if (t > hariIni) return 'Tanggal ' + t + ' belum terjadi. Absensi/setoran hanya bisa dicatat untuk hari ini atau hari yang sudah lewat.';
  return '';
}

// ======================================================================
// PENJAGA SESI MENGAJAR (mapel & halaqoh)
// Tujuannya satu: satu sesi = satu pencatat, supaya jam mengajar tidak terhitung
// ganda dan data santri tidak tertimpa dua versi.
// ======================================================================

// Pembanding nama guru yang mengabaikan tanda baca & spasi ("Ust. Ahmad" = "Ust Ahmad").
// Sengaja dipisah dari normNama() umum -- normNama dipakai di banyak pencocokan lain
// (nama santri, halaqoh, mapel), jadi tidak diubah supaya perilaku lama tetap sama.
function normNamaGuru_(s) { return normNama(s).replace(/[^a-z0-9]/g, ''); }
function samaGuru_(a, b) { const x = normNamaGuru_(a); return !!x && x === normNamaGuru_(b); }

// Apakah hak mengisi sesi ini sudah dialihkan ke guru pengganti?
// Dipakai di sisi SERVER, jadi tetap berlaku walau sesi dibuka lewat jalur lain
// (mis. absen susulan yang membuka jadwal hari lain).
// Mengembalikan nama guru pengganti bila tertutup untuk pemanggil, atau '' bila boleh.
function sesiDialihkanKePengganti_(opsi) {
  try {
    const pengampu = normNamaGuru_(opsi.pengampu || '');
    if (!pengampu) return '';
    const jamList = (opsi.jamKeList || []).map(function(x){ return String(Number(x)); });
    const cocok = getDaftarPenggantian().find(function(x){
      if (x.tanggal !== opsi.tanggal) return false;
      if (normNamaGuru_(x.guruAsli) !== pengampu) return false;          // hanya menutup untuk guru aslinya
      if (normNamaGuru_(x.guruPengganti) === pengampu) return false;     // dia sendiri penggantinya
      if (opsi.jenis === 'Halaqoh') {
        return x.jenisSesi === 'Halaqoh' && normNama(x.halaqoh) === normNama(opsi.halaqoh)
          && (!opsi.waktu || !x.waktu || normNama(x.waktu) === normNama(opsi.waktu));
      }
      if (x.jenisSesi === 'Halaqoh') return false;
      if (normNama(x.mapel) !== normNama(opsi.mapel) || normNama(x.kelas) !== normNama(opsi.kelas)) return false;
      // Bila penggantian dicatat untuk jam ke- tertentu, cukup ada satu jam yang beririsan
      if (!jamList.length || x.jamKe === '' || x.jamKe === null || x.jamKe === undefined) return true;
      return jamList.indexOf(String(Number(x.jamKe))) !== -1;
    });
    return cocok ? cocok.guruPengganti : '';
  } catch (e) { return ''; } // gagal membaca data penggantian tidak boleh memblokir pencatatan
}

// Siapa yang sudah tercatat mengisi sesi absensi mapel ini (kalau ada).
function pemilikSesiAbsensi_(existing, tanggal, mapel, kelas, daftarJamKe) {
  const tz = Session.getScriptTimeZone();
  const jamList = (daftarJamKe || []).map(function(x){ return String(Number(x)); });
  for (let i = 1; i < existing.length; i++) {
    const r = existing[i];
    const tgl = (r[0] instanceof Date) ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : norm(r[0]);
    if (tgl !== tanggal) continue;
    if (normNama(norm(r[3])) !== normNama(mapel) || normNama(norm(r[4])) !== normNama(kelas)) continue;
    if (jamList.length && jamList.indexOf(String(Number(r[2]))) === -1) continue;
    if (norm(r[5])) return norm(r[5]);
  }
  return '';
}

// ======================================================================
// CATATAN GANDA: YANG DIPAKAI ADALAH DATA TERBARU
//
// Satu santri hanya punya SATU catatan per sesi:
//   - Absensi mapel  : tanggal + jam ke- + mapel + santri
//   - Absensi halaqoh: tanggal + halaqoh + waktu (Subuh/Maghrib/...) + santri
//   - Hafalan        : tanggal + waktu + halaqoh + santri
//   - Absen harian   : tanggal + sesi + santri
// Bila sesi yang sama terisi dua kali (dobel kirim, sinyal putus lalu dikirim ulang,
// dua HP, salah ketik spasi di nama mapel, dll), semua rekap/riwayat/laporan hanya
// memakai catatan yang PALING BARU (dilihat dari kolom Waktu Input; bila kolom itu
// kosong, baris yang letaknya paling bawah). Baris lama TIDAK dihapus dari sheet --
// hanya tidak ikut dihitung -- jadi tidak ada data yang hilang.
// ======================================================================
const KOLOM_WAKTU_INPUT_CATATAN_ = { 'Absensi': 15, 'Hafalan': 12, 'AbsensiHarian': 8 };

// Hasil format tanggal disimpan sementara: ribuan baris di hari yang sama memakai nilai
// tanggal yang sama, jadi cukup diformat sekali (Utilities.formatDate relatif lambat).
const _memoTgl_ = {}, _memoJam_ = {};
function tglKunciCatatan_(v, tz) {
  if (v instanceof Date) {
    const t = v.getTime();
    if (isNaN(t)) return '';
    const k = t + '|' + tz;
    return _memoTgl_[k] || (_memoTgl_[k] = Utilities.formatDate(v, tz, 'yyyy-MM-dd'));
  }
  const m = norm(v).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? (m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2)) : '';
}
function waktuKunciCatatan_(v, tz) {
  if (v instanceof Date) {
    const t = v.getTime();
    if (isNaN(t)) return '';
    const k = t + '|' + tz;
    return _memoJam_[k] || (_memoJam_[k] = Utilities.formatDate(v, tz, 'HH:mm'));
  }
  return normNama(norm(v));
}
// Baca hanya baris pada TANGGAL tertentu, tanpa membaca seluruh sheet.
// Kolom tanggal (kolom A) dibaca dulu -- satu kolom jauh lebih ringan daripada 13-18
// kolom -- lalu hanya blok baris yang tanggalnya cocok yang dibaca lengkap.
// Hasilnya berbentuk SAMA dengan getDataRange().getValues() (indeks i = baris i+1),
// baris lain diisi larik kosong, sehingga kode yang memakainya tidak perlu diubah.
const BARIS_KOSONG_ = Object.freeze([]);
function bacaBarisPadaTanggal_(sh, tanggal) {
  const n = sh.getLastRow(), k = Math.max(sh.getLastColumn(), 1);
  if (n < 2) return sh.getRange(1, 1, 1, k).getValues();
  const tz = Session.getScriptTimeZone();
  const kolA = sh.getRange(1, 1, n, 1).getValues();
  const hasil = new Array(n);
  hasil[0] = sh.getRange(1, 1, 1, k).getValues()[0];
  for (let i = 1; i < n; i++) hasil[i] = BARIS_KOSONG_;
  let i = 1;
  while (i < n) {
    if (tglKunciCatatan_(kolA[i][0], tz) !== tanggal) { i++; continue; }
    let j = i;
    while (j + 1 < n && tglKunciCatatan_(kolA[j + 1][0], tz) === tanggal) j++;
    const blok = sh.getRange(i + 1, 1, j - i + 1, k).getValues();
    for (let b = 0; b < blok.length; b++) hasil[i + b] = blok[b];
    i = j + 1;
  }
  return hasil;
}

function msWaktuInput_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? 0 : v.getTime();
  if (v === '' || v === null || v === undefined) return 0;
  const d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// Kunci sesi satu baris. '' = baris tidak dikenali (dibiarkan apa adanya, tidak pernah dibuang).
function kunciCatatan_(jenis, r, tz) {
  if (!r) return '';
  const tgl = tglKunciCatatan_(r[0], tz);
  if (!tgl) return '';
  if (jenis === SHEET_ABSENSI) {
    const nisn = norm(r[6]); if (!nisn) return '';
    if (norm(r[16]) === 'Halaqoh') {
      return ['H', tgl, normNama(norm(r[3])), waktuKunciCatatan_(r[17], tz), nisn].join('|');
    }
    return ['M', tgl, String(Number(r[2])), normNama(norm(r[3])), nisn].join('|');
  }
  if (jenis === SHEET_HAFALAN) {
    const nisn = norm(r[4]); if (!nisn) return '';
    return [tgl, waktuKunciCatatan_(r[1], tz), normNama(norm(r[2])), nisn].join('|');
  }
  if (jenis === SHEET_ABSENSI_HARIAN) {
    const nisn = norm(r[2]); if (!nisn) return '';
    return [tgl, normNama(norm(r[1])), nisn].join('|');
  }
  return '';
}

// Apakah baris b (letaknya di bawah a) lebih baru daripada a?
function lebihBaruCatatan_(jenis, a, b) {
  const k = KOLOM_WAKTU_INPUT_CATATAN_[jenis];
  const ma = msWaktuInput_(a[k]), mb = msWaktuInput_(b[k]);
  if (ma && mb) return mb >= ma;   // dua-duanya punya waktu input: bandingkan waktunya
  return true;                     // salah satu kosong: yang letaknya lebih bawah dianggap terbaru
}

// values = hasil getValues() LENGKAP dengan baris judul. Mengembalikan array baru tanpa
// catatan lama yang tergantikan. Setiap baris diberi properti _baris (nomor baris asli
// di sheet) supaya fitur Edit/Hapus tetap menunjuk ke baris yang benar.
function buangCatatanGandaLama_(values, jenis) {
  if (!values || values.length < 2 || KOLOM_WAKTU_INPUT_CATATAN_[jenis] === undefined) return values;
  const tz = Session.getScriptTimeZone();
  const kunci = new Array(values.length);
  const pemenang = {};
  let adaGanda = false;
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    try { r._baris = i + 1; } catch (e) {}
    const k = kunciCatatan_(jenis, r, tz);
    kunci[i] = k;
    if (!k) continue;
    if (pemenang[k] === undefined) { pemenang[k] = i; continue; }
    adaGanda = true;
    if (lebihBaruCatatan_(jenis, values[pemenang[k]], r)) pemenang[k] = i;
  }
  if (!adaGanda) return values;
  return values.filter(function(r, i){ return i === 0 || !kunci[i] || pemenang[kunci[i]] === i; });
}

// Pengganti sh.getDataRange().getValues() untuk PEMBACA (rekap, riwayat, laporan).
// Bila terjadi kesalahan apa pun, kembali ke data mentah -- perilaku lama tetap terjaga.
function nilaiCatatanUnik_(sh) {
  const v = sh.getDataRange().getValues();
  try { return buangCatatanGandaLama_(v, sh.getName()); } catch (e) { return v; }
}

// Semua baris (nomor baris sheet) yang satu sesi dengan baris nomor `baris`.
function barisSesiSama_(values, jenis, baris) {
  const tz = Session.getScriptTimeZone();
  const k = kunciCatatan_(jenis, values[baris - 1], tz);
  if (!k) return [baris];
  const hasil = [];
  for (let i = 1; i < values.length; i++) if (kunciCatatan_(jenis, values[i], tz) === k) hasil.push(i + 1);
  return hasil.length ? hasil : [baris];
}

// Kunci tulis bersama untuk semua pencatatan absensi/hafalan, supaya dua kiriman yang
// tiba bersamaan tidak sama-sama mengira sesinya masih kosong lalu sama-sama menambah baris.
function denganKunciCatatan_(fn) {
  // Kunci TERPISAH dari kunci transaksi keuangan (aplikasi berjalan sebagai pemilik
  // skrip, jadi kunci ini berlaku untuk semua pengguna), supaya simpan absensi/hafalan
  // yang banyak barisnya tidak membuat tambah saldo/kasir kantin menunggu.
  let lock;
  try { lock = LockService.getUserLock(); } catch (e) { lock = LockService.getScriptLock(); }
  try { lock.waitLock(25000); }
  catch (e) { return {ok:false, error:'Server sedang sibuk menyimpan data lain. Silakan simpan ulang sebentar lagi.'}; }
  try { return fn(); }
  finally { try { lock.releaseLock(); } catch (e) {} }
}

function apiSubmitAbsensi(p) {
  if (!p || !p.items || !p.items.length) return {ok:false, error:'Tidak ada data santri untuk disimpan'};
  const hasil = denganKunciCatatan_(function(){ return simpanAbsensiMapel_(p); });
  if (!hasil || !hasil.ok) return hasil;
  const tanggal = hasil._tanggal; delete hasil._tanggal;
  refreshRekapNilaiAman();

  // Kirim WA otomatis ke ortu untuk santri yang Alpa/Sakit/Izin
  try {
    kirimNotifAbsensiKeOrtu(p.items, tanggal, p.mapel, p.kelas, p.pengampu);
  } catch(e) { Logger.log('Notif WA absensi gagal: ' + e.message); }

  return hasil;
}

function rapikanDaftarJamKe_(p) {
  const mentah = (p.jamKeList && p.jamKeList.length) ? p.jamKeList : [p.jamKe];
  const hasil = [];
  mentah.forEach(function(v){
    const pecah = pecahJamKe_(v);
    (pecah.length ? pecah : [v]).forEach(function(x){
      if (!hasil.some(function(y){ return String(y) === String(x); })) hasil.push(x);
    });
  });
  return hasil;
}

// Tambahkan jam ke- yang BERSAMBUNG dengan jam yang dikirim, bila di jadwal (sheet
// MataPelajaran) guru ini memang mengajar mapel+kelas yang sama di jam itu pada hari itu.
// Pengaman: jam yang sudah dialihkan ke guru pengganti, atau sudah diisi guru lain,
// TIDAK ikut ditambahkan (tidak pernah membuat simpanan ditolak gara-gara perluasan ini).
// Bila apa pun gagal dibaca, daftar jam yang dikirim dipakai apa adanya.
function lengkapiJamBerurutan_(p, tanggal, daftarJamKe, existing) {
  try {
    const angka = daftarJamKe.map(Number).filter(function(n){ return !isNaN(n); });
    if (!angka.length || !norm(p.mapel) || !norm(p.kelas)) return daftarJamKe;
    const q = tanggal.split('-').map(Number);
    const nh = normNama(HARI_LIST[new Date(q[0], q[1]-1, q[2]).getDay()]);
    const shM = getAktifSS().getSheetByName(SHEET_MAPEL);
    if (!shM || shM.getLastRow() < 2) return daftarJamKe;
    const jamJadwal = [];
    shM.getDataRange().getValues().slice(1).forEach(function(r){
      if (normNama(norm(r[0])) !== normNama(norm(p.mapel)) || normNama(norm(r[1])) !== normNama(norm(p.kelas))) return;
      if (normNama(norm(r[3])) !== nh || !samaGuru_(r[2], p.pengampu)) return;
      pecahJamKe_(r[4]).forEach(function(jk){ const n = Number(jk); if (!isNaN(n) && jamJadwal.indexOf(n) === -1) jamJadwal.push(n); });
    });
    // Hanya diperluas bila jam yang dikirim memang bagian dari jadwal guru ini hari itu
    if (!jamJadwal.length || !angka.some(function(n){ return jamJadwal.indexOf(n) !== -1; })) return daftarJamKe;
    const terpilih = angka.slice();
    let bertambah = true;
    while (bertambah) {
      bertambah = false;
      jamJadwal.forEach(function(n){
        if (terpilih.indexOf(n) !== -1) return;
        if (terpilih.indexOf(n - 1) === -1 && terpilih.indexOf(n + 1) === -1) return; // tidak bersambung
        if (sesiDialihkanKePengganti_({tanggal: tanggal, jenis: 'Mapel', mapel: p.mapel, kelas: p.kelas, jamKeList: [n], pengampu: p.pengampu})) return;
        const pemilik = pemilikSesiAbsensi_(existing, tanggal, p.mapel, p.kelas, [n]);
        if (pemilik && !samaGuru_(pemilik, p.pengampu)) return;
        terpilih.push(n); bertambah = true;
      });
    }
    if (terpilih.length === angka.length) return daftarJamKe;
    const tambahan = terpilih.filter(function(n){ return angka.indexOf(n) === -1; });
    return daftarJamKe.concat(tambahan).sort(function(a,b){
      const na = Number(a), nb = Number(b);
      return (isNaN(na) || isNaN(nb)) ? 0 : na - nb;
    });
  } catch (e) { return daftarJamKe; }
}

function simpanAbsensiMapel_(p) {
  const sh = getAktifSS().getSheetByName(SHEET_ABSENSI);
  if (!sh) return {ok:false, error:'Sheet Absensi tidak ditemukan. Jalankan Migrasi Skema di menu Admin.'};
  const tanggal = p.tanggal || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const _galatTgl = tolakTanggalMasaDepan(tanggal);
  if (_galatTgl) return {ok:false, error:_galatTgl};
  const existing = bacaBarisPadaTanggal_(sh, tanggal);
  // Jam ke- yang dikirim dirapikan (mis. "1,2" dipecah), lalu dilengkapi otomatis dengan
  // jam ke- BERURUTAN berikutnya/sebelumnya untuk mapel+kelas yang sama di jadwal guru
  // ini pada hari itu -- jadi cukup sekali isi absen untuk jam ke-1 & 2.
  const daftarJamKe = lengkapiJamBerurutan_(p, tanggal, rapikanDaftarJamKe_(p), existing);

  // (1) Sesi yang sudah dialihkan ke guru pengganti tidak bisa diisi guru aslinya.
  const penggantiSesi = sesiDialihkanKePengganti_({tanggal: tanggal, jenis: 'Mapel',
    mapel: p.mapel, kelas: p.kelas, jamKeList: daftarJamKe, pengampu: p.pengampu});
  if (penggantiSesi) {
    return {ok:false, error:'Sesi ' + norm(p.mapel) + ' - ' + norm(p.kelas) + ' pada ' + tanggal +
      ' sudah dialihkan ke guru pengganti (' + penggantiSesi + '), jadi tidak bisa Anda isi. ' +
      'Bila penggantian ini keliru, minta Admin membatalkannya di menu Penggantian Guru.'};
  }
  // (2) Satu sesi hanya boleh diisi satu guru -- mencegah jam mengajar terhitung ganda
  // dan data santri tertimpa dua versi. Guru yang sama boleh menyimpan ulang sesinya.
  const pemilikSesi = pemilikSesiAbsensi_(existing, tanggal, p.mapel, p.kelas, daftarJamKe);
  if (pemilikSesi && !samaGuru_(pemilikSesi, p.pengampu)) {
    return {ok:false, error:'Sesi ' + norm(p.mapel) + ' - ' + norm(p.kelas) + ' pada ' + tanggal +
      ' sudah diisi oleh ' + pemilikSesi + '. Tidak bisa diisi ulang oleh guru lain (mencegah data ganda). ' +
      'Bila ada kesalahan pencatatan, minta ' + pemilikSesi + ' membetulkannya lewat menu Riwayat Absen, atau hubungi Admin.'};
  }

  // Baris yang sudah ada untuk sesi ini. Satu kunci bisa menunjuk BEBERAPA baris bila
  // dulu sempat tercatat ganda -- semuanya ikut diperbarui supaya isinya seragam terbaru.
  // Pencocokan tanggal & mapel dibuat longgar (format tanggal/spasi/huruf besar) supaya
  // simpan ulang tidak menambah baris baru hanya karena beda penulisan.
  const tzA = Session.getScriptTimeZone();
  const jamDiminta = daftarJamKe.map(function(x){ return String(Number(x)); });
  const indexBaris = {};
  for (let i=1;i<existing.length;i++) {
    const r = existing[i];
    if (tglKunciCatatan_(r[0], tzA) !== tanggal) continue;
    if (normNama(norm(r[3])) !== normNama(norm(p.mapel))) continue;
    if (norm(r[16]) === 'Halaqoh' && norm(p.tipeAbsen) !== 'Halaqoh') continue;
    const jk = String(Number(r[2]));
    if (jamDiminta.indexOf(jk) === -1) continue;
    const k = jk + '|' + norm(r[6]);
    (indexBaris[k] = indexBaris[k] || []).push(i+1);
  }

  const rowsToAdd = [];
  let diupdate = 0;
  daftarJamKe.forEach(function(jamKe){
    (p.items || []).forEach(it => {
      // Kalau santri TIDAK HADIR (Sakit/Izin/Izin Pulang/Alpa) atau sikap eksplisit kosong,
      // nilai sikap dikosongkan supaya tidak masuk perhitungan rata sikap rapor.
      // Kalau HADIR dan sikap tidak dikirim, default 4 (asumsi baik).
      const isHadir = norm(it.status) === 'Hadir';
      const sikapKosong = (v) => v === '' || v === null || v === undefined;
      let s1, s2, s3, s4, nilaiSikap;
      if (!isHadir || (sikapKosong(it.sikap1) && sikapKosong(it.sikap2) && sikapKosong(it.sikap3) && sikapKosong(it.sikap4))) {
        s1 = ''; s2 = ''; s3 = ''; s4 = ''; nilaiSikap = '';
      } else {
        s1 = sikapKosong(it.sikap1) ? 4 : it.sikap1;
        s2 = sikapKosong(it.sikap2) ? 4 : it.sikap2;
        s3 = sikapKosong(it.sikap3) ? 4 : it.sikap3;
        s4 = sikapKosong(it.sikap4) ? 4 : it.sikap4;
        nilaiSikap = hitungNilaiSikap(s1,s2,s3,s4);
      }
      const daftarBaris = indexBaris[String(Number(jamKe))+'|'+norm(it.nisn)];
      if (daftarBaris && daftarBaris.length) {
        const kini = new Date();
        daftarBaris.forEach(function(rowIdx){
          sh.getRange(rowIdx,9,1,8).setValues([[it.status, it.keterangan||'', s1,s2,s3,s4, nilaiSikap, kini]]);
        });
        diupdate++;
      } else {
        rowsToAdd.push([tanggal, p.hari, jamKe, p.mapel, p.kelas, p.pengampu, it.nisn, it.nama, it.status, it.keterangan||'', s1,s2,s3,s4, nilaiSikap, new Date(), p.tipeAbsen||'Akademik', p.waktuHalaqoh||'']);
      }
    });
  });
  if (rowsToAdd.length) sh.getRange(sh.getLastRow()+1,1,rowsToAdd.length,18).setValues(rowsToAdd);
  return {ok:true, ditambah: rowsToAdd.length, diupdate: diupdate, jamKeList: daftarJamKe, _tanggal: tanggal};
}

// Kirim WA ke ortu santri yang tidak hadir (Alpa, Sakit, Izin)
// ============ ABSENSI HALAQOH (Role Pembina) ============

// Submit absensi halaqoh Maghrib -- disimpan di sheet Absensi dengan TipeAbsen='Halaqoh'
function apiSubmitAbsensiHalaqoh(p) {
  if (!p || !p.items || !p.items.length) return {ok:false, error:'Tidak ada data santri'};
  const hasil = denganKunciCatatan_(function(){ return simpanAbsensiHalaqoh_(p); });
  if (!hasil || !hasil.ok) return hasil;
  const tanggal = hasil._tanggal, waktuHalaqoh = hasil._waktu; delete hasil._tanggal; delete hasil._waktu;
  // Kirim WA notif ke ortu santri yang tidak hadir
  try { kirimNotifAbsensiKeOrtu(p.items, tanggal, norm(p.namaHalaqoh)+' ('+waktuHalaqoh+')', p.gender, norm(p.pengampu)); } catch(e){}
  return hasil;
}

function simpanAbsensiHalaqoh_(p) {
  const sh = getAktifSS().getSheetByName(SHEET_ABSENSI);
  const tz = Session.getScriptTimeZone();
  const tanggal = p.tanggal || Utilities.formatDate(new Date(),tz,'yyyy-MM-dd');
  const _galatTgl = tolakTanggalMasaDepan(tanggal);
  if (_galatTgl) return {ok:false, error:_galatTgl};
  const waktuHalaqoh = norm(p.waktuHalaqoh)||'Maghrib';
  const namaHalaqoh = norm(p.namaHalaqoh);
  const pengampu = norm(p.pengampu);

  // Cek sudah ada data hari ini untuk halaqoh ini
  const existing = bacaBarisPadaTanggal_(sh, tanggal);
  // Satu santri bisa punya beberapa baris bila dulu sempat tercatat ganda: semuanya
  // diperbarui, dan waktu inputnya ikut diperbarui supaya rekap memakai isian terbaru.
  const indexBaris = {};
  for (let i=1;i<existing.length;i++) {
    const r = existing[i];
    if (tglKunciCatatan_(r[0], tz) === tanggal &&
        normNama(norm(r[3]))===normNama(namaHalaqoh) && norm(r[16])==='Halaqoh' &&
        waktuKunciCatatan_(r[17], tz)===waktuKunciCatatan_(waktuHalaqoh, tz)) {
      const k = norm(r[6]);
      (indexBaris[k] = indexBaris[k] || []).push(i+1);
    }
  }

  const rowsToAdd = [];
  let diupdate = 0;
  p.items.forEach(function(it) {
    const daftarBaris = indexBaris[norm(it.nisn)];
    if (daftarBaris && daftarBaris.length) {
      const kini = new Date();
      daftarBaris.forEach(function(rowIdx){
        sh.getRange(rowIdx,9,1,2).setValues([[it.status, it.keterangan||'']]);
        sh.getRange(rowIdx,16).setValue(kini);
      });
      diupdate++;
    } else {
      // TipeAbsen=Halaqoh, WaktuHalaqoh=Maghrib, JamKe=0 (bukan jam pelajaran reguler)
      rowsToAdd.push([tanggal, p.hari||'', 0, namaHalaqoh, p.gender||'',
        pengampu, it.nisn, it.nama, it.status, it.keterangan||'',
        4,4,4,4, 100, new Date(), 'Halaqoh', waktuHalaqoh]);
    }
  });
  if (rowsToAdd.length) sh.getRange(sh.getLastRow()+1,1,rowsToAdd.length,18).setValues(rowsToAdd);
  return {ok:true, ditambah:rowsToAdd.length, diupdate:diupdate, _tanggal:tanggal, _waktu:waktuHalaqoh};
}

// Ambil semua santri di halaqoh berdasarkan gender untuk absen Pembina
function getSantriHalaqohByGender(namaHalaqoh, gender) {
  namaHalaqoh = norm(namaHalaqoh); gender = norm(gender);
  const ss = getAktifSS();
  const shAnggota = ss.getSheetByName(SHEET_HALAQOH_ANGGOTA);
  const anggotaRows = shAnggota.getDataRange().getValues(); anggotaRows.shift();
  const anggotaHalaqoh = anggotaRows.filter(r => norm(r[2])===namaHalaqoh).map(r => norm(r[0]));

  const shSantri = ss.getSheetByName(SHEET_SANTRI);
  const santriRows = shSantri.getDataRange().getValues(); santriRows.shift();

  return santriRows.filter(r => {
    if (!anggotaHalaqoh.includes(norm(r[0]))) return false;
    if (gender === 'Putra') return norm(r[3]) === 'Laki-laki';
    if (gender === 'Putri') return norm(r[3]) === 'Perempuan';
    return true;
  }).map(r => ({nisn:norm(r[0]), nama:norm(r[1]), jenisKelamin:norm(r[3])}));
}

// Rekap kehadiran halaqoh per santri -- untuk dashboard Pembina, Admin, Mudir, dan rapor
function getRekapAbsensiHalaqoh(namaHalaqoh, waktuHalaqoh, tglMulai, tglAkhir, gender) {
  namaHalaqoh = norm(namaHalaqoh); waktuHalaqoh = norm(waktuHalaqoh)||'Maghrib';
  const sh = getAktifSS().getSheetByName(SHEET_ABSENSI);
  const rows = nilaiCatatanUnik_(sh); rows.shift();
  const tz = Session.getScriptTimeZone();

  const filtered = rows.filter(r => {
    if (norm(r[16]) !== 'Halaqoh') return false;
    if (norm(r[3]) !== namaHalaqoh) return false;
    if (waktuHalaqoh && norm(r[17]) !== waktuHalaqoh) return false;
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
    if (tglMulai && tgl < tglMulai) return false;
    if (tglAkhir && tgl > tglAkhir) return false;
    return true;
  });

  // Daftar tanggal unik (untuk menghitung total sesi)
  const tanggalSet = new Set();
  filtered.forEach(r => {
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
    tanggalSet.add(tgl);
  });
  const totalSesi = tanggalSet.size;
  const daftarTanggal = Array.from(tanggalSet).sort();

  // Kelompokkan per santri
  const perSantri = {};
  filtered.forEach(r => {
    const nisn = norm(r[6]), nama = norm(r[7]), status = norm(r[8]);
    if (!perSantri[nisn]) perSantri[nisn] = {nisn, nama, hadir:0, sakit:0, izin:0, alpa:0, total:0};
    perSantri[nisn].total++;
    if (status==='Hadir') perSantri[nisn].hadir++;
    else if (status==='Sakit') perSantri[nisn].sakit++;
    else if (status==='Izin' || status==='Izin Pulang') perSantri[nisn].izin++;
    else if (status==='Alpa') perSantri[nisn].alpa++;
  });

  // Filter gender kalau diminta
  let result = Object.values(perSantri);
  if (gender) {
    const shSantri = getAktifSS().getSheetByName(SHEET_SANTRI);
    const santriRows = nilaiCatatanUnik_(shSantri); santriRows.shift();
    const mapGender = {};
    santriRows.forEach(r => { mapGender[norm(r[0])] = norm(r[3]); });
    result = result.filter(s => {
      const jk = mapGender[s.nisn]||'';
      if (gender==='Putra') return jk==='Laki-laki';
      if (gender==='Putri') return jk==='Perempuan';
      return true;
    });
  }

  return {
    totalSesi, daftarTanggal, namaHalaqoh, waktuHalaqoh,
    santri: result.map(s => ({
      ...s,
      persenHadir: totalSesi > 0 ? Math.round(s.hadir/totalSesi*100) : 0
    })).sort((a,b) => b.persenHadir - a.persenHadir)
  };
}

// Rekap semua halaqoh (untuk Admin/Mudir)
function getRekapSemuaHalaqoh(waktuHalaqoh, tglMulai, tglAkhir) {
  waktuHalaqoh = norm(waktuHalaqoh)||'Maghrib';
  const halaqohList = getHalaqohList();
  return halaqohList.map(h => {
    const rekap = getRekapAbsensiHalaqoh(h.namaHalaqoh, waktuHalaqoh, tglMulai, tglAkhir, '');
    const rata = rekap.santri.length > 0
      ? Math.round(rekap.santri.reduce((s,x)=>s+x.persenHadir,0)/rekap.santri.length)
      : 0;
    return {namaHalaqoh:h.namaHalaqoh, pengampu:h.pengampu, gender:h.gender,
      totalSesi:rekap.totalSesi, jumlahSantri:rekap.santri.length, rataHadir:rata};
  }).filter(h => h.totalSesi > 0);
}

// Data untuk rapor -- kehadiran halaqoh per santri per periode
function getDataRaporHalaqoh(nisn, tglMulai, tglAkhir) {
  nisn = norm(nisn);
  const sh = getAktifSS().getSheetByName(SHEET_ABSENSI);
  const rows = nilaiCatatanUnik_(sh); rows.shift();
  const tz = Session.getScriptTimeZone();

  const filtered = rows.filter(r => {
    if (norm(r[16]) !== 'Halaqoh') return false;
    if (norm(r[6]) !== nisn) return false;
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
    if (tglMulai && tgl < tglMulai) return false;
    if (tglAkhir && tgl > tglAkhir) return false;
    return true;
  });

  const perHalaqoh = {};
  filtered.forEach(r => {
    const halaqoh = norm(r[3]), status = norm(r[8]);
    if (!perHalaqoh[halaqoh]) perHalaqoh[halaqoh] = {halaqoh, hadir:0, total:0};
    perHalaqoh[halaqoh].total++;
    if (status==='Hadir') perHalaqoh[halaqoh].hadir++;
  });

  return Object.values(perHalaqoh).map(h => ({
    ...h, persenHadir: h.total>0?Math.round(h.hadir/h.total*100):0
  }));
}

function kirimNotifAbsensiKeOrtu(items, tanggal, mapel, kelas, pengampu) {
  const pengaturan = getPengaturan();
  if (!waTerkonfigurasi_()) return; // WhatsApp belum diatur, skip
  const namaPesantren = pengaturan.NamaPesantren || 'Pondok Pesantren';

  // Ambil No WA ortu dari sheet Santri
  const shSantri = getAktifSS().getSheetByName(SHEET_SANTRI);
  const rows = shSantri.getDataRange().getValues(); rows.shift();
  const mapNoWa = {};
  rows.forEach(r => { if (norm(r[0])) mapNoWa[norm(r[0])] = norm(r[4]); }); // NISN -> NoWA

  items.forEach(function(it) {
    if (it.status === 'Hadir') return; // Hanya kirim kalau tidak hadir
    const noWa = mapNoWa[norm(it.nisn)];
    if (!noWa) return;

    const statusLabel = it.status === 'Alpa' ? '⚠️ TIDAK HADIR (Alpa)' :
                        it.status === 'Sakit' ? '🤒 SAKIT' : '📋 IZIN';
    const pesan =
      'Assalamualaikum Wr. Wb.\n\n' +
      'Yth. Orang Tua/Wali Santri *' + it.nama + '*\n\n' +
      'Kami informasikan bahwa ananda tercatat:\n\n' +
      '*Status: ' + statusLabel + '*\n' +
      'Mata Pelajaran: ' + mapel + '\n' +
      'Kelas: ' + kelas + '\n' +
      'Tanggal: ' + tanggal + '\n' +
      (it.keterangan ? 'Keterangan: ' + it.keterangan + '\n' : '') +
      'Pengampu: ' + pengampu + '\n\n' +
      'Mohon perhatiannya. Jika ada pertanyaan silakan hubungi pihak pesantren.\n\n' +
      'Jazakumullah khairan.\n' + namaPesantren;

    kirimWAKategori_('absen_mapel', noWa, pesan);
    Utilities.sleep(200); // Jeda antar pengiriman agar tidak rate-limit
  });
}



// Dipakai fitur "lihat riwayat tahun ajaran lain" (read-only) -- TIDAK PERNAH mengubah
// tahun ajaran aktif untuk input data baru. p.tahunAjaranId opsional; kalau kosong,
// tetap pakai tahun ajaran aktif seperti biasa.
function getSSTarget(tahunAjaranId) {
  return tahunAjaranId ? bukaSS_(tahunAjaranId) : getAktifSS();
}

// Ambil semua halaqoh yang diampu seorang guru (lintas waktu Subuh/Ashar/Maghrib/dll)
function getSantriHalaqohGuru(pengampu) {
  pengampu = norm(pengampu);
  return getHalaqohList().filter(function(h){
    return pengampuCocok(h.pengampuList, pengampu);
  }).map(function(h){ return {namaHalaqoh:h.namaHalaqoh, waktu:h.waktu, gender:h.gender}; });
}

// Rekap absensi per santri untuk satu guru+mapel -- dipakai menu Rekap Absensi Guru
function getRekapAbsensiGuru(pengampu, mapel, tglMulai, tglAkhir) {
  pengampu = norm(pengampu);
  const sh = getAktifSS().getSheetByName(SHEET_ABSENSI);
  if (!sh) return [];
  const rows = nilaiCatatanUnik_(sh); rows.shift();
  const tz = Session.getScriptTimeZone();

  // Filter baris sesuai guru, mapel, dan rentang tanggal
  const filtered = rows.filter(r => {
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
    if (normNama(norm(r[5])) !== normNama(pengampu)) return false;
    if (mapel && norm(r[3]) !== norm(mapel)) return false;
    if (tglMulai && tgl < tglMulai) return false;
    if (tglAkhir && tgl > tglAkhir) return false;
    return true;
  });

  // Kelompokkan per NISN santri
  const perSantri = {};
  filtered.forEach(r => {
    const nisn = norm(r[6]), nama = norm(r[7]), status = norm(r[8]);
    if (!perSantri[nisn]) perSantri[nisn] = {nisn, nama, hadir:0, sakit:0, izin:0, alpa:0, total:0};
    perSantri[nisn].total++;
    if (status==='Hadir') perSantri[nisn].hadir++;
    else if (status==='Sakit') perSantri[nisn].sakit++;
    else if (status==='Izin' || status==='Izin Pulang') perSantri[nisn].izin++;
    else if (status==='Alpa') perSantri[nisn].alpa++;
  });

  return Object.values(perSantri).map(s => ({
    ...s,
    persenHadir: s.total > 0 ? Math.round(s.hadir/s.total*100) : 0
  })).sort((a,b) => a.alpa - b.alpa || b.persenHadir - a.persenHadir);
}

// Rekap hafalan per santri untuk satu halaqoh -- progress (juz/surah terakhir, nilai rata-rata)
function getRekapHafalanHalaqoh(namaHalaqoh, tglMulai, tglAkhir) {
  namaHalaqoh = norm(namaHalaqoh);
  const sh = getAktifSS().getSheetByName(SHEET_HAFALAN);
  if (!sh) return [];
  const rows = nilaiCatatanUnik_(sh); rows.shift();
  const tz = Session.getScriptTimeZone();

  const filtered = rows.filter(r => {
    if (norm(r[4]) !== namaHalaqoh) return false;
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
    if (tglMulai && tgl < tglMulai) return false;
    if (tglAkhir && tgl > tglAkhir) return false;
    return true;
  });

  const perSantri = {};
  const tz2 = Session.getScriptTimeZone();
  filtered.forEach(r => {
    const nisn = norm(r[2]), nama = norm(r[3]);
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz2,'yyyy-MM-dd') : norm(r[0]);
    if (!perSantri[nisn]) perSantri[nisn] = {
      nisn, nama, totalSetor:0, totalMurojaah:0,
      nilaiTotal:0, nilaiCount:0, surahTerakhir:'', juzTerakhir:0,
      halamanTotal:0, tanggalTerakhir:''
    };
    const s = perSantri[nisn];
    const jenis = norm(r[5]);
    if (jenis==='Setoran Baru'||jenis==='Setoran') s.totalSetor++;
    else if (jenis==='Murojaah') s.totalMurojaah++;
    const nilai = Number(r[10]);
    if (nilai > 0) { s.nilaiTotal += nilai; s.nilaiCount++; }
    if (norm(r[6])) s.surahTerakhir = norm(r[6]);
    if (Number(r[8]) > 0) s.juzTerakhir = Number(r[8]);
    const halAkhir = Number(r[9]);
    if (halAkhir > s.halamanTotal) s.halamanTotal = halAkhir;
    if (tgl > s.tanggalTerakhir) s.tanggalTerakhir = tgl;
  });

  return Object.values(perSantri).map(s => ({
    ...s,
    nilaiRata: s.nilaiCount > 0 ? Math.round(s.nilaiTotal/s.nilaiCount) : 0,
    totalSesi: s.totalSetor + s.totalMurojaah
  })).sort((a,b) => b.totalSesi - a.totalSesi);
}

// Ringkasan progress halaqoh hari ini -- berapa persen sudah setor
function getRingkasanHalaqohHariIni(namaHalaqoh, waktu) {
  namaHalaqoh = norm(namaHalaqoh);
  const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(),tz,'yyyy-MM-dd');

  // Daftar anggota halaqoh
  const shAnggota = getAktifSS().getSheetByName(SHEET_HALAQOH_ANGGOTA);
  const anggota = nilaiCatatanUnik_(shAnggota); anggota.shift();
  const daftarAnggota = anggota.filter(r => norm(r[2])===namaHalaqoh).map(r => ({nisn:norm(r[0]),nama:norm(r[1])}));

  // Siapa yang sudah isi hari ini
  const shHafalan = getAktifSS().getSheetByName(SHEET_HAFALAN);
  const hafRows = nilaiCatatanUnik_(shHafalan); hafRows.shift();
  const sudahSetor = new Set();
  hafRows.forEach(r => {
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
    if (tgl===today && norm(r[4])===namaHalaqoh) sudahSetor.add(norm(r[2]));
  });

  const total = daftarAnggota.length;
  const setor = daftarAnggota.filter(a => sudahSetor.has(a.nisn)).length;
  const belum = daftarAnggota.filter(a => !sudahSetor.has(a.nisn));

  return {
    namaHalaqoh, total, setor, belum:belum.length,
    persen: total > 0 ? Math.round(setor/total*100) : 0,
    daftarBelum: belum
  };
}

function getRiwayatAbsensi(p) {
  const sh = getSSTarget(p.tahunAjaranId).getSheetByName(SHEET_ABSENSI);
  if (!sh) return [];
  const rows = nilaiCatatanUnik_(sh); rows.shift();
  const tz = Session.getScriptTimeZone();
  return rows.map((r,idx) => ({
      rowIndex: r._baris || (idx+2),
      tanggal: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : norm(r[0]),
      hari:r[1], jamKe:r[2], mapel:norm(r[3]), kelas:norm(r[4]), pengampu:norm(r[5]),
      nisn:norm(r[6]), nama:norm(r[7]), status:norm(r[8]), keterangan:norm(r[9]),
      sikap1:r[10], sikap2:r[11], sikap3:r[12], sikap4:r[13], nilaiSikap:r[14],
      tipeAbsen:norm(r[16]||'Akademik'), waktuHalaqoh:norm(r[17]||'')
    }))
    .filter(r => r.tanggal && r.tanggal !== 'NaN-aN-aN')
    .filter(r => (!p.pengampu || normNama(r.pengampu) === normNama(p.pengampu)))
    .filter(r => (!p.mapel || normNama(r.mapel) === normNama(p.mapel)))
    .filter(r => (!p.nisn || String(r.nisn) === String(p.nisn)))
    .filter(r => (!p.tanggalMulai || r.tanggal >= p.tanggalMulai))
    .filter(r => (!p.tanggalAkhir || r.tanggal <= p.tanggalAkhir))
    .filter(r => (!p.tipeAbsen || r.tipeAbsen === p.tipeAbsen))
    .sort((a,b) => b.tanggal.localeCompare(a.tanggal) || a.jamKe-b.jamKe);
}

function apiUpdateAbsensi(p) {
  const sh = getAktifSS().getSheetByName(SHEET_ABSENSI);
  if (!sh) return {ok:false, error:'Sheet Absensi tidak ditemukan.'};
  if (!p.rowIndex || p.rowIndex < 2) return {ok:false, error:'Baris tidak valid.'};
  // Konsisten dengan apiSubmitAbsensi: kalau tidak hadir, nilai sikap dikosongkan
  const isHadir = norm(p.status) === 'Hadir';
  const sikapKosong = (v) => v === '' || v === null || v === undefined;
  let s1, s2, s3, s4, nilaiSikap;
  if (!isHadir || (sikapKosong(p.sikap1) && sikapKosong(p.sikap2) && sikapKosong(p.sikap3) && sikapKosong(p.sikap4))) {
    s1 = ''; s2 = ''; s3 = ''; s4 = ''; nilaiSikap = '';
  } else {
    s1 = sikapKosong(p.sikap1) ? 4 : p.sikap1;
    s2 = sikapKosong(p.sikap2) ? 4 : p.sikap2;
    s3 = sikapKosong(p.sikap3) ? 4 : p.sikap3;
    s4 = sikapKosong(p.sikap4) ? 4 : p.sikap4;
    nilaiSikap = hitungNilaiSikap(s1,s2,s3,s4);
  }
  try {
    sh.getRange(p.rowIndex,9,1,8).setValues([[p.status, p.keterangan||'', s1,s2,s3,s4, nilaiSikap, new Date()]]);
  } catch(e) {
    return {ok:false, error:'Gagal update: '+e.message};
  }
  return {ok:true};
}

function apiDeleteAbsensi(p) {
  const sh = getAktifSS().getSheetByName(SHEET_ABSENSI);
  if (!sh) return {ok:false, error:'Sheet Absensi tidak ditemukan.'};
  const rowIdx = Number(p.rowIndex);
  if (!rowIdx || rowIdx < 2) return {ok:false, error:'Baris tidak valid.'};
  if (rowIdx > sh.getLastRow()) return {ok:false, error:'Baris tidak ditemukan (mungkin sudah dihapus).'};
  // Ikut hapus salinan lama sesi yang sama (bila dulu tercatat ganda) supaya catatan
  // lama tidak "muncul kembali" setelah catatan terbarunya dihapus.
  return denganKunciCatatan_(function(){
    try {
      if (rowIdx > sh.getLastRow()) return {ok:false, error:'Baris tidak ditemukan (mungkin sudah dihapus).'};
      let daftar = [rowIdx];
      const semuaBaris = sh.getDataRange().getValues();
      // Pengaman: baris yang dimaksud harus masih milik santri yang sama (data bisa bergeser
      // bila ada yang menghapus baris lain sejak riwayat dibuka).
      if (p.nisn && norm((semuaBaris[rowIdx-1]||[])[6]) !== norm(p.nisn)) {
        return {ok:false, error:'Data sudah berubah sejak halaman dibuka. Muat ulang riwayat lalu coba lagi.'};
      }
      try { daftar = barisSesiSama_(semuaBaris, SHEET_ABSENSI, rowIdx); } catch (e2) {}
      daftar.sort(function(a,b){ return b-a; }).forEach(function(b){ sh.deleteRow(b); });
      return {ok:true, terhapus: daftar.length};
    } catch(e) {
      return {ok:false, error:'Gagal hapus: '+e.message};
    }
  });
}

// ============ REKAP SANTRI (kehadiran + nilai sikap) ============
function getRekapSantri(nisn, tahunAjaranId) {
  const rows = getRiwayatAbsensi({nisn: nisn, tahunAjaranId: tahunAjaranId});
  const perMapel = {};
  rows.forEach(r => {
    // Normalize "Izin Pulang" → dihitung sebagai "Izin" di rekap absensi
    const statusRekap = r.status === 'Izin Pulang' ? 'Izin' : r.status;
    if (!perMapel[r.mapel]) perMapel[r.mapel] = {Hadir:0,Sakit:0,Izin:0,Alpa:0,total:0,totalSikap:0,jmlSikap:0};
    perMapel[r.mapel][statusRekap] = (perMapel[r.mapel][statusRekap]||0) + 1;
    perMapel[r.mapel].total++;
    if (r.nilaiSikap !== '' && r.nilaiSikap != null) { perMapel[r.mapel].totalSikap += Number(r.nilaiSikap); perMapel[r.mapel].jmlSikap++; }
  });
  const hasil = Object.keys(perMapel).map(m => {
    const d = perMapel[m];
    return {mapel:m, hadir:d.Hadir, sakit:d.Sakit, izin:d.Izin, alpa:d.Alpa, total:d.total,
      persen: d.total ? Math.round((d.Hadir/d.total)*100) : 100,
      rataSikap: d.jmlSikap ? Math.round((d.totalSikap/d.jmlSikap)*100)/100 : null };
  });
  const totalHadir = rows.filter(r=>r.status==='Hadir').length;
  const persenUmum = rows.length ? Math.round((totalHadir/rows.length)*100) : 100;
  const rowsSikap = rows.filter(r=>r.nilaiSikap !== '' && r.nilaiSikap != null);
  const rataSikapUmum = rowsSikap.length ? Math.round((rowsSikap.reduce((a,r)=>a+Number(r.nilaiSikap),0)/rowsSikap.length)*100)/100 : null;
  return {perMapel: hasil, persenUmum: persenUmum, totalPertemuan: rows.length, rataSikapUmum: rataSikapUmum};
}

function getNotifikasiMingguan(nisn, tahunAjaranId) {
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const seminggu = new Date(); seminggu.setDate(now.getDate()-7);
  const tglMulai = Utilities.formatDate(seminggu, tz, 'yyyy-MM-dd');
  const tglAkhir = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const rows = getRiwayatAbsensi({nisn:nisn, tanggalMulai: tglMulai, tanggalAkhir: tglAkhir, tahunAjaranId: tahunAjaranId});
  const rekap = {Hadir:0,Sakit:0,Izin:0,Alpa:0};
  rows.forEach(r => rekap[r.status] = (rekap[r.status]||0)+1);
  return {periode: tglMulai + ' s/d ' + tglAkhir, rekap: rekap, detail: rows};
}

// ============ REKAP GURU ============
function getRekapGuruBulanan(bulan, tahun) {
  bulan = Number(bulan); tahun = Number(tahun);
  const sh = getAktifSS().getSheetByName(SHEET_ABSENSI);
  const rows = nilaiCatatanUnik_(sh); rows.shift();
  const tz = Session.getScriptTimeZone();
  const sesi = {};
  rows.forEach(r => {
    const d = new Date(r[0]);
    if (d.getMonth()+1 !== bulan || d.getFullYear() !== tahun) return;
    const key = Utilities.formatDate(d,tz,'yyyy-MM-dd')+'|'+r[2]+'|'+r[3]+'|'+r[5];
    sesi[key] = r[5];
  });
  const rekap = {}; Object.values(sesi).forEach(g => rekap[g] = (rekap[g]||0)+1);
  return Object.keys(rekap).map(g => ({guru:g, jumlahJam: rekap[g]}));
}

function getAbsensiGuruPerMapel(bulan, tahun) {
  bulan = Number(bulan); tahun = Number(tahun);
  const ss = getAktifSS();
  const mapelRows = nilaiCatatanUnik_(ss.getSheetByName(SHEET_MAPEL)); mapelRows.shift();
  const absensiRows = nilaiCatatanUnik_(ss.getSheetByName(SHEET_ABSENSI)); absensiRows.shift();
  const terisi = {};
  absensiRows.forEach(r => {
    const d = new Date(r[0]);
    if (d.getMonth()+1 !== bulan || d.getFullYear() !== tahun) return;
    const key = r[3]+'|'+r[5]+'|'+r[1];
    terisi[key] = (terisi[key]||0)+1;
  });
  return mapelRows.map(m => {
    const [mapel,kelas,pengampu,hari,jamKe] = m;
    return {mapel, kelas:norm(kelas), pengampu, hari, jamKe, jumlahSesiTerisi: terisi[mapel+'|'+pengampu+'|'+hari] || 0};
  });
}

// ============ MASTER JAM PELAJARAN (acuan rekap jam mengajar guru) ============
function getJamPelajaranList(tahunAjaranId) {
  const sh = getSSTarget(tahunAjaranId).getSheetByName(SHEET_JAM_PELAJARAN);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.filter(r => r[0] && r[1]).map(r => ({ jenis: norm(r[0]), nama: norm(r[1]), jumlahJam: Number(r[2]) || 0 }));
}

// ============ GURU PENGGANTI ============
// Prinsip: guru pengganti TIDAK perlu akun khusus atau pengaturan rumit -- admin cukup
// catat "tanggal X, sesi Y milik guru A, digantikan guru B". Sistem otomatis:
// - Menyembunyikan sesi itu dari jadwal guru A pada tanggal itu saja (sekali pakai,
//   bukan permanen -- besoknya jadwal guru A normal lagi).
// - Memunculkan sesi itu di jadwal guru B pada tanggal itu, ditandai "Menggantikan".
// - Karena saat submit absensi/hafalan, Pengampu yang tersimpan selalu nama akun yang
//   sedang login (guru B), jam mengajarnya OTOMATIS masuk ke rekap guru B, bukan guru A
//   -- tidak perlu logika tambahan apapun di rekap jam mengajar.
function getDaftarPenggantian(tahunAjaranId) {
  const sh = getSSTarget(tahunAjaranId).getSheetByName(SHEET_PENGGANTIAN);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  return rows.map((r,i) => ({
    rowIndex: i+2,
    tanggal: (r[0] instanceof Date) ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : norm(r[0]),
    jenisSesi: norm(r[1]), mapel: norm(r[2]), kelas: norm(r[3]), jamKe: r[4],
    halaqoh: norm(r[5]), waktu: norm(r[6]), guruAsli: norm(r[7]), guruPengganti: norm(r[8]), keterangan: norm(r[9])
  }));
}

function apiTambahPenggantian(p) {
  const tanggal = norm(p.tanggal), guruAsli = norm(p.guruAsli), guruPengganti = norm(p.guruPengganti);
  if (!tanggal || !guruAsli || !guruPengganti) return {ok:false, error:'Tanggal, Guru Asli, dan Guru Pengganti wajib diisi'};
  if (guruAsli === guruPengganti) return {ok:false, error:'Guru Pengganti tidak boleh sama dengan Guru Asli'};
  if (norm(p.jenisSesi) === 'Mapel' && (!norm(p.mapel) || !norm(p.kelas) || !p.jamKe)) return {ok:false, error:'Mapel, Kelas, dan Jam Ke wajib diisi untuk sesi Mata Pelajaran'};
  if (norm(p.jenisSesi) === 'Halaqoh' && (!norm(p.halaqoh) || !norm(p.waktu))) return {ok:false, error:'Halaqoh dan Waktu wajib diisi untuk sesi Halaqoh'};
  const sh = getAktifSS().getSheetByName(SHEET_PENGGANTIAN);
  sh.appendRow([tanggal, norm(p.jenisSesi), norm(p.mapel), norm(p.kelas), p.jamKe||'', norm(p.halaqoh), norm(p.waktu), guruAsli, guruPengganti, norm(p.keterangan), new Date()]);
  return {ok:true};
}

function apiHapusPenggantian(p) {
  getAktifSS().getSheetByName(SHEET_PENGGANTIAN).deleteRow(Number(p.rowIndex));
  return {ok:true};
}

// ============ REKAP KEHADIRAN HALAQOH (acuan: JENIS HAFALAN yang dipilih guru) ============
// Sabaq/Sabqi/Manzil/Murojaah/Tahsin/Tasmi'/Tidak Setor dihitung HADIR. Izin/Sakit/Ghaib dihitung
// statusnya masing-masing. Guru TIDAK perlu isi absen kehadiran terpisah -- cukup dari
// jenis hafalan yang sudah ia catat di form Isi Hafalan.
function getRekapKehadiranHalaqoh(nisn, tahunAjaranId) {
  const rows = getRiwayatHafalan({nisn:nisn, tahunAjaranId:tahunAjaranId});
  const perHalaqoh = {};
  rows.forEach(r => {
    if (!perHalaqoh[r.halaqoh]) perHalaqoh[r.halaqoh] = {Hadir:0, Izin:0, Sakit:0, Ghaib:0, total:0};
    const status = JENIS_HAFALAN_DIANGGAP_HADIR.indexOf(r.jenis) !== -1 ? 'Hadir' : r.jenis;
    if (perHalaqoh[r.halaqoh][status] === undefined) perHalaqoh[r.halaqoh][status] = 0;
    perHalaqoh[r.halaqoh][status]++;
    perHalaqoh[r.halaqoh].total++;
  });
  return Object.keys(perHalaqoh).map(h => {
    const d = perHalaqoh[h];
    return { halaqoh:h, hadir:d.Hadir||0, izin:d.Izin||0, sakit:d.Sakit||0, ghaib:d.Ghaib||0, total:d.total,
      persen: d.total ? Math.round(((d.Hadir||0)/d.total)*100) : 100 };
  });
}

// ============ REKAP JAM MENGAJAR GURU (acuan penggajian per jam) ============
// Guru dianggap "hadir mengajar" otomatis dari catatan Absensi (mata pelajaran) atau
// Hafalan (halaqoh) yang ia isi sendiri -- tidak perlu absen kehadiran terpisah. Jumlah
// jam tiap sesi diambil dari master JamPelajaran (per nama Mapel, atau per Waktu Halaqoh).
// - pengampu diisi -> mode detail: seluruh riwayat sesi mengajarnya + totalnya.
// - pengampu kosong -> mode ringkasan: semua guru dengan total jam masing-masing (buat bendahara).
function getRekapJamMengajarGuru(pengampu, bulan, tahun, tahunAjaranId) {
  bulan = Number(bulan); tahun = Number(tahun);
  pengampu = norm(pengampu);
  const ss = getSSTarget(tahunAjaranId);
  const tz = Session.getScriptTimeZone();
  const awalBulan = tahun + '-' + String(bulan).padStart(2, '0');
  const jamList = getJamPelajaranList(tahunAjaranId);
  // Peta jam per sesi dari master Jam Pelajaran. Dicocokkan tanpa peduli huruf besar/
  // kecil, spasi, atau tanda baca -- dulu "fiqih" tidak cocok dengan "Fiqih", dan
  // halaqoh "subuh" bernilai 0 jam karena master menulis "Subuh".
  const jamMapel = {}, jamHalaqoh = {};
  const kunciJam = function(x){ return normNama(norm(x)).replace(/[^a-z0-9]/g, ''); };
  jamList.forEach(j => {
    if (normNama(j.jenis) === 'halaqoh') jamHalaqoh[kunciJam(j.nama)] = j.jumlahJam;
    else if (normNama(j.jenis) === 'mapel' || normNama(j.jenis) === 'mata pelajaran') jamMapel[kunciJam(j.nama)] = j.jumlahJam;
  });
  // Jam bawaan untuk mapel yang belum diatur di master JamPelajaran, supaya
  // rekap tetap terhitung (2 jam pelajaran) daripada diam-diam bernilai 0.
  const JAM_MAPEL_DEFAULT = 2;
  // Nama guru dicocokkan tanpa peduli titik/spasi/huruf besar ("Ust. Ahmad" = "ust ahmad"),
  // supaya absen yang sudah diisi tidak "hilang" dari rekap hanya karena beda penulisan
  // nama antara akun login dan data guru.
  const cocokGuru = function(g){ return !pengampu || samaGuru_(g, pengampu); };

  // Ambil data gender halaqoh untuk koreksi jam Duha Jumat, dan pengampu UTAMA tiap
  // halaqoh (nama pertama di kolom Pengampu) untuk menandai sesi yang diisi pengganti.
  const halaqohGenderMap = {}, utamaHalaqoh = {};
  try {
    const shHq = ss.getSheetByName(SHEET_HALAQOH);
    if (shHq && shHq.getLastRow() > 1) {
      shHq.getDataRange().getValues().slice(1).forEach(r => {
        if (!r[0]) return;
        halaqohGenderMap[normNama(norm(r[0]))] = norm(r[3]); // namaHalaqoh → gender
        const daftarG = daftarPengampu(r[1]);
        if (daftarG.length > 1) utamaHalaqoh[normNama(norm(r[0]))] = daftarG[0];
      });
    }
  } catch(e) {}

  const sesiUnik = {};
  function tambahSesiHalaqoh(tglStr, waktuMentah, halaqoh, guru) {
    const waktu = (waktuMentah instanceof Date) ? Utilities.formatDate(waktuMentah, tz, 'HH:mm') : norm(waktuMentah);
    // Satu sesi halaqoh = tanggal + waktu + guru. Seorang guru hanya bisa berada di satu
    // tempat pada satu waktu, jadi bila ia mengisi BEBERAPA halaqoh di waktu yang sama
    // (mis. pengganti yang memegang 2 halaqoh Subuh sekaligus), tetap dihitung SATU sesi.
    // Absensi halaqoh dan catatan hafalan untuk sesi yang sama juga dihitung satu kali.
    const key = 'H|' + tglStr + '|' + kunciJam(waktu) + '|' + normNamaGuru_(guru);
    const adaDiMaster = jamHalaqoh[kunciJam(waktu)] !== undefined;
    let jam = adaDiMaster ? jamHalaqoh[kunciJam(waktu)] : 0;
    // Koreksi khusus: Halaqoh Duha hari Jumat untuk Putra = 2 jam (bukan 4)
    const q = tglStr.split('-').map(Number);
    const hariSesi = HARI_LIST[new Date(q[0], q[1]-1, q[2]).getDay()];
    const genderHalaqoh = halaqohGenderMap[normNama(halaqoh)] || '';
    if (kunciJam(waktu) === 'duha' && normNama(hariSesi) === normNama("Jum'at") &&
        normNama(genderHalaqoh) === 'laki-laki') {
      jam = 2;
    }
    const utama = utamaHalaqoh[normNama(halaqoh)];
    const menggantikan = (utama && !samaGuru_(utama, guru)) ? utama : '';
    const label = halaqoh + (menggantikan ? ' (menggantikan ' + menggantikan + ')' : '');
    const ada = sesiUnik[key];
    if (ada) {
      // Halaqoh lain di sesi yang sama: hanya dicantumkan di keterangan, jam tidak bertambah
      if (ada._halaqoh.indexOf(normNama(halaqoh)) === -1) {
        ada._halaqoh.push(normNama(halaqoh));
        ada.keterangan += ' + ' + label;
        ada.jumlahHalaqoh = ada._halaqoh.length;
      }
      ada.jam = Math.max(ada.jam, jam);
      return;
    }
    sesiUnik[key] = { tanggal: tglStr, jenis:'Halaqoh ('+waktu+')', keterangan: label,
      pengampu: guru, jam: jam, jamBelumDiatur: !adaDiMaster, menggantikan: menggantikan,
      jumlahHalaqoh: 1, _halaqoh: [normNama(halaqoh)] };
  }

  const shAbsensi = ss.getSheetByName(SHEET_ABSENSI);
  if (shAbsensi && shAbsensi.getLastRow() > 1) {
    const absensiRows = nilaiCatatanUnik_(shAbsensi); absensiRows.shift();
    absensiRows.forEach(r => {
      const tglStr = tglKunciCatatan_(r[0], tz);
      if (!tglStr || tglStr.slice(0, 7) !== awalBulan) return;
      const guru = norm(r[5]);
      if (!guru || !cocokGuru(guru)) return;
      const mapel = norm(r[3]), kelas = norm(r[4]);
      // Absensi halaqoh yang dicatat di sheet Absensi adalah sesi HALAQOH, bukan mapel
      if (norm(r[16]) === 'Halaqoh') { tambahSesiHalaqoh(tglStr, r[17], mapel, guru); return; }
      // Satu sesi mengajar = satu jam ke- untuk tanggal+mapel+kelas+guru, TIDAK dihitung
      // per santri. Jam ke-1 & ke-2 = dua sesi (cukup diisi sekali, tersimpan per jam).
      const daftarJam = pecahJamKe_(r[2]);
      (daftarJam.length ? daftarJam : [r[2]]).forEach(function(jk){
        const key = 'M|'+tglStr+'|'+String(jk)+'|'+normNama(mapel)+'|'+normNama(kelas)+'|'+normNamaGuru_(guru);
        if (sesiUnik[key]) return;
        const adaDiMaster = jamMapel[kunciJam(mapel)] !== undefined;
        const jam = adaDiMaster ? jamMapel[kunciJam(mapel)] : JAM_MAPEL_DEFAULT;
        const labelJam = (jk !== '' && jk !== null && jk !== undefined && Number(jk) !== 0) ? ' (jam ke-' + jk + ')' : '';
        sesiUnik[key] = { tanggal: tglStr, jenis:'Mata Pelajaran', keterangan: mapel+' - '+kelas+labelJam,
          pengampu: guru, jam: jam, jamKe: jk, jamBelumDiatur: !adaDiMaster };
      });
    });
  }

  const shHafalan = ss.getSheetByName(SHEET_HAFALAN);
  if (shHafalan && shHafalan.getLastRow() > 1) {
    const hafalanRows = nilaiCatatanUnik_(shHafalan); hafalanRows.shift();
    hafalanRows.forEach(r => {
      const tglStr = tglKunciCatatan_(r[0], tz);
      if (!tglStr || tglStr.slice(0, 7) !== awalBulan) return;
      const guru = norm(r[3]);
      if (!guru || !cocokGuru(guru)) return;
      tambahSesiHalaqoh(tglStr, r[1], norm(r[2]), guru);
    });
  }

  Object.keys(sesiUnik).forEach(function(k){ delete sesiUnik[k]._halaqoh; });
  const daftar = Object.keys(sesiUnik).map(k => sesiUnik[k]).sort((a,b) =>
    a.tanggal.localeCompare(b.tanggal) || String(a.keterangan).localeCompare(String(b.keterangan)) ||
    ((Number(a.jamKe)||0) - (Number(b.jamKe)||0)));
  // Keterangan sesi yang TIDAK terisi diambil dari mesin kehadiran, supaya Mudir tahu
  // alasannya (izin, sakit, digantikan, masih masa klarifikasi, atau tanpa izin) --
  // bukan cuma melihat jamnya sedikit tanpa penjelasan.
  // Dibungkus try/catch: kalau perhitungan kehadiran gagal, rekap jam tetap tampil.
  function ketidakhadiranGuru_(namaGuru) {
    try {
      const h = hitungKehadiranGuruAtur_(bulan, tahun, namaGuru)[0];
      if (!h) return null;
      return {
        ringkas: h.ringkas,
        sesi: h.sesi.filter(function(x){ return x.status !== 'Hadir' && x.status !== 'Libur'; })
          .map(function(x){ return {tanggal:x.tanggal, jenis:x.jenis, nama:x.nama, status:x.status, ket:x.ket || '', sisaHari:x.sisaHari || 0}; })
      };
    } catch (e) { Logger.log('Keterangan kehadiran gagal: ' + e.message); return null; }
  }

  if (pengampu) {
    const totalJam = daftar.reduce((s,x) => s + x.jam, 0);
    // Rekap per hari juga disertakan -- dipakai dashboard guru untuk menampilkan
    // "sudah X jam bulan ini" tanpa harus menjumlahkan sendiri di sisi klien.
    const perHari = {};
    daftar.forEach(x => { perHari[x.tanggal] = (perHari[x.tanggal]||0) + x.jam; });
    const kh = ketidakhadiranGuru_(pengampu);
    return { ok:true, mode:'detail', pengampu: pengampu, riwayat: daftar, totalJam: totalJam,
             jumlahSesi: daftar.length, perHari: perHari,
             tidakMengajar: kh ? kh.sesi : [], kehadiran: kh ? kh.ringkas : null };
  }
  // Gabungkan dengan data kehadiran supaya baris guru yang jamnya sedikit langsung
  // terlihat sebabnya. Guru yang punya jadwal tapi nol sesi pun tetap muncul.
  let kehadiranSemua = [];
  try { kehadiranSemua = hitungKehadiranGuruAtur_(bulan, tahun, ''); } catch (e) { Logger.log('Rekap kehadiran gagal: ' + e.message); }
  const petaKehadiran = {};
  kehadiranSemua.forEach(function(g){ petaKehadiran[normNamaGuru_(g.guru)] = g; });
  // Dijumlah per guru dengan nama yang dinormalkan: "Ust. Ahmad" dan "Ust Ahmad" satu baris.
  // Nama yang ditampilkan mengikuti jadwal (bila ada), supaya tombol Rincian cocok.
  const perGuru = {};
  daftar.forEach(function(x){
    const k = normNamaGuru_(x.pengampu);
    if (!perGuru[k]) perGuru[k] = {nama: petaKehadiran[k] ? petaKehadiran[k].guru : x.pengampu, jam: 0, sesi: 0};
    perGuru[k].jam += x.jam; perGuru[k].sesi++;
  });
  Object.keys(petaKehadiran).forEach(function(k){
    if (!perGuru[k]) perGuru[k] = {nama: petaKehadiran[k].guru, jam: 0, sesi: 0};
  });
  const ringkasan = Object.keys(perGuru).map(function(k){
    const kh = petaKehadiran[k];
    return {pengampu: perGuru[k].nama, totalJam: perGuru[k].jam, jumlahSesi: perGuru[k].sesi,
      kehadiran: kh ? kh.ringkas : null, persen: kh ? kh.persen : null, wajib: kh ? kh.wajib : null};
  }).sort((a,b) => b.totalJam - a.totalJam);
  return { ok:true, mode:'ringkasan', daftar: ringkasan };
}

function getDashboardAdmin() {
  const ss = getAktifSS();
  return {
    jmlSantri: ss.getSheetByName(SHEET_SANTRI).getLastRow()-1,
    jmlGuru: ss.getSheetByName(SHEET_GURU).getLastRow()-1,
    jmlMapel: ss.getSheetByName(SHEET_MAPEL).getLastRow()-1,
    jmlAbsensi: ss.getSheetByName(SHEET_ABSENSI).getLastRow()-1,
    jmlHafalan: ss.getSheetByName(SHEET_HAFALAN).getLastRow()-1,
    jmlRekapNilai: ss.getSheetByName(SHEET_REKAP_NILAI).getLastRow()-1,
    jmlRombel: getDaftarKelasRombel().length,
    jmlHalaqoh: getHalaqohList().length,
    ssName: ss.getName()
  };
}

// ============ CRUD DATA MASTER GENERIK (Guru/MataPelajaran/RoleAkses) ============
function getMasterData(sheetName) {
  const sh = getAktifSS().getSheetByName(sheetName);
  const values = sh.getDataRange().getValues();
  const header = values.shift();
  const data = values.map((r,i) => {
    const obj = {rowIndex: i+2};
    header.forEach((h,j) => obj[h] = r[j]);
    return obj;
  });
  return {header, data};
}

function apiSaveMasterRow(p) {
  const sh = getAktifSS().getSheetByName(p.sheet);
  const header = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const rowVals = header.map(h => (p.values[h] !== undefined ? p.values[h] : ''));
  if (p.rowIndex && Number(p.rowIndex) > 1) sh.getRange(Number(p.rowIndex),1,1,rowVals.length).setValues([rowVals]);
  else sh.appendRow(rowVals);
  return {ok:true};
}

function apiDeleteMasterRow(p) {
  getAktifSS().getSheetByName(p.sheet).deleteRow(Number(p.rowIndex));
  return {ok:true};
}

// ============ ROMBEL AKADEMIK ============
function getDaftarKelasRombel() {
  const sh = getAktifSS().getSheetByName(SHEET_DAFTAR_KELAS);
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.filter(r=>r[0]).map(r => ({kelas: norm(r[0]), waliKelas: norm(r[1])}));
}

function getDetailRombel(kelas) {
  kelas = norm(kelas);
  const sh = getAktifSS().getSheetByName(SHEET_ROMBEL);
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.map((r,i) => ({rowIndex:i+2, nisn:norm(r[0]), nama:norm(r[1]), kelas:norm(r[2])})).filter(r => r.kelas === kelas && r.nisn);
}

function apiBuatRombelBaru(p) {
  const kelas = norm(p.kelas), waliKelas = norm(p.waliKelas);
  if (!kelas) return {ok:false, error:'Nama rombel/kelas wajib diisi'};
  if (getDaftarKelasRombel().some(k => k.kelas === kelas)) return {ok:false, error:'Rombel "'+kelas+'" sudah ada'};
  getAktifSS().getSheetByName(SHEET_DAFTAR_KELAS).appendRow([kelas, waliKelas]);
  return {ok:true};
}

function apiHapusRombel(p) {
  const kelas = norm(p.kelas);
  const ss = getAktifSS();
  const shKelas = ss.getSheetByName(SHEET_DAFTAR_KELAS);
  const rowsKelas = shKelas.getDataRange().getValues();
  for (let i=rowsKelas.length-1;i>=1;i--) if (norm(rowsKelas[i][0]) === kelas) shKelas.deleteRow(i+1);
  const shRombel = ss.getSheetByName(SHEET_ROMBEL);
  const rowsRombel = shRombel.getDataRange().getValues();
  for (let i=rowsRombel.length-1;i>=1;i--) if (norm(rowsRombel[i][2]) === kelas) shRombel.deleteRow(i+1);
  return {ok:true};
}

function apiEditWaliKelas(p) {
  const kelas = norm(p.kelas), waliBaru = norm(p.waliKelasBaru);
  const sh = getAktifSS().getSheetByName(SHEET_DAFTAR_KELAS);
  const rows = sh.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) if (norm(rows[i][0]) === kelas) { sh.getRange(i+1,2).setValue(waliBaru); return {ok:true}; }
  return {ok:false, error:'Rombel tidak ditemukan'};
}

function apiTambahSantriKeRombel(p) {
  const nisn = norm(p.nisn), kelas = norm(p.kelas);
  if (!nisn || !kelas) return {ok:false, error:'NISN dan Kelas wajib diisi'};
  if (!getDaftarKelasRombel().some(k=>k.kelas===kelas)) return {ok:false, error:'Rombel "'+kelas+'" belum dibuat. Buat rombel dulu.'};
  const ss = getAktifSS();
  const santriRows = ss.getSheetByName(SHEET_SANTRI).getDataRange().getValues(); santriRows.shift();
  const santri = santriRows.find(r => norm(r[0]) === nisn);
  if (!santri) return {ok:false, error:'NISN tidak ditemukan di data Santri. Tambahkan dulu di menu Data Santri.'};
  const shRombel = ss.getSheetByName(SHEET_ROMBEL);
  const rombelRows = shRombel.getDataRange().getValues();
  for (let i=1;i<rombelRows.length;i++) {
    if (norm(rombelRows[i][0]) === nisn) return {ok:false, error: norm(santri[1])+' sudah terdaftar di rombel "'+norm(rombelRows[i][2])+'". Gunakan Pindah Rombel.'};
  }
  shRombel.appendRow([nisn, norm(santri[1]), kelas]);
  return {ok:true};
}

function apiPindahSantriRombel(p) {
  const nisn = norm(p.nisn), kelasBaru = norm(p.kelasBaru);
  if (!getDaftarKelasRombel().some(k=>k.kelas===kelasBaru)) return {ok:false, error:'Rombel tujuan belum dibuat'};
  const sh = getAktifSS().getSheetByName(SHEET_ROMBEL);
  const rows = sh.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) if (norm(rows[i][0]) === nisn) { sh.getRange(i+1,3).setValue(kelasBaru); return {ok:true}; }
  return {ok:false, error:'Santri belum ada di rombel manapun. Gunakan Tambah ke Rombel.'};
}

function apiHapusSantriDariRombel(p) {
  const nisn = norm(p.nisn);
  const sh = getAktifSS().getSheetByName(SHEET_ROMBEL);
  const rows = sh.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) if (norm(rows[i][0]) === nisn) { sh.deleteRow(i+1); return {ok:true}; }
  return {ok:false, error:'Tidak ditemukan di rombel manapun'};
}

function getSantriBelumPunyaRombel() {
  const ss = getAktifSS();
  const santriRows = ss.getSheetByName(SHEET_SANTRI).getDataRange().getValues(); santriRows.shift();
  const rombelRows = ss.getSheetByName(SHEET_ROMBEL).getDataRange().getValues(); rombelRows.shift();
  const sudahAda = {}; rombelRows.forEach(r => { if (r[0]) sudahAda[norm(r[0])] = true; });
  return santriRows.filter(r => !sudahAda[norm(r[0])]).map(r => ({nisn:norm(r[0]), nama:norm(r[1])}));
}

// ============ HALAQOH TAHFIDZ ============
// Pengampu Halaqoh boleh diisi lebih dari satu nama, dipisah koma ("Ust. A, Ust. B").
// Helper ini memecahnya jadi daftar nama bersih untuk pengecekan keanggotaan.
function normNama(s) {
  // Normalisasi nama untuk pencocokan:
  // - lowercase
  // - hapus tanda hubung (As-Shiddiq = Asshiddiq)
  // - hapus apostrof dan tanda baca sejenis (Jum'at = Jumat)
  // - hapus non-breaking spaces
  // - hapus spasi ganda
  return norm(s)
    .toLowerCase()
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/\s*-\s*/g, '')
    .replace(/['\u2018\u2019\u201B\u2032`]/g, '') // apostrof berbagai jenis
    .replace(/\s+/g, ' ')
    .trim();
}

function daftarPengampu(pengampuStr) {
  pengampuStr = norm(pengampuStr);
  if (!pengampuStr) return [];
  // Titik koma (;) selalu berarti pemisah antar pengampu (cara lama, tetap didukung).
  if (pengampuStr.indexOf(';') !== -1) {
    return pengampuStr.split(';').map(function(s){ return s.trim(); }).filter(Boolean);
  }
  if (pengampuStr.indexOf(',') === -1) return [pengampuStr];
  // Koma juga boleh dipakai sebagai pemisah pengampu utama dan guru pengganti/cadangan:
  //   "UST. MUH. IDUL FITRAN, S.H, UST. AHMAD"  ->  ["UST. MUH. IDUL FITRAN, S.H", "UST. AHMAD"]
  // Potongan yang berupa GELAR (S.H, S.Pd.I, Lc, M.A, ...) digabung kembali ke nama
  // sebelumnya, jadi gelar tidak dianggap sebagai guru tersendiri.
  const terdaftar = namaAkunTerdaftar_();
  if (terdaftar[normNamaGuru_(pengampuStr)]) return [pengampuStr]; // seluruh teks = satu nama akun
  const potongan = pengampuStr.split(',').map(function(x){ return x.trim(); }).filter(Boolean);
  const hasil = [];
  potongan.forEach(function(x){
    if (hasil.length && potonganGelar_(x) && !terdaftar[normNamaGuru_(x)]) hasil[hasil.length - 1] += ', ' + x;
    else hasil.push(x);
  });
  return hasil;
}

const GELAR_TANPA_TITIK_ = ['lc','ma','mh','mm','sh','se','si','st','spd','spdi','sag','sth','sthi','ssos','skom','mpd','mpdi','mag','msi','mkom','phd','ba','bsc','msc','amd','dipl'];
function potonganGelar_(x) {
  const t = String(x || '').trim();
  // Gelar ditulis rapat tanpa spasi (S.H, S.Pd.I, Lc). Potongan berspasi seperti
  // "Ust. Ali" adalah nama orang.
  if (!t || t.length > 12 || /\s/.test(t) || !/^[A-Za-z.]+$/.test(t)) return false;
  const huruf = t.replace(/[^A-Za-z]/g, '').toLowerCase();
  if (/^(ust|ustadz|ustadzah|ustdz|kh|hj|dr)/.test(huruf) && GELAR_TANPA_TITIK_.indexOf(huruf) === -1) return false;
  if (GELAR_TANPA_TITIK_.indexOf(huruf) !== -1) return true;
  // Pola bertitik pendek: S.H / S.Pd.I / M.Pd / S.Ag.
  return t.indexOf('.') !== -1 && /^([A-Za-z]{1,4}\.)+[A-Za-z]{0,4}\.?$/.test(t);
}

// Nama akun (RoleAkses) dan data Guru, dinormalkan -- dipakai untuk membedakan nama
// orang dari gelar saat memecah kolom Pengampu. Disimpan sementara selama satu eksekusi.
let _cacheNamaAkun_ = null;
function namaAkunTerdaftar_() {
  if (_cacheNamaAkun_) return _cacheNamaAkun_;
  const peta = {};
  try {
    const ss = getAktifSS();
    [SHEET_ROLE, SHEET_GURU].forEach(function(n){
      const sh = ss.getSheetByName(n);
      if (!sh || sh.getLastRow() < 2) return;
      sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function(r){
        const k = normNamaGuru_(r[0]); if (k) peta[k] = true;
      });
    });
  } catch (e) {}
  _cacheNamaAkun_ = peta;
  return peta;
}

// Cek apakah nama pengampu cocok -- toleran terhadap perbedaan kapitalisasi, spasi & titik.
function pengampuCocok(listPengampu, pengampu) {
  var target = normNama(pengampu);
  return listPengampu.some(function(p){ return normNama(p) === target || samaGuru_(p, pengampu); });
}

function getHalaqohList() {
  const sh = getAktifSS().getSheetByName(SHEET_HALAQOH);
  if (!sh) return []; // sheet belum ada -- kembalikan array kosong
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.filter(r=>r[0]).map(r => ({namaHalaqoh: norm(r[0]), pengampu: norm(r[1]), pengampuList: daftarPengampu(r[1]), waktu: norm(r[2]), gender: norm(r[3])}));
}

function getDetailHalaqoh(namaHalaqoh) {
  namaHalaqoh = norm(namaHalaqoh);
  const sh = getAktifSS().getSheetByName(SHEET_HALAQOH_ANGGOTA);
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.map((r,i) => ({rowIndex:i+2, nisn:norm(r[0]), nama:norm(r[1]), halaqoh:norm(r[2])})).filter(r => r.halaqoh === namaHalaqoh && r.nisn);
}

function apiBuatHalaqohBaru(p) {
  const nama = norm(p.namaHalaqoh), pengampu = norm(p.pengampu), waktu = norm(p.waktu), gender = norm(p.gender);
  if (!nama || !pengampu || !waktu) return {ok:false, error:'Nama Halaqoh, Pengampu, dan Waktu wajib diisi'};
  if (getHalaqohList().some(h => h.namaHalaqoh === nama)) return {ok:false, error:'Halaqoh "'+nama+'" sudah ada'};
  getAktifSS().getSheetByName(SHEET_HALAQOH).appendRow([nama, pengampu, waktu, gender]);
  return {ok:true};
}

function apiEditHalaqoh(p) {
  const nama = norm(p.namaHalaqoh);
  const sh = getAktifSS().getSheetByName(SHEET_HALAQOH);
  const rows = sh.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) {
    if (norm(rows[i][0]) === nama) {
      sh.getRange(i+1,2,1,3).setValues([[norm(p.pengampu), norm(p.waktu), norm(p.gender)]]);
      return {ok:true};
    }
  }
  return {ok:false, error:'Halaqoh tidak ditemukan'};
}

function apiHapusHalaqoh(p) {
  const nama = norm(p.namaHalaqoh);
  const ss = getAktifSS();
  const shH = ss.getSheetByName(SHEET_HALAQOH);
  const rowsH = shH.getDataRange().getValues();
  for (let i=rowsH.length-1;i>=1;i--) if (norm(rowsH[i][0]) === nama) shH.deleteRow(i+1);
  const shA = ss.getSheetByName(SHEET_HALAQOH_ANGGOTA);
  const rowsA = shA.getDataRange().getValues();
  for (let i=rowsA.length-1;i>=1;i--) if (norm(rowsA[i][2]) === nama) shA.deleteRow(i+1);
  return {ok:true};
}

function apiTambahSantriKeHalaqoh(p) {
  const nisn = norm(p.nisn), namaHalaqoh = norm(p.namaHalaqoh);
  if (!nisn || !namaHalaqoh) return {ok:false, error:'NISN dan Halaqoh wajib diisi'};
  if (!getHalaqohList().some(h=>h.namaHalaqoh===namaHalaqoh)) return {ok:false, error:'Halaqoh belum dibuat'};
  const ss = getAktifSS();
  const santriRows = ss.getSheetByName(SHEET_SANTRI).getDataRange().getValues(); santriRows.shift();
  const santri = santriRows.find(r => norm(r[0]) === nisn);
  if (!santri) return {ok:false, error:'NISN tidak ditemukan di data Santri'};
  const shA = ss.getSheetByName(SHEET_HALAQOH_ANGGOTA);
  const rows = shA.getDataRange().getValues();
  // Cek apakah santri sudah ada di halaqoh yang SAMA PERSIS (hindari duplikat di halaqoh yg sama)
  // Tapi BOLEH ada di halaqoh yang berbeda (mis: Subuh & Duha)
  for (let i=1;i<rows.length;i++) {
    if (norm(rows[i][0]) === nisn && norm(rows[i][2]) === namaHalaqoh) {
      return {ok:false, error: norm(santri[1])+' sudah terdaftar di halaqoh "'+namaHalaqoh+'"'};
    }
  }
  shA.appendRow([nisn, norm(santri[1]), namaHalaqoh]);
  return {ok:true};
}

function apiPindahSantriHalaqoh(p) {
  // p.nisn, p.halaqohLama, p.halaqohBaru
  const nisn = norm(p.nisn), halaqohBaru = norm(p.halaqohBaru), halaqohLama = norm(p.halaqohLama||'');
  if (!getHalaqohList().some(h=>h.namaHalaqoh===halaqohBaru)) return {ok:false, error:'Halaqoh tujuan belum dibuat'};
  const sh = getAktifSS().getSheetByName(SHEET_HALAQOH_ANGGOTA);
  const rows = sh.getDataRange().getValues();
  // Cari baris yang cocok: NISN sama DAN halaqoh lama cocok (kalau ada)
  for (let i=rows.length-1;i>=1;i--) {
    if (norm(rows[i][0]) !== nisn) continue;
    if (halaqohLama && norm(rows[i][2]) !== halaqohLama) continue;
    sh.getRange(i+1,3).setValue(halaqohBaru);
    return {ok:true};
  }
  return {ok:false, error:'Santri tidak ditemukan di halaqoh yang dimaksud'};
}

function apiHapusSantriDariHalaqoh(p) {
  // p.nisn, p.namaHalaqoh (wajib, supaya tidak hapus dari semua halaqoh sekaligus)
  const nisn = norm(p.nisn), namaHalaqoh = norm(p.namaHalaqoh||'');
  const sh = getAktifSS().getSheetByName(SHEET_HALAQOH_ANGGOTA);
  const rows = sh.getDataRange().getValues();
  for (let i=rows.length-1;i>=1;i--) {
    if (norm(rows[i][0]) !== nisn) continue;
    if (namaHalaqoh && norm(rows[i][2]) !== namaHalaqoh) continue;
    sh.deleteRow(i+1);
    return {ok:true};
  }
  return {ok:false, error:'Santri tidak ditemukan di halaqoh yang dimaksud'};
}

function getSantriBelumPunyaHalaqoh(namaHalaqohTarget) {
  // namaHalaqohTarget: kalau diisi, filter santri yang BELUM ada di halaqoh ini
  // Kalau kosong: santri yang tidak ada di halaqoh MANAPUN
  const ss = getAktifSS();
  const santriRows = ss.getSheetByName(SHEET_SANTRI).getDataRange().getValues(); santriRows.shift();
  const anggotaRows = ss.getSheetByName(SHEET_HALAQOH_ANGGOTA).getDataRange().getValues(); anggotaRows.shift();

  if (namaHalaqohTarget) {
    // Santri yang belum ada di halaqoh TARGET ini
    const sudahDiHalaqohIni = new Set();
    anggotaRows.forEach(r => { if (norm(r[2]) === norm(namaHalaqohTarget)) sudahDiHalaqohIni.add(norm(r[0])); });
    return santriRows.filter(r => !sudahDiHalaqohIni.has(norm(r[0]))).map(r => ({nisn:norm(r[0]), nama:norm(r[1])}));
  } else {
    // Santri yang tidak ada di halaqoh manapun
    const sudahAda = new Set();
    anggotaRows.forEach(r => { if (r[0]) sudahAda.add(norm(r[0])); });
    return santriRows.filter(r => !sudahAda.has(norm(r[0]))).map(r => ({nisn:norm(r[0]), nama:norm(r[1])}));
  }
}

// ============ DEBUG: jalankan dari Apps Script Editor untuk diagnosa ============
// Cara: di Apps Script, pilih fungsi ini lalu klik Run, lalu View > Logs
function debugHalaqohGuru() {
  // GANTI nama di sini sesuai yang bermasalah:
  const namaLogin = 'UST. SOBIRIN LAODE NIPI, S.H';
  const waktuDicari = 'Subuh';

  const sh = getAktifSS().getSheetByName(SHEET_HALAQOH);
  const rows = sh.getDataRange().getValues(); rows.shift();

  Logger.log('=== DEBUG HALAQOH GURU ===');
  Logger.log('Nama login input: [' + namaLogin + ']');
  Logger.log('normNama(login): [' + normNama(namaLogin) + ']');
  Logger.log('Panjang nama login: ' + namaLogin.length);
  Logger.log('Kode karakter nama login: ' + namaLogin.split('').map(c => c.charCodeAt(0)).join(','));
  Logger.log('Waktu dicari: [' + waktuDicari + ']');
  Logger.log('Total baris di sheet Halaqoh: ' + rows.length);
  Logger.log('');

  rows.filter(r => r[0]).forEach(function(r, i) {
    const pengampuRaw = String(r[1]||'');
    const waktuRaw = String(r[2]||'');
    const list = daftarPengampu(pengampuRaw);
    const cocok = pengampuCocok(list, namaLogin);
    const waktuCocok = normNama(waktuRaw) === normNama(waktuDicari);

    // Tampilkan SEMUA halaqoh, bukan hanya yang cocok
    Logger.log('--- Halaqoh [' + r[0] + ']');
    Logger.log('  Pengampu RAW  : [' + pengampuRaw + ']');
    Logger.log('  Pengampu kode : ' + pengampuRaw.split('').map(c => c.charCodeAt(0)).join(','));
    Logger.log('  normNama      : [' + normNama(pengampuRaw) + ']');
    Logger.log('  Waktu RAW     : [' + waktuRaw + ']');
    Logger.log('  Pengampu cocok: ' + cocok + ' | Waktu cocok: ' + waktuCocok);
    if (cocok && waktuCocok) Logger.log('  >>> INI YANG HARUS MUNCUL <<<');
  });

  Logger.log('');
  Logger.log('=== HASIL getSantriHalaqohGuru ===');
  const semua = getSantriHalaqohGuru(namaLogin);
  Logger.log('Halaqoh ditemukan: ' + semua.length);
  semua.forEach(h => Logger.log('  - [' + h.namaHalaqoh + '] waktu=' + h.waktu));
}

function getHalaqohGuru(pengampu, waktu) {
  pengampu = norm(pengampu); waktu = norm(waktu);
  const tz = Session.getScriptTimeZone();
  const hariIniTanggal = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  const penggantianHariIni = getDaftarPenggantian().filter(function(x){
    return x.tanggal === hariIniTanggal && x.jenisSesi === 'Halaqoh' && normNama(x.waktu) === normNama(waktu);
  });
  const sudahDigantikan = {};
  penggantianHariIni.forEach(function(x){ sudahDigantikan[normNama(x.halaqoh)+'|'+normNamaGuru_(x.guruAsli)] = true; });

  const daftarSendiri = getHalaqohList().filter(function(h){
    if (!pengampuCocok(h.pengampuList, pengampu) || normNama(h.waktu) !== normNama(waktu)) return false;
    return !sudahDigantikan[normNama(h.namaHalaqoh)+'|'+normNamaGuru_(pengampu)];
  }).map(function(h){ return Object.assign({}, h, {pengganti:false}); });

  const daftarPengganti = penggantianHariIni.filter(function(x){ return samaGuru_(x.guruPengganti, pengampu); })
    .map(function(x){
      const asli = getHalaqohList().find(function(h){ return h.namaHalaqoh === x.halaqoh; });
      return { namaHalaqoh: x.halaqoh, pengampu: pengampu, waktu: waktu, gender: asli ? asli.gender : '', pengganti:true, guruAsli: x.guruAsli };
    });

  const hasil = daftarSendiri.concat(daftarPengganti);
  // Tandai halaqoh yang sesi hari ini sudah diisi -- supaya pengampu utama & pengganti
  // langsung tahu siapa yang sudah mengisi, sebelum membuka formnya.
  try {
    const shH = getAktifSS().getSheetByName(SHEET_HAFALAN);
    if (shH && shH.getLastRow() > 1 && hasil.length) {
      const pengisi = {};
      bacaBarisPadaTanggal_(shH, hariIniTanggal).slice(1).forEach(function(r){
        if (tglKunciCatatan_(r[0], tz) !== hariIniTanggal || waktuKunciCatatan_(r[1], tz) !== waktuKunciCatatan_(waktu, tz)) return;
        const k = normNama(norm(r[2]));
        if (!pengisi[k] && norm(r[3])) pengisi[k] = norm(r[3]);
      });
      hasil.forEach(function(h){
        const o = pengisi[normNama(h.namaHalaqoh)];
        if (o) { h.sudahDiisiOleh = o; h.diisiSendiri = samaGuru_(o, pengampu); }
      });
    }
  } catch (e) {}
  hasil.forEach(function(h){
    if (!h.pengganti && h.pengampuList && h.pengampuList.length > 1) {
      h.peranSaya = samaGuru_(h.pengampuList[0], pengampu) ? 'utama' : 'pengganti';
      h.pengampuUtama = h.pengampuList[0];
    }
  });
  return hasil;
}

// ============ HAFALAN ============
function apiGetSantriUntukHafalan(namaHalaqoh, waktu, tanggal, pengampuDiminta) {
  namaHalaqoh = norm(namaHalaqoh);
  if (!namaHalaqoh) return {ok:false, error:'Halaqoh tidak valid'};
  const ss = getAktifSS();
  const shAnggota = ss.getSheetByName(SHEET_HALAQOH_ANGGOTA);
  if (!shAnggota) return {ok:false, error:'Sheet HalaqohAnggota belum ada. Jalankan Migrasi Skema di menu Admin.'};
  const anggotaRows = nilaiCatatanUnik_(shAnggota); anggotaRows.shift();
  const anggota = anggotaRows.filter(r => r[0] && norm(r[2]) === namaHalaqoh);
  if (!anggota.length) return {ok:true, data: [], peringatan: 'Belum ada santri di halaqoh "'+namaHalaqoh+'". Minta Admin menambahkan di menu Kelola Halaqoh.'};

  const hafalanRows = nilaiCatatanUnik_(ss.getSheetByName(SHEET_HAFALAN)); hafalanRows.shift();
  const tz = Session.getScriptTimeZone();

  // KUNCI SESI: kalau halaqoh ini punya lebih dari satu pengampu, dan sesi (tanggal+
  // waktu+halaqoh) INI SAJA sudah diisi oleh pengampu LAIN, tolak akses supaya tidak
  // ada dua pengampu mencatat data yang sama/berbeda untuk santri yang sama di sesi
  // yang sama (mencegah data ganda/bentrok).
  if (tanggal && waktu) {
    for (let i=0;i<hafalanRows.length;i++) {
      const r = hafalanRows[i];
      const tglStr = tglKunciCatatan_(r[0], tz) || (function(){ const d = new Date(r[0]); return isNaN(d) ? '' : Utilities.formatDate(d, tz, 'yyyy-MM-dd'); })();
      if (tglStr === tanggal && norm(r[1]) === norm(waktu) && norm(r[2]) === namaHalaqoh) {
        const pengampuSudahIsi = norm(r[3]);
        // Dicocokkan dengan normalisasi supaya penulisan nama yang sedikit berbeda
        // tidak membuat pengampu sendiri terkunci dari sesinya.
        if (pengampuSudahIsi && !samaGuru_(pengampuSudahIsi, pengampuDiminta)) {
          return {ok:false, sudahDiisiOleh: pengampuSudahIsi, error:'Halaqoh "'+namaHalaqoh+'" sesi '+waktu+' tanggal '+tanggal+' SUDAH DIISI oleh '+pengampuSudahIsi+'. Anda tidak bisa mengisi lagi pada sesi ini (mencegah data ganda). Kalau ada kesalahan pencatatan, minta '+pengampuSudahIsi+' membetulkannya lewat menu Riwayat Hafalan > Edit.'};
        }
        break;
      }
    }
  }

  // Riwayat terakhir dipisah PER JENIS HAFALAN (Sabaq, Sabqi, Manzil, Murojaah), karena
  // posisi setoran tiap jenis biasanya berbeda-beda -- supaya saat pengampu ganti jenis
  // hafalan di form, isian otomatis terisi sesuai riwayat jenis itu, bukan riwayat jenis lain.
  const terakhirMap = {}; // nisn -> { JenisHafalan: {tanggal,surah,ayat,juz,halamanKe,nilai} }
  hafalanRows.forEach(r => {
    const nisn = norm(r[4]);
    const jenis = norm(r[6]);
    if (JENIS_HAFALAN_SETOR.indexOf(jenis) === -1) return; // hanya jenis setor yang relevan diingat
    const tglObj = new Date(r[0]);
    if (!terakhirMap[nisn]) terakhirMap[nisn] = {};
    const existing = terakhirMap[nisn][jenis];
    if (!existing || tglObj > existing._tglObj) {
      terakhirMap[nisn][jenis] = { _tglObj: tglObj, tanggal: Utilities.formatDate(tglObj,tz,'yyyy-MM-dd'),
        surah:r[7], ayat:r[8], juz:r[9], halamanKe:r[10], nilai:r[11] };
    }
  });
  const data = anggota.map(r => {
    const nisn = norm(r[0]);
    const perJenis = terakhirMap[nisn] || {};
    const bersih = {};
    Object.keys(perJenis).forEach(j => {
      const t = perJenis[j];
      bersih[j] = {tanggal:t.tanggal, surah:t.surah, ayat:t.ayat, juz:t.juz, halamanKe:t.halamanKe, nilai:t.nilai};
    });
    return { nisn:nisn, nama:norm(r[1]), terakhirPerJenis: bersih };
  });
  return {ok:true, data: data};
}

function apiSubmitHafalan(p) {
  if (!p || !p.items || !p.items.length) return {ok:false, error:'Tidak ada data santri untuk disimpan'};
  return denganKunciCatatan_(function(){ return simpanHafalan_(p); });
}

function simpanHafalan_(p) {
  const sh = getAktifSS().getSheetByName(SHEET_HAFALAN);
  const tanggal = p.tanggal || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const _galatTgl = tolakTanggalMasaDepan(tanggal);
  if (_galatTgl) return {ok:false, error:_galatTgl};
  // Nilai setoran: kosong atau 1-100 -- diperiksa sebelum apa pun ditulis
  for (let q = 0; q < p.items.length; q++) {
    const galatN = galatNilaiHafalan_(p.items[q].nilai, p.items[q].nama);
    if (galatN) return {ok:false, error: galatN};
  }
  const existing = bacaBarisPadaTanggal_(sh, tanggal);

  // Sesi yang sudah dialihkan ke guru pengganti tidak bisa diisi guru aslinya.
  const penggantiHalaqoh = sesiDialihkanKePengganti_({tanggal: tanggal, jenis: 'Halaqoh',
    halaqoh: p.halaqoh, waktu: p.waktu, pengampu: p.pengampu});
  if (penggantiHalaqoh) {
    return {ok:false, error:'Halaqoh ' + norm(p.halaqoh) + ' (' + norm(p.waktu) + ') pada ' + tanggal +
      ' sudah dialihkan ke ' + penggantiHalaqoh + ', jadi tidak bisa Anda isi. ' +
      'Bila penggantian ini keliru, minta Admin membatalkannya di menu Penggantian Guru.'};
  }

  // Satu santri = satu catatan per sesi (tanggal + waktu + halaqoh). Bila dulu sempat
  // tercatat ganda, SEMUA barisnya diperbarui dengan isian terbaru.
  const tzH = Session.getScriptTimeZone();
  const waktuKunci = waktuKunciCatatan_(p.waktu, tzH);
  const indexBaris = {};
  let pemilikSesiHafalan = '';
  for (let i=1;i<existing.length;i++) {
    const r = existing[i];
    if (tglKunciCatatan_(r[0], tzH) === tanggal && waktuKunciCatatan_(r[1], tzH) === waktuKunci &&
        normNama(norm(r[2])) === normNama(norm(p.halaqoh))) {
      const k = norm(r[4]);
      (indexBaris[k] = indexBaris[k] || []).push(i+1);
      if (!pemilikSesiHafalan && norm(r[3])) pemilikSesiHafalan = norm(r[3]);
    }
  }
  // Pelengkap kunci sesi yang sudah ada saat membuka form: menutup celah bila form
  // sudah terbuka lebih dulu lalu pengampu lain menyimpan duluan.
  if (pemilikSesiHafalan && !samaGuru_(pemilikSesiHafalan, p.pengampu)) {
    return {ok:false, sudahDiisiOleh: pemilikSesiHafalan, error:'Halaqoh ' + norm(p.halaqoh) + ' sesi ' + norm(p.waktu) + ' tanggal ' + tanggal +
      ' SUDAH DIISI oleh ' + pemilikSesiHafalan + '. Anda tidak bisa mengisi lagi pada sesi ini (mencegah data ganda). ' +
      'Bila ada kesalahan pencatatan, minta ' + pemilikSesiHafalan + ' membetulkannya lewat menu Riwayat Hafalan > Edit.'};
  }

  const rowsToAdd = [];
  let diupdate = 0;
  (p.items||[]).forEach(function(it){
    const daftarBaris = indexBaris[norm(it.nisn)];
    if (daftarBaris && daftarBaris.length) {
      const kini = new Date();
      daftarBaris.forEach(function(rowIdx){
        sh.getRange(rowIdx,7,1,7).setValues([[it.jenisHafalan, it.surah||'', it.ayat||'', it.juz||'', it.halamanKe||'', it.nilai||'', kini]]);
      });
      diupdate++;
    } else {
      rowsToAdd.push([tanggal, p.waktu, p.halaqoh, p.pengampu, it.nisn, it.nama, it.jenisHafalan, it.surah||'', it.ayat||'', it.juz||'', it.halamanKe||'', it.nilai||'', new Date()]);
    }
  });
  if (rowsToAdd.length) sh.getRange(sh.getLastRow()+1,1,rowsToAdd.length,13).setValues(rowsToAdd);
  return {ok:true, ditambah: rowsToAdd.length, diupdate: diupdate};
}

function getRiwayatHafalan(p) {
  const sh = getSSTarget(p.tahunAjaranId).getSheetByName(SHEET_HAFALAN);
  if (!sh) return [];
  const rows = nilaiCatatanUnik_(sh); rows.shift();
  const tz = Session.getScriptTimeZone();
  // Kolom sheet Hafalan (0-based): Tanggal,Waktu,Halaqoh,Pengampu,NISN,Nama,JenisHafalan,Surah,Ayat,Juz,HalamanKe,Nilai,WaktuInput
  return rows.map((r,idx) => ({
      rowIndex: r._baris || (idx+2),
      tanggal: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : norm(r[0]),
      waktu:formatWaktu(r[1],tz), halaqoh:norm(r[2]), pengampu:norm(r[3]),
      nisn:norm(r[4]), nama:norm(r[5]),
      jenis:norm(r[6]), surah:norm(r[7]), ayat:norm(r[8]),
      juz:r[9], halamanKe:norm(r[10]), nilai:r[11]
    }))
    .filter(r => r.tanggal && r.tanggal !== 'NaN-aN-aN')
    .filter(r => (!p.pengampu || normNama(r.pengampu) === normNama(p.pengampu)))
    .filter(r => (!p.halaqoh || normNama(r.halaqoh) === normNama(p.halaqoh)))
    .filter(r => (!p.nisn || String(r.nisn) === String(p.nisn)))
    .filter(r => (!p.tanggalMulai || r.tanggal >= p.tanggalMulai))
    .filter(r => (!p.tanggalAkhir || r.tanggal <= p.tanggalAkhir))
    .sort((a,b) => b.tanggal.localeCompare(a.tanggal));
}

// ======================================================================
// RIWAYAT CATATAN ABSENSI SATU SANTRI (per tanggal, seperti Riwayat Catatan Hafalan)
// jenis: 'semua' | 'harian' (asrama) | 'mapel' | 'halaqoh'
//
// - Absen harian : sheet AbsensiHarian, satu baris per sesi.
// - Mata pelajaran: sheet Absensi. Beberapa jam ke- dengan status sama di hari yang sama
//                  digabung satu baris ("jam ke-1 & 2"), supaya tidak berulang-ulang.
// - Halaqoh      : dari catatan hafalan (Sabaq/Murojaah/... & Tidak Setor = hadir,
//                  Izin/Sakit/Ghaib/Izin Pulang sesuai keterangan), ditambah absensi
//                  halaqoh yang dicatat terpisah bila di sesi itu tidak ada catatan hafalan.
// ======================================================================
function apiGetRiwayatAbsensiSantri(p) {
  const nisn = norm(p.nisn);
  if (!nisn) return {ok:false, error:'NISN wajib diisi.'};
  const jenis = norm(p.jenis) || 'semua';
  const mulai = norm(p.tanggalMulai), akhir = norm(p.tanggalAkhir);
  const ss = getSSTarget(p.tahunAjaranId);
  const tz = Session.getScriptTimeZone();
  const tgl = function(v){ return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : norm(v).slice(0,10); };
  const dalamRentang = function(t){ return t && (!mulai || t >= mulai) && (!akhir || t <= akhir); };
  const data = [];

  if (jenis === 'semua' || jenis === 'harian') {
    const sh = ss.getSheetByName(SHEET_ABSENSI_HARIAN);
    if (sh && sh.getLastRow() > 1) nilaiCatatanUnik_(sh).slice(1).forEach(function(r){
      if (norm(r[2]) !== nisn) return;
      const t = tgl(r[0]); if (!dalamRentang(t)) return;
      data.push({tanggal:t, sumber:'harian', status: norm(r[5]) || '-',
        kegiatan: 'Asrama' + (norm(r[1]) ? ' · Sesi ' + norm(r[1]) : ''), ket: norm(r[6]), oleh: norm(r[7]), urut: 1});
    });
  }

  // Sheet Absensi memuat absensi mapel DAN absensi halaqoh (kolom TipeAbsen = 'Halaqoh')
  const shAbs = ss.getSheetByName(SHEET_ABSENSI);
  const rowsAbs = (shAbs && shAbs.getLastRow() > 1) ? nilaiCatatanUnik_(shAbs).slice(1) : [];

  if (jenis === 'semua' || jenis === 'mapel') {
    const grup = {};
    rowsAbs.forEach(function(r){
      if (norm(r[6]) !== nisn || norm(r[16]) === 'Halaqoh') return;
      const t = tgl(r[0]); if (!dalamRentang(t)) return;
      const k = t + '|' + norm(r[3]) + '|' + norm(r[4]) + '|' + norm(r[8]);
      if (!grup[k]) grup[k] = {tanggal:t, sumber:'mapel', status: norm(r[8]) || '-', mapel: norm(r[3]), kelas: norm(r[4]),
        jam: [], ket: norm(r[9]), oleh: norm(r[5]), urut: 2};
      if (norm(r[2]) && grup[k].jam.indexOf(norm(r[2])) === -1) grup[k].jam.push(norm(r[2]));
      if (!grup[k].ket && norm(r[9])) grup[k].ket = norm(r[9]);
    });
    Object.keys(grup).forEach(function(k){
      const g = grup[k];
      g.jam.sort(function(a,b){ return Number(a) - Number(b); });
      g.kegiatan = g.mapel + (g.kelas ? ' (' + g.kelas + ')' : '') + (g.jam.length ? ' · Jam ke-' + g.jam.join(' & ') : '');
      delete g.jam; delete g.mapel; delete g.kelas;
      data.push(g);
    });
  }

  if (jenis === 'semua' || jenis === 'halaqoh') {
    const sudahAda = {};
    const shH = ss.getSheetByName(SHEET_HAFALAN);
    if (shH && shH.getLastRow() > 1) nilaiCatatanUnik_(shH).slice(1).forEach(function(r){
      if (norm(r[4]) !== nisn) return;
      const t = tgl(r[0]); if (!dalamRentang(t)) return;
      const jh = norm(r[6]);
      const hadir = JENIS_HAFALAN_SETOR.indexOf(jh) !== -1 || jh === 'Tidak Setor';
      const waktu = formatWaktu(r[1], tz);
      sudahAda[t + '|' + normNama(r[2]) + '|' + normNama(waktu)] = true;
      data.push({tanggal:t, sumber:'halaqoh', status: hadir ? 'Hadir' : (jh || '-'),
        kegiatan: 'Halaqoh ' + norm(r[2]) + (waktu ? ' · ' + waktu : ''),
        ket: hadir ? jh : '', oleh: norm(r[3]), urut: 3});
    });
    rowsAbs.forEach(function(r){
      if (norm(r[6]) !== nisn || norm(r[16]) !== 'Halaqoh') return;
      const t = tgl(r[0]); if (!dalamRentang(t)) return;
      const waktu = norm(r[17]);
      if (sudahAda[t + '|' + normNama(r[3]) + '|' + normNama(waktu)]) return; // sudah terwakili catatan hafalan
      data.push({tanggal:t, sumber:'halaqoh', status: norm(r[8]) || '-',
        kegiatan: 'Halaqoh ' + norm(r[3]) + (waktu ? ' · ' + waktu : ''), ket: norm(r[9]), oleh: norm(r[5]), urut: 3});
    });
  }

  data.sort(function(a,b){ return b.tanggal.localeCompare(a.tanggal) || a.urut - b.urut; });
  // Ringkasan: Ghaib dihitung bersama Alpa (sama-sama tanpa keterangan)
  const ringkas = {Hadir:0, Sakit:0, Izin:0, 'Izin Pulang':0, Alpa:0};
  data.forEach(function(x){
    const st = x.status === 'Ghaib' ? 'Alpa' : x.status;
    if (ringkas[st] !== undefined) ringkas[st]++;
  });
  return {ok:true, data: data.slice(0, 600), ringkas: ringkas, total: data.length};
}

// Nilai setoran hafalan: kosong, atau bilangan bulat 1-100 (dulu hanya 10,20,...,100 dari
// daftar pilihan). Mengembalikan pesan galat, atau '' bila sah.
function galatNilaiHafalan_(nilai, nama) {
  const v = String(nilai == null ? '' : nilai).trim();
  if (v === '') return '';
  if (!/^\d{1,3}$/.test(v) || Number(v) < 1 || Number(v) > 100) return 'Nilai hafalan' + (nama ? ' untuk ' + nama : '') + ' harus angka bulat 1 sampai 100 (tertulis: "' + v + '").';
  return '';
}

function apiUpdateHafalan(p) {
  const galatN = galatNilaiHafalan_(p.nilai, '');
  if (galatN) return {ok:false, error: galatN};
  const sh = getAktifSS().getSheetByName(SHEET_HAFALAN);
  sh.getRange(p.rowIndex,7,1,7).setValues([[p.jenisHafalan, p.surah||'', p.ayat||'', p.juz||'', p.halamanKe||'', p.nilai||'', new Date()]]);
  return {ok:true};
}

function apiDeleteHafalan(p) {
  const sh = getAktifSS().getSheetByName(SHEET_HAFALAN);
  const rowIdx = Number(p.rowIndex);
  if (!sh || !rowIdx || rowIdx < 2) return {ok:false, error:'Baris tidak valid.'};
  // Ikut hapus salinan lama sesi yang sama (bila dulu tercatat ganda) supaya catatan
  // lama tidak "muncul kembali" setelah catatan terbarunya dihapus.
  return denganKunciCatatan_(function(){
    if (rowIdx > sh.getLastRow()) return {ok:false, error:'Baris tidak ditemukan (mungkin sudah dihapus).'};
    let daftar = [rowIdx];
    const semuaBaris = sh.getDataRange().getValues();
      // Pengaman: baris yang dimaksud harus masih milik santri yang sama (data bisa bergeser
      // bila ada yang menghapus baris lain sejak riwayat dibuka).
      if (p.nisn && norm((semuaBaris[rowIdx-1]||[])[4]) !== norm(p.nisn)) {
        return {ok:false, error:'Data sudah berubah sejak halaman dibuka. Muat ulang riwayat lalu coba lagi.'};
      }
      try { daftar = barisSesiSama_(semuaBaris, SHEET_HAFALAN, rowIdx); } catch (e) {}
    daftar.sort(function(a,b){ return b-a; }).forEach(function(b){ sh.deleteRow(b); });
    return {ok:true, terhapus: daftar.length};
  });
}

// ======================================================================
// PINDAH SESI HAFALAN (salah pilih waktu/tanggal saat mengisi)
// Contoh: guru mengisi setoran Duha tetapi terpilih "Subuh". Seluruh catatan sesi itu
// (semua santri) dipindah ke waktu/tanggal yang benar -- isinya tidak diubah, tidak
// perlu hapus lalu isi ulang. Absensi halaqoh yang dicatat guru yang sama untuk sesi
// itu ikut dipindah supaya tetap serasi.
// Pengaman:
//  - hanya pengampu yang mengisi sesi itu (atau Admin/Mudir) yang boleh memindah;
//  - guru hanya bisa memindah sesi BATAS_HARI_PINDAH_SESI hari terakhir (Admin/Mudir bebas);
//  - tanggal tujuan tidak boleh di masa depan;
//  - sesi tujuan yang sudah diisi guru lain, atau sudah dialihkan ke guru pengganti, ditolak;
//  - santri yang sudah punya catatan di sesi tujuan -> ditolak (supaya tidak ada yang tertimpa);
//  - setiap pemindahan dicatat di sheet RiwayatPindahSesi (bisa dilihat Admin/Mudir).
// ======================================================================
const BATAS_HARI_PINDAH_SESI = 7;
const SHEET_RIWAYAT_PINDAH_SESI = 'RiwayatPindahSesi';

function apiPindahSesiHafalan(p) {
  p = p || {};
  const oleh = norm(p.oleh);
  const halaqoh = norm(p.halaqoh);
  const tanggal = norm(p.tanggal), waktu = norm(p.waktu);
  const tanggalBaru = norm(p.tanggalBaru) || tanggal, waktuBaru = norm(p.waktuBaru) || waktu;
  if (!oleh) return {ok:false, error:'Sesi login tidak dikenali. Silakan masuk ulang.'};
  if (!halaqoh || !tanggal || !waktu) return {ok:false, error:'Sesi asal tidak lengkap.'};
  if (!waktuBaru) return {ok:false, error:'Pilih waktu tujuan.'};
  const galatTgl = tolakTanggalMasaDepan(tanggalBaru);
  if (galatTgl) return {ok:false, error: galatTgl};
  const tz = Session.getScriptTimeZone();
  if (tanggalBaru === tanggal && waktuKunciCatatan_(waktuBaru, tz) === waktuKunciCatatan_(waktu, tz)) {
    return {ok:false, error:'Waktu dan tanggal tujuan sama dengan sesi asal.'};
  }
  const istimewa = adminAtauMudir(oleh);
  if (!istimewa) {
    const hariIni = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const q = tanggal.split('-').map(Number), h = hariIni.split('-').map(Number);
    const selisih = Math.round((Date.UTC(h[0],h[1]-1,h[2]) - Date.UTC(q[0],q[1]-1,q[2])) / 86400000);
    if (selisih > BATAS_HARI_PINDAH_SESI) {
      return {ok:false, error:'Sesi ini sudah lebih dari ' + BATAS_HARI_PINDAH_SESI + ' hari. Minta Admin/Mudir untuk memindahkannya.'};
    }
  }

  return denganKunciCatatan_(function(){
    const ss = getAktifSS();
    const shH = ss.getSheetByName(SHEET_HAFALAN);
    if (!shH) return {ok:false, error:'Sheet Hafalan tidak ditemukan.'};
    const nilaiH = shH.getDataRange().getValues();
    const samaSesi = function(r, tgl, wkt){
      return tglKunciCatatan_(r[0], tz) === tgl && waktuKunciCatatan_(r[1], tz) === waktuKunciCatatan_(wkt, tz) &&
        normNama(norm(r[2])) === normNama(halaqoh);
    };
    const asal = [], tujuanNisn = {};
    let pemilikTujuan = '';
    for (let i = 1; i < nilaiH.length; i++) {
      const r = nilaiH[i];
      if (samaSesi(r, tanggal, waktu)) asal.push(i + 1);
      else if (samaSesi(r, tanggalBaru, waktuBaru)) {
        tujuanNisn[norm(r[4])] = norm(r[5]);
        if (!pemilikTujuan && norm(r[3])) pemilikTujuan = norm(r[3]);
      }
    }
    if (!asal.length) return {ok:false, error:'Catatan sesi asal tidak ditemukan (mungkin sudah dipindah atau dihapus). Muat ulang riwayat.'};

    const pengampuAsal = norm(nilaiH[asal[0] - 1][3]);
    if (!istimewa && asal.some(function(b){ return !samaGuru_(nilaiH[b - 1][3], oleh); })) {
      return {ok:false, error:'Sesi ini diisi oleh ' + pengampuAsal + '. Hanya pengisinya atau Admin/Mudir yang boleh memindahkannya.'};
    }
    if (pemilikTujuan && !samaGuru_(pemilikTujuan, pengampuAsal)) {
      return {ok:false, error:'Sesi ' + waktuBaru + ' tanggal ' + tanggalBaru + ' untuk halaqoh ' + halaqoh +
        ' sudah diisi oleh ' + pemilikTujuan + ', jadi tidak bisa dipindah ke sana.'};
    }
    const dialihkan = sesiDialihkanKePengganti_({tanggal: tanggalBaru, jenis: 'Halaqoh', halaqoh: halaqoh, waktu: waktuBaru, pengampu: pengampuAsal});
    if (dialihkan) {
      return {ok:false, error:'Sesi ' + waktuBaru + ' tanggal ' + tanggalBaru + ' sudah dialihkan ke ' + dialihkan + '.'};
    }
    const bentrok = [];
    asal.forEach(function(b){ const n = norm(nilaiH[b - 1][4]); if (tujuanNisn[n] !== undefined) bentrok.push(norm(nilaiH[b - 1][5]) || n); });
    if (bentrok.length) {
      return {ok:false, error:'Santri berikut sudah punya catatan di sesi ' + waktuBaru + ' tanggal ' + tanggalBaru + ': ' +
        bentrok.slice(0, 8).join(', ') + (bentrok.length > 8 ? ' dan ' + (bentrok.length - 8) + ' lainnya' : '') +
        '. Periksa/hapus catatan ganda itu dulu, lalu ulangi pemindahan.'};
    }

    // Absensi halaqoh sesi yang sama yang dicatat pengampu ini ikut dipindah
    const shA = ss.getSheetByName(SHEET_ABSENSI);
    const asalAbs = [];
    if (shA && shA.getLastRow() > 1) {
      const nilaiA = shA.getDataRange().getValues();
      const tujuanAbs = {};
      for (let i = 1; i < nilaiA.length; i++) {
        const r = nilaiA[i];
        if (norm(r[16]) !== 'Halaqoh' || normNama(norm(r[3])) !== normNama(halaqoh)) continue;
        const tgl = tglKunciCatatan_(r[0], tz), w = waktuKunciCatatan_(r[17], tz);
        if (tgl === tanggal && w === waktuKunciCatatan_(waktu, tz) && samaGuru_(r[5], pengampuAsal)) asalAbs.push(i + 1);
        else if (tgl === tanggalBaru && w === waktuKunciCatatan_(waktuBaru, tz)) tujuanAbs[norm(r[6])] = true;
      }
      // Bila absensi di sesi tujuan sudah ada untuk santri yang sama, absensinya tidak
      // dipindah (dibiarkan di tempat) supaya tidak menimpa -- hafalannya tetap dipindah.
      for (let k = asalAbs.length - 1; k >= 0; k--) {
        if (tujuanAbs[norm(nilaiA[asalAbs[k] - 1][6])]) asalAbs.splice(k, 1);
      }
      const hariBaru = (function(){ const q = tanggalBaru.split('-').map(Number); return HARI_LIST[new Date(q[0], q[1]-1, q[2]).getDay()]; })();
      asalAbs.forEach(function(b){
        shA.getRange(b, 1, 1, 2).setValues([[tanggalBaru, hariBaru]]);
        shA.getRange(b, 18).setValue(waktuBaru);
      });
    }

    asal.forEach(function(b){ shH.getRange(b, 1, 1, 2).setValues([[tanggalBaru, waktuBaru]]); });

    try {
      let log = ss.getSheetByName(SHEET_RIWAYAT_PINDAH_SESI);
      if (!log) {
        log = ss.insertSheet(SHEET_RIWAYAT_PINDAH_SESI);
        log.appendRow(['Waktu', 'Oleh', 'Halaqoh', 'Pengampu', 'Dari Tanggal', 'Dari Waktu', 'Ke Tanggal', 'Ke Waktu', 'Jumlah Hafalan', 'Jumlah Absensi']);
        log.setFrozenRows(1);
      }
      log.appendRow([Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'), oleh, halaqoh, pengampuAsal,
        tanggal, waktu, tanggalBaru, waktuBaru, asal.length, asalAbs.length]);
    } catch (e) { Logger.log('Log pindah sesi gagal: ' + e.message); }

    return {ok:true, dipindah: asal.length, absensiDipindah: asalAbs.length,
      pesan: asal.length + ' catatan hafalan' + (asalAbs.length ? ' dan ' + asalAbs.length + ' absensi halaqoh' : '') +
        ' dipindah ke ' + waktuBaru + ', ' + tanggalBaru + '.'};
  });
}

function apiGetRiwayatPindahSesi(p) {
  if (!adminAtauMudir(norm(p && p.oleh))) return {ok:false, error:'Hanya Admin/Mudir.'};
  const sh = getAktifSS().getSheetByName(SHEET_RIWAYAT_PINDAH_SESI);
  if (!sh || sh.getLastRow() < 2) return {ok:true, data: []};
  const tz = Session.getScriptTimeZone();
  const t = function(v){ return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : norm(v); };
  const data = sh.getDataRange().getValues().slice(1).map(function(r){
    return {waktu: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd HH:mm') : norm(r[0]), oleh: norm(r[1]), halaqoh: norm(r[2]), pengampu: norm(r[3]),
      dariTanggal: t(r[4]), dariWaktu: norm(r[5]), keTanggal: t(r[6]), keWaktu: norm(r[7]), jumlah: Number(r[8]) || 0, jumlahAbsensi: Number(r[9]) || 0};
  }).reverse().slice(0, 200);
  return {ok:true, data: data};
}

// Halaman Ke bisa berisi rentang teks "dari - sampai" (contoh: "1 - 3") kalau santri
// menyetorkan beberapa halaman sekaligus. Untuk perhitungan progres, yang dipakai
// adalah angka TERAKHIR/TERJAUH dari rentang tersebut (halaman terjauh yang dicapai).
function parseHalamanAkhir(raw) {
  raw = String(raw==null?'':raw).trim();
  if (!raw) return null;
  const parts = raw.split('-').map(s => s.trim());
  const n = Number(parts[parts.length-1]);
  return isNaN(n) ? null : n;
}

// Sama seperti parseHalamanAkhir tapi mengembalikan awal & akhir sekaligus (dipakai
// untuk menghitung jumlah halaman yang disetor pada satu tanggal, untuk grafik).
function parseRangeAwalAkhir(raw) {
  raw = String(raw==null?'':raw).trim();
  if (!raw) return {awal:null, akhir:null};
  const parts = raw.split('-').map(s => s.trim());
  if (parts.length >= 2) {
    const a = Number(parts[0]), b = Number(parts[parts.length-1]);
    return {awal: isNaN(a)?null:a, akhir: isNaN(b)?null:b};
  }
  const a = Number(parts[0]);
  return {awal: isNaN(a)?null:a, akhir: isNaN(a)?null:a};
}

function getRekapHafalanSantri(nisn, tahunAjaranId) {
  nisn = norm(nisn);
  const sh = getSSTarget(tahunAjaranId).getSheetByName(SHEET_HAFALAN);
  const rows = nilaiCatatanUnik_(sh); rows.shift();
  const tz = Session.getScriptTimeZone();
  const riwayat = rows.filter(r=>norm(r[4])===nisn).map(r=>({
      tanggal: Utilities.formatDate(new Date(r[0]),tz,'yyyy-MM-dd'), waktu:formatWaktu(r[1],tz), halaqoh:norm(r[2]), pengampu:norm(r[3]),
      jenis:norm(r[6]), surah:norm(r[7]), ayat:r[8], juz:r[9], halamanKe:r[10], nilai:r[11]
    })).sort((a,b)=> b.tanggal.localeCompare(a.tanggal));

  const progressPerJuz = {};
  riwayat.forEach(r => {
    if (r.jenis !== 'Sabaq') return;
    const j = Number(r.juz), h = parseHalamanAkhir(r.halamanKe);
    if (!j || h == null) return;
    if (!progressPerJuz[j] || h > progressPerJuz[j]) progressPerJuz[j] = h;
  });
  const juzSelesai = [], juzProses = [];
  Object.keys(progressPerJuz).forEach(function(j){
    const batas = Number(j) === 30 ? 22 : 20;
    if (progressPerJuz[j] >= batas) juzSelesai.push(Number(j));
    else juzProses.push({juz:Number(j), halamanTerakhir: progressPerJuz[j], batas: batas});
  });
  juzSelesai.sort((a,b)=>a-b);
  juzProses.sort((a,b)=>a.juz-b.juz);
  const nilaiValid = riwayat.filter(r => r.nilai !== '' && r.nilai != null && !isNaN(Number(r.nilai)));
  const rataNilaiHafalan = nilaiValid.length ? Math.round((nilaiValid.reduce((a,r)=>a+Number(r.nilai),0)/nilaiValid.length)*100)/100 : null;
  return { totalJuzSelesai: juzSelesai.length, juzSelesai: juzSelesai, juzSedangProses: juzProses, riwayat: riwayat, rataNilaiHafalan: rataNilaiHafalan };
}

// Data untuk grafik perkembangan hafalan: jumlah halaman baru per tanggal (dari setoran
// jenis "Sabaq" dalam rentang tanggal yang dipilih) + akumulasinya. Dipakai frontend
// untuk menggambar grafik garis "perkembangan hafalan" per semester/tahun ajaran.
function getGrafikHafalanSantri(nisn, tanggalMulai, tanggalAkhir, tahunAjaranId) {
  const rows = getRiwayatHafalan({nisn:nisn, tanggalMulai:tanggalMulai, tanggalAkhir:tanggalAkhir, tahunAjaranId:tahunAjaranId})
    .filter(r => r.jenis === 'Sabaq');
  rows.sort((a,b)=> a.tanggal.localeCompare(b.tanggal));
  const perTanggal = {};
  rows.forEach(r => {
    const range = parseRangeAwalAkhir(r.halamanKe);
    const jumlahHalaman = (range.awal!=null && range.akhir!=null) ? Math.max(1, range.akhir - range.awal + 1) : 1;
    perTanggal[r.tanggal] = (perTanggal[r.tanggal] || 0) + jumlahHalaman;
  });
  const tanggalList = Object.keys(perTanggal).sort();
  let kumulatif = 0;
  return tanggalList.map(t => { kumulatif += perTanggal[t]; return {tanggal:t, halamanHariItu: perTanggal[t], kumulatif: kumulatif}; });
}

// ============ SANTRI: tambah manual, import massal, export ============
// Helper generik: ganti NISN (dan opsional Nama) di sheet manapun yang barisnya cocok
// dengan NISN lama. Dipakai supaya SEMUA riwayat lama (Absensi/Hafalan/Nilai/dst) tetap
// terhubung ke santri yang benar walau NISN atau namanya diubah belakangan.
function gantiReferensiSantri(sh, kolIdxNisn, kolIdxNama, nisnLama, nisnBaru, namaBaru) {
  if (!sh) return;
  const rows = sh.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) {
    if (norm(rows[i][kolIdxNisn]) === nisnLama) {
      sh.getRange(i+1, kolIdxNisn+1).setValue(nisnBaru);
      if (kolIdxNama != null && namaBaru) sh.getRange(i+1, kolIdxNama+1).setValue(namaBaru);
    }
  }
}

// Mengubah NISN dan/atau Nama seorang santri. SEMUA referensi di seluruh sheet
// (Rombel, HalaqohAnggota, Absensi, Hafalan, Nilai, RekapNilai, RoleAkses-NISN Anak)
// otomatis ikut diperbarui, supaya catatan absen/nilai/hafalan SEBELUMNYA tetap utuh
// dan tetap terhubung ke santri yang sama -- tidak pernah hilang/putus.
function apiUbahIdentitasSantri(p) {
  const nisnLama = norm(p.nisnLama);
  const nisnBaru = norm(p.nisnBaru) || nisnLama;
  const namaBaru = norm(p.namaBaru);
  if (!nisnLama) return {ok:false, error:'NISN lama wajib diisi'};
  if (!nisnBaru) return {ok:false, error:'NISN baru wajib diisi'};
  if (!namaBaru) return {ok:false, error:'Nama wajib diisi'};

  const ss = getAktifSS();
  const shSantri = ss.getSheetByName(SHEET_SANTRI);
  const santriRows = shSantri.getDataRange().getValues();
  let rowIndexSantri = -1;
  for (let i=1;i<santriRows.length;i++) { if (norm(santriRows[i][0]) === nisnLama) { rowIndexSantri = i+1; break; } }
  if (rowIndexSantri === -1) return {ok:false, error:'Data santri dengan NISN '+nisnLama+' tidak ditemukan'};

  if (nisnBaru !== nisnLama) {
    for (let i=1;i<santriRows.length;i++) {
      if (i+1 !== rowIndexSantri && norm(santriRows[i][0]) === nisnBaru) return {ok:false, error:'NISN '+nisnBaru+' sudah dipakai santri lain'};
    }
  }

  shSantri.getRange(rowIndexSantri, 1).setValue(nisnBaru);
  shSantri.getRange(rowIndexSantri, 2).setValue(namaBaru);
  if (p.jenisKelamin !== undefined && p.jenisKelamin !== null) shSantri.getRange(rowIndexSantri, 4).setValue(norm(p.jenisKelamin));
  if (p.noWaOrtu !== undefined && p.noWaOrtu !== null) shSantri.getRange(rowIndexSantri, 5).setValue(norm(p.noWaOrtu));

  gantiReferensiSantri(ss.getSheetByName(SHEET_ROMBEL), 0, 1, nisnLama, nisnBaru, namaBaru);
  gantiReferensiSantri(ss.getSheetByName(SHEET_HALAQOH_ANGGOTA), 0, 1, nisnLama, nisnBaru, namaBaru);
  gantiReferensiSantri(ss.getSheetByName(SHEET_ABSENSI), 6, 7, nisnLama, nisnBaru, namaBaru);
  gantiReferensiSantri(ss.getSheetByName(SHEET_HAFALAN), 4, 5, nisnLama, nisnBaru, namaBaru);
  gantiReferensiSantri(ss.getSheetByName(SHEET_NILAI), 4, 5, nisnLama, nisnBaru, namaBaru);
  gantiReferensiSantri(ss.getSheetByName(SHEET_REKAP_NILAI), 0, 1, nisnLama, nisnBaru, namaBaru);

  const shRole = ss.getSheetByName(SHEET_ROLE);
  if (shRole) {
    const roleRows = shRole.getDataRange().getValues();
    for (let i=1;i<roleRows.length;i++) {
      if (norm(roleRows[i][4]) === nisnLama) shRole.getRange(i+1,5).setValue(nisnBaru);
    }
  }
  refreshRekapNilaiAman();
  return {ok:true};
}

// Helper generik: ganti satu nilai teks jadi nilai baru di kolom tertentu suatu sheet.
function gantiKolomTeks(sh, kolIdx, lama, baru) {
  if (!sh) return;
  const rows = sh.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) { if (norm(rows[i][kolIdx]) === lama) sh.getRange(i+1, kolIdx+1).setValue(baru); }
}

// Guru mengubah profilnya sendiri (Nama/No WA/PIN). Kalau Nama berubah, SEMUA referensi
// nama guru di seluruh sheet ikut diperbarui otomatis (sheet Guru, Pengampu di
// MataPelajaran & Halaqoh, Wali Kelas, riwayat Absensi/Hafalan/Nilai lama, catatan Guru
// Pengganti) -- supaya jadwal & rekap jam mengajarnya TIDAK PERNAH terputus akibat
// ganti nama.
function apiUbahProfilGuru(p) {
  const namaLama = norm(p.namaLama);
  const namaBaru = norm(p.namaBaru);
  const noWaBaru = norm(p.noWaBaru);
  const pinBaru = norm(p.pinBaru);
  if (!namaLama || !namaBaru) return {ok:false, error:'Nama wajib diisi'};

  const ss = getAktifSS();
  const shRole = ss.getSheetByName(SHEET_ROLE);
  const roleRows = shRole.getDataRange().getValues();
  let rowIndex = -1;
  // Semua akun staf yang memakai menu Guru (Guru, Pembina, Kepala Bagian, Admin, Mudir,
  // termasuk yang punya beberapa peran). Sebelumnya hanya peran yang PERSIS "Guru",
  // sehingga Pembina/Admin mendapat "Akun guru tidak ditemukan" saat mengubah profil.
  for (let i=1;i<roleRows.length;i++) {
    const lvl = norm(roleRows[i][3]);
    if (norm(roleRows[i][0]) === namaLama && lvl && lvl !== 'WaliSantri') { rowIndex = i+1; break; }
  }
  if (rowIndex === -1) return {ok:false, error:'Akun tidak ditemukan'};

  if (namaBaru !== namaLama) {
    for (let i=1;i<roleRows.length;i++) { if (i+1 !== rowIndex && norm(roleRows[i][0]) === namaBaru) return {ok:false, error:'Nama "'+namaBaru+'" sudah dipakai akun lain'}; }
  }

  shRole.getRange(rowIndex,1).setValue(namaBaru);
  if (noWaBaru) shRole.getRange(rowIndex,2).setValue(noWaBaru);
  if (pinBaru) shRole.getRange(rowIndex,3).setValue(pinBaru);

  if (namaBaru !== namaLama) {
    const shGuru = ss.getSheetByName(SHEET_GURU);
    const guruRows = shGuru.getDataRange().getValues();
    for (let i=1;i<guruRows.length;i++) { if (norm(guruRows[i][0]) === namaLama) { shGuru.getRange(i+1,1).setValue(namaBaru); if (noWaBaru) shGuru.getRange(i+1,2).setValue(noWaBaru); } }

    const shMapel = ss.getSheetByName(SHEET_MAPEL);
    const mapelRows = shMapel.getDataRange().getValues();
    for (let i=1;i<mapelRows.length;i++) { if (norm(mapelRows[i][2]) === namaLama) shMapel.getRange(i+1,3).setValue(namaBaru); }

    const shHalaqoh = ss.getSheetByName(SHEET_HALAQOH);
    const halaqohRows = shHalaqoh.getDataRange().getValues();
    for (let i=1;i<halaqohRows.length;i++) {
      const daftar = daftarPengampu(halaqohRows[i][1]);
      const idx = daftar.indexOf(namaLama);
      if (idx !== -1) { daftar[idx] = namaBaru; shHalaqoh.getRange(i+1,2).setValue(daftar.join(', ')); }
    }

    const shKelas = ss.getSheetByName(SHEET_DAFTAR_KELAS);
    const kelasRows = shKelas.getDataRange().getValues();
    for (let i=1;i<kelasRows.length;i++) { if (norm(kelasRows[i][1]) === namaLama) shKelas.getRange(i+1,2).setValue(namaBaru); }

    gantiKolomTeks(ss.getSheetByName(SHEET_ABSENSI), 5, namaLama, namaBaru);
    gantiKolomTeks(ss.getSheetByName(SHEET_HAFALAN), 3, namaLama, namaBaru);
    gantiKolomTeks(ss.getSheetByName(SHEET_NILAI), 1, namaLama, namaBaru);

    const shPg = ss.getSheetByName(SHEET_PENGGANTIAN);
    if (shPg) {
      const pgRows = shPg.getDataRange().getValues();
      for (let i=1;i<pgRows.length;i++) {
        if (norm(pgRows[i][7]) === namaLama) shPg.getRange(i+1,8).setValue(namaBaru);
        if (norm(pgRows[i][8]) === namaLama) shPg.getRange(i+1,9).setValue(namaBaru);
      }
    }
    refreshRekapNilaiAman();
  }
  return {ok:true, namaBaru: namaBaru};
}

function apiTambahSantriManual(p) {
  const nisn = norm(p.nisn), nama = norm(p.nama), tahunMasuk = norm(p.tahunMasuk), jenisKelamin = norm(p.jenisKelamin);
  if (!nisn || !nama || !tahunMasuk) return {ok:false, error:'NISN, Nama, dan Tahun Masuk wajib diisi'};
  const ss = getAktifSS();
  const shSantri = ss.getSheetByName(SHEET_SANTRI);
  const rows = shSantri.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) if (norm(rows[i][0]) === nisn) return {ok:false, error:'NISN '+nisn+' sudah terdaftar'};
  shSantri.appendRow([nisn, nama, tahunMasuk, jenisKelamin, norm(p.noWaOrtu)]);
  try { catatSantriMasukBanyak_([{nisn: nisn, nama: nama, jk: jenisKelamin, kelas: norm(p.kelas), jenis: p.jenisMasuk, asal: p.asalSekolah}], p.oleh || 'Admin'); } catch (e) { Logger.log('Catat santri masuk gagal: ' + e.message); }
  let pesanRombel = '';
  if (p.kelas) { const hasil = apiTambahSantriKeRombel({nisn:nisn, kelas: norm(p.kelas)}); if (!hasil.ok) pesanRombel = ' (Catatan rombel: ' + hasil.error + ')'; }
  return {ok:true, pesanRombel: pesanRombel};
}

function apiImportSantriMassal(p) {
  const ss = getAktifSS();
  const shSantri = ss.getSheetByName(SHEET_SANTRI);
  if (!shSantri) return {ok:false, error:'Sheet Santri tidak ditemukan. Jalankan Migrasi Skema dulu.'};
  const existing = shSantri.getDataRange().getValues();
  const existingNisn = {};
  for (let i=1;i<existing.length;i++) existingNisn[norm(existing[i][0])] = true;

  let ditambah = 0, dilewati = 0;
  const errors = [];
  const rowsToAdd = [];
  (p.rows || []).forEach((r, idx) => {
    const nisn = norm(r.nisn), nama = norm(r.nama), tahunMasuk = norm(r.tahunMasuk);
    if (!nisn || !nama || !tahunMasuk) { errors.push('Baris '+(idx+2)+': NISN/Nama/Tahun Masuk tidak lengkap, dilewati'); dilewati++; return; }
    if (existingNisn[nisn]) { errors.push('Baris '+(idx+2)+': NISN '+nisn+' sudah ada, dilewati'); dilewati++; return; }
    rowsToAdd.push([nisn, nama, tahunMasuk, norm(r.jenisKelamin), norm(r.noWaOrtu)]);
    existingNisn[nisn] = true; ditambah++;
  });
  if (rowsToAdd.length) shSantri.getRange(shSantri.getLastRow()+1,1,rowsToAdd.length,5).setValues(rowsToAdd);
  try {
    const ditambahkan = {}; rowsToAdd.forEach(function(x){ ditambahkan[x[0]] = true; });
    catatSantriMasukBanyak_((p.rows || []).filter(function(r){ return ditambahkan[norm(r.nisn)]; }).map(function(r){
      return {nisn: norm(r.nisn), nama: norm(r.nama), jk: norm(r.jenisKelamin), kelas: norm(r.kelas), jenis: norm(r.jenisMasuk), asal: norm(r.asalSekolah), keterangan: 'Import massal'};
    }), p.oleh || 'Admin');
  } catch (e) { Logger.log('Catat santri masuk (import) gagal: ' + e.message); }

  (p.rows || []).forEach(r => {
    const nisn = norm(r.nisn), kelas = norm(r.kelas);
    if (kelas && rowsToAdd.some(x => x[0] === nisn)) {
      const hasil = apiTambahSantriKeRombel({nisn:nisn, kelas:kelas});
      if (!hasil.ok) errors.push('NISN '+nisn+': gagal masuk rombel - ' + hasil.error);
    }
  });
  return {ok:true, ditambah:ditambah, dilewati:dilewati, errors:errors};
}

function getSemuaSantriLengkap() {
  const ss = getAktifSS();
  const santriRows = ss.getSheetByName(SHEET_SANTRI).getDataRange().getValues();
  const header = santriRows[0];
  const iSaldo = header.indexOf('Saldo Kantin');
  const iLimit = header.indexOf('Limit Harian Kantin');
  santriRows.shift();
  const rombelRows = ss.getSheetByName(SHEET_ROMBEL).getDataRange().getValues(); rombelRows.shift();
  const halaqohRows = ss.getSheetByName(SHEET_HALAQOH_ANGGOTA).getDataRange().getValues(); halaqohRows.shift();
  const mapKelas = {}; rombelRows.forEach(r => { if (r[0]) mapKelas[norm(r[0])] = norm(r[2]); });
  const mapHalaqoh = {}; halaqohRows.forEach(r => { if (r[0]) mapHalaqoh[norm(r[0])] = norm(r[2]); });
  return santriRows.map(r => ({
    nisn: norm(r[0]), nama: norm(r[1]), tahunMasuk: r[2], jenisKelamin: norm(r[3]), noWaOrtu: norm(r[4]),
    saldoKantin: iSaldo>=0 ? (Number(r[iSaldo])||0) : 0,
    limitHarian: iLimit>=0 ? (Number(r[iLimit])||0) : 0,
    kelasSaatIni: mapKelas[norm(r[0])] || '(belum masuk rombel)',
    halaqohSaatIni: mapHalaqoh[norm(r[0])] || '(belum masuk halaqoh)'
  }));
}

// ======================================================================
// MUTASI SANTRI, KELULUSAN & ALUMNI
// Santri yang keluar/lulus TIDAK perlu dihapus manual: lewat menu Mutasi & Alumni,
// datanya dicatat di sheet MutasiSantri (Master, berlaku lintas semester), lalu
// santri dikeluarkan dari daftar aktif (sheet Santri, Rombel, HalaqohAnggota semester
// berjalan). Semua riwayat (absensi, nilai, hafalan, SPP, kantin, pelanggaran) TIDAK
// disentuh dan tetap bisa dibuka lewat tombol "Lihat Riwayat". Bisa dibatalkan:
// salinan baris santri disimpan sehingga bisa dikembalikan persis seperti semula.
// Santri masuk (baru / pindahan) juga dicatat, termasuk yang ditambahkan langsung di
// spreadsheet (dikenali oleh pemeriksaan jejak NISN).
// ======================================================================
const SHEET_MUTASI_SANTRI = 'MutasiSantri';
const HEADER_MUTASI_ = ['ID','Waktu Catat','Tanggal','Jenis','NISN','Nama','Jenis Kelamin','Kelas','Halaqoh','Semester','Semester ID','Keterangan','Asal/Tujuan','Oleh','Status','Data Santri'];
const JENIS_MASUK_ = ['Santri Baru', 'Pindahan Masuk'];
const JENIS_KELUAR_ = ['Mutasi Keluar', 'Lulus'];

function shMutasi_() {
  const ms = getMasterSS();
  let sh = ms.getSheetByName(SHEET_MUTASI_SANTRI);
  if (!sh) { sh = ms.insertSheet(SHEET_MUTASI_SANTRI); sh.appendRow(HEADER_MUTASI_); sh.setFrozenRows(1); }
  return sh;
}
function bacaMutasi_() {
  const sh = shMutasi_();
  if (sh.getLastRow() < 2) return [];
  const tz = Session.getScriptTimeZone();
  const t = function(v){ return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : norm(v); };
  return sh.getRange(2, 1, sh.getLastRow() - 1, HEADER_MUTASI_.length).getValues().map(function(r, i){
    return {rowIndex: i + 2, id: norm(r[0]), dicatat: r[1] instanceof Date ? Utilities.formatDate(r[1], tz, 'yyyy-MM-dd HH:mm') : norm(r[1]),
      tanggal: t(r[2]), jenis: norm(r[3]), nisn: norm(r[4]).replace(/^'/, ''), nama: norm(r[5]), jk: norm(r[6]), kelas: norm(r[7]),
      halaqoh: norm(r[8]), semester: norm(r[9]), semesterId: norm(r[10]), keterangan: norm(r[11]), asalTujuan: norm(r[12]),
      oleh: norm(r[13]), status: norm(r[14]) || 'Aktif', _data: norm(r[15])};
  }).filter(function(x){ return x.id; });
}
function semesterAktifInfo_() {
  const id = getAktifSS().getId();
  let nama = '';
  try { const t = getTahunAjaranList().find(function(x){ return norm(x.id) === id; }); if (t) nama = norm(t.nama); } catch (e) {}
  if (!nama) { try { nama = getAktifSS().getName(); } catch (e) {} }
  return {id: id, nama: nama};
}
// NISN -> catatan keluar/lulus TERAKHIR yang masih berlaku
function petaMutasiKeluar_() {
  const peta = {};
  try {
    bacaMutasi_().forEach(function(m){
      if (m.status !== 'Aktif' || JENIS_KELUAR_.indexOf(m.jenis) === -1) return;
      peta[m.nisn] = m;
    });
  } catch (e) {}
  return peta;
}
function idMutasiBaru_() { return 'MUT-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss') + '-' + Math.floor(Math.random() * 900 + 100); }

// Catat santri masuk (dilewati bila NISN itu sudah punya catatan di semester ini)
function catatSantriMasukBanyak_(items, oleh) {
  if (!items || !items.length) return 0;
  const sem = semesterAktifInfo_();
  const ada = {};
  bacaMutasi_().forEach(function(m){ if (m.semesterId === sem.id) ada[m.nisn] = true; });
  const tz = Session.getScriptTimeZone(), hariIni = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const baris = [];
  items.forEach(function(x){
    const nisn = norm(x.nisn); if (!nisn || ada[nisn]) return;
    ada[nisn] = true;
    const jenis = JENIS_MASUK_.indexOf(norm(x.jenis)) !== -1 ? norm(x.jenis) : 'Santri Baru';
    baris.push([idMutasiBaru_() + baris.length, new Date(), hariIni, jenis, "'" + nisn, norm(x.nama), norm(x.jk), norm(x.kelas), '',
      sem.nama, sem.id, norm(x.keterangan), norm(x.asal), norm(oleh) || 'Sistem', 'Aktif', '']);
  });
  if (!baris.length) return 0;
  const sh = shMutasi_();
  sh.getRange(sh.getLastRow() + 1, 1, baris.length, HEADER_MUTASI_.length).setValues(baris);
  return baris.length;
}

// Proses keluar / lulus untuk satu atau banyak santri sekaligus
function apiProsesMutasiSantri(p) {
  p = p || {};
  if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Hanya Admin/Mudir yang boleh memproses mutasi & kelulusan.'};
  const jenis = norm(p.jenis);
  if (JENIS_KELUAR_.indexOf(jenis) === -1) return {ok:false, error:'Jenis harus "Mutasi Keluar" atau "Lulus".'};
  const tz = Session.getScriptTimeZone();
  const tanggal = norm(p.tanggal) || Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return {ok:false, error:'Tanggal tidak valid.'};
  const daftar = (p.nisnList || []).map(function(x){ return norm(x); }).filter(Boolean);
  if (!daftar.length) return {ok:false, error:'Pilih minimal satu santri.'};
  if (jenis === 'Mutasi Keluar' && !norm(p.keterangan)) return {ok:false, error:'Alasan keluar wajib diisi.'};

  // Dua kunci: kunci catatan (supaya tidak bertabrakan dengan proses ganti NISN yang
  // menulis ulang kolom NISN) lalu kunci transaksi (supaya kasir/saldo tidak menulis ke
  // baris yang sedang bergeser karena baris santri dikeluarkan).
  let kunciA;
  try { kunciA = LockService.getUserLock(); } catch (e) { kunciA = LockService.getScriptLock(); }
  try { kunciA.waitLock(30000); } catch (e) { return {ok:false, error:'Server sedang sibuk. Data BELUM diproses, silakan coba lagi.'}; }
  try {
    const kunciB = kunciTransaksi_();
    try { kunciB.waitLock(30000); } catch (e) { return {ok:false, error:'Server sedang memproses transaksi lain. Data BELUM diproses, silakan coba lagi.'}; }
    try {
      const ss = getAktifSS();
      const shS = ss.getSheetByName(SHEET_SANTRI);
      const vS = shS.getDataRange().getValues();
      const header = vS[0];
      const iSaldo = header.indexOf('Saldo Kantin');
      const iNisn = kolomNisnSantri_(header);
      const shR = ss.getSheetByName(SHEET_ROMBEL), vR = shR ? shR.getDataRange().getValues() : [[]];
      const shH = ss.getSheetByName(SHEET_HALAQOH_ANGGOTA), vH = shH ? shH.getDataRange().getValues() : [[]];
      const sem = semesterAktifInfo_();

      const gagal = [], siap = [];
      daftar.forEach(function(nisn){
        const i = vS.findIndex(function(r, k){ return k > 0 && norm(r[iNisn]).replace(/^'/, '') === nisn; });
        if (i === -1) { gagal.push(nisn + ': tidak ada di data santri aktif'); return; }
        const saldo = iSaldo >= 0 ? (Number(vS[i][iSaldo]) || 0) : 0;
        if (saldo !== 0) { gagal.push(norm(vS[i][1]) + ': masih punya saldo kantin ' + rp(saldo) + '. Tarik/kembalikan saldonya dulu.'); return; }
        siap.push({nisn: nisn, baris: i + 1, row: vS[i]});
      });
      if (!siap.length) return {ok:false, error: gagal.join('\n')};

      const tz2 = tz, now = new Date();
      const catatan = [], hapusS = [], hapusR = [], hapusH = [];
      siap.forEach(function(x){
        const rombel = [], halaqoh = [];
        for (let k = 1; k < vR.length; k++) if (norm(vR[k][0]) === x.nisn) { rombel.push(vR[k]); hapusR.push(k + 1); }
        for (let k = 1; k < vH.length; k++) if (norm(vH[k][0]) === x.nisn) { halaqoh.push(vH[k]); hapusH.push(k + 1); }
        hapusS.push(x.baris);
        const kelas = rombel.map(function(r){ return norm(r[2]); }).filter(Boolean).join(', ');
        const namaH = halaqoh.map(function(r){ return norm(r[2]); }).filter(Boolean).join(', ');
        const salinan = JSON.stringify({header: header, row: x.row, rombel: rombel, halaqoh: halaqoh}, function(k, v){
          return (this[k] instanceof Date) ? Utilities.formatDate(this[k], tz2, 'yyyy-MM-dd') : v; });
        catatan.push([idMutasiBaru_() + catatan.length, now, tanggal, jenis, "'" + x.nisn, norm(x.row[1]), norm(x.row[3]), kelas, namaH,
          sem.nama, sem.id, norm(p.keterangan), norm(p.tujuan), norm(p.oleh), 'Aktif', salinan.slice(0, 48000)]);
      });
      // 1) Catat DULU (supaya tidak ada santri yang "hilang" tanpa catatan bila proses terhenti)
      const shM = shMutasi_();
      shM.getRange(shM.getLastRow() + 1, 1, catatan.length, HEADER_MUTASI_.length).setValues(catatan);
      // 2) Keluarkan dari daftar aktif (dari baris paling bawah supaya nomor baris tidak bergeser)
      const urutTurun = function(a, b){ return b - a; };
      hapusH.sort(urutTurun).forEach(function(b){ shH.deleteRow(b); });
      hapusR.sort(urutTurun).forEach(function(b){ shR.deleteRow(b); });
      hapusS.sort(urutTurun).forEach(function(b){ shS.deleteRow(b); });
      try { simpanJejakNisn_(bacaSantriUntukJejak_()); } catch (e) {}
      return {ok:true, diproses: siap.length, gagal: gagal,
        pesan: siap.length + ' santri dicatat ' + (jenis === 'Lulus' ? 'LULUS' : 'MUTASI KELUAR') + '.' + (gagal.length ? '\n\nTidak diproses:\n' + gagal.join('\n') : '')};
    } finally { kunciB.releaseLock(); }
  } finally { try { kunciA.releaseLock(); } catch (e) {} }
}

// Batalkan catatan (salah proses). Keluar/Lulus: santri dikembalikan persis seperti semula.
function apiBatalkanMutasi(p) {
  p = p || {};
  if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Hanya Admin/Mudir.'};
  const m = bacaMutasi_().find(function(x){ return x.id === norm(p.id); });
  if (!m) return {ok:false, error:'Catatan tidak ditemukan.'};
  if (m.status !== 'Aktif') return {ok:false, error:'Catatan ini sudah dibatalkan.'};
  const shM = shMutasi_();
  if (JENIS_MASUK_.indexOf(m.jenis) !== -1) {
    shM.getRange(m.rowIndex, 15).setValue('Dibatalkan (' + norm(p.oleh) + ')');
    return {ok:true, pesan:'Catatan santri masuk dibatalkan (data santri tidak diubah).'};
  }
  let data = null;
  try { data = JSON.parse(m._data); } catch (e) {}
  if (!data || !data.row) return {ok:false, error:'Salinan data santri tidak tersedia, tidak bisa dikembalikan otomatis. Tambahkan santri secara manual.'};
  let kunciA;
  try { kunciA = LockService.getUserLock(); } catch (e) { kunciA = LockService.getScriptLock(); }
  try { kunciA.waitLock(30000); } catch (e) { return {ok:false, error:'Server sedang sibuk, coba lagi.'}; }
  try {
    const ss = getAktifSS();
    const shS = ss.getSheetByName(SHEET_SANTRI);
    const vS = shS.getDataRange().getValues();
    const iN = kolomNisnSantri_(vS[0]);
    if (vS.some(function(r, k){ return k > 0 && norm(r[iN]).replace(/^'/, '') === m.nisn; })) {
      shM.getRange(m.rowIndex, 15).setValue('Dibatalkan (' + norm(p.oleh) + ')');
      return {ok:true, pesan:'Santri sudah ada lagi di data aktif. Catatan dibatalkan.'};
    }
    // Kembalikan baris santri sesuai susunan kolom SEKARANG (dicocokkan lewat judul kolom)
    const headerKini = vS[0].map(function(h){ return norm(h); });
    const baris = headerKini.map(function(h, i){
      const j = (data.header || []).map(function(x){ return norm(x); }).indexOf(h);
      const v = j !== -1 ? data.row[j] : (i < data.row.length ? data.row[i] : '');
      return v === null || v === undefined ? '' : v;
    });
    baris[iN] = /^0/.test(m.nisn) ? "'" + m.nisn : m.nisn;
    shS.appendRow(baris);
    const shR = ss.getSheetByName(SHEET_ROMBEL), shH = ss.getSheetByName(SHEET_HALAQOH_ANGGOTA);
    (data.rombel || []).forEach(function(r){ if (shR) { r = r.slice(); r[0] = m.nisn; shR.appendRow(r); } });
    (data.halaqoh || []).forEach(function(r){ if (shH) { r = r.slice(); r[0] = m.nisn; shH.appendRow(r); } });
    shM.getRange(m.rowIndex, 15).setValue('Dibatalkan (' + norm(p.oleh) + ')');
    try { simpanJejakNisn_(bacaSantriUntukJejak_()); } catch (e) {}
    return {ok:true, pesan: m.nama + ' dikembalikan menjadi santri aktif' + ((data.rombel||[]).length ? ' (kelas & halaqoh ikut dikembalikan)' : '') + '.'};
  } finally { try { kunciA.releaseLock(); } catch (e) {} }
}

function apiUbahCatatanMutasi(p) {
  p = p || {};
  if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Hanya Admin/Mudir.'};
  const m = bacaMutasi_().find(function(x){ return x.id === norm(p.id); });
  if (!m) return {ok:false, error:'Catatan tidak ditemukan.'};
  const sh = shMutasi_();
  if (p.jenis) {
    const kelompokLama = JENIS_MASUK_.indexOf(m.jenis) !== -1 ? JENIS_MASUK_ : JENIS_KELUAR_;
    if (kelompokLama.indexOf(norm(p.jenis)) === -1) return {ok:false, error:'Jenis tidak bisa diubah ke kelompok lain (masuk <-> keluar).'};
    sh.getRange(m.rowIndex, 4).setValue(norm(p.jenis));
  }
  if (p.keterangan !== undefined) sh.getRange(m.rowIndex, 12).setValue(norm(p.keterangan));
  if (p.asalTujuan !== undefined) sh.getRange(m.rowIndex, 13).setValue(norm(p.asalTujuan));
  if (p.tanggal && /^\d{4}-\d{2}-\d{2}$/.test(norm(p.tanggal))) sh.getRange(m.rowIndex, 3).setValue(norm(p.tanggal));
  return {ok:true};
}

// Rekap per semester + daftar nama. p.semesterId: id semester untuk daftar rinci ('' = aktif, 'semua' = semua)
function apiGetRekapMutasi(p) {
  p = p || {};
  if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Hanya Admin/Mudir.'};
  const semua = bacaMutasi_().filter(function(m){ return m.status === 'Aktif'; });
  const idAktif = getAktifSS().getId();
  let daftarSem = [];
  try { daftarSem = getTahunAjaranList().filter(function(t){ return norm(t.id); }).map(function(t){ return {id: norm(t.id), nama: norm(t.nama), aktif: norm(t.id) === idAktif}; }); } catch (e) {}
  if (!daftarSem.some(function(t){ return t.id === idAktif; })) daftarSem.push({id: idAktif, nama: semesterAktifInfo_().nama, aktif: true});
  const rekap = daftarSem.map(function(t){
    let jumlah = null;
    try {
      const ss = t.id === idAktif ? getAktifSS() : SpreadsheetApp.openById(t.id);
      const sh = ss.getSheetByName(SHEET_SANTRI);
      if (sh) jumlah = sh.getDataRange().getValues().slice(1).filter(function(r){ return norm(r[0]); }).length;
    } catch (e) {}
    const milik = semua.filter(function(m){ return m.semesterId === t.id; });
    const hitung = function(j){ return milik.filter(function(m){ return m.jenis === j; }).length; };
    return {id: t.id, nama: t.nama, aktif: t.aktif, jumlahSantri: jumlah,
      santriBaru: hitung('Santri Baru'), pindahanMasuk: hitung('Pindahan Masuk'), mutasiKeluar: hitung('Mutasi Keluar'), lulus: hitung('Lulus')};
  });
  const pilih = norm(p.semesterId) || idAktif;
  const rinci = semua.filter(function(m){ return pilih === 'semua' || m.semesterId === pilih; })
    .map(function(m){ const x = Object.assign({}, m); delete x._data; return x; })
    .sort(function(a, b){ return String(b.tanggal).localeCompare(String(a.tanggal)); });
  return {ok:true, semesterAktif: idAktif, rekap: rekap, rinci: rinci, dipilih: pilih};
}

// ============ NILAI (UTS/UAS/Tugas/Keterampilan) & RAPOR - TAHAP 2 ============
const JENIS_NILAI_LIST = ['UTS','UAS','Tugas','Keterampilan'];

// Daftar mapel+kelas yang diampu guru (semua hari, bukan cuma hari ini) - dipakai utk form input nilai
function getMapelGuru(pengampu) {
  pengampu = norm(pengampu);
  const sh = getAktifSS().getSheetByName(SHEET_MAPEL);
  const rows = sh.getDataRange().getValues(); rows.shift();
  const seen = {}; const hasil = [];
  rows.filter(r => norm(r[2]) === pengampu || samaGuru_(r[2], pengampu)).forEach(r => {
    const key = norm(r[0]) + '|' + norm(r[1]);
    if (!seen[key]) { seen[key] = true; hasil.push({mapel:norm(r[0]), kelas:norm(r[1])}); }
  });
  return hasil;
}

// ======================================================================
// REKAP PER SANTRI UNTUK GURU (absensi + nilai, per mata pelajaran)
// p: {pengampu, mapel?, kelas?, nisn?, tglMulai?, tglAkhir?, tahunAjaranId?}
// - Hanya mapel+kelas yang diampu guru itu (sesuai jadwal), ditambah catatan yang
//   memang ia isi sendiri (mis. saat menjadi guru pengganti).
// - Absensi mengikuti rentang tanggal; nilai diambil seluruh semester aktif.
// - Catatan ganda memakai isian terbaru (sama dengan rekap lain).
// - Rincian per tanggal hanya dikirim bila satu santri dipilih (supaya ringan).
// ======================================================================
function apiGetRekapSantriGuru(p) {
  p = p || {};
  const guru = norm(p.pengampu);
  if (!guru) return {ok:false, error:'Nama guru tidak dikenali. Silakan masuk ulang.'};
  const ss = getSSTarget(p.tahunAjaranId);
  const tz = Session.getScriptTimeZone();
  const fMapel = normNama(norm(p.mapel)), fKelas = normNama(norm(p.kelas)), fNisn = norm(p.nisn);
  const mulai = norm(p.tglMulai), akhir = norm(p.tglAkhir);
  const kunciMK = function(m, k){ return normNama(norm(m)) + '|' + normNama(norm(k)); };

  // Mapel+kelas milik guru (jadwal)
  const pasangan = {}, mapelList = [];
  const shM = ss.getSheetByName(SHEET_MAPEL);
  if (shM && shM.getLastRow() > 1) shM.getDataRange().getValues().slice(1).forEach(function(r){
    if (!norm(r[0]) || !norm(r[1]) || !samaGuru_(r[2], guru)) return;
    const k = kunciMK(r[0], r[1]);
    if (!pasangan[k]) { pasangan[k] = {mapel: norm(r[0]), kelas: norm(r[1])}; mapelList.push(pasangan[k]); }
  });
  const cocokFilter = function(m, k){
    if (fMapel && normNama(norm(m)) !== fMapel) return false;
    if (fKelas && normNama(norm(k)) !== fKelas) return false;
    return true;
  };
  const milikGuru = function(m, k, pencatat){ return !!pasangan[kunciMK(m, k)] || samaGuru_(pencatat, guru); };

  // Nama & kelas santri dari Rombel
  const infoSantri = {};
  const shR = ss.getSheetByName(SHEET_ROMBEL);
  if (shR && shR.getLastRow() > 1) shR.getDataRange().getValues().slice(1).forEach(function(r){
    if (norm(r[0])) infoSantri[norm(r[0])] = {nama: norm(r[1]), kelas: norm(r[2])};
  });

  const hasil = {}; // nisn -> {nisn,nama,kelas,perMapel:{kunci->obj}}
  function wadah(nisn, nama, mapel, kelas) {
    if (!hasil[nisn]) {
      const inf = infoSantri[nisn] || {};
      hasil[nisn] = {nisn: nisn, nama: inf.nama || nama || nisn, kelas: inf.kelas || kelas, perMapel: {}};
    }
    const k = kunciMK(mapel, kelas);
    if (!hasil[nisn].perMapel[k]) hasil[nisn].perMapel[k] = {mapel: norm(mapel), kelas: norm(kelas),
      hadir:0, sakit:0, izin:0, alpa:0, total:0, tugas:[], keterampilan:[], uts:null, uas:null,
      _utsMs:-1, _uasMs:-1, detailAbsen:[], detailNilai:[]};
    return hasil[nisn].perMapel[k];
  }
  const rinci = !!fNisn;

  // Santri di kelas yang diajar tetap muncul walau belum ada catatan
  Object.keys(infoSantri).forEach(function(nisn){
    if (fNisn && nisn !== fNisn) return;
    mapelList.forEach(function(mk){
      if (!cocokFilter(mk.mapel, mk.kelas)) return;
      if (normNama(infoSantri[nisn].kelas) === normNama(mk.kelas)) wadah(nisn, infoSantri[nisn].nama, mk.mapel, mk.kelas);
    });
  });

  // Absensi mapel
  const shA = ss.getSheetByName(SHEET_ABSENSI);
  if (shA && shA.getLastRow() > 1) nilaiCatatanUnik_(shA).slice(1).forEach(function(r){
    if (norm(r[16]) === 'Halaqoh') return;
    const tgl = tglKunciCatatan_(r[0], tz); if (!tgl) return;
    if (mulai && tgl < mulai) return;
    if (akhir && tgl > akhir) return;
    const nisn = norm(r[6]); if (!nisn || (fNisn && nisn !== fNisn)) return;
    if (!cocokFilter(r[3], r[4]) || !milikGuru(r[3], r[4], r[5])) return;
    const w = wadah(nisn, norm(r[7]), r[3], r[4]);
    const st = norm(r[8]);
    w.total++;
    if (st === 'Hadir') w.hadir++;
    else if (st === 'Sakit') w.sakit++;
    else if (st === 'Izin' || st === 'Izin Pulang') w.izin++;
    else if (st === 'Alpa') w.alpa++;
    if (rinci) w.detailAbsen.push({tanggal: tgl, jamKe: r[2], status: st, keterangan: norm(r[9]), pengampu: norm(r[5])});
  });

  // Nilai (seluruh semester)
  const shN = ss.getSheetByName(SHEET_NILAI);
  if (shN && shN.getLastRow() > 1) shN.getDataRange().getValues().slice(1).forEach(function(r){
    const nisn = norm(r[4]); if (!nisn || (fNisn && nisn !== fNisn)) return;
    if (!cocokFilter(r[2], r[3]) || !milikGuru(r[2], r[3], r[1])) return;
    const n = Number(r[7]); if (r[7] === '' || r[7] === null || isNaN(n)) return;
    const w = wadah(nisn, norm(r[5]), r[2], r[3]);
    const jenis = norm(r[6]);
    const ms = msWaktuInput_(r[8]) || msWaktuInput_(r[0]);
    if (jenis === 'Tugas') w.tugas.push(n);
    else if (jenis === 'Keterampilan') w.keterampilan.push(n);
    else if (jenis === 'UTS' && ms >= w._utsMs) { w.uts = n; w._utsMs = ms; }
    else if (jenis === 'UAS' && ms >= w._uasMs) { w.uas = n; w._uasMs = ms; }
    if (rinci) w.detailNilai.push({tanggal: tglKunciCatatan_(r[0], tz), jenis: jenis, nilai: n});
  });

  const rata = function(a){ return a.length ? Math.round(a.reduce(function(x,y){ return x+y; }, 0) / a.length) : null; };
  const santri = Object.keys(hasil).map(function(nisn){
    const s = hasil[nisn];
    const perMapel = Object.keys(s.perMapel).map(function(k){
      const w = s.perMapel[k];
      w.persen = w.total ? Math.round(w.hadir * 100 / w.total) : null;
      w.rataTugas = rata(w.tugas);
      w.rataKeterampilan = rata(w.keterampilan);
      // Perkiraan Nilai Pengetahuan, rumus sama dengan Rekap Nilai Rapor
      w.npr = Math.round((w.rataTugas||0)*0.35 + (w.uts||0)*0.25 + (w.uas||0)*0.30 + (w.persen||0)*0.10);
      delete w._utsMs; delete w._uasMs;
      if (!rinci) { delete w.detailAbsen; delete w.detailNilai; }
      else {
        w.detailAbsen.sort(function(a,b){ return a.tanggal.localeCompare(b.tanggal) || (Number(a.jamKe)||0) - (Number(b.jamKe)||0); });
        w.detailNilai.sort(function(a,b){ return String(a.tanggal).localeCompare(String(b.tanggal)); });
      }
      return w;
    }).sort(function(a,b){ return a.mapel.localeCompare(b.mapel) || a.kelas.localeCompare(b.kelas); });
    return {nisn: s.nisn, nama: s.nama, kelas: s.kelas, perMapel: perMapel};
  }).sort(function(a,b){ return String(a.kelas).localeCompare(String(b.kelas)) || a.nama.localeCompare(b.nama); });

  return {ok:true, mapelList: mapelList, santri: santri, periode: {mulai: mulai, akhir: akhir}};
}

// Simpan nilai (upsert berdasar Mapel+Kelas+JenisNilai+NISN, sehingga input ulang = revisi nilai)
function apiSubmitNilai(p) {
  if (!p || !p.items || !p.items.length) return {ok:false, error:'Tidak ada data nilai untuk disimpan'};
  if (JENIS_NILAI_LIST.indexOf(p.jenisNilai) === -1) return {ok:false, error:'Jenis nilai tidak valid'};
  const sh = getAktifSS().getSheetByName(SHEET_NILAI);
  const tanggal = p.tanggal || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const existing = sh.getDataRange().getValues();

  // Tugas & Keterampilan: SETIAP kali disimpan selalu jadi BARIS BARU (tidak pernah
  // menimpa yang lama) -- karena dalam satu semester biasanya ada banyak tugas/
  // penilaian keterampilan, dan semuanya harus terdokumentasi lalu dirata-ratakan
  // untuk rapor (lihat getRekapNilaiSantri). Kalau guru salah input satu nilai dan mau
  // membetulkannya, tetap bisa lewat menu Riwayat Nilai > Edit (menyasar baris yang
  // spesifik, bukan menimpa berdasarkan mapel+kelas+jenis seperti di sini).
  // UTS & UAS: tetap upsert (menimpa entri lama) seperti biasa, karena wajarnya cuma
  // satu kali per semester per santri per mapel.
  const jenisAkumulatif = (p.jenisNilai === 'Tugas' || p.jenisNilai === 'Keterampilan');

  const indexBaris = {};
  if (!jenisAkumulatif) {
    for (let i=1;i<existing.length;i++) {
      const r = existing[i];
      if (norm(r[2])===norm(p.mapel) && norm(r[3])===norm(p.kelas) && norm(r[6])===norm(p.jenisNilai)) {
        indexBaris[norm(r[4])] = i+1;
      }
    }
  }

  const rowsToAdd = [];
  let diupdate = 0, dilewati = 0;
  (p.items || []).forEach(it => {
    if (it.nilai === '' || it.nilai == null || isNaN(Number(it.nilai))) { dilewati++; return; }
    const nilaiNum = Number(it.nilai);
    const rowIdx = jenisAkumulatif ? null : indexBaris[norm(it.nisn)];
    if (rowIdx) {
      sh.getRange(rowIdx,1,1,9).setValues([[tanggal, p.pengajar, p.mapel, p.kelas, it.nisn, it.nama, p.jenisNilai, nilaiNum, new Date()]]);
      diupdate++;
    } else {
      rowsToAdd.push([tanggal, p.pengajar, p.mapel, p.kelas, it.nisn, it.nama, p.jenisNilai, nilaiNum, new Date()]);
    }
  });
  if (rowsToAdd.length) sh.getRange(sh.getLastRow()+1,1,rowsToAdd.length,9).setValues(rowsToAdd);
  refreshRekapNilaiAman();
  return {ok:true, ditambah: rowsToAdd.length, diupdate: diupdate, dilewati: dilewati};
}

function getRiwayatNilai(p) {
  const sh = getSSTarget(p.tahunAjaranId).getSheetByName(SHEET_NILAI);
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  return rows.map((r,idx) => ({ rowIndex: idx+2, tanggal: Utilities.formatDate(new Date(r[0]),tz,'yyyy-MM-dd'),
      pengajar: r[1], mapel: r[2], kelas: r[3], nisn: r[4], nama: r[5], jenisNilai: r[6], nilai: r[7] }))
    .filter(r => (!p.pengajar || r.pengajar === p.pengajar))
    .filter(r => (!p.mapel || r.mapel === p.mapel))
    .filter(r => (!p.kelas || r.kelas === p.kelas))
    .filter(r => (!p.jenisNilai || r.jenisNilai === p.jenisNilai))
    .filter(r => (!p.nisn || String(r.nisn) === String(p.nisn)))
    .sort((a,b) => b.tanggal.localeCompare(a.tanggal));
}

function apiUpdateNilai(p) {
  const sh = getAktifSS().getSheetByName(SHEET_NILAI);
  sh.getRange(p.rowIndex,8).setValue(Number(p.nilai));
  sh.getRange(p.rowIndex,9).setValue(new Date());
  return {ok:true};
}

function apiDeleteNilai(p) {
  getAktifSS().getSheetByName(SHEET_NILAI).deleteRow(Number(p.rowIndex));
  return {ok:true};
}

// Rekap nilai per santri, dikelompokkan per mapel (rata-rata bila jenis nilai muncul lebih dari sekali, misal Tugas berkali-kali)
// Rekap nilai rapor per mapel+kelas -- menghasilkan tabel seperti screenshot
// Formula: NPR = RataRata*35% + UTS*25% + UAS*30% + Kehadiran*10%
// NKR = rata-rata K1-K5
// Huruf dari NKR: A>=90, B>=80, C>=70, D<70
// ============ WALI KELAS: fungsi khusus ============

// Daftar mapel yang diajarkan di kelas tertentu (untuk dropdown Wali Kelas)
function getMapelUntukKelas(kelas) {
  kelas = norm(kelas);
  const sh = getAktifSS().getSheetByName(SHEET_MAPEL);
  const rows = sh.getDataRange().getValues(); rows.shift();
  const mapelSet = {};
  rows.filter(r => norm(r[1]) === kelas && norm(r[0])).forEach(r => {
    const key = norm(r[0])+'|'+norm(r[2]);
    if (!mapelSet[key]) mapelSet[key] = {mapel:norm(r[0]), kelas:kelas, pengampu:norm(r[2])};
  });
  return Object.values(mapelSet).sort((a,b) => a.mapel.localeCompare(b.mapel,'id'));
}

// Rekap absensi semua santri di suatu kelas (lintas mapel)
function getRekapAbsensiKelas(kelas, mapel, tglMulai, tglAkhir) {
  kelas = norm(kelas); mapel = norm(mapel);
  const sh = getAktifSS().getSheetByName(SHEET_ABSENSI);
if (!sh) return [];
  const rows = nilaiCatatanUnik_(sh); rows.shift();
  const tz = Session.getScriptTimeZone();
  const filtered = rows.filter(r => {
    if (norm(r[4]) !== kelas) return false;
    if (mapel && norm(r[3]) !== mapel) return false;
    if (norm(r[16]) === 'Halaqoh') return false;
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
    if (tglMulai && tgl < tglMulai) return false;
    if (tglAkhir && tgl > tglAkhir) return false;
    return true;
  });
  const perSantri = {};
  filtered.forEach(r => {
    const nisn = norm(r[6]), nama = norm(r[7]), status = norm(r[8]);
    if (!perSantri[nisn]) perSantri[nisn] = {nisn,nama,hadir:0,sakit:0,izin:0,alpa:0,total:0};
    perSantri[nisn].total++;
    if (status==='Hadir') perSantri[nisn].hadir++;
    else if (status==='Sakit') perSantri[nisn].sakit++;
    else if (status==='Izin' || status==='Izin Pulang') perSantri[nisn].izin++;
    else if (status==='Alpa') perSantri[nisn].alpa++;
  });
  return Object.values(perSantri).map(s => ({
    ...s, persenHadir: s.total>0?Math.round(s.hadir/s.total*100):0
  })).sort((a,b) => b.persenHadir-a.persenHadir);
}

// Rekap hafalan santri per kelas (dari sheet HalaqohAnggota → cari halaqoh tiap santri)
function getRekapHafalanPerKelas(kelas) {
  kelas = norm(kelas);
  const ss = getAktifSS();
  // Ambil santri di kelas ini
  const rombelRows = nilaiCatatanUnik_(ss.getSheetByName(SHEET_ROMBEL)); rombelRows.shift();
  const santriDiKelas = new Set(rombelRows.filter(r=>norm(r[2])===kelas).map(r=>norm(r[0])));
  // Ambil halaqoh masing-masing santri
  const anggotaRows = nilaiCatatanUnik_(ss.getSheetByName(SHEET_HALAQOH_ANGGOTA)); anggotaRows.shift();
  const mapHalaqoh = {};
  anggotaRows.filter(r=>santriDiKelas.has(norm(r[0]))).forEach(r=>{ mapHalaqoh[norm(r[0])]=norm(r[2]); });
  // Ambil data hafalan
  const shH = ss.getSheetByName(SHEET_HAFALAN);
  if (!shH) return [];
  const hafalanRows = nilaiCatatanUnik_(shH); hafalanRows.shift();
  const tz = Session.getScriptTimeZone();
  const perSantri = {};
  hafalanRows.filter(r=>santriDiKelas.has(norm(r[2]))).forEach(r=>{
    const nisn=norm(r[2]),nama=norm(r[3]);
    if (!perSantri[nisn]) perSantri[nisn]={nisn,nama,namaHalaqoh:mapHalaqoh[nisn]||'-',
      totalSetor:0,totalMurojaah:0,nilaiTotal:0,nilaiCount:0,surahTerakhir:'',juzTerakhir:0,tanggalTerakhir:''};
    const s=perSantri[nisn],jenis=norm(r[5]),tgl=r[0] instanceof Date?Utilities.formatDate(r[0],tz,'yyyy-MM-dd'):norm(r[0]);
    if(jenis==='Setoran Baru'||jenis==='Setoran')s.totalSetor++;
    else if(jenis==='Murojaah')s.totalMurojaah++;
    const nilai=Number(r[10]);
    if(nilai>0){s.nilaiTotal+=nilai;s.nilaiCount++;}
    if(norm(r[6]))s.surahTerakhir=norm(r[6]);
    if(Number(r[8])>0)s.juzTerakhir=Number(r[8]);
    if(tgl>s.tanggalTerakhir)s.tanggalTerakhir=tgl;
  });
  return Object.values(perSantri).map(s=>({
    ...s, totalSesi:s.totalSetor+s.totalMurojaah,
    nilaiRata:s.nilaiCount>0?Math.round(s.nilaiTotal/s.nilaiCount):0
  })).sort((a,b)=>a.nama.localeCompare(b.nama,'id'));
}

// Rekap pelanggaran santri per kelas
function getPelanggaranPerKelas(kelas) {
  kelas = norm(kelas);
  const ss = getAktifSS();
  const rombelRows = ss.getSheetByName(SHEET_ROMBEL).getDataRange().getValues(); rombelRows.shift();
  const santriDiKelas = new Set(rombelRows.filter(r=>norm(r[2])===kelas).map(r=>norm(r[0])));
  // Ambil catatan pelanggaran dari spreadsheet Pelanggaran
  let catRows = [];
  try {
    const ssPel = getAktifPelanggaranSS();
    const shCat = ssPel.getSheetByName(SHEET_PENCATATAN_PEL);
    if (shCat) { catRows = shCat.getDataRange().getValues(); catRows.shift(); }
  } catch(e) {}
  const perSantri = {};
  catRows.filter(r=>santriDiKelas.has(norm(r[2]))).forEach(r=>{
    const nisn=norm(r[2]),nama=norm(r[3]),poin=Number(r[5])||0;
    if(!perSantri[nisn])perSantri[nisn]={nisn,nama,jumlah:0,totalPoin:0};
    perSantri[nisn].jumlah++;
    perSantri[nisn].totalPoin+=poin;
  });
  return Object.values(perSantri).sort((a,b)=>b.totalPoin-a.totalPoin);
}

// Verifikasi sesi tersimpan masih valid -- dipanggil di background saat restore sesi
// Kalau akun masih ada: return data user terbaru (role mungkin sudah diubah Admin)
// Kalau akun dihapus/dinonaktifkan: return nonaktif:true
function apiCekSesiAktif(p) {
  const sh = getAktifSS().getSheetByName(SHEET_ROLE);
  if (!sh) return {ok:true}; // sheet tidak ada, biarkan sesi lama
  const rows = sh.getDataRange().getValues(); rows.shift();
  const found = rows.find(r =>
    (normNama(norm(r[0])) === normNama(norm(p.nama)) ||
     norm(r[1]) === norm(p.noWa))
  );
  if (!found) return {ok:true, nonaktif:true, pesan:'Akun tidak ditemukan. Silakan login kembali.'};
  // Return data user terbaru
  const roles = norm(found[3]).split(',').map(s => s.trim()).filter(Boolean);
  let waliKelas = '';
  try {
    const shGuru = getAktifSS().getSheetByName(SHEET_GURU);
    if (shGuru) {
      const guruRows = shGuru.getDataRange().getValues();
      const iWK = guruRows[0].indexOf('WaliKelas');
      if (iWK > -1) {
        const gRow = guruRows.slice(1).find(r => normNama(norm(r[0])) === normNama(norm(found[0])));
        if (gRow) waliKelas = norm(gRow[iWK]);
      }
    }
  } catch(e) {}
  const nisnAnakListSesi = norm(found[4]).split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  // Token sesi hanya DIPERBARUI bila permintaan membawa token sah milik akun yang sama.
  // (Sebelumnya cukup menyebut nama -- siapa pun bisa memperoleh token akun lain.)
  let tokenBaru;
  try {
    const meSesi = (typeof AMAN_ !== 'undefined' && p._token) ? AMAN_.identitas(p._token) : null;
    if (meSesi && normNama(meSesi.nama) === normNama(norm(found[0]))) tokenBaru = tokenSuratWasiat_(norm(found[0])) || undefined;
  } catch (e) {}
  return {ok:true, user:{nama:norm(found[0]), noWa:norm(found[1]), roles:roles, level:roles[0], nisnAnak:norm(found[4]), nisnAnakList:nisnAnakListSesi, waliKelas:waliKelas, tokenSurat: tokenBaru}};
}

// Kumpulkan semua spreadsheet yang dipakai sistem untuk ditampilkan ke Admin/Mudir
function apiGetDaftarSpreadsheet() {
  const hasil = [];

  function tambah(label, kategori, id, keterangan) {
    if (!id) return;
    try {
      const ss = SpreadsheetApp.openById(id);
      hasil.push({
        label: label,
        kategori: kategori,
        id: id,
        url: ss.getUrl(),
        nama: ss.getName(),
        keterangan: keterangan,
        sheets: ss.getSheets().map(function(sh){ return sh.getName(); }),
      });
    } catch(e) {
      hasil.push({label:label, kategori:kategori, id:id, url:'', nama:'(tidak dapat dibuka)', keterangan:keterangan, sheets:[]});
    }
  }

  // 1. Master SS (pengaturan, daftar tahun ajaran, SOP, modul ajar, RPP, dll)
  try {
    const masterId = PROP.getProperty(MASTER_KEY);
    tambah('Master SS', 'Sistem', masterId, 'Pengaturan, SOP, Modul Ajar, RPP, Daftar Tahun Ajaran');
  } catch(e) {}

  // 2. SS per Tahun Ajaran (Absensi, Hafalan, Nilai, Jurnal, dll)
  try {
    const taList = getTahunAjaranList();
    taList.forEach(function(ta) {
      var aktifLabel = ta.aktif ? ' ⭐ (Aktif)' : '';
      tambah('Absensi ' + ta.nama + aktifLabel, 'Tahun Ajaran', ta.id,
        'Absensi, Hafalan, Nilai, Jurnal — Tahun Ajaran ' + ta.nama);
      if (ta.idSpp)
        tambah('SPP ' + ta.nama + aktifLabel, 'SPP', ta.idSpp,
          'Data pembayaran SPP — Tahun Ajaran ' + ta.nama);
      if (ta.idKantin)
        tambah('Kantin ' + ta.nama + aktifLabel, 'Kantin', ta.idKantin,
          'Transaksi kantin, saldo, topup — Tahun Ajaran ' + ta.nama);
      if (ta.idPelanggaran)
        tambah('Pelanggaran ' + ta.nama + aktifLabel, 'Pelanggaran', ta.idPelanggaran,
          'Catatan pelanggaran & prestasi — Tahun Ajaran ' + ta.nama);
    });
  } catch(e) {}

  // 3. SS Keuangan
  try {
    const keuId = PROP.getProperty(KEUANGAN_AKTIF_KEY);
    tambah('Keuangan (Aktif)', 'Keuangan', keuId, 'BKU, anggaran, laporan keuangan');
  } catch(e) {}

  return {ok: true, data: hasil};
}

// Ambil daftar kelas yang aktif (ada santri di dalamnya)
function getDaftarKelasAktif() {
  const sh = getAktifSS().getSheetByName(SHEET_ROMBEL);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  const kelasSet = new Set();
  rows.filter(r => r[0] && r[2]).forEach(r => kelasSet.add(norm(r[2])));
  // Urutkan: Kelas 7, 7A, 7B, 8, 8A, dst
  return Array.from(kelasSet).sort((a,b) => {
    const na = a.replace('Kelas ',''), nb = b.replace('Kelas ','');
    return na.localeCompare(nb, 'id', {numeric:true});
  });
}

// ============ RAPOR LENGKAP PER SANTRI ============

// Default kelompok mapel -- bisa diedit Admin/Mudir
const DEFAULT_KELOMPOK_MAPEL = [
  // [namaMapel, kodeKelompok, namaKelompok, urutan]
  // A: Mata Pelajaran Umum
  ['Pendidikan Kewarganegaraan','A','Mata Pelajaran Umum',1],
  ['PKn','A','Mata Pelajaran Umum',1],
  ['Bahasa Indonesia','A','Mata Pelajaran Umum',2],
  ['Ilmu Pengetahuan Alam','A','Mata Pelajaran Umum',3],
  ['Ilmu Pengetahuan Sosial','A','Mata Pelajaran Umum',4],
  ['Matematika','A','Mata Pelajaran Umum',5],
  ['Bahasa Inggris','A','Mata Pelajaran Umum',6],
  // B: Mata Pelajaran Kepesantrenan
  ['Al Quran/Tahsin','B','Mata Pelajaran Kepesantrenan',1],
  ['Al Qurán/Tahsin','B','Mata Pelajaran Kepesantrenan',1],
  ['Hadist','B','Mata Pelajaran Kepesantrenan',2],
  ['Aqidah','B','Mata Pelajaran Kepesantrenan',3],
  ['Akhlaq','B','Mata Pelajaran Kepesantrenan',4],
  ['Fiqih','B','Mata Pelajaran Kepesantrenan',5],
  ['Tarikh/SKI','B','Mata Pelajaran Kepesantrenan',6],
  ['Bahasa Arab','B','Mata Pelajaran Kepesantrenan',7],
  ['Ekskul Mufrodat & Do\'a','B','Mata Pelajaran Kepesantrenan',8],
  // C: Muatan Lokal
  ['Tahfizul Qur\'an','C','Muatan Lokal',1],
  ['Tarbiyah','C','Muatan Lokal',2],
  // D: Ekstrakulikuler
  ['Bela Diri','D','Ekstrakulikuler',1],
];

function getKelompokMapelList() {
  const master = getMasterSS();
  let sh = master.getSheetByName(SHEET_KELOMPOK_MAPEL);
  if (!sh) {
    sh = setupSheetKelompokMapel(master);
  }
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.filter(r => r[0]).map((r, i) => ({
    rowIndex: i+2,
    namaMapel: norm(r[0]),
    kodeKelompok: norm(r[1]),
    namaKelompok: norm(r[2]),
    urutan: Number(r[3])||1
  })).sort((a,b) => a.kodeKelompok.localeCompare(b.kodeKelompok) || a.urutan-b.urutan);
}

function setupSheetKelompokMapel(master) {
  const sh = master.insertSheet(SHEET_KELOMPOK_MAPEL);
  sh.appendRow(['Nama Mapel','Kode Kelompok','Nama Kelompok','Urutan']);
  sh.setFrozenRows(1);
  sh.getRange(2,1,DEFAULT_KELOMPOK_MAPEL.length,4).setValues(DEFAULT_KELOMPOK_MAPEL);
  return sh;
}

function apiSaveKelompokMapel(p) {
  const sh = getMasterSS().getSheetByName(SHEET_KELOMPOK_MAPEL);
  const baris = [norm(p.namaMapel), norm(p.kodeKelompok), norm(p.namaKelompok), Number(p.urutan)||1];
  if (p.rowIndex && Number(p.rowIndex)>1) sh.getRange(Number(p.rowIndex),1,1,4).setValues([baris]);
  else sh.appendRow(baris);
  return {ok:true};
}

function apiDeleteKelompokMapel(p) {
  getMasterSS().getSheetByName(SHEET_KELOMPOK_MAPEL).deleteRow(Number(p.rowIndex));
  return {ok:true};
}

// Fungsi utama: kumpulkan semua nilai per santri untuk satu kelas → rapor
function getRaporSantriLengkap(nisn, kelas) {
  nisn = norm(nisn); kelas = norm(kelas);
  const ss = getAktifSS();
  const tz = Session.getScriptTimeZone();

  // 1. Data santri
  const shSantri = ss.getSheetByName(SHEET_SANTRI);
  const santriRows = nilaiCatatanUnik_(shSantri); santriRows.shift();
  const santri = santriRows.find(r => norm(r[0]) === nisn);
  if (!santri) return {ok:false, error:'Santri tidak ditemukan'};

  // 2. Wali kelas dari sheet Guru
  const shGuru = ss.getSheetByName(SHEET_GURU);
  let waliKelas = '-';
  if (shGuru) {
    const guruRows = nilaiCatatanUnik_(shGuru);
    const hGuru = guruRows[0];
    const iWK = hGuru.indexOf('WaliKelas');
    if (iWK > -1) {
      const wkRow = guruRows.slice(1).find(r => norm(String(r[iWK]||'')) === kelas);
      if (wkRow) waliKelas = norm(wkRow[0]);
    }
  }

  // 3. Kelompok mapel
  const kelompokList = getKelompokMapelList();
  const mapKelompok = {};
  kelompokList.forEach(k => { mapKelompok[k.namaMapel.toLowerCase()] = k; });

  // 4. Daftar mapel yang ada di kelas ini
  const shMapel = ss.getSheetByName(SHEET_MAPEL);
  const mapelRows = nilaiCatatanUnik_(shMapel); mapelRows.shift();
  const mapelDiKelas = {};
  mapelRows.filter(r => norm(r[1]) === kelas).forEach(r => {
    const nama = norm(r[0]);
    if (!mapelDiKelas[nama]) mapelDiKelas[nama] = {nama, pengampu:norm(r[2])};
  });

  // 5. Nilai per mapel dari sheet Nilai
  const shNilai = ss.getSheetByName(SHEET_NILAI);
  const nilaiRows = shNilai ? nilaiCatatanUnik_(shNilai) : [];
  if (nilaiRows.length) nilaiRows.shift();

  const nilaiPerMapel = {}; // mapel → {tugas:[], uts, uas, keterampilan:[]}
  nilaiRows.filter(r => norm(r[4]) === nisn && norm(r[3]) === kelas).forEach(r => {
    const mapel = norm(r[2]), jenis = norm(r[6]), nilai = Number(r[7])||0;
    if (!nilaiPerMapel[mapel]) nilaiPerMapel[mapel] = {tugas:[], uts:null, uas:null, keterampilan:[]};
    if (jenis==='Tugas') nilaiPerMapel[mapel].tugas.push(nilai);
    else if (jenis==='UTS') nilaiPerMapel[mapel].uts = nilai;
    else if (jenis==='UAS') nilaiPerMapel[mapel].uas = nilai;
    else if (jenis==='Keterampilan') nilaiPerMapel[mapel].keterampilan.push(nilai);
  });

  // 6. Nilai sikap per mapel dari sheet Absensi
  const shAbsen = ss.getSheetByName(SHEET_ABSENSI);
  const absenRows = shAbsen ? nilaiCatatanUnik_(shAbsen) : [];
  if (absenRows.length) absenRows.shift();

  const sikapPerMapel = {}; // mapel → {totalPoin, sesi, hadirCount, total}
  absenRows.filter(r => norm(r[6])===nisn && norm(r[4])===kelas && norm(r[16])!=='Halaqoh').forEach(r => {
    const mapel = norm(r[3]), status = norm(r[8]);
    if (!sikapPerMapel[mapel]) sikapPerMapel[mapel] = {totalPoin:0, sesi:0, hadirCount:0, total:0};
    const s = sikapPerMapel[mapel];
    s.total++;
    if (status==='Hadir') s.hadirCount++;
    const poin = (Number(r[10])||0)+(Number(r[11])||0)+(Number(r[12])||0)+(Number(r[13])||0);
    if (poin>0) { s.totalPoin+=poin; s.sesi++; }
  });

  // 7. Susun hasil per kelompok
  const kelompokMap = {};
  kelompokList.forEach(k => {
    if (!kelompokMap[k.kodeKelompok]) kelompokMap[k.kodeKelompok] = {kode:k.kodeKelompok, nama:k.namaKelompok, mapel:[]};
    const d = nilaiPerMapel[k.namaMapel] || {tugas:[], uts:null, uas:null, keterampilan:[]};
    const sik = sikapPerMapel[k.namaMapel] || {totalPoin:0, sesi:0, hadirCount:0, total:0};

    const ratatugas = d.tugas.length ? Math.round(d.tugas.reduce((a,b)=>a+b,0)/d.tugas.length) : 0;
    const kehadiran = sik.total>0 ? Math.round(sik.hadirCount/sik.total*100) : 0;
    const uts = d.uts||0, uas = d.uas||0;
    const pengetahuan = (ratatugas||uts||uas||kehadiran) ?
      Math.round(ratatugas*0.35 + uts*0.25 + uas*0.30 + kehadiran*0.10) : null;
    const keterampilan = d.keterampilan.length ?
      Math.round(d.keterampilan.reduce((a,b)=>a+b,0)/d.keterampilan.length) : null;
    const rataSikap = sik.sesi>0 ? sik.totalPoin/sik.sesi : 0;
    const sikap = sik.sesi>0 ? Math.round(rataSikap/16*100) : null;

    kelompokMap[k.kodeKelompok].mapel.push({
      nama: k.namaMapel,
      pengampu: (mapelDiKelas[k.namaMapel]||{}).pengampu||'-',
      pengetahuan, keterampilan, sikap
    });
  });

  const pengaturan = getPengaturan();
  return {
    nisn, nama:norm(santri[1]),
    kelas, waliKelas,
    namaPesantren: pengaturan.NamaPesantren||'Pondok Pesantren',
    tahunAjaran: pengaturan.NamaTahunAjaran||(new Date().getFullYear()+'/'+(new Date().getFullYear()+1)),
    kelompok: ['A','B','C','D'].map(k => kelompokMap[k]).filter(Boolean)
  };
}

// Tambah kolom WaliKelas ke sheet Guru saat migrasi
function tambahKolomWaliKelas(ss) {
  const sh = ss.getSheetByName(SHEET_GURU);
  if (!sh) return;
  const header = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  if (!header.includes('WaliKelas')) {
    sh.getRange(1, header.length+1).setValue('WaliKelas');
  }
}

function getRekapNilaiRapor(mapel, kelas, pengampu) {
  mapel = norm(mapel); kelas = norm(kelas); pengampu = norm(pengampu);
  const ss = getAktifSS();
  const tz = Session.getScriptTimeZone();

  // Ambil semua nilai untuk mapel+kelas ini
  const shNilai = ss.getSheetByName(SHEET_NILAI);
  const nilaiRows = shNilai ? nilaiCatatanUnik_(shNilai) : [];
  if (nilaiRows.length) nilaiRows.shift();

  // Ambil data absensi untuk kehadiran
  const shAbsen = ss.getSheetByName(SHEET_ABSENSI);
if (!shAbsen) return {ok:false, data:[]};
  const absenRows = shAbsen ? nilaiCatatanUnik_(shAbsen) : [];
  if (absenRows.length) absenRows.shift();

  // Ambil daftar santri di kelas ini
  const shSantri = ss.getSheetByName(SHEET_SANTRI);
  const santriRows = nilaiCatatanUnik_(shSantri); santriRows.shift();
  const shRombel = ss.getSheetByName(SHEET_ROMBEL);
  const rombelRows = nilaiCatatanUnik_(shRombel); rombelRows.shift();
  const santriDiKelas = {};
  rombelRows.filter(r => norm(r[2])===kelas).forEach(r => { santriDiKelas[norm(r[0])]=true; });
  const daftarSantri = santriRows.filter(r => santriDiKelas[norm(r[0])]).map(r => ({
    nisn:norm(r[0]), nama:norm(r[1])
  })).sort((a,b) => a.nama.localeCompare(b.nama, 'id'));

  // Kumpulkan nilai per santri
  const perSantri = {};
  daftarSantri.forEach(s => {
    perSantri[s.nisn] = {
      nisn:s.nisn, nama:s.nama,
      tugas:[], uts:null, uas:null, keterampilan:[],
      hadirCount:0, totalAbsen:0,
      totalPoinSikap:0, sesiSikap:0  // untuk kalkulasi nilai sikap rapor
    };
  });

  // Isi nilai dari sheet Nilai
  nilaiRows.filter(r => norm(r[2])===mapel && norm(r[3])===kelas).forEach(r => {
    const nisn = norm(r[4]);
    if (!perSantri[nisn]) return;
    const jenis = norm(r[6]), nilai = Number(r[7])||0;
    if (jenis === 'Tugas') perSantri[nisn].tugas.push(nilai);
    else if (jenis === 'UTS') perSantri[nisn].uts = nilai;
    else if (jenis === 'UAS') perSantri[nisn].uas = nilai;
    else if (jenis === 'Keterampilan') perSantri[nisn].keterampilan.push(nilai);
  });

  // Hitung kehadiran dari sheet Absensi
  // Sekaligus kumpulkan total poin sikap untuk rapor
  absenRows.filter(r => norm(r[3])===mapel && norm(r[4])===kelas && norm(r[16])!=='Halaqoh').forEach(r => {
    const nisn = norm(r[6]);
    if (!perSantri[nisn]) return;
    perSantri[nisn].totalAbsen++;
    if (norm(r[8])==='Hadir') perSantri[nisn].hadirCount++;
    // Nilai sikap: kolom [10]=Kedisiplinan, [11]=Kesopanan, [12]=Keaktifan, [13]=Tanggung Jawab
    const s1=Number(r[10])||0, s2=Number(r[11])||0, s3=Number(r[12])||0, s4=Number(r[13])||0;
    const totalSesiIni = s1+s2+s3+s4; // max 16
    if (totalSesiIni > 0) {
      perSantri[nisn].totalPoinSikap += totalSesiIni;
      perSantri[nisn].sesiSikap++;
    }
  });

  // Hitung semua nilai rapor per santri
  return daftarSantri.map(s => {
    const d = perSantri[s.nisn];
    // Rata-rata tugas
    const ratatugas = d.tugas.length ? Math.round(d.tugas.reduce((a,b)=>a+b,0)/d.tugas.length) : 0;
    // Kehadiran dalam persen (0-100)
    const kehadiran = d.totalAbsen > 0 ? Math.round(d.hadirCount/d.totalAbsen*100) : 0;
    const uts = d.uts || 0, uas = d.uas || 0;
    // NPR = Rata-Rata*35% + UTS*25% + UAS*30% + Kehadiran*10%
    const npr = Math.round(ratatugas*0.35 + uts*0.25 + uas*0.30 + kehadiran*0.10);
    // NKR = rata-rata keterampilan (max 5 nilai)
    const nkr = d.keterampilan.length ? Math.round(d.keterampilan.reduce((a,b)=>a+b,0)/d.keterampilan.length) : 0;
    // Nilai Sikap Rapor = (Rata-rata poin per sesi ÷ 16) × 100
    // Poin per sesi = total 4 kolom sikap (max 16 per sesi)
    const rataSikapPerSesi = d.sesiSikap > 0 ? d.totalPoinSikap / d.sesiSikap : 0;
    const nilaiSikapRapor = Math.round(rataSikapPerSesi / 16 * 100);
    // Huruf dari Nilai Sikap Rapor: A>=90, B>=80, C>=70, D<70
    // (dihitung SETELAH nilaiSikapRapor ada -- dulu urutannya terbalik sehingga rekap ini galat)
    const huruf = nilaiSikapRapor>=90?'A':nilaiSikapRapor>=80?'B':nilaiSikapRapor>=70?'C':'D';
    // Total poin raw (untuk ditampilkan di kolom TOTAL seperti screenshot)
    const totalPoinRaw = d.sesiSikap > 0 ? d.totalPoinSikap : 0;
    // Nilai Sikap skala 400 (seperti screenshot: max 400 = 4 sikap × max 4 × 25 sesi? 
    // Dari screenshot terlihat nilai TOTAL sekitar 383-400, NILAI 400)
    // NILAI di screenshot = total maksimal = jumlahSesi × 16
    const nilaiMax = d.sesiSikap * 16;

    return {
      nisn:s.nisn, nama:s.nama,
      tugas: d.tugas.slice(0,11),
      ratatugas, uts, kehadiran, uas, npr,
      keterampilan: d.keterampilan.slice(0,5),
      nkr, huruf,
      totalPoinSikap: totalPoinRaw,
      nilaiMax: nilaiMax,
      nilaiSikapRapor: nilaiSikapRapor,
      sesiSikap: d.sesiSikap,
      jumlahTugas: d.tugas.length, jumlahKeterampilan: d.keterampilan.length
    };
  });
}

function getRekapNilaiSantri(nisn, tahunAjaranId) {
  const rows = getRiwayatNilai({nisn: nisn, tahunAjaranId: tahunAjaranId});
  const perMapel = {};
  rows.forEach(r => {
    if (!perMapel[r.mapel]) perMapel[r.mapel] = {Tugas:[], UTS:[], UAS:[], Keterampilan:[]};
    if (perMapel[r.mapel][r.jenisNilai]) perMapel[r.mapel][r.jenisNilai].push(Number(r.nilai));
  });
  const rata = a => a.length ? Math.round((a.reduce((x,y)=>x+y,0)/a.length)*100)/100 : null;
  const hasil = {};
  Object.keys(perMapel).forEach(m => {
    const d = perMapel[m];
    hasil[m] = { rataTugas: rata(d.Tugas), nilaiUTS: rata(d.UTS), nilaiUAS: rata(d.UAS), rataKeterampilan: rata(d.Keterampilan) };
  });
  return hasil;
}

// Rapor: gabungan rekap absensi (kehadiran % + rata sikap) dengan rekap nilai per mapel,
// nilai pengetahuan = rata tugas 35% + UTS 25% + kehadiran 10% + UAS 30%
function getRaporSantri(nisn, tahunAjaranId) {
  const rekapAbsensi = getRekapSantri(nisn, tahunAjaranId);
  const rekapNilai = getRekapNilaiSantri(nisn, tahunAjaranId);
  const mapelSet = {};
  rekapAbsensi.perMapel.forEach(m => mapelSet[m.mapel] = true);
  Object.keys(rekapNilai).forEach(m => mapelSet[m] = true);
  return Object.keys(mapelSet).map(mapel => {
    const absen = rekapAbsensi.perMapel.find(m => m.mapel === mapel) || {persen:null, rataSikap:null};
    const nilai = rekapNilai[mapel] || {rataTugas:null, nilaiUTS:null, nilaiUAS:null, rataKeterampilan:null};
    let nilaiPengetahuan = null;
    if (nilai.rataTugas!=null || nilai.nilaiUTS!=null || nilai.nilaiUAS!=null || absen.persen!=null) {
      const t = nilai.rataTugas||0, u = nilai.nilaiUTS||0, k = absen.persen||0, a = nilai.nilaiUAS||0;
      nilaiPengetahuan = Math.round((t*0.35 + u*0.25 + k*0.10 + a*0.30)*100)/100;
    }
    return { mapel: mapel, rataTugas: nilai.rataTugas, persenKehadiran: absen.persen, nilaiUTS: nilai.nilaiUTS,
      nilaiUAS: nilai.nilaiUAS, nilaiPengetahuan: nilaiPengetahuan, rataSikap: absen.rataSikap, rataKeterampilan: nilai.rataKeterampilan };
  });
}

// Tulis ulang seluruh isi sheet RekapNilai (NISN x Mapel) berdasarkan data Absensi & Nilai
// terkini. Dipanggil otomatis tiap kali ada input absensi/nilai baru, dan bisa dipicu
// manual dari menu Admin (tombol "Perbarui Rekap Nilai").
//
// PENTING SOAL PERFORMA: sheet Absensi & Nilai HANYA dibaca SEKALI di sini (bukan
// dibaca ulang per santri satu-persatu seperti versi lama), lalu rekap tiap santri
// dihitung dari data yang sudah ada di memori. Versi lama membaca ulang seluruh sheet
// untuk SETIAP santri -- pada data yang sudah banyak (ratusan santri x ribuan baris
// absensi/nilai) ini menyebabkan proses jadi sangat lambat bahkan timeout, sehingga
// absensi/nilai yang baru disimpan tampak "gagal" padahal sebenarnya prosesnya
// membeku di langkah refresh ini, bukan di langkah simpannya.
function refreshRekapNilaiSheet() {
  const ss = getAktifSS();
  const sh = ss.getSheetByName(SHEET_REKAP_NILAI);
  const rombelRows = nilaiCatatanUnik_(ss.getSheetByName(SHEET_ROMBEL)); rombelRows.shift();
  const tz = Session.getScriptTimeZone();
  const waktu = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');

  // Baca SEKALI, kelompokkan per NISN di memori.
  const absensiRows = nilaiCatatanUnik_(ss.getSheetByName(SHEET_ABSENSI)); absensiRows.shift();
  const absensiPerNisn = {};
  absensiRows.forEach(r => {
    const nisn = norm(r[6]);
    if (!absensiPerNisn[nisn]) absensiPerNisn[nisn] = [];
    absensiPerNisn[nisn].push({ mapel: norm(r[3]), status: norm(r[8]), nilaiSikap: r[14] });
  });

  const nilaiRows = nilaiCatatanUnik_(ss.getSheetByName(SHEET_NILAI)); nilaiRows.shift();
  const nilaiPerNisn = {};
  nilaiRows.forEach(r => {
    const nisn = norm(r[4]);
    if (!nilaiPerNisn[nisn]) nilaiPerNisn[nisn] = [];
    nilaiPerNisn[nisn].push({ mapel: norm(r[2]), jenisNilai: norm(r[6]), nilai: r[7] });
  });

  function rekapAbsensiDari(list) {
    const perMapel = {};
    list.forEach(r => {
      if (!perMapel[r.mapel]) perMapel[r.mapel] = {Hadir:0,total:0,totalSikap:0,jmlSikap:0};
      if (r.status === 'Hadir') perMapel[r.mapel].Hadir++;
      // Izin Pulang tetap dihitung total (bukan Hadir), sehingga persen hadir turun
      perMapel[r.mapel].total++;
      if (r.nilaiSikap !== '' && r.nilaiSikap != null && !isNaN(Number(r.nilaiSikap))) { perMapel[r.mapel].totalSikap += Number(r.nilaiSikap); perMapel[r.mapel].jmlSikap++; }
    });
    const hasil = {};
    Object.keys(perMapel).forEach(m => {
      const d = perMapel[m];
      hasil[m] = { persen: d.total ? Math.round((d.Hadir/d.total)*100) : 100, rataSikap: d.jmlSikap ? Math.round((d.totalSikap/d.jmlSikap)*100)/100 : null };
    });
    return hasil;
  }
  function rekapNilaiDari(list) {
    const perMapel = {};
    list.forEach(r => {
      if (!perMapel[r.mapel]) perMapel[r.mapel] = {Tugas:[], UTS:[], UAS:[], Keterampilan:[]};
      if (perMapel[r.mapel][r.jenisNilai]) perMapel[r.mapel][r.jenisNilai].push(Number(r.nilai));
    });
    const rata = a => a.length ? Math.round((a.reduce((x,y)=>x+y,0)/a.length)*100)/100 : null;
    const hasil = {};
    Object.keys(perMapel).forEach(m => {
      const d = perMapel[m];
      hasil[m] = { rataTugas: rata(d.Tugas), nilaiUTS: rata(d.UTS), nilaiUAS: rata(d.UAS), rataKeterampilan: rata(d.Keterampilan) };
    });
    return hasil;
  }

  const rows = [];
  rombelRows.filter(r => r[0]).forEach(r => {
    const nisn = norm(r[0]), nama = norm(r[1]), kelas = norm(r[2]);
    const rekapAbsensi = rekapAbsensiDari(absensiPerNisn[nisn] || []);
    const rekapNilai = rekapNilaiDari(nilaiPerNisn[nisn] || []);
    const mapelSet = {};
    Object.keys(rekapAbsensi).forEach(m => mapelSet[m] = true);
    Object.keys(rekapNilai).forEach(m => mapelSet[m] = true);
    Object.keys(mapelSet).forEach(mapel => {
      const absen = rekapAbsensi[mapel] || {persen:null, rataSikap:null};
      const nilai = rekapNilai[mapel] || {rataTugas:null, nilaiUTS:null, nilaiUAS:null, rataKeterampilan:null};
      let nilaiPengetahuan = null;
      if (nilai.rataTugas!=null || nilai.nilaiUTS!=null || nilai.nilaiUAS!=null || absen.persen!=null) {
        const t = nilai.rataTugas||0, u = nilai.nilaiUTS||0, k = absen.persen||0, a = nilai.nilaiUAS||0;
        nilaiPengetahuan = Math.round((t*0.35 + u*0.25 + k*0.10 + a*0.30)*100)/100;
      }
      rows.push([nisn, nama, kelas, mapel, nilai.rataTugas, absen.persen, nilai.nilaiUTS, nilai.nilaiUAS, nilaiPengetahuan, absen.rataSikap, nilai.rataKeterampilan, waktu]);
    });
  });

  const lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2,1,lastRow-1, sh.getLastColumn()).clearContent();
  if (rows.length) sh.getRange(2,1,rows.length,12).setValues(rows);
  return rows.length;
}

// Dibungkus try/catch: kalau refresh gagal, proses simpan absensi/nilai yang utama
// TETAP berhasil -- refresh sheet ini bersifat pelengkap, bukan syarat.
// Sheet RekapNilai dibangun ulang dari SELURUH data absensi & nilai -- proses paling
// berat di aplikasi. Dulu dijalankan setiap kali guru menyimpan absensi/nilai, sehingga
// guru ikut menunggu. Sekarang hanya DIJADWALKAN: dibangun ulang otomatis sekitar 5 menit
// setelah perubahan terakhir (banyak simpan berturut-turut cukup sekali bangun ulang).
// Sheet ini tidak dibaca layar aplikasi mana pun; tombol "Refresh Rekap Nilai" di menu
// Admin tetap membangunnya seketika.
const PROP_REKAP_NILAI_DIJADWAL = 'RekapNilaiDijadwalkan';
function refreshRekapNilaiAman() {
  try {
    const props = PropertiesService.getScriptProperties();
    const jadwal = Number(props.getProperty(PROP_REKAP_NILAI_DIJADWAL)) || 0;
    // Sudah ada jadwal yang belum lewat (atau baru lewat < 10 menit): tidak perlu apa-apa
    if (jadwal && Date.now() - jadwal < 10 * 60 * 1000) return;
    ScriptApp.getProjectTriggers().forEach(function(t){
      if (t.getHandlerFunction() === 'jalankanRefreshRekapNilaiTerjadwal') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('jalankanRefreshRekapNilaiTerjadwal').timeBased().after(5 * 60 * 1000).create();
    props.setProperty(PROP_REKAP_NILAI_DIJADWAL, String(Date.now()));
  } catch (err) {
    // Penjadwalan gagal (mis. izin pemicu belum diberikan): kembali ke cara lama
    try { refreshRekapNilaiSheet(); } catch (e2) { Logger.log('Gagal refresh RekapNilai: ' + e2); }
  }
}
function jalankanRefreshRekapNilaiTerjadwal() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROP_REKAP_NILAI_DIJADWAL);
  try { refreshRekapNilaiSheet(); } catch (err) { Logger.log('Gagal refresh RekapNilai: ' + err); }
  try {
    ScriptApp.getProjectTriggers().forEach(function(t){
      if (t.getHandlerFunction() === 'jalankanRefreshRekapNilaiTerjadwal') ScriptApp.deleteTrigger(t);
    });
  } catch (e) {}
}

function apiRefreshRekapNilai() {
  const jumlah = refreshRekapNilaiSheet();
  return {ok:true, jumlahBaris: jumlah};
}

// ============ SALDO & TRANSAKSI KANTIN (baca dari spreadsheet eksternal) ============
// Data saldo/transaksi TIDAK disimpan di spreadsheet tahun ajaran ini -- selalu dibaca
// langsung (real-time) dari spreadsheet kantin terpisah yang ID/nama sheet-nya diatur
// lewat menu Admin > Tampilan/Logo. Spreadsheet kantin itu WAJIB di-share (minimal akses
// "Viewer") ke akun Google yang dipakai untuk deploy Apps Script ini, kalau tidak akan gagal dibuka.
function getPengaturanKantin() {
  const p = getPengaturan();
  return {
    spreadsheetId: p.KantinSpreadsheetId || '',
    sheetSantri: p.KantinSheetSantri || 'Data Santri',
    sheetTransaksi: p.KantinSheetTransaksi || 'transaksi'
  };
}

// Parser angka format Indonesia: "20.000,00" -> 20000, "800,00" -> 800. Kalau selnya
// memang sudah berupa angka asli (bukan teks), dipakai langsung tanpa diubah.
function parseAngkaID(raw) {
  if (typeof raw === 'number') return raw;
  if (raw == null || raw === '') return 0;
  const s = String(raw).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

function apiGetDaftarSheetKantin(p) {
  const cfg = getPengaturanKantin();
  const id = (p && p.spreadsheetId) || cfg.spreadsheetId;
  if (!id) return {ok:false, error:'ID Spreadsheet Kantin belum diisi.'};
  try {
    const ss = SpreadsheetApp.openById(id);
    return {ok:true, data: ss.getSheets().map(function(s){ return s.getName(); })};
  } catch (err) {
    return {ok:false, error:'Tidak bisa membuka spreadsheet Kantin. Pastikan ID benar dan spreadsheet sudah di-share (minimal "Viewer") ke akun Google yang dipakai deploy Apps Script. Detail: ' + err};
  }
}

function getSaldoSantri(nisn) {
  nisn = norm(nisn);
  const cfg = getPengaturanKantin();
  if (!cfg.spreadsheetId) return {ok:false, error:'Fitur Saldo Kantin belum diatur Admin (ID Spreadsheet Kantin kosong).'};
  let ss;
  try { ss = SpreadsheetApp.openById(cfg.spreadsheetId); }
  catch (err) { return {ok:false, error:'Tidak bisa membuka spreadsheet Kantin. Pastikan sudah di-share ke akun Apps Script ini.'}; }
  const shSantri = ss.getSheetByName(cfg.sheetSantri);
  if (!shSantri) return {ok:false, error:'Sheet "'+cfg.sheetSantri+'" tidak ditemukan di spreadsheet Kantin. Periksa nama sheet di menu Admin > Tampilan/Logo.'};
  const rows = shSantri.getDataRange().getValues();
  if (rows.length < 2) return {ok:false, error:'Sheet "'+cfg.sheetSantri+'" masih kosong.'};
  const header = rows[0].map(function(h){ return norm(h); });
  const idxNIS = header.indexOf('NIS');
  const idxQR = header.indexOf('QR Code ID');
  const idxNama = header.indexOf('Nama Lengkap');
  const idxKelas = header.indexOf('Kelas');
  const idxLimit = header.indexOf('Limit harian');
  const idxSaldo = header.indexOf('Saldo');
  if (idxNIS === -1 || idxSaldo === -1) return {ok:false, error:'Format sheet "'+cfg.sheetSantri+'" tidak dikenali (kolom NIS atau Saldo tidak ditemukan).'};

  let baris = null;
  for (let i=1;i<rows.length;i++) { if (norm(rows[i][idxNIS]) === nisn) { baris = rows[i]; break; } }
  if (!baris) return {ok:false, error:'Data saldo untuk NIS '+nisn+' belum terdaftar di sistem Kantin.'};

  return {ok:true, data: {
    nama: idxNama !== -1 ? norm(baris[idxNama]) : '',
    kelas: idxKelas !== -1 ? norm(baris[idxKelas]) : '',
    qrId: idxQR !== -1 ? norm(baris[idxQR]) : norm(baris[idxNIS]),
    saldo: parseAngkaID(baris[idxSaldo]),
    limitHarian: idxLimit !== -1 ? parseAngkaID(baris[idxLimit]) : null
  }};
}

function getRiwayatTransaksiSantri(p) {
  const nisn = norm(p.nisn);
  const cfg = getPengaturanKantin();
  const saldoInfo = getSaldoSantri(nisn);
  if (!saldoInfo.ok) return saldoInfo;
  const qrId = saldoInfo.data.qrId;

  let ss;
  try { ss = SpreadsheetApp.openById(cfg.spreadsheetId); }
  catch (err) { return {ok:false, error:'Tidak bisa membuka spreadsheet Kantin.'}; }
  const shTrx = ss.getSheetByName(cfg.sheetTransaksi);
  if (!shTrx) return {ok:false, error:'Sheet "'+cfg.sheetTransaksi+'" tidak ditemukan di spreadsheet Kantin. Periksa nama sheet di menu Admin > Tampilan/Logo.'};
  const rows = shTrx.getDataRange().getValues();
  if (rows.length < 2) return {ok:true, data: []};
  const header = rows[0].map(function(h){ return norm(h); });
  const kolom = ['Tanggal','Waktu','QR Code ID','Nama Santri','Nominal','Nama Kantin','Nama Barang','Jumlah','Saldo Sebelumnya','Saldo Sekarang'];
  const idx = {};
  kolom.forEach(function(k){ idx[k] = header.indexOf(k); });
  if (idx['QR Code ID'] === -1) return {ok:false, error:'Format sheet "'+cfg.sheetTransaksi+'" tidak dikenali (kolom "QR Code ID" tidak ditemukan).'};

  const tz = Session.getScriptTimeZone();
  const hasil = [];
  for (let i=1;i<rows.length;i++) {
    const r = rows[i];
    if (norm(r[idx['QR Code ID']]) !== qrId) continue;
    const tglRaw = r[idx['Tanggal']];
    const tglStr = tglRaw instanceof Date ? Utilities.formatDate(tglRaw, tz, 'yyyy-MM-dd') : norm(tglRaw);
    if (p.tanggalMulai && tglStr < p.tanggalMulai) continue;
    if (p.tanggalAkhir && tglStr > p.tanggalAkhir) continue;
    const waktuRaw = idx['Waktu'] !== -1 ? r[idx['Waktu']] : '';
    const waktuStr = waktuRaw instanceof Date ? Utilities.formatDate(waktuRaw, tz, 'HH:mm:ss') : norm(waktuRaw);
    hasil.push({
      tanggal: tglStr, waktu: waktuStr,
      nominal: idx['Nominal'] !== -1 ? parseAngkaID(r[idx['Nominal']]) : 0,
      namaKantin: idx['Nama Kantin'] !== -1 ? norm(r[idx['Nama Kantin']]) : '',
      namaBarang: idx['Nama Barang'] !== -1 ? norm(r[idx['Nama Barang']]) : '',
      jumlah: idx['Jumlah'] !== -1 ? norm(r[idx['Jumlah']]) : '',
      saldoSebelumnya: idx['Saldo Sebelumnya'] !== -1 ? parseAngkaID(r[idx['Saldo Sebelumnya']]) : null,
      saldoSekarang: idx['Saldo Sekarang'] !== -1 ? parseAngkaID(r[idx['Saldo Sekarang']]) : null
    });
  }
  hasil.sort(function(a,b){ return (b.tanggal+' '+b.waktu).localeCompare(a.tanggal+' '+a.waktu); });
  return {ok:true, data: hasil};
}

// ============ WHATSAPP ============
function buildWaLink(noWa, pesan) {
  let no = String(noWa).replace(/[^0-9]/g,'');
  if (no.startsWith('0')) no = '62' + no.substring(1);
  return 'https://wa.me/' + no + '?text=' + encodeURIComponent(pesan || '');
}

// ============ PDF ============
// Ambil logo untuk PDF: pakai LogoURL dari menu Admin > Tampilan/Logo kalau diisi,
// kalau kosong atau gagal diambil, pakai logo bawaan yang sudah disematkan di kode ini.
function getLogoBase64ForPDF() {
  try {
    const pengaturan = getPengaturan();
    if (pengaturan.LogoURL) {
      const resp = UrlFetchApp.fetch(pengaturan.LogoURL, {muteHttpExceptions:true});
      if (resp.getResponseCode() === 200) {
        const blob = resp.getBlob();
        const contentType = blob.getContentType() || 'image/png';
        return 'data:' + contentType + ';base64,' + Utilities.base64Encode(blob.getBytes());
      }
    }
  } catch (err) {
    // abaikan kegagalan, pakai logo bawaan di bawah
  }
  return 'data:image/jpeg;base64,' + LOGO_DEFAULT_BASE64;
}

function apiGeneratePDF(p) {
  const logoDataUri = getLogoBase64ForPDF();
  const pengaturan = getPengaturan();
  const namaPesantren = pengaturan.NamaPesantren || 'Pondok Pesantren';
  const tz = Session.getScriptTimeZone();
  const tanggalCetak = Utilities.formatDate(new Date(), tz, 'dd MMMM yyyy HH:mm');

  let html = '<html><body style="font-family:Arial, sans-serif; font-size:12px; color:#1e293b; padding:4px">';
  html += '<table style="width:100%;border-collapse:collapse;margin-bottom:8px"><tr>' +
    '<td style="width:66px;vertical-align:middle"><img src="'+logoDataUri+'" style="width:58px;height:58px;object-fit:contain"></td>' +
    '<td style="vertical-align:middle;padding-left:10px">' +
      '<div style="font-size:16px;font-weight:bold;color:#0d9488">' + escapeHtml(namaPesantren) + '</div>' +
      '<div style="font-size:10px;color:#666">Sistem Informasi Absensi &amp; Hafalan Santri</div>' +
    '</td></tr></table>';
  html += '<hr style="border:none;border-top:2px solid #0d9488;margin:4px 0 14px">';
  html += '<h3 style="margin:0 0 3px">' + escapeHtml(p.judul || 'Laporan') + '</h3>';
  html += '<p style="margin:0 0 12px;color:#888;font-size:10px">Dicetak pada: ' + tanggalCetak + '</p>';
  html += '<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:11px">';
  html += '<tr style="background:#ccfbf1">' + p.kolom.map(k => '<th style="text-align:left">'+escapeHtml(k)+'</th>').join('') + '</tr>';
  (p.baris || []).forEach(b => { html += '<tr>' + b.map(v => '<td>'+escapeHtml(v==null||v===''? '-' : String(v))+'</td>').join('') + '</tr>'; });
  html += '</table>';
  html += '<p style="margin-top:22px;color:#aaa;font-size:9px">Dokumen ini dihasilkan otomatis oleh Sistem Absensi &amp; Hafalan Santri ' + escapeHtml(namaPesantren) + '.</p>';
  html += '</body></html>';

  const blob = Utilities.newBlob(html, 'text/html', 'laporan.html').getAs('application/pdf');
  const b64 = Utilities.base64Encode(blob.getBytes());
  return {ok:true, base64: b64, filename: (p.judul||'laporan').replace(/[^a-z0-9]/gi,'_') + '.pdf'};
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ============================================================
// PROGRES HAFALAN AWAL — baseline sebelum aplikasi digunakan
// Sheet: NISN | Nama | JuzSelesai (CSV) | JuzProses (JSON) | Catatan | DiisiOleh | Waktu
// JuzProses: [{juz:4, persen:60},{juz:5, persen:20}]
// ============================================================

function getSheetProgresAwal() {
  const ss = getAktifSS();
  let sh = ss.getSheetByName(SHEET_PROGRES_HAFALAN_AWAL);
  if (!sh) {
    sh = ss.insertSheet(SHEET_PROGRES_HAFALAN_AWAL);
    sh.appendRow(['NISN','Nama','Juz Selesai','Juz Proses','Catatan','Diisi Oleh','Waktu']);
    sh.setFrozenRows(1);
    sh.setColumnWidth(3, 200); sh.setColumnWidth(4, 250);
  }
  return sh;
}

// Ambil progres awal semua santri (map: nisn → {juzSelesai:[], juzProses:[{juz,persen}]})
function getMapProgresAwal() {
  const sh = getSheetProgresAwal();
  const rows = sh.getDataRange().getValues(); rows.shift();
  const map = {};
  rows.forEach(r => {
    var nisn = norm(r[0]);
    if (!nisn) return;
    var juzSelesai = norm(r[2]) ? String(r[2]).split(',').map(function(s){return Number(String(s).trim());}).filter(function(n){return n>=1&&n<=30;}) : [];
    var juzProses = [];
    try {
      var raw = norm(r[3]);
      if (raw) juzProses = JSON.parse(raw).filter(function(x){ return x && x.juz>=1 && x.juz<=30 && x.persen>0 && x.persen<100; });
    } catch(e) {}
    map[nisn] = {juzSelesai:juzSelesai, juzProses:juzProses};
  });
  return map;
}

// API: ambil progres awal satu santri
function apiGetProgresAwal(p) {
  const nisn = norm(p.nisn);
  if (!nisn) return {ok:false, error:'NISN wajib diisi'};
  const map = getMapProgresAwal();
  return {ok:true, data: map[nisn] || {juzSelesai:[], juzProses:[]}};
}

// API: simpan progres awal santri
function apiSimpanProgresAwal(p) {
  const nisn = norm(p.nisn);
  if (!nisn) return {ok:false, error:'NISN wajib diisi'};
  const nama = norm(p.nama || '');
  const juzSelesai = Array.isArray(p.juzSelesai) ? p.juzSelesai.filter(function(n){ return n>=1&&n<=30; }) : [];
  const juzProses = Array.isArray(p.juzProses) ? p.juzProses.filter(function(x){ return x && x.juz>=1 && x.juz<=30 && x.persen>0 && x.persen<100; }) : [];

  // Cek: kalau juz ada di juzSelesai, jangan dobel di juzProses
  const juzProsesBersih = juzProses.filter(function(x){ return juzSelesai.indexOf(x.juz) === -1; });

  const sh = getSheetProgresAwal();
  const rows = sh.getDataRange().getValues();
  let foundRow = 0;
  for (var i=1;i<rows.length;i++) {
    if (norm(rows[i][0]) === nisn) { foundRow = i+1; break; }
  }

  const rowData = [
    nisn, nama,
    juzSelesai.sort(function(a,b){return a-b;}).join(','),
    JSON.stringify(juzProsesBersih),
    norm(p.catatan||''),
    norm(p.diisiOleh||''),
    new Date()
  ];

  if (foundRow) sh.getRange(foundRow, 1, 1, 7).setValues([rowData]);
  else sh.appendRow(rowData);

  return {ok:true};
}

// API: hapus progres awal santri
function apiHapusProgresAwal(p) {
  const nisn = norm(p.nisn);
  if (!nisn) return {ok:false, error:'NISN wajib diisi'};
  const sh = getSheetProgresAwal();
  const rows = sh.getDataRange().getValues();
  for (var i=rows.length-1;i>=1;i--) {
    if (norm(rows[i][0]) === nisn) sh.deleteRow(i+1);
  }
  return {ok:true};
}

// ============================================================
// PROGRESS HAFALAN — deteksi juz yang SUDAH SELESAI
// Metode: Juz X selesai jika halaman AWAL dan halaman AKHIR sudah
//         pernah disetor sebagai Sabaq (hafalan baru).
// Referensi: Mushaf Madinah standar (604 halaman, 30 juz)
// ============================================================

/**
 * Rentang halaman per juz (Mushaf Madinah standar 604 halaman)
 * Referensi: Mushaf Rasm Utsmani cetakan King Fahd Complex
 * Juz 1: 1-21 (Al-Fatihah s/d Al-Baqarah 141)
 * Juz 2: 22-41 (Al-Baqarah 142 s/d 252)
 * Juz 30: 582-604 (An-Naba' s/d An-Nas)
 */
function getRentangJuz() {
  // Halaman awal setiap juz — Mushaf Utsmani/Madinah 604 halaman.
  // Diverifikasi terhadap daftar juz aplikasi Qur'an (Sept 2026).
  // Catatan: juz TIDAK selalu pas 20 halaman. Juz 6 dan juz 10 hanya
  // 19 halaman, sedangkan juz 7 dan juz 11 mulai 1 halaman lebih awal.
  const juzAwal = {
    1:1,   2:22,  3:42,  4:62,  5:82,   6:102, 7:121, 8:142, 9:162, 10:182,
    11:201,12:222,13:242,14:262,15:282, 16:302,17:322,18:342,19:362,20:382,
    21:402,22:422,23:442,24:462,25:482, 26:502,27:522,28:542,29:562,30:582
  };
  const range = {};
  for (var j = 1; j <= 30; j++) {
    var awal = juzAwal[j];
    var akhir = (j < 30) ? (juzAwal[j+1] - 1) : 604;
    range[j] = {awal: awal, akhir: akhir};
  }
  return range;
}

/**
 * Hitung progress hafalan untuk satu santri berdasarkan halaman Sabaq
 * DIGABUNG dengan progres awal (baseline sebelum aplikasi).
 * Return: {juzSelesai:[1,2,3,30], juzInProgress:[4], totalJuz:4, persen:13.3, detail:{...}}
 */
function hitungProgressHafalanSantri(nisn, hafalanRows, progresAwal) {
  const rentangJuz = getRentangJuz();
  const halamanTersetor = new Set(); // halaman yang pernah disetor Sabaq

  // Filter hanya jenis Sabaq milik santri ini
  hafalanRows.forEach(r => {
    if (norm(r[4]) !== nisn) return;
    if (norm(r[6]) !== 'Sabaq') return; // hanya Sabaq
    // Kolom "Halaman Ke" bisa berupa:
    //  - angka tunggal        : "12"
    //  - rentang tunggal      : "82 - 101"
    //  - multi-rentang (juz)  : "1 - 21, 82 - 101, 182 - 201"
    var raw = String(norm(r[10]) || '');
    if (!raw) return;
    // Ambil SEMUA rentang di string (pakai matchAll agar semua ter-parse)
    var re = /(\d+)\s*(?:-\s*(\d+))?/g;
    var m;
    while ((m = re.exec(raw)) !== null) {
      var awal = Number(m[1]);
      var akhir = m[2] ? Number(m[2]) : awal;
      if (awal < 1 || awal > 604) continue;
      if (akhir < awal || akhir > 604) akhir = awal;
      for (var h = awal; h <= akhir; h++) {
        halamanTersetor.add(h);
      }
    }
  });

  // Ambil progres awal (baseline) santri
  const progAwal = progresAwal || {juzSelesai:[], juzProses:[]};
  const juzSelesaiAwal = progAwal.juzSelesai || [];
  const juzProsesAwal = progAwal.juzProses || []; // [{juz, persen}]

  // Cek setiap juz: SELESAI jika (halaman awal & akhir sudah tersetor) ATAU (juz di juzSelesaiAwal)
  const juzSelesai = [];
  const juzInProgress = [];
  const detailJuz = {};
  var totalHalamanTersetor = halamanTersetor.size;

  for (var j = 1; j <= 30; j++) {
    var r = rentangJuz[j];
    var halamanJuzIni = 0;
    for (var h = r.awal; h <= r.akhir; h++) {
      if (halamanTersetor.has(h)) halamanJuzIni++;
    }
    var totalHalamanJuz = r.akhir - r.awal + 1;
    var selesaiAwal = halamanTersetor.has(r.awal);
    var selesaiAkhir = halamanTersetor.has(r.akhir);
    var selesaiViaSabaq = selesaiAwal && selesaiAkhir;
    var selesaiViaAwal = juzSelesaiAwal.indexOf(j) !== -1;

    // Progres awal untuk juz yang sedang dihafal (belum selesai)
    var prosesAwalJuz = juzProsesAwal.find(function(x){ return x.juz === j; });
    var persenAwal = prosesAwalJuz ? prosesAwalJuz.persen : 0;

    // Persentase total: gabung dari Sabaq (halaman) dan progres awal
    var persenSabaq = totalHalamanJuz > 0 ? Math.round((halamanJuzIni/totalHalamanJuz)*100) : 0;
    var persenGabungan = Math.max(persenSabaq, persenAwal);
    if (selesaiViaAwal || selesaiViaSabaq) persenGabungan = 100;

    var sumber = [];
    if (selesaiViaAwal) sumber.push('baseline');
    if (selesaiViaSabaq) sumber.push('sabaq');
    else if (persenSabaq > 0) sumber.push('sabaq');
    else if (persenAwal > 0) sumber.push('baseline');

    detailJuz[j] = {
      juz: j,
      halamanAwal: r.awal,
      halamanAkhir: r.akhir,
      totalHalaman: totalHalamanJuz,
      halamanTersetor: halamanJuzIni,
      persenJuz: persenGabungan,
      awalTersetor: selesaiAwal,
      akhirTersetor: selesaiAkhir,
      selesai: selesaiViaAwal || selesaiViaSabaq,
      sumber: sumber.join('+') || null, // 'baseline', 'sabaq', 'baseline+sabaq'
    };

    if (selesaiViaAwal || selesaiViaSabaq) juzSelesai.push(j);
    else if (persenGabungan > 0) juzInProgress.push(j);
  }

  // Total halaman efektif: halaman Sabaq + estimasi dari juz selesai baseline
  var halamanDariBaseline = 0;
  juzSelesaiAwal.forEach(function(j){
    if (juzSelesai.indexOf(j) !== -1) {
      var r = rentangJuz[j];
      var totalHalJuz = r.akhir - r.awal + 1;
      // Kurangi halaman yang sudah dihitung dari Sabaq di juz ini
      var halSabaqJuzIni = 0;
      for (var h = r.awal; h <= r.akhir; h++) if (halamanTersetor.has(h)) halSabaqJuzIni++;
      halamanDariBaseline += (totalHalJuz - halSabaqJuzIni);
    }
  });
  // Untuk juz proses baseline (belum selesai), estimasi dari persen
  juzProsesAwal.forEach(function(x){
    if (juzSelesai.indexOf(x.juz) !== -1) return; // sudah dihitung sbg selesai
    var r = rentangJuz[x.juz];
    var totalHalJuz = r.akhir - r.awal + 1;
    var halBaseline = Math.round(totalHalJuz * x.persen / 100);
    var halSabaqJuzIni = 0;
    for (var h = r.awal; h <= r.akhir; h++) if (halamanTersetor.has(h)) halSabaqJuzIni++;
    if (halBaseline > halSabaqJuzIni) {
      halamanDariBaseline += (halBaseline - halSabaqJuzIni);
    }
  });

  var totalHalamanEfektif = totalHalamanTersetor + halamanDariBaseline;
  const persenTotal = Math.round((totalHalamanEfektif / 604) * 100 * 10) / 10; // 1 desimal

  return {
    nisn: nisn,
    juzSelesai: juzSelesai,
    juzInProgress: juzInProgress,
    totalJuzSelesai: juzSelesai.length,
    totalHalamanTersetor: totalHalamanEfektif,
    halamanSabaq: totalHalamanTersetor, // dari setoran via app
    halamanBaseline: halamanDariBaseline, // dari input awal
    persen: persenTotal,
    detailJuz: detailJuz,
    ringkasan: buildRingkasanHafalan(juzSelesai, juzInProgress, detailJuz),
    punyaProgresAwal: (juzSelesaiAwal.length + juzProsesAwal.length) > 0,
  };
}

/**
 * Buat ringkasan teks: "5 juz selesai (Juz 1, 2, 3, 29, 30) · sedang menghafal Juz 4"
 */
function buildRingkasanHafalan(juzSelesai, juzInProgress, detailJuz) {
  if (!juzSelesai.length && !juzInProgress.length) {
    return 'Belum ada catatan hafalan';
  }
  var parts = [];
  if (juzSelesai.length) {
    parts.push(juzSelesai.length + ' juz selesai (Juz ' + juzSelesai.join(', ') + ')');
  }
  if (juzInProgress.length) {
    var inProgDetail = juzInProgress.map(function(j){
      return 'Juz ' + j + ' (' + detailJuz[j].persenJuz + '%)';
    });
    parts.push('sedang: ' + inProgDetail.join(', '));
  }
  return parts.join(' · ');
}

/**
 * API untuk satu santri
 */
function apiGetProgressHafalan(p) {
  const nisn = norm(p.nisn);
  if (!nisn) return {ok:false, error:'NISN wajib diisi'};

  const ss = getAktifSS();
  const sh = ss.getSheetByName(SHEET_HAFALAN);
  const rows = sh ? nilaiCatatanUnik_(sh).slice(1) : [];
  const mapAwal = getMapProgresAwal();
  const hasil = hitungProgressHafalanSantri(nisn, rows, mapAwal[nisn]);

  // Ambil nama santri
  const shSantri = ss.getSheetByName(SHEET_SANTRI);
  var nama = '';
  if (shSantri) {
    const found = nilaiCatatanUnik_(shSantri).slice(1).find(function(r){ return norm(r[0]) === nisn; });
    if (found) nama = norm(found[1]);
  }
  hasil.nama = nama;
  return {ok:true, data:hasil};
}

/**
 * API untuk banyak santri (untuk rekap kelas/halaqoh)
 * Bisa filter: kelas, halaqoh, gender
 */
function apiGetProgressHafalanMassal(p) {
  const ss = getAktifSS();
  const sh = ss.getSheetByName(SHEET_HAFALAN);
  const shSantri = ss.getSheetByName(SHEET_SANTRI);
  if (!shSantri) return {ok:false, error:'Sheet Santri belum ada'};

  const hafalanRows = sh ? nilaiCatatanUnik_(sh).slice(1) : [];
  const mapAwal = getMapProgresAwal();
  const santriRows = nilaiCatatanUnik_(shSantri);
  const header = santriRows[0];
  const iJK = header.indexOf('Jenis Kelamin');
  santriRows.shift();

  // Filter santri berdasarkan gender kalau ada
  var santriFilter = santriRows.filter(function(r){
    if (!norm(r[0])) return false;
    if (p.gender === 'Putra') return norm(iJK>-1?r[iJK]:r[3]).toLowerCase() === 'laki-laki';
    if (p.gender === 'Putri') return norm(iJK>-1?r[iJK]:r[3]).toLowerCase() === 'perempuan';
    return true;
  });

  // Filter kelas kalau ada
  if (p.kelas) {
    const shRombel = ss.getSheetByName(SHEET_ROMBEL);
    const nisnKelas = {};
    if (shRombel) {
      nilaiCatatanUnik_(shRombel).slice(1).forEach(function(r){
        if (r[0]) nisnKelas[norm(r[0])] = norm(r[2]);
      });
    }
    santriFilter = santriFilter.filter(function(r){ return nisnKelas[norm(r[0])] === p.kelas; });
  }

  // Filter berdasarkan pengampu halaqoh Al-Qur'an
  // Guru pengampu hanya melihat santri di halaqoh yang dia ampu
  if (p.pengampu) {
    const nisnDiHalaqoh = new Set();
    try {
      const halaqohList = getHalaqohList().filter(function(h){
        return pengampuCocok(h.pengampuList, norm(p.pengampu));
      });
      halaqohList.forEach(function(h){
        (h.santriList||[]).forEach(function(s){ if (s.nisn) nisnDiHalaqoh.add(norm(s.nisn)); });
      });
    } catch(e) {}
    santriFilter = santriFilter.filter(function(r){ return nisnDiHalaqoh.has(norm(r[0])); });
  }

  // Hitung progress per santri
  const hasil = santriFilter.map(function(s){
    var nisn = norm(s[0]);
    var pr = hitungProgressHafalanSantri(nisn, hafalanRows, mapAwal[nisn]);
    pr.nama = norm(s[1]);
    return pr;
  });

  // Urutkan: yang paling banyak juz selesai dulu
  hasil.sort(function(a,b){
    if (b.totalJuzSelesai !== a.totalJuzSelesai) return b.totalJuzSelesai - a.totalJuzSelesai;
    return b.totalHalamanTersetor - a.totalHalamanTersetor;
  });

  return {ok:true, data:hasil};
}

// ============================================================
// Sheet Perizinan: ID | NISN | Nama | Kelas | JenisIzin | Keperluan |
//   TglKeluar | JamKeluar | TglKembaliRencana | JamKembaliRencana |
//   Status | DiajukanOleh | WaktuAjuan |
//   DisetujuiOleh | WaktuSetuju | TglKembaliAktual | WaktuKonfirmasi |
//   Catatan | NoWaOrtu
// Status: Menunggu | Disetujui | Ditolak | Sudah Kembali
// JenisIzin: Tidak Bermalam | Bermalam
// ============================================================

function getSheetPerizinan() {
  const ss = getAktifSS();
  let sh = ss.getSheetByName(SHEET_PERIZINAN);
  if (!sh) {
    sh = ss.insertSheet(SHEET_PERIZINAN);
    sh.appendRow([
      'ID','NISN','Nama Santri','Kelas','Jenis Izin','Keperluan',
      'Tgl Keluar','Jam Keluar','Tgl Kembali (Rencana)','Jam Kembali (Rencana)',
      'Status','Diajukan Oleh','Waktu Ajuan',
      'Disetujui/Ditolak Oleh','Waktu Setuju/Tolak',
      'Tgl Kembali (Aktual)','Waktu Konfirmasi Kembali',
      'Catatan','No WA Ortu'
    ]);
    sh.setFrozenRows(1);
    sh.setColumnWidth(1,80); sh.setColumnWidth(5,120);
  }
  return sh;
}

function buatIdIzin() {
  return 'IZN-'+Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyyMMddHHmmss')+
    '-'+Math.floor(Math.random()*900+100);
}

// Ajukan izin baru (oleh Pembina atau Wali)
function apiAjukanIzin(p) {
  const nisn = norm(p.nisn);
  if (!nisn) return {ok:false, error:'NISN santri wajib diisi'};

  // Ambil data santri
  const shSantri = getAktifSS().getSheetByName(SHEET_SANTRI);
  if (!shSantri) return {ok:false, error:'Sheet Santri tidak ditemukan'};
  const rows = shSantri.getDataRange().getValues();
  const header = rows[0];
  const iNoWa = header.indexOf('No WA Ortu');
  const found = rows.slice(1).find(r => norm(r[0]) === nisn);
  if (!found) return {ok:false, error:'Santri tidak ditemukan di database'};

  const namaSantri = norm(found[1]);
  const noWaOrtu   = norm(iNoWa>-1 ? found[iNoWa] : found[4]);

  // Ambil kelas dari Rombel
  let kelas = '-';
  try {
    const shRombel = getAktifSS().getSheetByName(SHEET_ROMBEL);
    if (shRombel) {
      const rRow = shRombel.getDataRange().getValues().slice(1).find(r=>norm(r[0])===nisn);
      if (rRow) kelas = norm(rRow[2]);
    }
  } catch(e) {}

  const id = buatIdIzin();
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const jenis = p.jenisIzin || 'Tidak Bermalam'; // 'Tidak Bermalam' | 'Bermalam'

  const sh = getSheetPerizinan();
  sh.appendRow([
    id, nisn, namaSantri, kelas, jenis,
    norm(p.keperluan||''), norm(p.tglKeluar||''), norm(p.jamKeluar||''),
    norm(p.tglKembaliRencana||''), norm(p.jamKembaliRencana||''),
    'Menunggu', norm(p.diajukanOleh||''), now,
    '','','','','', noWaOrtu
  ]);

  // Kirim WA ke wali santri
  const namaLengkap = namaSantri;
  const pesanWali = '📋 *Pengajuan Izin Santri*\n\n' +
    'Assalamu\'alaikum Wr. Wb.\n\n' +
    'Putra/putri Anda:\n*' + namaLengkap + '* ('+kelas+')\n\n' +
    'Mengajukan izin *' + jenis + '*\n' +
    '📅 Keluar: ' + norm(p.tglKeluar||'-') + ' ' + norm(p.jamKeluar||'') + '\n' +
    '📅 Kembali: ' + norm(p.tglKembaliRencana||'-') + ' ' + norm(p.jamKembaliRencana||'') + '\n' +
    '📝 Keperluan: ' + norm(p.keperluan||'-') + '\n\n' +
    '⏳ Status: *Menunggu persetujuan Pembina*\n\n' +
    'No. Referensi: ' + id + '\n_Wassalamu\'alaikum Wr. Wb._';

  if (noWaOrtu) {
    try { kirimWAKategori_('izin_santri_pengajuan', noWaOrtu, pesanWali); } catch(e) {}
  }

  return {ok:true, id:id, namaSantri:namaSantri, status:'Menunggu'};
}

// Ambil daftar izin (dengan filter)
function apiGetDaftarIzin(p) {
  const sh = getSheetPerizinan();
  if (sh.getLastRow() <= 1) return {ok:true, data:[]};
  const tz = Session.getScriptTimeZone();
  const rows = sh.getDataRange().getValues(); rows.shift();

  let data = rows.map(r => ({
    id:norm(r[0]), nisn:norm(r[1]), nama:norm(r[2]), kelas:norm(r[3]),
    jenisIzin:norm(r[4]), keperluan:norm(r[5]),
    tglKeluar:norm(r[6]), jamKeluar:norm(r[7]),
    tglKembaliRencana:norm(r[8]), jamKembaliRencana:norm(r[9]),
    status:norm(r[10]), diajukanOleh:norm(r[11]),
    waktuAjuan: r[12] instanceof Date ? Utilities.formatDate(r[12],tz,'dd/MM/yyyy HH:mm') : norm(r[12]),
    disetujuiOleh:norm(r[13]),
    tglKembaliAktual:norm(r[15]),
    catatan:norm(r[17]), noWaOrtu:norm(r[18]),
  }));

  // Filter
  if (p.status)     data = data.filter(d => d.status === p.status);
  if (p.nisn)       data = data.filter(d => d.nisn === norm(p.nisn));
  if (p.tglMulai)   data = data.filter(d => d.tglKeluar >= p.tglMulai);
  if (p.tglAkhir)   data = data.filter(d => d.tglKeluar <= p.tglAkhir);
  if (p.jenisIzin)  data = data.filter(d => d.jenisIzin === p.jenisIzin);

  // Hanya izin yang aktif (belum kembali) untuk status pondok
  if (p.aktif) data = data.filter(d =>
    (d.status === 'Disetujui' || d.status === 'Menunggu') && !d.tglKembaliAktual
  );

  // Urutkan: terbaru dulu
  data.sort((a,b) => b.waktuAjuan.localeCompare(a.waktuAjuan));

  return {ok:true, data:data};
}

// Setujui izin
function apiApproveIzin(p) {
  const sh = getSheetPerizinan();
  const rows = sh.getDataRange().getValues();
  for (var i=1;i<rows.length;i++) {
    if (norm(rows[i][0]) === norm(p.id)) {
      sh.getRange(i+1,11,1,4).setValues([['Disetujui',norm(p.oleh),new Date(),'']]);
      // WA ke wali
      const noWa = norm(rows[i][18]);
      const nama  = norm(rows[i][2]);
      const jenis = norm(rows[i][4]);
      const tglK  = norm(rows[i][6])+' '+norm(rows[i][7]);
      const tglPulang = norm(rows[i][8])+' '+norm(rows[i][9]);
      if (noWa) {
        try {
          kirimWAKategori_('izin_santri_keputusan', noWa,
            '✅ *Izin Santri DISETUJUI*\n\n' +
            'Putra/putri Anda: *'+nama+'*\n' +
            'Jenis: *'+jenis+'*\n' +
            '📅 Keluar: '+tglK+'\n' +
            '📅 Kembali: '+tglPulang+'\n\n' +
            'Izin telah disetujui oleh: '+norm(p.oleh)+'\n' +
            'No. Ref: '+norm(p.id)+'\n\n' +
            '_Mohon pastikan santri kembali tepat waktu._'
          );
        } catch(e) {}
      }
      return {ok:true};
    }
  }
  return {ok:false, error:'Izin tidak ditemukan'};
}

// Tolak izin
function apiTolakIzin(p) {
  const sh = getSheetPerizinan();
  const rows = sh.getDataRange().getValues();
  for (var i=1;i<rows.length;i++) {
    if (norm(rows[i][0]) === norm(p.id)) {
      sh.getRange(i+1,11,1,5).setValues([['Ditolak',norm(p.oleh),new Date(),'',norm(p.alasan||'')]]);
      const noWa = norm(rows[i][18]);
      const nama  = norm(rows[i][2]);
      if (noWa) {
        try {
          kirimWAKategori_('izin_santri_keputusan', noWa,
            '❌ *Izin Santri TIDAK Disetujui*\n\n' +
            'Putra/putri Anda: *'+nama+'*\n' +
            'Alasan: '+(p.alasan||'Tidak disebutkan')+'\n\n' +
            'No. Ref: '+norm(p.id)+'\n\n' +
            '_Silakan hubungi pihak pondok untuk informasi lebih lanjut._'
          );
        } catch(e) {}
      }
      return {ok:true};
    }
  }
  return {ok:false, error:'Izin tidak ditemukan'};
}

// Konfirmasi santri sudah kembali
function apiKonfirmasiKembali(p) {
  const sh = getSheetPerizinan();
  const tz = Session.getScriptTimeZone();
  const rows = sh.getDataRange().getValues();
  for (var i=1;i<rows.length;i++) {
    if (norm(rows[i][0]) === norm(p.id)) {
      const now = new Date();
      const tglAktual = Utilities.formatDate(now,tz,'yyyy-MM-dd');
      sh.getRange(i+1,11).setValue('Sudah Kembali');
      sh.getRange(i+1,16).setValue(tglAktual);
      sh.getRange(i+1,17).setValue(now);
      if (p.catatan) sh.getRange(i+1,18).setValue(norm(p.catatan));
      const noWa = norm(rows[i][18]);
      const nama  = norm(rows[i][2]);
      if (noWa) {
        try {
          kirimWAKategori_('izin_santri_kembali', noWa,
            '🏠 *Santri Sudah Kembali ke Pondok*\n\n' +
            'Putra/putri Anda: *'+nama+'*\n' +
            'Telah kembali: '+Utilities.formatDate(now,tz,'dd/MM/yyyy HH:mm')+'\n' +
            'Dikonfirmasi oleh: '+norm(p.oleh||'Pembina')+'\n\n' +
            'No. Ref: '+norm(p.id)+'\n\n' +
            '_Alhamdulillah, santri sudah kembali dengan selamat._'
          );
        } catch(e) {}
      }
      return {ok:true};
    }
  }
  return {ok:false, error:'Izin tidak ditemukan'};
}

// Wali santri lihat izin anaknya
function apiGetIzinSantriSaya(p) {
  const nisn = norm(p.nisn);
  if (!nisn) return {ok:false, error:'NISN tidak valid'};
  return apiGetDaftarIzin({nisn:nisn});
}

// ============================================================ (Pembina Putra / Pembina Putri)
// Sheet: ABSENSI_HARIAN di spreadsheet aktif semester
// Kolom: Tanggal | Sesi | NISN | Nama | Kelas | Status | Keterangan | Dicatat Oleh | Waktu
// ============================================================

const SHEET_ABSENSI_HARIAN = 'AbsensiHarian';
const SHEET_PERIZINAN      = 'Perizinan'; // sistem perizinan santri
const SHEET_TUGAS_PEMBINA  = 'TugasPembina';   // master daftar tugas (dibuat Mudir/Admin)
const SHEET_REALISASI_TUGAS = 'RealisasiTugas'; // centangan harian per Pembina
// Daftar tugas pembina (master, BUKAN centangan hariannya) ikut disalin otomatis ke
// tahun ajaran baru -- sama seperti Guru/MataPelajaran -- supaya Mudir tidak perlu
// menyusun ulang daftar tugas tiap ganti tahun ajaran. RealisasiTugas sengaja tidak
// ditambahkan di sini: centangan harian memang harus tetap kosong/fresh tiap tahun
// ajaran baru, sama seperti data Absensi.
SHEETS_DISALIN.push(SHEET_TUGAS_PEMBINA);

// Ambil semua santri sesuai gender pembina
function apiGetSantriHarian(p) {
  const gender = norm(p.gender || ''); // 'Putra' atau 'Putri'
  const ss = getAktifSS();
  const shSantri = ss.getSheetByName(SHEET_SANTRI);
  if (!shSantri) return {ok:false, error:'Sheet Santri tidak ditemukan.'};
  const rows = nilaiCatatanUnik_(shSantri);
  const header = rows[0];
  const iJK = header.indexOf('Jenis Kelamin'); // kolom 3
  rows.shift();

  const jenisFilter = gender === 'Putra' ? 'laki-laki' : gender === 'Putri' ? 'perempuan' : '';

  // Ambil kelas dari Rombel
  const shRombel = ss.getSheetByName(SHEET_ROMBEL);
  const mapKelas = {};
  if (shRombel) {
    nilaiCatatanUnik_(shRombel).slice(1).forEach(r => {
      if (r[0]) mapKelas[norm(r[0])] = norm(r[2]);
    });
  }

  const santri = rows.filter(r => {
    if (!norm(r[0])) return false;
    if (jenisFilter) {
      const jk = norm(iJK > -1 ? r[iJK] : r[3]).toLowerCase();
      return jk === jenisFilter;
    }
    return true;
  }).map(r => ({
    nisn: norm(r[0]),
    nama: norm(r[1]),
    kelas: mapKelas[norm(r[0])] || '-',
    jk: norm(iJK > -1 ? r[iJK] : r[3]),
    noWa: norm(r[4] || ''),
  })).sort((a,b) => a.nama.localeCompare(b.nama));

  // Cek sudah ada absensi hari ini?
  const tz = Session.getScriptTimeZone();
  const tanggalHariIni = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const sesi = norm(p.sesi || 'Harian');
  const shHarian = ss.getSheetByName(SHEET_ABSENSI_HARIAN);
  const sudahAbsen = {};
  if (shHarian && shHarian.getLastRow() > 1) {
    nilaiCatatanUnik_(shHarian).slice(1).forEach(r => {
      const tgl = r[0] instanceof Date
        ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd')
        : norm(r[0]);
      if (tgl === tanggalHariIni && normNama(norm(r[2])) === normNama(p.gender||'') || tgl === tanggalHariIni) {
        if (norm(r[1]) === sesi) sudahAbsen[norm(r[2])] = {status:norm(r[5]), ket:norm(r[6])};
      }
    });
  }

  return {ok:true, data:santri, sudahAbsen:sudahAbsen, tanggal:tanggalHariIni};
}

// Submit absensi harian
function apiSubmitAbsensiHarian(p) {
  if (!p || !p.items || !p.items.length) return {ok:false, error:'Tidak ada data absensi.'};
  const hasil = denganKunciCatatan_(function(){ return simpanAbsensiHarian_(p); });
  if (!hasil || !hasil.ok) return hasil;
  const tanggal = hasil._tanggal, sesi = hasil._sesi; delete hasil._tanggal; delete hasil._sesi;

  // Kirim WA ke ortu santri yang tidak hadir (tanpa izin)
  const tidakHadir = p.items.filter(i => i.status === 'Alpa' && i.noWa);
  tidakHadir.forEach(s => {
    try {
      kirimWAKategori_('absen_harian', s.noWa,
        '⚠️ *Informasi Kehadiran Santri*\n\n' +
        'Assalamu\'alaikum Wr. Wb.\n\n' +
        'Kami informasikan bahwa putra/putri Anda:\n' +
        '*Nama: ' + s.nama + '*\n\n' +
        'Tidak hadir pada absensi harian ' + sesi + ' tanggal ' + tanggal + '.\n\n' +
        'Mohon konfirmasi kepada pihak pesantren.\n\n' +
        '_Wassalamu\'alaikum Wr. Wb._'
      );
    } catch(e) {}
  });
  hasil.tidakHadir = tidakHadir.length;
  return hasil;
}

function simpanAbsensiHarian_(p) {
  const ss = getAktifSS();
  let sh = ss.getSheetByName(SHEET_ABSENSI_HARIAN);
  if (!sh) {
    sh = ss.insertSheet(SHEET_ABSENSI_HARIAN);
    sh.appendRow(['Tanggal','Sesi','NISN','Nama','Kelas','Status','Keterangan','Dicatat Oleh','Waktu']);
    sh.setFrozenRows(1);
  }
  const tz = Session.getScriptTimeZone();
  const tanggal = p.tanggal || Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const sesi = p.sesi || 'Harian';
  const waktu = new Date();

  // Simpan ulang sesi yang sama = PERBARUI catatan santri yang dikirim (yang terbaru dipakai).
  // Dulu seluruh baris sesi itu dihapus lalu ditulis ulang -- akibatnya bila pembina
  // putra dan pembina putri mengisi sesi yang sama, kiriman kedua menghapus catatan
  // asrama lain. Sekarang hanya santri yang ada di kiriman ini yang diperbarui.
  const existing = bacaBarisPadaTanggal_(sh, tanggal);
  const indexBaris = {};
  for (let i=1;i<existing.length;i++) {
    if (tglKunciCatatan_(existing[i][0], tz) !== tanggal) continue;
    if (normNama(norm(existing[i][1])) !== normNama(sesi)) continue;
    const k = norm(existing[i][2]);
    if (k) (indexBaris[k] = indexBaris[k] || []).push(i+1);
  }

  const rowsToAdd = [];
  const diubah = {}; // nomor baris -> isi kolom 4..9 yang baru
  let diupdate = 0;
  p.items.forEach(function(item){
    const isi = [item.nama, item.kelas||'-', item.status, item.keterangan||'', p.dicatatOleh||'', waktu];
    const daftarBaris = indexBaris[norm(item.nisn)];
    if (daftarBaris && daftarBaris.length) {
      daftarBaris.forEach(function(b){ diubah[b] = isi; });
      diupdate++;
    } else {
      rowsToAdd.push([tanggal, sesi, item.nisn].concat(isi));
    }
  });
  // Baris yang berurutan ditulis sekaligus per blok supaya cepat; baris lain tidak disentuh.
  const nomor = Object.keys(diubah).map(Number).sort(function(a,b){ return a-b; });
  for (let k = 0; k < nomor.length; ) {
    let akhir = k;
    while (akhir + 1 < nomor.length && nomor[akhir + 1] === nomor[akhir] + 1) akhir++;
    const blok = nomor.slice(k, akhir + 1).map(function(b){ return diubah[b]; });
    sh.getRange(nomor[k], 4, blok.length, 6).setValues(blok);
    k = akhir + 1;
  }
  if (rowsToAdd.length) sh.getRange(sh.getLastRow()+1, 1, rowsToAdd.length, 9).setValues(rowsToAdd);

  return {ok:true, total:p.items.length, ditambah:rowsToAdd.length, diupdate:diupdate, _tanggal:tanggal, _sesi:sesi};
}

// Rekap kehadiran harian per santri
function apiGetRekapAbsensiHarian(p) {
  const ss = getAktifSS();
  const sh = ss.getSheetByName(SHEET_ABSENSI_HARIAN);
  if (!sh || sh.getLastRow() <= 1) return {ok:true, data:[], totalHari:0};

  const tz = Session.getScriptTimeZone();
  const rows = nilaiCatatanUnik_(sh); rows.shift();

  const tglMulai = p.tglMulai || '';
  const tglAkhir = p.tglAkhir || '';
  const gender   = norm(p.gender || '');

  // Filter berdasarkan tanggal
  const filtered = rows.filter(r => {
    const tgl = r[0] instanceof Date
      ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd')
      : norm(r[0]);
    if (tglMulai && tgl < tglMulai) return false;
    if (tglAkhir && tgl > tglAkhir) return false;
    return true;
  });

  // Kelompokkan per santri
  const perSantri = {};
  const hariUnik = new Set();
  filtered.forEach(r => {
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
    hariUnik.add(tgl);
    const nisn = norm(r[2]);
    if (!perSantri[nisn]) perSantri[nisn] = {nisn, nama:norm(r[3]), kelas:norm(r[4]), hadir:0, sakit:0, izin:0, izinPulang:0, alpa:0, total:0};
    const s = norm(r[5]);
    perSantri[nisn].total++;
    if (s==='Hadir') perSantri[nisn].hadir++;
    else if (s==='Sakit') perSantri[nisn].sakit++;
    else if (s==='Izin') perSantri[nisn].izin++;
    else if (s==='Izin Pulang') perSantri[nisn].izinPulang++;   // dulu digabung ke Izin
    else perSantri[nisn].alpa++;
  });

  // Filter gender kalau diminta
  const shSantri = ss.getSheetByName(SHEET_SANTRI);
  const jkMap = {};
  if (shSantri) {
    const santriRows = nilaiCatatanUnik_(shSantri);
    const iJK = santriRows[0].indexOf('Jenis Kelamin');
    santriRows.slice(1).forEach(r => { if (r[0]) jkMap[norm(r[0])] = norm(iJK>-1?r[iJK]:r[3]); });
  }

  let data = Object.values(perSantri);
  if (gender === 'Putra') data = data.filter(s => (jkMap[s.nisn]||'').toLowerCase() === 'laki-laki');
  if (gender === 'Putri') data = data.filter(s => (jkMap[s.nisn]||'').toLowerCase() === 'perempuan');

  data = data.map(s => ({
    ...s,
    persen: s.total > 0 ? Math.round((s.hadir/s.total)*100) : 0
  })).sort((a,b) => a.nama.localeCompare(b.nama));

  return {ok:true, data, totalHari: hariUnik.size};
}

// Kartu rekap bulanan: santri dengan setoran Sabaq terbanyak, izin terbanyak, dan
// sakit terbanyak. Izin & sakit dihitung per HARI dari absensi harian pembina (bukan per
// sesi), supaya santri yang dicatat pagi & malam tidak terhitung ganda.
function apiGetTopSantriBulan(p) {
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const bulan = Number(p.bulan) || now.getMonth() + 1, tahun = Number(p.tahun) || now.getFullYear();
  const awal = tahun + '-' + String(bulan).padStart(2,'0') + '-01';
  const akhir = tahun + '-' + String(bulan).padStart(2,'0') + '-31';
  const gender = norm(p.gender || '');
  const batas = Math.min(Number(p.jumlah) || 5, 10);
  const ss = getAktifSS();

  const info = {};
  const shS = ss.getSheetByName(SHEET_SANTRI);
  if (shS && shS.getLastRow() > 1) {
    const rows = nilaiCatatanUnik_(shS);
    const iJK = rows[0].indexOf('Jenis Kelamin');
    rows.slice(1).forEach(function(r){
      if (!norm(r[0])) return;
      const jk = norm(iJK > -1 ? r[iJK] : r[3]).toLowerCase();
      info[norm(r[0])] = {nama: norm(r[1]), jk: jk === 'laki-laki' ? 'Putra' : (jk === 'perempuan' ? 'Putri' : '')};
    });
  }
  const shR = ss.getSheetByName(SHEET_ROMBEL);
  if (shR && shR.getLastRow() > 1) nilaiCatatanUnik_(shR).slice(1).forEach(function(r){ if (info[norm(r[0])]) info[norm(r[0])].kelas = norm(r[2]); });
  function cocokGender(nisn){ return !gender || (info[nisn] && info[nisn].jk === gender); }
  function tgl(v){ return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : norm(v).slice(0,10); }
  function hitungHalaman(v){
    const m = String(v || '').match(/(\d+)\s*-\s*(\d+)/);
    if (m) return Math.max(1, Number(m[2]) - Number(m[1]) + 1);
    return /\d/.test(String(v || '')) ? 1 : 0;
  }

  // Sabaq (hafalan baru)
  const sabaq = {};
  const shH = ss.getSheetByName(SHEET_HAFALAN);
  if (shH && shH.getLastRow() > 1) nilaiCatatanUnik_(shH).slice(1).forEach(function(r){
    const t = tgl(r[0]); if (t < awal || t > akhir) return;
    if (norm(r[6]) !== 'Sabaq') return;
    const n = norm(r[4]); if (!n || !cocokGender(n)) return;
    if (!sabaq[n]) sabaq[n] = {setoran:0, halaman:0};
    sabaq[n].setoran++; sabaq[n].halaman += hitungHalaman(r[10]);
  });

  // Izin & sakit dari absensi harian (per hari)
  const izin = {}, sakit = {}, sudah = {};
  const shA = ss.getSheetByName(SHEET_ABSENSI_HARIAN);
  if (shA && shA.getLastRow() > 1) nilaiCatatanUnik_(shA).slice(1).forEach(function(r){
    const t = tgl(r[0]); if (t < awal || t > akhir) return;
    const n = norm(r[2]); if (!n || !cocokGender(n)) return;
    const st = norm(r[5]);
    const jenis = st === 'Sakit' ? 'sakit' : (st === 'Izin' ? 'izin' : (st === 'Izin Pulang' ? 'pulang' : ''));
    if (!jenis) return;
    const k = n + '|' + jenis + '|' + t; if (sudah[k]) return; sudah[k] = true;
    if (jenis === 'sakit') sakit[n] = (sakit[n] || 0) + 1;
    else { if (!izin[n]) izin[n] = {total:0, izin:0, pulang:0}; izin[n].total++; izin[n][jenis]++; }
  });

  function susun(peta, nilai){
    return Object.keys(peta).map(function(n){
      const i = info[n] || {};
      return Object.assign({nisn:n, nama:i.nama || n, kelas:i.kelas || '-', jk:i.jk || ''}, nilai(peta[n]));
    });
  }
  return {ok:true, bulan: bulan, tahun: tahun, gender: gender,
    sabaq: susun(sabaq, function(v){ return {setoran:v.setoran, halaman:v.halaman}; })
      .sort(function(a,b){ return b.setoran - a.setoran || b.halaman - a.halaman; }).slice(0, batas),
    izin: susun(izin, function(v){ return {hari:v.total, izin:v.izin, pulang:v.pulang}; })
      .sort(function(a,b){ return b.hari - a.hari; }).slice(0, batas),
    sakit: susun(sakit, function(v){ return {hari:v}; })
      .sort(function(a,b){ return b.hari - a.hari; }).slice(0, batas)};
}

// ======================================================================
// SANTRI TIDAK HADIR BERUNTUN (izin / izin pulang, sakit, alpa)
//
// Mendeteksi santri yang tercatat tidak hadir beberapa HARI BERTURUT-TURUT di absensi
// harian pembina, supaya pembina, Kabag, Admin, dan Mudir bisa segera menindaklanjuti.
//
// Aturan hitung (sengaja dibuat adil):
// - Satu hari dihitung satu kali, walau diabsen pagi & malam.
// - Suatu hari masuk kategori bila ADA catatan kategori itu di hari tsb
//   (mis. sakit pagi, hadir malam -> tetap terhitung hari sakit).
// - Hari yang TIDAK diabsen untuk santri itu (libur, pembina tidak mengabsen) DILEWATI,
//   tidak memutus deretan. Tanpa ini, santri yang sakit seminggu tampak "sembuh" hanya
//   karena satu hari tidak tercatat.
// - Deretan putus bila ada hari tercatat dengan kategori lain (mis. hadir).
// ======================================================================
const KATEGORI_BERUNTUN = [
  {k:'izin',  label:'Izin / Izin Pulang', cocok:function(st){ return st === 'Izin' || st === 'Izin Pulang'; }},
  {k:'sakit', label:'Sakit',              cocok:function(st){ return st === 'Sakit'; }},
  {k:'alpa',  label:'Alpa',               cocok:function(st){ return st === 'Alpa' || st === 'Ghaib'; }}
];

function apiGetSantriBeruntun(p) {
  const tz = Session.getScriptTimeZone();
  const hariIni = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const gender = norm(p.gender || '');
  const batasMin = Math.max(2, Math.min(Number(p.minHari) || Number(getPengaturan().BatasBeruntunHari) || 3, 14));
  const ss = getAktifSS();
  function geserHari(t, n) { const q = t.split('-').map(Number); return Utilities.formatDate(new Date(q[0], q[1]-1, q[2] + n), tz, 'yyyy-MM-dd'); }
  const awalData = geserHari(hariIni, -45);   // cukup untuk mengukur deretan panjang
  const awalPekan = geserHari(hariIni, -7);   // deretan yang sudah selesai tetap dilaporkan 7 hari

  // Data santri
  const info = {};
  const shS = ss.getSheetByName(SHEET_SANTRI);
  if (shS && shS.getLastRow() > 1) {
    const rows = nilaiCatatanUnik_(shS);
    const h = rows[0];
    const iJK = h.indexOf('Jenis Kelamin'), iWA = h.indexOf('No WA Ortu');
    rows.slice(1).forEach(function(r){
      if (!norm(r[0])) return;
      const jk = norm(iJK > -1 ? r[iJK] : r[3]).toLowerCase();
      info[norm(r[0])] = {nama: norm(r[1]), jk: jk === 'laki-laki' ? 'Putra' : (jk === 'perempuan' ? 'Putri' : ''),
        noWa: norm(iWA > -1 ? r[iWA] : r[4]), kelas: '-'};
    });
  }
  const shR = ss.getSheetByName(SHEET_ROMBEL);
  if (shR && shR.getLastRow() > 1) nilaiCatatanUnik_(shR).slice(1).forEach(function(r){ if (info[norm(r[0])]) info[norm(r[0])].kelas = norm(r[2]); });

  // Status per santri per hari (bisa lebih dari satu status dalam sehari)
  const perSantri = {};
  const shA = ss.getSheetByName(SHEET_ABSENSI_HARIAN);
  if (shA && shA.getLastRow() > 1) {
    nilaiCatatanUnik_(shA).slice(1).forEach(function(r){
      const t = r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : norm(r[0]).slice(0,10);
      if (t < awalData || t > hariIni) return;
      const n = norm(r[2]);
      if (!n || !info[n]) return;
      if (gender && info[n].jk !== gender) return;
      if (!perSantri[n]) perSantri[n] = {};
      if (!perSantri[n][t]) perSantri[n][t] = {};
      perSantri[n][t][norm(r[5])] = true;
    });
  }

  const hasil = [];
  Object.keys(perSantri).forEach(function(n){
    const hari = Object.keys(perSantri[n]).sort();           // hanya hari yang tercatat
    const hariTerakhir = hari[hari.length - 1];
    KATEGORI_BERUNTUN.forEach(function(kat){
      // Kumpulkan deretan (run) hari tercatat yang berturut-turut masuk kategori ini
      let run = null;
      const runs = [];
      hari.forEach(function(t){
        const statusHari = Object.keys(perSantri[n][t]);
        const masuk = statusHari.some(kat.cocok);
        if (masuk) {
          if (!run) run = {mulai: t, akhir: t, hari: 0, izin: 0, pulang: 0};
          run.akhir = t; run.hari++;
          if (kat.k === 'izin') { if (statusHari.indexOf('Izin Pulang') !== -1) run.pulang++; else run.izin++; }
        } else if (run) { runs.push(run); run = null; }
      });
      if (run) runs.push(run);
      runs.forEach(function(rn){
        if (rn.hari < batasMin || rn.akhir < awalPekan) return;
        // Masih berlangsung = deretan ini adalah catatan terakhir santri & catatannya masih baru
        const berlangsung = rn.akhir === hariTerakhir && rn.akhir >= geserHari(hariIni, -2);
        const i = info[n];
        // Jejak 14 hari terakhir untuk ditampilkan sebagai garis waktu
        const jejak = [];
        for (let d = 13; d >= 0; d--) {
          const t = geserHari(hariIni, -d), sh = perSantri[n][t];
          let st = '';
          if (sh) st = sh['Alpa'] || sh['Ghaib'] ? 'Alpa' : (sh['Sakit'] ? 'Sakit' : (sh['Izin Pulang'] ? 'Izin Pulang' : (sh['Izin'] ? 'Izin' : 'Hadir')));
          jejak.push({t: t, s: st});
        }
        hasil.push({nisn: n, nama: i.nama, kelas: i.kelas, jk: i.jk, noWa: i.noWa, kategori: kat.k, labelKategori: kat.label,
          hari: rn.hari, mulai: rn.mulai, akhir: rn.akhir, berlangsung: berlangsung, izin: rn.izin, pulang: rn.pulang, jejak: jejak});
      });
    });
  });
  hasil.sort(function(a,b){ return (b.berlangsung - a.berlangsung) || (b.hari - a.hari) || a.nama.localeCompare(b.nama); });
  return {ok:true, hariIni: hariIni, minHari: batasMin, data: hasil};
}

// Info real-time keberadaan santri di pondok
// LOGIKA: Sistem melacak STATUS TERAKHIR santri hari ini dari semua sumber
// Kalau catatan terakhir = "Izin Pulang" → dia sedang keluar
// Kalau catatan terakhir = status lain (Hadir/Sakit/Izin/Alpa) → dia di pondok
// Contoh: pagi izin pulang, siang tercatat hadir di mapel → dianggap SUDAH KEMBALI
// Sumber: 1) AbsensiHarian (Pembina), 2) Absensi (mapel), 3) Hafalan (halaqoh)
function apiGetStatusPondok(p) {
  const ss = getAktifSS();
  const tz = Session.getScriptTimeZone();
  const tanggalHariIni = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  // Hitung total santri dari sheet Santri
  const shSantri = ss.getSheetByName(SHEET_SANTRI);
  if (!shSantri) return {ok:false, error:'Sheet Santri tidak ditemukan.'};
  const santriRows = nilaiCatatanUnik_(shSantri);
  const header = santriRows[0];
  const iJK = header.indexOf('Jenis Kelamin');
  santriRows.shift();

  let totalPutra = 0, totalPutri = 0;
  const jkMap = {};       // nisn → jk lowercase
  const namaMap = {};     // nisn → nama
  santriRows.forEach(r => {
    if (!norm(r[0])) return;
    var nisn = norm(r[0]);
    var jk = norm(iJK>-1 ? r[iJK] : r[3]).toLowerCase();
    jkMap[nisn] = jk;
    namaMap[nisn] = norm(r[1]);
    if (jk === 'laki-laki') totalPutra++;
    else if (jk === 'perempuan') totalPutri++;
  });
  const totalSantri = totalPutra + totalPutri;

  // Ambil kelas dari Rombel
  const shRombel = ss.getSheetByName(SHEET_ROMBEL);
  const kelasMap = {};
  if (shRombel) {
    nilaiCatatanUnik_(shRombel).slice(1).forEach(r => {
      if (r[0]) kelasMap[norm(r[0])] = norm(r[2]);
    });
  }

  // === CATAT STATUS TERAKHIR santri HARI INI dari semua sumber ===
  // Key: nisn, Value: {status, keterangan, sumber, waktu}
  // Waktu paling belakang menang (status TERBARU adalah status aktual)
  const statusTerakhir = {};

  function catatStatus(nisn, status, keterangan, sumber, waktu) {
    if (!nisn || !jkMap[nisn]) return; // hanya santri terdaftar
    if (!status) return;
    var existing = statusTerakhir[nisn];
    if (existing && existing.waktu >= waktu) return; // yang lama/sama, skip
    statusTerakhir[nisn] = {
      status: status,
      keterangan: keterangan || '',
      sumber: sumber,
      waktu: waktu,
    };
  }

  // Sumber 1: AbsensiHarian (Pembina) — HARI INI saja
  let sudahAbsenHarian = false;
  const shHarian = ss.getSheetByName(SHEET_ABSENSI_HARIAN);
  if (shHarian && shHarian.getLastRow() > 1) {
    const rows = nilaiCatatanUnik_(shHarian); rows.shift();
    rows.forEach(r => {
      const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
      if (tgl !== tanggalHariIni) return;
      sudahAbsenHarian = true;
      var waktu = r[8] instanceof Date ? r[8].getTime() : Date.now();
      catatStatus(norm(r[2]), norm(r[5]), norm(r[6]), 'Pembina', waktu);
    });
  }

  // Sumber 2: Absensi (guru mapel) — HARI INI saja
  const shAbsensi = ss.getSheetByName(SHEET_ABSENSI);
  if (shAbsensi && shAbsensi.getLastRow() > 1) {
    const rows = nilaiCatatanUnik_(shAbsensi); rows.shift();
    rows.forEach(r => {
      const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
      if (tgl !== tanggalHariIni) return;
      var waktu = r[9] instanceof Date ? r[9].getTime() : Date.now();
      var ket = norm(r[8])==='Izin Pulang' ? ('via ' + norm(r[3]||'mapel')) : '';
      catatStatus(norm(r[6]), norm(r[8]), ket, 'Guru Mapel', waktu);
    });
  }

  // Sumber 3: Hafalan (guru halaqoh) — HARI INI saja
  // Untuk hafalan: jenis "Sabaq/Sabqi/Manzil/Murojaah/Tahsin/Tasmi'/Tidak Setor" → dianggap HADIR
  //                jenis "Izin Pulang/Izin/Sakit/Ghaib" → status sesuai
  const shHafalan = ss.getSheetByName(SHEET_HAFALAN);
  if (shHafalan && shHafalan.getLastRow() > 1) {
    const rows = nilaiCatatanUnik_(shHafalan); rows.shift();
    rows.forEach(r => {
      const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
      if (tgl !== tanggalHariIni) return;
      var jenis = norm(r[6]);
      var status;
      if (JENIS_HAFALAN_DIANGGAP_HADIR.indexOf(jenis) !== -1) status = 'Hadir';
      else if (jenis === 'Izin Pulang') status = 'Izin Pulang';
      else if (jenis === 'Sakit') status = 'Sakit';
      else if (jenis === 'Izin') status = 'Izin';
      else if (jenis === 'Ghaib') status = 'Alpa';
      else status = 'Hadir';
      var waktu = r[12] instanceof Date ? r[12].getTime() : Date.now();
      var ket = status === 'Izin Pulang' ? ('via halaqoh ' + norm(r[2]||'')) : '';
      catatStatus(norm(r[4]), status, ket, 'Guru Halaqoh', waktu);
    });
  }

  // === HITUNG BREAKDOWN dari statusTerakhir ===
  const izinPulangList = [], sakitList = [], izinList = [];
  let hadir = 0, sakit = 0, izin = 0, alpa = 0;
  let putraIzin = 0, putriIzin = 0;
  // Rincian per putra/putri -- sebelumnya hanya "izin pulang" yang dipisah, sehingga
  // pembina putra/putri tidak pernah melihat jumlah santri sakit & izin di asramanya.
  const perJk = {Putra:{hadir:0,sakit:0,izin:0,alpa:0}, Putri:{hadir:0,sakit:0,izin:0,alpa:0}};

  Object.keys(statusTerakhir).forEach(function(nisn) {
    var s = statusTerakhir[nisn];
    var status = s.status;
    var jkS = jkMap[nisn] === 'laki-laki' ? 'Putra' : 'Putri';
    var dataS = {nisn: nisn, nama: namaMap[nisn] || '', kelas: kelasMap[nisn] || '-', keterangan: s.keterangan, sumber: s.sumber, jk: jkS};
    if (status === 'Hadir') { hadir++; perJk[jkS].hadir++; }
    else if (status === 'Sakit') { sakit++; perJk[jkS].sakit++; sakitList.push(dataS); }
    else if (status === 'Izin') { izin++; perJk[jkS].izin++; izinList.push(dataS); }
    else if (status === 'Alpa') { alpa++; perJk[jkS].alpa++; }
    else if (status === 'Izin Pulang') {
      var jk = jkMap[nisn] === 'laki-laki' ? 'Putra' : 'Putri';
      if (jk === 'Putra') putraIzin++;
      else putriIzin++;
      izinPulangList.push({
        nisn: nisn,
        nama: namaMap[nisn] || '',
        kelas: kelasMap[nisn] || '-',
        keterangan: s.keterangan,
        sumber: s.sumber,
        waktu: s.waktu,
        jk: jk,
      });
    }
  });

  const totalIzinPulang = izinPulangList.length;
  const diPondok = totalSantri - totalIzinPulang;
  const putraDiPondok = totalPutra - putraIzin;
  const putriDiPondok = totalPutri - putriIzin;

  // Sudah berapa kali (hari) santri yang sedang sakit/izin/izin pulang itu tercatat
  // sakit, izin, dan izin pulang BULAN INI -- dari absensi harian pembina. Dihitung per
  // HARI (bukan per sesi), supaya santri yang dicatat pagi & malam tidak terhitung dua kali.
  const perluFrek = {};
  sakitList.concat(izinList, izinPulangList).forEach(function(x){ perluFrek[x.nisn] = true; });
  const frekuensiBulan = {};
  if (Object.keys(perluFrek).length && shHarian && shHarian.getLastRow() > 1) {
    const awalBulan = tanggalHariIni.slice(0, 8) + '01';
    const hariTercatat = {};
    nilaiCatatanUnik_(shHarian).slice(1).forEach(function(r){
      const nisnF = norm(r[2]);
      if (!perluFrek[nisnF]) return;
      const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
      if (tgl < awalBulan || tgl > tanggalHariIni) return;
      const st = norm(r[5]);
      const jenis = st === 'Sakit' ? 'sakit' : (st === 'Izin' ? 'izin' : (st === 'Izin Pulang' ? 'izinPulang' : ''));
      if (!jenis) return;
      const kunci = nisnF + '|' + jenis + '|' + tgl;
      if (hariTercatat[kunci]) return;
      hariTercatat[kunci] = true;
      if (!frekuensiBulan[nisnF]) frekuensiBulan[nisnF] = {sakit:0, izin:0, izinPulang:0};
      frekuensiBulan[nisnF][jenis]++;
    });
  }

  return {
    ok: true,
    tanggal: tanggalHariIni,
    hariIni: true,
    sudahAbsen: sudahAbsenHarian || Object.keys(statusTerakhir).length > 0,
    perJk: perJk,
    sakitList: sakitList,
    izinList: izinList,
    frekuensiBulan: frekuensiBulan,
    total: totalSantri,
    diPondok: diPondok,
    izinPulang: totalIzinPulang,
    hadir: hadir,
    sakit: sakit,
    izin: izin,
    alpa: alpa,
    putra: {total:totalPutra, diPondok:putraDiPondok, izinPulang:putraIzin},
    putri: {total:totalPutri, diPondok:putriDiPondok, izinPulang:putriIzin},
    izinPulangList: izinPulangList,
    sumberIzinPulang: {
      pembina: izinPulangList.filter(x => x.sumber === 'Pembina').length,
      mapel:   izinPulangList.filter(x => x.sumber === 'Guru Mapel').length,
      halaqoh: izinPulangList.filter(x => x.sumber === 'Guru Halaqoh').length,
    },
  };
}

// Catat pelanggaran (dipakai oleh Pembina)
function apiCatatPelanggaranPembina(p) {
  return apiCatatPelanggaran(p); // pakai fungsi yang sudah ada
}

// ============================================================
// TUGAS HARIAN PEMBINA
// Sheet TugasPembina  : master tugas (dibuat Mudir/Admin)
// Sheet RealisasiTugas: centangan harian per Pembina
// ============================================================

function headerTugasPembina(){ return ['ID','NamaTugas','Kategori','Berlaku','Urutan','Aktif','WajibFoto','DibuatOleh','Waktu','Untuk','Opsional','JamMulai','JamSelesai','Petugas']; }
function headerRealisasiTugas(){ return ['Tanggal','IDTugas','NamaTugas','Pembina','Status','Catatan','WaktuCentang','FotoUrl','FotoId','TanggalHapusFoto']; }

// ---------- Pembantu To Do List Pembina (versi SK) ----------
// Kolom tambahan TugasPembina (10-14): Untuk (Semua/Putra/Putri), Opsional (true/false),
// JamMulai, JamSelesai, Petugas. Baris lama tanpa kolom ini tetap terbaca: Untuk=Semua,
// tidak opsional, tanpa jam, tanpa petugas khusus (perilaku lama).
const HARI_TUGAS_ = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
function normHariTugas_(h) {
  const x = normNama(norm(h)).replace(/[^a-z]/g, '');
  if (x === 'ahad' || x === 'minggu') return 'minggu';
  return x; // senin, selasa, rabu, kamis, jumat, sabtu
}
function benar_(v) { return v === true || ['true','TRUE','1','ya','Ya'].indexOf(norm(v)) !== -1; }
function bacaBarisTugas_(r, i) {
  return {rowIndex: i + 2, id: norm(r[0]), nama: norm(r[1]), kategori: norm(r[2]) || 'Umum',
    berlaku: norm(r[3]) || 'Setiap Hari', urutan: Number(r[4]) || 0, aktif: benar_(r[5]), wajibFoto: benar_(r[6]),
    dibuatOleh: norm(r[7]),
    waktu: r[8] instanceof Date ? Utilities.formatDate(r[8], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : norm(r[8]),
    untuk: norm(r[9]) || 'Semua', opsional: benar_(r[10]),
    jamMulai: jamTeksTugas_(r[11]), jamSelesai: jamTeksTugas_(r[12]), petugas: norm(r[13])};
}
function jamTeksTugas_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
  // "03.30" yang terlanjur dibaca Sheets sebagai angka 3.3
  if (typeof v === 'number' && !isNaN(v)) {
    const j = Math.floor(v), m = Math.round((v - j) * 100);
    return ('0' + j).slice(-2) + '.' + ('0' + m).slice(-2);
  }
  return norm(v).replace(/^'/, '');
}
// Jam disimpan sebagai TEKS (diawali ') supaya "03.30" tidak diubah Sheets menjadi angka 3,3
function jamSimpanTugas_(v) {
  const t = norm(v).replace(/^'/, '');
  return /^\d/.test(t) ? "'" + t : t;
}
// Apakah tugas berlaku pada hari ini? "Setiap Hari", "Insidental", satu hari, atau
// beberapa hari dipisah koma ("Senin, Kamis"). "Ahad" = "Minggu".
function tugasBerlakuHari_(berlaku, namaHari) {
  const b = norm(berlaku);
  if (!b || b === 'Setiap Hari' || b === 'Insidental') return true;
  const hari = normHariTugas_(namaHari);
  return b.split(/[,;/]/).some(function(x){ return normHariTugas_(x) === hari; });
}
// Kata-kata penting dari nama (tanpa sapaan & gelar) untuk mencocokkan nama singkat di
// jadwal ("Ustz. Fadlia") dengan nama akun ("USTZ. FATIATUL FADLIA S., S.H.").
function kataNamaTugas_(n) {
  const buang = ['ust','ustz','ustadz','ustadzah','ustdz','ustdzh','sh','spd','spdi','sag','lc','ma','s','h','hj','kh'];
  return normNama(norm(n)).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(function(k){ return k && buang.indexOf(k) === -1; });
}
function namaPetugasCocok_(petugas, nama) {
  if (samaGuru_(petugas, nama)) return true;
  const a = kataNamaTugas_(petugas), b = kataNamaTugas_(nama);
  if (!a.length || !b.length) return false;
  const kecil = a.length <= b.length ? a : b, besar = a.length <= b.length ? b : a;
  return kecil.every(function(k){ return besar.indexOf(k) !== -1; });
}
// Kolom Petugas: kosong = semua pembina (sesuai kolom Untuk).
//   "Nama A / Nama B"                         -> hanya pembina itu, setiap hari tugas berlaku
//   "Senin=Nama A | Selasa=Nama B | ..."      -> petugas berbeda per hari (piket jaga bergilir)
// Mengembalikan null bila tidak ada petugas khusus, atau daftar nama untuk hari itu.
function petugasHariIni_(petugas, namaHari) {
  const t = norm(petugas);
  if (!t) return null;
  if (t.indexOf('=') === -1) return t.split('/').map(function(x){ return x.trim(); }).filter(Boolean);
  const hari = normHariTugas_(namaHari);
  let hasil = [];
  t.split('|').forEach(function(bagian){
    const i = bagian.indexOf('=');
    if (i === -1) return;
    if (normHariTugas_(bagian.slice(0, i)) === hari) {
      hasil = hasil.concat(bagian.slice(i + 1).split('/').map(function(x){ return x.trim(); }).filter(Boolean));
    }
  });
  return hasil;
}
// Gender pembina dari RoleAkses (PembinaPutra / PembinaPutri). '' bila tidak diketahui.
function genderPembina_(nama) {
  try {
    const rows = getAktifSS().getSheetByName(SHEET_ROLE).getDataRange().getValues().slice(1);
    for (let i = 0; i < rows.length; i++) {
      if (!samaGuru_(rows[i][0], nama) && normNama(norm(rows[i][0])) !== normNama(nama)) continue;
      const lvl = norm(rows[i][3]);
      if (lvl.indexOf('PembinaPutra') !== -1) return 'Putra';
      if (lvl.indexOf('PembinaPutri') !== -1) return 'Putri';
    }
  } catch (e) {}
  return '';
}
// Daftar tugas yang berlaku untuk SATU pembina pada satu tanggal.
function tugasUntukPembina_(daftarTugas, nama, gender, namaHari) {
  return daftarTugas.filter(function(t){
    if (!t.aktif || !t.id) return false;
    if (!tugasBerlakuHari_(t.berlaku, namaHari)) return false;
    const u = normNama(t.untuk);
    if (u && u !== 'semua') {
      if (!gender) return false;
      if (u !== normNama(gender)) return false;
    }
    const pt = petugasHariIni_(t.petugas, namaHari);
    if (pt && !pt.some(function(x){ return namaPetugasCocok_(x, nama); })) return false;
    return true;
  }).sort(function(a, b){ return a.urutan - b.urutan; });
}
// Lama tugas dalam jam (untuk tugas opsional yang menambah jam kerja). 0 bila jam tidak jelas.
function durasiJamTugas_(t) {
  const m = function(x){ const q = String(x || '').match(/^(\d{1,2})[.:](\d{2})$/); return q ? Number(q[1]) * 60 + Number(q[2]) : null; };
  const a = m(t.jamMulai), b = m(t.jamSelesai);
  if (a === null || b === null || b <= a) return 0;
  return Math.round((b - a) / 60 * 100) / 100;
}
function bacaSemuaTugas_(ss) {
  const sh = getOrCreateSheetTugas(ss);
  return sh.getDataRange().getValues().slice(1).map(bacaBarisTugas_).filter(function(t){ return t.id; });
}
// Daftar pembina dari RoleAkses: [{nama, gender}]
function daftarPembina_(ss) {
  const hasil = [];
  const sh = ss.getSheetByName(SHEET_ROLE);
  if (!sh) return hasil;
  sh.getDataRange().getValues().slice(1).forEach(function(r){
    const nama = norm(r[0]), lvl = norm(r[3]);
    if (!nama || lvl.indexOf('Pembina') === -1) return;
    if (hasil.some(function(x){ return samaGuru_(x.nama, nama); })) return;
    hasil.push({nama: nama, gender: lvl.indexOf('PembinaPutra') !== -1 ? 'Putra' : (lvl.indexOf('PembinaPutri') !== -1 ? 'Putri' : '')});
  });
  return hasil;
}

function getOrCreateSheetTugas(ss) {
  var sh = ss.getSheetByName(SHEET_TUGAS_PEMBINA);
  if (!sh) {
    sh = ss.insertSheet(SHEET_TUGAS_PEMBINA);
    sh.appendRow(headerTugasPembina());
    sh.setFrozenRows(1);
    // Sisipkan data dummy langsung
    inisialisasiDummyTugas(sh);
  }
  return sh;
}
function getOrCreateSheetRealisasi(ss) {
  var sh = ss.getSheetByName(SHEET_REALISASI_TUGAS);
  if (!sh) { sh = ss.insertSheet(SHEET_REALISASI_TUGAS); sh.appendRow(headerRealisasiTugas()); sh.setFrozenRows(1); }
  return sh;
}

// ---- MASTER TUGAS (Mudir/Admin) ----

function apiGetDaftarTugasPembina(p) {
  const ss = getAktifSS();
  const data = bacaSemuaTugas_(ss);
  if (!p || !p.termasukNonaktif) return {ok:true, data: data.filter(function(r){return r.aktif;})};
  return {ok:true, data: data};
}

function apiSimpanTugasPembina(p) {
  const ss = getAktifSS();
  const sh = getOrCreateSheetTugas(ss);
  pastikanHeaderTugas_(sh);
  const nama = norm(p.nama); if (!nama) return {ok:false, error:'Nama tugas wajib diisi'};
  const berlakuValid = ['Setiap Hari','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu','Ahad','Insidental'];
  const berlaku = norm(p.berlaku)||'Setiap Hari';
  const potongan = berlaku.split(/[,;/]/).map(function(x){ return x.trim(); }).filter(Boolean);
  if (!potongan.length || potongan.some(function(x){ return berlakuValid.indexOf(x) === -1 && !normHariTugas_(x).match(/^(senin|selasa|rabu|kamis|jumat|sabtu|minggu)$/); })) {
    return {ok:false, error:'Nilai "Berlaku" tidak valid. Contoh: Setiap Hari, Senin, atau Senin, Kamis'};
  }
  const untuk = ['Semua','Putra','Putri'].indexOf(norm(p.untuk)) !== -1 ? norm(p.untuk) : 'Semua';
  const wajibFoto = p.wajibFoto === true || p.wajibFoto === 'true' || p.wajibFoto === '1';
  const opsional = p.opsional === true || p.opsional === 'true' || p.opsional === '1';
  const tambahan = [untuk, opsional, jamSimpanTugas_(p.jamMulai), jamSimpanTugas_(p.jamSelesai), norm(p.petugas)];
  const tz = Session.getScriptTimeZone();
  const now = new Date();

  if (p.rowIndex) {
    const ri = Number(p.rowIndex);
    sh.getRange(ri, 2, 1, 6).setValues([[nama, norm(p.kategori)||'Umum', berlaku, Number(p.urutan)||0, true, wajibFoto]]);
    sh.getRange(ri, 10, 1, 5).setValues([tambahan]);
    return {ok:true, mode:'update'};
  } else {
    const id = 'TGS-' + Utilities.formatDate(now, tz, 'yyyyMMddHHmmss');
    sh.appendRow([id, nama, norm(p.kategori)||'Umum', berlaku, Number(p.urutan)||0, true, wajibFoto, norm(p.oleh)||'Admin', now].concat(tambahan));
    return {ok:true, id: id};
  }
}

function pastikanHeaderTugas_(sh) {
  const h = headerTugasPembina();
  const ada = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  if (ada.length < h.length || norm(ada[9]) !== 'Untuk') sh.getRange(1, 1, 1, h.length).setValues([h]);
}

function apiToggleAktifTugas(p) {
  const ss = getAktifSS();
  const sh = getOrCreateSheetTugas(ss);
  const ri = Number(p.rowIndex); if (!ri || ri < 2) return {ok:false, error:'Baris tidak valid'};
  const aktif = p.aktif === true || p.aktif === 'true';
  sh.getRange(ri, 6).setValue(aktif);
  return {ok:true};
}

function apiHapusTugasPembina(p) {
  const ss = getAktifSS();
  const sh = getOrCreateSheetTugas(ss);
  const ri = Number(p.rowIndex); if (!ri || ri < 2) return {ok:false, error:'Baris tidak valid'};
  sh.deleteRow(ri);
  return {ok:true};
}

// ---- REALISASI (Pembina centang) ----

// Ambil tugas yang berlaku hari ini + status centang untuk Pembina tertentu
function apiGetTugasHariIni(p) {
  const ss = getAktifSS();
  const tz = Session.getScriptTimeZone();
  const tanggal = norm(p.tanggal) || Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const pembina = norm(p.pembina);
  const q = tanggal.split('-').map(Number);
  const namaHari = HARI_TUGAS_[new Date(q[0], q[1]-1, q[2]).getDay()];
  const gender = genderPembina_(pembina) || (['Putra','Putri'].indexOf(norm(p.gender)) !== -1 ? norm(p.gender) : '');

  const tugasBerlaku = tugasUntukPembina_(bacaSemuaTugas_(ss), pembina, gender, namaHari);

  // Realisasi hari ini untuk pembina ini
  const shReal = getOrCreateSheetRealisasi(ss);
  const realRows = shReal.getDataRange().getValues(); realRows.shift();
  const realisasiHariIni = {};
  realRows.forEach(function(r, i) {
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : norm(r[0]);
    if (tgl === tanggal && (norm(r[3]) === pembina || samaGuru_(r[3], pembina))) {
      realisasiHariIni[norm(r[1])] = {rowIndex: i+2, status: norm(r[4]), catatan: norm(r[5]),
        waktu: r[6] instanceof Date ? Utilities.formatDate(r[6], tz, 'HH:mm') : norm(r[6]),
        fotoUrl: norm(r[7]), fotoId: norm(r[8])};
    }
  });

  const data = tugasBerlaku.map(function(t) {
    const real = realisasiHariIni[t.id] || {};
    return {id: t.id, nama: t.nama, kategori: t.kategori, berlaku: t.berlaku,
            urutan: t.urutan, wajibFoto: t.wajibFoto, opsional: t.opsional,
            jamMulai: t.jamMulai, jamSelesai: t.jamSelesai, untuk: t.untuk,
            piket: !!t.petugas, durasiJam: durasiJamTugas_(t),
            selesai: real.status === 'Selesai',
            catatan: real.catatan || '', waktu: real.waktu || '',
            fotoUrl: real.fotoUrl || '', fotoId: real.fotoId || '',
            rowIndexReal: real.rowIndex || null};
  });

  // Progres hanya dari tugas WAJIB. Tugas opsional yang dikerjakan = tambahan jam kerja.
  const wajib = data.filter(function(d){ return !d.opsional; });
  const opsi = data.filter(function(d){ return d.opsional; });
  const total = wajib.length, selesai = wajib.filter(function(d){return d.selesai;}).length;
  const opsiSelesai = opsi.filter(function(d){ return d.selesai; });
  const res = {ok:true, data: data, tanggal: tanggal, hari: namaHari === 'Minggu' ? 'Ahad' : namaHari, gender: gender,
          total: total, selesai: selesai,
          persen: total > 0 ? Math.round(selesai/total*100) : 0,
          opsionalTotal: opsi.length, opsionalSelesai: opsiSelesai.length,
          jamTambahan: Math.round(opsiSelesai.reduce(function(s, d){ return s + d.durasiJam; }, 0) * 100) / 100};
  if (!gender) res.peringatan = 'Akun Anda belum ditandai sebagai Pembina Putra atau Pembina Putri, jadi tugas khusus asrama belum tampil. Minta Admin mengatur peran akun Anda di Data Master > RoleAkses.';
  return res;
}

function apiCentangTugas(p) {
  const ss = getAktifSS();
  const tz = Session.getScriptTimeZone();
  const tanggal = norm(p.tanggal) || Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const idTugas = norm(p.idTugas), pembina = norm(p.pembina);
  const selesai = p.selesai === true || p.selesai === 'true';
  const catatan = norm(p.catatan) || '';
  if (!idTugas || !pembina) return {ok:false, error:'IDTugas dan Pembina wajib diisi'};

  // Ambil nama tugas dari master
  const shTugas = getOrCreateSheetTugas(ss);
  const tugasRows = shTugas.getDataRange().getValues(); tugasRows.shift();
  const tugas = tugasRows.find(function(r){ return norm(r[0]) === idTugas; });
  const namaTugas = tugas ? norm(tugas[1]) : idTugas;

  const shReal = getOrCreateSheetRealisasi(ss);
  const rows = shReal.getDataRange().getValues(); rows.shift();
  const now = new Date();
  const status = selesai ? 'Selesai' : 'Belum';

  // Cari baris existing untuk update
  let found = -1;
  for (let i=0; i<rows.length; i++) {
    const tgl = rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], tz, 'yyyy-MM-dd') : norm(rows[i][0]);
    if (tgl === tanggal && norm(rows[i][1]) === idTugas && norm(rows[i][3]) === pembina) { found = i+2; break; }
  }
  if (found > 0) {
    shReal.getRange(found, 5, 1, 3).setValues([[status, catatan, now]]);
  } else {
    shReal.appendRow([tanggal, idTugas, namaTugas, pembina, status, catatan, now]);
  }
  return {ok:true, status: status};
}

// Rekap semua Pembina untuk satu hari (dashboard Mudir)
function apiGetRekapTugasPembina(p) {
  p = p || {};
  const ss = getAktifSS();
  const tz = Session.getScriptTimeZone();
  const tanggal = norm(p.tanggal) || Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const q = tanggal.split('-').map(Number);
  const namaHari = HARI_TUGAS_[new Date(q[0], q[1]-1, q[2]).getDay()];
  const fGender = norm(p.gender);
  const semuaTugas = bacaSemuaTugas_(ss);

  const shReal = getOrCreateSheetRealisasi(ss);
  const realRows = shReal.getDataRange().getValues(); realRows.shift();
  const selesaiHariIni = {}; // pembinaNorm|idTugas -> true
  realRows.forEach(function(r) {
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : norm(r[0]);
    if (tgl === tanggal && norm(r[4]) === 'Selesai') selesaiHariIni[normNamaGuru_(r[3]) + '|' + norm(r[1])] = true;
  });

  const data = daftarPembina_(ss).filter(function(pb){ return !fGender || pb.gender === fGender; }).map(function(pb) {
    const tugas = tugasUntukPembina_(semuaTugas, pb.nama, pb.gender, namaHari);
    const sudah = function(t){ return !!selesaiHariIni[normNamaGuru_(pb.nama) + '|' + t.id]; };
    const wajib = tugas.filter(function(t){ return !t.opsional; });
    const opsi = tugas.filter(function(t){ return t.opsional; });
    const sel = wajib.filter(sudah).length;
    const opsiSel = opsi.filter(sudah);
    return {pembina: pb.nama, gender: pb.gender, selesai: sel, total: wajib.length,
            persen: wajib.length > 0 ? Math.round(sel / wajib.length * 100) : 0,
            belum: wajib.filter(function(t){ return !sudah(t); }).map(function(t){ return (t.jamMulai ? t.jamMulai + ' ' : '') + t.nama; }),
            opsionalSelesai: opsiSel.length,
            jamTambahan: Math.round(opsiSel.reduce(function(s, t){ return s + durasiJamTugas_(t); }, 0) * 100) / 100};
  }).sort(function(a,b){ return a.gender.localeCompare(b.gender) || b.persen - a.persen; });

  return {ok:true, tanggal: tanggal, hari: namaHari === 'Minggu' ? 'Ahad' : namaHari, totalTugas: data.length ? Math.max.apply(null, data.map(function(d){ return d.total; })) : 0, data: data};
}

// Ringkasan kinerja per pembina dalam rentang tanggal (dasar penilaian & honor tugas opsional)
function apiGetRingkasanTugasPembina(p) {
  p = p || {};
  const ss = getAktifSS();
  const tz = Session.getScriptTimeZone();
  const hariIni = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const mulai = norm(p.tglMulai) || hariIni, akhir = norm(p.tglAkhir) || hariIni;
  if (mulai > akhir) return {ok:false, error:'Tanggal mulai melewati tanggal akhir.'};
  const fGender = norm(p.gender);
  const semuaTugas = bacaSemuaTugas_(ss);
  const realRows = getOrCreateSheetRealisasi(ss).getDataRange().getValues().slice(1);
  const selesai = {};
  realRows.forEach(function(r){
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : norm(r[0]);
    if (tgl >= mulai && tgl <= akhir && norm(r[4]) === 'Selesai') selesai[tgl + '|' + normNamaGuru_(r[3]) + '|' + norm(r[1])] = true;
  });
  const tanggalList = [];
  const a = mulai.split('-').map(Number), b = akhir.split('-').map(Number);
  for (let d = new Date(a[0], a[1]-1, a[2]); d <= new Date(b[0], b[1]-1, b[2]) && tanggalList.length < 93; d.setDate(d.getDate() + 1)) {
    tanggalList.push(Utilities.formatDate(d, tz, 'yyyy-MM-dd'));
  }
  const data = daftarPembina_(ss).filter(function(pb){ return !fGender || pb.gender === fGender; }).map(function(pb){
    let wajib = 0, wajibSel = 0, opsiSel = 0, jam = 0;
    tanggalList.forEach(function(t){
      const q = t.split('-').map(Number);
      const hari = HARI_TUGAS_[new Date(q[0], q[1]-1, q[2]).getDay()];
      tugasUntukPembina_(semuaTugas, pb.nama, pb.gender, hari).forEach(function(tg){
        const ok = !!selesai[t + '|' + normNamaGuru_(pb.nama) + '|' + tg.id];
        if (tg.opsional) { if (ok) { opsiSel++; jam += durasiJamTugas_(tg); } }
        else { wajib++; if (ok) wajibSel++; }
      });
    });
    return {pembina: pb.nama, gender: pb.gender, hari: tanggalList.length, wajib: wajib, wajibSelesai: wajibSel,
      persen: wajib ? Math.round(wajibSel * 100 / wajib) : 0, opsionalSelesai: opsiSel, jamTambahan: Math.round(jam * 100) / 100};
  });
  return {ok:true, mulai: mulai, akhir: akhir, data: data};
}

function apiGetHistoryTugasPembina(p) {
  const ss = getAktifSS();
  const tz = Session.getScriptTimeZone();
  const tglMulai = norm(p.tglMulai), tglAkhir = norm(p.tglAkhir);
  const pembinaFilter = norm(p.pembina) || '';
  const genderFilter = norm(p.gender) || '';
  const petaGender = {};
  daftarPembina_(ss).forEach(function(x){ petaGender[normNamaGuru_(x.nama)] = x.gender; });
  const genderPembinaCache = function(n){ return petaGender[normNamaGuru_(n)] || ''; };

  const shReal = getOrCreateSheetRealisasi(ss);
  const rows = shReal.getDataRange().getValues(); rows.shift();

  const data = rows.map(function(r, i) {
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : norm(r[0]);
    return {tanggal: tgl, idTugas: norm(r[1]), namaTugas: norm(r[2]),
            pembina: norm(r[3]), status: norm(r[4]), catatan: norm(r[5]),
            waktu: r[6] instanceof Date ? Utilities.formatDate(r[6], tz, 'HH:mm') : norm(r[6])};
  }).filter(function(r) {
    if (!r.tanggal) return false;
    if (tglMulai && r.tanggal < tglMulai) return false;
    if (tglAkhir && r.tanggal > tglAkhir) return false;
    if (pembinaFilter && r.pembina !== pembinaFilter && !namaPetugasCocok_(pembinaFilter, r.pembina)) return false;
    if (genderFilter && genderPembinaCache(r.pembina) !== genderFilter) return false;
    return true;
  }).sort(function(a,b){ return b.tanggal.localeCompare(a.tanggal) || a.pembina.localeCompare(b.pembina); });

  return {ok:true, data: data};
}

// ============================================================
// TUGAS PEMBINA SESUAI SK MUDIR
//   Putra: K.310/PPS-WU/IX/2026 (Lampiran Jadwal & Uraian Tugas Pembina Pondok Putra)
//   Putri: K.311/PPS-WU/IX/2026 (Lampiran I tugas harian & umum, Lampiran II piket jaga)
// Dipasang lewat tombol "Terapkan Tugas sesuai SK" (Admin/Mudir). Aman diulang: tugas
// SK diperbarui berdasarkan ID-nya, tugas lain hanya DINONAKTIFKAN (tidak dihapus),
// dan riwayat centang lama tetap utuh.
// ============================================================
const PEMBINA_PUTRI_SK_ = {F:'USTZ. FATIATUL FADLIA S., S.H.', H:'USTZ. HAIFA NUR ZIRAH', A:'USTZ. ALZIAH'};
// Lampiran II: urutan petugas Sesi I..VII per hari
const PIKET_PUTRI_SK_ = {
  Senin:'FHAFHAF', Selasa:'HAFHAFH', Rabu:'AFHAFHA', Kamis:'FHAFHAF', Jumat:'HAFHAFH', Sabtu:'AFHAFHA', Ahad:'FHAFHAF'
};
function petugasPiketSesi_(idxSesi) {
  return Object.keys(PIKET_PUTRI_SK_).map(function(h){
    return h + '=' + PEMBINA_PUTRI_SK_[PIKET_PUTRI_SK_[h].charAt(idxSesi)];
  }).join(' | ');
}
function daftarTugasSK_() {
  // [ID, Nama, Kategori, Berlaku, Urutan, WajibFoto, Untuk, Opsional, JamMulai, JamSelesai, Petugas]
  const T = [];
  const pa = function(no, jm, js, nama, kat, opt){ opt = opt || {};
    T.push(['SK-PA-' + ('0' + no).slice(-2), nama, kat, opt.berlaku || 'Setiap Hari', no * 10, !!opt.foto, 'Putra', !!opt.opsional, jm, js, '']); };
  pa(1,  '03.30','04.10','Shalat Lail: bangunkan santri, kontrol & dokumentasikan shalat lail','Ibadah',{foto:true});
  pa(2,  '04.10','04.35','Sahur: kontrol makan sahur santri yang puasa sunnah Senin & Kamis','Ibadah',{berlaku:'Senin, Kamis'});
  pa(3,  '04.35','05.30','Shalat Subuh: kontrol shalat sunnah qabliyah & Subuh berjamaah','Ibadah');
  pa(4,  '05.30','07.00','Halaqah Subuh: dampingi & awasi pelaksanaan halaqah Subuh (opsional)','Halaqah',{opsional:true});
  pa(5,  '07.00','08.00','Kegiatan Pagi: kontrol pengantaran makanan ke asrama putri, apel pagi, kerja bakti, sarapan & mandi pagi; pastikan santri siap belajar di masjid pukul 08.00','Kegiatan Harian');
  pa(6,  '10.00','12.00','Halaqah Dhuha: awasi & pastikan ketertiban halaqah Dhuha','Halaqah');
  pa(7,  '12.00','13.00','Shalat Dzuhur & Makan Siang: kontrol shalat Dzuhur, pengikatan ompreng MBG, pengantaran makanan ke asrama putri & makan siang santri','Ibadah');
  pa(8,  '14.00','Ashar','Shalat Ashar: awasi & siapkan santri menjelang Ashar; kontrol shalat sunnah & shalat wajib','Ibadah');
  pa(9,  '16.30','Maghrib','Kegiatan Sore & Shalat Maghrib: kontrol kerja bakti sore, awasi olahraga, kontrol mandi sore & persiapan Maghrib; awasi shalat sunnah & Maghrib','Kegiatan Harian');
  pa(10, "Ba'da Isya",'','Makan Malam: kontrol makan malam santri & pengantaran makanan ke asrama putri','Kegiatan Harian');
  pa(11, '20.30','23.00','Pengawasan Malam: pastikan santri masuk asrama pukul 21.00; awasi jam malam agar santri tidur tepat waktu & tidak begadang','Keamanan');

  const pi = function(no, jm, js, nama, kat, opt){ opt = opt || {};
    T.push(['SK-PI-' + ('0' + no).slice(-2), nama, kat, opt.berlaku || 'Setiap Hari', no * 10, !!opt.foto, 'Putri', false, jm, js, opt.petugas || '']); };
  pi(1,  '03.30','04.10','Shalat Lail: bangunkan santri, kontrol & dokumentasikan shalat lail','Ibadah',{foto:true});
  pi(2,  '04.10','04.35','Sahur: kontrol makan sahur santri yang puasa sunnah Senin & Kamis','Ibadah',{berlaku:'Senin, Kamis'});
  pi(3,  '04.35','05.30','Shalat Subuh: kontrol shalat sunnah & Subuh, ikut berjamaah bersama santri','Ibadah');
  pi(4,  '05.30','07.00','Halaqah Subuh: dampingi & awasi pelaksanaan halaqah Subuh','Halaqah');
  pi(5,  '07.00','08.00','Kegiatan Pagi: kontrol kerja bakti, sarapan, pencucian rantang, mandi & apel pagi; pastikan santri siap belajar pukul 08.00','Kegiatan Harian');
  pi(6,  '10.00','','Pengambilan MBG (petugas piket Sesi II)','Piket Jaga',{petugas: petugasPiketSesi_(1)});
  pi(7,  '12.00','13.00','Shalat Dzuhur & Makan Siang: kontrol shalat Dzuhur, pencucian rantang, pengantaran makanan & makan siang santri','Ibadah');
  pi(8,  '15.00','Ashar','Shalat Ashar: siapkan santri menjelang Ashar; kontrol shalat sunnah & wajib, ikut berjamaah','Ibadah');
  pi(9,  '16.30','Maghrib','Kegiatan Sore & Shalat Maghrib: kontrol kerja bakti sore, awasi olahraga, kontrol mandi sore & persiapan Maghrib; awasi shalat, ikut berjamaah','Kegiatan Harian');
  pi(10, "Ba'da Maghrib",'Isya','Halaqah Maghrib & Shalat Isya: awasi, kontrol & dokumentasikan halaqah Maghrib; isi absen harian (pembina yang disepakati); kontrol shalat Isya, ikut berjamaah','Halaqah',{foto:true});
  pi(11, "Ba'da Isya",'','Makan Malam: kontrol makan malam santri & pencucian rantang','Kegiatan Harian');
  pi(12, '20.30','23.00','Pengawasan Malam: pastikan santri masuk asrama pukul 21.00, tidur tepat waktu & tidak begadang; pastikan kipas angin mati & tidak ada kran bocor','Keamanan');
  // Lampiran I huruf B: tugas umum & pelaporan
  pi(13, '','','Kesehatan santri: pastikan seluruh santri sehat; santri yang sakit segera dilaporkan ke Kepala Bagian Putri','Tugas Umum');
  pi(14, '','','Air minum: cek persediaan; lapor ke Kepala Bagian Putri bila tersisa 3 galon','Tugas Umum');
  pi(15, '','','Fasilitas asrama: cek & laporkan kerusakan (lampu, kran, pintu, kipas angin, dll)','Tugas Umum');
  // Lampiran II: piket jaga bergilir 7 sesi @ 2 jam
  const sesi = [['I','08.00','10.00','Pagi'],['II','10.00','12.00','Pagi–Dzuhur, sekaligus ambil MBG 10.00'],['III','12.00','14.00','Dzuhur–Siang'],
    ['IV','14.00','16.00','Siang–Ashar'],['V','16.00','18.00','Ashar–Maghrib'],['VI','18.00','20.00','Maghrib–Isya'],['VII','20.00','22.00','Ba\'da Isya–Malam']];
  sesi.forEach(function(x, i){
    T.push(['SK-PI-J' + (i + 1), 'Piket Jaga Sesi ' + x[0] + ' (' + x[1] + '–' + x[2] + ', ' + x[3] + '): hadir tepat waktu & serah terima ke petugas sesi berikutnya',
      'Piket Jaga', 'Setiap Hari', [55, 59, 69, 75, 85, 95, 115][i], false, 'Putri', false, x[1], x[2], petugasPiketSesi_(i)]);
  });
  return T;
}

function apiTerapkanTugasSK(p) {
  if (!adminAtauMudir(norm(p && p.oleh))) return {ok:false, error:'Hanya Admin/Mudir yang boleh menerapkan tugas sesuai SK.'};
  const ss = getAktifSS();
  const sh = getOrCreateSheetTugas(ss);
  pastikanHeaderTugas_(sh);
  const nilai = sh.getDataRange().getValues();
  const barisId = {};
  for (let i = 1; i < nilai.length; i++) if (norm(nilai[i][0])) barisId[norm(nilai[i][0])] = i + 1;
  const daftar = daftarTugasSK_();
  const idSK = {};
  let ditambah = 0, diperbarui = 0, dinonaktifkan = 0;
  const now = new Date(), oleh = norm(p.oleh);
  daftar.forEach(function(t){
    idSK[t[0]] = true;
    const baris = [t[0], t[1], t[2], t[3], t[4], true, t[5], 'SK Mudir', now, t[6], t[7], jamSimpanTugas_(t[8]), jamSimpanTugas_(t[9]), t[10]];
    if (barisId[t[0]]) { sh.getRange(barisId[t[0]], 1, 1, baris.length).setValues([baris]); diperbarui++; }
    else { sh.appendRow(baris); ditambah++; }
  });
  // Tugas lama (bukan dari SK) dinonaktifkan, tidak dihapus -- bisa diaktifkan lagi kapan saja
  for (let i = 1; i < nilai.length; i++) {
    const id = norm(nilai[i][0]);
    if (!id || idSK[id] || id.indexOf('SK-') === 0) continue;
    if (benar_(nilai[i][5])) { sh.getRange(i + 1, 6).setValue(false); dinonaktifkan++; }
  }
  return {ok:true, ditambah: ditambah, diperbarui: diperbarui, dinonaktifkan: dinonaktifkan,
    pesan: 'Tugas sesuai SK diterapkan: ' + ditambah + ' ditambah, ' + diperbarui + ' diperbarui, ' + dinonaktifkan + ' tugas lama dinonaktifkan (tidak dihapus).'};
}

// ============================================================
// DATA DUMMY TUGAS PEMBINA (diisi otomatis saat sheet baru dibuat)
// ============================================================
function inisialisasiDummyTugas(sh) {
  const now = new Date();
  const dummy = [
    // ID, NamaTugas, Kategori, Berlaku, Urutan, Aktif, WajibFoto, DibuatOleh, Waktu
    ['TGS-DUMMY-01','Bangunkan santri untuk Sholat Subuh','Sholat','Setiap Hari',1,true,false,'System',now],
    ['TGS-DUMMY-02','Dampingi & pantau sholat Subuh berjamaah','Sholat','Setiap Hari',2,true,false,'System',now],
    ['TGS-DUMMY-03','Cek kondisi kamar dan kebersihan asrama pagi','Kebersihan','Setiap Hari',3,true,true,'System',now],
    ['TGS-DUMMY-04','Absensi harian santri sesi pagi','Asrama','Setiap Hari',4,true,false,'System',now],
    ['TGS-DUMMY-05','Dampingi & pantau sholat Dzuhur berjamaah','Sholat','Setiap Hari',5,true,false,'System',now],
    ['TGS-DUMMY-06','Dampingi & pantau sholat Ashar berjamaah','Sholat','Setiap Hari',6,true,false,'System',now],
    ['TGS-DUMMY-07','Cek kondisi kamar dan kebersihan asrama sore','Kebersihan','Setiap Hari',7,true,true,'System',now],
    ['TGS-DUMMY-08','Dampingi & pantau sholat Maghrib berjamaah','Sholat','Setiap Hari',8,true,false,'System',now],
    ['TGS-DUMMY-09','Pantau halaqoh Al-Qur\'an setelah Maghrib','Belajar','Setiap Hari',9,true,false,'System',now],
    ['TGS-DUMMY-10','Dampingi & pantau sholat Isya berjamaah','Sholat','Setiap Hari',10,true,false,'System',now],
    ['TGS-DUMMY-11','Absensi malam santri (pastikan semua ada)','Asrama','Setiap Hari',11,true,false,'System',now],
    ['TGS-DUMMY-12','Pastikan santri tidur tepat waktu & kondisi asrama aman','Keamanan','Setiap Hari',12,true,true,'System',now],
    ['TGS-DUMMY-13','Cek kebersihan kamar mandi dan toilet','Kebersihan','Setiap Hari',13,true,true,'System',now],
    ['TGS-DUMMY-14','Kerja bakti mingguan kebersihan lingkungan pondok','Kebersihan','Jumat',14,true,true,'System',now],
    ['TGS-DUMMY-15','Pantau kegiatan belajar malam santri','Belajar','Setiap Hari',15,true,false,'System',now],
    ['TGS-DUMMY-16','Laporan kondisi santri ke Mudir','Laporan','Setiap Hari',16,true,false,'System',now],
    ['TGS-DUMMY-17','Cek dan catat santri yang sakit','Kesehatan','Setiap Hari',17,true,false,'System',now],
    ['TGS-DUMMY-18','Rapat koordinasi Pembina mingguan','Umum','Senin',18,true,false,'System',now],
  ];
  if (dummy.length > 0) {
    sh.getRange(2, 1, dummy.length, dummy[0].length).setValues(dummy);
  }
}

// ============================================================
// UPLOAD FOTO TUGAS KE GOOGLE DRIVE
// ============================================================

// Nama folder di Drive: "WASIAT_FotoTugas" (dibuat otomatis)
var DRIVE_FOLDER_FOTO_TUGAS = 'WASIAT_FotoTugas';

function getOrCreateFolderFotoTugas() {
  var folders = DriveApp.getFoldersByName(DRIVE_FOLDER_FOTO_TUGAS);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(DRIVE_FOLDER_FOTO_TUGAS);
}

// API: Upload foto tugas (dipanggil setelah centang)
// p.imageBase64 = base64 string dari foto
// p.mimeType    = 'image/jpeg' atau 'image/png'
// p.namaFile    = nama file (optional)
// p.idTugas, p.pembina, p.tanggal, p.rowIndexReal
function apiUploadFotoTugas(p) {
  if (!p.imageBase64) return {ok:false, error:'Data foto tidak ditemukan'};
  const mime = norm(p.mimeType) || 'image/jpeg';
  const ext = mime === 'image/png' ? '.png' : '.jpg';
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const namaFile = norm(p.namaFile) ||
    ('Tugas_' + norm(p.pembina) + '_' + norm(p.tanggal) + '_' + norm(p.idTugas) + ext);

  try {
    const folder = getOrCreateFolderFotoTugas();
    const blob = Utilities.newBlob(Utilities.base64Decode(p.imageBase64), mime, namaFile);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const fotoUrl = 'https://drive.google.com/uc?id=' + file.getId() + '&export=view';
    const fotoId = file.getId();

    // Tanggal hapus = hari upload + 5 hari
    const tglHapus = new Date(now.getTime() + 5*24*3600*1000);
    const tglHapusStr = Utilities.formatDate(tglHapus, tz, 'yyyy-MM-dd');

    // Update baris RealisasiTugas dengan fotoUrl, fotoId, tglHapus
    const ri = Number(p.rowIndexReal);
    if (ri >= 2) {
      const ss = getAktifSS();
      const sh = getOrCreateSheetRealisasi(ss);
      // Kolom 8=FotoUrl, 9=FotoId, 10=TanggalHapusFoto
      sh.getRange(ri, 8, 1, 3).setValues([[fotoUrl, fotoId, tglHapusStr]]);
    }

    // Pastikan trigger pembersihan terpasang
    setupTriggerHapusFotoTugas();

    return {ok:true, fotoUrl:fotoUrl, fotoId:fotoId, tglHapus:tglHapusStr};
  } catch(e) {
    return {ok:false, error:'Gagal upload foto: ' + e.message};
  }
}

// ============================================================
// AUTO-DELETE FOTO SETELAH 5 HARI
// ============================================================

function setupTriggerHapusFotoTugas() {
  // Pasang trigger harian jam 02:00 jika belum ada
  var triggers = ScriptApp.getProjectTriggers();
  for (var i=0; i<triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'jalankanHapusFotoTugas') return; // sudah ada
  }
  ScriptApp.newTrigger('jalankanHapusFotoTugas')
    .timeBased().everyDays(1).atHour(2).create();
  Logger.log('Trigger hapus foto tugas dipasang.');
}

function hapusTriggerHapusFotoTugas() {
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === 'jalankanHapusFotoTugas') ScriptApp.deleteTrigger(t);
  });
}

// Dijalankan otomatis tiap malam jam 02:00
function jalankanHapusFotoTugas() {
  const ss = getAktifSS();
  const sh = getOrCreateSheetRealisasi(ss);
  const tz = Session.getScriptTimeZone();
  const hari_ini = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const rows = sh.getDataRange().getValues();
  // Header: Tanggal(0),IDTugas(1),NamaTugas(2),Pembina(3),Status(4),Catatan(5),WaktuCentang(6),FotoUrl(7),FotoId(8),TanggalHapusFoto(9)
  var jumlahHapus = 0;
  for (var i=1; i<rows.length; i++) {
    var fotoId = norm(rows[i][8]);
    var tglHapus = rows[i][9] instanceof Date ?
      Utilities.formatDate(rows[i][9], tz, 'yyyy-MM-dd') : norm(rows[i][9]);
    if (!fotoId || !tglHapus) continue;
    if (tglHapus > hari_ini) continue; // belum waktunya
    // Hapus file dari Drive
    try {
      DriveApp.getFileById(fotoId).setTrashed(true);
      // Kosongkan kolom foto di sheet
      sh.getRange(i+1, 8, 1, 3).setValues([['[Foto dihapus '+tglHapus+']','','']]);
      jumlahHapus++;
      Logger.log('Foto dihapus: ' + fotoId + ' (baris ' + (i+1) + ')');
    } catch(e) {
      Logger.log('Gagal hapus foto ' + fotoId + ': ' + e.message);
      // Tetap kosongkan kolom agar tidak dicoba lagi terus
      sh.getRange(i+1, 9, 1, 2).setValues([['','']]);
    }
  }
  Logger.log('Selesai hapus foto: ' + jumlahHapus + ' file.');
}

// Preview: lihat foto mana yang akan dihapus hari ini
function previewHapusFotoTugas() {
  const ss = getAktifSS();
  const sh = getOrCreateSheetRealisasi(ss);
  const tz = Session.getScriptTimeZone();
  const hari_ini = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const rows = sh.getDataRange().getValues();
  var akan_dihapus = [];
  for (var i=1; i<rows.length; i++) {
    var fotoId = norm(rows[i][8]);
    var tglHapus = rows[i][9] instanceof Date ?
      Utilities.formatDate(rows[i][9], tz, 'yyyy-MM-dd') : norm(rows[i][9]);
    if (!fotoId || !tglHapus || tglHapus > hari_ini) continue;
    akan_dihapus.push({baris:i+1, pembina:norm(rows[i][3]), tugas:norm(rows[i][2]),
                       tanggal:norm(rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0],tz,'yyyy-MM-dd'):rows[i][0]),
                       tglHapus:tglHapus, fotoId:fotoId});
  }
  Logger.log('Foto yang akan dihapus: ' + JSON.stringify(akan_dihapus));
  return akan_dihapus;
}


// ============================================================
// MODUL NOTIFIKASI PUSH (OneSignal)
//
// Kenapa OneSignal: mengirim push notification ke HP butuh pesan yang dienkripsi
// (ECDH + AES-GCM) sesuai standar Web Push. Google Apps Script tidak punya alat
// kriptografi untuk itu, jadi tidak bisa mengirim push sendiri. OneSignal bertindak
// sebagai perantara: kita cukup mengirim permintaan biasa ke API mereka, lalu mereka
// yang mengurus enkripsi dan pengirimannya ke Google/Apple. Paket gratisnya sudah
// lebih dari cukup untuk jumlah pengguna satu pesantren.
//
// Cara kerja pengingat jadwal:
// 1. Trigger Apps Script berjalan tiap 5 menit.
// 2. Dicek: ada jam pelajaran yang akan mulai dalam ~5 menit ke depan?
// 3. Kalau ada, dicari guru yang mengajar pada jam itu HARI INI.
// 4. Push dikirim ke guru tersebut (dikenali lewat namanya sebagai External ID).
//
// Pengingat yang sudah terkirim dicatat supaya tidak dikirim dua kali dalam satu hari.
// ============================================================

const NOTIF_TERKIRIM_KEY = 'wasiatNotifTerkirim'; // penanda di Script Properties

// Jam mulai tiap "jam ke-" diambil dari Pengaturan (key: JamPelajaranWaktu).
// Dipakai karena jadwal di aplikasi ini memakai "jam ke-" (jam ke-1, ke-2, dst),
// bukan jam dinding.
//
// Format tiap baris: JamKe | JamMulai[-JamSelesai] | [Hari1,Hari2,...]
//   1|08:00                          -> berlaku semua hari
//   1|08:00-09:00                    -> jam selesai boleh ditulis, yang dipakai jam mulainya
//   3|11:16-12:15|Senin,Selasa,Rabu  -> hanya hari yang disebut
//
// Bagian hari bersifat opsional supaya pengaturan lama (yang cuma "1|08:00") tetap
// berjalan tanpa perlu diubah. Kalau satu jam ke- ditulis dua kali dengan hari yang
// berbeda -- misal jam ke-3 berbeda antara Senin-Jumat dan Sabtu -- yang dipakai
// adalah baris yang harinya cocok dengan hari ini.
function getJamPelajaranWaktu(namaHari) {
  const teks = String(getPengaturan().JamPelajaranWaktu || '').trim();
  if (!teks) return {};
  const hasil = {};
  const cocokHari = {};  // penanda: nilai untuk jam ke- ini sudah dari baris ber-hari
  teks.split('\n').forEach(function(baris){
    const bagian = String(baris).split('|');
    const jamKe = norm(bagian[0]);
    const waktuMentah = norm(bagian[1]);
    const hariMentah = norm(bagian[2]);
    if (!jamKe || !waktuMentah) return;

    // Ambil jam mulainya saja kalau ditulis sebagai rentang "08:00-09:00"
    const waktu = waktuMentah.split('-')[0].trim().replace('.', ':');
    if (!/^\d{1,2}:\d{2}$/.test(waktu)) return;

    if (hariMentah) {
      // Baris khusus hari tertentu: hanya dipakai kalau harinya cocok
      if (!namaHari) return;
      const daftarHari = hariMentah.split(',').map(function(h){ return normNama(norm(h)); });
      if (daftarHari.indexOf(normNama(namaHari)) === -1) return;
      hasil[String(jamKe)] = waktu;
      cocokHari[String(jamKe)] = true;
    } else {
      // Baris umum: dipakai hanya kalau belum ada baris khusus hari untuk jam ke- ini
      if (!cocokHari[String(jamKe)]) hasil[String(jamKe)] = waktu;
    }
  });
  return hasil;
}

// Ubah "07:05" menjadi jumlah menit sejak tengah malam, supaya mudah dibandingkan.
function keMenit(jamStr) {
  const m = String(jamStr || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Kirim push lewat OneSignal ke daftar External ID (di aplikasi ini External ID =
// nama pengguna, sama seperti yang dipakai di kolom Pengampu/Pembina).
// Mengembalikan {ok, terkirim} -- tidak pernah melempar error supaya kegagalan
// notifikasi tidak ikut menggagalkan proses lain yang memanggilnya.
// opsi (opsional): {jenis, ttl, kirimSetelahDetik}
//   jenis  -> ikut dikirim sebagai data, dipakai aplikasi untuk memilih nada alarm
//   ttl    -> batas kedaluwarsa (detik). Pengingat jadwal tidak berguna kalau baru
//             sampai setelah kelas selesai, jadi diberi batas pendek.
//   kirimSetelahDetik -> tunda pengiriman (dipakai tombol uji: pengguna sempat mengunci
//             layar dulu untuk memastikan HP berbunyi/bergetar saat aplikasi tertutup)
function kirimPushOneSignal(externalIds, judul, isi, tautan, opsi) {
  opsi = opsi || {};
  try {
    const p = getPengaturan();
    const appId = norm(p.OneSignalAppId);
    const apiKey = norm(p.OneSignalApiKey);
    if (!appId || !apiKey) return {ok:false, error:'App ID / API Key OneSignal belum diatur.'};

    const daftar = (externalIds || []).map(norm).filter(Boolean);
    if (!daftar.length) return {ok:false, error:'Tidak ada penerima.'};

    const body = {
      app_id: appId,
      include_aliases: { external_id: daftar },
      target_channel: 'push',
      headings: { en: String(judul || 'WASIAT'), id: String(judul || 'WASIAT') },
      contents: { en: String(isi || ''), id: String(isi || '') },
      // Prioritas TINGGI: di Android 6+ ini membangunkan HP dari mode hemat daya
      // (doze). Tanpa ini, notifikasi bisa tertahan lama saat layar HP mati.
      priority: 10,
      // Kedaluwarsa: bawaan 1 jam. Notifikasi yang terlambat lebih dari itu (HP mati
      // seharian) tidak dikirim, supaya tidak muncul pengingat yang sudah basi.
      ttl: Number(opsi.ttl) > 0 ? Number(opsi.ttl) : 3600,
      data: { jenis: String(opsi.jenis || 'umum') },
      url: tautan || undefined
    };
    if (Number(opsi.kirimSetelahDetik) > 0) {
      body.send_after = new Date(Date.now() + Number(opsi.kirimSetelahDetik) * 1000).toISOString();
    }

    const resp = UrlFetchApp.fetch('https://api.onesignal.com/notifications', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Key ' + apiKey },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    const kode = resp.getResponseCode();
    const teks = resp.getContentText();
    if (kode < 200 || kode >= 300) {
      Logger.log('OneSignal gagal (' + kode + '): ' + teks);
      return {ok:false, error:'OneSignal menolak permintaan (kode ' + kode + '). ' + teks.slice(0, 200)};
    }
    let hasil = {};
    try { hasil = JSON.parse(teks); } catch(e) {}
    // OneSignal mengembalikan recipients: 0 kalau tidak ada perangkat yang cocok --
    // ini kasus paling sering (user belum menekan "Aktifkan Notifikasi" di aplikasi).
    if (hasil && hasil.recipients === 0) {
      return {ok:false, error:'Tidak ada perangkat terdaftar untuk penerima ini. Pastikan mereka sudah membuka aplikasi dan menekan "Aktifkan Notifikasi".'};
    }
    return {ok:true, terkirim: (hasil && hasil.recipients) || daftar.length, id: hasil && hasil.id};
  } catch (e) {
    Logger.log('kirimPushOneSignal error: ' + e.message);
    return {ok:false, error:'Gagal menghubungi OneSignal: ' + e.message};
  }
}

// Penanda "sudah dikirim hari ini" supaya pengingat yang sama tidak dikirim berulang
// setiap kali trigger berjalan. Disimpan per tanggal lalu dibersihkan sendiri.
function sudahDikirimHariIni(kunci) {
  const tz = Session.getScriptTimeZone();
  const hari = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  let data = {};
  try { data = JSON.parse(PROP.getProperty(NOTIF_TERKIRIM_KEY) || '{}'); } catch(e) {}
  if (data.tanggal !== hari) data = { tanggal: hari, kunci: {} };
  if (data.kunci[kunci]) return true;
  data.kunci[kunci] = 1;
  try { PROP.setProperty(NOTIF_TERKIRIM_KEY, JSON.stringify(data)); } catch(e) {}
  return false;
}

// ---- Pengingat jadwal mengajar guru ----
// Dijalankan trigger tiap 5 menit. Mengirim push ke guru yang jam mengajarnya
// akan mulai dalam beberapa menit ke depan.
function cekJadwalKirimNotif() {
  try {
    const p = getPengaturan();
    if (norm(p.NotifJadwalAktif) !== 'true') return;
    if (!norm(p.OneSignalAppId) || !norm(p.OneSignalApiKey)) return;

    const tz = Session.getScriptTimeZone();
    const sekarang = new Date();
    const menitSekarang = sekarang.getHours() * 60 + sekarang.getMinutes();
    const namaHariIni = HARI_LIST[sekarang.getDay()];

    // Jam pelajaran dibaca sesuai HARI INI -- jam Sabtu bisa berbeda dari Senin-Jumat.
    const jamMap = getJamPelajaranWaktu(namaHariIni);
    if (!Object.keys(jamMap).length) return; // Admin belum mengisi jam untuk hari ini

    // Berapa menit sebelum jam mulai notifikasi dikirim (default 10 menit).
    const jedaMenit = Number(p.NotifJadwalJedaMenit) > 0 ? Number(p.NotifJadwalJedaMenit) : 10;

    // Cari jam ke- yang waktunya jatuh dalam jendela pengiriman.
    // Jendela dibuat selebar interval trigger (5 menit) supaya tidak ada yang terlewat
    // kalau trigger berjalan sedikit tidak tepat waktu.
    const jamKeCocok = [];
    Object.keys(jamMap).forEach(function(jamKe){
      const mulai = keMenit(jamMap[jamKe]);
      if (mulai < 0) return;
      const selisih = mulai - menitSekarang;
      if (selisih <= jedaMenit && selisih > jedaMenit - 6) jamKeCocok.push(jamKe);
    });
    if (!jamKeCocok.length) return;

    const sh = getAktifSS().getSheetByName(SHEET_MAPEL);
    if (!sh) return;
    const rows = sh.getDataRange().getValues(); rows.shift();

    jamKeCocok.forEach(function(jamKe){
      // Kumpulkan jadwal hari ini pada jam ke- tersebut, dikelompokkan per guru
      const perGuru = {};
      rows.forEach(function(r){
        const mapel = norm(r[0]), kelas = norm(r[1]), pengampu = norm(r[2]);
        const hari = norm(r[3]), jk = String(r[4] === '' ? '' : r[4]).trim();
        if (!pengampu || jk !== String(jamKe)) return;
        if (normNama(hari) !== normNama(namaHariIni)) return;
        if (!perGuru[pengampu]) perGuru[pengampu] = [];
        perGuru[pengampu].push(mapel + ' (' + kelas + ')');
      });

      Object.keys(perGuru).forEach(function(guru){
        const kunci = 'jadwal|' + guru + '|' + jamKe;
        if (sudahDikirimHariIni(kunci)) return;
        const daftarKelas = perGuru[guru].join(', ');
        kirimPushOneSignal(
          [guru],
          '\u23F0 Jadwal mengajar segera dimulai',
          jedaMenit + ' menit lagi: ' + daftarKelas + ' (jam ke-' + jamKe + ', ' + jamMap[jamKe] + '). Jangan lupa isi absensi.',
          '',
          { jenis: 'jadwal', ttl: 15 * 60 }
        );
      });
    });
  } catch (e) {
    Logger.log('cekJadwalKirimNotif error: ' + e.message);
  }
}

// ---- Pengingat tugas harian pembina ----
// Jam pengingat diambil dari Pengaturan (key: JadwalNotifTugasPembina) dengan
// format "HH:MM|Pesan pengingat" satu per baris. Dipakai pendekatan ini -- bukan
// menambah kolom jam di sheet TugasPembina -- supaya struktur sheet yang sudah
// berjalan tidak perlu diubah sama sekali.
function cekTugasPembinaKirimNotif() {
  try {
    const p = getPengaturan();
    if (norm(p.NotifTugasPembinaAktif) !== 'true') return;
    if (!norm(p.OneSignalAppId) || !norm(p.OneSignalApiKey)) return;

    const teks = String(p.JadwalNotifTugasPembina || '').trim();
    if (!teks) return;

    const sekarang = new Date();
    const menitSekarang = sekarang.getHours() * 60 + sekarang.getMinutes();

    // Kumpulkan nama semua Pembina dari RoleAkses (push dikirim per nama).
    const shRole = getAktifSS().getSheetByName(SHEET_ROLE);
    if (!shRole) return;
    const baris = shRole.getDataRange().getValues(); baris.shift();
    const pembina = [];
    baris.forEach(function(r){
      const nama = norm(r[0]);
      const level = norm(r[3]);
      if (!nama) return;
      if (level.indexOf('Pembina') !== -1) pembina.push(nama);
    });
    if (!pembina.length) return;

    teks.split('\n').forEach(function(bar){
      const bagian = String(bar).split('|');
      const jam = norm(bagian[0]);
      const pesan = norm(bagian[1]) || 'Waktunya menjalankan tugas harian.';
      const mulai = keMenit(jam);
      if (mulai < 0) return;
      const selisih = mulai - menitSekarang;
      // Dikirim tepat saat waktunya (jendela 6 menit mengikuti interval trigger)
      if (selisih > 0 || selisih <= -6) return;
      const kunci = 'tugas|' + jam;
      if (sudahDikirimHariIni(kunci)) return;
      kirimPushOneSignal(pembina, '\u2705 Tugas Harian (' + jam + ')', pesan, '', { jenis: 'tugas', ttl: 30 * 60 });
    });
  } catch (e) {
    Logger.log('cekTugasPembinaKirimNotif error: ' + e.message);
  }
}

// Satu fungsi gabungan yang dipanggil trigger, supaya cukup satu trigger 5 menit
// untuk semua jenis pengingat (kuota trigger Apps Script terbatas).
function jalankanSemuaPengingatNotif() {
  cekJadwalKirimNotif();
  cekTugasPembinaKirimNotif();
}

// Pasang / hapus trigger dari UI Admin.
function apiPasangTriggerNotif(aktif) {
  try {
    // Hapus trigger lama dengan nama fungsi yang sama supaya tidak menumpuk
    ScriptApp.getProjectTriggers().forEach(function(t){
      if (t.getHandlerFunction() === 'jalankanSemuaPengingatNotif') ScriptApp.deleteTrigger(t);
    });
    if (!aktif) return {ok:true, pesan:'Pengingat otomatis dimatikan.'};
    ScriptApp.newTrigger('jalankanSemuaPengingatNotif').timeBased().everyMinutes(5).create();
    return {ok:true, pesan:'Pengingat otomatis dipasang (diperiksa tiap 5 menit).'};
  } catch (e) {
    return {ok:false, error:'Gagal memasang trigger: ' + e.message};
  }
}

function apiStatusTriggerNotif() {
  try {
    const ada = ScriptApp.getProjectTriggers().some(function(t){
      return t.getHandlerFunction() === 'jalankanSemuaPengingatNotif';
    });
    return {ok:true, aktif: ada};
  } catch (e) {
    return {ok:true, aktif:false, catatan:'Tidak bisa membaca status trigger: ' + e.message};
  }
}

// Kirim push manual -- dipakai Admin untuk uji coba dan untuk pengumuman.
function apiKirimPushManual(p) {
  const judul = norm(p.judul) || 'Pengumuman';
  const isi = norm(p.isi);
  if (!isi) return {ok:false, error:'Isi pesan wajib diisi.'};

  let penerima = [];
  if (p.target === 'diri' ) {
    penerima = [norm(p.namaPengirim)];
  } else if (p.target === 'pembina' || p.target === 'guru') {
    const shRole = getAktifSS().getSheetByName(SHEET_ROLE);
    const baris = shRole.getDataRange().getValues(); baris.shift();
    baris.forEach(function(r){
      const nama = norm(r[0]), level = norm(r[3]);
      if (!nama) return;
      if (p.target === 'pembina' && level.indexOf('Pembina') !== -1) penerima.push(nama);
      // Menu Guru kini ada di akun Pembina, Kepala Bagian, Admin, dan Mudir -- mereka tidak
      // perlu lagi peran "Guru" terpisah, jadi pengumuman untuk guru juga sampai ke mereka.
      if (p.target === 'guru' && /Guru|Pembina|Kabag|Admin|Mudir/.test(level)) penerima.push(nama);
    });
  } else if (Array.isArray(p.penerima)) {
    penerima = p.penerima;
  }
  return kirimPushOneSignal(penerima, judul, isi, '', { jenis: 'pengumuman' });
}

// Uji notifikasi ke HP pengguna sendiri, DITUNDA 30 detik -- supaya pengguna sempat
// menutup aplikasi & mengunci layar, lalu memastikan HP-nya benar-benar berbunyi /
// bergetar saat notifikasi datang dalam keadaan aplikasi tertutup (keadaan yang paling
// sering bermasalah karena diatur oleh pengaturan Android, bukan oleh aplikasi).
function apiKirimPushUji(p) {
  const nama = norm(p.nama);
  if (!nama) return {ok:false, error:'Nama pengguna tidak diketahui.'};
  const tunda = Math.min(Math.max(Number(p.tundaDetik) || 30, 0), 120);
  return kirimPushOneSignal([nama], '\uD83D\uDD14 Uji Notifikasi WASIAT',
    'Kalau Anda mendengar bunyi/getar saat pesan ini muncul, notifikasi di HP ini sudah berfungsi dengan baik.',
    '', { jenis: 'uji', ttl: 600, kirimSetelahDetik: tunda });
}


// ============================================================
// NOTIFIKASI PUSH KE ORANG TUA / WALI SANTRI
//
// Push dikirim berdasarkan NISN santri: dicari akun ber-role WaliSantri di RoleAkses
// yang kolom "NISN Anak"-nya memuat NISN tersebut, lalu push dikirim ke NAMA akun itu
// (karena External ID di aplikasi = nama pengguna).
//
// Mendukung kondisi berikut:
// - Satu santri punya lebih dari satu akun wali (misal ayah dan ibu punya akun sendiri)
//   -> keduanya dapat notifikasi.
// - Satu akun wali punya beberapa anak (kolom NISN Anak berisi beberapa NISN dipisah
//   koma) -> pencocokan dilakukan per NISN, bukan membandingkan seluruh isi kolom.
//
// Semua pengiriman dibungkus try/catch dan TIDAK PERNAH mengembalikan error ke
// pemanggil. Alasannya penting: fungsi ini disisipkan ke dalam proses transaksi
// (belanja, top up, pelunasan SPP). Kalau notifikasi gagal -- misal OneSignal belum
// diatur atau internet server sedang bermasalah -- transaksinya HARUS tetap berhasil.
// Uang dan pencatatan jauh lebih penting daripada notifikasi.
// ============================================================

function cariNamaWaliDariNisn(nisn) {
  try {
    nisn = norm(nisn);
    if (!nisn) return [];
    const sh = getAktifSS().getSheetByName(SHEET_ROLE);
    if (!sh) return [];
    const rows = sh.getDataRange().getValues(); rows.shift();
    const hasil = [];
    rows.forEach(function(r){
      const nama = norm(r[0]);
      const level = norm(r[3]);
      const kolomNisn = norm(r[4]);
      if (!nama || !kolomNisn) return;
      if (level.indexOf('WaliSantri') === -1) return;
      // Kolom NISN Anak bisa memuat beberapa NISN dipisah koma
      const daftar = kolomNisn.split(',').map(function(x){ return norm(x); }).filter(Boolean);
      if (daftar.indexOf(nisn) !== -1 && hasil.indexOf(nama) === -1) hasil.push(nama);
    });
    return hasil;
  } catch (e) {
    Logger.log('cariNamaWaliDariNisn error: ' + e.message);
    return [];
  }
}

// Kirim push ke wali dari satu santri. Aman dipanggil dari mana saja -- kegagalan
// hanya dicatat di log, tidak pernah mengganggu proses yang memanggilnya.
function kirimPushKeWali(nisn, judul, isi) {
  if (_antreanNotifTerkunci_) { _antreanNotifTerkunci_.push(['pushWali', nisn, judul, isi]); return; }
  try {
    const p = getPengaturan();
    if (norm(p.NotifWaliAktif) !== 'true') return;
    if (!norm(p.OneSignalAppId) || !norm(p.OneSignalApiKey)) return;
    const wali = cariNamaWaliDariNisn(nisn);
    if (!wali.length) return;
    kirimPushOneSignal(wali, judul, isi, '', { jenis: 'wali' });
  } catch (e) {
    Logger.log('kirimPushKeWali error: ' + e.message);
  }
}

// Format rupiah singkat untuk isi notifikasi
function rp(n) {
  return 'Rp' + (Number(n) || 0).toLocaleString('id-ID');
}


// ============================================================
// MODUL KAS KELAS
//
// Wali kelas menerima pembayaran santri (uang kas, rihlah, atau keperluan lain)
// langsung dari saldo santri -- alur dan pengamanannya sama dengan kantin: pilih
// santri, masukkan nominal, santri memasukkan PIN Transaksinya sendiri.
//
// Uang ini TIDAK masuk ke kas pondok maupun ke pemilik barang. Ini kas milik kelas
// yang dikelola wali kelasnya, jadi dicatat di sheet tersendiri dengan saldo per
// kelas. Pengeluaran kas juga dicatat di sheet yang sama (kolom Tipe) supaya sisa
// kasnya selalu bisa dipertanggungjawabkan.
// ============================================================

const SHEET_KAS_KELAS = 'KasKelas';

function headerKasKelas() {
  return ['Tanggal','Waktu','Kelas','Tipe','Jenis','NISN','Nama Santri','Nominal','Keterangan','Dicatat Oleh'];
}

function getOrCreateSheetKasKelas() {
  const ss = getAktifSS();
  let sh = ss.getSheetByName(SHEET_KAS_KELAS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_KAS_KELAS);
    sh.appendRow(headerKasKelas());
    sh.setFrozenRows(1);
  }
  return sh;
}

// Pastikan nama yang mengaku wali kelas memang wali kelas dari kelas tersebut.
// Diperiksa di server supaya seorang guru tidak bisa mencatat transaksi di kelas lain.
// Sumber datanya kolom 'WaliKelas' di sheet Guru -- sama persis dengan yang dipakai
// saat login menentukan STATE.user.waliKelas, supaya tidak pernah berbeda hasilnya.
function waliKelasDari(nama, kelas) {
  nama = norm(nama); kelas = norm(kelas);
  if (!nama || !kelas) return false;
  try {
    const sh = getAktifSS().getSheetByName(SHEET_GURU);
    if (!sh) return false;
    const rows = sh.getDataRange().getValues();
    const header = rows.shift();
    const iWali = header.indexOf('WaliKelas');
    if (iWali === -1) return false;
    return rows.some(function(r){
      return normNama(norm(r[0])) === normNama(nama) && norm(r[iWali]) === kelas;
    });
  } catch (e) { return false; }
}

// Terima pembayaran santri ke kas kelas: saldo santri dipotong, lalu dicatat.
function apiTerimaKasKelas(p) {
  const nisn = norm(p.nisn), pinInput = norm(p.pin);
  const kelas = norm(p.kelas), jenis = norm(p.jenis) || 'Uang Kas';
  const nominal = Number(p.nominal) || 0;
  const oleh = norm(p.oleh);

  if (!nisn || !pinInput) return {ok:false, error:'Santri dan PIN Transaksi wajib diisi.'};
  if (nominal <= 0) return {ok:false, error:'Nominal harus lebih dari 0.'};
  if (!kelas) return {ok:false, error:'Kelas tidak diketahui.'};
  if (!waliKelasDari(oleh, kelas)) {
    return {ok:false, error:'Anda bukan wali kelas dari kelas ini, tidak bisa mencatat transaksi.'};
  }

  // Kunci proses supaya dua transaksi bersamaan tidak saling menimpa saldo.
  const lock = kunciTransaksi_();
  try { lock.waitLock(30000); } catch (e) { return {ok:false, error:'Server sedang memproses transaksi lain. Data BELUM tersimpan -- silakan tekan tombolnya sekali lagi.'}; }
  try {
    const ss = getAktifSS();
    const shSantri = ss.getSheetByName(SHEET_SANTRI);
    const rows = shSantri.getDataRange().getValues();
    const header = rows[0];
    const iSaldo = header.indexOf('Saldo Kantin');
    const iPin = header.indexOf('PIN Transaksi');
    const iKelas = header.indexOf('Kelas');
    if (iSaldo === -1 || iPin === -1) return {ok:false, error:'Kolom Saldo/PIN tidak ditemukan di data santri.'};

    let rowIdx = -1;
    for (let i=1;i<rows.length;i++) { if (norm(rows[i][0]) === nisn) { rowIdx = i+1; break; } }
    if (rowIdx === -1) return {ok:false, error:'Data santri tidak ditemukan.'};

    const row = rows[rowIdx-1];
    const namaSantri = norm(row[1]);
    // Pastikan santrinya memang dari kelas yang ditangani wali kelas ini.
    if (iKelas !== -1 && norm(row[iKelas]) && norm(row[iKelas]) !== kelas) {
      return {ok:false, error:namaSantri + ' bukan santri kelas ' + kelas + '.'};
    }

    const pinTersimpan = norm(row[iPin]);
    if (!pinTersimpan) return {ok:false, error:'Santri ini belum punya PIN Transaksi. Minta Admin mengaturnya di menu Data Santri.'};
    if (pinTersimpan !== pinInput) return {ok:false, error:'PIN Transaksi salah.'};

    const saldo = Number(row[iSaldo]) || 0;
    if (nominal > saldo) {
      return {ok:false, error:'Saldo santri tidak mencukupi (saldo: Rp'+saldo.toLocaleString('id-ID')+', diminta: Rp'+nominal.toLocaleString('id-ID')+').'};
    }

    const saldoSekarang = saldo - nominal;
    shSantri.getRange(rowIdx, iSaldo+1).setValue(saldoSekarang);

    const tz = Session.getScriptTimeZone();
    const tgl = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const wkt = Utilities.formatDate(new Date(), tz, 'HH:mm:ss');
    getOrCreateSheetKasKelas().appendRow([
      tgl, wkt, kelas, 'Masuk', jenis, nisn, namaSantri, nominal, norm(p.keterangan), oleh
    ]);

    // Catat juga ke riwayat transaksi santri, supaya SEMUA pengeluaran saldo terlihat
    // di satu tempat oleh Admin/Mudir dan wali santri.
    // Catatan penting soal pengisian kolomnya:
    // - kategori 'Kas Kelas' membuatnya tidak terhitung sebagai belanja kantin, jadi
    //   tidak memakan limit jajan harian santri (memang seharusnya begitu).
    // - kolom pemilik dikosongkan supaya transaksi ini tidak muncul di laporan
    //   penjualan pemilik barang -- kalau diisi nama wali kelas yang kebetulan juga
    //   pemilik barang, omzetnya akan tercampur.
    // - potongan & masuk pemilik 0: uang ini milik kas kelas, bukan pendapatan pondok
    //   maupun pemilik barang, jadi tidak boleh ikut terhitung di sana.
    try {
      getAktifKantinSS().getSheetByName(SHEET_TRANSAKSI_KANTIN).appendRow([
        tgl, wkt, nisn, namaSantri, nominal, 'Kas Kelas',
        jenis + (norm(p.keterangan) ? (' - ' + norm(p.keterangan)) : '') + ' (kelas ' + kelas + ')',
        1, 0, '', 0, saldo, saldoSekarang
      ]);
    } catch(e) { Logger.log('Catat riwayat transaksi kas kelas gagal: ' + e.message); }

    // Beri tahu wali santri -- transaksi ini memotong saldo anaknya.
    try {
      kirimPushKeWali(nisn, '\uD83C\uDFEB Pembayaran ' + jenis,
        namaSantri + ' membayar ' + jenis + ' ' + rp(nominal) + ' ke kas kelas. Sisa saldo: ' + rp(saldoSekarang) + '.');
    } catch(e) { Logger.log('Notif wali kas kelas gagal: ' + e.message); }

    return {ok:true, namaSantri: namaSantri, saldoSekarang: saldoSekarang, nominal: nominal, jenis: jenis};
  } finally {
    lock.releaseLock();
  }
}

// Catat pengeluaran kas kelas (tidak menyentuh saldo santri).
function apiCatatPengeluaranKasKelas(p) {
  const kelas = norm(p.kelas), oleh = norm(p.oleh);
  const nominal = Number(p.nominal) || 0;
  const keterangan = norm(p.keterangan);
  if (nominal <= 0) return {ok:false, error:'Nominal harus lebih dari 0.'};
  if (!keterangan) return {ok:false, error:'Keterangan pengeluaran wajib diisi.'};
  if (!waliKelasDari(oleh, kelas)) {
    return {ok:false, error:'Anda bukan wali kelas dari kelas ini.'};
  }
  const tz = Session.getScriptTimeZone();
  getOrCreateSheetKasKelas().appendRow([
    Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'),
    Utilities.formatDate(new Date(), tz, 'HH:mm:ss'),
    kelas, 'Keluar', norm(p.jenis) || 'Uang Kas', '', '', nominal, keterangan, oleh
  ]);
  return {ok:true};
}

// Rekap kas satu kelas: saldo per jenis, daftar santri yang sudah/belum bayar,
// dan riwayat transaksi terbaru.
function apiGetRekapKasKelas(p) {
  const kelas = norm(p.kelas);
  const jenisFilter = norm(p.jenis);
  if (!kelas) return {ok:false, error:'Kelas tidak diketahui.'};

  const sh = getOrCreateSheetKasKelas();
  const rows = sh.getDataRange().getValues(); rows.shift();

  const perJenis = {};      // { jenis: {masuk, keluar} }
  const sudahBayar = {};    // { jenis: { nisn: total } }
  const riwayat = [];

  rows.forEach(function(r, i){
    if (norm(r[2]) !== kelas) return;
    const tipe = norm(r[3]), jenis = norm(r[4]) || 'Uang Kas';
    const nominal = Number(r[7]) || 0;
    if (!perJenis[jenis]) perJenis[jenis] = {masuk:0, keluar:0};
    if (tipe === 'Keluar') perJenis[jenis].keluar += nominal;
    else {
      perJenis[jenis].masuk += nominal;
      const nisn = norm(r[5]);
      if (nisn) {
        if (!sudahBayar[jenis]) sudahBayar[jenis] = {};
        sudahBayar[jenis][nisn] = (sudahBayar[jenis][nisn] || 0) + nominal;
      }
    }
    if (!jenisFilter || jenis === jenisFilter) {
      riwayat.push({rowIndex:i+2, tanggal:norm(r[0]), waktu:formatWaktu(r[1]), tipe:tipe, jenis:jenis,
        nisn:norm(r[5]), nama:norm(r[6]), nominal:nominal, keterangan:norm(r[8]), oleh:norm(r[9])});
    }
  });

  riwayat.sort(function(a,b){ return (b.tanggal+b.waktu).localeCompare(a.tanggal+a.waktu); });

  // Daftar santri kelas ini beserta status bayarnya untuk jenis yang dipilih
  const shSantri = getAktifSS().getSheetByName(SHEET_SANTRI);
  const rs = shSantri.getDataRange().getValues();
  const hs = rs.shift();
  const iKelasS = hs.indexOf('Kelas'), iSaldoS = hs.indexOf('Saldo Kantin');
  const jenisUtama = jenisFilter || 'Uang Kas';
  const daftarSantri = [];
  rs.forEach(function(r){
    if (iKelasS === -1 || norm(r[iKelasS]) !== kelas) return;
    const nisn = norm(r[0]);
    daftarSantri.push({
      nisn: nisn, nama: norm(r[1]),
      saldo: iSaldoS !== -1 ? (Number(r[iSaldoS]) || 0) : 0,
      sudahBayar: (sudahBayar[jenisUtama] && sudahBayar[jenisUtama][nisn]) || 0
    });
  });
  daftarSantri.sort(function(a,b){ return a.nama.localeCompare(b.nama); });

  // Daftar jenis yang pernah dipakai di kelas ini, untuk pilihan di aplikasi
  const daftarJenis = Object.keys(perJenis);

  return {ok:true, kelas:kelas, perJenis:perJenis, daftarJenis:daftarJenis,
          daftarSantri:daftarSantri, riwayat:riwayat.slice(0, 100)};
}

// Hapus satu catatan kas kelas. Kalau catatan itu berupa pemasukan dari santri,
// saldo santrinya DIKEMBALIKAN -- supaya pembatalan salah input tidak membuat
// uang santri hilang begitu saja.
function apiHapusKasKelas(p) {
  const oleh = norm(p.oleh);
  const baris = Number(p.rowIndex);
  const sh = getOrCreateSheetKasKelas();
  if (!(baris > 1) || baris > sh.getLastRow()) return {ok:false, error:'Catatan tidak ditemukan.'};

  const lock = kunciTransaksi_();
  try { lock.waitLock(30000); } catch (e) { return {ok:false, error:'Server sedang memproses transaksi lain. Data BELUM tersimpan -- silakan tekan tombolnya sekali lagi.'}; }
  try {
    const data = sh.getRange(baris, 1, 1, headerKasKelas().length).getValues()[0];
    const kelas = norm(data[2]), tipe = norm(data[3]);
    const nisn = norm(data[5]), nominal = Number(data[7]) || 0;
    if (!waliKelasDari(oleh, kelas)) return {ok:false, error:'Anda bukan wali kelas dari kelas ini.'};

    if (tipe === 'Masuk' && nisn && nominal > 0) {
      const shSantri = getAktifSS().getSheetByName(SHEET_SANTRI);
      const rows = shSantri.getDataRange().getValues();
      const iSaldo = rows[0].indexOf('Saldo Kantin');
      for (let i=1;i<rows.length;i++) {
        if (norm(rows[i][0]) === nisn) {
          const saldoLama = Number(rows[i][iSaldo]) || 0;
          const saldoBaru = saldoLama + nominal;
          shSantri.getRange(i+1, iSaldo+1).setValue(saldoBaru);
          // Pengembalian dicatat juga di riwayat transaksi santri -- tanpa ini saldo
          // bertambah tanpa jejak dan wali santri akan bingung melihatnya naik sendiri.
          try {
            const tzH = Session.getScriptTimeZone();
            getAktifKantinSS().getSheetByName(SHEET_TRANSAKSI_KANTIN).appendRow([
              Utilities.formatDate(new Date(), tzH, 'yyyy-MM-dd'),
              Utilities.formatDate(new Date(), tzH, 'HH:mm:ss'),
              nisn, norm(data[6]), nominal, 'Kas Kelas',
              'Pembatalan ' + norm(data[4]) + ' (kelas ' + kelas + ') - saldo dikembalikan',
              1, 0, '', 0, saldoLama, saldoBaru
            ]);
          } catch(e) { Logger.log('Catat pembatalan kas kelas gagal: ' + e.message); }
          break;
        }
      }
    }
    sh.deleteRow(baris);
    return {ok:true, dikembalikan: (tipe === 'Masuk' ? nominal : 0)};
  } finally {
    lock.releaseLock();
  }
}


// ============================================================
// MODUL FLYER TASMI' HAFALAN
//
// Admin/Mudir mengunggah template gambar (boleh lebih dari satu). Pengampu halaqoh
// hanya memilih template yang tersedia lalu mengisi data santri -- mereka tidak bisa
// menambah, mengubah, atau menghapus template.
//
// Catatan teknis penting (proxy gambar):
// Flyer digambar ulang di <canvas> supaya bisa diunduh dalam resolusi tinggi. Kalau
// gambar dimuat langsung dari URL Google Drive, browser menandai canvas sebagai
// "tercemar" (tainted) karena beda domain, dan perintah unduh akan GAGAL TOTAL.
// Karena itu gambar diambil lewat apiGambarKeBase64 di bawah: server yang mengunduh
// gambarnya lalu mengirim isinya sebagai teks base64, sehingga di browser gambar itu
// dianggap berasal dari domain sendiri dan canvas tetap bersih.
// ============================================================

const SHEET_TEMPLATE_FLYER = 'TemplateFlyer';

function getOrCreateSheetTemplateFlyer() {
  const ss = getMasterSS();
  let sh = ss.getSheetByName(SHEET_TEMPLATE_FLYER);
  if (!sh) {
    sh = ss.insertSheet(SHEET_TEMPLATE_FLYER);
    sh.appendRow(['Nama Template','URL Gambar','Keterangan','Aktif','Dibuat']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function apiGetTemplateFlyer() {
  const cached = cacheAmbil('templateflyer_v1');
  if (cached) return {ok:true, data:cached};
  const sh = getOrCreateSheetTemplateFlyer();
  const rows = sh.getDataRange().getValues(); rows.shift();
  const data = rows.map(function(r,i){
    return { rowIndex:i+2, nama:norm(r[0]), url:norm(r[1]), keterangan:norm(r[2]),
             aktif: String(r[3]).toLowerCase() !== 'false' };
  }).filter(function(x){ return x.nama && x.url; });
  cacheSimpan('templateflyer_v1', data, 300);
  return {ok:true, data:data};
}

function apiSaveTemplateFlyer(p) {
  if (!adminAtauMudir(p.oleh)) {
    return {ok:false, error:'Hanya Admin/Mudir yang boleh mengatur template flyer.'};
  }
  const nama = norm(p.nama), url = norm(p.url);
  if (!nama) return {ok:false, error:'Nama template wajib diisi.'};
  if (!url) return {ok:false, error:'Gambar template wajib diunggah.'};
  const sh = getOrCreateSheetTemplateFlyer();
  const tz = Session.getScriptTimeZone();
  const baris = [nama, url, norm(p.keterangan), (p.aktif === false ? 'false' : 'true'),
                 Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd')];
  if (p.rowIndex && Number(p.rowIndex) > 1) {
    sh.getRange(Number(p.rowIndex), 1, 1, 5).setValues([baris]);
  } else {
    sh.appendRow(baris);
  }
  cacheHapus('templateflyer_v1');
  return {ok:true};
}

function apiHapusTemplateFlyer(p) {
  if (!adminAtauMudir(p.oleh)) {
    return {ok:false, error:'Hanya Admin/Mudir yang boleh menghapus template flyer.'};
  }
  const sh = getOrCreateSheetTemplateFlyer();
  const baris = Number(p.rowIndex);
  if (!(baris > 1) || baris > sh.getLastRow()) return {ok:false, error:'Template tidak ditemukan.'};
  sh.deleteRow(baris);
  cacheHapus('templateflyer_v1');
  return {ok:true};
}

// Ambil gambar dari URL lalu kembalikan sebagai data URI base64.
// Dipakai supaya canvas tidak "tercemar" (lihat catatan di atas) sehingga flyer
// benar-benar bisa diunduh. Dibatasi ke domain Google agar tidak bisa dipakai
// mengambil sembarang alamat di internet.
function apiGambarKeBase64(p) {
  const url = norm(p.url);
  if (!url) return {ok:false, error:'URL gambar kosong.'};
  if (!/^https:\/\/(lh3\.googleusercontent\.com|drive\.google\.com)\//.test(url)) {
    return {ok:false, error:'Hanya gambar dari Google Drive yang bisa diproses.'};
  }
  try {
    const resp = UrlFetchApp.fetch(url, {muteHttpExceptions:true, followRedirects:true});
    if (resp.getResponseCode() !== 200) {
      return {ok:false, error:'Gagal mengambil gambar (kode '+resp.getResponseCode()+'). Pastikan gambar dibagikan untuk "siapa saja yang memiliki link".'};
    }
    const blob = resp.getBlob();
    const mime = blob.getContentType() || 'image/jpeg';
    return {ok:true, dataUri: 'data:' + mime + ';base64,' + Utilities.base64Encode(blob.getBytes())};
  } catch (e) {
    return {ok:false, error:'Gagal memproses gambar: ' + e.message};
  }
}

// Daftar santri yang bisa dipilih pengampu untuk dibuatkan flyer.
// Admin/Mudir melihat semua santri; pengampu hanya santri di halaqoh yang dia ampu.
function apiGetSantriUntukFlyer(p) {
  const oleh = norm(p.oleh);
  if (adminAtauMudir(oleh)) {
    const rows = getAktifSS().getSheetByName(SHEET_SANTRI).getDataRange().getValues();
    const header = rows.shift();
    const iKelas = header.indexOf('Kelas');
    return {ok:true, data: rows.filter(function(r){ return norm(r[0]); }).map(function(r){
      return {nisn:norm(r[0]), nama:norm(r[1]), kelas: iKelas !== -1 ? norm(r[iKelas]) : ''};
    })};
  }
  // Pengampu: kumpulkan anggota dari semua halaqoh yang dia ampu
  const halaqoh = getSantriHalaqohGuru(oleh);
  if (!halaqoh.length) return {ok:true, data:[], catatan:'Anda belum tercatat sebagai pengampu halaqoh mana pun.'};
  const sudah = {};
  const hasil = [];
  halaqoh.forEach(function(h){
    (getSantriHalaqohByGender(h.namaHalaqoh, h.gender) || []).forEach(function(s){
      const nisn = norm(s.nisn || s.NISN);
      if (!nisn || sudah[nisn]) return;
      sudah[nisn] = 1;
      hasil.push({nisn:nisn, nama:norm(s.nama || s.Nama), kelas:norm(s.kelas || s.Kelas || '')});
    });
  });
  hasil.sort(function(a,b){ return a.nama.localeCompare(b.nama); });
  return {ok:true, data:hasil};
}


// ============================================================
// RIWAYAT TASMI' HAFALAN
//
// Dicatat otomatis setiap kali flyer diunduh, DAN bisa ditambahkan manual untuk
// melengkapi data tasmi' yang sudah terjadi sebelum fitur ini ada.
//
// Kolom 'Sumber' membedakan keduanya (Flyer / Manual) supaya terlihat mana data
// yang berasal dari pembuatan flyer dan mana yang diinput belakangan.
// ============================================================

const SHEET_RIWAYAT_TASMI = 'RiwayatTasmi';
// Riwayat Tasmi' ikut disalin ke tahun ajaran baru: ini rekam jejak capaian hafalan
// santri sepanjang dia mondok, bukan data satu tahun ajaran. Kalau direset tiap tahun,
// catatan berapa juz yang sudah ditasmi' terputus dan tidak bisa dipakai untuk laporan.
// (push diletakkan SETELAH deklarasi di atas -- kalau sebelumnya, nilainya belum ada
// saat baris ini dijalankan dan seluruh skrip akan error.)
SHEETS_DISALIN.push(SHEET_RIWAYAT_TASMI);

function getOrCreateSheetRiwayatTasmi() {
  const ss = getAktifSS();
  let sh = ss.getSheetByName(SHEET_RIWAYAT_TASMI);
  if (!sh) {
    sh = ss.insertSheet(SHEET_RIWAYAT_TASMI);
    sh.appendRow(['Tanggal','NISN','Nama Santri','Kelas','Jumlah Juz','Rincian Juz','Nilai','Pengampu','Sumber','Catatan','Dicatat']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function apiSimpanRiwayatTasmi(p) {
  const nisn = norm(p.nisn), nama = norm(p.nama);
  if (!nama) return {ok:false, error:'Nama santri wajib diisi.'};
  const juz = norm(p.juz);
  if (!juz) return {ok:false, error:'Jumlah juz wajib diisi.'};
  const tanggal = norm(p.tanggal) || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  const sh = getOrCreateSheetRiwayatTasmi();
  const baris = [tanggal, nisn, nama, norm(p.kelas), juz, norm(p.rincian), norm(p.nilai),
                 norm(p.pengampu), norm(p.sumber) || 'Manual', norm(p.catatan),
                 Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')];

  if (p.rowIndex && Number(p.rowIndex) > 1) {
    // Edit: hanya pencatatnya sendiri atau Admin/Mudir yang boleh mengubah
    const lama = sh.getRange(Number(p.rowIndex), 1, 1, 11).getValues()[0];
    if (!adminAtauMudir(p.oleh) && normNama(norm(lama[7])) !== normNama(norm(p.oleh))) {
      return {ok:false, error:'Catatan ini dibuat pengampu lain, tidak bisa Anda ubah.'};
    }
    sh.getRange(Number(p.rowIndex), 1, 1, 11).setValues([baris]);
  } else {
    sh.appendRow(baris);
  }
  return {ok:true};
}

function apiGetRiwayatTasmi(p) {
  const sh = getOrCreateSheetRiwayatTasmi();
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  const oleh = norm(p.oleh);
  const semua = adminAtauMudir(oleh);   // Admin/Mudir melihat semua pengampu
  const filterNisn = norm(p.nisn);

  const data = rows.map(function(r,i){
    const t = (r[0] instanceof Date) ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : norm(r[0]);
    return {rowIndex:i+2, tanggal:t, nisn:norm(r[1]), nama:norm(r[2]), kelas:norm(r[3]),
            juz:norm(r[4]), rincian:norm(r[5]), nilai:norm(r[6]), pengampu:norm(r[7]),
            sumber:norm(r[8]), catatan:norm(r[9])};
  }).filter(function(x){
    if (!x.nama) return false;
    if (filterNisn && x.nisn !== filterNisn) return false;
    if (!semua && p.hanyaSaya === true && normNama(x.pengampu) !== normNama(oleh)) return false;
    if (p.tglMulai && x.tanggal < norm(p.tglMulai)) return false;
    if (p.tglAkhir && x.tanggal > norm(p.tglAkhir)) return false;
    return true;
  }).sort(function(a,b){ return b.tanggal.localeCompare(a.tanggal); });

  // Ringkasan: berapa santri berbeda, dan sebaran nilainya
  const santriUnik = {}, perNilai = {};
  data.forEach(function(x){
    if (x.nisn) santriUnik[x.nisn] = 1;
    if (x.nilai) perNilai[x.nilai] = (perNilai[x.nilai] || 0) + 1;
  });

  return {ok:true, data:data, jumlahSantri:Object.keys(santriUnik).length,
          totalCatatan:data.length, perNilai:perNilai, bolehSemua:semua};
}

function apiHapusRiwayatTasmi(p) {
  const sh = getOrCreateSheetRiwayatTasmi();
  const baris = Number(p.rowIndex);
  if (!(baris > 1) || baris > sh.getLastRow()) return {ok:false, error:'Catatan tidak ditemukan.'};
  const lama = sh.getRange(baris, 1, 1, 11).getValues()[0];
  if (!adminAtauMudir(p.oleh) && normNama(norm(lama[7])) !== normNama(norm(p.oleh))) {
    return {ok:false, error:'Catatan ini dibuat pengampu lain, tidak bisa Anda hapus.'};
  }
  sh.deleteRow(baris);
  return {ok:true};
}


// ============================================================
// PERBAIKAN KOLOM KATEGORI DI SHEET TRANSAKSI
//
// Masalahnya: pada data yang ditulis versi aplikasi terdahulu, kolom Kategori
// tidak terisi. Padahal kolom itu dipakai untuk MENYARING, bukan sekadar label:
//   - Limit jajan harian hanya menghitung kategori 'Kantin'
//   - Riwayat Mutasi Saldo hanya menampilkan 'Top Up Saldo' dan 'Penarikan'
// Kalau kosong, limit jajan tidak berfungsi sama sekali dan riwayat mutasi kosong.
//
// Dua lapis penanganan:
// 1. tebakKategoriTransaksi() -- menebak kategori dari kolom lain saat DIBACA,
//    sehingga fitur tetap berjalan benar walau perbaikan belum dijalankan.
// 2. apiPerbaikiKategoriTransaksi() -- mengisi kolom yang kosong satu kali,
//    supaya datanya benar secara permanen.
// ============================================================

// Tebak kategori dari isi baris. Urutan pemeriksaan penting: pola yang paling
// khas diperiksa lebih dulu supaya tidak salah klasifikasi.
function tebakKategoriTransaksi(namaBarang, pemilik, masukPemilik) {
  const nb = norm(namaBarang);
  const nbKecil = nb.toLowerCase();
  if (!nb && !norm(pemilik)) return '';

  if (nbKecil.indexOf('top up') !== -1 || nbKecil.indexOf('topup') !== -1) return 'Top Up Saldo';
  if (nbKecil.indexOf('penarikan') !== -1 || nbKecil.indexOf('tarik saldo') !== -1) return 'Penarikan';
  if (nbKecil.indexOf('koreksi') !== -1) return 'Koreksi Saldo';
  // Kas kelas ditulis dengan pola "<jenis> ... (kelas <nama kelas>)"
  if (nbKecil.indexOf('(kelas ') !== -1 || nbKecil.indexOf('uang kas') !== -1 ||
      nbKecil.indexOf('rihlah') !== -1) return 'Kas Kelas';
  // Sisanya: ada pemilik barang = pembelian di kantin
  if (norm(pemilik)) return 'Kantin';
  if (Number(masukPemilik) > 0) return 'Kantin';
  return 'Lainnya';
}

// Isi kolom Kategori yang kosong. Hanya Admin/Mudir, dan hanya menyentuh baris
// yang kategorinya BENAR-BENAR kosong -- baris yang sudah terisi tidak diubah.
function apiPerbaikiKategoriTransaksi(p) {
  if (!adminAtauMudir(p.oleh)) {
    return {ok:false, error:'Hanya Admin/Mudir yang boleh menjalankan perbaikan data.'};
  }
  const sh = getAktifKantinSS().getSheetByName(SHEET_TRANSAKSI_KANTIN);
  if (!sh) return {ok:false, error:'Sheet TransaksiKantin tidak ditemukan.'};

  const rng = sh.getDataRange();
  const nilai = rng.getValues();
  if (nilai.length < 2) return {ok:true, diperiksa:0, diperbaiki:0, rincian:{}};

  const header = nilai[0].map(function(h){ return norm(h); });
  let iKategori = header.indexOf('Kategori');
  const iNamaBarang = header.indexOf('Nama Barang');
  const iPemilik = header.indexOf('Pemilik');
  const iMasuk = header.indexOf('Masuk Pemilik');

  // Kalau header-nya sendiri belum punya kolom Kategori, posisinya mengikuti
  // urutan yang dipakai kode saat menulis (setelah Nominal).
  if (iKategori === -1) {
    if (iNamaBarang === -1) return {ok:false, error:'Struktur sheet tidak dikenali (kolom "Nama Barang" tidak ada).'};
    iKategori = iNamaBarang - 1;
    sh.getRange(1, iKategori + 1).setValue('Kategori');
  }

  const rincian = {};
  let diperbaiki = 0;
  // Tulis ulang sekaligus per kolom (jauh lebih cepat daripada per baris)
  const kolomBaru = [];
  for (let i = 1; i < nilai.length; i++) {
    const lama = norm(nilai[i][iKategori]);
    if (lama) { kolomBaru.push([nilai[i][iKategori]]); continue; }
    const tebakan = tebakKategoriTransaksi(
      iNamaBarang > -1 ? nilai[i][iNamaBarang] : '',
      iPemilik > -1 ? nilai[i][iPemilik] : '',
      iMasuk > -1 ? nilai[i][iMasuk] : 0
    );
    if (tebakan) {
      kolomBaru.push([tebakan]);
      rincian[tebakan] = (rincian[tebakan] || 0) + 1;
      diperbaiki++;
    } else {
      kolomBaru.push(['']);
    }
  }
  if (kolomBaru.length) {
    sh.getRange(2, iKategori + 1, kolomBaru.length, 1).setValues(kolomBaru);
  }
  return {ok:true, diperiksa: nilai.length - 1, diperbaiki: diperbaiki, rincian: rincian};
}

// Hitung berapa baris yang kategorinya masih kosong (untuk ditampilkan ke Admin
// sebelum dia memutuskan menjalankan perbaikan).
function apiCekKategoriKosong(p) {
  try {
    const sh = getAktifKantinSS().getSheetByName(SHEET_TRANSAKSI_KANTIN);
    if (!sh) return {ok:true, total:0, kosong:0};
    const nilai = sh.getDataRange().getValues();
    if (nilai.length < 2) return {ok:true, total:0, kosong:0};
    const header = nilai[0].map(function(h){ return norm(h); });
    const iKategori = header.indexOf('Kategori');
    if (iKategori === -1) return {ok:true, total: nilai.length-1, kosong: nilai.length-1, tanpaKolom:true};
    let kosong = 0;
    for (let i = 1; i < nilai.length; i++) if (!norm(nilai[i][iKategori])) kosong++;
    return {ok:true, total: nilai.length-1, kosong: kosong};
  } catch (e) {
    return {ok:false, error: e.message};
  }
}


// Verifikasi PIN login seorang pengguna (dipakai untuk mengunci menu sensitif
// seperti "Barang Jualan Saya" dan "Tarik Saldo" di dashboard Pemilik Barang).
//
// Kenapa perlu: HP kasir sering dipinjamkan ke santri untuk mengecek saldo/akunnya.
// Tanpa kunci, santri bisa membuka menu Barang Jualan dan mengubah harga produk,
// atau mengajukan penarikan saldo pemilik.
function apiValidasiPinPengguna(p) {
  const nama = norm(p.nama), pin = norm(p.pin);
  if (!nama || !pin) return {ok:false, error:'Nama dan PIN wajib diisi.'};
  try {
    const sh = getAktifSS().getSheetByName(SHEET_ROLE);
    if (!sh) return {ok:false, error:'Data pengguna tidak ditemukan.'};
    const rows = sh.getDataRange().getValues(); rows.shift();
    const baris = rows.find(function(r){ return normNama(norm(r[0])) === normNama(nama); });
    if (!baris) return {ok:false, error:'Akun tidak ditemukan.'};
    if (norm(baris[2]) !== pin) return {ok:false, error:'PIN salah.'};
    return {ok:true};
  } catch (e) {
    return {ok:false, error:'Gagal memeriksa PIN: ' + e.message};
  }
}


// ============================================================
// LAPORAN WALI SANTRI - KEHADIRAN, HAFALAN, SPP (BAGIAN BARU)
// ============================================================

// Kehadiran harian satu santri berdasarkan AbsensiHarian saja.
// Untuk wali: ini sumber paling jujur karena dicatat oleh Pembina, bukan guru mapel.
function apiGetKehadiranHarianSantri(p) {
  const nisn = norm(p.nisn);
  const tglMulai = norm(p.tglMulai);
  const tglAkhir = norm(p.tglAkhir);
  if (!nisn) return {ok:false, error:'NISN wajib diisi.'};

  const ss = getAktifSS();
  const sh = ss.getSheetByName(SHEET_ABSENSI_HARIAN);
  if (!sh || sh.getLastRow() <= 1) return {ok:true, rekap:{hadir:0,sakit:0,izin:0,alpa:0,total:0}, detailHari:[]};

  const tz = Session.getScriptTimeZone();
  const rows = nilaiCatatanUnik_(sh); rows.shift();

  const detail = [];
  let hadir=0, sakit=0, izin=0, alpa=0;

  rows.forEach(function(r){
    if (norm(r[2]) !== nisn) return;
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
    if (tglMulai && tgl < tglMulai) return;
    if (tglAkhir && tgl > tglAkhir) return;
    const status = norm(r[5]);
    if (status === 'Hadir') hadir++;
    else if (status === 'Sakit') sakit++;
    else if (status === 'Izin' || status === 'Izin Pulang') izin++;
    else alpa++;
    detail.push({tanggal:tgl, status:status, catatan:norm(r[6]||'')});
  });

  detail.sort(function(a,b){ return b.tanggal.localeCompare(a.tanggal); });
  const total = hadir+sakit+izin+alpa;

  return {ok:true,
    rekap: {hadir:hadir, sakit:sakit, izin:izin, alpa:alpa, total:total,
            persen: total ? Math.round(hadir*100/total) : 0},
    detailHari: detail
  };
}

// Ketidakhadiran di mapel atau halaqoh yang TIDAK tercatat sakit/izin di absensi harian.
// Ini yang menjadi "laporan ke wali" -- perbedaan antara absensi harian dan absensi mapel/halaqoh.
function apiGetKetidakhadiranMapel(p) {
  const nisn = norm(p.nisn);
  const tglMulai = norm(p.tglMulai);
  const tglAkhir = norm(p.tglAkhir);
  if (!nisn) return {ok:false, error:'NISN wajib diisi.'};

  const ss = getAktifSS();
  const tz = Session.getScriptTimeZone();

  // Baca status harian -- kalau hari itu sakit/izin, ketidakhadiran di mapel wajar.
  const shH = ss.getSheetByName(SHEET_ABSENSI_HARIAN);
  const statusHarian = {};
  if (shH && shH.getLastRow() > 1) {
    const rows = nilaiCatatanUnik_(shH); rows.shift();
    rows.forEach(function(r){
      if (norm(r[2]) !== nisn) return;
      const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
      statusHarian[tgl] = norm(r[5]);
    });
  }

  const laporan = [];

  // Cek absensi mapel - kolom: r[0]=tanggal, r[1]=waktu, r[2]=halaqoh/kelas,
  // r[3]=mapel, r[4]=kelas, r[5]=pengampu, r[6]=NISN, r[7]=nama, r[8]=status
  const shMapel = ss.getSheetByName(SHEET_ABSENSI);
  if (shMapel && shMapel.getLastRow() > 1) {
    const rows = nilaiCatatanUnik_(shMapel); rows.shift();
    rows.forEach(function(r){
      if (norm(r[6]) !== nisn) return;
      const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
      if (tglMulai && tgl < tglMulai) return;
      if (tglAkhir && tgl > tglAkhir) return;
      const status = norm(r[8]);
      if (status === 'Hadir') return;
      const statusHari = statusHarian[tgl] || '';
      if (statusHari === 'Sakit' || statusHari === 'Izin' || statusHari === 'Izin Pulang') return;
      laporan.push({tanggal:tgl, jenis:'Mapel', nama:norm(r[3]), status:status, catatan:norm(r[9]||'')});
    });
  }

  // Cek absensi halaqoh (dari sheet Hafalan)
  // Header: Tanggal(0),Waktu(1),Halaqoh(2),Pengampu(3),NISN(4),Nama(5),Jenis(6),Surah(7),Ayat(8),Juz(9),Halaman(10),Nilai(11)
  const TIDAK_HADIR_HALAQOH = ['Ghaib','Sakit','Izin'];
  const shHalaqoh = ss.getSheetByName(SHEET_HAFALAN);
  if (shHalaqoh && shHalaqoh.getLastRow() > 1) {
    const rows = nilaiCatatanUnik_(shHalaqoh); rows.shift();
    rows.forEach(function(r){
      if (norm(r[4]) !== nisn) return;
      const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
      if (tglMulai && tgl < tglMulai) return;
      if (tglAkhir && tgl > tglAkhir) return;
      const jenis = norm(r[6]);
      if (TIDAK_HADIR_HALAQOH.indexOf(jenis) === -1) return;
      const statusHari = statusHarian[tgl] || '';
      if (statusHari === 'Sakit' || statusHari === 'Izin' || statusHari === 'Izin Pulang') return;
      laporan.push({tanggal:tgl, jenis:'Halaqoh', nama:norm(r[2]), status:jenis, catatan:''});
    });
  }

  laporan.sort(function(a,b){ return b.tanggal.localeCompare(a.tanggal); });
  return {ok:true, laporan:laporan, jumlah:laporan.length};
}

// Riwayat hafalan sebulan untuk unduh PDF di sisi klien.
// Backend hanya mengirim data -- PDF dibuat di browser supaya tidak membebani server.
function apiGetRiwayatHafalanBulan(p) {
  const nisn = norm(p.nisn);
  const bulan = Number(p.bulan) || new Date().getMonth()+1;
  const tahun = Number(p.tahun) || new Date().getFullYear();
  if (!nisn) return {ok:false, error:'NISN wajib diisi.'};

  const ss = getAktifSS();
  const tz = Session.getScriptTimeZone();
  const sh = ss.getSheetByName(SHEET_HAFALAN);
  if (!sh || sh.getLastRow() <= 1) return {ok:true, data:[], namaSantri:''};

  const rows = nilaiCatatanUnik_(sh); rows.shift();
  const data = [];
  let namaSantri = '';

  rows.forEach(function(r){
    if (norm(r[4]) !== nisn) return;  // r[4] = NISN
    const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
    const d = new Date(tgl);
    if (d.getMonth()+1 !== bulan || d.getFullYear() !== tahun) return;
    if (!namaSantri) namaSantri = norm(r[5]);  // r[5] = Nama Santri
    data.push({
      tanggal: tgl, waktu: formatWaktu(r[1],tz),
      halaqoh: norm(r[2]), jenis: norm(r[6]),   // r[2]=Halaqoh, r[6]=Jenis
      surah: norm(r[7]), ayat: norm(r[8]),       // r[7]=Surah, r[8]=Ayat
      juz: norm(r[9]), halaman: norm(r[10]),     // r[9]=Juz, r[10]=Halaman
      nilai: norm(r[11]||''), pengampu: norm(r[3]||'')  // r[11]=Nilai, r[3]=Pengampu
    });
  });

  data.sort(function(a,b){ return a.tanggal.localeCompare(b.tanggal); });
  return {ok:true, data:data, namaSantri:namaSantri, bulan:bulan, tahun:tahun};
}


// ============================================================
// DIAGNOSTIK UKURAN DATA (murni informasi, tidak mengubah apa pun)
//
// Menampilkan jumlah baris tiap sheet penting, supaya Admin/Mudir bisa memantau
// pertumbuhan data dari waktu ke waktu -- terutama sheet yang SENGAJA dibiarkan
// tumbuh lintas semester (SPP, RiwayatTasmi, SaldoPemilik) dan sheet semester
// berjalan (untuk mendeteksi kejanggalan, misal baris menumpuk tidak wajar
// akibat bug, jauh sebelum itu terasa sebagai aplikasi melambat).
//
// SANGAT PENTING soal keamanan: fungsi ini HANYA memanggil getLastRow(), tidak
// pernah getDataRange().getValues() -- artinya tidak pernah membaca isi selnya
// sama sekali, apalagi menulis. Sifatnya murni membaca metadata ukuran sheet,
// jadi mustahil fungsi ini mengubah atau merusak data apa pun.
function apiGetDiagnostikUkuranData(p) {
  if (!adminAtauMudir(p.oleh)) {
    return {ok:false, error:'Hanya Admin/Mudir yang boleh melihat diagnostik ini.'};
  }

  // Baris = jumlah baris berisi data (getLastRow() - 1 baris header), 0 kalau sheet
  // kosong/tidak ada. Dibungkus try/catch per sheet supaya satu sheet yang gagal
  // dibaca (misal terhapus manual) tidak menggagalkan seluruh laporan.
  function baris(ss, namaSheet) {
    try {
      const sh = ss.getSheetByName(namaSheet);
      if (!sh) return null; // sheet tidak ditemukan -- ditampilkan beda dari 0
      return Math.max(0, sh.getLastRow() - 1);
    } catch (e) { return null; }
  }

  const hasil = [];

  try {
    const ssAktif = getAktifSS();
    hasil.push({kelompok:'Semester Berjalan (Absensi)', catatan:'Kosong lagi tiap ganti semester', baris:[
      {sheet:'Absensi (mapel)', jumlah: baris(ssAktif, SHEET_ABSENSI)},
      {sheet:'Hafalan', jumlah: baris(ssAktif, SHEET_HAFALAN)},
      {sheet:'Nilai', jumlah: baris(ssAktif, SHEET_NILAI)},
      {sheet:'JurnalMengajar', jumlah: baris(ssAktif, SHEET_JURNAL_MENGAJAR)},
      {sheet:'KasKelas', jumlah: baris(ssAktif, SHEET_KAS_KELAS)},
    ]});
    hasil.push({kelompok:'Data Master (Semester Berjalan)', catatan:'Dibatasi jumlah orang, bukan jumlah kejadian', baris:[
      {sheet:'Santri', jumlah: baris(ssAktif, SHEET_SANTRI)},
      {sheet:'Guru', jumlah: baris(ssAktif, SHEET_GURU)},
      {sheet:'RoleAkses', jumlah: baris(ssAktif, SHEET_ROLE)},
    ]});
    hasil.push({kelompok:"Lintas Semester (sengaja tidak direset)", catatan:'Rekam jejak jangka panjang -- dipantau, bukan dikhawatirkan', baris:[
      {sheet:"RiwayatTasmi'", jumlah: baris(ssAktif, SHEET_RIWAYAT_TASMI)},
    ]});
  } catch (e) { hasil.push({kelompok:'Absensi (aktif)', error: e.message}); }

  try {
    const ssKantin = getAktifKantinSS();
    hasil.push({kelompok:'Semester Berjalan (Kantin)', catatan:'Kosong lagi tiap ganti semester', baris:[
      {sheet:'TransaksiKantin', jumlah: baris(ssKantin, SHEET_TRANSAKSI_KANTIN)},
      {sheet:'RiwayatSaldoPemilik', jumlah: baris(ssKantin, SHEET_RIWAYAT_SALDO_PEMILIK)},
      {sheet:'PengajuanTopUpSaldo', jumlah: baris(ssKantin, SHEET_PENGAJUAN_TOPUP)},
      {sheet:'PengajuanPenarikanSaldo', jumlah: baris(ssKantin, SHEET_PENGAJUAN_TARIK)},
    ]});
    hasil.push({kelompok:'Lintas Semester (Kantin)', catatan:'Dibatasi jumlah barang/pemilik, bukan jumlah transaksi', baris:[
      {sheet:'Barang', jumlah: baris(ssKantin, SHEET_BARANG)},
      {sheet:'SaldoPemilik', jumlah: baris(ssKantin, SHEET_SALDO_PEMILIK)},
    ]});
  } catch (e) { hasil.push({kelompok:'Kantin (aktif)', error: e.message}); }

  try {
    const ssSpp = getAktifSppSS();
    hasil.push({kelompok:'Lintas Tahun (SPP)', catatan:'Satu baris per santri (bukan per transaksi) -- tumbuh sangat lambat', baris:[
      {sheet:'SPP', jumlah: baris(ssSpp, SHEET_SPP)},
    ]});
  } catch (e) { hasil.push({kelompok:'SPP (aktif)', error: e.message}); }

  return {ok:true, kelompok:hasil, dicekPada: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')};
}


// ============================================================
// INFO LAYAR MASJID (untuk display Jam Sholat di masjid putra/putri)
//
// Endpoint publik, murni baca, TANPA login -- dipanggil langsung oleh halaman
// jam-sholat/index.html yang berjalan sebagai aplikasi terpisah. Sengaja hanya
// mengembalikan data agregat yang aman ditampilkan di layar publik masjid:
// jumlah santri, papan setoran hafalan terbanyak (pengakuan positif -- lazim
// ditampilkan di pesantren, seperti papan prestasi), dan JUMLAH pelanggaran
// (bukan nama).
//
// Keputusan yang sengaja diambil, bukan kelalaian:
// - Nama santri yang melakukan PELANGGARAN TIDAK PERNAH dikirim endpoint ini.
//   Layar ini dilihat semua jamaah -- termasuk santri lain dan orang tua santri
//   lain. Menampilkan nama pelaku pelanggaran di layar publik berisiko menjadi
//   bentuk mempermalukan di depan umum, yang bisa melukai martabat dan kondisi
//   psikologis santri (apalagi mereka masih di bawah umur). Hanya JUMLAHNYA
//   yang dikirim -- cukup untuk informasi/evaluasi tanpa menyasar individu.
// - Nama untuk papan setoran terbanyak AMAN ditampilkan karena sifatnya
//   pengakuan atas pencapaian (positif), bukan penyingkapan kesalahan --
//   setara papan prestasi yang memang lazim dipasang fisik di banyak pesantren.
function apiGetInfoLayarMasjid(p) {
  const genderFilter = norm(p.gender); // 'Laki-laki' | 'Perempuan' | '' (kosong = semua)
  const tz = Session.getScriptTimeZone();
  const todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const ss = getAktifSS();

  // Peta NISN -> gender, dipakai untuk memfilter hafalan/pelanggaran per gender
  // tanpa perlu mengulang pembacaan sheet Santri.
  let jumlahSantri = 0;
  const genderMap = {};
  try {
    const shSantri = ss.getSheetByName(SHEET_SANTRI);
    const rows = nilaiCatatanUnik_(shSantri);
    const header = rows[0];
    const iGender = header.indexOf('Jenis Kelamin');
    for (let i=1;i<rows.length;i++){
      const nisn = norm(rows[i][0]);
      if (!nisn) continue;
      const g = iGender!==-1 ? norm(rows[i][iGender]) : '';
      genderMap[nisn] = g;
      if (!genderFilter || g === genderFilter) jumlahSantri++;
    }
  } catch(e) { Logger.log('apiGetInfoLayarMasjid - santri: ' + e.message); }

  // Papan setoran hafalan terbanyak HARI INI (top 3), hanya jenis setoran nyata
  // (Sabaq/Sabqi/Manzil/Murojaah/Tahsin) -- Ghaib/Sakit/Izin tidak dihitung
  // karena bukan bentuk setoran. Tasmi' SENGAJA dikecualikan dari papan ini (atas
  // permintaan pondok), walau di tempat lain tetap dihitung setoran sah & hadir.
  const JENIS_PAPAN_SETORAN = JENIS_HAFALAN_SETOR.filter(function(j){ return j !== "Tasmi'"; });
  let topSetoran = [];
  try {
    const shH = ss.getSheetByName(SHEET_HAFALAN);
    if (shH && shH.getLastRow() > 1) {
      const rows = nilaiCatatanUnik_(shH); rows.shift();
      const hitung = {};
      rows.forEach(function(r){
        const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
        if (tgl !== todayStr) return;
        if (JENIS_PAPAN_SETORAN.indexOf(norm(r[6])) === -1) return;
        const nisn = norm(r[4]);
        if (!nisn) return;
        if (genderFilter && genderMap[nisn] !== genderFilter) return;
        if (!hitung[nisn]) hitung[nisn] = {nama: norm(r[5]), jumlah: 0};
        hitung[nisn].jumlah++;
      });
      topSetoran = Object.keys(hitung).map(function(k){ return hitung[k]; })
        .sort(function(a,b){ return b.jumlah - a.jumlah; }).slice(0, 3);
    }
  } catch(e) { Logger.log('apiGetInfoLayarMasjid - hafalan: ' + e.message); }

  // Jumlah pelanggaran & prestasi HARI INI -- keduanya cuma angka (lihat catatan
  // di atas soal kenapa nama pelanggaran tidak pernah dikirim).
  let jumlahPelanggaran = 0, jumlahPrestasi = 0;
  try {
    const shPel = getPelanggaranAktifSS().getSheetByName(SHEET_PENCATATAN_PEL);
    if (shPel && shPel.getLastRow() > 1) {
      const rows = nilaiCatatanUnik_(shPel); rows.shift();
      rows.forEach(function(r){
        const tgl = r[0] instanceof Date ? Utilities.formatDate(r[0],tz,'yyyy-MM-dd') : norm(r[0]);
        if (tgl !== todayStr) return;
        const nisn = norm(r[1]);
        if (genderFilter && nisn && genderMap[nisn] !== genderFilter) return;
        const pel = norm(r[3]); if (pel && pel !== '-') jumlahPelanggaran++;
        const pres = norm(r[5]); if (pres && pres !== '-') jumlahPrestasi++;
      });
    }
  } catch(e) { Logger.log('apiGetInfoLayarMasjid - pelanggaran: ' + e.message); }

  return {
    ok: true,
    tanggal: todayStr,
    jumlahSantri: jumlahSantri,
    topSetoran: topSetoran,
    jumlahPelanggaran: jumlahPelanggaran,
    jumlahPrestasi: jumlahPrestasi
  };
}


// ============================================================
// LOGIN IMAM UNTUK LAYAR JAM SHOLAT MASJID
//
// Dipanggil dari halaman jam-sholat/index.html (aplikasi terpisah) supaya imam bisa
// melapor berhalangan langsung dari layar masjid atau HP-nya, memakai akun RoleAkses
// yang sama dengan WASIAT -- tidak perlu lagi link khusus atau penanda di localStorage
// yang mudah hilang saat cache dibersihkan atau ganti perangkat.
//
// Cakupan sengaja dibuat SESEMPIT mungkin:
// - Hanya memverifikasi nama/no-WA + PIN, lalu mengecek apakah akun itu ber-peran Imam
//   (atau Admin/Mudir, yang wajar boleh melapor atas nama imam saat berhalangan).
// - Yang dikembalikan HANYA {ok, nama, boleh} -- tidak ada PIN, tidak ada daftar peran
//   lengkap, tidak ada data santri/keuangan apa pun. Jadi walau layar masjid diakses
//   orang lain, tidak ada data sensitif yang bisa ditarik lewat endpoint ini.
// - TIDAK memberi sesi/token apa pun ke WASIAT. Login di sini sama sekali tidak
//   membuka akses ke dashboard WASIAT.
function apiLoginImamMasjid(p) {
  const loginId = norm(p.loginId), pin = norm(p.pin);
  if (!loginId || !pin) return {ok:false, error:'Nama/No WA dan PIN wajib diisi.'};
  try {
    const sh = getAktifSS().getSheetByName(SHEET_ROLE);
    if (!sh) return {ok:false, error:'Data akun tidak ditemukan.'};
    const rows = sh.getDataRange().getValues(); rows.shift();
    const found = rows.find(function(r){
      return (norm(r[0]) === loginId || norm(r[1]) === loginId) && norm(r[2]) === pin;
    });
    if (!found) return {ok:false, error:'Nama/No WA atau PIN salah.'};

    const level = norm(found[3]);
    const boleh = level.indexOf('Imam') !== -1 || level.indexOf('Admin') !== -1 || level.indexOf('Mudir') !== -1;
    if (!boleh) {
      return {ok:false, error:'Akun ini tidak punya akses Imam. Minta Admin menambahkan peran "Imam Masjid" di RoleAkses.'};
    }
    return {ok:true, nama: norm(found[0])};
  } catch (e) {
    return {ok:false, error:'Gagal memeriksa akun: ' + e.message};
  }
}


// ============================================================
// TARIK SALDO PEMILIK BARANG SECARA MANUAL (Bendahara/Mudir)
//
// Untuk kasus pemilik barang menerima uangnya langsung/tunai tanpa lewat alur
// pengajuan. Bendahara/Mudir mencatatnya di sini supaya saldo di sistem tetap
// cocok dengan uang fisik yang sudah diserahkan.
//
// Pengaman yang dipakai sama persis dengan alur persetujuan pengajuan
// (apiSetujuiPenarikan), karena ini menyentuh uang sungguhan:
// - LockService supaya dua petugas yang memproses bersamaan tidak saling menimpa saldo
// - Saldo dibaca ULANG di dalam lock, bukan dipercaya dari kiriman aplikasi
// - Penarikan melebihi saldo ditolak
// - Selalu dicatat di RiwayatSaldoPemilik supaya jejaknya bisa diaudit
// - WA pemberitahuan dikirim ke pemilik kalau nomornya ada
function apiTarikSaldoPemilikManual(p) {
  const pemilik = norm(p.pemilik);
  const nominal = Number(p.nominal) || 0;
  const keterangan = norm(p.keterangan) || 'Penarikan manual';
  const oleh = norm(p.oleh);

  if (!pemilik) return {ok:false, error:'Pemilik barang wajib dipilih.'};
  if (nominal <= 0) return {ok:false, error:'Nominal harus lebih dari 0.'};
  if (!oleh) return {ok:false, error:'Nama petugas tidak diketahui.'};

  // Hanya Bendahara/Admin/Mudir yang boleh mencatat penarikan manual -- diverifikasi
  // di server, bukan sekadar disembunyikan menunya di aplikasi.
  let bolehProses = false;
  try {
    const shRole = getAktifSS().getSheetByName(SHEET_ROLE);
    const rowsRole = shRole.getDataRange().getValues(); rowsRole.shift();
    const akun = rowsRole.find(function(r){ return normNama(norm(r[0])) === normNama(oleh); });
    if (akun) {
      const lvl = norm(akun[3]);
      bolehProses = lvl.indexOf('Bendahara') !== -1 || lvl.indexOf('Admin') !== -1 || lvl.indexOf('Mudir') !== -1;
    }
  } catch (e) { /* gagal baca role -> tetap ditolak di bawah */ }
  if (!bolehProses) return {ok:false, error:'Hanya Bendahara, Admin, atau Mudir yang boleh mencatat penarikan manual.'};

  const lock = kunciTransaksi_();
  try { lock.waitLock(30000); } catch(e) { return {ok:false, error:'Server sedang memproses transaksi lain. Data BELUM tersimpan -- silakan tekan tombolnya sekali lagi.'}; }
  try {
    const ss = getAktifKantinSS();
    const shSaldo = ss.getSheetByName(SHEET_SALDO_PEMILIK);
    if (!shSaldo) return {ok:false, error:'Sheet SaldoPemilik tidak ditemukan.'};
    const spRows = shSaldo.getDataRange().getValues();

    let foundRow = -1, saldoSebelum = 0, noWa = '';
    for (let i=1;i<spRows.length;i++) {
      if (norm(spRows[i][0]) === pemilik) {
        foundRow = i+1;
        saldoSebelum = Number(spRows[i][2]) || 0;
        noWa = norm(spRows[i][1]);
        break;
      }
    }
    if (foundRow === -1) return {ok:false, error:'Data saldo untuk "'+pemilik+'" tidak ditemukan.'};
    if (nominal > saldoSebelum) {
      return {ok:false, error:'Saldo tidak mencukupi. Saldo '+pemilik+' saat ini Rp'+saldoSebelum.toLocaleString('id-ID')+', diminta Rp'+nominal.toLocaleString('id-ID')+'.'};
    }

    const saldoSekarang = saldoSebelum - nominal;
    shSaldo.getRange(foundRow, 3).setValue(saldoSekarang);

    const tz = Session.getScriptTimeZone();
    const shRiwayat = ss.getSheetByName(SHEET_RIWAYAT_SALDO_PEMILIK);
    if (shRiwayat) {
      shRiwayat.appendRow([
        Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'),
        Utilities.formatDate(new Date(), tz, 'HH:mm:ss'),
        pemilik, 'Penarikan', nominal, saldoSebelum, saldoSekarang,
        keterangan + ' (manual oleh ' + oleh + ')', 'Disetujui'
      ]);
    }

    if (noWa) {
      try {
        kirimWAKategori_('saldo_pemilik', noWa, 'Assalamualaikum Wr. Wb.\n\n*PENARIKAN SALDO DICATAT*\n\nHalo *'+pemilik+'*,\nPenarikan saldo sebesar Rp'+nominal.toLocaleString('id-ID')+' telah dicatat oleh '+oleh+'.\nKeterangan: '+keterangan+'\n\nSisa saldo: Rp'+saldoSekarang.toLocaleString('id-ID')+'\n\nBila ada yang tidak sesuai, segera hubungi Bendahara.\n\nWassalamualaikum Wr. Wb.');
      } catch(e) { Logger.log('WA penarikan manual gagal: ' + e.message); }
    }

    return {ok:true, pemilik:pemilik, nominal:nominal, saldoSebelum:saldoSebelum, saldoSekarang:saldoSekarang, waKirim: !!noWa};
  } finally {
    lock.releaseLock();
  }
}

// Daftar pemilik barang beserta saldonya -- untuk pemilih di form penarikan manual.
function apiGetDaftarSaldoPemilik() {
  try {
    const sh = getAktifKantinSS().getSheetByName(SHEET_SALDO_PEMILIK);
    if (!sh || sh.getLastRow() < 2) return {ok:true, data:[]};
    const rows = sh.getDataRange().getValues(); rows.shift();
    const data = rows.filter(function(r){ return norm(r[0]); }).map(function(r){
      return {pemilik: norm(r[0]), noWa: norm(r[1]), saldo: Number(r[2]) || 0};
    }).sort(function(a,b){ return b.saldo - a.saldo; });
    return {ok:true, data:data};
  } catch (e) {
    return {ok:false, error:'Gagal membaca saldo pemilik: ' + e.message};
  }
}


// ======================================================================
// KEHADIRAN MENGAJAR GURU, IZIN, DAN SURAT PERINGATAN (SP)
//
// Cara kerja singkat:
// 1. "Sesi wajib" = jadwal mapel (sheet MataPelajaran, per hari) + halaqoh (per waktu,
//    pada hari aktif halaqoh). Dihitung per tanggal, mulai dari tanggal aturan berlaku
//    sampai KEMARIN (hari ini belum dihitung karena belum selesai).
// 2. Sesi dianggap HADIR kalau ada catatan Absensi (mapel+kelas+tanggal) atau Hafalan
//    (halaqoh+waktu+tanggal). Dikecualikan: hari libur pondok, sesi yang ada guru
//    penggantinya, dan izin yang disetujui.
// 3. Sesi yang belum tercatat TIDAK langsung dianggap bolos: ada masa klarifikasi
//    (bawaan 3 hari) supaya guru bisa mengisi susulan (lupa mencatat) atau mengajukan
//    izin. Lewat dari itu tanpa klarifikasi -> "Tidak Masuk Tanpa Izin" (TMTI).
// 4. Jumlah TMTI per bulan menentukan jenjang: Teguran -> SP1 -> SP2 -> SP3. SP naik
//    berjenjang bila guru melanggar lagi selama SP sebelumnya masih berlaku.
// 5. SP dibuat sebagai DRAF otomatis; baru tampil di dashboard guru setelah Mudir/Admin
//    meninjau dan menerbitkannya. Teguran tampil otomatis (bukan surat resmi).
//
// Semua data aturan (izin, libur, SP) disimpan di spreadsheet MASTER supaya tetap ada
// saat ganti semester -- masa berlaku SP bisa melewati pergantian semester.
// ======================================================================
const SHEET_IZIN_GURU    = 'IzinGuru';
const SHEET_LIBUR_PONDOK = 'LiburPondok';
const SHEET_SURAT_SP     = 'SuratSP';

function sheetMasterAtur_(nama, header) {
  const ss = getMasterSS();
  let sh = ss.getSheetByName(nama);
  if (!sh) { sh = ss.insertSheet(nama); sh.appendRow(header); sh.setFrozenRows(1); }
  return sh;
}
function shIzinGuru_()    { return sheetMasterAtur_(SHEET_IZIN_GURU, ['ID','Tanggal','Guru','Alasan','Keterangan','BuktiURL','Status','DiprosesOleh','WaktuProses','CatatanProses','Diajukan']); }
function shLiburPondok_() { return sheetMasterAtur_(SHEET_LIBUR_PONDOK, ['Tanggal','Keterangan','Dicatat']); }
function shSuratSP_()     { return sheetMasterAtur_(SHEET_SURAT_SP, ['ID','NomorSurat','Guru','Level','Bulan','JumlahTMTI','Rincian','Status','Dibuat','DiterbitkanOleh','DiterbitkanPada','BerlakuSampai','DibacaPada','Catatan']); }

// Nilai tanggal dari sel bisa berupa objek Date (Sheets mengubahnya otomatis) atau teks.
function tglAtur_(v, tz) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : norm(v).slice(0,10); }
function waktuAtur_(v, tz) { return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm') : norm(v); }
function hariIniAtur_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function selisihHariAtur_(dari, sampai) {
  const a = dari.split('-').map(Number), b = sampai.split('-').map(Number);
  return Math.round((Date.UTC(b[0],b[1]-1,b[2]) - Date.UTC(a[0],a[1]-1,a[2])) / 86400000);
}
function tambahBulanAtur_(tgl, n) {
  const p = tgl.split('-').map(Number);
  const d = new Date(p[0], p[1]-1+n, p[2]);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function aturanKehadiranGuru_() {
  const p = getPengaturan();
  const angka = function(v, d){ const s = String(v==null?'':v).trim(); const n = Number(s); return (s !== '' && isFinite(n) && n >= 0) ? n : d; };
  const benar = function(v, d){ if (v === undefined || v === null || String(v).trim() === '') return d; return v === true || String(v).toLowerCase() === 'true'; };
  return {
    aktif: benar(p.SPAktif, false),
    mulai: norm(p.SPMulaiBerlaku).slice(0,10),
    teguran: angka(p.SPBatasTeguran, 1), sp1: angka(p.SPBatasSP1, 3), sp2: angka(p.SPBatasSP2, 5), sp3: angka(p.SPBatasSP3, 7),
    masaBerlakuBulan: angka(p.SPMasaBerlakuBulan, 3),
    batasKlarifikasi: angka(p.SPBatasKlarifikasi, 3),
    hitungHalaqoh: benar(p.SPHitungHalaqoh, true),
    hariHalaqoh: norm(p.SPHariHalaqoh) || "Senin,Selasa,Rabu,Kamis,Jum'at,Sabtu,Minggu",
    // Jadwal halaqoh per kelompok WAKTU + PUTRA/PUTRI (JSON). Kosong = semua halaqoh
    // memakai "hari halaqoh berjalan" di atas seperti sebelumnya.
    jadwalHalaqoh: (function(){ try { const j = JSON.parse(norm(p.SPJadwalHalaqoh) || '{}'); return (j && typeof j === 'object') ? j : {}; } catch (e) { return {}; } })(),
    kodeSurat: norm(p.SPKodeSurat) || 'PPWU',
    penandatangan: norm(p.SPPenandatangan), jabatan: norm(p.SPJabatan) || 'Mudir',
    kota: norm(p.SPKotaSurat) || 'Poso',
    // Notifikasi WhatsApp -- semuanya NONAKTIF secara bawaan. Sakelar utama + per jenis.
    waAktif: benar(p.SPWAAktif, false),
    waIzinBaru: benar(p.SPWAIzinBaru, false),         // ke Mudir/Admin saat guru mengajukan izin
    waIzinDiproses: benar(p.SPWAIzinDiproses, false), // ke guru saat izin disetujui/ditolak
    waSPTerbit: benar(p.SPWASPTerbit, false),         // ke guru saat SP diterbitkan
    // Izin "Sudah mengajar, lupa mencatat": bila disetujui, guru mendapat akses mengisi
    // absensi tanggal itu. Bisa dimatikan/dinyalakan Admin/Mudir kapan saja.
    lupaAktif: benar(p.SusulanLupaAktif, true),
    lupaBerlakuHari: angka(p.SusulanLupaBerlakuHari, 3)
  };
}

// Aturan benar-benar BERJALAN hanya bila sakelarnya aktif DAN tanggal mulainya sudah
// tiba. Jadi Admin bisa menjadwalkan jauh hari (mis. aktif mulai 1 Oktober): sebelum
// tanggal itu tidak ada widget di dashboard guru, tidak ada teguran, tidak ada draf SP.
function statusAturanKehadiran_(cfg) {
  if (!cfg.aktif) return {berjalan:false, status:'Nonaktif'};
  if (cfg.mulai && hariIniAtur_() < cfg.mulai) return {berjalan:false, status:'Terjadwal', mulai: cfg.mulai};
  return {berjalan:true, status:'Aktif', mulai: cfg.mulai};
}

// ---- Notifikasi WhatsApp (hanya bila diaktifkan di pengaturan) ----
function noWaAkunAtur_(nama) {
  try {
    const rows = getAktifSS().getSheetByName(SHEET_ROLE).getDataRange().getValues().slice(1);
    const r = rows.find(function(x){ return normNama(norm(x[0])) === normNama(nama); });
    if (r && norm(r[1])) return norm(r[1]);
    const g = getAktifSS().getSheetByName(SHEET_GURU).getDataRange().getValues().slice(1)
      .find(function(x){ return normNama(norm(x[0])) === normNama(nama); });
    return g ? norm(g[1]) : '';
  } catch (e) { return ''; }
}
function noWaAdminMudirAtur_() {
  try {
    const hasil = [];
    getAktifSS().getSheetByName(SHEET_ROLE).getDataRange().getValues().slice(1).forEach(function(r){
      const lvl = norm(r[3]), wa = norm(r[1]);
      if (wa && (lvl.indexOf('Mudir') !== -1 || lvl.indexOf('Admin') !== -1) && hasil.indexOf(wa) === -1) hasil.push(wa);
    });
    return hasil;
  } catch (e) { return []; }
}
// jenis: 'waIzinBaru' | 'waIzinDiproses' | 'waSPTerbit'. Tidak pernah melempar error --
// gagal kirim WA tidak boleh menggagalkan penyimpanan izin/SP.
function kirimWAKehadiranAtur_(jenis, target, pesan) {
  try {
    const cfg = aturanKehadiranGuru_();
    if (!cfg.waAktif || !cfg[jenis] || !target) return false;
    kirimWAKategori_('guru_kehadiran', target, pesan);
    return true;
  } catch (e) { Logger.log('WA kehadiran gagal: ' + e.message); return false; }
}

function getLiburListAtur_() {
  const tz = Session.getScriptTimeZone();
  const sh = shLiburPondok_();
  if (sh.getLastRow() < 2) return [];
  return sh.getDataRange().getValues().slice(1).map(function(r, i){
    return {rowIndex: i+2, tanggal: tglAtur_(r[0], tz), keterangan: norm(r[1])};
  }).filter(function(x){ return x.tanggal; });
}
function getIzinGuruListAtur_() {
  const tz = Session.getScriptTimeZone();
  const sh = shIzinGuru_();
  if (sh.getLastRow() < 2) return [];
  return sh.getDataRange().getValues().slice(1).map(function(r, i){
    return {rowIndex: i+2, id: norm(r[0]), tanggal: tglAtur_(r[1], tz), guru: norm(r[2]), alasan: norm(r[3]),
      keterangan: norm(r[4]), buktiUrl: norm(r[5]), status: norm(r[6]) || 'Menunggu',
      diprosesOleh: norm(r[7]), waktuProses: waktuAtur_(r[8], tz), catatanProses: norm(r[9]), diajukan: waktuAtur_(r[10], tz)};
  }).filter(function(x){ return x.id; });
}
function getSuratSPListAtur_() {
  const tz = Session.getScriptTimeZone();
  const sh = shSuratSP_();
  if (sh.getLastRow() < 2) return [];
  return sh.getDataRange().getValues().slice(1).map(function(r, i){
    let rincian = [];
    try { rincian = JSON.parse(norm(r[6]) || '[]'); } catch (e) {}
    return {rowIndex: i+2, id: norm(r[0]), nomor: norm(r[1]), guru: norm(r[2]), level: Number(r[3]) || 0,
      bulan: norm(r[4]), jumlahTMTI: Number(r[5]) || 0, rincian: rincian, status: norm(r[7]) || 'Draf',
      dibuat: waktuAtur_(r[8], tz), diterbitkanOleh: norm(r[9]), diterbitkanPada: tglAtur_(r[10], tz),
      berlakuSampai: tglAtur_(r[11], tz), dibacaPada: waktuAtur_(r[12], tz), catatan: norm(r[13])};
  }).filter(function(x){ return x.id; });
}

// Inti perhitungan: status setiap sesi wajib per guru dalam satu bulan.
// guruFilter (opsional) = hitung satu guru saja.
// ---- Jadwal halaqoh per kelompok (waktu + putra/putri) ----
// Status sebuah halaqoh pada suatu hari:
//   'wajib'    -> dihitung; tidak diisi = belum tercatat / tanpa izin
//   'opsional' -> "tidak rutin": bila diisi dihitung Hadir, bila tidak diisi TIDAK dihitung
//                 (mis. halaqoh Subuh putra hari Sabtu yang kadang ada kadang tidak)
//   'tidak'    -> tidak ada halaqoh, tidak dihitung sama sekali
function kelompokGenderHalaqoh_(g) {
  const x = normNama(g);
  if (/^(l|lk|laki|lakilaki|putra|ikhwan|pria|banin)$/.test(x.replace(/\s/g,''))) return 'putra';
  if (/^(p|pr|perempuan|putri|akhwat|wanita|banat)$/.test(x.replace(/\s/g,''))) return 'putri';
  return 'umum';
}
function kelompokWaktuHalaqoh_(w) { return normNama(w).replace(/\s/g,'').replace(/^dhuha$/, 'duha'); }
function kunciKelompokHalaqoh_(waktu, gender) { return kelompokWaktuHalaqoh_(waktu) + '|' + kelompokGenderHalaqoh_(gender); }
function statusJadwalHalaqoh_(cfg, halaqoh, namaHari) {
  const jadwal = cfg.jadwalHalaqoh || {};
  const atur = jadwal[kunciKelompokHalaqoh_(halaqoh.waktu, halaqoh.gender)];
  if (atur && typeof atur === 'object') {
    const nh = normNama(namaHari);
    let st = 'tidak';
    Object.keys(atur).forEach(function(h){ if (normNama(h) === nh) st = String(atur[h]); });
    return (st === 'wajib' || st === 'opsional') ? st : 'tidak';
  }
  // Kelompok yang belum diatur: aturan lama (hari halaqoh berjalan untuk semua)
  const ada = String(cfg.hariHalaqoh || '').split(',').some(function(h){ return norm(h) && normNama(h) === normNama(namaHari); });
  return ada ? 'wajib' : 'tidak';
}

function hitungKehadiranGuruAtur_(bulan, tahun, guruFilter, opsiHitung) {
  opsiHitung = opsiHitung || {};
  bulan = Number(bulan); tahun = Number(tahun);
  const cfg = aturanKehadiranGuru_();
  const tz = Session.getScriptTimeZone();
  const hariIni = hariIniAtur_();
  const ss = getAktifSS();

  const tanggalList = [];
  const jmlHari = new Date(tahun, bulan, 0).getDate();
  for (let d = 1; d <= jmlHari; d++) {
    const t = tahun + '-' + String(bulan).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    if (t >= hariIni) break;                    // hari ini & masa depan belum dihitung
    if (cfg.mulai && t < cfg.mulai && !opsiHitung.abaikanMulai) continue;   // sebelum aturan berlaku tidak dihitung
    tanggalList.push(t);
  }
  const setTgl = {}; tanggalList.forEach(function(t){ setTgl[t] = true; });

  const libur = {};
  getLiburListAtur_().forEach(function(l){ libur[l.tanggal] = l.keterangan || 'Libur pondok'; });

  const izin = {};
  getIzinGuruListAtur_().forEach(function(z){
    const k = normNamaGuru_(z.guru) + '|' + z.tanggal;
    if (z.status === 'Disetujui') izin[k] = z;
    else if (z.status === 'Menunggu' && !(izin[k] && izin[k].status === 'Disetujui')) izin[k] = z;
  });

  const pengganti = {};
  try {
    getDaftarPenggantian().forEach(function(x){
      if (!setTgl[x.tanggal]) return;
      if (x.jenisSesi === 'Halaqoh') pengganti['H|'+x.tanggal+'|'+normNama(x.halaqoh)+'|'+normNama(x.waktu)] = x.guruPengganti;
      else pengganti['M|'+x.tanggal+'|'+normNama(x.mapel)+'|'+normNama(x.kelas)] = x.guruPengganti;
    });
  } catch (e) {}

  const hadir = {};
  const pengisiHalaqoh = {}; // kunci sesi halaqoh -> nama guru yang mengisi
  const shA = ss.getSheetByName(SHEET_ABSENSI);
  if (shA && shA.getLastRow() > 1) {
    nilaiCatatanUnik_(shA).slice(1).forEach(function(r){
      const t = tglAtur_(r[0], tz); if (!setTgl[t]) return;
      hadir['M|'+t+'|'+normNama(r[3])+'|'+normNama(r[4])] = true;
    });
  }
  if (cfg.hitungHalaqoh) {
    const shH = ss.getSheetByName(SHEET_HAFALAN);
    if (shH && shH.getLastRow() > 1) {
      nilaiCatatanUnik_(shH).slice(1).forEach(function(r){
        const t = tglAtur_(r[0], tz); if (!setTgl[t]) return;
        const k = 'H|'+t+'|'+normNama(r[2])+'|'+normNama(r[1]);
        hadir[k] = true;
        if (!pengisiHalaqoh[k] && norm(r[3])) pengisiHalaqoh[k] = norm(r[3]);
      });
    }
  }

  // Jadwal mapel: satu sesi per (mapel, kelas, hari, guru) -- beberapa jam ke- di hari
  // yang sama dihitung satu sesi, sama seperti satu kali pengisian absensi.
  const jadwalMapel = [];
  const shM = ss.getSheetByName(SHEET_MAPEL);
  if (shM && shM.getLastRow() > 1) {
    const kumpul = {};
    nilaiCatatanUnik_(shM).slice(1).forEach(function(r){
      const mapel = norm(r[0]), kelas = norm(r[1]), guru = norm(r[2]), hari = norm(r[3]);
      if (!mapel || !kelas || !guru || !hari) return; // jadwal tanpa hari tidak bisa dinilai
      const k = normNama(mapel)+'|'+normNama(kelas)+'|'+normNama(hari)+'|'+normNamaGuru_(guru);
      const jamBaris = pecahJamKe_(r[4]);
      if (kumpul[k]) { jamBaris.forEach(function(jk){ if (kumpul[k].jamKe.indexOf(jk) === -1) kumpul[k].jamKe.push(jk); }); return; }
      kumpul[k] = {mapel: mapel, kelas: kelas, guru: guru, hari: hari, jamKe: jamBaris.length ? jamBaris : [r[4]]};
      jadwalMapel.push(kumpul[k]);
    });
  }
  const halaqohList = cfg.hitungHalaqoh ? getHalaqohList() : [];

  const perGuru = {};
  function catat(guru, sesi) {
    const k = normNamaGuru_(guru);
    if (guruFilter && k !== normNamaGuru_(guruFilter)) return;
    if (!perGuru[k]) perGuru[k] = {guru: guru, sesi: []};
    perGuru[k].sesi.push(sesi);
  }

  tanggalList.forEach(function(t){
    const p = t.split('-').map(Number);
    const namaHari = HARI_LIST[new Date(p[0], p[1]-1, p[2]).getDay()];
    const nh = normNama(namaHari);
    const umur = selisihHariAtur_(t, hariIni);
    function statusSesi(key, guru) {
      if (libur[t]) return {status:'Libur', ket: libur[t]};
      if (hadir[key]) return {status:'Hadir'};
      if (pengganti[key]) return {status:'Digantikan', ket: 'oleh ' + pengganti[key]};
      const iz = izin[normNamaGuru_(guru) + '|' + t];
      if (iz && iz.status === 'Disetujui') return {status:'Izin', ket: iz.alasan};
      if (iz && iz.status === 'Menunggu') return {status:'MenungguIzin', ket: iz.alasan};
      if (umur <= cfg.batasKlarifikasi) return {status:'BelumTercatat', sisaHari: cfg.batasKlarifikasi - umur + 1};
      return {status:'TMTI'};
    }
    jadwalMapel.forEach(function(j){
      if (normNama(j.hari) !== nh) return;
      const key = 'M|'+t+'|'+normNama(j.mapel)+'|'+normNama(j.kelas);
      catat(j.guru, Object.assign({tanggal:t, hari:namaHari, jenis:'Mapel', nama: j.mapel+' - '+j.kelas,
        mapel:j.mapel, kelas:j.kelas, jamKe:j.jamKe, hariJadwal:j.hari}, statusSesi(key, j.guru)));
    });
    {
      halaqohList.forEach(function(h){
        const jadwal = statusJadwalHalaqoh_(cfg, h, namaHari);
        if (jadwal === 'tidak') return;
        const key = 'H|'+t+'|'+normNama(h.namaHalaqoh)+'|'+normNama(h.waktu);
        const dasar = {tanggal:t, hari:namaHari, jenis:'Halaqoh', nama: h.namaHalaqoh+' ('+h.waktu+')', halaqoh: h.namaHalaqoh, waktu: h.waktu};
        const daftarG = h.pengampuList || [];
        if (jadwal === 'opsional') {
          // Halaqoh tidak rutin: hanya dihitung bila memang diisi (dan bukan hari libur).
          // Tidak diisi = dianggap tidak ada sesi, jadi tidak pernah membuat guru tercatat
          // tidak masuk. Bila yang mengisi guru pengganti, hanya pengganti yang tercatat.
          if (!hadir[key] || libur[t] || !daftarG.length) return;
          dasar.opsional = true;
          const pengisiO = pengisiHalaqoh[key] || daftarG[0];
          const siapa = daftarG.find(function(g){ return samaGuru_(g, pengisiO); }) || pengisiO;
          catat(siapa, Object.assign({}, dasar, {status:'Hadir', ket:'halaqoh tidak rutin' + (samaGuru_(siapa, daftarG[0]) ? '' : ' · menggantikan ' + daftarG[0])}));
          return;
        }
        if (daftarG.length <= 1) {
          daftarG.forEach(function(g){ catat(g, Object.assign({}, dasar, statusSesi(key, g))); });
          return;
        }
        // Beberapa nama di kolom Pengampu: nama PERTAMA = pengampu utama (wajib hadir),
        // nama berikutnya = guru pengganti/cadangan (tidak wajib, tidak bisa kena SP
        // karena sesi ini). Siapa yang lebih dulu mengisi, dialah yang tercatat mengajar.
        const utama = daftarG[0];
        const pengisi = pengisiHalaqoh[key] || '';
        if (hadir[key] && pengisi && !samaGuru_(pengisi, utama) && !libur[t]) {
          // Pengampu utama TIDAK hadir -- sesinya diisi guru pengganti. Statusnya dihitung
          // seperti sesi yang tidak ia isi: Izin bila izinnya disetujui, Menunggu Izin bila
          // izinnya belum diproses, Belum Tercatat selama masa klarifikasi, selebihnya TMTI.
          // Pengecualian: bila Admin/Mudir mencatat penggantian resmi (menu Guru Pengganti),
          // statusnya tetap "Digantikan" seperti sebelumnya.
          const st = pengganti[key] ? {status:'Digantikan', ket:'oleh ' + pengganti[key]}
                                    : statusSesi('__tidakHadir__|' + key, utama);
          if (!pengganti[key]) st.ket = (st.ket ? st.ket + ' · ' : '') + 'sesi diisi pengganti: ' + pengisi;
          catat(utama, Object.assign({}, dasar, st));
          const cadangan = daftarG.slice(1).find(function(g){ return samaGuru_(g, pengisi); }) || pengisi;
          catat(cadangan, Object.assign({}, dasar, {status:'Hadir', ket:'menggantikan ' + utama}));
        } else {
          catat(utama, Object.assign({}, dasar, statusSesi(key, utama)));
        }
      });
    }
  });

  return Object.keys(perGuru).map(function(k){
    const g = perGuru[k];
    const c = {Hadir:0, Digantikan:0, Izin:0, MenungguIzin:0, BelumTercatat:0, TMTI:0, Libur:0};
    g.sesi.forEach(function(s){ c[s.status] = (c[s.status]||0) + 1; });
    const wajib = g.sesi.length - c.Libur;
    const persen = wajib ? Math.round((c.Hadir + c.Digantikan + c.Izin) * 100 / wajib) : 100;
    return {guru: g.guru, ringkas: c, wajib: wajib, persen: persen, sesi: g.sesi};
  }).sort(function(a,b){ return b.ringkas.TMTI - a.ringkas.TMTI || a.persen - b.persen; });
}

function levelDariTMTIAtur_(n, cfg) {
  if (n >= cfg.sp3) return 3;
  if (n >= cfg.sp2) return 2;
  if (n >= cfg.sp1) return 1;
  return 0;
}

// Jenjang SP yang DIREKOMENDASIKAN untuk guru pada bulan tertentu.
// Berjenjang: kalau guru masih punya SP aktif (terbit di bulan sebelumnya & masa
// berlakunya belum habis) lalu mencapai batas SP lagi, jenjangnya naik satu.
function levelRekomendasiAtur_(guru, bulanStr, jumlahTMTI, cfg, daftarSP, hariIni) {
  const dasar = levelDariTMTIAtur_(jumlahTMTI, cfg);
  if (dasar === 0) return 0;
  let aktifTertinggi = 0;
  daftarSP.forEach(function(sp){
    if (sp.status !== 'Diterbitkan' || normNamaGuru_(sp.guru) !== normNamaGuru_(guru)) return;
    if (sp.bulan >= bulanStr) return;               // hanya SP dari bulan sebelumnya
    if (sp.berlakuSampai && sp.berlakuSampai < hariIni) return; // sudah tidak berlaku
    aktifTertinggi = Math.max(aktifTertinggi, sp.level);
  });
  return aktifTertinggi > 0 ? Math.min(3, Math.max(dasar, aktifTertinggi + 1)) : dasar;
}

// Buat/perbarui DRAF SP untuk satu bulan berdasarkan hasil perhitungan.
// Tidak pernah menerbitkan sendiri -- penerbitan tetap lewat Mudir/Admin.
function sinkronDrafSPAtur_(bulan, tahun, rekap) {
  const cfg = aturanKehadiranGuru_();
  if (!statusAturanKehadiran_(cfg).berjalan) return {dibuat:0, diperbarui:0, dibatalkan:0};
  const bulanStr = tahun + '-' + String(bulan).padStart(2,'0');
  const hariIni = hariIniAtur_();
  const tz = Session.getScriptTimeZone();
  const sh = shSuratSP_();
  const daftarSP = getSuratSPListAtur_();
  let dibuat = 0, diperbarui = 0, dibatalkan = 0;

  rekap.forEach(function(g){
    const tmti = g.sesi.filter(function(s){ return s.status === 'TMTI'; })
      .map(function(s){ return {tanggal: s.tanggal, hari: s.hari, jenis: s.jenis, nama: s.nama}; });
    const rek = levelRekomendasiAtur_(g.guru, bulanStr, tmti.length, cfg, daftarSP, hariIni);
    const milikBulanIni = daftarSP.filter(function(sp){ return normNamaGuru_(sp.guru) === normNamaGuru_(g.guru) && sp.bulan === bulanStr; });
    const terbitTertinggi = milikBulanIni.filter(function(sp){ return sp.status === 'Diterbitkan'; })
      .reduce(function(m, sp){ return Math.max(m, sp.level); }, 0);
    const draf = milikBulanIni.find(function(sp){ return sp.status === 'Draf'; });
    const rincianJson = JSON.stringify(tmti).slice(0, 45000);

    if (rek <= terbitTertinggi) {
      // Tidak perlu SP baru. Draf yang tersisa (mis. TMTI berkurang karena izin
      // disetujui belakangan) dibatalkan otomatis supaya tidak diterbitkan keliru.
      if (draf) {
        sh.getRange(draf.rowIndex, 8).setValue('Dibatalkan');
        sh.getRange(draf.rowIndex, 14).setValue('Otomatis: jumlah TMTI tidak lagi mencapai batas SP berikutnya.');
        dibatalkan++;
      }
      return;
    }
    if (draf) {
      if (draf.level !== rek || draf.jumlahTMTI !== tmti.length) {
        sh.getRange(draf.rowIndex, 4, 1, 4).setValues([[rek, bulanStr, tmti.length, rincianJson]]);
        diperbarui++;
      }
    } else {
      sh.appendRow(['SP-' + Utilities.getUuid().slice(0,8).toUpperCase(), '', g.guru, rek, bulanStr, tmti.length,
        rincianJson, 'Draf', Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'), '', '', '', '', '']);
      dibuat++;
    }
  });
  return {dibuat: dibuat, diperbarui: diperbarui, dibatalkan: dibatalkan};
}

// ---------------- ENDPOINT ----------------

// Rekap semua guru (Admin/Mudir). Sekaligus menyinkronkan draf SP bulan itu.
function apiGetRekapKehadiranGuru(p) {
  if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Hanya Admin/Mudir yang boleh melihat rekap ini.'};
  const now = new Date();
  const bulan = Number(p.bulan) || now.getMonth()+1, tahun = Number(p.tahun) || now.getFullYear();
  const cfg = aturanKehadiranGuru_();
  try {
    const rekap = hitungKehadiranGuruAtur_(bulan, tahun, '');
    const st = statusAturanKehadiran_(cfg);
    let sinkron = null;
    if (st.berjalan) sinkron = sinkronDrafSPAtur_(bulan, tahun, rekap);
    const bulanStr = tahun + '-' + String(bulan).padStart(2,'0');
    const sp = getSuratSPListAtur_().filter(function(x){ return x.bulan === bulanStr && x.status !== 'Dibatalkan'; });
    return {ok:true, aktif: st.berjalan, statusAturan: st, cfg: cfg, rekap: rekap, sinkron: sinkron,
      sp: sp.map(function(x){ return {guru:x.guru, level:x.level, status:x.status}; })};
  } catch (e) {
    return {ok:false, error:'Gagal menghitung rekap: ' + e.message};
  }
}

// Ringkasan untuk kartu notifikasi di dashboard Admin/Mudir. Juga menjalankan
// sinkron draf untuk bulan berjalan (dan bulan lalu di awal bulan), supaya draf SP
// benar-benar muncul "otomatis" tanpa Mudir harus membuka halaman rekap dulu.
function apiGetNotifKehadiranGuru(p) {
  if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Tidak berwenang.'};
  const cfg = aturanKehadiranGuru_();
  const izinMenunggu = getIzinGuruListAtur_().filter(function(z){ return z.status === 'Menunggu'; }).length;
  if (!statusAturanKehadiran_(cfg).berjalan) return {ok:true, aktif:false, izinMenunggu: izinMenunggu, drafSP: 0};
  try {
    const now = new Date();
    const bulan = now.getMonth()+1, tahun = now.getFullYear();
    sinkronDrafSPAtur_(bulan, tahun, hitungKehadiranGuruAtur_(bulan, tahun, ''));
    if (now.getDate() <= cfg.batasKlarifikasi + 2) {
      const lalu = new Date(tahun, bulan-2, 1);
      sinkronDrafSPAtur_(lalu.getMonth()+1, lalu.getFullYear(), hitungKehadiranGuruAtur_(lalu.getMonth()+1, lalu.getFullYear(), ''));
    }
  } catch (e) { Logger.log('Sinkron draf SP gagal: ' + e.message); }
  const drafSP = getSuratSPListAtur_().filter(function(x){ return x.status === 'Draf'; }).length;
  return {ok:true, aktif:true, izinMenunggu: izinMenunggu, drafSP: drafSP};
}

// Kehadiran guru yang sedang login: ringkasan bulan, sesi yang perlu diklarifikasi,
// teguran, dan SP yang sudah diterbitkan untuknya (draf TIDAK pernah dikirim ke guru).
function apiGetKehadiranSaya(p) {
  const guru = norm(p.guru);
  if (!guru) return {ok:false, error:'Nama guru kosong.'};
  const cfg = aturanKehadiranGuru_();
  const spSaya = getSuratSPListAtur_().filter(function(x){ return x.status === 'Diterbitkan' && normNamaGuru_(x.guru) === normNamaGuru_(guru); })
    .sort(function(a,b){ return String(b.diterbitkanPada).localeCompare(String(a.diterbitkanPada)); });
  if (!statusAturanKehadiran_(cfg).berjalan) return {ok:true, aktif:false, sp: spSaya};
  try {
    const now = new Date();
    const bulan = Number(p.bulan) || now.getMonth()+1, tahun = Number(p.tahun) || now.getFullYear();
    let sesi = [];
    const hasil = hitungKehadiranGuruAtur_(bulan, tahun, guru)[0];
    if (hasil) sesi = hasil.sesi;
    // Sesi yang masih bisa diklarifikasi kadang jatuh di bulan lalu (awal bulan)
    if (now.getDate() <= cfg.batasKlarifikasi && !p.bulan) {
      const lalu = new Date(tahun, bulan-2, 1);
      const h2 = hitungKehadiranGuruAtur_(lalu.getMonth()+1, lalu.getFullYear(), guru)[0];
      if (h2) sesi = h2.sesi.filter(function(s){ return s.status === 'BelumTercatat'; }).concat(sesi);
    }
    const ringkas = hasil ? hasil.ringkas : {Hadir:0,Digantikan:0,Izin:0,MenungguIzin:0,BelumTercatat:0,TMTI:0,Libur:0};
    const perluKlarifikasi = sesi.filter(function(s){ return s.status === 'BelumTercatat'; });
    const teguran = ringkas.TMTI >= cfg.teguran && ringkas.TMTI < cfg.sp1;
    return {ok:true, aktif:true, cfg: {teguran:cfg.teguran, sp1:cfg.sp1, sp2:cfg.sp2, sp3:cfg.sp3, batasKlarifikasi:cfg.batasKlarifikasi},
      ringkas: ringkas, persen: hasil ? hasil.persen : 100, wajib: hasil ? hasil.wajib : 0,
      perluKlarifikasi: perluKlarifikasi, tmti: sesi.filter(function(s){ return s.status === 'TMTI'; }),
      teguran: teguran, sp: spSaya};
  } catch (e) {
    return {ok:false, error:'Gagal memuat kehadiran: ' + e.message};
  }
}

// Jenis izin yang wajib dilampiri bukti (surat dokter / surat tugas / undangan).
// Guru yang belum memegang suratnya tetap bisa mengajukan dengan menandai
// "bukti menyusul" -- catatannya ikut terlihat Mudir supaya bisa ditagih.
const IZIN_WAJIB_BUKTI = ['Sakit', 'Tugas dari pondok', 'Kegiatan/undangan tertentu'];
const IZIN_JENIS_SAH = ['Sakit', 'Izin keperluan pribadi/keluarga', 'Tugas dari pondok',
  'Kegiatan/undangan tertentu', 'Sudah mengajar, lupa mencatat'];
const PENANDA_BUKTI_MENYUSUL = '[Bukti menyusul]';
const IZIN_LUPA_MENCATAT = 'Sudah mengajar, lupa mencatat';

function apiAjukanIzinGuru(p) {
  const guru = norm(p.guru);
  const tanggal = norm(p.tanggal).slice(0,10);
  const tanggalSelesai = (norm(p.tanggalSelesai) || tanggal).slice(0,10);
  const alasan = norm(p.alasan);
  const keterangan = norm(p.keterangan);
  const buktiUrl = norm(p.buktiUrl);
  const buktiMenyusul = (p.buktiMenyusul === true || p.buktiMenyusul === 'true');

  if (!guru) return {ok:false, error:'Nama guru tidak diketahui. Masuk ulang ke aplikasi lalu coba lagi.'};
  if (!tanggal || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return {ok:false, error:'Tanggal tidak valid.'};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggalSelesai)) return {ok:false, error:'Tanggal selesai tidak valid.'};
  if (tanggalSelesai < tanggal) return {ok:false, error:'Tanggal selesai lebih awal daripada tanggal mulai.'};
  if (!alasan || IZIN_JENIS_SAH.indexOf(alasan) === -1) return {ok:false, error:'Jenis izin belum dipilih.'};
  if (alasan === IZIN_LUPA_MENCATAT && !aturanKehadiranGuru_().lupaAktif) {
    return {ok:false, error:'Pengajuan "lupa mencatat" sedang dinonaktifkan oleh Admin/Mudir. Hubungi Admin untuk dibukakan akses absen susulan.'};
  }
  // Keterangan WAJIB -- supaya Mudir punya dasar yang jelas saat menyetujui/menolak,
  // dan rekapnya bisa dipertanggungjawabkan.
  if (keterangan.length < 10) return {ok:false, error:'Keterangan wajib diisi minimal 10 huruf, jelaskan singkat alasannya.'};
  if (IZIN_WAJIB_BUKTI.indexOf(alasan) !== -1 && !buktiUrl && !buktiMenyusul) {
    return {ok:false, error:'Jenis "'+alasan+'" wajib dilampiri foto surat/bukti. Bila suratnya belum ada, centang "bukti menyusul" dan jelaskan di keterangan.'};
  }

  const cfg = aturanKehadiranGuru_();
  const hariIni = hariIniAtur_();
  const jmlHari = selisihHariAtur_(tanggal, tanggalSelesai) + 1;
  if (jmlHari > 30) return {ok:false, error:'Sekali pengajuan maksimal 30 hari. Ajukan terpisah bila lebih lama.'};
  // Izin untuk hari yang sudah lewat hanya boleh dalam masa klarifikasi -- setelah
  // itu status TMTI sudah final dan tidak bisa "dihapus" dengan izin belakangan.
  // Batas ke belakang: izin biasa mengikuti masa klarifikasi (bawaan 3 hari) supaya status
  // "tidak masuk tanpa izin" tidak bisa dihapus belakangan. Khusus "sudah mengajar, lupa
  // mencatat" dilonggarkan sampai 30 hari: tujuannya melengkapi absensi santri yang
  // benar-benar terlewat, dan setiap pengajuan tetap harus disetujui Mudir/Admin.
  const batasMundur = alasan === IZIN_LUPA_MENCATAT ? 30 : cfg.batasKlarifikasi;
  if (tanggal < hariIni && selisihHariAtur_(tanggal, hariIni) > batasMundur) {
    return {ok:false, error: alasan === IZIN_LUPA_MENCATAT
      ? 'Pengajuan "lupa mencatat" paling lama 30 hari ke belakang. Untuk tanggal '+tanggal+', hubungi Admin/Mudir.'
      : 'Masa klarifikasi untuk tanggal '+tanggal+' sudah lewat (maksimal '+cfg.batasKlarifikasi+' hari). Hubungi Mudir bila ada alasan khusus.'};
  }
  if (selisihHariAtur_(hariIni, tanggalSelesai) > 60) return {ok:false, error:'Izin hanya bisa diajukan paling jauh 60 hari ke depan.'};

  const sudahAda = {};
  getIzinGuruListAtur_().forEach(function(z){
    if (normNamaGuru_(z.guru) === normNamaGuru_(guru) && (z.status === 'Menunggu' || z.status === 'Disetujui')) sudahAda[z.tanggal] = z.status;
  });

  const tz = Session.getScriptTimeZone();
  const waktuAju = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  const ketSimpan = (buktiMenyusul && !buktiUrl ? PENANDA_BUKTI_MENYUSUL + ' ' : '') + keterangan;
  const p0 = tanggal.split('-').map(Number);
  const baris = [], dilewati = [], idBaru = [];
  for (let i = 0; i < jmlHari; i++) {
    const t = Utilities.formatDate(new Date(p0[0], p0[1]-1, p0[2] + i), tz, 'yyyy-MM-dd');
    if (sudahAda[t]) { dilewati.push(t + ' (' + sudahAda[t] + ')'); continue; }
    const id = 'IZ-' + Utilities.getUuid().slice(0,8).toUpperCase();
    idBaru.push(id);
    baris.push([id, t, guru, alasan, ketSimpan, buktiUrl, 'Menunggu', '', '', '', waktuAju]);
  }
  if (!baris.length) {
    return {ok:false, error:'Semua tanggal yang dipilih sudah punya pengajuan izin (' + dilewati.join(', ') + ').'};
  }
  const sh = shIzinGuru_();
  sh.getRange(sh.getLastRow()+1, 1, baris.length, 11).setValues(baris);

  noWaAdminMudirAtur_().forEach(function(wa){
    kirimWAKehadiranAtur_('waIzinBaru', wa, 'Assalamualaikum Wr. Wb.\n\n*PENGAJUAN IZIN GURU*\n\n' +
      'Nama: *' + guru + '*\nTanggal: ' + tanggal + (jmlHari > 1 ? ' s/d ' + tanggalSelesai + ' (' + baris.length + ' hari)' : '') +
      '\nJenis: ' + alasan + '\nKeterangan: ' + keterangan +
      (buktiUrl ? '\nBukti: terlampir' : (buktiMenyusul ? '\nBukti: menyusul' : '')) +
      '\n\nMohon ditinjau di aplikasi WASIAT, menu Kehadiran Guru & SP.');
  });
  return {ok:true, id: idBaru[0], jumlah: baris.length, dilewati: dilewati};
}

// Melampirkan bukti untuk izin yang sudah diajukan (mis. surat dokter baru didapat).
// Hanya untuk pengajuan milik sendiri yang masih menunggu.
function apiLampirkanBuktiIzin(p) {
  const buktiUrl = norm(p.buktiUrl);
  if (!buktiUrl) return {ok:false, error:'Tidak ada berkas bukti yang dikirim.'};
  const z = getIzinGuruListAtur_().find(function(x){ return x.id === norm(p.id); });
  if (!z) return {ok:false, error:'Pengajuan tidak ditemukan.'};
  if (normNamaGuru_(z.guru) !== normNamaGuru_(p.guru)) return {ok:false, error:'Anda hanya bisa melengkapi pengajuan milik sendiri.'};
  if (z.status !== 'Menunggu') return {ok:false, error:'Pengajuan ini sudah diproses ('+z.status+'), buktinya tidak bisa diubah lagi.'};
  const sh = shIzinGuru_();
  sh.getRange(z.rowIndex, 6).setValue(buktiUrl);
  // Penanda "bukti menyusul" dihapus supaya Mudir tahu buktinya sudah masuk
  sh.getRange(z.rowIndex, 5).setValue(norm(z.keterangan).replace(PENANDA_BUKTI_MENYUSUL, '').trim());
  return {ok:true};
}

// Izin "lupa mencatat" yang sudah disetujui dan masih berlaku, beserta sesi pada
// tanggal itu dan statusnya (sudah/belum diisi). Dipakai halaman Jadwal & Absen guru
// untuk menampilkan tombol yang langsung membuka form absensi sesi yang dimaksud.
function apiGetTiketSusulan(p) {
  const guru = norm(p.guru);
  if (!guru) return {ok:false, error:'Nama guru kosong.'};
  const cfg = aturanKehadiranGuru_();
  if (!cfg.lupaAktif) return {ok:true, aktif:false, data:[]};
  const hariIni = hariIniAtur_();
  const tiket = getIzinGuruListAtur_().filter(function(z){
    if (z.status !== 'Disetujui' || z.alasan !== IZIN_LUPA_MENCATAT) return false;
    if (normNamaGuru_(z.guru) !== normNamaGuru_(guru)) return false;
    const tglSetuju = String(z.waktuProses || '').slice(0,10) || z.tanggal;
    return selisihHariAtur_(tglSetuju, hariIni) <= cfg.lupaBerlakuHari;
  });
  const hasil = [];
  const dataSesi = bahanSesiGuru_(guru);
  tiket.forEach(function(z){
    const st = sesiGuruPadaTanggal_(guru, z.tanggal, dataSesi);
    const tglSetuju = String(z.waktuProses || '').slice(0,10) || z.tanggal;
    hasil.push({id:z.id, tanggal:z.tanggal, hari: st.hari, disetujuiOleh:z.diprosesOleh, catatan:z.catatanProses,
      berlakuSampai: tambahHariAtur_(tglSetuju, cfg.lupaBerlakuHari), sesi: st.sesi, pilihanLain: st.pilihanLain});
  });
  return {ok:true, aktif:true, data:hasil};
}

// ----------------------------------------------------------------------
// Sesi mengajar seorang guru pada satu tanggal -- untuk tiket "lupa mencatat".
// Dihitung LANGSUNG dari jadwal (MataPelajaran, Halaqoh, Penggantian), TIDAK bergantung
// pada pengaturan aturan kehadiran/SP. Sebelumnya memakai mesin SP, sehingga sesi
// halaqoh hilang bila "hitung kehadiran halaqoh" belum diaktifkan atau harinya tidak
// dicentang -- dan guru tidak bisa mengisi absen santrinya walau izin sudah disetujui.
// ----------------------------------------------------------------------
function bahanSesiGuru_(guru) {
  const ss = getAktifSS();
  const tz = Session.getScriptTimeZone();
  const tgl = function(v){ return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : norm(v).slice(0,10); };
  const mapel = [];
  const shM = ss.getSheetByName(SHEET_MAPEL);
  if (shM && shM.getLastRow() > 1) nilaiCatatanUnik_(shM).slice(1).forEach(function(r){
    if (norm(r[0]) && norm(r[1]) && samaGuru_(r[2], guru)) mapel.push({mapel: norm(r[0]), kelas: norm(r[1]), hari: norm(r[3]), jamKe: r[4]});
  });
  const halaqoh = [];
  try { getHalaqohList().forEach(function(h){
    if ((h.pengampuList || []).some(function(g){ return samaGuru_(g, guru); })) halaqoh.push({halaqoh: h.namaHalaqoh, waktu: h.waktu});
  }); } catch (e) {}
  let pengganti = [];
  try { pengganti = getDaftarPenggantian(); } catch (e) {}
  const terisiMapel = {}, terisiHalaqoh = {};
  const shA = ss.getSheetByName(SHEET_ABSENSI);
  if (shA && shA.getLastRow() > 1) nilaiCatatanUnik_(shA).slice(1).forEach(function(r){
    if (norm(r[16]) === 'Halaqoh') terisiHalaqoh[tgl(r[0]) + '|' + normNama(r[3]) + '|' + normNama(r[17])] = norm(r[5]);
    else terisiMapel[tgl(r[0]) + '|' + normNama(r[3]) + '|' + normNama(r[4])] = norm(r[5]);
  });
  const shH = ss.getSheetByName(SHEET_HAFALAN);
  if (shH && shH.getLastRow() > 1) nilaiCatatanUnik_(shH).slice(1).forEach(function(r){
    terisiHalaqoh[tgl(r[0]) + '|' + normNama(r[2]) + '|' + normNama(r[1])] = norm(r[3]);
  });
  return {mapel: mapel, halaqoh: halaqoh, pengganti: pengganti, terisiMapel: terisiMapel, terisiHalaqoh: terisiHalaqoh};
}

function sesiGuruPadaTanggal_(guru, tanggal, d) {
  const q = tanggal.split('-').map(Number);
  const namaHari = HARI_LIST[new Date(q[0], q[1]-1, q[2]).getDay()];
  const nh = normNama(namaHari);
  // Sesi yang tanggal itu dialihkan ke guru lain bukan tugasnya -- tidak ditampilkan
  const dialihkan = {};
  d.pengganti.forEach(function(x){
    if (x.tanggal !== tanggal || !samaGuru_(x.guruAsli, guru)) return;
    if (x.jenisSesi === 'Halaqoh') dialihkan['H|' + normNama(x.halaqoh) + '|' + normNama(x.waktu)] = true;
    else dialihkan['M|' + normNama(x.mapel) + '|' + normNama(x.kelas)] = true;
  });
  const sesi = [];
  const grup = {};
  d.mapel.forEach(function(m){
    if (normNama(m.hari) !== nh) return;
    const k = 'M|' + normNama(m.mapel) + '|' + normNama(m.kelas);
    if (dialihkan[k]) return;
    if (!grup[k]) { grup[k] = {jenis:'Mapel', mapel:m.mapel, kelas:m.kelas, jamKe:[], hariJadwal:m.hari}; sesi.push(grup[k]); }
    pecahJamKe_(m.jamKe).forEach(function(jk){ if (grup[k].jamKe.indexOf(jk) === -1) grup[k].jamKe.push(jk); });
  });
  // Sesi saat ia menjadi guru PENGGANTI di tanggal itu juga boleh disusulkan
  d.pengganti.forEach(function(x){
    if (x.tanggal !== tanggal || !samaGuru_(x.guruPengganti, guru)) return;
    if (x.jenisSesi === 'Halaqoh') sesi.push({jenis:'Halaqoh', halaqoh:x.halaqoh, waktu:x.waktu, pengganti:true, guruAsli:x.guruAsli});
    else {
      const k = 'M|' + normNama(x.mapel) + '|' + normNama(x.kelas);
      if (grup[k]) return;
      grup[k] = {jenis:'Mapel', mapel:x.mapel, kelas:x.kelas, jamKe: pecahJamKe_(x.jamKe), hariJadwal:namaHari, pengganti:true, guruAsli:x.guruAsli};
      sesi.push(grup[k]);
    }
  });
  d.halaqoh.forEach(function(h){
    if (dialihkan['H|' + normNama(h.halaqoh) + '|' + normNama(h.waktu)]) return;
    sesi.push({jenis:'Halaqoh', halaqoh:h.halaqoh, waktu:h.waktu});
  });
  sesi.forEach(function(x){
    const pengisi = x.jenis === 'Mapel'
      ? d.terisiMapel[tanggal + '|' + normNama(x.mapel) + '|' + normNama(x.kelas)]
      : d.terisiHalaqoh[tanggal + '|' + normNama(x.halaqoh) + '|' + normNama(x.waktu)];
    x.sudahDiisi = pengisi !== undefined;
    x.diisiOleh = pengisi || '';
    x.nama = x.jenis === 'Mapel' ? (x.mapel + ' - ' + x.kelas) : (x.halaqoh + ' (' + x.waktu + ')');
    if (x.jamKe) x.jamKe = x.jamKe.map(Number).sort(function(a,b){ return a - b; });
  });
  // Cadangan: mapel/kelas yang diajar guru ini di HARI LAIN -- untuk jadwal yang ditukar
  // atau kolom hari yang belum diisi, supaya guru tetap bisa mengisi absensinya.
  const sudahAda = {};
  sesi.forEach(function(x){ if (x.jenis === 'Mapel') sudahAda[normNama(x.mapel) + '|' + normNama(x.kelas)] = true; });
  const pilihanLain = [], pernah = {};
  d.mapel.forEach(function(m){
    const k = normNama(m.mapel) + '|' + normNama(m.kelas);
    if (sudahAda[k] || pernah[k]) return;
    pernah[k] = true;
    pilihanLain.push({mapel: m.mapel, kelas: m.kelas, hariJadwal: m.hari || '-',
      jamKe: d.mapel.filter(function(z){ return normNama(z.mapel) === normNama(m.mapel) && normNama(z.kelas) === normNama(m.kelas) && normNama(z.hari) === normNama(m.hari); })
        .map(function(z){ return Number(z.jamKe); }).filter(function(n){ return n > 0; }).sort(function(a,b){ return a - b; })});
  });
  return {hari: namaHari, sesi: sesi, pilihanLain: pilihanLain};
}
function tambahHariAtur_(tgl, n) {
  const p = tgl.split('-').map(Number);
  return Utilities.formatDate(new Date(p[0], p[1]-1, p[2] + n), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function apiGetIzinGuru(p) {
  const semua = getIzinGuruListAtur_();
  let data;
  if (p.semua) {
    if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Tidak berwenang.'};
    data = semua;
  } else {
    data = semua.filter(function(z){ return normNamaGuru_(z.guru) === normNamaGuru_(p.guru); });
  }
  data.sort(function(a,b){ return String(b.diajukan).localeCompare(String(a.diajukan)); });
  return {ok:true, data: data.slice(0, 300)};
}

function apiProsesIzinGuru(p) {
  if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Hanya Admin/Mudir yang boleh memproses izin.'};
  const keputusan = norm(p.keputusan);
  if (keputusan !== 'Disetujui' && keputusan !== 'Ditolak') return {ok:false, error:'Keputusan tidak valid.'};
  const z = getIzinGuruListAtur_().find(function(x){ return x.id === norm(p.id); });
  if (!z) return {ok:false, error:'Pengajuan tidak ditemukan.'};
  if (z.status !== 'Menunggu') return {ok:false, error:'Pengajuan ini sudah diproses ('+z.status+').'};
  const tz = Session.getScriptTimeZone();
  shIzinGuru_().getRange(z.rowIndex, 7, 1, 4).setValues([[keputusan, norm(p.oleh), Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'), norm(p.catatan)]]);
  // "Lupa mencatat" disetujui -> guru diberi tahu lewat notifikasi push untuk segera
  // mengisi absensinya. Tombol isi absen muncul paling atas di halaman Jadwal & Absen.
  if (keputusan === 'Disetujui' && z.alasan === IZIN_LUPA_MENCATAT) {
    try {
      const cfgL = aturanKehadiranGuru_();
      kirimPushOneSignal([z.guru], '\u2705 Izin lupa absen disetujui',
        'Silakan isi absensi tanggal ' + z.tanggal + ' sekarang. Buka aplikasi WASIAT, tombol isi absen ada di bagian paling atas. Berlaku ' + cfgL.lupaBerlakuHari + ' hari.',
        '', { jenis: 'susulan', ttl: cfgL.lupaBerlakuHari * 86400 });
    } catch (e) { Logger.log('Push izin lupa gagal: ' + e.message); }
  }
  kirimWAKehadiranAtur_('waIzinDiproses', noWaAkunAtur_(z.guru), 'Assalamualaikum Wr. Wb.\n\n' +
    'Ustadz/Ustadzah *' + z.guru + '*, pengajuan izin Anda untuk tanggal ' + z.tanggal + ' (' + z.alasan + ') telah *' +
    keputusan.toUpperCase() + '*' + (norm(p.catatan) ? '.\nCatatan: ' + norm(p.catatan) : '.') +
    (keputusan === 'Ditolak' ? '\n\nSesi pada tanggal tersebut akan dihitung tidak masuk tanpa izin. Silakan hubungi Mudir bila perlu penjelasan.' : '') +
    '\n\nWassalamualaikum Wr. Wb.');
  return {ok:true};
}

function apiBatalkanIzinGuru(p) {
  const z = getIzinGuruListAtur_().find(function(x){ return x.id === norm(p.id); });
  if (!z) return {ok:false, error:'Pengajuan tidak ditemukan.'};
  if (normNamaGuru_(z.guru) !== normNamaGuru_(p.guru)) return {ok:false, error:'Anda hanya bisa membatalkan pengajuan milik sendiri.'};
  if (z.status !== 'Menunggu') return {ok:false, error:'Hanya pengajuan yang masih menunggu yang bisa dibatalkan.'};
  shIzinGuru_().getRange(z.rowIndex, 7).setValue('Dibatalkan');
  return {ok:true};
}

function apiGetDaftarSP(p) {
  if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Tidak berwenang.'};
  const data = getSuratSPListAtur_().filter(function(x){ return x.status !== 'Dibatalkan' || p.termasukBatal; })
    .sort(function(a,b){ return String(b.dibuat).localeCompare(String(a.dibuat)); });
  return {ok:true, data: data.slice(0, 200), cfg: aturanKehadiranGuru_(), pesantren: {
    nama: getPengaturan().NamaPesantren || 'Pondok Pesantren', alamat: getPengaturan().AlamatPesantren || ''}};
}

function romawiAtur_(n) { return ['','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][n] || String(n); }

function apiTerbitkanSP(p) {
  if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Hanya Admin/Mudir yang boleh menerbitkan SP.'};
  const lock = kunciTransaksi_();
  try { lock.waitLock(30000); } catch (e) { return {ok:false, error:'Server sedang memproses transaksi lain. Data BELUM tersimpan -- silakan tekan tombolnya sekali lagi.'}; }
  try {
    const semua = getSuratSPListAtur_();
    const sp = semua.find(function(x){ return x.id === norm(p.id); });
    if (!sp) return {ok:false, error:'Draf SP tidak ditemukan.'};
    if (sp.status !== 'Draf') return {ok:false, error:'SP ini sudah '+sp.status+'.'};
    const cfg = aturanKehadiranGuru_();
    const hariIni = hariIniAtur_();
    const tahun = hariIni.slice(0,4);
    // Nomor urut per tahun, hanya menghitung SP yang benar-benar diterbitkan
    const urut = semua.filter(function(x){ return x.status === 'Diterbitkan' && String(x.diterbitkanPada).slice(0,4) === tahun; }).length + 1;
    const nomor = String(urut).padStart(3,'0') + '/SP-' + sp.level + '/' + cfg.kodeSurat + '/' + romawiAtur_(Number(hariIni.slice(5,7))) + '/' + tahun;
    const berlaku = tambahBulanAtur_(hariIni, cfg.masaBerlakuBulan);
    const sh = shSuratSP_();
    sh.getRange(sp.rowIndex, 2).setValue(nomor);
    sh.getRange(sp.rowIndex, 8).setValue('Diterbitkan');
    sh.getRange(sp.rowIndex, 10, 1, 3).setValues([[norm(p.oleh), hariIni, berlaku]]);
    if (norm(p.catatan)) sh.getRange(sp.rowIndex, 14).setValue(norm(p.catatan));
    kirimWAKehadiranAtur_('waSPTerbit', noWaAkunAtur_(sp.guru), 'Assalamualaikum Wr. Wb.\n\n' +
      'Ustadz/Ustadzah *' + sp.guru + '*, pondok telah menerbitkan *Surat Peringatan (SP-' + sp.level + ')* ' +
      'nomor ' + nomor + ' terkait kehadiran mengajar.\n\nMohon buka aplikasi WASIAT untuk membaca surat dan ' +
      'menekan tombol "Saya telah membaca".\n\nWassalamualaikum Wr. Wb.');
    return {ok:true, nomor: nomor, berlakuSampai: berlaku};
  } finally {
    lock.releaseLock();
  }
}

function apiBatalkanSP(p) {
  if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Hanya Admin/Mudir yang boleh membatalkan SP.'};
  const sp = getSuratSPListAtur_().find(function(x){ return x.id === norm(p.id); });
  if (!sp) return {ok:false, error:'SP tidak ditemukan.'};
  if (sp.status === 'Dibatalkan') return {ok:false, error:'SP ini sudah dibatalkan.'};
  const sh = shSuratSP_();
  sh.getRange(sp.rowIndex, 8).setValue('Dibatalkan');
  sh.getRange(sp.rowIndex, 14).setValue('Dibatalkan oleh ' + norm(p.oleh) + (norm(p.alasan) ? ': ' + norm(p.alasan) : ''));
  return {ok:true};
}

function apiTandaiSPDibaca(p) {
  const sp = getSuratSPListAtur_().find(function(x){ return x.id === norm(p.id); });
  if (!sp || sp.status !== 'Diterbitkan') return {ok:false, error:'Surat tidak ditemukan.'};
  if (normNamaGuru_(sp.guru) !== normNamaGuru_(p.guru)) return {ok:false, error:'Surat ini bukan untuk Anda.'};
  if (sp.dibacaPada) return {ok:true, dibacaPada: sp.dibacaPada};
  const w = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  shSuratSP_().getRange(sp.rowIndex, 13).setValue(w);
  return {ok:true, dibacaPada: w};
}

function apiGetLiburPondok() {
  return {ok:true, data: getLiburListAtur_().sort(function(a,b){ return b.tanggal.localeCompare(a.tanggal); })};
}

function apiSimpanLiburPondok(p) {
  if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Hanya Admin/Mudir yang boleh mengatur hari libur.'};
  const mulai = norm(p.mulai).slice(0,10), selesai = (norm(p.selesai) || norm(p.mulai)).slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mulai) || !/^\d{4}-\d{2}-\d{2}$/.test(selesai)) return {ok:false, error:'Tanggal tidak valid.'};
  if (selesai < mulai) return {ok:false, error:'Tanggal selesai lebih awal dari tanggal mulai.'};
  const jml = selisihHariAtur_(mulai, selesai) + 1;
  if (jml > 120) return {ok:false, error:'Rentang libur terlalu panjang (maksimal 120 hari sekali simpan).'};
  const ada = {}; getLiburListAtur_().forEach(function(l){ ada[l.tanggal] = true; });
  const tz = Session.getScriptTimeZone();
  const baris = [];
  const p0 = mulai.split('-').map(Number);
  for (let i = 0; i < jml; i++) {
    const t = Utilities.formatDate(new Date(p0[0], p0[1]-1, p0[2] + i), tz, 'yyyy-MM-dd');
    if (!ada[t]) baris.push([t, norm(p.keterangan) || 'Libur pondok', Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm')]);
  }
  if (baris.length) {
    const sh = shLiburPondok_();
    sh.getRange(sh.getLastRow()+1, 1, baris.length, 3).setValues(baris);
  }
  return {ok:true, ditambah: baris.length};
}

function apiHapusLiburPondok(p) {
  if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Hanya Admin/Mudir yang boleh mengatur hari libur.'};
  const l = getLiburListAtur_().find(function(x){ return x.tanggal === norm(p.tanggal); });
  if (!l) return {ok:false, error:'Tanggal libur tidak ditemukan.'};
  shLiburPondok_().deleteRow(l.rowIndex);
  return {ok:true};
}


// ======================================================================
// GANTI NISN SANTRI
//
// Untuk santri yang NISN-nya berubah (mis. NISN sementara diganti NISN resmi). Semua
// data santri itu -- absensi, hafalan, nilai, SPP, saldo & transaksi kantin,
// pelanggaran, perizinan, tasmi', akun wali, dst. -- ikut dipindah ke NISN baru,
// sehingga seluruh fitur tetap membaca riwayatnya seperti sebelumnya.
//
// Cara kerja: di SETIAP spreadsheet aplikasi (Master, semester berjalan, Kantin, SPP,
// Pelanggaran, dan arsip tahun-tahun sebelumnya), setiap kolom yang judulnya memuat
// "NISN" diperiksa, lalu NISN lama diganti NISN baru. Kolom berisi beberapa NISN
// (mis. "NISN Anak" di akun wali: "123, 456") diganti per bagian.
// Mencari berdasarkan judul kolom (bukan daftar sheet tetap) membuat sheet yang
// ditambahkan di masa depan otomatis ikut terjangkau.
//
// Selalu ada PRATINJAU lebih dulu (berapa baris di sheet mana), dan setiap
// penggantian dicatat di sheet RiwayatGantiNISN (Master) untuk audit.
// ======================================================================
const SHEET_RIWAYAT_GANTI_NISN = 'RiwayatGantiNISN';

function daftarSpreadsheetAplikasi_() {
  const hasil = [], sudah = {};
  function tambah(label, fnAtauId) {
    try {
      const ss = typeof fnAtauId === 'function' ? fnAtauId() : SpreadsheetApp.openById(fnAtauId);
      if (!ss || sudah[ss.getId()]) return;
      sudah[ss.getId()] = true;
      hasil.push({label: label, ss: ss});
    } catch (e) { Logger.log('Spreadsheet dilewati (' + label + '): ' + e.message); }
  }
  tambah('Master', getMasterSS);
  tambah('Semester berjalan', getAktifSS);
  tambah('Kantin', getAktifKantinSS);
  tambah('SPP', getAktifSppSS);
  tambah('Pelanggaran', getPelanggaranAktifSS);
  // Arsip: SETIAP sheet di Master yang punya kolom "Spreadsheet ID" adalah daftar
  // spreadsheet (TahunAjaran, PelanggaranSpreadsheet, dan daftar lain di masa depan).
  // Semuanya dipindai -- sebelumnya hanya TahunAjaran, sehingga spreadsheet Pelanggaran
  // tahun-tahun lalu (terdaftar di PelanggaranSpreadsheet) terlewat.
  try {
    getMasterSS().getSheets().forEach(function(sh){
      if (sh.getLastRow() < 2 || sh.getLastColumn() < 1) return;
      const rows = sh.getDataRange().getValues();
      const h = rows[0].map(function(x){ return norm(x); });
      const kolomId = [];
      h.forEach(function(x, i){ if (/spreadsheet id/i.test(x)) kolomId.push(i); });
      if (!kolomId.length) return;
      rows.slice(1).forEach(function(r){
        kolomId.forEach(function(i){
          const id = norm(r[i]);
          const jenis = h[i].replace(/spreadsheet id/i, '').replace(/[()]/g,'').trim();
          if (id && id.length > 20) tambah('Arsip ' + norm(r[0]) + (jenis ? ' (' + jenis + ')' : ' (' + sh.getName() + ')'), id);
        });
      });
    });
  } catch (e) {}
  return hasil;
}

// Ganti token NISN di dalam satu sel. Mengembalikan nilai baru, atau null bila tidak berubah.
function gantiNisnDalamSel_(nilai, lama, baru) {
  const teks = norm(nilai);
  if (!teks) return null;
  if (teks === lama) {
    // Pertahankan jenis sel: angka tetap angka (kecuali NISN baru diawali 0 -- akan hilang
    // bila disimpan sebagai angka, jadi disimpan sebagai teks)
    if (typeof nilai === 'number' && /^[1-9]\d*$/.test(baru) && baru.length <= 15) return Number(baru);
    return /^0/.test(baru) ? "'" + baru : baru;
  }
  if (!/[,;]/.test(teks)) return null;
  let berubah = false;
  const bagian = teks.split(/\s*[,;]\s*/).map(function(t){ if (t === lama) { berubah = true; return baru; } return t; });
  return berubah ? bagian.join(', ') : null;
}

const SHEET_TIDAK_DIGANTI_NISN_ = ['RiwayatGantiNISN', 'JejakNISN'];
let _gantiNisnInternal_ = false; // true hanya saat dipanggil penjaga NISN (bukan dari aplikasi)
function apiGantiNisn(p) {
  if (!_gantiNisnInternal_ && !adminAtauMudir(p.oleh)) return {ok:false, error:'Hanya Admin/Mudir yang boleh mengganti NISN.'};
  const lama = norm(p.nisnLama), baru = norm(p.nisnBaru).replace(/^'/, '');
  const jalankan = p.jalankan === true || p.jalankan === 'true';
  if (!lama || !baru) return {ok:false, error:'NISN lama dan NISN baru wajib diisi.'};
  if (lama === baru) return {ok:false, error:'NISN baru sama dengan NISN lama.'};
  if (!/^[0-9A-Za-z.\-]{3,20}$/.test(baru)) return {ok:false, error:'Format NISN baru tidak valid (3-20 karakter, tanpa spasi).'};

  // Santri harus ada dengan NISN lama, dan NISN baru belum dipakai santri lain.
  // Pengecualian -- SAPU ULANG: penggantian lama->baru ini pernah dilakukan (tercatat di
  // riwayat). Dipakai untuk (a) melanjutkan proses yang terhenti di tengah jalan, dan
  // (b) memindahkan data yang masuk BELAKANGAN masih dengan NISN lama (mis. absensi dari
  // HP guru yang offline, baru terkirim setelah penggantian).
  const shSantri = getAktifSS().getSheetByName(SHEET_SANTRI);
  const santri = shSantri.getDataRange().getValues().slice(1);
  let dataLama = santri.find(function(r){ return norm(r[0]) === lama; });
  const bentrok = santri.find(function(r){ return norm(r[0]) === baru; });
  let sapuUlang = false;
  if (!dataLama || bentrok) {
    const pernah = riwayatGantiNisn_().some(function(x){ return x.lama === lama && x.baru === baru; });
    // sudahDiubahDiSheet: NISN sudah diganti langsung di sheet Santri (lama sudah tidak ada,
    // baru sudah ada) -- yang perlu dilakukan tinggal memindahkan riwayat yang tertinggal.
    const sudahDiSheet = (p.sudahDiubahDiSheet === true || p.sudahDiubahDiSheet === 'true') && bentrok && !dataLama;
    if ((pernah || sudahDiSheet) && bentrok && !dataLama) { sapuUlang = true; dataLama = bentrok; }
    else if (!dataLama) return {ok:false, error:'Santri dengan NISN ' + lama + ' tidak ditemukan di data Santri.'};
    else return {ok:false, error:'NISN ' + baru + ' sudah dipakai oleh santri lain (' + norm(bentrok[1]) + '). Periksa kembali NISN barunya.'};
  }

  // Kunci yang sama dengan pencatatan absensi/hafalan (bukan kunci transaksi keuangan):
  // pemindaian semua spreadsheet bisa memakan puluhan detik, dan tidak boleh membuat
  // kasir kantin / tambah saldo menunggu.
  let lock;
  try { lock = LockService.getUserLock(); } catch (e) { lock = LockService.getScriptLock(); }
  if (jalankan) { try { lock.waitLock(30000); } catch (e) { return {ok:false, error:'Sistem sedang sibuk, coba lagi sebentar.'}; } }
  try {
    const rincian = [];
    const tulisan = [];   // dikumpulkan dulu, ditulis setelah semua pemindaian selesai
    let total = 0;
    const idSantriUtama = getAktifSS().getId();
    daftarSpreadsheetAplikasi_().forEach(function(item){
      item.ss.getSheets().forEach(function(sh){
        // Catatan audit penggantian NISN & jejak penjaga TIDAK ikut diubah -- isinya memang
        // harus tetap menyebut NISN lama apa adanya.
        if (SHEET_TIDAK_DIGANTI_NISN_.indexOf(sh.getName()) !== -1) return;
        const baris = sh.getLastRow(), kolom = sh.getLastColumn();
        if (baris < 2 || kolom < 1) return;
        const judul = sh.getRange(1, 1, 1, kolom).getValues()[0];
        judul.forEach(function(j, i){
          if (!/nisn/i.test(norm(j))) return;
          const rng = sh.getRange(2, i + 1, baris - 1, 1);
          const nilai = rng.getValues();
          let jumlah = 0;
          const baruNilai = nilai.map(function(r){
            const g = gantiNisnDalamSel_(r[0], lama, baru);
            if (g === null) return [r[0]];
            jumlah++; return [g];
          });
          if (!jumlah) return;
          tulisan.push({rng: rng, nilai: baruNilai, terakhir: item.ss.getId() === idSantriUtama && sh.getName() === SHEET_SANTRI});
          total += jumlah;
          rincian.push({spreadsheet: item.label, sheet: sh.getName(), kolom: norm(j), jumlah: jumlah});
        });
      });
    });

    if (jalankan && total) {
      // 1) Catat DULU ke riwayat (status "Diproses") -- kalau proses terhenti di tengah,
      //    riwayat inilah yang membolehkan "sapu ulang" untuk menyelesaikannya.
      let shLog = null, barisLog = 0;
      try {
        const ms = getMasterSS();
        shLog = ms.getSheetByName(SHEET_RIWAYAT_GANTI_NISN);
        if (!shLog) { shLog = ms.insertSheet(SHEET_RIWAYAT_GANTI_NISN); shLog.appendRow(['Waktu','Oleh','NISN Lama','NISN Baru','Nama Santri','Jumlah Baris','Rincian','Status']); shLog.setFrozenRows(1); }
        shLog.appendRow([new Date(), norm(p.oleh), "'" + lama, "'" + baru, norm(dataLama[1]), total,
          (sapuUlang ? '[Sapu ulang] ' : '') + rincian.map(function(x){ return x.spreadsheet + ' / ' + x.sheet + ': ' + x.jumlah; }).join('; ').slice(0, 45000), 'Diproses']);
        barisLog = shLog.getLastRow();
      } catch (e) { return {ok:false, error:'Gagal mencatat riwayat, penggantian dibatalkan: ' + e.message}; }
      // 2) Tulis semua data. Sheet Santri utama ditulis PALING AKHIR, supaya bila terhenti
      //    di tengah, NISN lama masih terdaftar dan penggantian bisa diulang dengan biasa.
      tulisan.filter(function(t){ return !t.terakhir; }).forEach(function(t){ t.rng.setValues(t.nilai); });
      tulisan.filter(function(t){ return t.terakhir; }).forEach(function(t){ t.rng.setValues(t.nilai); });
      try {
        shLog.getRange(barisLog, 8).setValue('Selesai');
        // Proses sebelumnya untuk pasangan NISN yang sama yang sempat terhenti kini ikut
        // dinyatakan tuntas, supaya tidak terus tampil "Belum tuntas" di aplikasi.
        const semua = shLog.getRange(2, 3, shLog.getLastRow() - 1, 6).getValues();
        semua.forEach(function(r, i){
          if (norm(r[0]).replace(/^'/,'') === lama && norm(r[1]).replace(/^'/,'') === baru && norm(r[5]) === 'Diproses') {
            shLog.getRange(i + 2, 8).setValue('Selesai (dituntaskan ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy') + ')');
          }
        });
      } catch (e) {}
      try { const shSpp = getAktifSppSS().getSheetByName(SHEET_SPP); if (shSpp) { const k = kolomSpp_(shSpp); if (k.nama) isiNamaSpp_(shSpp, k.nama); } } catch (e) {}
    }
    return {ok:true, dijalankan: jalankan && total > 0, sapuUlang: sapuUlang, nama: norm(dataLama[1]), nisnLama: lama, nisnBaru: baru, total: total, rincian: rincian};
  } finally {
    if (jalankan) lock.releaseLock();
  }
}

// ======================================================================
// PENJAGA NISN: mengubah NISN LANGSUNG DI SPREADSHEET (sheet Santri)
//
// Semua riwayat (absensi, nilai, hafalan, SPP, kantin, pelanggaran, perizinan, dst.)
// terhubung ke santri lewat NISN. Bila NISN diganti langsung di sheet Santri, riwayat
// lama masih ber-NISN lama sehingga "hilang". Penjaga ini memindahkannya otomatis
// dengan proses yang SAMA seperti menu Ganti NISN (semua spreadsheet, termasuk arsip).
//
// Dua lapis:
//  1. Pemicu "saat diedit" pada spreadsheet semester: begitu satu sel NISN diubah,
//     riwayatnya langsung dipindah (beberapa detik kemudian).
//  2. Pemeriksaan berkala (tiap jam) + tombol "Periksa sekarang": membandingkan sheet
//     Santri dengan JEJAK terakhir. Menangkap perubahan yang lolos dari lapis 1 (mis.
//     tempel banyak sel sekaligus, atau saat pemicu belum terpasang).
//     Diproses otomatis HANYA bila yakin: baris yang sama, nama santri sama, NISN lama
//     sudah tidak dipakai siapa pun, dan NISN baru tidak dobel. Selebihnya dicantumkan
//     sebagai "perlu dicek" untuk dikonfirmasi Admin/Mudir -- tidak ada yang ditebak.
// ======================================================================
const SHEET_JEJAK_NISN = 'JejakNISN';
const PROP_PENJAGA_NISN_SS = 'PenjagaNisnSpreadsheet';
const PROP_NISN_PERLU_CEK = 'NisnPerluDicek';

function kolomNisnSantri_(header) {
  let i = header.findIndex(function(h){ return /^nisn$/i.test(norm(h)); });
  return i === -1 ? 0 : i;
}
function bacaSantriUntukJejak_() {
  const sh = getAktifSS().getSheetByName(SHEET_SANTRI);
  const v = sh.getDataRange().getValues();
  const iN = kolomNisnSantri_(v[0]);
  const iNama = v[0].findIndex(function(h){ return /^nama/i.test(norm(h)); });
  const hasil = [];
  for (let r = 1; r < v.length; r++) {
    const nisn = norm(v[r][iN]).replace(/^'/, '');
    const nama = norm(v[r][iNama === -1 ? 1 : iNama]);
    if (nisn || nama) hasil.push({baris: r + 1, nisn: nisn, nama: nama});
  }
  return hasil;
}
function shJejakNisn_() {
  const ms = getMasterSS();
  let sh = ms.getSheetByName(SHEET_JEJAK_NISN);
  if (!sh) {
    sh = ms.insertSheet(SHEET_JEJAK_NISN);
    sh.appendRow(['Baris', 'NISN', 'Nama', 'Spreadsheet Semester', 'Diperbarui']);
    sh.setFrozenRows(1);
    try { sh.hideSheet(); } catch (e) {}
  }
  return sh;
}
function simpanJejakNisn_(data) {
  const sh = shJejakNisn_();
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 5).clearContent();
  const id = getAktifSS().getId(), now = new Date();
  if (data.length) sh.getRange(2, 1, data.length, 5).setValues(data.map(function(x){ return [x.baris, "'" + x.nisn, x.nama, id, now]; }));
}
function bacaJejakNisn_() {
  const sh = shJejakNisn_();
  if (sh.getLastRow() < 2) return {ada: false, data: []};
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  return {ada: true, idSemester: norm(v[0][3]), data: v.map(function(r){ return {baris: Number(r[0]), nisn: norm(r[1]).replace(/^'/, ''), nama: norm(r[2])}; })};
}

// Pindahkan riwayat lama -> baru (dipakai kedua lapis). Mengembalikan ringkasan.
function pindahkanRiwayatNisn_(lama, baru, nama, sumber) {
  _gantiNisnInternal_ = true;
  try {
    const hasil = apiGantiNisn({nisnLama: lama, nisnBaru: baru, jalankan: true, oleh: sumber, sudahDiubahDiSheet: true});
    return hasil;
  } catch (e) {
    return {ok:false, error: e.message};
  } finally { _gantiNisnInternal_ = false; }
}
function catatPerluCekNisn_(item) {
  try {
    const props = PropertiesService.getScriptProperties();
    let daftar = [];
    try { daftar = JSON.parse(props.getProperty(PROP_NISN_PERLU_CEK) || '[]'); } catch (e) {}
    const kunci = item.lama + '>' + item.baru + '|' + item.nama;
    if (!daftar.some(function(x){ return (x.lama + '>' + x.baru + '|' + x.nama) === kunci; })) {
      item.waktu = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
      daftar.push(item);
    }
    props.setProperty(PROP_NISN_PERLU_CEK, JSON.stringify(daftar.slice(-50)));
  } catch (e) {}
}
function hapusPerluCekNisn_(lama, baru) {
  try {
    const props = PropertiesService.getScriptProperties();
    let daftar = JSON.parse(props.getProperty(PROP_NISN_PERLU_CEK) || '[]');
    daftar = daftar.filter(function(x){ return !((!lama || x.lama === lama) && x.baru === baru); });
    props.setProperty(PROP_NISN_PERLU_CEK, JSON.stringify(daftar));
  } catch (e) {}
}

// LAPIS 1 -- pemicu "saat diedit" (dipasang pada spreadsheet semester berjalan)
function saatSpreadsheetDiedit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== SHEET_SANTRI || e.range.getRow() < 2) return;
    const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const iN = kolomNisnSantri_(header) + 1;
    if (e.range.getColumn() > iN || e.range.getLastColumn() < iN) return;
    // Satu sel dengan nilai lama yang jelas: langsung diproses. Tempel banyak sel: diserahkan
    // ke pemeriksaan jejak (yang membandingkan baris per baris).
    if (e.range.getNumRows() === 1 && e.range.getNumColumns() === 1 && e.oldValue !== undefined && e.value !== undefined) {
      const lama = norm(e.oldValue).replace(/^'/, ''), baru = norm(e.value).replace(/^'/, '');
      if (lama && baru && lama !== baru) {
        const semua = bacaSantriUntukJejak_();
        const masihDipakai = semua.some(function(x){ return x.nisn === lama; });
        const dobel = semua.filter(function(x){ return x.nisn === baru; }).length > 1;
        const nama = (semua.find(function(x){ return x.baris === e.range.getRow(); }) || {}).nama || '';
        if (masihDipakai || dobel) {
          catatPerluCekNisn_({lama: lama, baru: baru, nama: nama, alasan: dobel ? 'NISN baru dipakai lebih dari satu santri' : 'NISN lama masih dipakai santri lain'});
        } else {
          const h = pindahkanRiwayatNisn_(lama, baru, nama, 'Edit langsung di sheet Santri');
          if (!h.ok) catatPerluCekNisn_({lama: lama, baru: baru, nama: nama, alasan: h.error});
        }
      }
    }
    periksaPerubahanNisn_();
  } catch (err) { Logger.log('Penjaga NISN (edit) gagal: ' + err.message); }
}

// LAPIS 2 -- bandingkan sheet Santri dengan jejak terakhir
function periksaPerubahanNisn_() {
  let lock;
  try { lock = LockService.getUserLock(); } catch (e) { lock = LockService.getScriptLock(); }
  try { lock.waitLock(30000); } catch (e) { return {ok:false, error:'Sedang ada proses lain, coba lagi.'}; }
  let jejak, sekarang;
  try {
    jejak = bacaJejakNisn_();
    sekarang = bacaSantriUntukJejak_();
    const idAktif = getAktifSS().getId();
    if (!jejak.ada || jejak.idSemester !== idAktif) {
      // Belum ada jejak / semester baru: rekam keadaan sekarang sebagai titik awal
      simpanJejakNisn_(sekarang);
      return {ok:true, awal: true, diproses: [], perluCek: []};
    }
  } finally { lock.releaseLock(); }

  const nisnSekarang = {}, nisnJejak = {};
  sekarang.forEach(function(x){ if (x.nisn) nisnSekarang[x.nisn] = (nisnSekarang[x.nisn] || 0) + 1; });
  jejak.data.forEach(function(x){ if (x.nisn) nisnJejak[x.nisn] = true; });
  const hilang = jejak.data.filter(function(x){ return x.nisn && !nisnSekarang[x.nisn]; });
  const muncul = sekarang.filter(function(x){ return x.nisn && !nisnJejak[x.nisn]; });
  const diproses = [], perluCek = [];
  const riwayat = riwayatGantiNisn_();

  const keluar = petaMutasiKeluar_();
  const dipasangkan = {};
  hilang.forEach(function(h){
    // Dikeluarkan lewat menu Mutasi & Alumni (keluar/lulus) -> memang seharusnya hilang
    if (keluar[h.nisn]) return;
    // Sudah pernah dipindah (mis. oleh lapis 1 atau menu Ganti NISN) -> lewati
    const sudah = riwayat.find(function(r){ return r.lama === h.nisn && r.status.indexOf('Selesai') === 0; });
    if (sudah && nisnSekarang[sudah.baru]) return;
    const cocok = muncul.filter(function(m){ return normNama(m.nama) === normNama(h.nama) && normNama(h.nama); });
    cocok.forEach(function(m){ dipasangkan[m.nisn] = true; });
    if (cocok.length === 1 && cocok[0].baris === h.baris && nisnSekarang[cocok[0].nisn] === 1) {
      const hasil = pindahkanRiwayatNisn_(h.nisn, cocok[0].nisn, h.nama, 'Edit langsung di sheet Santri (pemeriksaan jejak)');
      if (hasil.ok) { diproses.push({lama: h.nisn, baru: cocok[0].nisn, nama: h.nama, total: hasil.total}); hapusPerluCekNisn_(h.nisn, cocok[0].nisn); }
      else { const it = {lama: h.nisn, baru: cocok[0].nisn, nama: h.nama, alasan: hasil.error}; perluCek.push(it); catatPerluCekNisn_(it); }
    } else if (cocok.length >= 1) {
      const it = {lama: h.nisn, baru: cocok.length === 1 ? cocok[0].nisn : '', nama: h.nama,
        alasan: cocok.length > 1 ? 'Ada beberapa santri bernama sama dengan NISN baru' : (nisnSekarang[cocok[0].nisn] > 1 ? 'NISN baru dipakai lebih dari satu santri' : 'Baris santri berpindah posisi')};
      perluCek.push(it); catatPerluCekNisn_(it);
    }
    // Tidak ada pasangan bernama sama: santri dihapus/keluar, atau nama ikut diubah --
    // tidak diproses otomatis. Bila NISN-nya memang diganti, pakai menu Ganti NISN.
    else {
      const it = {lama: h.nisn, baru: '', nama: h.nama, alasan: 'NISN lama hilang dari sheet Santri tanpa pasangan yang jelas (santri dihapus, atau nama ikut diubah)'};
      perluCek.push(it); catatPerluCekNisn_(it);
    }
  });

  // Santri yang muncul tanpa pasangan = santri masuk (ditambahkan langsung di spreadsheet
  // atau lewat aplikasi). Dicatat sebagai Santri Baru; Admin bisa mengubahnya menjadi
  // Pindahan Masuk di menu Mutasi & Alumni. Yang sudah tercatat semester ini dilewati.
  let masukDicatat = 0;
  try {
    masukDicatat = catatSantriMasukBanyak_(muncul.filter(function(m){ return !dipasangkan[m.nisn]; }).map(function(m){
      return {nisn: m.nisn, nama: m.nama, keterangan: 'Ditambahkan langsung di spreadsheet'};
    }), 'Sistem (jejak NISN)');
  } catch (e) {}
  // Rekam keadaan terbaru sebagai jejak untuk pemeriksaan berikutnya
  try { simpanJejakNisn_(bacaSantriUntukJejak_()); } catch (e) {}
  return {ok:true, diproses: diproses, perluCek: perluCek, masukDicatat: masukDicatat};
}

// Pemeriksaan berkala (pemicu waktu tiap jam). Juga memastikan pemicu edit menempel
// pada spreadsheet semester yang SEDANG aktif (berganti saat tahun ajaran/semester baru).
function jalankanPenjagaNisn() {
  try { pastikanPemicuNisn_(); } catch (e) { Logger.log('Pasang pemicu NISN gagal: ' + e.message); }
  try { periksaPerubahanNisn_(); } catch (e) { Logger.log('Periksa NISN gagal: ' + e.message); }
}
function pastikanPemicuNisn_() {
  const props = PropertiesService.getScriptProperties();
  const idAktif = getAktifSS().getId();
  const pemicu = ScriptApp.getProjectTriggers();
  let adaWaktu = false, adaEdit = false;
  pemicu.forEach(function(t){
    const fn = t.getHandlerFunction();
    if (fn === 'jalankanPenjagaNisn') adaWaktu = true;
    if (fn === 'saatSpreadsheetDiedit') {
      if (props.getProperty(PROP_PENJAGA_NISN_SS) === idAktif && t.getTriggerSourceId() === idAktif) adaEdit = true;
      else ScriptApp.deleteTrigger(t); // milik semester lama
    }
  });
  if (!adaEdit) {
    ScriptApp.newTrigger('saatSpreadsheetDiedit').forSpreadsheet(idAktif).onEdit().create();
    props.setProperty(PROP_PENJAGA_NISN_SS, idAktif);
  }
  if (!adaWaktu) ScriptApp.newTrigger('jalankanPenjagaNisn').timeBased().everyHours(1).create();
  return {edit: true, waktu: true};
}

// Endpoint Admin/Mudir
function apiPenjagaNisn(p) {
  if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Hanya Admin/Mudir.'};
  const aksi = norm(p.aksi) || 'status';
  let pasang = null, periksa = null, galat = '';
  if (aksi === 'pasang' || aksi === 'periksa') {
    try { pasang = pastikanPemicuNisn_(); } catch (e) { galat = 'Pemicu belum bisa dipasang: ' + e.message; }
  }
  if (aksi === 'periksa') periksa = periksaPerubahanNisn_();
  if (aksi === 'abaikan') hapusPerluCekNisn_(norm(p.nisnLama), norm(p.nisnBaru));
  let terpasang = false;
  try {
    const idAktif = getAktifSS().getId();
    terpasang = ScriptApp.getProjectTriggers().some(function(t){ return t.getHandlerFunction() === 'saatSpreadsheetDiedit' && t.getTriggerSourceId() === idAktif; });
  } catch (e) {}
  let perluCek = [];
  try { perluCek = JSON.parse(PropertiesService.getScriptProperties().getProperty(PROP_NISN_PERLU_CEK) || '[]'); } catch (e) {}
  return {ok:true, terpasang: terpasang, periksa: periksa, perluCek: perluCek.reverse(), galat: galat};
}

function riwayatGantiNisn_() {
  const sh = getMasterSS().getSheetByName(SHEET_RIWAYAT_GANTI_NISN);
  if (!sh || sh.getLastRow() < 2) return [];
  const tz = Session.getScriptTimeZone();
  return sh.getDataRange().getValues().slice(1).map(function(r){
    return {waktu: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'dd/MM/yyyy HH:mm') : norm(r[0]),
      oleh: norm(r[1]), lama: norm(r[2]).replace(/^'/,''), baru: norm(r[3]).replace(/^'/,''), nama: norm(r[4]),
      jumlah: Number(r[5]) || 0, sapu: /^\[Sapu ulang\]/.test(norm(r[6])), status: norm(r[7]) || 'Selesai'};
  });
}
function apiGetRiwayatGantiNisn(p) {
  if (!adminAtauMudir(p.oleh)) return {ok:false, error:'Tidak berwenang.'};
  return {ok:true, data: riwayatGantiNisn_().reverse().slice(0, 50)};
}

// ======================================================================
// REKAP HAFALAN BULANAN (per santri / per halaqoh / per kelas)
//
// Format laporan mengikuti tabel pondok:  Bulan | Capaian Target  ... | Jumlah Hafalan
//  - Capaian per bulan = halaman BARU dari setoran "Sabaq" di bulan itu, ditulis dalam
//    lembar (1 lembar = 2 halaman), mis. "3 Lembar 1 Halaman". Halaman yang sama yang
//    disetor ulang hanya dihitung sekali (di bulan pertama kali disetor).
//  - Bulan tanpa Sabaq tetapi ada Sabqi/Manzil/Murojaah/Tasmi' -> "Murojaah".
//  - Jumlah Hafalan = juz yang sudah tuntas dari SEMUA semester sejak santri masuk
//    (dari setoran Sabaq/Sabqi/Manzil/Murojaah/Tasmi'), mis. "2 Juz (29-30)".
//  - Target (opsional) ditetapkan pengampu per halaqoh per semester di sheet
//    TargetHafalan pada spreadsheet semester. Bila tidak diaktifkan, tidak ditampilkan.
// Hanya MEMBACA sheet Hafalan -- tidak ada data hafalan yang diubah.
// ======================================================================
const SHEET_TARGET_HAFALAN = 'TargetHafalan';
const HEADER_TARGET_HAFALAN_ = ['Halaqoh','Aktif','Target Per Bulan (Halaman)','Target Khusus Bulan','Diubah Oleh','Waktu Ubah'];
const NAMA_SURAH_MUSHAF_ = ["Al-Fatihah", "Al-Baqarah", "Ali 'Imran", "An-Nisa", "Al-Ma'idah", "Al-An'am", "Al-A'raf", "Al-Anfal", "At-Taubah", "Yunus", "Hud", "Yusuf", "Ar-Ra'd", "Ibrahim", "Al-Hijr", "An-Nahl", "Al-Isra", "Al-Kahf", "Maryam", "Ta-Ha", "Al-Anbiya", "Al-Hajj", "Al-Mu'minun", "An-Nur", "Al-Furqan", "Asy-Syu'ara", "An-Naml", "Al-Qasas", "Al-'Ankabut", "Ar-Rum", "Luqman", "As-Sajdah", "Al-Ahzab", "Saba'", "Fatir", "Ya-Sin", "As-Saffat", "Sad", "Az-Zumar", "Gafir", "Fussilat", "Asy-Syura", "Az-Zukhruf", "Ad-Dukhan", "Al-Jasiyah", "Al-Ahqaf", "Muhammad", "Al-Fath", "Al-Hujurat", "Qaf", "Az-Zariyat", "At-Tur", "An-Najm", "Al-Qamar", "Ar-Rahman", "Al-Waqi'ah", "Al-Hadid", "Al-Mujadilah", "Al-Hasyr", "Al-Mumtahanah", "As-Saf", "Al-Jumu'ah", "Al-Munafiqun", "At-Tagabun", "At-Talaq", "At-Tahrim", "Al-Mulk", "Al-Qalam", "Al-Haqqah", "Al-Ma'arij", "Nuh", "Al-Jinn", "Al-Muzzammil", "Al-Muddassir", "Al-Qiyamah", "Al-Insan", "Al-Mursalat", "An-Naba", "An-Nazi'at", "'Abasa", "At-Takwir", "Al-Infitar", "Al-Mutaffifin", "Al-Insyiqaq", "Al-Buruj", "At-Tariq", "Al-A'la", "Al-Gasyiyah", "Al-Fajr", "Al-Balad", "Asy-Syams", "Al-Lail", "Ad-Duha", "Al-Insyirah", "At-Tin", "Al-'Alaq", "Al-Qadr", "Al-Bayyinah", "Az-Zalzalah", "Al-'Adiyat", "Al-Qari'ah", "At-Takasur", "Al-'Asr", "Al-Humazah", "Al-Fil", "Quraisy", "Al-Ma'un", "Al-Kausar", "Al-Kafirun", "An-Nasr", "Al-Masad", "Al-Ikhlas", "Al-Falaq", "An-Nas"];
const JUMLAH_AYAT_SURAH_ = [7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6];
const JUZ_AWAL_HALAMAN_ = [1, 22, 42, 62, 82, 102, 121, 142, 162, 182, 201, 222, 242, 262, 282, 302, 322, 342, 362, 382, 402, 422, 442, 462, 482, 502, 522, 542, 562, 582];
// Peta Mushaf Madinah 604 halaman: "halaman.noSurah.ayatMulai" (dari file Peta_Halaman_Quran_Madinah_604)
const PETA_HALAMAN_AYAT_TEKS_ = "1.1.1;2.2.1;3.2.6;4.2.17;5.2.25;6.2.30;7.2.38;8.2.49;9.2.58;10.2.62;11.2.70;12.2.77;13.2.84;14.2.89;15.2.94;16.2.102;17.2.106;18.2.113;19.2.120;20.2.127;21.2.135;22.2.142;23.2.146;24.2.154;25.2.164;26.2.170;27.2.177;28.2.182;29.2.187;30.2.191;31.2.197;32.2.203;33.2.211;34.2.216;35.2.220;36.2.225;37.2.231;38.2.234;39.2.238;40.2.246;41.2.249;42.2.253;43.2.257;44.2.260;45.2.265;46.2.270;47.2.275;48.2.282;49.2.283;50.3.1;51.3.10;52.3.16;53.3.23;54.3.30;55.3.38;56.3.46;57.3.53;58.3.62;59.3.71;60.3.78;61.3.84;62.3.92;63.3.101;64.3.109;65.3.116;66.3.122;67.3.133;68.3.141;69.3.149;70.3.154;71.3.158;72.3.166;73.3.174;74.3.181;75.3.187;76.3.195;77.4.1;78.4.7;79.4.12;80.4.15;81.4.20;82.4.24;83.4.27;84.4.34;85.4.38;86.4.45;87.4.52;88.4.60;89.4.66;90.4.75;91.4.80;92.4.87;93.4.92;94.4.95;95.4.102;96.4.106;97.4.114;98.4.122;99.4.128;100.4.135;101.4.141;102.4.148;103.4.155;104.4.163;105.4.171;106.4.176;106.5.1;107.5.3;108.5.6;109.5.10;110.5.14;111.5.18;112.5.24;113.5.32;114.5.37;115.5.42;116.5.46;117.5.51;118.5.58;119.5.65;120.5.71;121.5.77;122.5.83;123.5.90;124.5.96;125.5.104;126.5.109;127.5.114;128.6.1;129.6.9;130.6.19;131.6.28;132.6.36;133.6.45;134.6.53;135.6.60;136.6.69;137.6.74;138.6.82;139.6.91;140.6.95;141.6.102;142.6.111;143.6.119;144.6.125;145.6.132;146.6.138;147.6.143;148.6.147;149.6.152;150.6.158;151.7.1;152.7.12;153.7.23;154.7.31;155.7.38;156.7.44;157.7.52;158.7.58;159.7.68;160.7.74;161.7.82;162.7.88;163.7.96;164.7.105;165.7.121;166.7.131;167.7.138;168.7.144;169.7.150;170.7.156;171.7.160;172.7.164;173.7.171;174.7.179;175.7.188;176.7.196;177.8.1;178.8.9;179.8.17;180.8.26;181.8.34;182.8.41;183.8.46;184.8.53;185.8.62;186.8.70;187.9.1;188.9.7;189.9.14;190.9.21;191.9.27;192.9.32;193.9.37;194.9.41;195.9.48;196.9.55;197.9.62;198.9.69;199.9.73;200.9.80;201.9.87;202.9.94;203.9.100;204.9.107;205.9.112;206.9.118;207.9.123;208.10.1;209.10.7;210.10.15;211.10.21;212.10.26;213.10.34;214.10.43;215.10.54;216.10.62;217.10.71;218.10.79;219.10.89;220.10.98;221.10.107;221.11.1;222.11.6;223.11.13;224.11.20;225.11.29;226.11.38;227.11.46;228.11.54;229.11.63;230.11.72;231.11.82;232.11.89;233.11.98;234.11.109;235.11.118;235.12.1;236.12.5;237.12.15;238.12.23;239.12.31;240.12.38;241.12.44;242.12.53;243.12.64;244.12.70;245.12.79;246.12.87;247.12.96;248.12.104;249.13.1;250.13.6;251.13.14;252.13.19;253.13.29;254.13.35;255.13.43;255.14.1;256.14.6;257.14.11;258.14.19;259.14.25;260.14.34;261.14.43;262.15.1;263.15.16;264.15.32;265.15.52;266.15.71;267.15.91;267.16.1;268.16.7;269.16.15;270.16.27;271.16.35;272.16.43;273.16.55;274.16.65;275.16.73;276.16.80;277.16.88;278.16.94;279.16.103;280.16.111;281.16.119;282.17.1;283.17.8;284.17.18;285.17.28;286.17.39;287.17.50;288.17.59;289.17.67;290.17.76;291.17.87;292.17.97;293.17.105;293.18.1;294.18.5;295.18.16;296.18.21;297.18.28;298.18.35;299.18.46;300.18.54;301.18.62;302.18.75;303.18.84;304.18.98;305.19.1;306.19.12;307.19.26;308.19.39;309.19.52;310.19.65;311.19.77;312.19.96;312.20.1;313.20.13;314.20.38;315.20.52;316.20.65;317.20.77;318.20.88;319.20.99;320.20.114;321.20.126;322.21.1;323.21.11;324.21.25;325.21.36;326.21.45;327.21.58;328.21.73;329.21.82;330.21.91;331.21.102;332.22.1;333.22.6;334.22.16;335.22.24;336.22.31;337.22.39;338.22.47;339.22.56;340.22.65;341.22.73;342.23.1;343.23.18;344.23.28;345.23.43;346.23.60;347.23.75;348.23.90;349.23.105;350.24.1;351.24.11;352.24.21;353.24.28;354.24.32;355.24.37;356.24.44;357.24.54;358.24.59;359.24.62;359.25.1;360.25.3;361.25.12;362.25.21;363.25.33;364.25.44;365.25.56;366.25.68;367.26.1;368.26.20;369.26.40;370.26.61;371.26.84;372.26.112;373.26.137;374.26.160;375.26.184;376.26.207;377.27.1;378.27.14;379.27.23;380.27.36;381.27.45;382.27.56;383.27.64;384.27.77;385.27.89;385.28.1;386.28.6;387.28.14;388.28.22;389.28.29;390.28.36;391.28.44;392.28.51;393.28.60;394.28.71;395.28.78;396.28.85;396.29.1;397.29.7;398.29.15;399.29.24;400.29.31;401.29.39;402.29.46;403.29.53;404.29.64;404.30.1;405.30.6;406.30.16;407.30.25;408.30.33;409.30.42;410.30.51;411.31.1;412.31.12;413.31.20;414.31.29;415.32.1;416.32.12;417.32.21;418.33.1;419.33.7;420.33.16;421.33.23;422.33.31;423.33.36;424.33.44;425.33.51;426.33.55;427.33.63;428.34.1;429.34.8;430.34.15;431.34.23;432.34.32;433.34.40;434.34.49;434.35.1;435.35.4;436.35.12;437.35.19;438.35.31;439.35.39;440.35.45;440.36.1;441.36.13;442.36.28;443.36.41;444.36.55;445.36.71;446.37.1;447.37.25;448.37.52;449.37.77;450.37.103;451.37.127;452.37.154;453.38.1;454.38.17;455.38.27;456.38.43;457.38.62;458.38.84;458.39.1;459.39.6;460.39.11;461.39.22;462.39.32;463.39.41;464.39.48;465.39.57;466.39.68;467.39.75;467.40.1;468.40.8;469.40.17;470.40.26;471.40.34;472.40.41;473.40.50;474.40.59;475.40.67;476.40.78;477.41.1;478.41.12;479.41.21;480.41.30;481.41.39;482.41.47;483.42.1;484.42.11;485.42.16;486.42.23;487.42.32;488.42.45;489.42.52;489.43.1;490.43.11;491.43.23;492.43.34;493.43.48;494.43.61;495.43.74;496.44.1;497.44.19;498.44.40;499.45.1;500.45.14;501.45.23;502.45.33;502.46.1;503.46.6;504.46.15;505.46.21;506.46.29;507.47.1;508.47.12;509.47.20;510.47.30;511.48.1;512.48.10;513.48.16;514.48.24;515.48.29;515.49.1;516.49.5;517.49.12;518.50.1;519.50.16;520.50.36;520.51.1;521.51.7;522.51.31;523.51.52;523.52.1;524.52.15;525.52.32;526.53.1;527.53.27;528.53.45;528.54.1;529.54.7;530.54.28;531.54.50;531.55.1;532.55.17;533.55.41;534.55.68;534.56.1;535.56.17;536.56.51;537.56.77;537.57.1;538.57.4;539.57.12;540.57.19;541.57.25;542.58.1;543.58.7;544.58.12;545.58.22;545.59.1;546.59.4;547.59.10;548.59.17;549.60.1;550.60.6;551.60.12;551.61.1;552.61.6;553.62.1;554.62.9;554.63.1;555.63.5;556.64.1;557.64.10;558.65.1;559.65.6;560.66.1;561.66.8;562.67.1;563.67.13;564.67.27;564.68.1;565.68.16;566.68.43;566.69.1;567.69.9;568.69.35;568.70.1;569.70.11;570.70.40;570.71.1;571.71.11;572.72.1;573.72.14;574.73.1;575.73.20;575.74.1;576.74.18;577.74.48;577.75.1;578.75.20;578.76.1;579.76.6;580.76.26;580.77.1;581.77.20;582.78.1;583.78.31;583.79.1;584.79.16;585.80.1;586.81.1;587.82.1;587.83.1;588.83.7;589.83.35;589.84.1;590.85.1;591.86.1;591.87.1;592.87.16;592.88.1;593.89.1;594.89.24;594.90.1;595.91.1;595.92.1;596.92.15;596.93.1;596.94.1;597.95.1;597.96.1;598.97.1;598.98.1;599.98.8;599.99.1;599.100.1;600.100.10;600.101.1;600.102.1;601.103.1;601.104.1;601.105.1;602.106.1;602.107.1;602.108.1;603.109.1;603.110.1;603.111.1;604.112.1;604.113.1;604.114.1";
const JENIS_HAFALAN_TERHAFAL_ = ['Sabaq','Sabqi','Manzil','Murojaah',"Tasmi'"];
const JENIS_HAFALAN_MUROJAAH_ = ['Sabqi','Manzil','Murojaah',"Tasmi'"];
const NAMA_BULAN_ID_ = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

let _petaHalamanAyat_ = null;
function petaHalamanAyat_() {
  if (_petaHalamanAyat_) return _petaHalamanAyat_;
  const per = {}; // noSurah -> [[ayatMulai, halaman], ...] urut
  PETA_HALAMAN_AYAT_TEKS_.split(';').forEach(function(t){
    const a = t.split('.'); const hal = Number(a[0]), s = Number(a[1]), ay = Number(a[2]);
    (per[s] = per[s] || []).push([ay, hal]);
  });
  _petaHalamanAyat_ = per;
  return per;
}
function kunciNamaSurah_(s) {
  return String(s || '').toLowerCase().replace(/^(surah|surat|qs\.?)\s+/, '')
    .replace(/[^a-z]/g, '').replace(/^(asy|ash|ats|al|an|at|as|az|ad|ar)(?=[a-z]{3,})/, '');
}
let _indeksSurah_ = null;
function noSurahDariNama_(nama) {
  if (!nama) return 0;
  if (/^\d+$/.test(String(nama).trim())) { const n = Number(nama); return n >= 1 && n <= 114 ? n : 0; }
  if (!_indeksSurah_) {
    _indeksSurah_ = {};
    NAMA_SURAH_MUSHAF_.forEach(function(n, i){ _indeksSurah_[kunciNamaSurah_(n)] = i + 1; });
    // ejaan lain yang sering dipakai
    const alias = {yasin:36, yaasin:36, taha:20, thaha:20, sad:38, shad:38, qaf:50, nun:68, qalam:68,
      insyirah:94, syarh:94, alamnasyrah:94, kautsar:108, kausar:108, takatsur:102, takasur:102,
      ikhlas:112, falaq:113, nas:114, naas:114, mulk:67, naba:78, ghasyiyah:88, gasyiyah:88, alaq:96,
      fatihah:1, baqarah:2, imran:3, aliimran:3, maidah:5, anam:6, araf:7, anfal:8, taubah:9, kahfi:18,
      rahman:55, waqiah:56, mujadilah:58, mumtahanah:60, munafiqun:63, tagabun:64, taghabun:64,
      mutaffifin:83, muthaffifin:83, insyiqaq:84, buruj:85, tariq:86, thariq:86, ala:87, fajr:89,
      balad:90, syams:91, lail:92, dhuha:93, duha:93, tin:95, qadr:97, bayyinah:98, zalzalah:99,
      adiyat:100, qariah:101, asr:103, ashr:103, humazah:104, fil:105, quraisy:106, quraisyh:106,
      maun:107, kafirun:109, nasr:110, nashr:110, masad:111, lahab:111, muzzammil:73, muddassir:74,
      muddatstsir:74, qiyamah:75, insan:76, mursalat:77, naziat:79, abasa:80, takwir:81, infitar:82, infithar:82,
      jinn:72, jin:72, nuh:71, maarij:70, haqqah:69, tahrim:66, talaq:65, thalaq:65, jumuah:62, saff:61, shaff:61};
    Object.keys(alias).forEach(function(k){ if (!_indeksSurah_[k]) _indeksSurah_[k] = alias[k]; });
  }
  const k = kunciNamaSurah_(nama);
  if (_indeksSurah_[k]) return _indeksSurah_[k];
  // awalan cocok (mis. "Al-Baqarah 1-5" sudah dipisah sebelumnya, tapi jaga-jaga)
  const kunci = Object.keys(_indeksSurah_);
  for (let i = 0; i < kunci.length; i++) if (k.length >= 4 && kunci[i].indexOf(k) === 0) return _indeksSurah_[kunci[i]];
  return 0;
}
function halamanAyat_(noSurah, ayat) {
  const daftar = petaHalamanAyat_()[noSurah];
  if (!daftar) return 0;
  let hal = daftar[0][1];
  for (let i = 0; i < daftar.length; i++) { if (daftar[i][0] <= ayat) hal = daftar[i][1]; else break; }
  return hal;
}
function juzDariHalaman_(hal) {
  for (let j = 30; j >= 1; j--) if (hal >= JUZ_AWAL_HALAMAN_[j - 1]) return j;
  return 0;
}
function rentangJuz_(j) { return {awal: JUZ_AWAL_HALAMAN_[j - 1], akhir: j < 30 ? JUZ_AWAL_HALAMAN_[j] - 1 : 604}; }
function tambahRentang_(hasil, a, b) {
  a = Math.round(a); b = Math.round(b);
  if (!(a >= 1) || !(b >= 1)) return;
  if (b < a) { const t = a; a = b; b = t; }
  if (a > 604) return; if (b > 604) b = 604;
  if (b - a > 640) return;
  for (let h = a; h <= b; h++) hasil.push(h);
}

// Daftar halaman mushaf (1-604) yang tercakup oleh satu catatan hafalan.
// Urutan sumber: kolom "Halaman Ke" -> Surah + Ayat -> Surah utuh (mode multi-surah).
function halamanCatatanHafalan_(surah, ayat, juz, halamanKe) {
  const mentah = halamanCatatanHafalanMentah_(surah, ayat, juz, halamanKe);
  const ada = {}, unik = [];
  mentah.forEach(function(x){ if (!ada[x]) { ada[x] = 1; unik.push(x); } });
  return unik.sort(function(a,b){ return a - b; });
}
function halamanCatatanHafalanMentah_(surah, ayat, juz, halamanKe) {
  const hasil = [];
  const teksHal = String(halamanKe == null ? '' : halamanKe).trim();
  if (teksHal) {
    const kelompok = teksHal.split(/[,;]/).map(function(x){ return x.trim(); }).filter(Boolean);
    const juzTunggal = /^\d+$/.test(String(juz == null ? '' : juz).trim()) ? Number(juz) : 0;
    kelompok.forEach(function(g){
      const angka = g.split(/\s*-\s*/).map(Number).filter(function(n){ return !isNaN(n) && n > 0; });
      if (!angka.length) return;
      let a = angka[0], b = angka[angka.length - 1];
      // Data lama: nomor halaman DI DALAM juz (1-22). Diubah ke halaman mushaf.
      if (juzTunggal > 1 && b <= 22 && a < JUZ_AWAL_HALAMAN_[juzTunggal - 1]) {
        const r = rentangJuz_(juzTunggal);
        a = r.awal + a - 1; b = Math.min(r.akhir, r.awal + b - 1);
      }
      tambahRentang_(hasil, a, b);
    });
    if (hasil.length) return hasil;
  }
  const teksSurah = String(surah || '').trim();
  if (!teksSurah) return hasil;
  // Mode Juz Utuh tanpa halaman: "Juz 29, Juz 30"
  const juzUtuh = teksSurah.match(/^juz\s*\d+(\s*,\s*juz\s*\d+)*$/i);
  if (juzUtuh) {
    (teksSurah.match(/\d+/g) || []).forEach(function(j){ j = Number(j); if (j >= 1 && j <= 30) { const r = rentangJuz_(j); tambahRentang_(hasil, r.awal, r.akhir); } });
    return hasil;
  }
  const bagianSurah = teksSurah.split(/\s*\+\s*/);
  const teksAyat = String(ayat == null ? '' : ayat).trim();
  bagianSurah.forEach(function(nm){
    const no = noSurahDariNama_(nm);
    if (!no) return;
    const jml = JUMLAH_AYAT_SURAH_[no - 1];
    let aw = 1, ak = jml;
    if (bagianSurah.length === 1 && teksAyat) {
      const ang = teksAyat.split(/\s*-\s*/).map(Number).filter(function(n){ return !isNaN(n) && n > 0; });
      if (ang.length) { aw = Math.min(ang[0], jml); ak = Math.min(ang[ang.length - 1], jml); }
    }
    tambahRentang_(hasil, halamanAyat_(no, aw), halamanAyat_(no, ak));
  });
  return hasil;
}

// "7" -> "3 Lembar 1 Halaman"
function teksLembar_(halaman) {
  halaman = Math.max(0, Math.round(Number(halaman) || 0));
  if (!halaman) return '';
  const l = Math.floor(halaman / 2), h = halaman % 2;
  return (l ? l + ' Lembar' : '') + (l && h ? ' ' : '') + (h ? h + ' Halaman' : '');
}
// [26,27,29,30] -> "26-27, 29-30"
function teksDaftarJuz_(list) {
  const x = list.slice().sort(function(a,b){ return a - b; });
  const out = []; let i = 0;
  while (i < x.length) { let j = i; while (j + 1 < x.length && x[j + 1] === x[j] + 1) j++; out.push(i === j ? String(x[i]) : x[i] + '-' + x[j]); i = j + 1; }
  return out.join(', ');
}
// Ringkasan "Jumlah Hafalan" dari kumpulan halaman yang sudah dihafal
function ringkasJumlahHafalan_(setHal) {
  const perJuz = {};
  Object.keys(setHal).forEach(function(h){ const j = juzDariHalaman_(Number(h)); if (j) perJuz[j] = (perJuz[j] || 0) + 1; });
  const selesai = [], proses = [];
  Object.keys(perJuz).forEach(function(j){
    j = Number(j); const r = rentangJuz_(j); const total = r.akhir - r.awal + 1;
    if (perJuz[j] >= total) selesai.push(j); else proses.push({juz: j, halaman: perJuz[j]});
  });
  selesai.sort(function(a,b){ return a - b; });
  proses.sort(function(a,b){ return b.halaman - a.halaman || b.juz - a.juz; });
  let teks = selesai.length ? (selesai.length + ' Juz (' + teksDaftarJuz_(selesai) + ')') : '';
  const tambahan = proses.map(function(p){ return teksLembar_(p.halaman) + ' Juz ' + p.juz; });
  if (tambahan.length) teks = teks ? teks + ' + ' + tambahan.join(' + ') : tambahan.join(' + ');
  return {juzSelesai: selesai, juzProses: proses, totalHalaman: Object.keys(setHal).length, teks: teks || '–'};
}

// Baca kolom penting sheet Hafalan satu semester (catatan ganda: yang terbaru dipakai)
function bacaHafalanRingkas_(ss) {
  const sh = ss.getSheetByName(SHEET_HAFALAN);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = nilaiCatatanUnik_(sh);
  const tz = Session.getScriptTimeZone();
  const hasil = [];
  for (let i = 1; i < v.length; i++) {
    const r = v[i];
    const nisn = norm(r[4]); if (!nisn || !r[0]) continue;
    const tgl = tglKunciCatatan_(r[0], tz); if (!tgl) continue;
    hasil.push({tgl: tgl, nisn: nisn, nama: norm(r[5]), halaqoh: norm(r[2]), jenis: norm(r[6]),
      surah: r[7], ayat: r[8], juz: r[9], halamanKe: r[10]});
  }
  return hasil;
}
function rentangKeTeks_(arr) { // [1,2,3,7] -> "1-3,7" (hemat ruang cache)
  const x = arr.slice().sort(function(a,b){ return a - b; }); const out = []; let i = 0;
  while (i < x.length) { let j = i; while (j + 1 < x.length && x[j + 1] === x[j] + 1) j++; out.push(i === j ? '' + x[i] : x[i] + '-' + x[j]); i = j + 1; }
  return out.join(',');
}
function teksKeRentang_(t) {
  const hasil = [];
  String(t || '').split(',').forEach(function(g){ if (!g) return; const a = g.split('-').map(Number); tambahRentang_(hasil, a[0], a[a.length - 1]); });
  return hasil;
}
// Halaman yang sudah dihafal per NISN pada satu semester LAMA (bukan semester yang sedang
// dilaporkan). Disimpan di cache 6 jam; kuncinya ikut jumlah baris sheet, jadi bila ada
// catatan baru di semester itu cache otomatis tidak terpakai.
function halamanTerhafalSemester_(idSS) {
  let ss; try { ss = bukaSS_(idSS); } catch (e) { return {}; }
  const sh = ss.getSheetByName(SHEET_HAFALAN);
  if (!sh || sh.getLastRow() < 2) return {};
  const kunci = 'hfKum2_' + idSS + '_' + sh.getLastRow();
  const c = cacheAmbil(kunci);
  if (c) { const peta = {}; Object.keys(c).forEach(function(n){ peta[n] = teksKeRentang_(c[n]); }); return peta; }
  const kumpul = {};
  bacaHafalanRingkas_(ss).forEach(function(r){
    if (JENIS_HAFALAN_TERHAFAL_.indexOf(r.jenis) === -1) return;
    const hal = halamanCatatanHafalan_(r.surah, r.ayat, r.juz, r.halamanKe);
    if (!hal.length) return;
    const s = kumpul[r.nisn] = kumpul[r.nisn] || {};
    hal.forEach(function(h){ s[h] = 1; });
  });
  const peta = {}, simpan = {};
  Object.keys(kumpul).forEach(function(n){ const arr = Object.keys(kumpul[n]).map(Number); peta[n] = arr; simpan[n] = rentangKeTeks_(arr); });
  try { const teks = JSON.stringify(simpan); if (teks.length < 95000) cacheSimpan(kunci, simpan, 21600); } catch (e) {}
  return peta;
}

// ---- Target hafalan per halaqoh (per semester) ----
function bacaTargetHafalan_(ss) {
  const sh = ss.getSheetByName(SHEET_TARGET_HAFALAN);
  const peta = {};
  if (!sh || sh.getLastRow() < 2) return peta;
  sh.getDataRange().getValues().slice(1).forEach(function(r){
    const h = norm(r[0]); if (!h) return;
    let khusus = {};
    try { khusus = JSON.parse(norm(r[3]) || '{}') || {}; } catch (e) { khusus = {}; }
    peta[normNama(h)] = {halaqoh: h, aktif: r[1] === true || String(r[1]).toUpperCase() === 'TRUE' || String(r[1]) === 'Ya',
      targetHalaman: Number(r[2]) || 0, khusus: khusus, oleh: norm(r[4]), waktu: r[5] ? String(r[5]) : ''};
  });
  return peta;
}
function targetBulanHafalan_(cfg, kunciBulan) {
  if (!cfg || !cfg.aktif) return null;
  const k = cfg.khusus && Object.prototype.hasOwnProperty.call(cfg.khusus, kunciBulan) ? cfg.khusus[kunciBulan] : null;
  if (k === 'M' || k === 'm') return {murojaah: true, halaman: 0, teks: 'Murojaah'};
  const hal = k != null && k !== '' ? Number(k) : cfg.targetHalaman;
  if (!(hal > 0)) return null;
  return {murojaah: false, halaman: hal, teks: teksLembar_(hal)};
}

// Siapa boleh melihat apa: Admin/Mudir semua; pengampu -> halaqohnya; wali kelas -> kelasnya;
// wali santri -> anaknya sendiri.
function aksesRekapHafalan_(oleh, ss) {
  const a = {semua: false, halaqoh: [], kelas: [], nisnAnak: []};
  oleh = norm(oleh);
  if (!oleh) return a;
  try {
    const rows = getAktifSS().getSheetByName(SHEET_ROLE).getDataRange().getValues().slice(1);
    const r = rows.find(function(x){ return normNama(norm(x[0])) === normNama(oleh); });
    if (r) {
      const lv = norm(r[3]);
      if (lv.indexOf('Admin') !== -1 || lv.indexOf('Mudir') !== -1) a.semua = true;
      a.nisnAnak = norm(r[4]).split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    }
  } catch (e) {}
  try {
    const shH = ss.getSheetByName(SHEET_HALAQOH);
    if (shH) shH.getDataRange().getValues().slice(1).forEach(function(x){
      if (x[0] && pengampuCocok(daftarPengampu(x[1]), oleh)) a.halaqoh.push(norm(x[0]));
    });
  } catch (e) {}
  try {
    const shG = getAktifSS().getSheetByName(SHEET_GURU);
    if (shG) {
      const g = shG.getDataRange().getValues(); const iW = g[0].indexOf('WaliKelas');
      if (iW > -1) g.slice(1).forEach(function(x){ if (normNama(norm(x[0])) === normNama(oleh) && norm(x[iW])) a.kelas.push(norm(x[iW])); });
    }
  } catch (e) {}
  return a;
}
// Data santri, kelas & halaqoh pada spreadsheet semester tertentu
function dataSantriSemesterHafalan_(ss) {
  const santri = {}, kelasList = [], halaqohList = [];
  try { const sh = ss.getSheetByName(SHEET_SANTRI); if (sh) sh.getDataRange().getValues().slice(1).forEach(function(r){ const n = norm(r[0]); if (n) santri[n] = {nisn: n, nama: norm(r[1]), kelas: '', halaqoh: [], gender: norm(r[3])}; }); } catch (e) {}
  try {
    const sh = ss.getSheetByName(SHEET_ROMBEL);
    if (sh) sh.getDataRange().getValues().slice(1).forEach(function(r){
      const n = norm(r[0]), k = norm(r[2]); if (!n) return;
      if (!santri[n]) santri[n] = {nisn: n, nama: norm(r[1]), kelas: '', halaqoh: []};
      if (k) { santri[n].kelas = k; if (kelasList.indexOf(k) === -1) kelasList.push(k); }
    });
  } catch (e) {}
  const pengampuHalaqoh = {};
  try {
    const sh = ss.getSheetByName(SHEET_HALAQOH);
    if (sh) sh.getDataRange().getValues().slice(1).forEach(function(r){
      const h = norm(r[0]); if (!h) return;
      halaqohList.push({nama: h, pengampu: daftarPengampu(r[1])[0] || norm(r[1]), waktu: norm(r[2])});
      pengampuHalaqoh[h] = daftarPengampu(r[1])[0] || norm(r[1]);
    });
  } catch (e) {}
  try {
    const sh = ss.getSheetByName(SHEET_HALAQOH_ANGGOTA);
    if (sh) sh.getDataRange().getValues().slice(1).forEach(function(r){
      const n = norm(r[0]), h = norm(r[2]); if (!n || !h) return;
      if (!santri[n]) santri[n] = {nisn: n, nama: norm(r[1]), kelas: '', halaqoh: []};
      if (santri[n].halaqoh.indexOf(h) === -1) santri[n].halaqoh.push(h);
    });
  } catch (e) {}
  kelasList.sort(function(a,b){ return a.localeCompare(b, 'id', {numeric:true}); });
  return {santri: santri, kelasList: kelasList, halaqohList: halaqohList, pengampuHalaqoh: pengampuHalaqoh};
}
function infoSemesterHafalan_(tahunAjaranId) {
  const list = getTahunAjaranList();
  let idx = tahunAjaranId ? list.findIndex(function(t){ return norm(t.id) === norm(tahunAjaranId); }) : -1;
  if (idx === -1) idx = list.findIndex(function(t){ return t.aktif === true || String(t.aktif).toUpperCase() === 'TRUE'; });
  return {list: list, idx: idx, nama: idx > -1 ? norm(list[idx].nama) : '', id: idx > -1 ? norm(list[idx].id) : norm(tahunAjaranId)};
}

// Pilihan untuk layar rekap: santri/halaqoh/kelas yang boleh dilihat pengguna ini
function apiGetOpsiRekapHafalanBulanan(p) {
  const ss = getSSTarget(p.tahunAjaranId);
  const ak = aksesRekapHafalan_(p.oleh, ss);
  const d = dataSantriSemesterHafalan_(ss);
  let halaqoh = d.halaqohList, kelas = d.kelasList;
  if (!ak.semua) {
    halaqoh = halaqoh.filter(function(h){ return ak.halaqoh.some(function(x){ return normNama(x) === normNama(h.nama); }); });
    kelas = kelas.filter(function(k){ return ak.kelas.some(function(x){ return normNama(x) === normNama(k); }); });
  }
  const namaHal = halaqoh.map(function(h){ return normNama(h.nama); });
  const santri = Object.keys(d.santri).map(function(n){ return d.santri[n]; }).filter(function(s){
    if (ak.semua) return true;
    if (ak.nisnAnak.indexOf(s.nisn) !== -1) return true;
    if (s.halaqoh.some(function(h){ return namaHal.indexOf(normNama(h)) !== -1; })) return true;
    return kelas.indexOf(s.kelas) !== -1;
  }).map(function(s){ return {nisn: s.nisn, nama: s.nama, kelas: s.kelas, halaqoh: s.halaqoh.join(', ')}; })
    .sort(function(a,b){ return a.nama.localeCompare(b.nama); });
  const target = bacaTargetHafalan_(ss);
  return {ok: true, semua: ak.semua, santri: santri, kelas: kelas,
    halaqoh: halaqoh.map(function(h){ const t = target[normNama(h.nama)]; return {nama: h.nama, pengampu: h.pengampu, waktu: h.waktu, targetAktif: !!(t && t.aktif)}; })};
}

// p: {mode:'santri'|'halaqoh'|'kelas', nisn, halaqoh, kelas, tahunAjaranId, oleh}
function apiGetRekapHafalanBulanan(p) {
  const mode = norm(p.mode) || 'santri';
  const sem = infoSemesterHafalan_(p.tahunAjaranId);
  const ss = getSSTarget(sem.id || p.tahunAjaranId);
  const ak = aksesRekapHafalan_(p.oleh, ss);
  const d = dataSantriSemesterHafalan_(ss);
  const bolehHalaqoh = function(h){ return ak.semua || ak.halaqoh.some(function(x){ return normNama(x) === normNama(h); }); };
  const bolehKelas = function(k){ return ak.semua || ak.kelas.some(function(x){ return normNama(x) === normNama(k); }); };

  // 1. Santri yang dilaporkan
  let daftar = [];
  if (mode === 'halaqoh') {
    if (!norm(p.halaqoh)) return {ok:false, error:'Pilih halaqoh dulu.'};
    if (!bolehHalaqoh(p.halaqoh)) return {ok:false, error:'Anda tidak memiliki akses ke halaqoh ini.'};
    daftar = Object.keys(d.santri).map(function(n){ return d.santri[n]; }).filter(function(s){ return s.halaqoh.some(function(h){ return normNama(h) === normNama(p.halaqoh); }); });
  } else if (mode === 'kelas') {
    if (!norm(p.kelas)) return {ok:false, error:'Pilih kelas dulu.'};
    if (!bolehKelas(p.kelas)) return {ok:false, error:'Anda tidak memiliki akses ke kelas ini.'};
    daftar = Object.keys(d.santri).map(function(n){ return d.santri[n]; }).filter(function(s){ return normNama(s.kelas) === normNama(p.kelas); });
  } else {
    const nisn = norm(p.nisn);
    if (!nisn) return {ok:false, error:'Pilih santri dulu.'};
    const s = d.santri[nisn] || {nisn: nisn, nama: '', kelas: '', halaqoh: []};
    const boleh = ak.semua || ak.nisnAnak.indexOf(nisn) !== -1 || s.halaqoh.some(bolehHalaqoh) || (s.kelas && ak.kelas.some(function(x){ return normNama(x) === normNama(s.kelas); }));
    if (!boleh) return {ok:false, error:'Anda tidak memiliki akses ke rekap santri ini.'};
    daftar = [s];
  }
  daftar.sort(function(a,b){ return String(a.nama).localeCompare(String(b.nama)); });
  const setNisn = {}; daftar.forEach(function(s){ setNisn[s.nisn] = true; });

  // 2. Catatan semester yang dilaporkan
  const catatan = bacaHafalanRingkas_(ss);
  let tglMin = '', tglMax = '';
  catatan.forEach(function(r){ if (!tglMin || r.tgl < tglMin) tglMin = r.tgl; if (!tglMax || r.tgl > tglMax) tglMax = r.tgl; });
  const bulanList = [];
  if (tglMin) {
    let y = Number(tglMin.slice(0,4)), m = Number(tglMin.slice(5,7));
    const yA = Number(tglMax.slice(0,4)), mA = Number(tglMax.slice(5,7));
    while (y < yA || (y === yA && m <= mA)) {
      bulanList.push({kunci: y + '-' + (m < 10 ? '0' : '') + m, label: NAMA_BULAN_ID_[m - 1], labelPanjang: NAMA_BULAN_ID_[m - 1] + ' ' + y});
      m++; if (m > 12) { m = 1; y++; }
      if (bulanList.length > 24) break;
    }
  }
  const perSantri = {};
  daftar.forEach(function(s){ perSantri[s.nisn] = {sabaq: {}, murojaah: {}, tanpaHalaman: {}, terhafal: [], namaCatatan: ''}; });
  catatan.sort(function(a,b){ return a.tgl < b.tgl ? -1 : a.tgl > b.tgl ? 1 : 0; });
  catatan.forEach(function(r){
    const st = perSantri[r.nisn]; if (!st) return;
    if (!st.namaCatatan && r.nama) st.namaCatatan = r.nama;
    const kb = r.tgl.slice(0,7);
    if (r.jenis === 'Sabaq') {
      const hal = halamanCatatanHafalan_(r.surah, r.ayat, r.juz, r.halamanKe);
      if (!hal.length) { st.tanpaHalaman[kb] = (st.tanpaHalaman[kb] || 0) + 1; return; }
      (st.sabaq[kb] = st.sabaq[kb] || []).push(hal);
      st.terhafal.push({kb: kb, hal: hal});
    } else if (JENIS_HAFALAN_MUROJAAH_.indexOf(r.jenis) !== -1) {
      st.murojaah[kb] = true;
      const hal = halamanCatatanHafalan_(r.surah, r.ayat, r.juz, r.halamanKe);
      if (hal.length) st.terhafal.push({kb: kb, hal: hal});
    }
  });

  // 3. Hafalan dari semester-semester SEBELUMNYA (untuk Jumlah Hafalan)
  const sebelumnya = {}; // nisn -> {halaman:1}
  daftar.forEach(function(s){ sebelumnya[s.nisn] = {}; });
  const idSekarang = norm(ss.getId());
  for (let i = 0; i < sem.list.length && (sem.idx === -1 || i < sem.idx); i++) {
    const id = norm(sem.list[i].id);
    if (!id || id === idSekarang) continue;
    const peta = halamanTerhafalSemester_(id);
    Object.keys(setNisn).forEach(function(n){ (peta[n] || []).forEach(function(h){ sebelumnya[n][h] = 1; }); });
  }

  // 4. Susun laporan
  const target = bacaTargetHafalan_(ss);
  const hasil = daftar.map(function(s){
    const st = perSantri[s.nisn];
    const halaqohUtama = s.halaqoh[0] || '';
    const cfg = target[normNama(halaqohUtama)] || null;
    const sudah = {}; Object.keys(sebelumnya[s.nisn]).forEach(function(h){ sudah[h] = 1; });
    const baru = {}; // halaman sabaq yang sudah dihitung di semester ini
    let totalSemester = 0;
    const bulan = bulanList.map(function(b){
      let hBaru = 0;
      (st.sabaq[b.kunci] || []).forEach(function(hal){ hal.forEach(function(h){ if (!baru[h]) { baru[h] = 1; hBaru++; } }); });
      totalSemester += hBaru;
      // kumpulan hafalan s.d. akhir bulan ini
      st.terhafal.forEach(function(x){ if (x.kb === b.kunci) x.hal.forEach(function(h){ sudah[h] = 1; }); });
      const status = hBaru ? 'setor' : (st.murojaah[b.kunci] ? 'murojaah' : 'kosong');
      const tg = targetBulanHafalan_(cfg, b.kunci);
      let tercapai = null;
      if (tg) tercapai = tg.murojaah ? (status !== 'kosong') : hBaru >= tg.halaman;
      return {kunci: b.kunci, label: b.label, labelPanjang: b.labelPanjang, halaman: hBaru,
        teks: hBaru ? teksLembar_(hBaru) : (status === 'murojaah' ? 'Murojaah' : '–'), status: status,
        sabaqTanpaHalaman: st.tanpaHalaman[b.kunci] || 0,
        target: tg, tercapai: tercapai, jumlah: ringkasJumlahHafalan_(sudah).teks};
    });
    // catatan di luar rentang bulan (tidak mungkin, tapi jaga-jaga) tetap masuk jumlah akhir
    st.terhafal.forEach(function(x){ x.hal.forEach(function(h){ sudah[h] = 1; }); });
    const jumlah = ringkasJumlahHafalan_(sudah);
    return {nisn: s.nisn, nama: s.nama || st.namaCatatan, kelas: s.kelas, halaqoh: s.halaqoh.join(', '),
      pengampu: d.pengampuHalaqoh[halaqohUtama] || '', bulan: bulan,
      jumlah: jumlah.teks, juzSelesai: jumlah.juzSelesai, totalSemester: totalSemester, totalSemesterTeks: teksLembar_(totalSemester) || '–',
      targetAktif: !!(cfg && cfg.aktif)};
  });
  return {ok: true, semester: sem.nama, bulanList: bulanList, santri: hasil,
    jumlahSemesterDibaca: sem.idx > -1 ? sem.idx + 1 : 1};
}

function apiGetTargetHafalan(p) {
  const ss = getSSTarget(p.tahunAjaranId);
  const cfg = bacaTargetHafalan_(ss)[normNama(norm(p.halaqoh))] || null;
  return {ok: true, data: cfg || {halaqoh: norm(p.halaqoh), aktif: false, targetHalaman: 0, khusus: {}}};
}
// Target hanya untuk semester AKTIF (pengampu menetapkan target tiap semester)
function apiSimpanTargetHafalan(p) {
  const halaqoh = norm(p.halaqoh);
  if (!halaqoh) return {ok:false, error:'Halaqoh wajib dipilih.'};
  const ss = getAktifSS();
  const ak = aksesRekapHafalan_(p.oleh, ss);
  if (!ak.semua && !ak.halaqoh.some(function(x){ return normNama(x) === normNama(halaqoh); }))
    return {ok:false, error:'Hanya pengampu halaqoh ini atau Admin/Mudir yang bisa mengatur targetnya.'};
  const targetHalaman = Math.max(0, Math.round(Number(p.targetHalaman) || 0));
  const khusus = {};
  Object.keys(p.khusus || {}).forEach(function(k){
    if (!/^\d{4}-\d{2}$/.test(k)) return;
    const v = p.khusus[k];
    if (v === 'M' || v === 'm') khusus[k] = 'M';
    else if (v !== '' && v != null && !isNaN(Number(v)) && Number(v) >= 0) khusus[k] = Math.round(Number(v));
  });
  const aktif = p.aktif === true || p.aktif === 'true';
  if (aktif && !targetHalaman && !Object.keys(khusus).length) return {ok:false, error:'Isi target per bulan (minimal 1 halaman) atau target khusus bulan tertentu.'};
  let sh = ss.getSheetByName(SHEET_TARGET_HAFALAN);
  if (!sh) { sh = ss.insertSheet(SHEET_TARGET_HAFALAN); sh.appendRow(HEADER_TARGET_HAFALAN_); sh.setFrozenRows(1); }
  const baris = [halaqoh, aktif, targetHalaman, JSON.stringify(khusus), norm(p.oleh), new Date()];
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (normNama(norm(rows[i][0])) === normNama(halaqoh)) { sh.getRange(i + 1, 1, 1, baris.length).setValues([baris]); return {ok:true}; }
  }
  sh.appendRow(baris);
  return {ok:true};
}
// ======================================================================
// KEAMANAN SERVER (jalur WASIAT utama)
//
// Sebelumnya server menjalankan aksi apa pun yang dikirim ke alamat Web App, tanpa
// memeriksa siapa pengirimnya. Siapa pun yang mengetahui alamat itu dapat, misalnya,
// menghapus transaksi kas atau membaca PIN akun.
//
// Sekarang aksi-aksi PENTING wajib membawa token sesi (diberikan saat login, sama
// dengan token Persuratan/Keuangan, berlaku 14 hari dan diperbarui otomatis setiap
// aplikasi dibuka saat online). Aksi yang dipakai harian (absensi, hafalan, nilai,
// jurnal, kasir kantin, halaman depan) TIDAK diubah sama sekali, supaya tetap cepat
// dan antrian offline tetap aman.
//
// Hasil pemeriksaan token disimpan di cache 10 menit, sehingga tidak menambah
// pembacaan sheet di setiap permintaan.
// ======================================================================
var AMAN_ = (function () {
  const ADM = ['Admin', 'Mudir'];
  const KEU = ['Admin', 'Mudir', 'Bendahara'];
  const LOGIN = '*';

  /** Aksi -> peran yang boleh. LOGIN = akun apa pun yang sudah masuk. */
  const ATURAN = {};
  function atur(peran, daftar) { daftar.split(/\s+/).filter(Boolean).forEach(function (a) { ATURAN[a] = peran; }); }

  // Hanya Admin / Mudir: semester, pengaturan, akun, data master, data santri inti
  atur(ADM, 'createTahunAjaran setTahunAjaranAktif migrasiSkemaLama simpanPengaturan simpanPengaturanBatch ' +
    'pasangTriggerNotif kirimPushManual kirimWATes cekStatusWablas getInfoPengaturanWA ' +
    'getDaftarSpreadsheet getDiagnostikUkuranData saveMasterRow deleteMasterRow importSantriMassal tambahSantriManual ' +
    'gantiNisn prosesMutasiSantri batalkanMutasi ubahCatatanMutasi resetSemuaPoinSantri ' +
    'perbaikiKategoriTransaksi saveSlide deleteSlide saveArtikel deleteArtikel saveFiturBeranda deleteFiturBeranda getLogAktivitas');

  // Keuangan & saldo: Bendahara, Admin, Mudir
  atur(KEU, 'tambahSaldoSantriManual tarikSaldoSantriBendahara setBiayaAdminTopup getRekapPendapatanPondok ' +
    'getRiwayatMutasiSaldoAdmin getKasUmumList tambahTransaksiKas hapusTransaksiKas saveKategoriKas deleteKategoriKas ' +
    'saveAnggaran deleteAnggaran saveTarif deleteTarif getLaporanBulanan getBKUBulanan kirimTagihanSppSatuSantri ' +
    'kirimTagihanSppMassal tarikSaldoPemilikManual getDaftarSaldoPemilik setLimitHarianAdmin setBiayaSpp setBebasSpp ' +
    'toggleSppBulan importSpp getSemuaPengajuanTarik getSemuaPengajuanTopUp setujuiPenarikan tolakPenarikan ' +
    'setujuiTopUp tolakTopUp saveBarang deleteBarang siapkanKolomNamaSpp');

  // Cukup sudah masuk (akun apa pun): data pribadi, perubahan & penghapusan data
  atur(LOGIN, 'getMasterData getSemuaSantri deleteAbsensi deleteHafalan deleteNilai resetPoinSatuSantri ' +
    'buatRombelBaru hapusRombel editWaliKelas tambahSantriKeRombel pindahSantriRombel hapusSantriDariRombel ' +
    'buatHalaqohBaru editHalaqoh hapusHalaqoh tambahSantriKeHalaqoh pindahSantriHalaqoh hapusSantriDariHalaqoh ' +
    'ubahIdentitasSantri ubahProfilGuru gantiPinTransaksiSantri setLimitHarianSantri terbitkanSP batalkanSP ' +
    'prosesIzinGuru simpanLiburPondok hapusLiburPondok saveMasterPelPrestasi deleteMasterPelPrestasi ' +
    'buatPelanggaranSSBaru setPelanggaranSSAktif hapusKasKelas saveSOP deleteSOP tambahPenggantian hapusPenggantian ' +
    'getDashboardKeuangan getTunggakanSantri getSppList getRekapSPPBendahara uploadFileKeDrive getDashboardAdmin ' +
    'getRaporSantriLengkap getSaldoSantri getAllTransaksiSantri getRiwayatMutasiSaldoSantri kirimPushUji');

  const PENGATURAN_BERSAMA = ['BatasBeruntunHari'];

  // Wali santri hanya boleh untuk anaknya sendiri
  const MILIK_ANAK = { gantiPinTransaksiSantri: 'nisn', setLimitHarianSantri: 'nisn', getSaldoSantri: 'nisn',
    getAllTransaksiSantri: 'nisn', getRiwayatMutasiSaldoSantri: 'nisn' };

  function hash_(s) {
    return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s))).slice(0, 40);
  }

  /** Identitas pemilik token ({nama, roles, terkait}) atau null. Hasil diingat 10 menit. */
  function identitas(token) {
    token = String(token || '');
    if (token.length < 20 || typeof SURAT_ === 'undefined') return null;
    const ck = 'aman_' + hash_(token);
    let cache = null;
    try { cache = CacheService.getScriptCache(); } catch (e) { }
    if (cache) {
      try { const ada = cache.get(ck); if (ada) return ada === '-' ? null : JSON.parse(ada); } catch (e) { }
    }
    let me = null;
    try { me = SURAT_.identitasToken(token); } catch (e) { me = null; }
    const out = me ? { nama: me.nama, roles: me.roles || [], terkait: (me.terkait || []).map(String) } : null;
    if (cache) { try { cache.put(ck, out ? JSON.stringify(out) : '-', 600); } catch (e) { } }
    return out;
  }

  function punya_(me, daftar) { return me.roles.some(function (r) { return daftar.indexOf(r) >= 0; }); }
  function hanyaWali_(me) { return me.roles.length > 0 && me.roles.every(function (r) { return r === 'WaliSantri'; }); }

  const PESAN_LOGIN = 'Demi keamanan data, silakan keluar lalu masuk kembali ke WASIAT (sesi Anda belum memakai pengaman terbaru atau sudah berakhir).';

  /** null = boleh lanjut; selain itu objek jawaban penolakan. */
  function periksa(action, p, token) {
    let aturan = ATURAN[action];
    // Sheet akun berisi PIN: hanya Admin/Mudir
    if (action === 'getMasterData' && String(p && p.sheet) === 'RoleAkses') aturan = ADM;
    // Pengaturan bersama yang memang diubah Pembina/Kabag dari widget mereka
    if (action === 'simpanPengaturan' && PENGATURAN_BERSAMA.indexOf(String(p && p.key)) >= 0) aturan = LOGIN;
    if (!aturan) return null;
    const me = identitas(token);
    if (!me) return { ok: false, perluLogin: true, error: PESAN_LOGIN };
    if (aturan !== LOGIN && !punya_(me, aturan)) {
      return { ok: false, error: 'Akun Anda (' + me.roles.join(', ') + ') tidak berhak menjalankan aksi ini.' };
    }
    const kolom = MILIK_ANAK[action];
    if (kolom && hanyaWali_(me)) {
      const nisn = String((p && p[kolom]) || '').replace(/^'/, '').trim();
      if (nisn && me.terkait.indexOf(nisn) === -1) return { ok: false, error: 'Data santri ini bukan milik akun Anda.' };
    }
    return null;
  }

  /** Kolom PIN santri tidak pernah dikirim lewat getMasterData. */
  function saringMaster(sheet, hasil) {
    if (String(sheet) !== 'Santri' || !hasil || !hasil.ok || !hasil.data || !hasil.data.header) return hasil;
    const buang = hasil.data.header.filter(function (h) { return /pin/i.test(String(h)); });
    if (!buang.length) return hasil;
    hasil.data.header = hasil.data.header.filter(function (h) { return buang.indexOf(h) === -1; });
    hasil.data.data.forEach(function (r) { buang.forEach(function (h) { delete r[h]; }); });
    return hasil;
  }

  /** Batas percobaan login salah: 5 kali per nama/no WA, lalu tunggu 10 menit. */
  function cekGagalLogin(loginId) {
    try { return Number(CacheService.getScriptCache().get('login_gagal_' + hash_(String(loginId).toLowerCase())) || 0) >= 5; } catch (e) { return false; }
  }
  function catatGagalLogin(loginId, berhasil) {
    try {
      const c = CacheService.getScriptCache(), k = 'login_gagal_' + hash_(String(loginId).toLowerCase());
      if (berhasil) c.remove(k); else c.put(k, String(Number(c.get(k) || 0) + 1), 600);
    } catch (e) { }
  }


  /* ================================================================
   *  CATATAN AKTIVITAS (audit log)
   *  Mencatat SIAPA mengubah APA untuk aksi penting (keuangan, saldo, akun, data
   *  santri, pengaturan, penghapusan data). Aksi baca dan aksi harian (absensi,
   *  hafalan, nilai baru, kasir) tidak dicatat, supaya tidak menambah beban.
   *  Satu baris per aksi di sheet "LogAktivitas" (spreadsheet Master), otomatis
   *  dirapikan bila melebihi 20.000 baris.
   * ================================================================ */
  const SH_LOG = 'LogAktivitas';
  const HEAD_LOG = ['Waktu', 'Nama', 'Peran', 'Modul', 'Aksi', 'Keterangan', 'Rincian'];
  const BATAS_LOG = 20000;
  const LABEL = {
    tambahTransaksiKas: 'Catat transaksi kas', hapusTransaksiKas: 'Hapus transaksi kas', tambahSaldoSantriManual: 'Tambah saldo santri',
    tarikSaldoSantriBendahara: 'Tarik saldo santri', tarikSaldoPemilikManual: 'Tarik saldo pemilik barang', setujuiTopUp: 'Setujui top-up',
    tolakTopUp: 'Tolak top-up', setujuiPenarikan: 'Setujui penarikan', tolakPenarikan: 'Tolak penarikan', setBiayaSpp: 'Atur biaya SPP',
    setBebasSpp: 'Atur bebas SPP', toggleSppBulan: 'Ubah status bulan SPP', importSpp: 'Impor SPP', setBiayaAdminTopup: 'Atur biaya admin top-up',
    saveKategoriKas: 'Simpan kategori kas', deleteKategoriKas: 'Hapus kategori kas', saveAnggaran: 'Simpan anggaran', deleteAnggaran: 'Hapus anggaran',
    saveTarif: 'Simpan tarif', deleteTarif: 'Hapus tarif', saveMasterRow: 'Ubah data master', deleteMasterRow: 'Hapus data master',
    simpanPengaturan: 'Ubah pengaturan', simpanPengaturanBatch: 'Ubah pengaturan', createTahunAjaran: 'Buat semester', setTahunAjaranAktif: 'Ganti semester aktif',
    tambahSantriManual: 'Tambah santri', importSantriMassal: 'Impor santri', ubahIdentitasSantri: 'Ubah identitas santri', gantiNisn: 'Ganti NISN',
    prosesMutasiSantri: 'Mutasi santri', batalkanMutasi: 'Batalkan mutasi', deleteAbsensi: 'Hapus absensi', deleteHafalan: 'Hapus hafalan', deleteNilai: 'Hapus nilai',
    resetPoinSatuSantri: 'Reset poin santri', resetSemuaPoinSantri: 'Reset semua poin', gantiPinTransaksiSantri: 'Ganti PIN kantin santri',
    setLimitHarianSantri: 'Atur limit jajan', setLimitHarianAdmin: 'Atur limit jajan', hapusRombel: 'Hapus rombel', hapusHalaqoh: 'Hapus halaqoh',
    terbitkanSP: 'Terbitkan SP guru', batalkanSP: 'Batalkan SP guru', kirimPushManual: 'Kirim notifikasi massal',
    terimaPembayaran: 'Terima pembayaran', terbitkanKwitansiKas: 'Terbitkan kwitansi', batalKwitansi: 'Batalkan kwitansi', kirimKwitansi: 'Kirim kwitansi',
    ajukanDana: 'Ajukan dana', putuskanPengajuan: 'Putuskan pengajuan dana', batalPengajuan: 'Batalkan pengajuan dana', ajukanTutupBuku: 'Tutup buku',
    kembalikanTutupBuku: 'Buka/kembalikan tutup buku', sahkanTutupBuku: 'Sahkan laporan keuangan', kirimTagihan: 'Kirim tagihan SPP', kirimTagihanMassal: 'Kirim tagihan massal',
    kirimKonfirmasi: 'Kirim konfirmasi transfer', terimaKonfirmasi: 'Terima konfirmasi transfer', tolakKonfirmasi: 'Tolak konfirmasi transfer',
    batalKonfirmasi: 'Batalkan konfirmasi transfer', simpanRekening: 'Ubah rekening pondok',
    simpanJadwal: 'Ubah jadwal otomatis', terbitkanRapor: 'Terbitkan rapor resmi', batalRapor: 'Batalkan rapor resmi',
    ppdbProses: 'Proses pendaftar PPDB', ppdbJadikanSantri: 'Masukkan pendaftar ke Data Santri', ppdbAtur: 'Ubah pengaturan PPDB'
  };
  const KEU_TULIS = ['terimaPembayaran', 'terbitkanKwitansiKas', 'batalKwitansi', 'kirimKwitansi', 'ajukanDana', 'putuskanPengajuan', 'batalPengajuan',
    'ajukanTutupBuku', 'kembalikanTutupBuku', 'sahkanTutupBuku', 'kirimTagihan', 'kirimTagihanMassal', 'kirimKonfirmasi', 'terimaKonfirmasi',
    'tolakKonfirmasi', 'batalKonfirmasi', 'simpanRekening'];
  const PRM_TULIS = ['simpanJadwal', 'terbitkanRapor', 'batalRapor', 'ppdbProses', 'ppdbJadikanSantri', 'ppdbAtur'];
  function aksiBaca_(a) { return /^(get|cek|status|list|info|file|bukti|peta|log|ringkas|kop|data|verifikasi|uji|diagnos)/i.test(a); }
  function perluDicatat(modul, action) {
    if (modul === 'keuangan') return KEU_TULIS.indexOf(action) >= 0;
    if (modul === 'premium') return PRM_TULIS.indexOf(action) >= 0;
    if (modul) return false;
    return !!ATURAN[action] && !aksiBaca_(action);
  }
  /** Rincian ringkas: tanpa berkas/HTML, PIN disamarkan, maks 400 karakter. */
  function rincian_(p) {
    const o = {};
    Object.keys(p || {}).forEach(function (k) {
      if (k.charAt(0) === '_' || /^(html|bukti|nota|base64|data64|foto|gambar|file)$/i.test(k)) return;
      let v = p[k];
      if (/pin|token|password|sandi/i.test(k)) v = '***';
      else if (v && typeof v === 'object') { try { v = JSON.stringify(v).slice(0, 160); } catch (e) { v = '[data]'; } }
      else v = String(v).slice(0, 120);
      o[k] = v;
    });
    let t = ''; try { t = JSON.stringify(o); } catch (e) { }
    return t.length > 400 ? t.slice(0, 397) + '...' : t;
  }
  function keterangan_(action, p, hasil) {
    const b = [];
    if (p.nisn) b.push('NISN ' + p.nisn);
    if (p.noRef) b.push(p.noRef);
    if (p.nominal) b.push('Rp' + (Number(p.nominal) || 0).toLocaleString('id-ID'));
    if (p.uraian) b.push(String(p.uraian).slice(0, 60));
    if (p.sheet) b.push('sheet ' + p.sheet);
    if (p.alasan) b.push('alasan: ' + String(p.alasan).slice(0, 60));
    const d = hasil && hasil.data;
    if (d && d.kwitansi && d.kwitansi.nomor) b.push(d.kwitansi.nomor);
    if (d && d.nomor) b.push(d.nomor);
    return b.join(' · ');
  }
  function shLog_() {
    const ss = getMasterSS();
    let sh = ss.getSheetByName(SH_LOG);
    if (!sh) { sh = ss.insertSheet(SH_LOG); sh.getRange(1, 1, 1, HEAD_LOG.length).setValues([HEAD_LOG]); sh.setFrozenRows(1); }
    return sh;
  }
  /** Dipanggil setelah aksi BERHASIL. Tidak pernah menggagalkan aksi. */
  function catat(modul, action, p, token, hasil) {
    try {
      if (!hasil || hasil.ok === false || !perluDicatat(modul, action)) return;
      const me = identitas(token) || { nama: String((p && (p.oleh || p.dicatatOleh || p.disetujuiOleh)) || '(tanpa sesi)'), roles: [] };
      const sh = shLog_();
      sh.appendRow([Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'), me.nama, me.roles.join(','),
        modul || 'wasiat', LABEL[action] || action, keterangan_(action, p || {}, hasil), rincian_(p)]);
      const n = sh.getLastRow();
      if (n > BATAS_LOG + 1) sh.deleteRows(2, n - 1 - BATAS_LOG + 2000);
    } catch (e) { try { Logger.log('Gagal catat aktivitas: ' + e.message); } catch (e2) { } }
  }
  function apiLogAktivitas(p) {
    const sh = getMasterSS().getSheetByName(SH_LOG);
    if (!sh || sh.getLastRow() < 2) return { ok: true, data: [], total: 0 };
    const n = sh.getLastRow() - 1;
    const ambil = Math.min(n, 3000);
    const v = sh.getRange(n - ambil + 2, 1, ambil, HEAD_LOG.length).getValues();
    const q = String(p.q || '').toLowerCase(), dari = String(p.dari || ''), sampai = String(p.sampai || '');
    const out = [];
    for (let i = v.length - 1; i >= 0 && out.length < 300; i--) {
      const r = v[i];
      const w = r[0] instanceof Date ? Utilities.formatDate(r[0], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss') : String(r[0]);
      if (dari && w.slice(0, 10) < dari) continue;
      if (sampai && w.slice(0, 10) > sampai) continue;
      if (q && [r[1], r[2], r[4], r[5]].join(' ').toLowerCase().indexOf(q) < 0) continue;
      out.push({ waktu: w, nama: String(r[1]), peran: String(r[2]), modul: String(r[3]), aksi: String(r[4]), ket: String(r[5]), rincian: String(r[6]) });
    }
    return { ok: true, data: out, total: n };
  }

  return { periksa: periksa, identitas: identitas, saringMaster: saringMaster, cekGagalLogin: cekGagalLogin,
    catatGagalLogin: catatGagalLogin, aturan: function () { return ATURAN; }, catat: catat, apiLogAktivitas: apiLogAktivitas,
    perluDicatat: perluDicatat };
})();


// ======================================================================
// KEUANGAN RESMI (Bendahara) -- kwitansi ber-QR, pengajuan dana dengan persetujuan
// Mudir, laporan bulanan resmi + tutup buku, dan tagihan SPP ke wali.
//
// Dibungkus dalam KEU_ (namespace sendiri) supaya tidak ada nama yang bertabrakan
// dengan fungsi WASIAT lain. Data baru disimpan di sheet BARU di spreadsheet Master
// (KwitansiResmi, PengajuanDana, TutupBuku, LogTagihan) dan berkas PDF di folder
// Drive "KEUANGAN - ..." -- sheet lama (KasUmum, SPP, dst.) tetap dipakai apa adanya:
// hanya DITAMBAH barisnya lewat jalur yang sama dengan menu Catat Transaksi.
//
// Setiap aksi wajib membawa token sesi WASIAT (tokenSurat yang sudah diberikan saat
// login), sehingga peran pengirim diperiksa di server -- bukan hanya di tampilan.
// Kunci yang dipakai kunci khusus keuangan, bukan kunci transaksi kantin, jadi kasir,
// absensi, dan hafalan tidak ikut menunggu saat PDF kwitansi/laporan dibuat.
// ======================================================================
var KEU_ = (function () {
  const SH_KWT = 'KwitansiResmi';
  const SH_PD = 'PengajuanDana';
  const SH_TB = 'TutupBuku';
  const SH_LOG = 'LogTagihan';
  const HEAD = {
    KwitansiResmi: ['ID', 'No Kwitansi', 'Tanggal', 'Diterima Dari', 'NISN', 'Untuk Pembayaran', 'Kategori', 'Nominal', 'Terbilang',
      'Metode', 'Diterima Oleh', 'Kode Verifikasi', 'File ID', 'Link PDF', 'Status', 'Ref Kas', 'Dibuat', 'Dibatalkan Pada', 'Alasan Batal', 'Dikirim'],
    PengajuanDana: ['ID', 'No Pengajuan', 'Tanggal', 'Diajukan Oleh', 'Uraian', 'Kategori', 'Anggaran ID', 'Nama Anggaran', 'Nominal', 'Rincian',
      'Nota File ID', 'Nota Link', 'Status', 'Diputus Oleh', 'Diputus Pada', 'Catatan Mudir', 'Ref Kas', 'Dibuat'],
    TutupBuku: ['Periode', 'Bulan', 'Tahun', 'Saldo Awal', 'Pemasukan', 'Pengeluaran', 'Saldo Akhir', 'Jumlah Transaksi', 'Status',
      'Diajukan Oleh', 'Diajukan Pada', 'Disahkan Oleh', 'Disahkan Pada', 'Catatan', 'Kode Verifikasi', 'File ID', 'Link PDF', 'Riwayat'],
    LogTagihan: ['Waktu', 'NISN', 'Nama', 'Total', 'Jumlah Bulan', 'Kanal', 'Oleh'],
  };
  const ST_PD = { MENUNGGU: 'Menunggu', SETUJU: 'Disetujui', TOLAK: 'Ditolak', BATAL: 'Dibatalkan' };
  const ST_TB = { MENUNGGU: 'Menunggu Pengesahan', SAH: 'Disahkan', KEMBALI: 'Dikembalikan', BUKA: 'Dibuka Kembali' };
  const TERKUNCI_TB = [ST_TB.MENUNGGU, ST_TB.SAH];
  const ROMAWI = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const PREFIX_BATAL = '[DIBATALKAN] ';

  /* ---------------- peran ---------------- */
  const PENGAJU_DANA = ['Bendahara', 'Admin', 'Mudir', 'Sekretaris', 'KabagPutra', 'KabagPutri', 'Kabag'];
  function punya_(me, list) { return me.roles.some(function (r) { return list.indexOf(r) >= 0; }); }
  const isBendahara_ = function (me) { return punya_(me, ['Bendahara', 'Admin', 'Mudir']); };   // boleh mengelola kas
  const isMudir_ = function (me) { return punya_(me, ['Mudir']); };
  const isStaf_ = function (me) { return punya_(me, ['Bendahara', 'Admin', 'Mudir']); };
  function wajib_(ok, pesan) { if (!ok) throw new Error(pesan || 'Akun Anda tidak memiliki akses untuk tindakan ini.'); }

  /* ---------------- util ---------------- */
  const tz_ = function () { return Session.getScriptTimeZone(); };
  const ymd_ = function (d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); };
  const stamp_ = function () { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'); };
  const uid_ = function () { return Utilities.getUuid().split('-')[0] + Date.now().toString(36); };
  const pad_ = function (n, d) { return String(n).padStart(d || 3, '0'); };
  function tgl_(s) {
    if (s instanceof Date) return s;
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Date();
  }
  function teksTgl_(v) { return v instanceof Date ? ymd_(v) : String(v || '').slice(0, 10); }
  function rupiah_(n) { return 'Rp' + (Number(n) || 0).toLocaleString('id-ID'); }
  function aman_(s) { return String(s == null ? '' : s).replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 140); }
  function kodeAcak_(awal) {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = awal;
    while (s.length < 10) s += A.charAt(Math.floor(Math.random() * A.length));
    return s;
  }
  function kodeBersih_(k) { return String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function terbilang(n) {
    n = Math.floor(Math.abs(Number(n) || 0));
    const s = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
    function t(x) {
      if (x < 12) return s[x];
      if (x < 20) return t(x - 10) + ' belas';
      if (x < 100) return t(Math.floor(x / 10)) + ' puluh' + (x % 10 ? ' ' + t(x % 10) : '');
      if (x < 200) return 'seratus' + (x - 100 ? ' ' + t(x - 100) : '');
      if (x < 1000) return t(Math.floor(x / 100)) + ' ratus' + (x % 100 ? ' ' + t(x % 100) : '');
      if (x < 2000) return 'seribu' + (x - 1000 ? ' ' + t(x - 1000) : '');
      if (x < 1e6) return t(Math.floor(x / 1000)) + ' ribu' + (x % 1000 ? ' ' + t(x % 1000) : '');
      if (x < 1e9) return t(Math.floor(x / 1e6)) + ' juta' + (x % 1e6 ? ' ' + t(x % 1e6) : '');
      if (x < 1e12) return t(Math.floor(x / 1e9)) + ' miliar' + (x % 1e9 ? ' ' + t(x % 1e9) : '');
      return t(Math.floor(x / 1e12)) + ' triliun' + (x % 1e12 ? ' ' + t(x % 1e12) : '');
    }
    const h = n === 0 ? 'nol' : t(n);
    return (h.charAt(0).toUpperCase() + h.slice(1) + ' rupiah').replace(/\s+/g, ' ');
  }

  /* ---------------- kunci khusus keuangan ---------------- */
  function kunci_() {
    let dipegang = false;
    function coba() {
      const l = LockService.getScriptLock();
      if (!l.tryLock(10000)) return false;
      try {
        const c = CacheService.getScriptCache();
        if (c.get('KEU_KUNCI')) return false;
        c.put('KEU_KUNCI', '1', 120);
        return true;
      } finally { l.releaseLock(); }
    }
    return {
      waitLock: function (ms) {
        const batas = Date.now() + (ms || 30000);
        while (!coba()) {
          if (Date.now() > batas) throw new Error('Keuangan sedang memproses transaksi lain. Coba lagi sebentar.');
          Utilities.sleep(400);
        }
        dipegang = true;
      },
      releaseLock: function () { if (dipegang) { try { CacheService.getScriptCache().remove('KEU_KUNCI'); } catch (e) { } dipegang = false; } },
    };
  }

  /* ---------------- sheet ---------------- */
  function sheet_(nama) {
    const ss = getMasterSS();
    let sh = ss.getSheetByName(nama);
    if (!sh) {
      sh = ss.insertSheet(nama);
      sh.getRange(1, 1, 1, HEAD[nama].length).setValues([HEAD[nama]]).setFontWeight('bold');
      sh.setFrozenRows(1);
      // NISN & nomor disimpan sebagai teks (angka nol di depan tidak hilang)
      ['NISN', 'No Kwitansi', 'No Pengajuan', 'Periode', 'Kode Verifikasi'].forEach(function (k) {
        const c = HEAD[nama].indexOf(k);
        if (c >= 0) { try { sh.getRange(1, c + 1, sh.getMaxRows(), 1).setNumberFormat('@'); } catch (e) { } }
      });
    }
    return sh;
  }
  function rows_(nama) {
    const ss = getMasterSS();
    const sh = ss.getSheetByName(nama);
    if (!sh || sh.getLastRow() < 2) return [];
    const h = HEAD[nama];
    return sh.getRange(2, 1, sh.getLastRow() - 1, h.length).getValues().map(function (r, i) {
      const o = { _row: i + 2 };
      h.forEach(function (k, j) { o[k] = r[j] instanceof Date ? (k === 'Tanggal' ? ymd_(r[j]) : Utilities.formatDate(r[j], tz_(), 'yyyy-MM-dd HH:mm:ss')) : r[j]; });
      return o;
    }).filter(function (o) { return o[h[0]] !== '' && o[h[0]] != null; });
  }
  function tulis_(nama, baris, obj) {
    const sh = sheet_(nama);
    const h = HEAD[nama];
    const nilai = h.map(function (k) { return obj[k] == null ? '' : obj[k]; });
    if (baris) sh.getRange(baris, 1, 1, h.length).setValues([nilai]);
    else sh.appendRow(nilai);
  }
  function ubah_(nama, r, perubahan) {
    const o = {}; HEAD[nama].forEach(function (k) { o[k] = k in perubahan ? perubahan[k] : r[k]; });
    tulis_(nama, r._row, o);
    return o;
  }

  /* ---------------- folder Drive ---------------- */
  function props_() { return PropertiesService.getScriptProperties(); }
  function root_() {
    const id = props_().getProperty('KEU_ROOT_ID');
    if (id) { try { return DriveApp.getFolderById(id); } catch (e) { } }
    const nama = 'KEUANGAN - ' + (getPengaturan().NamaPesantren || 'Pondok Pesantren').toUpperCase();
    const f = DriveApp.createFolder(nama);
    props_().setProperty('KEU_ROOT_ID', f.getId());
    return f;
  }
  function folder_(induk, nama) {
    const it = induk.getFoldersByName(nama);
    return it.hasNext() ? it.next() : induk.createFolder(nama);
  }
  function folderJalur_(bagian) { let f = root_(); bagian.forEach(function (b) { f = folder_(f, String(b)); }); return f; }
  function simpanPdf_(html, nama, jalur) {
    const pdf = Utilities.newBlob(String(html), 'text/html', nama + '.html').getAs('application/pdf').setName(nama + '.pdf');
    const file = folderJalur_(jalur).createFile(pdf);
    return { id: file.getId(), url: file.getUrl() };
  }
  function tandaiBatalFile_(fileId, batal) {
    if (!fileId) return;
    try {
      const f = DriveApp.getFileById(fileId);
      const nm = f.getName().replace(PREFIX_BATAL, '');
      f.setName((batal ? PREFIX_BATAL : '') + nm);
    } catch (e) { }
  }

  /* ---------------- tutup buku: bulan terkunci ---------------- */
  // Awalan 'LK-' supaya Google Sheets tidak mengubahnya menjadi tanggal.
  function periode_(bulan, tahun) { return 'LK-' + tahun + '-' + pad_(bulan, 2); }
  function ym_(bulan, tahun) { return tahun + '-' + pad_(bulan, 2); }
  function statusPeriode_(per) {
    const r = rows_(SH_TB).filter(function (x) { return String(x.Periode) === per; });
    return r.length ? r[r.length - 1] : null;
  }
  /** Periode terakhir yang bukunya ditutup (menunggu pengesahan / sudah disahkan), mis. 'LK-2026-10'.
   *  Menutup sebuah bulan berarti semua bulan SEBELUMNYA ikut terkunci, supaya saldo awal
   *  laporan yang sudah disahkan tidak bisa berubah diam-diam. */
  function batasTutup_() {
    const terakhir = {};
    rows_(SH_TB).forEach(function (r) { terakhir[String(r.Periode)] = String(r.Status); });
    let maks = '';
    Object.keys(terakhir).forEach(function (k) { if (TERKUNCI_TB.indexOf(terakhir[k]) >= 0 && k > maks) maks = k; });
    return maks;
  }
  function teksPeriode_(per) { const m = String(per).match(/^LK-(\d{4})-(\d{2})$/); return m ? BULAN[Number(m[2]) - 1] + ' ' + m[1] : per; }
  /** Dipakai juga oleh menu Catat Transaksi: true bila bulan tanggal ini sudah termasuk buku yang ditutup. */
  function bulanTerkunci(tanggal) {
    try {
      const d = tgl_(tanggal);
      const batas = batasTutup_();
      return !!batas && periode_(d.getMonth() + 1, d.getFullYear()) <= batas;
    } catch (e) { return false; }
  }
  function cekTerkunci_(tanggal) {
    if (bulanTerkunci(tanggal)) {
      throw new Error('Buku kas sudah ditutup sampai ' + teksPeriode_(batasTutup_()) + '. Transaksi pada bulan tersebut atau sebelumnya tidak dapat diubah; minta Mudir membuka kembali bila perlu koreksi.');
    }
  }

  /* ---------------- uang titipan santri BUKAN kas pondok ----------------
   * Saldo kantin / uang belanja santri adalah titipan wali: disimpan di saldo santri
   * (menu Kantin), tidak boleh dicatat sebagai pemasukan/pengeluaran kas pondok.
   * Yang masuk kas hanya keuntungan pondok (potongan barang & biaya admin top-up),
   * dan itu dicatat otomatis oleh sistem kantin. */
  const POLA_TITIPAN = /(top[\s-]*up|isi[\s-]*saldo|saldo[\s-]*(kantin|santri|belanja|jajan)|uang[\s-]*(saku|jajan|belanja|titipan)|titipan[\s-]*santri|tabungan[\s-]*santri|tarik[\s-]*(saldo|tunai))/i;
  const POLA_UNTUNG = /(biaya[\s-]*admin|potongan|keuntungan|laba|margin|komisi|bagi[\s-]*hasil)/i;
  const PESAN_TITIPAN = 'Uang belanja / saldo kantin santri adalah dana TITIPAN wali, bukan kas pondok, jadi tidak dicatat di Buku Kas Umum. ' +
    'Top-up dan penarikan saldo santri dilakukan di menu Kantin (Top Up / Tarik Saldo). Yang masuk kas pondok hanya keuntungannya ' +
    '(potongan barang & biaya admin top-up), dan itu sudah tercatat otomatis sebagai "Pendapatan Kantin".';
  function uangTitipanSantri(kategori, uraian) {
    const t = norm(kategori) + ' ' + norm(uraian);
    return POLA_TITIPAN.test(t) && !POLA_UNTUNG.test(t);
  }
  function pesanTitipan() { return PESAN_TITIPAN; }
  function cekTitipan_(kategori, uraian) { if (uangTitipanSantri(kategori, uraian)) throw new Error(PESAN_TITIPAN); }
  /** Baris BKU yang tampak seperti uang titipan santri (catatan otomatis kantin dikecualikan). */
  function barisTitipan_(baris) {
    return baris.filter(function (t) {
      if (/^KANTIN-/.test(String(t.noRef)) || norm(t.dicatatOleh) === 'Sistem Kantin') return false;
      return uangTitipanSantri(t.kategori, t.uraian);
    }).map(function (t) { return { noRef: t.noRef, tanggal: t.tanggal, jenis: t.jenis, kategori: t.kategori, uraian: t.uraian, nominal: t.nominal }; });
  }

  /* ---------------- buku kas umum (tambah baris) ---------------- */
  function noRefBaru_(sh, tanggal) {
    const awal = 'REF-' + tanggal.substring(0, 7).replace('-', '') + '-';
    let max = sh.getLastRow();
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
        const m = String(r[0]).match(/-(\d+)$/); if (m && Number(m[1]) > max) max = Number(m[1]);
      });
    }
    return awal + pad_(max + 1, 4);
  }
  function tambahKas_(o) {
    const sh = getMasterSS().getSheetByName(SHEET_KAS_UMUM);
    if (!sh) throw new Error('Sheet Buku Kas Umum belum ada. Jalankan Migrasi Skema di menu Admin.');
    const noRef = noRefBaru_(sh, o.tanggal);
    sh.appendRow([noRef, tgl_(o.tanggal), o.jenis, o.kategori, o.uraian, Number(o.nominal) || 0, o.dicatatOleh, o.noKwitansi || '', o.kelas || '']);
    return noRef;
  }
  function cariKas_(noRef) {
    const sh = getMasterSS().getSheetByName(SHEET_KAS_UMUM);
    if (!sh || sh.getLastRow() < 2) return null;
    const v = sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues();
    for (let i = 0; i < v.length; i++) if (String(v[i][0]) === String(noRef)) return { row: i + 2, v: v[i], sh: sh };
    return null;
  }

  /* ---------------- data santri & akun ---------------- */
  function santri_(nisn) {
    nisn = norm(nisn);
    if (!nisn) return null;
    const rows = getAktifSS().getSheetByName(SHEET_SANTRI).getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) if (norm(rows[i][0]) === nisn) return { nisn: nisn, nama: norm(rows[i][1]), tahunMasuk: rows[i][2], noWa: norm(rows[i][4]) };
    return null;
  }
  function akunPeran_(peran) {
    const sh = getAktifSS().getSheetByName(SHEET_ROLE);
    if (!sh) return [];
    return sh.getDataRange().getValues().slice(1).filter(function (r) {
      return norm(r[0]) && norm(r[3]).split(',').map(function (s) { return s.trim(); }).indexOf(peran) >= 0;
    }).map(function (r) { return { nama: norm(r[0]), noWa: norm(r[1]) }; });
  }
  function kabarStaf_(peran, judul, isi, kategoriWa) {
    const akun = akunPeran_(peran);
    if (!akun.length) return;
    try { kirimPushOneSignal(akun.map(function (a) { return a.nama; }), judul, isi, '', { jenis: 'keuangan' }); } catch (e) { }
    if (kategoriWa) akun.forEach(function (a) { if (a.noWa) { try { kirimWAKategori_(kategoriWa, a.noWa, '*' + judul + '*\n\n' + isi); } catch (e) { } } });
  }
  function kabarNama_(nama, judul, isi, kategoriWa) {
    if (!nama) return;
    try { kirimPushOneSignal([nama], judul, isi, '', { jenis: 'keuangan' }); } catch (e) { }
    if (!kategoriWa) return;
    const sh = getAktifSS().getSheetByName(SHEET_ROLE);
    if (!sh) return;
    const r = sh.getDataRange().getValues().slice(1).find(function (x) { return normNama(x[0]) === normNama(nama); });
    if (r && norm(r[1])) { try { kirimWAKategori_(kategoriWa, norm(r[1]), '*' + judul + '*\n\n' + isi); } catch (e) { } }
  }

  /* ================================================================
   *  KWITANSI RESMI
   * ================================================================ */
  function noKwitansiBaru_(tahun, bulan) {
    let max = 0;
    rows_(SH_KWT).forEach(function (r) {
      if (String(r.Tanggal).slice(0, 4) !== String(tahun)) return;
      const m = String(r['No Kwitansi']).match(/^(\d+)/); if (m && Number(m[1]) > max) max = Number(m[1]);
    });
    return pad_(max + 1, 3) + '/KWT/PPS-WU/' + ROMAWI[bulan - 1] + '/' + tahun;
  }
  function kodeUnik_(awal, kode) {
    kode = kodeBersih_(kode);
    const ada = {};
    rows_(SH_KWT).forEach(function (r) { ada[kodeBersih_(r['Kode Verifikasi'])] = 1; });
    rows_(SH_TB).forEach(function (r) { ada[kodeBersih_(r['Kode Verifikasi'])] = 1; });
    if (kode.length !== 10 || kode.charAt(0) !== awal || ada[kode]) {
      do { kode = kodeAcak_(awal); } while (ada[kode]);
    }
    return kode;
  }
  function buatKwitansi_(o, html) {
    const d = tgl_(o.tanggal);
    const nomor = noKwitansiBaru_(d.getFullYear(), d.getMonth() + 1);
    const kode = kodeUnik_('K', o.kode);
    const isi = String(html || '').split('{{NOMOR}}').join(nomor).split('{{KODE}}').join(kode.replace(/^(.{4})(.{4})(.*)$/, '$1-$2-$3'));
    let file = { id: '', url: '' };
    if (html) file = simpanPdf_(isi, aman_(nomor.replace(/\//g, '-') + ' - ' + o.diterimaDari + ' - ' + o.untuk), ['Kwitansi', d.getFullYear(), pad_(d.getMonth() + 1, 2) + ' ' + BULAN[d.getMonth()]]);
    const r = {
      ID: uid_(), 'No Kwitansi': nomor, Tanggal: ymd_(d), 'Diterima Dari': o.diterimaDari, NISN: o.nisn || '', 'Untuk Pembayaran': o.untuk,
      Kategori: o.kategori, Nominal: Number(o.nominal) || 0, Terbilang: terbilang(o.nominal), Metode: o.metode || 'Tunai',
      'Diterima Oleh': o.penerima, 'Kode Verifikasi': kode, 'File ID': file.id, 'Link PDF': file.url, Status: 'Sah',
      'Ref Kas': o.noRef || '', Dibuat: stamp_(), 'Dibatalkan Pada': '', 'Alasan Batal': '', Dikirim: '',
    };
    tulis_(SH_KWT, null, r);
    return r;
  }
  function outKwt_(r) {
    return { id: r.ID, nomor: r['No Kwitansi'], tanggal: teksTgl_(r.Tanggal), diterimaDari: r['Diterima Dari'], nisn: String(r.NISN || ''),
      untuk: r['Untuk Pembayaran'], kategori: r.Kategori, nominal: Number(r.Nominal) || 0, terbilang: r.Terbilang, metode: r.Metode,
      penerima: r['Diterima Oleh'], kode: r['Kode Verifikasi'], adaFile: !!r['File ID'], status: r.Status, noRef: r['Ref Kas'],
      alasanBatal: r['Alasan Batal'], dikirim: r.Dikirim };
  }
  function kirimKwitansiKeWali_(k) {
    if (!k.NISN) return { push: false, wa: '' };
    const s = santri_(k.NISN);
    const judul = '🧾 Kwitansi pembayaran ' + (s ? s.nama : '');
    const isi = k['Untuk Pembayaran'] + ' sebesar ' + rupiah_(k.Nominal) + ' telah diterima (No. ' + k['No Kwitansi'] + '). Kwitansi dapat dilihat di menu SPP aplikasi WASIAT.';
    let wa = '';
    try { kirimPushKeWali(String(k.NISN), judul, isi); } catch (e) { }
    if (s && s.noWa) {
      try {
        const h = kirimWA_(s.noWa, 'Assalamualaikum Wr. Wb.\n\nYth. Orang Tua/Wali Santri *' + s.nama + '*\n\nAlhamdulillah, pembayaran berikut telah kami terima:\n\n' +
          '• ' + k['Untuk Pembayaran'] + '\n• Jumlah: *' + rupiah_(k.Nominal) + '*\n• No. Kwitansi: ' + k['No Kwitansi'] + '\n\nKwitansi resmi ber-QR dapat dilihat di aplikasi WASIAT (menu SPP).\n\nJazakumullah khairan.', 'kwitansi');
        wa = h && h.ok ? 'terkirim' : (h && h.dilewati ? 'nonaktif' : 'gagal');
      } catch (e) { wa = 'gagal'; }
    } else wa = 'tanpa nomor';
    return { push: true, wa: wa };
  }

  /** Terima pembayaran: catat ke Buku Kas Umum + (bila SPP) tandai bulan lunas + terbitkan kwitansi resmi. */
  function api_terimaPembayaran(p, me) {
    wajib_(isBendahara_(me), 'Hanya Bendahara, Admin, atau Mudir yang dapat menerima pembayaran.');
    const tanggal = teksTgl_(p.tanggal) || ymd_(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) throw new Error('Tanggal tidak valid.');
    const kategori = norm(p.kategori);
    if (!kategori) throw new Error('Pilih jenis pembayaran.');
    cekTitipan_(kategori, p.uraian);
    const s = p.nisn ? santri_(p.nisn) : null;
    if (p.nisn && !s) throw new Error('Santri dengan NISN ' + p.nisn + ' tidak ditemukan.');
    const diterimaDari = norm(p.diterimaDari) || (s ? 'Wali santri ' + s.nama : '');
    if (!diterimaDari) throw new Error('Isi nama pembayar (Diterima dari).');
    const bulanSpp = (p.sppBulan || []).map(Number).filter(function (b) { return b >= 1 && b <= 36; });
    if (bulanSpp.length && !s) throw new Error('Pembayaran SPP harus memilih santri.');
    let nominal = Number(p.nominal) || 0;
    let untuk = norm(p.uraian);
    const lock = kunci_();
    lock.waitLock(30000);
    let k, noRef;
    try {
      cekTerkunci_(tanggal);
      if (bulanSpp.length) {
        const sh = getAktifSppSS().getSheetByName(SHEET_SPP);
        if (!sh) throw new Error('Sheet SPP tidak ditemukan.');
        const kSpp = kolomSpp_(sh);
        const rows = sh.getDataRange().getValues();
        let rowIdx = -1, biaya = 0;
        for (let i = 1; i < rows.length; i++) if (norm(rows[i][0]) === s.nisn) { rowIdx = i + 1; biaya = Number(rows[i][kSpp.biaya - 1]) || 0; break; }
        if (rowIdx < 0) throw new Error('Santri ini belum punya data SPP. Atur biaya SPP dulu.');
        if (biaya <= 0) throw new Error('Biaya SPP santri ini belum diatur.');
        bulanSpp.sort(function (a, b) { return a - b; });
        const sudah = bulanSpp.filter(function (b) { return norm(rows[rowIdx - 1][kSpp.bulan1 - 2 + b]); });
        if (sudah.length) throw new Error('Bulan berikut sudah tercatat lunas: ' + sudah.map(function (b) { return labelBulanSPP(b, s.tahunMasuk); }).join(', ') + '. Muat ulang halaman.');
        const tglLunas = 'Lunas (' + Utilities.formatDate(tgl_(tanggal), tz_(), 'dd/MM/yyyy') + ')';
        bulanSpp.forEach(function (b) { sh.getRange(rowIdx, kSpp.bulan1 - 1 + b).setValue(tglLunas); });
        nominal = biaya * bulanSpp.length;
        untuk = 'SPP ' + bulanSpp.map(function (b) { return labelBulanSPP(b, s.tahunMasuk); }).join(', ') + ' a.n. ' + s.nama + (untuk ? ' (' + untuk + ')' : '');
      }
      if (nominal <= 0) throw new Error('Nominal pembayaran wajib diisi.');
      if (!untuk) throw new Error('Isi keterangan pembayaran.');
      const kelas = norm(p.kelas);
      noRef = tambahKas_({ tanggal: tanggal, jenis: 'Pemasukan', kategori: kategori, uraian: untuk, nominal: nominal, dicatatOleh: me.nama, kelas: kelas });
      k = buatKwitansi_({ tanggal: tanggal, diterimaDari: diterimaDari, nisn: s ? s.nisn : '', untuk: untuk, kategori: kategori, nominal: nominal,
        metode: norm(p.metode), penerima: me.nama, noRef: noRef, kode: p.kodeVerifikasi }, p.html);
      const kas = cariKas_(noRef);
      if (kas) kas.sh.getRange(kas.row, 8).setValue(k['No Kwitansi']);
    } finally { lock.releaseLock(); }
    let kirim = { push: false, wa: '' };
    if (k.NISN && p.kirimKeWali !== false) {
      kirim = kirimKwitansiKeWali_(k);
      const rr = rows_(SH_KWT).find(function (x) { return x.ID === k.ID; });
      if (rr) ubah_(SH_KWT, rr, { Dikirim: stamp_() });
    }
    return { kwitansi: outKwt_(k), noRef: noRef, kirim: kirim };
  }

  /** Terbitkan kwitansi resmi untuk pemasukan yang sudah tercatat di Buku Kas Umum. */
  function api_terbitkanKwitansiKas(p, me) {
    wajib_(isBendahara_(me), 'Hanya Bendahara, Admin, atau Mudir yang dapat menerbitkan kwitansi.');
    const lock = kunci_();
    lock.waitLock(30000);
    let k;
    try {
      const kas = cariKas_(p.noRef);
      if (!kas) throw new Error('Transaksi ' + p.noRef + ' tidak ditemukan di Buku Kas Umum.');
      if (norm(kas.v[2]) !== 'Pemasukan') throw new Error('Kwitansi hanya untuk pemasukan.');
      const ada = rows_(SH_KWT).find(function (x) { return String(x['Ref Kas']) === String(p.noRef) && x.Status === 'Sah'; });
      if (ada) throw new Error('Transaksi ini sudah memiliki kwitansi resmi No. ' + ada['No Kwitansi'] + '.');
      const s = p.nisn ? santri_(p.nisn) : null;
      const diterimaDari = norm(p.diterimaDari) || (s ? 'Wali santri ' + s.nama : '');
      if (!diterimaDari) throw new Error('Isi nama pembayar (Diterima dari).');
      k = buatKwitansi_({ tanggal: teksTgl_(kas.v[1]), diterimaDari: diterimaDari, nisn: s ? s.nisn : '', untuk: norm(kas.v[4]), kategori: norm(kas.v[3]),
        nominal: Number(kas.v[5]) || 0, metode: norm(p.metode), penerima: me.nama, noRef: p.noRef, kode: p.kodeVerifikasi }, p.html);
      kas.sh.getRange(kas.row, 8).setValue(k['No Kwitansi']);
    } finally { lock.releaseLock(); }
    let kirim = { push: false, wa: '' };
    if (k.NISN && p.kirimKeWali) {
      kirim = kirimKwitansiKeWali_(k);
      const rr = rows_(SH_KWT).find(function (x) { return x.ID === k.ID; });
      if (rr) ubah_(SH_KWT, rr, { Dikirim: stamp_() });
    }
    return { kwitansi: outKwt_(k), kirim: kirim };
  }

  /** Data untuk menyusun kwitansi di layar sebelum disimpan (nomor berikutnya hanya perkiraan). */
  function api_infoKwitansiKas(p, me) {
    wajib_(isBendahara_(me));
    const kas = cariKas_(p.noRef);
    if (!kas) throw new Error('Transaksi tidak ditemukan.');
    const ada = rows_(SH_KWT).find(function (x) { return String(x['Ref Kas']) === String(p.noRef) && x.Status === 'Sah'; });
    return { noRef: p.noRef, tanggal: teksTgl_(kas.v[1]), jenis: norm(kas.v[2]), kategori: norm(kas.v[3]), uraian: norm(kas.v[4]), nominal: Number(kas.v[5]) || 0,
      kwitansi: ada ? outKwt_(ada) : null };
  }

  function api_listKwitansi(p, me) {
    wajib_(isStaf_(me));
    const q = String(p.q || '').toLowerCase();
    return rows_(SH_KWT).filter(function (r) {
      const t = teksTgl_(r.Tanggal);
      if (p.tahun && t.slice(0, 4) !== String(p.tahun)) return false;
      if (p.bulan && Number(t.slice(5, 7)) !== Number(p.bulan)) return false;
      if (q && [r['No Kwitansi'], r['Diterima Dari'], r['Untuk Pembayaran'], r.NISN].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return String(b.Dibuat).localeCompare(String(a.Dibuat)); }).slice(0, 500).map(outKwt_);
  }
  /** Peta Ref Kas -> kwitansi sah (untuk tombol di daftar Catat Transaksi). */
  function api_petaKwitansiKas(p, me) {
    wajib_(isStaf_(me));
    const hasil = {};
    rows_(SH_KWT).forEach(function (r) { if (r['Ref Kas'] && r.Status === 'Sah') hasil[r['Ref Kas']] = { id: r.ID, nomor: r['No Kwitansi'] }; });
    return hasil;
  }
  function bolehNisn_(me, nisn) { return isStaf_(me) || me.terkait.map(String).indexOf(String(nisn)) >= 0; }
  function api_kwitansiSantri(p, me) {
    wajib_(bolehNisn_(me, p.nisn), 'Anda tidak memiliki akses ke data santri ini.');
    return rows_(SH_KWT).filter(function (r) { return String(r.NISN) === String(p.nisn); })
      .sort(function (a, b) { return String(b.Tanggal).localeCompare(String(a.Tanggal)); }).map(outKwt_);
  }
  function api_fileKwitansi(p, me) {
    const r = rows_(SH_KWT).find(function (x) { return x.ID === p.id; });
    if (!r || !r['File ID']) throw new Error('Berkas kwitansi tidak tersedia.');
    wajib_(isStaf_(me) || (r.NISN && bolehNisn_(me, r.NISN)), 'Anda tidak memiliki akses ke kwitansi ini.');
    return fileB64_(r['File ID']);
  }
  function fileB64_(id) {
    const f = DriveApp.getFileById(id);
    const b = f.getBlob();
    if (b.getBytes().length > 15 * 1024 * 1024) throw new Error('Berkas terlalu besar untuk ditampilkan.');
    return { name: f.getName(), mime: b.getContentType(), base64: Utilities.base64Encode(b.getBytes()) };
  }
  function api_batalKwitansi(p, me) {
    wajib_(isBendahara_(me));
    const alasan = norm(p.alasan);
    if (!alasan) throw new Error('Tulis alasan pembatalan.');
    const r = rows_(SH_KWT).find(function (x) { return x.ID === p.id; });
    if (!r) throw new Error('Kwitansi tidak ditemukan.');
    if (r.Status !== 'Sah') throw new Error('Kwitansi ini sudah dibatalkan.');
    ubah_(SH_KWT, r, { Status: 'Dibatalkan', 'Dibatalkan Pada': stamp_(), 'Alasan Batal': alasan.slice(0, 300) + ' (oleh ' + me.nama + ')' });
    tandaiBatalFile_(r['File ID'], true);
    return { id: r.ID, status: 'Dibatalkan' };
  }
  function api_kirimKwitansi(p, me) {
    wajib_(isBendahara_(me));
    const r = rows_(SH_KWT).find(function (x) { return x.ID === p.id; });
    if (!r) throw new Error('Kwitansi tidak ditemukan.');
    if (r.Status !== 'Sah') throw new Error('Kwitansi yang dibatalkan tidak dapat dikirim.');
    if (!r.NISN) throw new Error('Kwitansi ini tidak terkait santri, jadi tidak ada wali yang dituju.');
    const h = kirimKwitansiKeWali_(r);
    ubah_(SH_KWT, r, { Dikirim: stamp_() });
    return h;
  }
  /** Dipanggil menu Catat Transaksi setelah sebuah baris kas dihapus. */
  function setelahHapusKas(noRef, oleh) {
    try {
      rows_(SH_KWT).filter(function (r) { return String(r['Ref Kas']) === String(noRef) && r.Status === 'Sah'; }).forEach(function (r) {
        ubah_(SH_KWT, r, { Status: 'Dibatalkan', 'Dibatalkan Pada': stamp_(), 'Alasan Batal': 'Transaksi kas dihapus' + (oleh ? ' oleh ' + oleh : '') });
        tandaiBatalFile_(r['File ID'], true);
      });
    } catch (e) { Logger.log('setelahHapusKas: ' + e.message); }
  }

  /* ---------------- verifikasi publik (QR) ---------------- */
  function api_verifikasi(p) {
    const k = kodeBersih_(p.kode);
    const nama = getPengaturan().NamaPesantren || 'Pondok Pesantren';
    if (k.length < 8) return { ditemukan: false, lembaga: nama };
    const r = rows_(SH_KWT).find(function (x) { return kodeBersih_(x['Kode Verifikasi']) === k; });
    if (r) return { ditemukan: true, sah: r.Status === 'Sah', lembaga: nama, jenisDokumen: 'Kwitansi Pembayaran',
      nomor: r['No Kwitansi'], tanggal: teksTgl_(r.Tanggal), jenis: 'Kwitansi · ' + r.Kategori, perihal: r['Untuk Pembayaran'],
      nominal: Number(r.Nominal) || 0, diterimaDari: r['Diterima Dari'], penandatangan: 'Bendahara — ' + r['Diterima Oleh'] };
    const t = rows_(SH_TB).find(function (x) { return kodeBersih_(x['Kode Verifikasi']) === k; });
    if (t) return { ditemukan: true, sah: t.Status === ST_TB.SAH, lembaga: nama, jenisDokumen: 'Laporan Keuangan',
      nomor: 'LK/' + pad_(t.Bulan, 2) + '/' + t.Tahun, tanggal: teksTgl_(t['Disahkan Pada']), jenis: 'Laporan Keuangan Bulanan',
      perihal: 'Laporan keuangan ' + BULAN[Number(t.Bulan) - 1] + ' ' + t.Tahun, penandatangan: 'Mudir — ' + t['Disahkan Oleh'] };
    // Laporan perkembangan santri (P...) & rapor resmi (R...) dari modul PRM_
    if (typeof PRM_ !== 'undefined') { try { const x = PRM_.verifikasi(k); if (x) return x; } catch (e) { } }
    return { ditemukan: false, lembaga: nama };
  }

  /* ================================================================
   *  PENGAJUAN DANA + PERSETUJUAN MUDIR
   * ================================================================ */
  function noPengajuanBaru_(tahun) {
    let max = 0;
    rows_(SH_PD).forEach(function (r) {
      const m = String(r['No Pengajuan']).match(/^PD-(\d{4})-(\d+)$/);
      if (m && m[1] === String(tahun) && Number(m[2]) > max) max = Number(m[2]);
    });
    return 'PD-' + tahun + '-' + pad_(max + 1, 3);
  }
  function outPd_(r) {
    return { id: r.ID, nomor: r['No Pengajuan'], tanggal: teksTgl_(r.Tanggal), pengaju: r['Diajukan Oleh'], uraian: r.Uraian, kategori: r.Kategori,
      anggaranId: r['Anggaran ID'], namaAnggaran: r['Nama Anggaran'], nominal: Number(r.Nominal) || 0, rincian: r.Rincian,
      adaNota: !!r['Nota File ID'], status: r.Status, diputusOleh: r['Diputus Oleh'], diputusPada: r['Diputus Pada'], catatan: r['Catatan Mudir'], noRef: r['Ref Kas'] };
  }
  function api_ajukanDana(p, me) {
    wajib_(punya_(me, PENGAJU_DANA), 'Akun Anda tidak dapat mengajukan dana.');
    const uraian = norm(p.uraian), kategori = norm(p.kategori);
    const nominal = Math.round(Number(p.nominal) || 0);
    if (!uraian) throw new Error('Isi keperluan / uraian pengajuan.');
    if (!kategori) throw new Error('Pilih kategori pengeluaran.');
    if (nominal <= 0) throw new Error('Nominal wajib lebih dari 0.');
    cekTitipan_(kategori, uraian);
    let ang = null;
    if (p.anggaranId) {
      ang = getAnggaranList(new Date().getFullYear()).concat(getAnggaranList(new Date().getFullYear() - 1)).find(function (a) { return a.id === p.anggaranId; });
      if (!ang) throw new Error('Anggaran kegiatan tidak ditemukan.');
    }
    const lock = kunci_();
    lock.waitLock(30000);
    let r;
    try {
      const tahun = new Date().getFullYear();
      const nomor = noPengajuanBaru_(tahun);
      let nota = { id: '', url: '' };
      if (p.nota && p.nota.base64) {
        if (String(p.nota.base64).length > 14 * 1024 * 1024) throw new Error('Foto nota terlalu besar (maks 10 MB).');
        const mime = p.nota.mime || 'application/octet-stream';
        const ext = (String(p.nota.name || '').match(/\.[a-z0-9]{2,5}$/i) || [mime === 'application/pdf' ? '.pdf' : '.jpg'])[0].toLowerCase();
        const f = folderJalur_(['Nota Pengajuan', tahun]).createFile(Utilities.newBlob(Utilities.base64Decode(p.nota.base64), mime, aman_(nomor + ' - ' + uraian) + ext));
        nota = { id: f.getId(), url: f.getUrl() };
      }
      r = { ID: uid_(), 'No Pengajuan': nomor, Tanggal: ymd_(new Date()), 'Diajukan Oleh': me.nama, Uraian: uraian.slice(0, 300), Kategori: kategori,
        'Anggaran ID': ang ? ang.id : '', 'Nama Anggaran': ang ? ang.namaKegiatan : '', Nominal: nominal, Rincian: norm(p.rincian).slice(0, 2000),
        'Nota File ID': nota.id, 'Nota Link': nota.url, Status: ST_PD.MENUNGGU, 'Diputus Oleh': '', 'Diputus Pada': '', 'Catatan Mudir': '', 'Ref Kas': '', Dibuat: stamp_() };
      tulis_(SH_PD, null, r);
    } finally { lock.releaseLock(); }
    kabarStaf_('Mudir', 'Pengajuan dana menunggu persetujuan', r['No Pengajuan'] + ': ' + r.Uraian + ' — ' + rupiah_(r.Nominal) + '. Diajukan oleh ' + me.nama + '.', 'keuangan_pengajuan');
    return outPd_(r);
  }
  function api_listPengajuan(p, me) {
    const semua = isStaf_(me);
    return rows_(SH_PD).filter(function (r) {
      if (!semua && normNama(r['Diajukan Oleh']) !== normNama(me.nama)) return false;
      if (p.status && r.Status !== p.status) return false;
      if (p.tahun && String(r.Tanggal).slice(0, 4) !== String(p.tahun)) return false;
      return true;
    }).sort(function (a, b) {
      const pa = a.Status === ST_PD.MENUNGGU ? 0 : 1, pb = b.Status === ST_PD.MENUNGGU ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return String(b.Dibuat).localeCompare(String(a.Dibuat));
    }).slice(0, 300).map(outPd_);
  }
  function api_putuskanPengajuan(p, me) {
    wajib_(isMudir_(me), 'Hanya Mudir yang dapat menyetujui atau menolak pengajuan dana.');
    const setuju = p.keputusan === 'setuju';
    const catatan = norm(p.catatan);
    if (!setuju && !catatan) throw new Error('Tulis alasan penolakan untuk pengaju.');
    const lock = kunci_();
    lock.waitLock(30000);
    let r, noRef = '';
    try {
      r = rows_(SH_PD).find(function (x) { return x.ID === p.id; });
      if (!r) throw new Error('Pengajuan tidak ditemukan.');
      if (r.Status !== ST_PD.MENUNGGU) throw new Error('Pengajuan ini sudah diputuskan (' + r.Status + ').');
      const hariIni = ymd_(new Date());
      if (setuju) {
        cekTerkunci_(hariIni);
        noRef = tambahKas_({ tanggal: hariIni, jenis: 'Pengeluaran', kategori: r.Kategori,
          uraian: r.Uraian + ' (' + r['No Pengajuan'] + (r['Nama Anggaran'] ? ', anggaran: ' + r['Nama Anggaran'] : '') + ')',
          nominal: r.Nominal, dicatatOleh: 'Disetujui ' + me.nama + ' · diajukan ' + r['Diajukan Oleh'], noKwitansi: r['No Pengajuan'] });
      }
      r = ubah_(SH_PD, r, { Status: setuju ? ST_PD.SETUJU : ST_PD.TOLAK, 'Diputus Oleh': me.nama, 'Diputus Pada': stamp_(), 'Catatan Mudir': catatan.slice(0, 500), 'Ref Kas': noRef });
    } finally { lock.releaseLock(); }
    const isi = r['No Pengajuan'] + ': ' + r.Uraian + ' — ' + rupiah_(r.Nominal) + (setuju ? ' disetujui dan sudah tercatat di Buku Kas Umum.' : ' ditolak.') + (catatan ? ' Catatan Mudir: ' + catatan : '');
    kabarNama_(r['Diajukan Oleh'], setuju ? 'Pengajuan dana disetujui ✓' : 'Pengajuan dana ditolak', isi, 'keuangan_pengajuan');
    if (setuju) akunPeran_('Bendahara').forEach(function (a) { if (normNama(a.nama) !== normNama(r['Diajukan Oleh'])) kabarNama_(a.nama, 'Dana disetujui — siap dicairkan', isi, 'keuangan_pengajuan'); });
    return Object.assign(outPd_(Object.assign({ _row: 0 }, r)), { noRef: noRef });
  }
  function api_batalPengajuan(p, me) {
    const r = rows_(SH_PD).find(function (x) { return x.ID === p.id; });
    if (!r) throw new Error('Pengajuan tidak ditemukan.');
    wajib_(normNama(r['Diajukan Oleh']) === normNama(me.nama) || isBendahara_(me), 'Hanya pengaju yang dapat membatalkan pengajuan ini.');
    if (r.Status !== ST_PD.MENUNGGU) throw new Error('Hanya pengajuan yang masih menunggu yang dapat dibatalkan.');
    ubah_(SH_PD, r, { Status: ST_PD.BATAL, 'Diputus Pada': stamp_(), 'Catatan Mudir': 'Dibatalkan oleh ' + me.nama });
    return { id: r.ID, status: ST_PD.BATAL };
  }
  function api_fileNota(p, me) {
    const r = rows_(SH_PD).find(function (x) { return x.ID === p.id; });
    if (!r || !r['Nota File ID']) throw new Error('Nota tidak tersedia.');
    wajib_(isStaf_(me) || normNama(r['Diajukan Oleh']) === normNama(me.nama));
    return fileB64_(r['Nota File ID']);
  }

  /* ================================================================
   *  LAPORAN RESMI + TUTUP BUKU
   * ================================================================ */
  function ringkasBulan_(bulan, tahun) {
    const b = getBKUBulanan(bulan, tahun);
    const perKat = {};
    b.baris.forEach(function (t) {
      const key = t.jenis + '|' + t.kategori;
      if (!perKat[key]) perKat[key] = { jenis: t.jenis, kategori: t.kategori, total: 0, jumlah: 0 };
      perKat[key].total += t.nominal; perKat[key].jumlah++;
    });
    return { bulan: b.bulan, tahun: b.tahun, namaBulan: b.namaBulan, saldoAwal: b.saldoAwal, totalPemasukan: b.totalPemasukan,
      totalPengeluaran: b.totalPengeluaran, saldoAkhir: b.saldoAkhir, jumlah: b.baris.length, baris: b.baris,
      perKategori: Object.keys(perKat).map(function (k) { return perKat[k]; }), titipan: barisTitipan_(b.baris) };
  }
  function outTb_(r) {
    return { periode: String(r.Periode), bulan: Number(r.Bulan), tahun: Number(r.Tahun), saldoAwal: Number(r['Saldo Awal']) || 0,
      pemasukan: Number(r.Pemasukan) || 0, pengeluaran: Number(r.Pengeluaran) || 0, saldoAkhir: Number(r['Saldo Akhir']) || 0,
      jumlah: Number(r['Jumlah Transaksi']) || 0, status: r.Status, diajukanOleh: r['Diajukan Oleh'], diajukanPada: r['Diajukan Pada'],
      disahkanOleh: r['Disahkan Oleh'], disahkanPada: r['Disahkan Pada'], catatan: r.Catatan, adaFile: !!r['File ID'], kode: r['Kode Verifikasi'] };
  }
  function api_statusTutupBuku(p, me) {
    wajib_(isStaf_(me));
    const th = Number(p.tahun) || new Date().getFullYear();
    const per = {};
    rows_(SH_TB).forEach(function (r) { if (Number(r.Tahun) === th) per[String(r.Periode)] = r; });
    const batas = batasTutup_();
    const lap = getLaporanBulanan(th);
    return lap.map(function (b) {
      const r = per[periode_(b.bulan, th)];
      return { bulan: b.bulan, tahun: th, namaBulan: b.namaBulan, pemasukan: b.pemasukan, pengeluaran: b.pengeluaran,
        status: r ? r.Status : '', tb: r ? outTb_(r) : null, terkunci: !!batas && periode_(b.bulan, th) <= batas };
    });
  }
  function api_dataLaporan(p, me) {
    wajib_(isStaf_(me));
    const r = statusPeriode_(periode_(Number(p.bulan), Number(p.tahun)));
    return { ringkas: ringkasBulan_(Number(p.bulan), Number(p.tahun)), tb: r ? outTb_(r) : null,
      pengajuan: rows_(SH_PD).filter(function (x) { return x.Status === ST_PD.SETUJU && String(x['Diputus Pada']).slice(0, 7) === ym_(Number(p.bulan), Number(p.tahun)); }).map(outPd_) };
  }
  function api_ajukanTutupBuku(p, me) {
    wajib_(isBendahara_(me), 'Hanya Bendahara yang dapat menutup buku.');
    const bulan = Number(p.bulan), tahun = Number(p.tahun);
    if (!(bulan >= 1 && bulan <= 12) || !tahun) throw new Error('Periode tidak valid.');
    const sekarang = new Date();
    // Hanya bulan yang sudah berakhir: transaksi otomatis (mis. pendapatan kantin) masih
    // masuk ke bulan berjalan, jadi bulan ini belum bisa dibukukan final.
    if (tahun > sekarang.getFullYear() || (tahun === sekarang.getFullYear() && bulan >= sekarang.getMonth() + 1)) throw new Error('Tutup buku hanya untuk bulan yang sudah berakhir. ' + BULAN[bulan - 1] + ' ' + tahun + ' dapat ditutup mulai awal bulan berikutnya.');
    const per = periode_(bulan, tahun);
    const lock = kunci_();
    lock.waitLock(30000);
    let o;
    try {
      const ada = statusPeriode_(per);
      if (ada && TERKUNCI_TB.indexOf(String(ada.Status)) >= 0) throw new Error('Buku ' + BULAN[bulan - 1] + ' ' + tahun + ' sudah ' + (ada.Status === ST_TB.SAH ? 'disahkan.' : 'diajukan dan menunggu pengesahan.'));
      const rk = ringkasBulan_(bulan, tahun);
      if (rk.titipan.length) throw new Error('Ada ' + rk.titipan.length + ' transaksi di ' + BULAN[bulan - 1] + ' ' + tahun + ' yang tampak seperti uang belanja/saldo santri (' +
        rk.titipan.slice(0, 3).map(function (t) { return t.noRef; }).join(', ') + (rk.titipan.length > 3 ? ', …' : '') +
        '). Uang titipan santri bukan kas pondok: hapus transaksi tersebut dari Catat Transaksi, lalu ajukan lagi.');
      const riwayat = ada ? String(ada.Riwayat || '') : '';
      o = { Periode: per, Bulan: bulan, Tahun: tahun, 'Saldo Awal': rk.saldoAwal, Pemasukan: rk.totalPemasukan, Pengeluaran: rk.totalPengeluaran,
        'Saldo Akhir': rk.saldoAkhir, 'Jumlah Transaksi': rk.jumlah, Status: ST_TB.MENUNGGU, 'Diajukan Oleh': me.nama, 'Diajukan Pada': stamp_(),
        'Disahkan Oleh': '', 'Disahkan Pada': '', Catatan: norm(p.catatan).slice(0, 500), 'Kode Verifikasi': '', 'File ID': '', 'Link PDF': '',
        Riwayat: (riwayat ? riwayat + '\n' : '') + stamp_() + ' diajukan oleh ' + me.nama };
      if (ada) tulis_(SH_TB, ada._row, o); else tulis_(SH_TB, null, o);
    } finally { lock.releaseLock(); }
    kabarStaf_('Mudir', 'Laporan keuangan menunggu pengesahan', 'Buku kas ' + BULAN[bulan - 1] + ' ' + tahun + ' ditutup oleh ' + me.nama + '. Saldo akhir ' + rupiah_(o['Saldo Akhir']) + '.', 'keuangan_pengajuan');
    return outTb_(o);
  }
  function api_kembalikanTutupBuku(p, me) {
    const per = periode_(Number(p.bulan), Number(p.tahun));
    const r = statusPeriode_(per);
    if (!r) throw new Error('Periode ini belum ditutup.');
    if (r.Status === ST_TB.MENUNGGU) {
      wajib_(isMudir_(me) || isBendahara_(me));
      if (isMudir_(me) && !norm(p.catatan)) throw new Error('Tulis catatan perbaikan untuk Bendahara.');
    } else if (r.Status === ST_TB.SAH) {
      wajib_(isMudir_(me), 'Laporan yang sudah disahkan hanya dapat dibuka kembali oleh Mudir.');
      if (!norm(p.catatan)) throw new Error('Tulis alasan membuka kembali buku ini.');
      tandaiBatalFile_(r['File ID'], true);
    } else throw new Error('Buku periode ini tidak sedang ditutup.');
    const status = r.Status === ST_TB.SAH ? ST_TB.BUKA : ST_TB.KEMBALI;
    const o = ubah_(SH_TB, r, { Status: status, Catatan: norm(p.catatan).slice(0, 500), Riwayat: String(r.Riwayat || '') + '\n' + stamp_() + ' ' + status.toLowerCase() + ' oleh ' + me.nama + (p.catatan ? ': ' + norm(p.catatan) : '') });
    if (isMudir_(me)) akunPeran_('Bendahara').forEach(function (a) { kabarNama_(a.nama, 'Buku kas ' + BULAN[Number(p.bulan) - 1] + ' ' + p.tahun + ' ' + status.toLowerCase(), norm(p.catatan), 'keuangan_pengajuan'); });
    return outTb_(o);
  }
  function api_sahkanTutupBuku(p, me) {
    wajib_(isMudir_(me), 'Hanya Mudir yang dapat mengesahkan laporan keuangan.');
    if (!p.html) throw new Error('Isi laporan kosong.');
    const bulan = Number(p.bulan), tahun = Number(p.tahun);
    const per = periode_(bulan, tahun);
    const lock = kunci_();
    lock.waitLock(30000);
    let o;
    try {
      const r = statusPeriode_(per);
      if (!r || r.Status !== ST_TB.MENUNGGU) throw new Error('Laporan ' + BULAN[bulan - 1] + ' ' + tahun + ' tidak sedang menunggu pengesahan.');
      const rk = ringkasBulan_(bulan, tahun);
      if (rk.saldoAkhir !== Number(r['Saldo Akhir']) || rk.jumlah !== Number(r['Jumlah Transaksi'])) throw new Error('Isi buku kas berubah sejak diajukan. Minta Bendahara mengajukan ulang.');
      const kode = kodeUnik_('L', p.kodeVerifikasi);
      const isi = String(p.html).split('{{KODE}}').join(kode.replace(/^(.{4})(.{4})(.*)$/, '$1-$2-$3'));
      const f = simpanPdf_(isi, aman_('Laporan Keuangan ' + pad_(bulan, 2) + ' ' + BULAN[bulan - 1] + ' ' + tahun), ['Laporan Bulanan', tahun]);
      o = ubah_(SH_TB, r, { Status: ST_TB.SAH, 'Disahkan Oleh': me.nama, 'Disahkan Pada': stamp_(), 'Kode Verifikasi': kode, 'File ID': f.id, 'Link PDF': f.url,
        Riwayat: String(r.Riwayat || '') + '\n' + stamp_() + ' disahkan oleh ' + me.nama });
    } finally { lock.releaseLock(); }
    akunPeran_('Bendahara').forEach(function (a) { kabarNama_(a.nama, 'Laporan keuangan disahkan ✓', 'Laporan ' + BULAN[bulan - 1] + ' ' + tahun + ' telah disahkan oleh ' + me.nama + '.', 'keuangan_pengajuan'); });
    return outTb_(o);
  }
  function api_fileLaporan(p, me) {
    wajib_(isStaf_(me));
    const r = statusPeriode_(periode_(Number(p.bulan), Number(p.tahun)));
    if (!r || !r['File ID']) throw new Error('Laporan resmi bulan ini belum disahkan.');
    return fileB64_(r['File ID']);
  }

  /* ================================================================
   *  TAGIHAN SPP KE WALI (aplikasi + WA + catatan)
   * ================================================================ */
  function kirimSatuTagihan_(t, oleh) {
    let push = false, wa = '';
    try { kirimPushKeWali(t.nisn, '💳 Tagihan SPP ' + t.nama, 'SPP yang belum dibayar: ' + t.bulanTunggak.join(', ') + '. Total ' + rupiah_(t.tunggakanSPP) + '. Rincian di menu SPP aplikasi WASIAT.'); push = true; } catch (e) { }
    if (!t.noWa) wa = 'tanpa nomor';
    else if (!waTerkonfigurasi_()) wa = 'WA belum diatur';
    else {
      try {
        const h = kirimWA_(t.noWa, buildPesanTagihanSPP(t.nama, t.bulanTunggak, t.tunggakanSPP), 'spp_tagihan_manual');
        wa = h && h.ok ? 'terkirim' : (h && h.dilewati ? 'nonaktif' : 'gagal');
      } catch (e) { wa = 'gagal'; }
    }
    try {
      sheet_(SH_LOG).appendRow([stamp_(), t.nisn, t.nama, t.tunggakanSPP, t.bulanTunggak.length, 'Aplikasi' + (wa === 'terkirim' ? ' + WA' : ''), oleh]);
    } catch (e) { }
    return { push: push, wa: wa };
  }
  function api_kirimTagihan(p, me) {
    wajib_(isBendahara_(me));
    const t = getTunggakanSantri().find(function (x) { return x.nisn === norm(p.nisn); });
    if (!t) throw new Error('Santri ini tidak memiliki tunggakan SPP.');
    return kirimSatuTagihan_(t, me.nama);
  }
  function api_kirimTagihanMassal(p, me) {
    wajib_(isBendahara_(me));
    const min = Math.max(1, Number(p.minBulan) || 1);
    const pilih = (p.nisnList || []).map(String);
    let jumlah = 0, wa = 0;
    getTunggakanSantri().forEach(function (t) {
      if (t.status) return;                                   // santri keluar/lulus dilewati
      if (t.jumlahBulan < min) return;
      if (pilih.length && pilih.indexOf(t.nisn) < 0) return;
      const h = kirimSatuTagihan_(t, me.nama);
      jumlah++; if (h.wa === 'terkirim') wa++;
      if (h.wa === 'terkirim') Utilities.sleep(300);
    });
    return { jumlah: jumlah, wa: wa };
  }
  function api_logTagihan(p, me) {
    wajib_(isStaf_(me));
    const sh = getMasterSS().getSheetByName(SH_LOG);
    if (!sh || sh.getLastRow() < 2) return {};
    const hasil = {};
    sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues().forEach(function (r) {
      const w = r[0] instanceof Date ? Utilities.formatDate(r[0], tz_(), 'yyyy-MM-dd HH:mm') : String(r[0]).slice(0, 16);
      hasil[String(r[1])] = { waktu: w, kanal: r[5], oleh: r[6] };
    });
    return hasil;
  }

  /* ================================================================
   *  KONFIRMASI TRANSFER DARI WALI
   *  Wali mengunggah bukti transfer -> Bendahara menekan Terima -> jalur yang SAMA
   *  dengan menu Terima Pembayaran (kas + SPP lunas + kwitansi ber-QR). Pembayaran
   *  manual (setor tunai / bukti lewat WA) tetap lewat menu Terima Pembayaran seperti biasa.
   * ================================================================ */
  const SH_KT = 'KonfirmasiTransfer';
  HEAD[SH_KT] = ['ID', 'Dibuat', 'NISN', 'Nama Santri', 'Dikirim Oleh', 'Jenis', 'Bulan SPP', 'Kategori', 'Keterangan', 'Nominal',
    'Tanggal Transfer', 'Rekening Pengirim', 'Catatan', 'Bukti File ID', 'Status', 'Diproses Oleh', 'Diproses Pada', 'Alasan', 'No Kwitansi', 'Ref Kas'];
  const ST_KT = { MENUNGGU: 'Menunggu', PROSES: 'Diproses', TERIMA: 'Diterima', TOLAK: 'Ditolak', BATAL: 'Dibatalkan' };
  const PROP_REK = 'KEU_REKENING';

  function sppSantri_(nisn) {
    const sh = getAktifSppSS().getSheetByName(SHEET_SPP);
    if (!sh) return null;
    const k = kolomSpp_(sh);
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (norm(rows[i][0]) !== String(nisn)) continue;
      return { biaya: Number(rows[i][k.biaya - 1]) || 0, bebas: String(rows[i][k.bebas - 1]).toUpperCase() === 'TRUE',
        lunas: rows[i].slice(k.bulan1 - 1, k.bulan1 - 1 + 36).map(function (v) { return !!norm(v); }) };
    }
    return null;
  }
  function bulanMenunggu_(nisn, kecualiId) {
    const ada = {};
    rows_(SH_KT).forEach(function (r) {
      if (String(r.NISN) !== String(nisn) || r.ID === kecualiId || (r.Status !== ST_KT.MENUNGGU && r.Status !== ST_KT.PROSES)) return;
      String(r['Bulan SPP'] || '').split(',').map(Number).filter(Boolean).forEach(function (b) { ada[b] = true; });
    });
    return ada;
  }
  function ketTf_(r) { return 'transfer ' + Utilities.formatDate(tgl_(r['Tanggal Transfer']), tz_(), 'dd/MM/yyyy'); }
  /** Sama persis dengan teks "Untuk pembayaran" yang dibuat api_terimaPembayaran. */
  function untukKt_(r, s, bulan) {
    if (r.Jenis === 'SPP') return 'SPP ' + bulan.map(function (b) { return labelBulanSPP(b, s.tahunMasuk); }).join(', ') + ' a.n. ' + s.nama + ' (' + ketTf_(r) + ')';
    return r.Keterangan + ' (transfer)';
  }
  function outKt_(r, s) {
    const bulan = String(r['Bulan SPP'] || '').split(',').map(Number).filter(Boolean);
    return { id: r.ID, dibuat: r.Dibuat, nisn: String(r.NISN), nama: r['Nama Santri'], pengirim: r['Dikirim Oleh'], jenis: r.Jenis,
      bulan: bulan, labelBulan: s ? bulan.map(function (b) { return labelBulanSPP(b, s.tahunMasuk); }) : [], kategori: r.Kategori,
      keterangan: r.Keterangan, nominal: Number(r.Nominal) || 0, tanggalTransfer: teksTgl_(r['Tanggal Transfer']), rekening: r['Rekening Pengirim'],
      catatan: r.Catatan, adaBukti: !!r['Bukti File ID'], status: r.Status, diprosesOleh: r['Diproses Oleh'], diprosesPada: r['Diproses Pada'],
      alasan: r.Alasan, noKwitansi: r['No Kwitansi'], untuk: s ? untukKt_(r, s, bulan) : '', ketTf: ketTf_(r) };
  }
  function kategoriPemasukan_() {
    try { return getKategoriKasList().filter(function (k) { return k.jenis === 'Pemasukan'; }).map(function (k) { return k.nama; }); } catch (e) { return []; }
  }
  function kategoriSpp_() { return kategoriPemasukan_().find(function (k) { return /^spp$/i.test(k); }) || 'SPP'; }

  /** Data form wali: rekening pondok, bulan SPP yang bisa dibayar, kategori lain, dan riwayat konfirmasinya. */
  function api_infoKonfirmasi(p, me) {
    wajib_(bolehNisn_(me, p.nisn), 'Anda tidak memiliki akses ke data santri ini.');
    const s = santri_(p.nisn);
    if (!s) throw new Error('Data santri tidak ditemukan.');
    const spp = sppSantri_(s.nisn);
    const menunggu = bulanMenunggu_(s.nisn);
    const bulan = [];
    if (spp && !spp.bebas && spp.biaya > 0) {
      for (let b = 1; b <= 36; b++) {
        if (spp.lunas[b - 1]) continue;
        bulan.push({ idx: b, label: labelBulanSPP(b, s.tahunMasuk), menunggu: !!menunggu[b] });
        if (bulan.length >= 8) break;
      }
    }
    return { santri: { nisn: s.nisn, nama: s.nama }, biaya: spp ? spp.biaya : 0, bebas: spp ? spp.bebas : false, bulan: bulan,
      kategori: kategoriPemasukan_().filter(function (k) { return !/^spp$/i.test(k) && !uangTitipanSantri(k, ''); }),
      rekening: props_().getProperty(PROP_REK) || '',
      riwayat: rows_(SH_KT).filter(function (r) { return String(r.NISN) === s.nisn; })
        .sort(function (a, b) { return String(b.Dibuat).localeCompare(String(a.Dibuat)); }).slice(0, 20).map(function (r) { return outKt_(r, s); }) };
  }

  function api_kirimKonfirmasi(p, me) {
    wajib_(bolehNisn_(me, p.nisn), 'Anda tidak memiliki akses ke data santri ini.');
    const s = santri_(p.nisn);
    if (!s) throw new Error('Data santri tidak ditemukan.');
    const jenis = p.jenis === 'Lain' ? 'Lain' : 'SPP';
    const tglTf = teksTgl_(p.tanggalTransfer);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tglTf)) throw new Error('Isi tanggal transfer.');
    if (tglTf > ymd_(new Date())) throw new Error('Tanggal transfer tidak boleh di masa depan.');
    if (!p.bukti || !p.bukti.base64) throw new Error('Lampirkan foto/berkas bukti transfer.');
    if (String(p.bukti.base64).length > 7 * 1024 * 1024) throw new Error('Berkas bukti terlalu besar (maks 5 MB).');
    const mime = String(p.bukti.mime || '');
    if (!/^image\/(jpeg|png|webp)$|^application\/pdf$/.test(mime)) throw new Error('Bukti harus berupa foto (JPG/PNG) atau PDF.');
    let bulan = [], nominal = 0, kategori = '', ket = '';
    const lock = kunci_();
    lock.waitLock(30000);
    let r;
    try {
      const aktif = rows_(SH_KT).filter(function (x) { return String(x.NISN) === s.nisn && x.Status === ST_KT.MENUNGGU; });
      if (aktif.length >= 5) throw new Error('Masih ada 5 konfirmasi yang menunggu diperiksa Bendahara. Tunggu sampai diproses.');
      if (jenis === 'SPP') {
        const spp = sppSantri_(s.nisn);
        if (!spp || spp.biaya <= 0) throw new Error('Data SPP santri ini belum diatur. Hubungi Bendahara.');
        if (spp.bebas) throw new Error('Santri ini dibebaskan dari SPP.');
        bulan = (p.sppBulan || []).map(Number).filter(function (b) { return b >= 1 && b <= 36; });
        bulan = bulan.filter(function (b, i) { return bulan.indexOf(b) === i; }).sort(function (a, b) { return a - b; });
        if (!bulan.length) throw new Error('Pilih bulan SPP yang dibayar.');
        const sudah = bulan.filter(function (b) { return spp.lunas[b - 1]; });
        if (sudah.length) throw new Error('Bulan berikut sudah lunas: ' + sudah.map(function (b) { return labelBulanSPP(b, s.tahunMasuk); }).join(', ') + '.');
        const tunggu = bulanMenunggu_(s.nisn);
        const dobel = bulan.filter(function (b) { return tunggu[b]; });
        if (dobel.length) throw new Error('Bulan ' + dobel.map(function (b) { return labelBulanSPP(b, s.tahunMasuk); }).join(', ') + ' sudah dikonfirmasi dan sedang menunggu diperiksa.');
        nominal = spp.biaya * bulan.length;
        kategori = kategoriSpp_();
        ket = 'SPP ' + bulan.map(function (b) { return labelBulanSPP(b, s.tahunMasuk); }).join(', ');
      } else {
        kategori = norm(p.kategori); ket = norm(p.keterangan).slice(0, 200);
        nominal = Math.round(Number(p.nominal) || 0);
        if (!kategori || kategoriPemasukan_().indexOf(kategori) < 0) throw new Error('Pilih jenis pembayaran.');
        if (!ket) throw new Error('Isi keterangan pembayaran.');
        if (nominal <= 0) throw new Error('Isi nominal yang ditransfer.');
        cekTitipan_(kategori, ket);
      }
      const d = new Date();
      const ext = mime === 'application/pdf' ? '.pdf' : (mime === 'image/png' ? '.png' : '.jpg');
      const f = folderJalur_(['Bukti Transfer', d.getFullYear(), pad_(d.getMonth() + 1, 2) + ' ' + BULAN[d.getMonth()]])
        .createFile(Utilities.newBlob(Utilities.base64Decode(p.bukti.base64), mime, aman_(tglTf + ' - ' + s.nama + ' - ' + ket) + ext));
      r = { ID: uid_(), Dibuat: stamp_(), NISN: s.nisn, 'Nama Santri': s.nama, 'Dikirim Oleh': me.nama, Jenis: jenis, 'Bulan SPP': bulan.join(','),
        Kategori: kategori, Keterangan: ket, Nominal: nominal, 'Tanggal Transfer': tglTf, 'Rekening Pengirim': norm(p.rekening).slice(0, 120),
        Catatan: norm(p.catatan).slice(0, 300), 'Bukti File ID': f.getId(), Status: ST_KT.MENUNGGU, 'Diproses Oleh': '', 'Diproses Pada': '',
        Alasan: '', 'No Kwitansi': '', 'Ref Kas': '' };
      tulis_(SH_KT, null, r);
    } finally { lock.releaseLock(); }
    try { kabarStaf_('Bendahara', '💳 Konfirmasi transfer baru', s.nama + ': ' + ket + ' · ' + rupiah_(nominal) + '. Periksa di menu Konfirmasi Transfer.', 'konfirmasi_transfer'); } catch (e) { }
    return outKt_(r, s);
  }

  function api_batalKonfirmasi(p, me) {
    const r = rows_(SH_KT).find(function (x) { return x.ID === p.id; });
    if (!r) throw new Error('Konfirmasi tidak ditemukan.');
    wajib_(bolehNisn_(me, r.NISN), 'Anda tidak memiliki akses ke data ini.');
    if (r.Status !== ST_KT.MENUNGGU) throw new Error('Konfirmasi ini sudah ' + String(r.Status).toLowerCase() + '.');
    ubah_(SH_KT, r, { Status: ST_KT.BATAL, 'Diproses Oleh': me.nama, 'Diproses Pada': stamp_() });
    return { id: r.ID, status: ST_KT.BATAL };
  }

  function api_listKonfirmasi(p, me) {
    wajib_(isBendahara_(me), 'Hanya Bendahara, Admin, atau Mudir.');
    const st = norm(p.status) || ST_KT.MENUNGGU;
    const semua = rows_(SH_KT);
    const daftar = semua.filter(function (r) { return st === 'Semua' || r.Status === st || (st === ST_KT.MENUNGGU && r.Status === ST_KT.PROSES); })
      .sort(function (a, b) { return st === ST_KT.MENUNGGU ? String(a.Dibuat).localeCompare(String(b.Dibuat)) : String(b.Dibuat).localeCompare(String(a.Dibuat)); })
      .slice(0, 200);
    const memo = {};
    return { rekening: props_().getProperty(PROP_REK) || '', menunggu: semua.filter(function (r) { return r.Status === ST_KT.MENUNGGU; }).length,
      data: daftar.map(function (r) { const n = String(r.NISN); if (!(n in memo)) memo[n] = santri_(n); return outKt_(r, memo[n]); }) };
  }

  function api_buktiKonfirmasi(p, me) {
    const r = rows_(SH_KT).find(function (x) { return x.ID === p.id; });
    if (!r || !r['Bukti File ID']) throw new Error('Bukti tidak tersedia.');
    wajib_(bolehNisn_(me, r.NISN), 'Anda tidak memiliki akses ke bukti ini.');
    return fileB64_(r['Bukti File ID']);
  }

  /** Terima: jalur Terima Pembayaran yang sama. Bendahara boleh mengurangi bulan bila nominal transfer kurang. */
  function api_terimaKonfirmasi(p, me) {
    wajib_(isBendahara_(me), 'Hanya Bendahara, Admin, atau Mudir yang dapat menerima pembayaran.');
    const lock = kunci_();
    lock.waitLock(30000);
    let r;
    try {
      r = rows_(SH_KT).find(function (x) { return x.ID === p.id; });
      if (!r) throw new Error('Konfirmasi tidak ditemukan.');
      if (r.Status !== ST_KT.MENUNGGU) throw new Error('Konfirmasi ini sudah ' + String(r.Status).toLowerCase() + (r['Diproses Oleh'] ? ' oleh ' + r['Diproses Oleh'] : '') + '.');
      r = Object.assign(r, ubah_(SH_KT, r, { Status: ST_KT.PROSES, 'Diproses Oleh': me.nama, 'Diproses Pada': stamp_() }));
    } finally { lock.releaseLock(); }
    const s = santri_(r.NISN);
    let hasil;
    try {
      if (!s) throw new Error('Data santri tidak ditemukan.');
      const asal = String(r['Bulan SPP'] || '').split(',').map(Number).filter(Boolean);
      let bulan = asal;
      if (r.Jenis === 'SPP' && p.sppBulan) {
        bulan = (p.sppBulan || []).map(Number).filter(function (b) { return asal.indexOf(b) >= 0; });
        if (!bulan.length) throw new Error('Pilih minimal satu bulan yang diterima.');
      }
      hasil = api_terimaPembayaran({
        tanggal: ymd_(new Date()), nisn: s.nisn, diterimaDari: 'Wali santri ' + s.nama, kategori: r.Kategori,
        uraian: r.Jenis === 'SPP' ? ketTf_(r) : r.Keterangan + ' (transfer)',
        nominal: Number(r.Nominal) || 0, sppBulan: r.Jenis === 'SPP' ? bulan : [], metode: 'Transfer Bank', kelas: norm(p.kelas),
        kirimKeWali: p.kirimKeWali !== false, html: p.html, kodeVerifikasi: p.kodeVerifikasi }, me);
      const sisa = asal.filter(function (b) { return bulan.indexOf(b) < 0; });
      const cur = rows_(SH_KT).find(function (x) { return x.ID === r.ID; });
      ubah_(SH_KT, cur, { Status: ST_KT.TERIMA, 'Diproses Oleh': me.nama, 'Diproses Pada': stamp_(), 'No Kwitansi': hasil.kwitansi.nomor, 'Ref Kas': hasil.noRef,
        'Bulan SPP': r.Jenis === 'SPP' ? bulan.join(',') : '', Nominal: hasil.kwitansi.nominal,
        Alasan: sisa.length ? 'Diterima sebagian; belum diterima: ' + sisa.map(function (b) { return labelBulanSPP(b, s.tahunMasuk); }).join(', ') + (norm(p.catatan) ? ' — ' + norm(p.catatan) : '') : norm(p.catatan) });
    } catch (e) {
      // gagal -> kembalikan ke Menunggu supaya bisa diproses ulang
      try { const cur = rows_(SH_KT).find(function (x) { return x.ID === r.ID; }); if (cur && cur.Status === ST_KT.PROSES) ubah_(SH_KT, cur, { Status: ST_KT.MENUNGGU, 'Diproses Oleh': '', 'Diproses Pada': '' }); } catch (e2) { }
      throw e;
    }
    return hasil;
  }

  function api_tolakKonfirmasi(p, me) {
    wajib_(isBendahara_(me), 'Hanya Bendahara, Admin, atau Mudir.');
    const alasan = norm(p.alasan);
    if (!alasan) throw new Error('Tulis alasan penolakan agar wali tahu apa yang perlu diperbaiki.');
    const lock = kunci_();
    lock.waitLock(30000);
    let r;
    try {
      r = rows_(SH_KT).find(function (x) { return x.ID === p.id; });
      if (!r) throw new Error('Konfirmasi tidak ditemukan.');
      if (r.Status !== ST_KT.MENUNGGU) throw new Error('Konfirmasi ini sudah ' + String(r.Status).toLowerCase() + '.');
      ubah_(SH_KT, r, { Status: ST_KT.TOLAK, 'Diproses Oleh': me.nama, 'Diproses Pada': stamp_(), Alasan: alasan.slice(0, 300) });
    } finally { lock.releaseLock(); }
    const s = santri_(r.NISN);
    const isi = 'Konfirmasi transfer ' + r.Keterangan + ' (' + rupiah_(r.Nominal) + ') belum dapat diterima. Alasan: ' + alasan;
    try { kirimPushKeWali(String(r.NISN), '⚠️ Konfirmasi transfer perlu diperbaiki', isi); } catch (e) { }
    if (s && s.noWa) { try { kirimWA_(s.noWa, 'Assalamualaikum Wr. Wb.\n\nYth. Orang Tua/Wali Santri *' + s.nama + '*\n\n' + isi + '\n\nSilakan kirim ulang konfirmasi di aplikasi WASIAT (menu SPP) atau hubungi Bendahara.\n\nJazakumullah khairan.', 'konfirmasi_transfer'); } catch (e) { } }
    return { id: r.ID, status: ST_KT.TOLAK };
  }

  function api_simpanRekening(p, me) {
    wajib_(isBendahara_(me), 'Hanya Bendahara, Admin, atau Mudir.');
    props_().setProperty(PROP_REK, norm(p.rekening).slice(0, 500));
    return { rekening: props_().getProperty(PROP_REK) };
  }

  /* ---------------- ringkasan untuk menu ---------------- */
  function api_ringkas(p, me) {
    const pd = rows_(SH_PD);
    const tb = rows_(SH_TB);
    return {
      pengajuanMenunggu: pd.filter(function (r) { return r.Status === ST_PD.MENUNGGU; }).length,
      pengajuanSaya: pd.filter(function (r) { return r.Status === ST_PD.MENUNGGU && normNama(r['Diajukan Oleh']) === normNama(me.nama); }).length,
      laporanMenunggu: tb.filter(function (r) { return r.Status === ST_TB.MENUNGGU; }).length,
      konfirmasiMenunggu: isBendahara_(me) ? rows_(SH_KT).filter(function (r) { return r.Status === ST_KT.MENUNGGU; }).length : 0,
      bisaPutuskan: isMudir_(me), bendahara: isBendahara_(me), roles: me.roles, nama: me.nama,
    };
  }
  function api_kop(p, me) {
    let kop = null;
    try { kop = SURAT_.kopUntukModulLain(); } catch (e) { }
    return { kop: kop, namaPesantren: getPengaturan().NamaPesantren || 'Pondok Pesantren', alamat: getPengaturan().AlamatPesantren || '' };
  }

  /* ---------------- pintu masuk ---------------- */
  const HANDLERS = {
    verifikasi: api_verifikasi,
    ringkas: api_ringkas, kop: api_kop,
    terimaPembayaran: api_terimaPembayaran, terbitkanKwitansiKas: api_terbitkanKwitansiKas, infoKwitansiKas: api_infoKwitansiKas,
    listKwitansi: api_listKwitansi, petaKwitansiKas: api_petaKwitansiKas, kwitansiSantri: api_kwitansiSantri, fileKwitansi: api_fileKwitansi,
    batalKwitansi: api_batalKwitansi, kirimKwitansi: api_kirimKwitansi,
    ajukanDana: api_ajukanDana, listPengajuan: api_listPengajuan, putuskanPengajuan: api_putuskanPengajuan, batalPengajuan: api_batalPengajuan, fileNota: api_fileNota,
    statusTutupBuku: api_statusTutupBuku, dataLaporan: api_dataLaporan, ajukanTutupBuku: api_ajukanTutupBuku, kembalikanTutupBuku: api_kembalikanTutupBuku,
    sahkanTutupBuku: api_sahkanTutupBuku, fileLaporan: api_fileLaporan,
    kirimTagihan: api_kirimTagihan, kirimTagihanMassal: api_kirimTagihanMassal, logTagihan: api_logTagihan,
    infoKonfirmasi: api_infoKonfirmasi, kirimKonfirmasi: api_kirimKonfirmasi, batalKonfirmasi: api_batalKonfirmasi, listKonfirmasi: api_listKonfirmasi,
    buktiKonfirmasi: api_buktiKonfirmasi, terimaKonfirmasi: api_terimaKonfirmasi, tolakKonfirmasi: api_tolakKonfirmasi, simpanRekening: api_simpanRekening,
  };
  const PUBLIK = { verifikasi: true };
  function tangani(req) {
    const fn = HANDLERS[req.action];
    if (!fn) return { ok: false, error: 'Aksi keuangan tidak dikenal: ' + req.action };
    try {
      if (PUBLIK[req.action]) return { ok: true, data: fn(req.payload || {}) };
      let me = null;
      try { me = (typeof SURAT_ !== 'undefined') ? SURAT_.identitasToken(req.token) : null; } catch (e) { me = null; }
      if (!me) return { ok: false, auth: false, error: 'Sesi berakhir. Silakan keluar lalu masuk kembali ke WASIAT.' };
      return { ok: true, data: fn(req.payload || {}, me) };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  return { tangani: tangani, bulanTerkunci: bulanTerkunci, setelahHapusKas: setelahHapusKas, terbilang: terbilang,
    uangTitipanSantri: uangTitipanSantri, pesanTitipan: pesanTitipan };
})();

// ======================================================================
// FITUR LANJUTAN WASIAT (PRM_) -- semuanya GRATIS: hanya Apps Script, Sheets,
// Drive, push OneSignal, dan WA yang sudah dipakai.
//
//  1. Laporan Perkembangan Bulanan santri (untuk wali, ber-QR)
//  2. Kondisi Pondok Hari Ini (Mudir/Admin/Kabag)
//  3. Peringatan dini santri
//  4. Jadwal otomatis: pengingat SPP + kabar laporan bulanan + peringatan dini
//  5. Kartu santri ber-QR (data kartu)
//  6. Rapor resmi ber-QR
//  7. PPDB online
//
// Prinsip: modul ini HANYA MEMBACA data lama lewat fungsi yang sudah ada, dan menulis
// ke sheet BARUnya sendiri (LaporanPerkembangan, PeringatanDini, RaporResmi, PPDB).
// Tidak ada sheet lama yang diubah strukturnya. Pekerjaan berat dihitung terjadwal atau
// diingat sementara di cache, supaya absensi, hafalan, dan kasir tidak ikut melambat.
// ======================================================================
var PRM_ = (function () {
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const ADM = ['Admin', 'Mudir'];
  const PIMPINAN = ['Admin', 'Mudir', 'KabagPutra', 'KabagPutri', 'Kabag'];
  const SH_LP = 'LaporanPerkembangan';
  const SH_PD = 'PeringatanDini';
  const SH_RAPOR = 'RaporResmi';
  const SH_PPDB = 'PPDB';
  const HEAD = {
    LaporanPerkembangan: ['Kode', 'NISN', 'Nama', 'Periode', 'Dibuat', 'Ringkasan'],
    PeringatanDini: ['Tanggal', 'NISN', 'Nama', 'Kelas', 'Halaqoh', 'Kode', 'Alasan', 'Level'],
    RaporResmi: ['ID', 'Kode', 'NISN', 'Nama', 'Kelas', 'Semester', 'Diterbitkan', 'Oleh', 'File ID', 'Status', 'Catatan'],
    PPDB: ['ID', 'No Daftar', 'Waktu', 'Nama', 'JK', 'Tempat Lahir', 'Tanggal Lahir', 'Asal Sekolah', 'Jenjang', 'Nama Ayah', 'Nama Ibu',
      'No WA', 'Alamat', 'Catatan', 'Berkas', 'Status', 'Catatan Panitia', 'Diproses Oleh', 'Diproses Pada', 'NISN', 'Kode Cek'],
  };

  /* ---------------- util ---------------- */
  const tz_ = function () { return Session.getScriptTimeZone(); };
  const ymd_ = function (d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); };
  const stamp_ = function () { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'); };
  const pad_ = function (n, d) { return String(n).padStart(d || 2, '0'); };
  function teks_(v) { return v instanceof Date ? ymd_(v) : norm(v); }
  function aman_(f, cadangan) { try { return f(); } catch (e) { Logger.log('PRM_: ' + (e && e.message)); return cadangan; } }
  function kodeAcak_(awal, panjang) {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = awal;
    while (s.length < (panjang || 10)) s += A.charAt(Math.floor(Math.random() * A.length));
    return s;
  }
  function kodeBersih_(k) { return String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function wajib_(ok, pesan) { if (!ok) throw new Error(pesan || 'Akun Anda tidak memiliki akses untuk tindakan ini.'); }
  function punya_(me, list) { return me.roles.some(function (r) { return list.indexOf(r) >= 0; }); }
  function hanyaWali_(me) { return me.roles.length > 0 && me.roles.every(function (r) { return r === 'WaliSantri'; }); }
  function bolehNisn_(me, nisn) { return !hanyaWali_(me) ? !!me.roles.length : me.terkait.map(String).indexOf(String(nisn)) >= 0; }
  function props_() { return PropertiesService.getScriptProperties(); }
  function cache_() { try { return CacheService.getScriptCache(); } catch (e) { return null; } }
  function ingat_(kunci, detik, f) {
    const c = cache_();
    if (c) { try { const a = c.get(kunci); if (a) return JSON.parse(a); } catch (e) { } }
    const v = f();
    if (c) { try { const s = JSON.stringify(v); if (s.length < 95000) c.put(kunci, s, detik); } catch (e) { } }
    return v;
  }

  function sheet_(nama) {
    const ss = getMasterSS();
    let sh = ss.getSheetByName(nama);
    if (!sh) {
      sh = ss.insertSheet(nama);
      sh.getRange(1, 1, 1, HEAD[nama].length).setValues([HEAD[nama]]);
      sh.setFrozenRows(1);
      ['NISN', 'Kode', 'No Daftar', 'Periode', 'No WA', 'Kode Cek'].forEach(function (k) {
        const c = HEAD[nama].indexOf(k);
        if (c >= 0) { try { sh.getRange(1, c + 1, sh.getMaxRows(), 1).setNumberFormat('@'); } catch (e) { } }
      });
    }
    return sh;
  }
  function rows_(nama) {
    const sh = getMasterSS().getSheetByName(nama);
    if (!sh || sh.getLastRow() < 2) return [];
    const h = HEAD[nama];
    return sh.getRange(2, 1, sh.getLastRow() - 1, h.length).getValues().map(function (r, i) {
      const o = { _row: i + 2 };
      h.forEach(function (k, j) { o[k] = r[j] instanceof Date ? Utilities.formatDate(r[j], tz_(), k === 'Tanggal Lahir' || k === 'Tanggal' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss') : r[j]; });
      return o;
    }).filter(function (o) { return o[h[0]] !== '' && o[h[0]] != null; });
  }
  function tulis_(nama, baris, obj) {
    const sh = sheet_(nama);
    const nilai = HEAD[nama].map(function (k) { return obj[k] == null ? '' : obj[k]; });
    if (baris) sh.getRange(baris, 1, 1, nilai.length).setValues([nilai]); else sh.appendRow(nilai);
  }
  function ubah_(nama, r, perubahan) {
    const o = {}; HEAD[nama].forEach(function (k) { o[k] = k in perubahan ? perubahan[k] : r[k]; });
    tulis_(nama, r._row, o);
    return o;
  }

  /* ---------------- data dasar santri (sekali baca) ---------------- */
  function petaSantri_() {
    const ss = getAktifSS();
    const v = ss.getSheetByName(SHEET_SANTRI).getDataRange().getValues();
    const h = v[0].map(function (x) { return norm(x); });
    const iJK = h.indexOf('Jenis Kelamin') > -1 ? h.indexOf('Jenis Kelamin') : 3;
    const peta = {};
    v.slice(1).forEach(function (r) {
      const n = norm(r[0]).replace(/^'/, ''); if (!n) return;
      peta[n] = { nisn: n, nama: norm(r[1]), tahunMasuk: r[2], jk: norm(r[iJK]), noWa: norm(r[4]), kelas: '', halaqoh: '' };
    });
    aman_(function () { const sh = ss.getSheetByName(SHEET_ROMBEL); if (sh) sh.getDataRange().getValues().slice(1).forEach(function (r) { const n = norm(r[0]); if (peta[n]) peta[n].kelas = norm(r[2]); }); });
    aman_(function () { const sh = ss.getSheetByName(SHEET_HALAQOH_ANGGOTA); if (sh) sh.getDataRange().getValues().slice(1).forEach(function (r) { const n = norm(r[0]); if (peta[n] && !peta[n].halaqoh) peta[n].halaqoh = norm(r[2]); }); });
    return peta;
  }
  function namaLembaga_() { return aman_(function () { return getPengaturan().NamaPesantren; }, '') || 'Pondok Pesantren'; }
  function waliKelas_() {
    const peta = {};
    aman_(function () {
      const v = getAktifSS().getSheetByName(SHEET_GURU).getDataRange().getValues();
      const i = v[0].map(function (x) { return norm(x); }).indexOf('WaliKelas');
      if (i < 0) return;
      v.slice(1).forEach(function (r) { const k = norm(r[i]); if (k && norm(r[0])) k.split(',').forEach(function (kk) { kk = kk.trim(); if (kk) peta[kk] = norm(r[0]); }); });
    });
    return peta;
  }

  /* ================================================================
   *  1. LAPORAN PERKEMBANGAN BULANAN
   * ================================================================ */
  function periode_(bulan, tahun) { return 'LP-' + tahun + '-' + pad_(bulan); }
  function sudahBerakhir_(bulan, tahun) { const n = new Date(); return tahun < n.getFullYear() || (tahun === n.getFullYear() && bulan < n.getMonth() + 1); }

  function hitungLaporan_(nisn, bulan, tahun) {
    const mulai = tahun + '-' + pad_(bulan) + '-01';
    const akhir = tahun + '-' + pad_(bulan) + '-' + pad_(new Date(tahun, bulan, 0).getDate());
    const s = petaSantri_()[nisn];
    if (!s) throw new Error('Data santri tidak ditemukan.');
    const out = { santri: { nisn: s.nisn, nama: s.nama, kelas: s.kelas, halaqoh: s.halaqoh, jk: s.jk }, bulan: bulan, tahun: tahun,
      namaBulan: BULAN[bulan - 1], mulai: mulai, akhir: akhir, lembaga: namaLembaga_(), waliKelas: waliKelas_()[s.kelas] || '' };

    out.asrama = aman_(function () {
      const r = apiGetKehadiranHarianSantri({ nisn: nisn, tglMulai: mulai, tglAkhir: akhir });
      return r && r.ok ? r.rekap : null;
    }, null);

    out.kelasAbsen = aman_(function () {
      const rows = getRiwayatAbsensi({ nisn: nisn, tanggalMulai: mulai, tanggalAkhir: akhir }).filter(function (x) { return x.tipeAbsen === 'Akademik'; });
      const r = { hadir: 0, sakit: 0, izin: 0, alpa: 0, total: rows.length, sikap: null };
      let js = 0, ns = 0;
      const alpaMapel = {};
      rows.forEach(function (x) {
        if (x.status === 'Hadir') r.hadir++;
        else if (x.status === 'Sakit') r.sakit++;
        else if (x.status === 'Izin' || x.status === 'Izin Pulang') r.izin++;
        else { r.alpa++; alpaMapel[x.mapel] = (alpaMapel[x.mapel] || 0) + 1; }
        if (x.nilaiSikap !== '' && x.nilaiSikap != null && !isNaN(Number(x.nilaiSikap))) { js += Number(x.nilaiSikap); ns++; }
      });
      r.persen = r.total ? Math.round(r.hadir * 100 / r.total) : null;
      r.sikap = ns ? Math.round(js / ns * 100) / 100 : null;
      r.alpaMapel = Object.keys(alpaMapel).map(function (m) { return { mapel: m, jumlah: alpaMapel[m] }; });
      return r;
    }, null);

    out.hafalan = aman_(function () {
      const r = apiGetRiwayatHafalanBulan({ nisn: nisn, bulan: bulan, tahun: tahun });
      const data = r && r.ok ? r.data : [];
      const perJenis = {};
      let setor = 0, hadir = 0, tidakHadir = 0;
      const halaman = {};
      let terakhir = null;
      data.forEach(function (x) {
        perJenis[x.jenis] = (perJenis[x.jenis] || 0) + 1;
        if (JENIS_HAFALAN_SETOR.indexOf(x.jenis) >= 0) setor++;
        if (JENIS_HAFALAN_DIANGGAP_HADIR.indexOf(x.jenis) >= 0) hadir++; else tidakHadir++;
        if (x.jenis === 'Sabaq') {
          String(x.halaman || '').split(/[,;]/).forEach(function (h) {
            const m = String(h).match(/(\d+)\s*-\s*(\d+)/);
            if (m) { for (let i = Number(m[1]); i <= Number(m[2]) && i - Number(m[1]) < 40; i++) halaman[i] = 1; }
            else if (/\d/.test(h)) halaman[String(h).replace(/\D/g, '')] = 1;
          });
          terakhir = x;
        }
      });
      return { pertemuan: data.length, setor: setor, hadir: hadir, tidakHadir: tidakHadir, perJenis: perJenis, sabaqHalaman: Object.keys(halaman).length,
        sabaqTerakhir: terakhir ? { tanggal: terakhir.tanggal, surah: terakhir.surah, ayat: terakhir.ayat, juz: terakhir.juz, halaman: terakhir.halaman } : null,
        nilai: data.filter(function (x) { return x.nilai; }).slice(-5).map(function (x) { return { tanggal: x.tanggal, jenis: x.jenis, nilai: x.nilai }; }) };
    }, null);

    out.progres = aman_(function () {
      const r = apiGetProgressHafalan({ nisn: nisn });
      if (!r || !r.ok) return null;
      return { persen: r.data.persen, juzSelesai: r.data.totalJuzSelesai, halaman: r.data.totalHalamanTersetor, ringkasan: r.data.ringkasan };
    }, null);

    out.nilai = aman_(function () {
      const list = getRiwayatNilai({ nisn: nisn }).filter(function (x) { return x.tanggal >= mulai && x.tanggal <= akhir; });
      const per = {};
      list.forEach(function (x) { const k = x.mapel; if (!per[k]) per[k] = { mapel: k, nilai: [] }; per[k].nilai.push({ jenis: x.jenisNilai, nilai: x.nilai }); });
      return Object.keys(per).map(function (k) {
        const angka = per[k].nilai.map(function (n) { return Number(n.nilai); }).filter(function (n) { return !isNaN(n); });
        return { mapel: k, jumlah: per[k].nilai.length, rata: angka.length ? Math.round(angka.reduce(function (a, b) { return a + b; }, 0) / angka.length * 10) / 10 : null,
          rincian: per[k].nilai.map(function (n) { return n.jenis + ' ' + n.nilai; }).join(', ') };
      });
    }, []);

    out.perilaku = aman_(function () {
      const list = getRiwayatPelanggaranSantri(nisn).filter(function (x) { return x.tanggal >= mulai && x.tanggal <= akhir; });
      return { pelanggaran: list.filter(function (x) { return x.pelanggaran; }).map(function (x) { return { tanggal: x.tanggal, isi: x.pelanggaran, poin: x.poinPelanggaran }; }),
        prestasi: list.filter(function (x) { return x.prestasi; }).map(function (x) { return { tanggal: x.tanggal, isi: x.prestasi, poin: x.poinPrestasi }; }),
        poinPelanggaran: list.reduce(function (a, x) { return a + (Number(x.poinPelanggaran) || 0); }, 0),
        poinPrestasi: list.reduce(function (a, x) { return a + (Number(x.poinPrestasi) || 0); }, 0) };
    }, null);

    out.spp = aman_(function () { const r = getSppSaya(nisn); return { ada: r.adaSpp, bebas: r.bebas, tunggakan: r.totalTunggakan, bulan: r.bulanTunggakan }; }, null);
    return out;
  }

  function api_laporanSantri(p, me) {
    const nisn = norm(p.nisn).replace(/^'/, '');
    wajib_(bolehNisn_(me, nisn), 'Anda tidak memiliki akses ke data santri ini.');
    const n = new Date();
    const bulan = Number(p.bulan) || n.getMonth() + 1, tahun = Number(p.tahun) || n.getFullYear();
    if (tahun > n.getFullYear() || (tahun === n.getFullYear() && bulan > n.getMonth() + 1)) throw new Error('Bulan tersebut belum berjalan.');
    const selesai = sudahBerakhir_(bulan, tahun);
    // Bulan yang sudah berakhir: hasil diingat 6 jam (datanya tidak berubah lagi)
    const data = selesai ? ingat_('prm_lp_' + nisn + '_' + tahun + pad_(bulan), 21600, function () { return hitungLaporan_(nisn, bulan, tahun); })
      : hitungLaporan_(nisn, bulan, tahun);
    data.final = selesai;
    if (selesai) {
      // Kode keaslian: satu per santri per bulan, dibuat saat laporan pertama kali dibuka
      const per = periode_(bulan, tahun);
      let r = rows_(SH_LP).find(function (x) { return String(x.NISN) === nisn && String(x.Periode) === per; });
      if (!r) {
        const lock = LockService.getScriptLock(); lock.waitLock(20000);
        try {
          r = rows_(SH_LP).find(function (x) { return String(x.NISN) === nisn && String(x.Periode) === per; });
          if (!r) {
            r = { Kode: kodeAcak_('P'), NISN: nisn, Nama: data.santri.nama, Periode: per, Dibuat: stamp_(),
              Ringkasan: JSON.stringify({ asrama: data.asrama && data.asrama.persen, kelas: data.kelasAbsen && data.kelasAbsen.persen, setor: data.hafalan && data.hafalan.setor }) };
            tulis_(SH_LP, null, r);
          }
        } finally { lock.releaseLock(); }
      }
      data.kode = r.Kode;
      data.nomor = 'LP/' + pad_(bulan) + '/' + tahun + '/' + nisn;
    }
    return data;
  }

  /** Daftar santri yang boleh dilihat akun ini (untuk pemilih santri di halaman laporan). */
  function api_daftarSantriSaya(p, me) {
    const peta = petaSantri_();
    let list = Object.keys(peta).map(function (k) { return peta[k]; });
    if (hanyaWali_(me)) list = list.filter(function (s) { return me.terkait.indexOf(s.nisn) >= 0; });
    return list.map(function (s) { return { nisn: s.nisn, nama: s.nama, kelas: s.kelas }; }).sort(function (a, b) { return (a.kelas + a.nama).localeCompare(b.kelas + b.nama); });
  }

  function verifikasi(k) {
    k = kodeBersih_(k);
    if (k.charAt(0) === 'P') {
      const r = rows_(SH_LP).find(function (x) { return kodeBersih_(x.Kode) === k; });
      if (!r) return null;
      const m = String(r.Periode).match(/^LP-(\d{4})-(\d{2})$/);
      return { ditemukan: true, sah: true, lembaga: namaLembaga_(), jenisDokumen: 'Laporan Perkembangan Santri',
        nomor: 'LP/' + (m ? m[2] + '/' + m[1] : '') + '/' + r.NISN, tanggal: String(r.Dibuat).slice(0, 10), jenis: 'Laporan bulanan',
        perihal: 'Perkembangan ' + (m ? BULAN[Number(m[2]) - 1] + ' ' + m[1] : '') + ' a.n. ' + r.Nama, penandatangan: 'Sistem WASIAT' };
    }
    if (k.charAt(0) === 'R') {
      const r = rows_(SH_RAPOR).find(function (x) { return kodeBersih_(x.Kode) === k; });
      if (!r) return null;
      return { ditemukan: true, sah: r.Status === 'Sah', lembaga: namaLembaga_(), jenisDokumen: 'Rapor Santri', nomor: 'RPT/' + r.NISN + '/' + r.Semester,
        tanggal: String(r.Diterbitkan).slice(0, 10), jenis: 'Rapor semester ' + r.Semester, perihal: 'Rapor a.n. ' + r.Nama + ' (kelas ' + r.Kelas + ')',
        penandatangan: 'Diterbitkan oleh ' + r.Oleh };
    }
    return null;
  }

  /** Kirim kabar "laporan bulan X sudah tersedia" ke semua wali, bertahap (dipanggil jadwal). */
  function kabarLaporanBertahap_(batas) {
    const n = new Date();
    const pb = n.getMonth() === 0 ? 12 : n.getMonth(), pt = n.getMonth() === 0 ? n.getFullYear() - 1 : n.getFullYear();
    const per = periode_(pb, pt);
    let st = {}; try { st = JSON.parse(props_().getProperty('PRM_KABAR_LP') || '{}'); } catch (e) { }
    if (st.periode === per && st.selesai) return { dilewati: true };
    if (st.periode !== per) st = { periode: per, idx: 0, selesai: false, push: 0, wa: 0 };
    const daftar = Object.keys(petaSantri_()).sort();
    const peta = petaSantri_();
    const waMati = aman_(function () { return jenisWANonaktif_()['laporan_bulanan']; }, false);
    const sampai = Math.min(daftar.length, st.idx + (batas || 60));
    for (let i = st.idx; i < sampai; i++) {
      const s = peta[daftar[i]];
      const isi = 'Laporan perkembangan ' + s.nama + ' bulan ' + BULAN[pb - 1] + ' ' + pt + ' (kehadiran, hafalan, nilai, perilaku) sudah tersedia di aplikasi WASIAT, menu Laporan.';
      aman_(function () { kirimPushKeWali(s.nisn, '📊 Laporan bulanan ' + s.nama, isi); st.push++; });
      if (!waMati && s.noWa) {
        aman_(function () {
          kirimWAKategori_('laporan_bulanan', s.noWa, 'Assalamualaikum Wr. Wb.\n\nYth. Orang Tua/Wali Santri *' + s.nama + '*\n\n' + isi + '\n\nJazakumullah khairan.');
          st.wa++; Utilities.sleep(800);
        });
      }
    }
    st.idx = sampai; st.selesai = sampai >= daftar.length;
    props_().setProperty('PRM_KABAR_LP', JSON.stringify(st));
    return st;
  }

  /* ================================================================
   *  2. KONDISI PONDOK HARI INI
   * ================================================================ */
  function hitungKondisi_(token) {
    const ss = getAktifSS();
    const hariIni = ymd_(new Date());
    const tujuh = []; for (let i = 6; i >= 0; i--) tujuh.push(ymd_(new Date(Date.now() - i * 86400000)));
    const out = { tanggal: hariIni, dibuat: stamp_(), tren: tujuh.map(function (t) { return { tanggal: t, hadirAsrama: null, setoran: 0, pemasukan: 0, pengeluaran: 0, pelanggaran: 0 }; }) };
    const idx = {}; tujuh.forEach(function (t, i) { idx[t] = i; });

    out.santri = aman_(function () {
      const r = apiGetStatusPondok({});
      return r && r.ok ? { total: r.total, diPondok: r.diPondok, hadir: r.hadir, sakit: r.sakit, izin: r.izin, alpa: r.alpa, izinPulang: r.izinPulang,
        sudahAbsen: r.sudahAbsen, putra: r.putra, putri: r.putri, sakitList: (r.sakitList || []).slice(0, 15), izinPulangList: (r.izinPulangList || []).slice(0, 15) } : null;
    }, null);

    // Absensi asrama 7 hari (persen hadir per hari)
    aman_(function () {
      const sh = ss.getSheetByName(SHEET_ABSENSI_HARIAN);
      if (!sh || sh.getLastRow() < 2) return;
      const per = {};
      nilaiCatatanUnik_(sh).slice(1).forEach(function (r) {
        const t = teks_(r[0]); if (!(t in idx)) return;
        const k = t + '|' + norm(r[2]);
        per[k] = norm(r[5]);
      });
      const hit = {};
      Object.keys(per).forEach(function (k) { const t = k.split('|')[0]; if (!hit[t]) hit[t] = { h: 0, n: 0 }; hit[t].n++; if (per[k] === 'Hadir') hit[t].h++; });
      Object.keys(hit).forEach(function (t) { out.tren[idx[t]].hadirAsrama = Math.round(hit[t].h * 100 / hit[t].n); });
    });

    // Hafalan: setoran hari ini + 7 hari
    out.hafalan = aman_(function () {
      const sh = ss.getSheetByName(SHEET_HAFALAN);
      const r = { setoran: 0, sabaq: 0, santri: 0, tidakSetor: 0, halaqohTerisi: 0 };
      if (!sh || sh.getLastRow() < 2) return r;
      const santri = {}, halaqoh = {};
      nilaiCatatanUnik_(sh).slice(1).forEach(function (x) {
        const t = teks_(x[0]); if (!(t in idx)) return;
        const jenis = norm(x[6]);
        const setor = JENIS_HAFALAN_SETOR.indexOf(jenis) >= 0;
        if (setor) out.tren[idx[t]].setoran++;
        if (t !== hariIni) return;
        if (setor) { r.setoran++; santri[norm(x[4])] = 1; }
        if (jenis === 'Sabaq') r.sabaq++;
        if (jenis === 'Tidak Setor') r.tidakSetor++;
        halaqoh[norm(x[2]) + '|' + norm(x[1])] = 1;
      });
      r.santri = Object.keys(santri).length; r.halaqohTerisi = Object.keys(halaqoh).length;
      return r;
    }, null);

    // Mengajar hari ini: sesi tercatat & jurnal
    out.mengajar = aman_(function () {
      const st = getStatusJurnalHariIni();
      const guru = {}; st.forEach(function (x) { guru[x.pengampu] = 1; });
      return { sesi: st.length, guru: Object.keys(guru).length, jurnalBelum: st.filter(function (x) { return !x.sudahIsiJurnal; }).length };
    }, null);

    // Keuangan
    out.keuangan = aman_(function () {
      const n = new Date();
      const d = getDashboardKeuangan(n.getMonth() + 1, n.getFullYear());
      const tg = getTunggakanSantri().filter(function (s) { return !s.status; });
      const r = { saldo: d.saldoKumulatif, masukBulan: d.pemasukanBulan, keluarBulan: d.pengeluaranBulan,
        tunggakanSantri: tg.length, tunggakanTotal: tg.reduce(function (a, s) { return a + s.tunggakanSPP; }, 0) };
      const kas = getMasterSS().getSheetByName(SHEET_KAS_UMUM);
      if (kas && kas.getLastRow() > 1) {
        kas.getRange(2, 1, kas.getLastRow() - 1, 6).getValues().forEach(function (x) {
          const t = teks_(x[1]); if (!(t in idx)) return;
          if (norm(x[2]) === 'Pemasukan') out.tren[idx[t]].pemasukan += Number(x[5]) || 0; else out.tren[idx[t]].pengeluaran += Number(x[5]) || 0;
        });
      }
      return r;
    }, null);

    // Pelanggaran 7 hari
    out.pelanggaranHariIni = aman_(function () {
      const sh = getPelanggaranAktifSS().getSheetByName(SHEET_PENCATATAN_PEL);
      if (!sh || sh.getLastRow() < 2) return 0;
      let hariIniN = 0;
      sh.getDataRange().getValues().slice(1).forEach(function (x) {
        const t = teks_(x[0]); if (!(t in idx) || !norm(x[3])) return;
        out.tren[idx[t]].pelanggaran++;
        if (t === hariIni) hariIniN++;
      });
      return hariIniN;
    }, 0);

    // Hal yang menunggu keputusan
    out.menunggu = aman_(function () {
      const m = { konfirmasiTransfer: 0, pengajuanDana: 0, laporanKeuangan: 0, saldoKantin: 0, surat: 0, izinGuru: 0, peringatanDini: 0 };
      const hitung = function (nama, kolom, nilai) {
        const sh = getMasterSS().getSheetByName(nama); if (!sh || sh.getLastRow() < 2) return 0;
        const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return norm(x); });
        const c = h.indexOf(kolom); if (c < 0) return 0;
        return sh.getRange(2, c + 1, sh.getLastRow() - 1, 1).getValues().filter(function (x) { return norm(x[0]) === nilai; }).length;
      };
      m.konfirmasiTransfer = hitung('KonfirmasiTransfer', 'Status', 'Menunggu');
      m.pengajuanDana = hitung('PengajuanDana', 'Status', 'Menunggu');
      m.laporanKeuangan = hitung('TutupBuku', 'Status', 'Menunggu Pengesahan');
      m.saldoKantin = aman_(function () { return getNotifBadge().pengajuanPending; }, 0);
      m.surat = aman_(function () { const r = SURAT_.ringkasUntukWasiat(token); return r && r.ok ? r.menunggu : 0; }, 0);
      m.izinGuru = aman_(function () {
        const sh = getAktifSS().getSheetByName(SHEET_IZIN_GURU); if (!sh || sh.getLastRow() < 2) return 0;
        const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return norm(x); });
        const c = h.indexOf('Status'); if (c < 0) return 0;
        return sh.getRange(2, c + 1, sh.getLastRow() - 1, 1).getValues().filter(function (x) { return /menunggu|pending|diajukan/i.test(norm(x[0])); }).length;
      }, 0);
      m.peringatanDini = rows_(SH_PD).length;
      return m;
    }, null);
    return out;
  }
  function api_kondisiPondok(p, me, token) {
    wajib_(punya_(me, PIMPINAN), 'Hanya Mudir, Admin, atau Kepala Bagian.');
    if (p.segarkan) { const c = cache_(); if (c) try { c.remove('prm_kondisi'); } catch (e) { } }
    return ingat_('prm_kondisi', 300, function () { return hitungKondisi_(token); });
  }

  /* ================================================================
   *  3. PERINGATAN DINI
   *  Melihat 14 hari terakhir. Aturan sengaja sederhana dan bisa dijelaskan:
   *   - Alpa asrama >= 2 hari, atau alpa di kelas >= 3 jam pelajaran
   *   - Sakit >= 3 hari
   *   - Tidak ada Sabaq (hafalan baru) 14 hari padahal 30 hari sebelumnya ada
   *   - Pelanggaran >= 2 kali, atau poin pelanggaran >= 20
   * ================================================================ */
  const ATURAN_PD = { alpaAsrama: 2, alpaKelas: 3, sakit: 3, hariSabaq: 14, pelanggaran: 2, poin: 20 };
  function hitungPeringatan_() {
    const ss = getAktifSS();
    const peta = petaSantri_();
    const now = Date.now();
    const b14 = ymd_(new Date(now - 13 * 86400000)), b44 = ymd_(new Date(now - 43 * 86400000)), hari = ymd_(new Date(now));
    const d = {}; const get = function (n) { if (!d[n]) d[n] = { alpaA: 0, sakit: 0, alpaK: 0, sabaq14: 0, sabaqLama: 0, pel: 0, poin: 0, hariA: {} }; return d[n]; };
    aman_(function () {
      const sh = ss.getSheetByName(SHEET_ABSENSI_HARIAN); if (!sh || sh.getLastRow() < 2) return;
      const per = {};
      nilaiCatatanUnik_(sh).slice(1).forEach(function (r) { const t = teks_(r[0]); if (t < b14 || t > hari) return; per[norm(r[2]) + '|' + t] = norm(r[5]); });
      Object.keys(per).forEach(function (k) { const n = k.split('|')[0], st = per[k]; if (st === 'Alpa') get(n).alpaA++; else if (st === 'Sakit') get(n).sakit++; });
    });
    aman_(function () {
      const sh = ss.getSheetByName(SHEET_ABSENSI); if (!sh || sh.getLastRow() < 2) return;
      nilaiCatatanUnik_(sh).slice(1).forEach(function (r) { const t = teks_(r[0]); if (t < b14 || t > hari) return; if (norm(r[16] || 'Akademik') !== 'Akademik') return; if (norm(r[8]) === 'Alpa') get(norm(r[6])).alpaK++; });
    });
    aman_(function () {
      const sh = ss.getSheetByName(SHEET_HAFALAN); if (!sh || sh.getLastRow() < 2) return;
      nilaiCatatanUnik_(sh).slice(1).forEach(function (r) {
        if (norm(r[6]) !== 'Sabaq') return;
        const t = teks_(r[0]); if (t < b44 || t > hari) return;
        if (t >= b14) get(norm(r[4])).sabaq14++; else get(norm(r[4])).sabaqLama++;
      });
    });
    aman_(function () {
      const sh = getPelanggaranAktifSS().getSheetByName(SHEET_PENCATATAN_PEL); if (!sh || sh.getLastRow() < 2) return;
      sh.getDataRange().getValues().slice(1).forEach(function (r) { const t = teks_(r[0]); if (t < b14 || t > hari || !norm(r[3])) return; const x = get(norm(r[1])); x.pel++; x.poin += Number(r[4]) || 0; });
    });
    const hasil = [];
    Object.keys(d).forEach(function (n) {
      const s = peta[n]; if (!s) return;
      const x = d[n], alasan = [];
      let level = 0;
      if (x.alpaA >= ATURAN_PD.alpaAsrama) { alasan.push({ k: 'alpa', t: 'Alpa di asrama ' + x.alpaA + ' hari (14 hari terakhir)' }); level += 2; }
      if (x.alpaK >= ATURAN_PD.alpaKelas) { alasan.push({ k: 'alpakelas', t: 'Alpa di kelas ' + x.alpaK + ' jam pelajaran' }); level += 1; }
      if (x.sakit >= ATURAN_PD.sakit) { alasan.push({ k: 'sakit', t: 'Sakit ' + x.sakit + ' hari — perlu dipantau kesehatannya' }); level += 1; }
      if (x.sabaq14 === 0 && x.sabaqLama > 0) { alasan.push({ k: 'hafalan', t: 'Belum ada hafalan baru (Sabaq) selama 2 pekan' }); level += 1; }
      if (x.pel >= ATURAN_PD.pelanggaran || x.poin >= ATURAN_PD.poin) { alasan.push({ k: 'perilaku', t: x.pel + ' pelanggaran (' + x.poin + ' poin) dalam 2 pekan' }); level += 2; }
      if (alasan.length) hasil.push({ nisn: n, nama: s.nama, kelas: s.kelas, halaqoh: s.halaqoh, jk: s.jk, alasan: alasan, level: level >= 3 ? 'Tinggi' : 'Perlu perhatian' });
    });
    return hasil.sort(function (a, b) { return (b.level === 'Tinggi') - (a.level === 'Tinggi') || a.kelas.localeCompare(b.kelas) || a.nama.localeCompare(b.nama); });
  }
  /** Hitung ulang & simpan (dipanggil jadwal harian atau tombol Perbarui). Mengabari wali kelas untuk temuan BARU saja. */
  function perbaruiPeringatan_(kabari) {
    const hasil = hitungPeringatan_();
    const sh = sheet_(SH_PD);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, HEAD[SH_PD].length).clearContent();
    const hari = ymd_(new Date());
    if (hasil.length) {
      sh.getRange(2, 1, hasil.length, HEAD[SH_PD].length).setValues(hasil.map(function (x) {
        return [hari, x.nisn, x.nama, x.kelas, x.halaqoh, x.alasan.map(function (a) { return a.k; }).join(','), x.alasan.map(function (a) { return a.t; }).join(' | '), x.level];
      }));
    }
    props_().setProperty('PRM_PD_TERAKHIR', stamp_());
    if (kabari) {
      // hanya temuan yang belum dikabarkan dalam 7 hari terakhir
      let sudah = {}; try { sudah = JSON.parse(props_().getProperty('PRM_PD_KABAR') || '{}'); } catch (e) { }
      const batas = Date.now() - 7 * 86400000;
      Object.keys(sudah).forEach(function (k) { if (sudah[k] < batas) delete sudah[k]; });
      const wk = waliKelas_();
      const perGuru = {};
      let baru = 0;
      hasil.forEach(function (x) {
        const k = x.nisn + '|' + x.alasan.map(function (a) { return a.k; }).join(',');
        if (sudah[k]) return;
        sudah[k] = Date.now(); baru++;
        const g = wk[x.kelas]; if (g) { (perGuru[g] = perGuru[g] || []).push(x.nama); }
      });
      Object.keys(perGuru).forEach(function (g) {
        aman_(function () { kirimPushOneSignal([g], '⚠️ Santri perlu perhatian', perGuru[g].slice(0, 5).join(', ') + (perGuru[g].length > 5 ? ' dan lainnya' : '') + '. Buka menu Peringatan Dini.', '', { jenis: 'peringatan' }); });
      });
      if (baru) {
        aman_(function () {
          const pimpinan = getAktifSS().getSheetByName(SHEET_ROLE).getDataRange().getValues().slice(1)
            .filter(function (r) { return /Mudir|Admin|Kabag/.test(norm(r[3])); }).map(function (r) { return norm(r[0]); });
          if (pimpinan.length) kirimPushOneSignal(pimpinan, '⚠️ Peringatan dini santri', baru + ' temuan baru: ' + hasil.length + ' santri perlu perhatian. Buka menu Peringatan Dini.', '', { jenis: 'peringatan' });
        });
      }
      props_().setProperty('PRM_PD_KABAR', JSON.stringify(sudah).slice(0, 8500));
    }
    return hasil.length;
  }
  function api_peringatanDini(p, me) {
    const pimpinan = punya_(me, PIMPINAN);
    let kelasSaya = [];
    if (!pimpinan) {
      const wk = waliKelas_();
      kelasSaya = Object.keys(wk).filter(function (k) { return normNama(wk[k]) === normNama(me.nama); });
      wajib_(kelasSaya.length || punya_(me, ['Pembina', 'PembinaPutra', 'PembinaPutri']), 'Peringatan dini untuk wali kelas, pembina, Kepala Bagian, Admin, dan Mudir.');
    }
    if (p.perbarui) { wajib_(pimpinan, 'Hanya pimpinan yang dapat menghitung ulang.'); perbaruiPeringatan_(false); }
    let list = rows_(SH_PD).map(function (r) { return { nisn: String(r.NISN), nama: r.Nama, kelas: r.Kelas, halaqoh: r.Halaqoh, alasan: String(r.Alasan).split(' | '), level: r.Level, tanggal: r.Tanggal }; });
    if (!pimpinan && kelasSaya.length) list = list.filter(function (x) { return kelasSaya.indexOf(x.kelas) >= 0; });
    if (!pimpinan && !kelasSaya.length) {
      // Pembina: santri sesuai gender asrama yang dibina
      const g = punya_(me, ['PembinaPutri']) ? 'perempuan' : (punya_(me, ['PembinaPutra']) ? 'laki-laki' : '');
      if (g) { const peta = petaSantri_(); list = list.filter(function (x) { return peta[x.nisn] && peta[x.nisn].jk.toLowerCase() === g; }); }
    }
    return { data: list, terakhir: props_().getProperty('PRM_PD_TERAKHIR') || '', aturan: ATURAN_PD, pimpinan: pimpinan, kelasSaya: kelasSaya };
  }

  /* ================================================================
   *  4. JADWAL OTOMATIS (satu pemicu per jam, ringan)
   * ================================================================ */
  const PROP_JADWAL = 'PRM_JADWAL';
  function bacaJadwal_() {
    let j = {}; try { j = JSON.parse(props_().getProperty(PROP_JADWAL) || '{}'); } catch (e) { }
    return { sppAktif: !!j.sppAktif, sppTanggal: j.sppTanggal || [5, 20], sppMinBulan: Number(j.sppMinBulan) || 1,
      laporanAktif: j.laporanAktif !== false, laporanTanggal: Number(j.laporanTanggal) || 2,
      peringatanAktif: j.peringatanAktif !== false, jam: Number(j.jam) || 8 };
  }
  function pemicuAda_() { return aman_(function () { return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'prmJadwalOtomatis'; }); }, false); }
  function api_statusJadwal(p, me) {
    wajib_(punya_(me, ['Admin', 'Mudir', 'Bendahara']), 'Hanya Admin, Mudir, atau Bendahara.');
    let log = []; try { log = JSON.parse(props_().getProperty('PRM_JADWAL_LOG') || '[]'); } catch (e) { }
    const lama = aman_(function () { return ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'jalankanPengingatSPP'; }).length; }, 0);
    return { jadwal: bacaJadwal_(), aktif: pemicuAda_(), log: log, pemicuSppLama: lama };
  }
  function api_simpanJadwal(p, me) {
    wajib_(punya_(me, ['Admin', 'Mudir', 'Bendahara']), 'Hanya Admin, Mudir, atau Bendahara.');
    const lama = bacaJadwal_();
    const j = {
      sppAktif: p.sppAktif === true, sppMinBulan: Math.max(1, Math.min(12, Number(p.sppMinBulan) || 1)),
      sppTanggal: String(p.sppTanggal || '').split(/[^\d]+/).map(Number).filter(function (x) { return x >= 1 && x <= 28; }).slice(0, 4),
      laporanAktif: p.laporanAktif !== false, laporanTanggal: Math.max(1, Math.min(10, Number(p.laporanTanggal) || 2)),
      peringatanAktif: p.peringatanAktif !== false, jam: Math.max(6, Math.min(20, Number(p.jam) || 8)),
    };
    if (j.sppAktif && !j.sppTanggal.length) throw new Error('Isi tanggal pengingat SPP, misalnya 5, 20.');
    // Bendahara hanya boleh mengubah bagian SPP
    if (!punya_(me, ADM)) { j.laporanAktif = lama.laporanAktif; j.laporanTanggal = lama.laporanTanggal; j.peringatanAktif = lama.peringatanAktif; j.jam = lama.jam; }
    props_().setProperty(PROP_JADWAL, JSON.stringify(j));
    // Satu pemicu per jam. Pemicu SPP lama (tgl 7 & 20, dipasang manual dari editor) dilepas bila
    // pengingat SPP diatur dari sini, supaya wali tidak menerima pengingat dua kali.
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'prmJadwalOtomatis') ScriptApp.deleteTrigger(t);
      if (j.sppAktif && t.getHandlerFunction() === 'jalankanPengingatSPP') ScriptApp.deleteTrigger(t);
    });
    if (j.sppAktif || j.laporanAktif || j.peringatanAktif) ScriptApp.newTrigger('prmJadwalOtomatis').timeBased().everyHours(1).create();
    return api_statusJadwal(p, me);
  }
  function catatLog_(teks) {
    let log = []; try { log = JSON.parse(props_().getProperty('PRM_JADWAL_LOG') || '[]'); } catch (e) { }
    log.unshift(stamp_() + ' — ' + teks);
    props_().setProperty('PRM_JADWAL_LOG', JSON.stringify(log.slice(0, 15)));
  }
  /** Pengingat SPP bertahap: maksimal 40 wali per jalan, dilanjutkan jam berikutnya. */
  function pengingatSppBertahap_(j, kunciHari) {
    let st = {}; try { st = JSON.parse(props_().getProperty('PRM_SPP_JALAN') || '{}'); } catch (e) { }
    if (st.hari === kunciHari && st.selesai) return null;
    if (st.hari !== kunciHari) st = { hari: kunciHari, idx: 0, selesai: false, push: 0, wa: 0 };
    const waMati = aman_(function () { return jenisWANonaktif_()['spp_tagihan_otomatis']; }, false);
    const daftar = getTunggakanSantri().filter(function (s) { return !s.status && s.jumlahBulan >= j.sppMinBulan; });
    const sampai = Math.min(daftar.length, st.idx + 40);
    const logSh = aman_(function () {
      const ss = getMasterSS();
      let sh = ss.getSheetByName('LogTagihan');
      if (!sh) { sh = ss.insertSheet('LogTagihan'); sh.appendRow(['Waktu', 'NISN', 'Nama', 'Total', 'Jumlah Bulan', 'Kanal', 'Oleh']); sh.setFrozenRows(1); }
      return sh;
    }, null);
    for (let i = st.idx; i < sampai; i++) {
      const s = daftar[i];
      aman_(function () { kirimPushKeWali(s.nisn, '💳 Pengingat Pembayaran SPP', 'Tunggakan SPP ' + s.nama + ': Rp' + s.tunggakanSPP.toLocaleString('id-ID') + ' (' + s.jumlahBulan + ' bulan). Sudah transfer? Kirim buktinya di menu SPP aplikasi WASIAT.'); st.push++; });
      if (!waMati && s.noWa) {
        aman_(function () {
          const pesan = buildPesanTagihanSPP(s.nama, s.bulanTunggak, s.tunggakanSPP).replace('Jazakumullah khairan.',
            'Bila sudah membayar lewat transfer, cukup kirim foto buktinya di aplikasi WASIAT (menu SPP › Bayar lewat Transfer).\n\nJazakumullah khairan.');
          kirimWAKategori_('spp_tagihan_otomatis', s.noWa, pesan); st.wa++; Utilities.sleep(900);
        });
      }
      if (logSh) aman_(function () { logSh.appendRow([stamp_(), s.nisn, s.nama, s.tunggakanSPP, s.jumlahBulan, 'otomatis', 'Jadwal otomatis']); });
    }
    st.idx = sampai; st.selesai = sampai >= daftar.length; st.total = daftar.length;
    props_().setProperty('PRM_SPP_JALAN', JSON.stringify(st));
    return st;
  }
  function jalankanJadwal() {
    const j = bacaJadwal_();
    const n = new Date();
    const jam = Number(Utilities.formatDate(n, tz_(), 'H'));
    const tgl = Number(Utilities.formatDate(n, tz_(), 'd'));
    const hari = ymd_(n);
    if (jam < j.jam || jam > 21) return 'di luar jam kerja';
    const hasil = [];
    // Peringatan dini: sekali sehari
    if (j.peringatanAktif && props_().getProperty('PRM_PD_HARI') !== hari) {
      props_().setProperty('PRM_PD_HARI', hari);
      const nPd = aman_(function () { return perbaruiPeringatan_(true); }, -1);
      hasil.push('Peringatan dini: ' + nPd + ' santri');
    }
    // Pengingat SPP pada tanggal yang dipilih
    if (j.sppAktif && j.sppTanggal.indexOf(tgl) >= 0) {
      const st = aman_(function () { return pengingatSppBertahap_(j, hari); }, null);
      if (st) hasil.push('Pengingat SPP: ' + st.idx + '/' + st.total + ' wali (push ' + st.push + ', WA ' + st.wa + ')');
    }
    // Kabar laporan bulanan: mulai tanggal yang dipilih
    if (j.laporanAktif && tgl >= j.laporanTanggal) {
      const st = aman_(function () { return kabarLaporanBertahap_(60); }, null);
      if (st && !st.dilewati) hasil.push('Kabar laporan ' + st.periode + ': ' + st.idx + ' santri (push ' + st.push + ', WA ' + st.wa + ')');
    }
    if (hasil.length) catatLog_(hasil.join(' · '));
    return hasil.join(' · ') || 'tidak ada tugas';
  }

  /* ================================================================
   *  5. KARTU SANTRI (data kartu; QR berisi kode santri)
   * ================================================================ */
  function api_dataKartu(p, me) {
    wajib_(punya_(me, ['Admin', 'Mudir', 'Bendahara', 'KabagPutra', 'KabagPutri', 'Kabag']), 'Hanya Admin, Mudir, Bendahara, atau Kepala Bagian.');
    const peta = petaSantri_();
    let list = Object.keys(peta).map(function (k) { return peta[k]; });
    if (p.kelas) list = list.filter(function (s) { return s.kelas === p.kelas; });
    if (p.nisn && p.nisn.length) list = list.filter(function (s) { return p.nisn.indexOf(s.nisn) >= 0; });
    return { lembaga: namaLembaga_(), santri: list.map(function (s) { return { nisn: s.nisn, nama: s.nama, kelas: s.kelas, halaqoh: s.halaqoh, jk: s.jk, tahunMasuk: s.tahunMasuk }; })
      .sort(function (a, b) { return (a.kelas + a.nama).localeCompare(b.kelas + b.nama); }) };
  }

  /* ---------------- pintu masuk ---------------- */
  const HANDLERS = {
    laporanSantri: api_laporanSantri, daftarSantriSaya: api_daftarSantriSaya,
    kondisiPondok: api_kondisiPondok, peringatanDini: api_peringatanDini,
    statusJadwal: api_statusJadwal, simpanJadwal: api_simpanJadwal,
    dataKartu: api_dataKartu,
  };
  const PUBLIK = {};
  function daftarkan(nama, fn, publik) { HANDLERS[nama] = fn; if (publik) PUBLIK[nama] = true; }
  function tangani(req) {
    const fn = HANDLERS[req.action];
    if (!fn) return { ok: false, error: 'Aksi tidak dikenal: ' + req.action };
    try {
      if (PUBLIK[req.action]) return { ok: true, data: fn(req.payload || {}) };
      const me = (typeof AMAN_ !== 'undefined') ? AMAN_.identitas(req.token) : null;
      if (!me) return { ok: false, perluLogin: true, error: 'Sesi berakhir. Silakan keluar lalu masuk kembali ke WASIAT.' };
      return { ok: true, data: fn(req.payload || {}, me, req.token) };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  return { tangani: tangani, verifikasi: verifikasi, jalankanJadwal: jalankanJadwal, daftarkan: daftarkan,
    // dipakai bagian lain modul (rapor, PPDB) & pengujian
    _u: { sheet_: sheet_, rows_: rows_, tulis_: tulis_, ubah_: ubah_, HEAD: HEAD, kodeAcak_: kodeAcak_, kodeBersih_: kodeBersih_, wajib_: wajib_, punya_: punya_,
      hanyaWali_: hanyaWali_, bolehNisn_: bolehNisn_, petaSantri_: petaSantri_, namaLembaga_: namaLembaga_, stamp_: stamp_, ymd_: ymd_, aman_: aman_, props_: props_,
      hitungPeringatan_: hitungPeringatan_, perbaruiPeringatan_: perbaruiPeringatan_ } };
})();

/** Dijalankan pemicu per jam (dipasang dari menu Otomatisasi). */
function prmJadwalOtomatis() { return PRM_.jalankanJadwal(); }

// ======================================================================
// PRM_ bagian 2: RAPOR RESMI ber-QR + PPDB ONLINE
// (didaftarkan ke PRM_ lewat PRM_.daftarkan, memakai util PRM_._u)
// ======================================================================
(function () {
  const U = PRM_._u;
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  function props() { return PropertiesService.getScriptProperties(); }
  function folderAkar_(kunci, nama) {
    const id = props().getProperty(kunci);
    if (id) { try { return DriveApp.getFolderById(id); } catch (e) { } }
    const f = DriveApp.createFolder(nama + ' - ' + U.namaLembaga_().toUpperCase());
    props().setProperty(kunci, f.getId());
    return f;
  }
  function sub_(induk, nama) { const it = induk.getFoldersByName(String(nama)); return it.hasNext() ? it.next() : induk.createFolder(String(nama)); }
  function bersihNama_(s) { return String(s == null ? '' : s).replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120); }
  function fileB64_(id) {
    const f = DriveApp.getFileById(id);
    const b = f.getBlob();
    if (b.getBytes().length > 15 * 1024 * 1024) throw new Error('Berkas terlalu besar untuk ditampilkan.');
    return { name: f.getName(), mime: b.getContentType(), base64: Utilities.base64Encode(b.getBytes()) };
  }

  /* ================================================================
   *  6. RAPOR RESMI ber-QR
   *  Wali kelas/Admin/Mudir menerbitkan rapor dari halaman Rapor Santri. PDF tersimpan
   *  di Drive, wali melihatnya di tab Nilai, dan keasliannya bisa dipindai.
   * ================================================================ */
  const BOLEH_RAPOR = ['Admin', 'Mudir', 'WaliKelas'];
  function api_terbitkanRapor(p, me) {
    U.wajib_(U.punya_(me, BOLEH_RAPOR), 'Hanya wali kelas, Admin, atau Mudir yang dapat menerbitkan rapor resmi.');
    const nisn = norm(p.nisn).replace(/^'/, ''), semester = norm(p.semester), kelas = norm(p.kelas);
    if (!nisn || !semester) throw new Error('Data rapor tidak lengkap.');
    if (!p.html || String(p.html).length > 3 * 1024 * 1024) throw new Error('Isi rapor kosong atau terlalu besar.');
    const s = U.petaSantri_()[nisn];
    if (!s) throw new Error('Santri tidak ditemukan.');
    const kode = U.kodeBersih_(p.kodeVerifikasi).length === 10 && /^R/.test(U.kodeBersih_(p.kodeVerifikasi)) ? U.kodeBersih_(p.kodeVerifikasi) : U.kodeAcak_('R');
    const isi = String(p.html).split('{{KODE}}').join(kode.replace(/^(.{4})(.{4})(.*)$/, '$1-$2-$3'));
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    let r;
    try {
      // terbit ulang: rapor sebelumnya untuk semester yang sama otomatis "Diganti"
      U.rows_('RaporResmi').forEach(function (x) { if (String(x.NISN) === nisn && String(x.Semester) === semester && x.Status === 'Sah') U.ubah_('RaporResmi', x, { Status: 'Diganti', Catatan: 'Diganti oleh terbitan ' + U.stamp_() }); });
      const pdf = Utilities.newBlob(isi, 'text/html', 'rapor.html').getAs('application/pdf').setName(bersihNama_('Rapor ' + s.nama + ' - ' + semester) + '.pdf');
      const folder = sub_(sub_(folderAkar_('PRM_RAPOR_ROOT', 'RAPOR'), bersihNama_(semester)), bersihNama_(kelas || s.kelas || 'Tanpa Kelas'));
      const f = folder.createFile(pdf);
      r = { ID: Utilities.getUuid().split('-')[0] + Date.now().toString(36), Kode: kode, NISN: nisn, Nama: s.nama, Kelas: kelas || s.kelas, Semester: semester,
        Diterbitkan: U.stamp_(), Oleh: me.nama, 'File ID': f.getId(), Status: 'Sah', Catatan: '' };
      U.tulis_('RaporResmi', null, r);
    } finally { lock.releaseLock(); }
    if (p.kabariWali !== false) {
      U.aman_(function () { kirimPushKeWali(nisn, '🏅 Rapor ' + s.nama + ' sudah terbit', 'Rapor semester ' + semester + ' dapat dilihat dan diunduh di aplikasi WASIAT, tab Nilai.'); });
    }
    return { id: r.ID, kode: r.Kode, nama: r.Nama, semester: r.Semester };
  }
  function api_raporSantri(p, me) {
    const nisn = norm(p.nisn).replace(/^'/, '');
    U.wajib_(U.bolehNisn_(me, nisn), 'Anda tidak memiliki akses ke data santri ini.');
    return U.rows_('RaporResmi').filter(function (x) { return String(x.NISN) === nisn && (x.Status === 'Sah' || !U.hanyaWali_(me)); })
      .sort(function (a, b) { return String(b.Diterbitkan).localeCompare(String(a.Diterbitkan)); })
      .map(function (x) { return { id: x.ID, semester: x.Semester, kelas: x.Kelas, diterbitkan: String(x.Diterbitkan).slice(0, 10), oleh: x.Oleh, status: x.Status, kode: x.Kode }; });
  }
  function api_fileRapor(p, me) {
    const r = U.rows_('RaporResmi').find(function (x) { return x.ID === p.id; });
    if (!r) throw new Error('Rapor tidak ditemukan.');
    U.wajib_(U.bolehNisn_(me, r.NISN), 'Anda tidak memiliki akses ke rapor ini.');
    return fileB64_(r['File ID']);
  }
  function api_batalRapor(p, me) {
    U.wajib_(U.punya_(me, BOLEH_RAPOR), 'Hanya wali kelas, Admin, atau Mudir.');
    if (!norm(p.alasan)) throw new Error('Tulis alasan pembatalan.');
    const r = U.rows_('RaporResmi').find(function (x) { return x.ID === p.id; });
    if (!r) throw new Error('Rapor tidak ditemukan.');
    if (r.Status !== 'Sah') throw new Error('Rapor ini sudah tidak berlaku.');
    U.ubah_('RaporResmi', r, { Status: 'Dibatalkan', Catatan: norm(p.alasan).slice(0, 200) + ' — ' + me.nama });
    return { id: r.ID, status: 'Dibatalkan' };
  }
  PRM_.daftarkan('terbitkanRapor', api_terbitkanRapor);
  PRM_.daftarkan('raporSantri', api_raporSantri);
  PRM_.daftarkan('fileRapor', api_fileRapor);
  PRM_.daftarkan('batalRapor', api_batalRapor);

  /* ================================================================
   *  7. PPDB ONLINE
   *  Halaman publik /ppdb/ (tanpa login). Pengamanan: penyaringan jebakan bot,
   *  batas kiriman per 10 menit, berkas dibatasi ukurannya & jenisnya.
   * ================================================================ */
  const PROP_PPDB = 'PRM_PPDB';
  const ST = ['Baru', 'Diverifikasi', 'Perlu Perbaikan', 'Tes/Wawancara', 'Diterima', 'Cadangan', 'Tidak Diterima', 'Menjadi Santri'];
  function aturan_() {
    let a = {}; try { a = JSON.parse(props().getProperty(PROP_PPDB) || '{}'); } catch (e) { }
    return { buka: !!a.buka, tahun: a.tahun || (new Date().getFullYear() + '/' + (new Date().getFullYear() + 1)), jenjang: a.jenjang || ['SMP / Tsanawiyah', 'SMA / Aliyah'],
      info: a.info || '', kuota: Number(a.kuota) || 0, kontak: a.kontak || '', berkas: a.berkas || ['Pas foto', 'Kartu Keluarga', 'Akta kelahiran', 'Ijazah / SKL / Rapor terakhir'] };
  }
  function api_ppdbInfo() {
    const a = aturan_();
    const jumlah = U.rows_('PPDB').length;
    return { lembaga: U.namaLembaga_(), buka: a.buka && (!a.kuota || jumlah < a.kuota * 3), tahun: a.tahun, jenjang: a.jenjang, info: a.info, kontak: a.kontak, berkas: a.berkas,
      penuh: !!(a.kuota && jumlah >= a.kuota * 3) };
  }
  function noDaftar_(tahun) {
    const awal = 'PPDB-' + String(tahun).slice(0, 4) + '-';
    let max = 0;
    U.rows_('PPDB').forEach(function (r) { const m = String(r['No Daftar']).match(/-(\d+)$/); if (String(r['No Daftar']).indexOf(awal) === 0 && m && Number(m[1]) > max) max = Number(m[1]); });
    return awal + String(max + 1).padStart(4, '0');
  }
  function api_ppdbDaftar(p) {
    const a = aturan_();
    if (!a.buka) throw new Error('Pendaftaran sedang ditutup.');
    if (norm(p.website)) throw new Error('Pendaftaran tidak dapat diproses.'); // jebakan bot (kolom tersembunyi)
    const c = CacheService.getScriptCache();
    const n = Number(c.get('ppdb_laju') || 0);
    if (n >= 20) throw new Error('Pendaftaran sedang ramai. Silakan coba lagi 10 menit lagi.');
    c.put('ppdb_laju', String(n + 1), 600);
    const nama = norm(p.nama).slice(0, 100), wa = norm(p.noWa).replace(/[^\d]/g, '');
    const tgl = norm(p.tanggalLahir);
    if (nama.length < 3) throw new Error('Isi nama lengkap calon santri.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl)) throw new Error('Isi tanggal lahir.');
    if (!/^(0|62)8\d{7,12}$/.test(wa)) throw new Error('Nomor WhatsApp orang tua tidak valid (contoh 081234567890).');
    if (['Laki-laki', 'Perempuan'].indexOf(norm(p.jk)) < 0) throw new Error('Pilih jenis kelamin.');
    const berkas = (p.berkas || []).slice(0, 6);
    let total = 0;
    berkas.forEach(function (b) {
      if (!/^image\/(jpeg|png|webp)$|^application\/pdf$/.test(String(b.mime))) throw new Error('Berkas harus foto (JPG/PNG) atau PDF.');
      total += String(b.base64 || '').length;
    });
    if (total > 12 * 1024 * 1024) throw new Error('Total berkas terlalu besar (maks sekitar 9 MB). Kirim foto yang lebih kecil.');
    // pendaftar sama (nama + tgl lahir + WA) tidak boleh mendaftar dua kali
    const ada = U.rows_('PPDB').find(function (r) { return normNama(r.Nama) === normNama(nama) && String(r['Tanggal Lahir']).slice(0, 10) === tgl && String(r['No WA']) === wa; });
    if (ada) throw new Error('Calon santri ini sudah terdaftar dengan nomor ' + ada['No Daftar'] + '. Gunakan menu Cek Status.');
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    let r;
    try {
      const no = noDaftar_(a.tahun);
      const folder = sub_(sub_(folderAkar_('PRM_PPDB_ROOT', 'PPDB'), bersihNama_(a.tahun.replace(/\//g, '-'))), bersihNama_(no + ' - ' + nama));
      const daftarBerkas = berkas.map(function (b, i) {
        const ext = b.mime === 'application/pdf' ? '.pdf' : (b.mime === 'image/png' ? '.png' : '.jpg');
        const f = folder.createFile(Utilities.newBlob(Utilities.base64Decode(b.base64), b.mime, bersihNama_((b.label || ('Berkas ' + (i + 1)))) + ext));
        return { label: bersihNama_(b.label || ('Berkas ' + (i + 1))), id: f.getId() };
      });
      r = { ID: Utilities.getUuid().split('-')[0] + Date.now().toString(36), 'No Daftar': no, Waktu: U.stamp_(), Nama: nama, JK: norm(p.jk),
        'Tempat Lahir': norm(p.tempatLahir).slice(0, 60), 'Tanggal Lahir': tgl, 'Asal Sekolah': norm(p.asalSekolah).slice(0, 100), Jenjang: norm(p.jenjang).slice(0, 60),
        'Nama Ayah': norm(p.namaAyah).slice(0, 80), 'Nama Ibu': norm(p.namaIbu).slice(0, 80), 'No WA': wa, Alamat: norm(p.alamat).slice(0, 300), Catatan: norm(p.catatan).slice(0, 300),
        Berkas: JSON.stringify(daftarBerkas), Status: 'Baru', 'Catatan Panitia': '', 'Diproses Oleh': '', 'Diproses Pada': '', NISN: '', 'Kode Cek': U.kodeAcak_('', 6) };
      U.tulis_('PPDB', null, r);
    } finally { lock.releaseLock(); }
    U.aman_(function () {
      const staf = getAktifSS().getSheetByName(SHEET_ROLE).getDataRange().getValues().slice(1).filter(function (x) { return /Admin|Mudir|Sekretaris/.test(norm(x[3])); }).map(function (x) { return norm(x[0]); });
      if (staf.length) kirimPushOneSignal(staf, '📝 Pendaftar PPDB baru', r.Nama + ' (' + r.Jenjang + ') · ' + r['No Daftar'], '', { jenis: 'ppdb' });
    });
    U.aman_(function () {
      kirimWAKategori_('ppdb', wa, 'Assalamualaikum Wr. Wb.\n\nTerima kasih, pendaftaran *' + r.Nama + '* di ' + U.namaLembaga_() + ' telah kami terima.\n\nNomor pendaftaran: *' + r['No Daftar'] + '*\nKode cek: *' + r['Kode Cek'] +
        '*\n\nSimpan nomor & kode ini untuk mengecek status pendaftaran di halaman PPDB.\n\nJazakumullah khairan.');
    });
    return { noDaftar: r['No Daftar'], kodeCek: r['Kode Cek'], nama: r.Nama };
  }
  function outPublik_(r) {
    return { noDaftar: r['No Daftar'], nama: r.Nama, jenjang: r.Jenjang, status: r.Status, catatan: r['Catatan Panitia'], waktu: String(r.Waktu).slice(0, 10) };
  }
  function api_ppdbCek(p) {
    const c = CacheService.getScriptCache();
    const n = Number(c.get('ppdb_cek') || 0);
    if (n >= 60) throw new Error('Terlalu banyak pengecekan. Coba lagi beberapa menit lagi.');
    c.put('ppdb_cek', String(n + 1), 300);
    const no = norm(p.noDaftar).toUpperCase(), kode = U.kodeBersih_(p.kodeCek);
    const r = U.rows_('PPDB').find(function (x) { return String(x['No Daftar']).toUpperCase() === no && U.kodeBersih_(x['Kode Cek']) === kode; });
    if (!r) throw new Error('Nomor pendaftaran atau kode cek tidak cocok.');
    return outPublik_(r);
  }
  function bolehPpdb_(me) { return U.punya_(me, ['Admin', 'Mudir', 'Sekretaris']); }
  function api_ppdbDaftarPendaftar(p, me) {
    U.wajib_(bolehPpdb_(me), 'Hanya Admin, Mudir, atau Sekretaris.');
    const list = U.rows_('PPDB').map(function (r) {
      let b = []; try { b = JSON.parse(r.Berkas || '[]'); } catch (e) { }
      return { id: r.ID, noDaftar: r['No Daftar'], waktu: r.Waktu, nama: r.Nama, jk: r.JK, tempatLahir: r['Tempat Lahir'], tanggalLahir: String(r['Tanggal Lahir']).slice(0, 10),
        asalSekolah: r['Asal Sekolah'], jenjang: r.Jenjang, ayah: r['Nama Ayah'], ibu: r['Nama Ibu'], noWa: String(r['No WA']), alamat: r.Alamat, catatan: r.Catatan,
        berkas: b.map(function (x, i) { return { i: i, label: x.label }; }), status: r.Status, catatanPanitia: r['Catatan Panitia'], diprosesOleh: r['Diproses Oleh'], nisn: String(r.NISN || '') };
    }).sort(function (a, b) { return String(b.waktu).localeCompare(String(a.waktu)); });
    const rekap = {}; list.forEach(function (x) { rekap[x.status] = (rekap[x.status] || 0) + 1; });
    return { aturan: aturan_(), data: list, rekap: rekap, status: ST };
  }
  function api_ppdbBerkas(p, me) {
    U.wajib_(bolehPpdb_(me), 'Hanya Admin, Mudir, atau Sekretaris.');
    const r = U.rows_('PPDB').find(function (x) { return x.ID === p.id; });
    if (!r) throw new Error('Pendaftar tidak ditemukan.');
    let b = []; try { b = JSON.parse(r.Berkas || '[]'); } catch (e) { }
    const x = b[Number(p.i)]; if (!x) throw new Error('Berkas tidak ditemukan.');
    return fileB64_(x.id);
  }
  function api_ppdbProses(p, me) {
    U.wajib_(bolehPpdb_(me), 'Hanya Admin, Mudir, atau Sekretaris.');
    const st = norm(p.status);
    if (ST.indexOf(st) < 0 || st === 'Menjadi Santri') throw new Error('Status tidak dikenal.');
    const r = U.rows_('PPDB').find(function (x) { return x.ID === p.id; });
    if (!r) throw new Error('Pendaftar tidak ditemukan.');
    if (r.Status === 'Menjadi Santri') throw new Error('Pendaftar ini sudah menjadi santri.');
    const o = U.ubah_('PPDB', r, { Status: st, 'Catatan Panitia': norm(p.catatan).slice(0, 300), 'Diproses Oleh': me.nama, 'Diproses Pada': U.stamp_() });
    if (p.kabari !== false) {
      U.aman_(function () {
        kirimWAKategori_('ppdb', String(r['No WA']), 'Assalamualaikum Wr. Wb.\n\nInformasi pendaftaran *' + r.Nama + '* (' + r['No Daftar'] + ') di ' + U.namaLembaga_() + ':\n\nStatus: *' + st + '*' +
          (norm(p.catatan) ? '\nCatatan: ' + norm(p.catatan) : '') + '\n\nJazakumullah khairan.');
      });
    }
    return outPublik_(o);
  }
  function api_ppdbJadikanSantri(p, me) {
    U.wajib_(U.punya_(me, ['Admin', 'Mudir']), 'Hanya Admin atau Mudir yang dapat memasukkan ke Data Santri.');
    const r = U.rows_('PPDB').find(function (x) { return x.ID === p.id; });
    if (!r) throw new Error('Pendaftar tidak ditemukan.');
    if (r.Status !== 'Diterima') throw new Error('Hanya pendaftar berstatus Diterima yang dapat dimasukkan ke Data Santri.');
    const nisn = norm(p.nisn);
    if (!/^\d{3,20}$/.test(nisn)) throw new Error('Isi NISN (angka) untuk santri baru.');
    const h = apiTambahSantriManual({ nisn: nisn, nama: r.Nama, tahunMasuk: norm(p.tahunMasuk) || String(new Date().getFullYear()), jenisKelamin: r.JK, noWaOrtu: String(r['No WA']),
      kelas: norm(p.kelas), jenisMasuk: 'Santri Baru (PPDB)', asalSekolah: r['Asal Sekolah'], oleh: me.nama });
    if (!h.ok) throw new Error(h.error);
    U.ubah_('PPDB', r, { Status: 'Menjadi Santri', NISN: nisn, 'Diproses Oleh': me.nama, 'Diproses Pada': U.stamp_() });
    return { nisn: nisn, nama: r.Nama, catatan: h.pesanRombel || '' };
  }
  function api_ppdbAtur(p, me) {
    U.wajib_(U.punya_(me, ['Admin', 'Mudir']), 'Hanya Admin atau Mudir.');
    const a = {
      buka: p.buka === true, tahun: norm(p.tahun).slice(0, 20) || aturan_().tahun, kuota: Math.max(0, Number(p.kuota) || 0), kontak: norm(p.kontak).slice(0, 120),
      info: String(p.info || '').slice(0, 2000),
      jenjang: String(p.jenjang || '').split(/\n|,/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 8),
      berkas: String(p.berkas || '').split(/\n|,/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 6),
    };
    if (!a.jenjang.length) a.jenjang = aturan_().jenjang;
    if (!a.berkas.length) a.berkas = aturan_().berkas;
    props().setProperty(PROP_PPDB, JSON.stringify(a));
    return aturan_();
  }
  PRM_.daftarkan('ppdbInfo', api_ppdbInfo, true);
  PRM_.daftarkan('ppdbDaftar', api_ppdbDaftar, true);
  PRM_.daftarkan('ppdbCek', api_ppdbCek, true);
  PRM_.daftarkan('ppdbDaftarPendaftar', api_ppdbDaftarPendaftar);
  PRM_.daftarkan('ppdbBerkas', api_ppdbBerkas);
  PRM_.daftarkan('ppdbProses', api_ppdbProses);
  PRM_.daftarkan('ppdbJadikanSantri', api_ppdbJadikanSantri);
  PRM_.daftarkan('ppdbAtur', api_ppdbAtur);
})();


// ======================================================================
// PERSURATAN (Simpel Surat) -- modul sekretariat yang digabung ke WASIAT
//
// Seluruh kode persuratan dibungkus dalam SURAT_ (namespace sendiri), jadi tidak ada
// nama fungsi/konstanta yang bertabrakan dengan WASIAT. Datanya terpisah: folder
// "PERSURATAN - PP WIHDATUL UMMAH POSO" + spreadsheet "00. BUKU AGENDA SURAT" (dibuat
// otomatis saat persuratan pertama kali dibuka). Tidak ada sheet WASIAT yang ditulis;
// data santri, guru, dan akun hanya DIBACA dari WASIAT.
// Aplikasi web-nya ada di folder /surat/ dan memanggil server ini dengan modul:'surat'.
// ======================================================================
var SURAT_ = (function () {
  /**
   * ================================================================
   *  SIMPEL SURAT — Sistem Persuratan Pondok Pesantren Wihdatul Ummah Poso
   *  Backend: Google Apps Script  (file 1 dari 2: Code.gs + Akun.gs)
   *  Database : Google Sheets (dibuat otomatis oleh setup())
   *  Arsip    : Google Drive  (folder dibuat otomatis oleh setup())
   * ================================================================
   *  CARA PAKAI SINGKAT
   *  1. Tempel Code.gs dan Akun.gs ke proyek Apps Script (script.google.com)
   *  2. Pilih fungsi "setup" lalu klik Jalankan (Run) -> izinkan akses
   *  3. Deploy > New deployment > Web app
   *       Execute as : Me          Who has access : Anyone
   *  4. Salin URL Web App -> tempel ke config.js
   *  Akun awal: admin / 123456  (wajib ganti PIN saat pertama masuk)
   * ================================================================
   */

  const CFG = {
    ROOT_NAME: 'PERSURATAN - PP WIHDATUL UMMAH POSO',
    DB_NAME: '00. BUKU AGENDA SURAT - PP WIHDATUL UMMAH POSO',
  };

  /** Nama folder utama di dalam folder PERSURATAN (angka di depan = urutan tampil di Drive) */
  const F = {
    KELUAR: '01. Surat Keluar',
    MASUK: '02. Surat Masuk',
    SET: '99. Pengaturan (logo & tanda tangan)',
  };
  const PREFIX_BATAL = '[DIBATALKAN] ';
  const JENIS_MASUK = ['Undangan', 'Pemberitahuan & Edaran', 'Permohonan', 'Surat Keputusan & Instruksi',
    'Laporan', 'Kerja Sama', 'Lainnya'];

  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
    'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const ROMAWI = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

  /** Status surat keluar */
  const ST = { DRAF: 'Draf', MENUNGGU: 'Menunggu Persetujuan', REVISI: 'Perlu Revisi', TERBIT: 'Terbit', TERKIRIM: 'Terkirim', BATAL: 'Dibatalkan' };

  const HEAD = {
    SuratKeluar: ['ID', 'No Urut', 'Tahun', 'Nomor Surat', 'Tanggal', 'Jenis', 'Kode', 'Perihal',
      'Tujuan', 'Penandatangan', 'Status', 'File ID', 'Link PDF', 'Data JSON', 'Dibuat', 'Diperbarui', 'Kategori',
      'Dibuat Oleh', 'Disetujui Oleh', 'Disetujui Pada', 'Catatan Persetujuan', 'Kode Verifikasi', 'Penerima JSON', 'Status Kirim', 'Revisi JSON'],
    SuratMasuk: ['ID', 'No Agenda', 'Tahun', 'Nomor Surat', 'Tanggal Surat', 'Tanggal Diterima',
      'Pengirim', 'Perihal', 'Disposisi', 'Keterangan', 'File ID', 'Link File', 'Dicatat', 'Jenis',
      'Disposisi Ke', 'Status Tindak Lanjut', 'Catatan Tindak Lanjut', 'Ditindaklanjuti Pada', 'Dicatat Oleh'],
    Pengaturan: ['Kunci', 'Nilai'],
    Template: ['ID', 'Nama', 'Kategori', 'Kode', 'Definisi JSON', 'Dibuat', 'Diperbarui'],
    Santri: ['ID', 'Nama', 'NIS', 'NISN', 'Jenis Kelamin', 'Tempat Lahir', 'Tanggal Lahir', 'Kelas', 'Asrama/Kamar',
      'Nama Wali', 'Hubungan Wali', 'No HP Wali', 'Alamat', 'Status', 'Diperbarui'],
    Guru: ['ID', 'Nama', 'NIY/NIP', 'Jabatan', 'Jenis Kelamin', 'No HP', 'Alamat', 'Status', 'Diperbarui'],
    Pengguna: ['ID', 'Nama', 'Username', 'Peran', 'Hash', 'Salt', 'Terkait', 'No WA', 'Status', 'Versi',
      'Wajib Ganti PIN', 'Dibuat', 'Login Terakhir'],
    Notifikasi: ['ID', 'Untuk', 'Judul', 'Pesan', 'Jenis', 'Ref', 'Dibuat', 'Dibaca', 'Dari', 'WA', 'Info WA', 'Percobaan WA'],
  };
  /** Kunci data (dipakai aplikasi) ↔ kolom sheet, urutan sama dengan HEAD */
  const PEOPLE = {
    santri: { sheet: 'Santri', keys: ['id', 'nama', 'nis', 'nisn', 'jk', 'tempatLahir', 'tglLahir', 'kelas', 'asrama', 'wali', 'hubunganWali', 'hpWali', 'alamat', 'status', 'diperbarui'], unik: 'nis' },
    guru: { sheet: 'Guru', keys: ['id', 'nama', 'niy', 'jabatan', 'jk', 'hp', 'alamat', 'status', 'diperbarui'], unik: 'niy' },
  };
  /** Kategori template bawaan yang dikelompokkan (selain itu: kategori = nama jenis surat) */
  const KATEGORI_BAWAAN = ['Pendisiplinan Santri', 'Surat Keputusan'];

  const DEFAULTS = {
    kopKiri: 'PONDOK PESANTREN SALAFIYAH\nWIHDATUL UMMAH\nPOSO SULAWESI TENGAH',
    kopKanan: 'معهد سلفية\nوحدة الأمة بوسو\nسولاويسي الوسطى',
    kopBar: 'Sekretariat : Jl. Lingkar Moengko-Lembomawo Kel. Moengko Lama Kec. Poso Kota Kab. Poso Hp. 082292255617',
    warnaKop: '#01B0F1',
    namaResmi: 'Pondok Pesantren Salafiyah Wihdatul Ummah Poso',
    kota: 'Poso',
    formatNomor: 'K.{urut}/PPS-WU/{bulan}/{tahun}',
    digitUrut: '3',
    penandatangan: JSON.stringify([
      { jabatan: 'Mudir  PPS Wihdatul Ummah Poso', nama: 'Muh. Idul Fitran, S.H.', nip: 'NIY. 10031994092018027' },
    ]),
    tampilHijriah: 'tidak',
    gayaSalam: 'arab',
    wajibPersetujuan: 'ya',
    tampilQr: 'ya',
    waProvider: 'wasiat',
    waServer: 'jkt.wablas.com',
    appUrl: '',
  };
  const IMG_KEY = /^(logo|ttd\d{1,2})$/;
  /** Pengaturan yang boleh diubah lewat aplikasi (token WA disimpan terpisah di Script Properties) */
  const SET_BOLEH = ['kopKiri', 'kopKanan', 'kopBar', 'warnaKop', 'namaResmi', 'kota', 'formatNomor', 'digitUrut',
    'penandatangan', 'tampilHijriah', 'gayaSalam', 'wajibPersetujuan', 'tampilQr', 'waProvider', 'waServer', 'appUrl'];

  /* ================================================================
   *  SETUP — jalankan sekali dari editor (aman dijalankan ulang)
   * ================================================================ */

  /**
   * Jalankan SEKALI dari editor bila sebelumnya sudah ada surat yang tersimpan
   * dengan susunan folder lama. Semua PDF dipindah ke susunan baru.
   */
  function rapikanArsip() {
    let pindah = 0;
    rows_('SuratKeluar').forEach(function (r) {
      if (!r['File ID']) return;
      try {
        const f = DriveApp.getFileById(r['File ID']);
        f.moveTo(folderKeluar_(r.Kategori, r.Jenis, r.Tahun));
        const nm = f.getName().replace(PREFIX_BATAL, '');
        f.setName((r.Status === ST.BATAL ? PREFIX_BATAL : '') + nm);
        pindah++;
      } catch (e) { Logger.log('Lewati ' + r['Nomor Surat'] + ': ' + e.message); }
    });
    rows_('SuratMasuk').forEach(function (r) {
      if (!r['File ID']) return;
      try { DriveApp.getFileById(r['File ID']).moveTo(folderMasuk_(r.Jenis, r.Tahun)); pindah++; }
      catch (e) { Logger.log('Lewati ' + r['No Agenda'] + ': ' + e.message); }
    });
    ['Surat Keluar', 'Surat Masuk', 'Pengaturan'].forEach(function (n) {
      const it = root_().getFoldersByName(n);
      while (it.hasNext()) {
        const fo = it.next();
        if (n === 'Pengaturan') { const fi = fo.getFiles(); while (fi.hasNext()) fi.next().moveTo(folder_(root_(), F.SET)); }
        trashIfEmpty_(fo);
      }
    });
    Logger.log('Selesai. ' + pindah + ' file dirapikan.');
  }

  function trashIfEmpty_(fo) {
    const subs = fo.getFolders();
    while (subs.hasNext()) trashIfEmpty_(subs.next());
    if (!fo.getFiles().hasNext() && !fo.getFolders().hasNext()) fo.setTrashed(true);
  }

  /** Darurat: jalankan dari editor bila semua admin lupa PIN → akun "admin" PIN 123456 */

  /* ================================================================
   *  WEB APP ENDPOINT
   * ================================================================ */

  const HANDLERS = {
    // publik
    login: api_login, verify: api_verify,
    // semua pengguna
    ping: api_ping, me: api_me, changeMyPin: api_changeMyPin, getSettings: api_getSettings,
    listNotif: api_listNotif, readNotif: api_readNotif, getFile: api_getFile,
    listPending: api_listPending, approve: api_approve, reject: api_reject,
    listDisposisiSaya: api_listDisposisiSaya, tindakLanjut: api_tindakLanjut,
    // pengelola (Sekretaris & Mudir)
    saveSettings: api_saveSettings, uploadImage: api_uploadImage, removeImage: api_removeImage,
    nextNumber: api_nextNumber, saveSurat: api_saveSurat, listSurat: api_listSurat, getSurat: api_getSurat,
    setStatus: api_setStatus, deleteDraft: api_deleteDraft, kirimSurat: api_kirimSurat,
    saveSuratMasuk: api_saveSuratMasuk, listSuratMasuk: api_listSuratMasuk, dashboard: api_dashboard,
    listTemplates: api_listTemplates, saveTemplate: api_saveTemplate, deleteTemplate: api_deleteTemplate,
    listPeople: api_listPeople, savePerson: api_savePerson, deletePerson: api_deletePerson, importPeople: api_importPeople,
    listUsers: api_listUsers, saveUser: api_saveUser, resetPin: api_resetPin, deleteUser: api_deleteUser,
    buatAkunWali: api_buatAkunWali, buatAkunGuru: api_buatAkunGuru, waTest: api_waTest, meta: api_meta,
    hubungkanArsipLama: function (p) { return hubungkanArsipLama(p.id); },
    arsipSuratLama: api_arsipSuratLama, hapusArsipLama: api_hapusArsipLama,
  };


  /* ================================================================
   *  PENGATURAN
   * ================================================================ */
  function api_ping(p, me) {
    db_();
    return { pesan: 'Terhubung', waktu: new Date().toISOString() };
  }

  function signers_(s) {
    let list = [];
    try { list = JSON.parse(s.penandatangan || '[]'); } catch (e) { }
    return Array.isArray(list) ? list : [];
  }

  /** Apakah akun ini boleh memakai gambar tanda tangan ke-i? */

  function api_getSettings(p, me) {
    const s = settings_();
    const signers = signers_(s);
    const images = {};
    Object.keys(s).forEach(function (k) {
      if (k.indexOf('img_') !== 0 || !s[k]) return;
      const key = k.slice(4);
      const m = key.match(/^ttd(\d+)$/);
      if (m && !bolehTtd_(me, Number(m[1]), s, signers)) { images[key] = 'terkunci'; return; }
      try {
        const b = DriveApp.getFileById(s[k]).getBlob();
        images[key] = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
      } catch (e) { }
    });
    const out = {};
    Object.keys(s).forEach(function (k) { if (k.indexOf('img_') !== 0) out[k] = s[k]; });
    const pengelola = me && PENGELOLA.indexOf(me.Peran) >= 0;
    return {
      settings: out, images: images,
      rootUrl: pengelola ? root_().getUrl() : '', dbUrl: pengelola ? db_().getUrl() : '',
      wa: pengelola ? waStatus_() : null,
      peran: PERAN,
    };
  }

  function api_saveSettings(p, me) {
    const sh = sheet_('Pengaturan');
    const cur = rows_('Pengaturan');
    const data = p.settings || {};
    Object.keys(data).forEach(function (k) {
      if (SET_BOLEH.indexOf(k) < 0) return;
      let v = data[k];
      if (typeof v !== 'string') v = JSON.stringify(v);
      const r = cur.find(function (x) { return x.Kunci === k; });
      if (r) writeRow_(sh, r._row, [k, v]); else appendText_(sh, [k, v]);
    });
    // token WA disimpan di Script Properties (tidak terlihat di Sheets)
    const P = props_();
    if (p.waToken === '-') P.deleteProperty('WA_TOKEN'); else if (p.waToken) P.setProperty('WA_TOKEN', String(p.waToken).trim());
    if (p.waSecret === '-') P.deleteProperty('WA_SECRET'); else if (p.waSecret) P.setProperty('WA_SECRET', String(p.waSecret).trim());
    return api_getSettings({}, me);
  }

  function api_uploadImage(p) {
    if (!IMG_KEY.test(String(p.key))) throw new Error('Jenis gambar tidak dikenal.');
    if (!p.base64) throw new Error('File gambar kosong.');
    const folder = folder_(root_(), F.SET);
    const old = settings_()['img_' + p.key];
    if (old) { try { DriveApp.getFileById(old).setTrashed(true); } catch (e) { } }
    const blob = Utilities.newBlob(Utilities.base64Decode(p.base64), p.mime || 'image/png', p.key + ext_(p.mime));
    const file = folder.createFile(blob);
    setSetting_('img_' + p.key, file.getId());
    return { key: p.key, fileId: file.getId() };
  }

  function api_removeImage(p) {
    if (!IMG_KEY.test(String(p.key))) throw new Error('Jenis gambar tidak dikenal.');
    const old = settings_()['img_' + p.key];
    if (old) { try { DriveApp.getFileById(old).setTrashed(true); } catch (e) { } }
    setSetting_('img_' + p.key, '');
    return { key: p.key };
  }

  /* ================================================================
   *  SURAT KELUAR — DRAF → PERSETUJUAN → TERBIT
   * ================================================================ */
  function api_nextNumber(p) {
    const d = parseDate_(p.tanggal);
    const urut = nextUrut_(d.getFullYear());
    return { urut: urut, nomor: formatNomor_(settings_(), urut, d, p.kode) };
  }

  function statusOf_(r) { return r.Status === 'Diarsipkan' ? ST.TERBIT : (r.Status || ST.TERBIT); }
  const sudahTerbit_ = function (r) { const s = statusOf_(r); return s === ST.TERBIT || s === ST.TERKIRIM; };

  /** Akun yang berhak menyetujui surat ini: akun yang namanya = penandatangan; bila tidak ada → semua Mudir */
  function bolehSetujui_(me, r) {
    return me.Peran === 'mudir' || approversFor_(r).some(function (u) { return u.ID === me.ID; });
  }

  function api_saveSurat(p, me) {
    const s = settings_();
    const wajib = s.wajibPersetujuan !== 'tidak';
    const bolehTerbit = me.Peran === 'mudir' || !wajib;
    let aksi = p.aksi || 'terbit';
    const lock = kunciSurat_();
    lock.waitLock(30000);
    try {
      const all = rows_('SuratKeluar');
      let ex = null;
      if (p.id) {
        ex = all.find(function (r) { return r.ID === p.id; });
        if (!ex) throw new Error('Data surat yang akan diperbarui tidak ditemukan.');
        if (statusOf_(ex) === ST.BATAL) throw new Error('Surat yang dibatalkan tidak bisa diubah. Aktifkan kembali dulu.');
      }
      if (aksi === 'terbit' && !bolehTerbit) aksi = 'ajukan';
      if (aksi === 'draf' && ex && sudahTerbit_(ex)) aksi = bolehTerbit ? 'terbit' : 'ajukan';

      const d = parseDate_(p.tanggal);
      const o = {
        Tanggal: ymd_(d), Jenis: p.jenis || '', Kode: p.kode || '', Perihal: p.perihal || '', Tujuan: p.tujuan || '',
        Penandatangan: p.penandatangan || '', 'Data JSON': JSON.stringify(p.data || {}), Diperbarui: stamp_(),
        Kategori: p.kategori || p.jenis || '', 'Penerima JSON': JSON.stringify(p.penerima || {}),
      };
      if (!ex) { o.ID = uid_(); o.Dibuat = stamp_(); o['Dibuat Oleh'] = me.ID; o.Tahun = String(d.getFullYear()); }
      if (p.nomorManual && (!ex || !ex['Nomor Surat'])) o._nomorManual = String(p.nomorManual).trim();

      // revisi atas surat yang sudah terbit: simpan terpisah, versi lama tetap berlaku sampai disetujui
      if (ex && sudahTerbit_(ex) && ex['File ID'] && aksi === 'ajukan') {
        const rev = {}; Object.keys(o).forEach(function (k) { if (k.charAt(0) !== '_') rev[k] = o[k]; });
        writeObj_('SuratKeluar', ex._row, { 'Revisi JSON': JSON.stringify(rev), Status: ST.MENUNGGU, 'Catatan Persetujuan': '', Diperbarui: stamp_() }, ex);
        notify_(approversFor_(Object.assign({}, ex, rev)), {
          judul: 'Revisi surat menunggu persetujuan', jenis: 'persetujuan', ref: ex.ID,
          pesan: 'Revisi ' + (ex['Nomor Surat'] || '') + ' — ' + (rev.Jenis || '') + ': ' + (rev.Perihal || '') + '. Diajukan oleh ' + me.Nama + '.',
        }, me);
        return { id: ex.ID, nomor: ex['Nomor Surat'], status: ST.MENUNGGU };
      }
      if (aksi === 'draf' || aksi === 'ajukan') {
        o.Status = aksi === 'draf' ? ST.DRAF : ST.MENUNGGU;
        if (aksi === 'ajukan') o['Catatan Persetujuan'] = '';
        if (o._nomorManual) { cekNomorUnik_(all, o._nomorManual, ex); o['Nomor Surat'] = o._nomorManual; o['No Urut'] = (o._nomorManual.match(/\d+/) || ['0'])[0]; }
        delete o._nomorManual;
        const row = writeObj_('SuratKeluar', ex ? ex._row : null, o, ex);
        if (aksi === 'ajukan') {
          const r = Object.assign({}, ex || {}, o);
          notify_(approversFor_(r), {
            judul: 'Surat menunggu persetujuan', jenis: 'persetujuan', ref: row.ID,
            pesan: (o.Jenis || 'Surat') + ': ' + (o.Perihal || '') + (o.Tujuan ? ' — kepada ' + o.Tujuan : '') + '. Diajukan oleh ' + me.Nama + '.',
          }, me);
        }
        return { id: row.ID, nomor: row['Nomor Surat'] || '', status: row.Status };
      }
      // terbit langsung (Mudir, atau persetujuan tidak diwajibkan)
      o['Revisi JSON'] = '';
      const res = terbit_(Object.assign({}, ex || {}, o), ex, p.html, p.kodeVerifikasi, me, all);
      if (ex && statusOf_(ex) === ST.MENUNGGU && ex['Dibuat Oleh'] && ex['Dibuat Oleh'] !== me.ID) {
        const pembuat = users_().find(function (u) { return u.ID === ex['Dibuat Oleh']; });
        if (pembuat) notify_([pembuat], { judul: 'Surat disetujui (dengan perubahan) ✓', jenis: 'disetujui', ref: ex.ID,
          pesan: (o.Jenis || '') + ': ' + (o.Perihal || '') + ' — Nomor ' + res.nomor + '. Diubah & disetujui oleh ' + me.Nama + '.' }, me);
      }
      return res;
    } finally {
      lock.releaseLock();
    }
  }

  function cekNomorUnik_(all, nomor, ex) {
    if (all.some(function (r) { return r['Nomor Surat'] === nomor && (!ex || r.ID !== ex.ID) && statusOf_(r) !== ST.BATAL; })) {
      throw new Error('Nomor surat ' + nomor + ' sudah dipakai. Gunakan nomor lain.');
    }
  }

  /** Beri nomor (bila belum), buat PDF, simpan ke folder kategori, tandai Terbit */
  function terbit_(r, ex, html, kode, me, all) {
    if (!html) throw new Error('Isi surat kosong.');
    const d = parseDate_(r.Tanggal);
    const tahun = d.getFullYear();
    all = all || rows_('SuratKeluar');
    let nomor = r['Nomor Surat'], urut = r['No Urut'];
    if (!nomor) {
      if (r._nomorManual) { cekNomorUnik_(all, r._nomorManual, ex); nomor = r._nomorManual; urut = (nomor.match(/\d+/) || ['0'])[0]; }
      else { urut = nextUrut_(tahun, all); nomor = formatNomor_(settings_(), urut, d, r.Kode); }
    }
    delete r._nomorManual;
    kode = String(kode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (kode.length < 8 || all.some(function (x) { return x['Kode Verifikasi'] === kode && (!ex || x.ID !== ex.ID); })) {
      kode = r['Kode Verifikasi'] || kodeAcak_();
    }
    const isi = String(html).split('{{NOMOR}}').join(nomor);
    const per = String(r.Perihal || r.Jenis || 'Surat');
    const tuj = String(r.Tujuan || '');
    const base = safeName_(nomor + ' - ' + per + (tuj && per.indexOf(tuj) < 0 && tuj !== 'Internal' ? ' - ' + tuj : ''));
    const folder = folderKeluar_(r.Kategori, r.Jenis, tahun);
    const pdf = Utilities.newBlob(isi, 'text/html', base + '.html').getAs('application/pdf').setName(base + '.pdf');
    const file = folder.createFile(pdf);
    if (ex && ex['File ID'] && ex['File ID'] !== file.getId()) { try { DriveApp.getFileById(ex['File ID']).setTrashed(true); } catch (e) { } }
    const o = {
      'Nomor Surat': nomor, 'No Urut': String(urut), Tahun: String(tahun),
      Status: ex && statusOf_(ex) === ST.TERKIRIM ? ST.TERKIRIM : ST.TERBIT,
      'File ID': file.getId(), 'Link PDF': file.getUrl(), 'Kode Verifikasi': kode,
      'Disetujui Oleh': me.Nama, 'Disetujui Pada': stamp_(), Diperbarui: stamp_(),
    };
    Object.keys(r).forEach(function (k) { if (!(k in o) && k !== '_row' && HEAD.SuratKeluar.indexOf(k) >= 0) o[k] = r[k]; });
    const row = writeObj_('SuratKeluar', ex ? ex._row : null, o, ex);
    return { id: row.ID, nomor: nomor, url: file.getUrl(), fileId: file.getId(), status: row.Status, kode: kode };
  }

  function kodeAcak_() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 10; i++) s += A.charAt(Math.floor(Math.random() * A.length));
    return s;
  }

  function api_listPending(p, me) {
    return rows_('SuratKeluar')
      .filter(function (r) { return statusOf_(r) === ST.MENUNGGU && bolehSetujui_(me, r); })
      .sort(function (a, b) { return a.Diperbarui < b.Diperbarui ? -1 : 1; })
      .map(function (r) { const e = efektif_(r); const o = outKeluar_(e); o.revisi = !!r['Revisi JSON']; try { o.data = JSON.parse(e['Data JSON'] || '{}'); } catch (x) { o.data = {}; } return o; });
  }

  function api_approve(p, me) {
    const lock = kunciSurat_(); lock.waitLock(30000);
    try {
      const all = rows_('SuratKeluar');
      const r = all.find(function (x) { return x.ID === p.id; });
      if (!r) throw new Error('Surat tidak ditemukan.');
      if (statusOf_(r) !== ST.MENUNGGU) throw new Error('Surat ini tidak sedang menunggu persetujuan (status: ' + statusOf_(r) + ').');
      if (!bolehSetujui_(me, r)) throw new Error('Akun Anda tidak berhak menyetujui surat ini.');
      const upd = Object.assign({}, efektif_(r), { 'Catatan Persetujuan': p.catatan || '', 'Revisi JSON': '' });
      if (p.data) upd['Data JSON'] = JSON.stringify(p.data);
      const res = terbit_(upd, r, p.html, p.kodeVerifikasi, me, all);
      const pembuat = users_().find(function (u) { return u.ID === r['Dibuat Oleh']; });
      if (pembuat && pembuat.ID !== me.ID) {
        notify_([pembuat], { judul: 'Surat disetujui ✓', jenis: 'disetujui', ref: r.ID,
          pesan: r.Jenis + ': ' + r.Perihal + ' — Nomor ' + res.nomor + '. Disetujui oleh ' + me.Nama + (p.catatan ? '. Catatan: ' + p.catatan : '') + '.' }, me);
      }
      return res;
    } finally { lock.releaseLock(); }
  }

  function api_reject(p, me) {
    const r = rows_('SuratKeluar').find(function (x) { return x.ID === p.id; });
    if (!r) throw new Error('Surat tidak ditemukan.');
    if (statusOf_(r) !== ST.MENUNGGU) throw new Error('Surat ini tidak sedang menunggu persetujuan.');
    if (!bolehSetujui_(me, r)) throw new Error('Akun Anda tidak berhak memproses surat ini.');
    const catatan = String(p.catatan || '').trim();
    if (!catatan) throw new Error('Tulis catatan perbaikan untuk sekretaris.');
    // revisi atas surat yang sudah terbit → versi lama tetap berlaku
    const kembali = r['File ID'] ? ST.TERBIT : ST.REVISI;
    writeObj_('SuratKeluar', r._row, { Status: kembali, 'Catatan Persetujuan': catatan, 'Revisi JSON': '', Diperbarui: stamp_() }, r);
    const pembuat = users_().find(function (u) { return u.ID === r['Dibuat Oleh']; });
    if (pembuat) notify_([pembuat], { judul: 'Surat perlu revisi', jenis: 'revisi', ref: r.ID, pesan: r.Jenis + ': ' + r.Perihal + '. Catatan dari ' + me.Nama + ': ' + catatan }, me);
    return { id: r.ID, status: kembali };
  }

  function api_listSurat(p) {
    const q = String(p.q || '').toLowerCase();
    const notifs = rows_('Notifikasi');
    let list = rows_('SuratKeluar').filter(function (r) {
      const st = statusOf_(r);
      if (p.tahun && r.Tahun !== String(p.tahun) && String(r.Tanggal).slice(0, 4) !== String(p.tahun)) return false;
      if (p.bulan && Number(String(r.Tanggal).slice(5, 7)) !== Number(p.bulan)) return false;
      if (p.jenis && r.Jenis !== p.jenis) return false;
      if (p.status && st !== p.status) return false;
      if (q) {
        const hay = [r['Nomor Surat'], r.Perihal, r.Tujuan, r.Jenis, r.Penandatangan, r['Data JSON']].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    list.sort(function (a, b) {
      const pa = sudahTerbit_(a) ? 1 : 0, pb = sudahTerbit_(b) ? 1 : 0;
      if (pa !== pb) return pa - pb;                       // draf/menunggu tampil paling atas
      if (a.Tanggal !== b.Tanggal) return a.Tanggal < b.Tanggal ? 1 : -1;
      return Number(b['No Urut']) - Number(a['No Urut']);
    });
    return list.slice(0, Number(p.limit || 500)).map(function (r) {
      const o = outKeluar_(r);
      const kir = notifs.filter(function (n) { return n.Ref === r.ID && n.Jenis === 'surat'; });
      o.terkirimKe = kir.length; o.dibacaOleh = kir.filter(function (n) { return n.Dibaca; }).length;
      return o;
    });
  }

  /** Data surat termasuk revisi yang sedang diajukan (bila ada) */
  function efektif_(r) {
    if (!r['Revisi JSON']) return r;
    try { return Object.assign({}, r, JSON.parse(r['Revisi JSON'])); } catch (e) { return r; }
  }

  function api_getSurat(p) {
    const r0 = rows_('SuratKeluar').find(function (x) { return x.ID === p.id; });
    if (!r0) throw new Error('Surat tidak ditemukan.');
    const r = efektif_(r0);
    const o = outKeluar_(r);
    o.revisi = !!r0['Revisi JSON'];
    try { o.data = JSON.parse(r['Data JSON'] || '{}'); } catch (e) { o.data = {}; }
    const notifs = rows_('Notifikasi').filter(function (n) { return n.Ref === r.ID && n.Jenis === 'surat'; });
    const users = {}; users_().forEach(function (u) { users[u.ID] = u; });
    o.pengiriman = notifs.map(function (n) { const u = users[n.Untuk] || {}; return { nama: u.Nama || '?', peran: PERAN[u.Peran] || '', dikirim: n.Dibuat, dibaca: n.Dibaca, wa: n.WA }; });
    return o;
  }

  function api_setStatus(p) {
    const allowed = [ST.TERBIT, ST.TERKIRIM, ST.BATAL, 'Diarsipkan'];
    if (allowed.indexOf(p.status) < 0) throw new Error('Status tidak valid.');
    const status = p.status === 'Diarsipkan' ? ST.TERBIT : p.status;
    const r = rows_('SuratKeluar').find(function (x) { return x.ID === p.id; });
    if (!r) throw new Error('Surat tidak ditemukan.');
    if (status !== ST.BATAL && !r['File ID']) throw new Error('Surat ini belum terbit.');
    if (r['File ID']) {
      try {
        const f = DriveApp.getFileById(r['File ID']);
        const nm = f.getName().replace(PREFIX_BATAL, '');
        f.setName((status === ST.BATAL ? PREFIX_BATAL : '') + nm);
      } catch (e) { }
    }
    writeObj_('SuratKeluar', r._row, { Status: !r['File ID'] && status === ST.BATAL ? ST.BATAL : status, Diperbarui: stamp_() }, r);
    return { id: p.id, status: status };
  }

  function api_deleteDraft(p) {
    const r = rows_('SuratKeluar').find(function (x) { return x.ID === p.id; });
    if (!r) throw new Error('Surat tidak ditemukan.');
    if (r['File ID'] || sudahTerbit_(r) && r['Nomor Surat']) throw new Error('Surat yang sudah terbit tidak bisa dihapus — gunakan "Batalkan".');
    sheet_('SuratKeluar').deleteRow(r._row);
    return { id: p.id };
  }

  /**
   * Kirim surat yang sudah terbit ke penerimanya (wali santri / guru / akun tertentu).
   * Lapis 1: Kotak Masuk aplikasi (pasti). Lapis 2: WA bila aktif.
   */
  function api_kirimSurat(p, me) {
    const r = rows_('SuratKeluar').find(function (x) { return x.ID === p.id; });
    if (!r) throw new Error('Surat tidak ditemukan.');
    if (!sudahTerbit_(r) || !r['File ID']) throw new Error('Surat harus disetujui/terbit dulu sebelum dikirim.');
    let pen = {};
    try { pen = JSON.parse(r['Penerima JSON'] || '{}'); } catch (e) { }
    const santriIds = (p.santri || pen.santri || []), guruIds = (p.guru || pen.guru || []);
    let target = usersForPeople_(santriIds, guruIds);
    if (p.users && p.users.length) {
      const ids = p.users; target = target.concat(users_().filter(function (u) { return ids.indexOf(u.ID) >= 0; }));
    }
    const santri = people_('santri').filter(function (s) { return santriIds.indexOf(s.id) >= 0; });
    const guru = people_('guru').filter(function (g) { return guruIds.indexOf(g.id) >= 0; });
    const tanpaAkun = santri.filter(function (s) { return !usersForPeople_([s.id], []).length; }).map(function (s) { return 'Wali ' + s.nama; })
      .concat(guru.filter(function (g) { return !usersForPeople_([], [g.id]).length; }).map(function (g) { return g.nama; }));
    if (!target.length) throw new Error('Belum ada akun penerima untuk surat ini' + (tanpaAkun.length ? ' (' + tanpaAkun.join(', ') + ' belum punya akun WASIAT)' : '') + '. Tambahkan akunnya di WASIAT (RoleAkses): Orang Tua Santri dengan NISN anak, atau guru/pengurus.');
    const namaSantri = santri.map(function (s) { return s.nama; }).join(', ');
    const hasil = notify_(target, {
      judul: namaSantri ? 'Surat dari pondok untuk ananda ' + namaSantri : 'Surat dari pondok untuk Anda',
      pesan: r.Jenis + ' — ' + r.Perihal + ' (No. ' + r['Nomor Surat'] + ', ' + r.Tanggal + ').' + (p.pesan ? '\n' + p.pesan : ''),
      jenis: 'surat', ref: r.ID,
    }, me);
    const ringkas = 'Aplikasi: ' + hasil.app + ' akun · WA: ' + Object.keys(hasil.wa).filter(function (k) { return hasil.wa[k]; }).map(function (k) { return hasil.wa[k] + ' ' + k; }).join(', ');
    writeObj_('SuratKeluar', r._row, { Status: ST.TERKIRIM, 'Status Kirim': ringkas + ' · ' + stamp_(), Diperbarui: stamp_() }, r);
    return { app: hasil.app, wa: hasil.wa, tanpaAkun: tanpaAkun };
  }

  /** Unduh file surat untuk akun yang berhak (Drive tetap privat) */
  function api_getFile(p, me) {
    const kind = p.kind === 'masuk' ? 'masuk' : 'keluar';
    const r = rows_(kind === 'masuk' ? 'SuratMasuk' : 'SuratKeluar').find(function (x) { return x.ID === p.id; });
    if (!r || !r['File ID']) throw new Error('File surat tidak tersedia.');
    let boleh = PENGELOLA.indexOf(me.Peran) >= 0;
    if (!boleh) boleh = rows_('Notifikasi').some(function (n) { return n.Untuk === me.ID && n.Ref === r.ID; });
    if (!boleh && kind === 'masuk') boleh = r['Disposisi Ke'] === me.ID;
    if (!boleh) throw new Error('Anda tidak memiliki akses ke surat ini.');
    if (kind === 'keluar' && statusOf_(r) === ST.BATAL && PENGELOLA.indexOf(me.Peran) < 0) throw new Error('Surat ini telah dibatalkan oleh pondok.');
    const f = DriveApp.getFileById(r['File ID']);
    const b = f.getBlob();
    if (b.getBytes().length > 15 * 1024 * 1024) throw new Error('File terlalu besar untuk ditampilkan.');
    api_readNotif({ ref: r.ID }, me);
    return { name: f.getName(), mime: b.getContentType(), base64: Utilities.base64Encode(b.getBytes()) };
  }

  /* ================================================================
   *  SURAT MASUK + DISPOSISI
   * ================================================================ */
  function api_saveSuratMasuk(p, me) {
    if (!p.pengirim || !p.perihal) throw new Error('Pengirim dan perihal wajib diisi.');
    const lock = kunciSurat_();
    lock.waitLock(30000);
    try {
      const all = rows_('SuratMasuk');
      const d = parseDate_(p.tanggalTerima);
      const tahun = d.getFullYear();
      let max = 0;
      all.forEach(function (r) {
        if (r.Tahun !== String(tahun)) return;
        const n = Number((String(r['No Agenda']).match(/\d+/) || ['0'])[0]);
        if (n > max) max = n;
      });
      const noAgenda = 'SM.' + pad_(max + 1, 3) + '/' + tahun;

      let fileId = '', fileUrl = '';
      if (p.file && p.file.base64) {
        const folder = folderMasuk_(p.jenis, tahun);
        const name = safeName_(noAgenda + ' - ' + p.pengirim + ' - ' + p.perihal) + ext_(p.file.mime, p.file.name);
        const blob = Utilities.newBlob(Utilities.base64Decode(p.file.base64), p.file.mime || 'application/octet-stream', name);
        const f = folder.createFile(blob);
        fileId = f.getId(); fileUrl = f.getUrl();
      }
      const tujuan = p.disposisiKe ? users_().find(function (u) { return u.ID === p.disposisiKe; }) : null;
      const o = {
        ID: uid_(), 'No Agenda': noAgenda, Tahun: String(tahun), 'Nomor Surat': p.nomorSurat || '-', 'Tanggal Surat': p.tanggalSurat || '',
        'Tanggal Diterima': ymd_(d), Pengirim: p.pengirim, Perihal: p.perihal,
        Disposisi: tujuan ? tujuan.Nama + ' (' + (PERAN[tujuan.Peran] || tujuan.Peran) + ')' : (p.disposisi || ''),
        Keterangan: p.keterangan || '', 'File ID': fileId, 'Link File': fileUrl, Dicatat: stamp_(), Jenis: jenisMasuk_(p.jenis),
        'Disposisi Ke': tujuan ? tujuan.ID : '', 'Status Tindak Lanjut': tujuan ? 'Belum' : '', 'Dicatat Oleh': me.ID,
      };
      writeObj_('SuratMasuk', null, o);
      let notif = null;
      if (tujuan) {
        notif = notify_([tujuan], {
          judul: 'Disposisi surat masuk', jenis: 'disposisi', ref: o.ID,
          pesan: 'Dari ' + o.Pengirim + ': ' + o.Perihal + ' (Agenda ' + noAgenda + ').' + (o.Keterangan ? ' Catatan: ' + o.Keterangan : '') + ' Mohon ditindaklanjuti.',
        }, me);
      }
      return { id: o.ID, noAgenda: noAgenda, url: fileUrl, notif: notif };
    } finally {
      lock.releaseLock();
    }
  }

  function api_listSuratMasuk(p) {
    const q = String(p.q || '').toLowerCase();
    let list = rows_('SuratMasuk').filter(function (r) {
      if (p.tahun && r.Tahun !== String(p.tahun)) return false;
      if (p.bulan && Number(String(r['Tanggal Diterima']).slice(5, 7)) !== Number(p.bulan)) return false;
      if (p.jenis && jenisMasuk_(r.Jenis) !== p.jenis) return false;
      if (q) {
        const hay = [r['No Agenda'], r['Nomor Surat'], r.Pengirim, r.Perihal, r.Disposisi].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    list.sort(function (a, b) { return a['Tanggal Diterima'] < b['Tanggal Diterima'] ? 1 : a['Tanggal Diterima'] > b['Tanggal Diterima'] ? -1 : (a['No Agenda'] < b['No Agenda'] ? 1 : -1); });
    return list.slice(0, Number(p.limit || 500)).map(outMasuk_);
  }

  function api_listDisposisiSaya(p, me) {
    return rows_('SuratMasuk').filter(function (r) { return r['Disposisi Ke'] === me.ID; })
      .sort(function (a, b) { return a.Dicatat < b.Dicatat ? 1 : -1; }).map(outMasuk_);
  }

  function api_tindakLanjut(p, me) {
    const r = rows_('SuratMasuk').find(function (x) { return x.ID === p.id; });
    if (!r) throw new Error('Surat tidak ditemukan.');
    if (r['Disposisi Ke'] !== me.ID && PENGELOLA.indexOf(me.Peran) < 0) throw new Error('Disposisi ini bukan untuk akun Anda.');
    const st = p.status === 'Proses' ? 'Proses' : 'Selesai';
    writeObj_('SuratMasuk', r._row, { 'Status Tindak Lanjut': st, 'Catatan Tindak Lanjut': String(p.catatan || '').slice(0, 1000), 'Ditindaklanjuti Pada': stamp_() }, r);
    const pencatat = users_().filter(function (u) { return u.ID === r['Dicatat Oleh'] || u.Peran === 'admin'; }).filter(function (u) { return u.ID !== me.ID; });
    notify_(pencatat, { judul: 'Tindak lanjut disposisi: ' + st, jenis: 'info', ref: r.ID,
      pesan: me.Nama + ' — ' + r.Perihal + ' (' + r['No Agenda'] + ')' + (p.catatan ? ': ' + p.catatan : '') }, me);
    return { id: r.ID, status: st };
  }

  function api_dashboard(p, me) {
    const now = new Date();
    const y = String(now.getFullYear());
    const mm = pad_(now.getMonth() + 1, 2);
    const kel = rows_('SuratKeluar');
    const mas = rows_('SuratMasuk');
    const kelAktif = kel.filter(sudahTerbit_);
    const sortDesc = function (key) { return function (a, b) { return a[key] < b[key] ? 1 : -1; }; };
    return {
      keluarTahun: kelAktif.filter(function (r) { return r.Tahun === y; }).length,
      keluarBulan: kelAktif.filter(function (r) { return String(r.Tanggal).slice(0, 7) === y + '-' + mm; }).length,
      masukTahun: mas.filter(function (r) { return r.Tahun === y; }).length,
      masukBulan: mas.filter(function (r) { return String(r['Tanggal Diterima']).slice(0, 7) === y + '-' + mm; }).length,
      menunggu: kel.filter(function (r) { return statusOf_(r) === ST.MENUNGGU; }).length,
      menungguSaya: kel.filter(function (r) { return statusOf_(r) === ST.MENUNGGU && bolehSetujui_(me, r); }).length,
      revisi: kel.filter(function (r) { return statusOf_(r) === ST.REVISI; }).length,
      draf: kel.filter(function (r) { return statusOf_(r) === ST.DRAF; }).length,
      disposisiBelum: mas.filter(function (r) { return r['Status Tindak Lanjut'] && r['Status Tindak Lanjut'] !== 'Selesai'; }).length,
      terakhirKeluar: kel.slice().sort(sortDesc('Diperbarui')).slice(0, 6).map(outKeluar_),
      folderKeluar: subFolders_(F.KELUAR, kelAktif.map(function (r) { return r.Kategori || r.Jenis; })),
      folderMasuk: subFolders_(F.MASUK, mas.map(function (r) { return jenisMasuk_(r.Jenis); })),
      jenisMasuk: JENIS_MASUK,
      wa: waStatus_(),
      rootUrl: root_().getUrl(),
      dbUrl: db_().getUrl(),
    };
  }

  /* ---------------- penulisan baris berdasarkan nama kolom ---------------- */
  function writeObj_(name, rowIdx, o, base) {
    const h = HEAD[name];
    const merged = {};
    h.forEach(function (k) { merged[k] = (o && k in o) ? o[k] : (base && base[k] != null ? base[k] : ''); });
    const sh = sheet_(name);
    const row = h.map(function (k) { return merged[k] == null ? '' : merged[k]; });
    if (rowIdx) writeRow_(sh, rowIdx, row); else appendText_(sh, row);
    return merged;
  }

  function outKeluar_(r) {
    return {
      id: r.ID, urut: r['No Urut'], tahun: r.Tahun, nomor: r['Nomor Surat'], tanggal: r.Tanggal,
      jenis: r.Jenis, kode: r.Kode, perihal: r.Perihal, tujuan: r.Tujuan, penandatangan: r.Penandatangan,
      status: statusOf_(r), fileId: r['File ID'], url: r['Link PDF'], dibuat: r.Dibuat, diperbarui: r.Diperbarui, kategori: r.Kategori,
      catatan: r['Catatan Persetujuan'], disetujuiOleh: r['Disetujui Oleh'], disetujuiPada: r['Disetujui Pada'],
      kodeVerifikasi: r['Kode Verifikasi'], statusKirim: r['Status Kirim'], dibuatOleh: namaUser_(r['Dibuat Oleh']),
      revisi: !!r['Revisi JSON'],
      arsip: String(r['Data JSON'] || '').indexOf('"arsipLama":true') >= 0,
    };
  }


  function outMasuk_(r) {
    return {
      id: r.ID, noAgenda: r['No Agenda'], tahun: r.Tahun, nomor: r['Nomor Surat'],
      tanggalSurat: r['Tanggal Surat'], tanggalTerima: r['Tanggal Diterima'], pengirim: r.Pengirim,
      perihal: r.Perihal, disposisi: r.Disposisi, keterangan: r.Keterangan, url: r['Link File'], dicatat: r.Dicatat,
      jenis: jenisMasuk_(r.Jenis), adaFile: !!r['File ID'],
      disposisiKe: r['Disposisi Ke'], tindakLanjut: r['Status Tindak Lanjut'], catatanTL: r['Catatan Tindak Lanjut'], tlPada: r['Ditindaklanjuti Pada'],
    };
  }

  /* ---------------- DATA SANTRI & GURU ---------------- */

  function personRow_(jenis, d) {
    return PEOPLE[jenis].keys.map(function (k) { return k === 'diperbarui' ? stamp_() : String(d[k] == null ? '' : d[k]).trim(); });
  }

  function clean_(o) { const c = {}; Object.keys(o).forEach(function (k) { if (k !== '_row') c[k] = o[k]; }); return c; }

  function api_listPeople(p) {
    const out = {};
    const list = p && p.jenis ? [p.jenis] : Object.keys(PEOPLE);
    list.forEach(function (j) {
      out[j] = people_(j).map(clean_).sort(function (a, b) { return a.nama.localeCompare(b.nama); });
    });
    return out;
  }



  /** Impor banyak data sekaligus (dari tempel Excel). mode: 'tambah' (perbarui yang sama) | 'ganti' (hapus semua dulu) */

  /* ---------------- TEMPLATE KUSTOM ---------------- */
  function api_listTemplates() {
    return rows_('Template').map(function (r) {
      try { const d = JSON.parse(r['Definisi JSON']); d.id = r.ID; return d; } catch (e) { return null; }
    }).filter(Boolean);
  }

  function api_saveTemplate(p) {
    const d = p.def || {};
    d.nama = String(d.nama || '').trim();
    d.kategori = String(d.kategori || '').trim();
    if (!d.nama || !d.kategori) throw new Error('Nama template dan kategori wajib diisi.');
    if (!d.isi) throw new Error('Isi surat kosong.');
    if (JSON.stringify(d).length > 45000) throw new Error('Template terlalu panjang.');
    const lock = kunciSurat_();
    lock.waitLock(30000);
    try {
      const sh = sheet_('Template');
      const all = rows_('Template');
      if (all.some(function (r) { return r.Nama.toLowerCase() === d.nama.toLowerCase() && r.ID !== d.id; })) {
        throw new Error('Nama template "' + d.nama + '" sudah dipakai.');
      }
      const ex = d.id ? all.find(function (r) { return r.ID === d.id; }) : null;
      if (!d.id || !ex) d.id = 'c_' + uid_();
      const now = stamp_();
      const row = [d.id, d.nama, d.kategori, d.kode || '', JSON.stringify(d), ex ? ex.Dibuat : now, now];
      if (ex) writeRow_(sh, ex._row, row); else appendText_(sh, row);
      const folder = folderKategori_(d.kategori, d.nama);
      return { def: d, folderUrl: folder.getUrl(), list: api_listTemplates() };
    } finally {
      lock.releaseLock();
    }
  }

  function api_deleteTemplate(p) {
    const sh = sheet_('Template');
    const r = rows_('Template').find(function (x) { return x.ID === p.id; });
    if (!r) throw new Error('Template tidak ditemukan.');
    sh.deleteRow(r._row);   // folder & surat yang sudah dibuat tetap disimpan
    return { list: api_listTemplates() };
  }

  function api_meta() {
    return { jenisMasuk: JENIS_MASUK };
  }

  /** Daftar sub-folder per jenis + jumlah surat (untuk dashboard) */
  function subFolders_(induk, jenisList) {
    const count = {};
    jenisList.forEach(function (j) { if (j) count[j] = (count[j] || 0) + 1; });
    const out = [];
    const it = folder_(root_(), induk).getFolders();
    while (it.hasNext()) {
      const f = it.next();
      out.push({ nama: f.getName(), url: f.getUrl(), jumlah: count[f.getName()] || 0 });
    }
    out.sort(function (a, b) { return a.nama < b.nama ? -1 : 1; });
    return out;
  }

  /* ================================================================
   *  HELPER
   * ================================================================ */



  function sheet_(name) {
    const ss = db_();
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      const h = HEAD[name];
      sh.getRange(1, 1, 1, h.length).setValues([h])
        .setFontWeight('bold').setBackground('#14532d').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    } else if (sh.getLastColumn() < HEAD[name].length) {
      const h = HEAD[name];
      sh.getRange(1, 1, 1, h.length).setValues([h])
        .setFontWeight('bold').setBackground('#14532d').setFontColor('#ffffff');
    }
    return sh;
  }

  function rows_(name) {
    const sh = sheet_(name);
    const last = sh.getLastRow();
    if (last < 2) return [];
    const h = HEAD[name];
    const v = sh.getRange(2, 1, last - 1, h.length).getDisplayValues();
    return v.map(function (r, i) {
      const o = { _row: i + 2 };
      h.forEach(function (k, j) { o[k] = r[j]; });
      return o;
    }).filter(function (o) { return o[h[0]] !== ''; });
  }

  function appendText_(sh, row) {
    const r = sh.getRange(sh.getLastRow() + 1, 1, 1, row.length);
    r.setNumberFormat('@');
    r.setValues([row.map(cell_)]);
  }

  function writeRow_(sh, rowIdx, row) {
    const r = sh.getRange(rowIdx, 1, 1, row.length);
    r.setNumberFormat('@');
    r.setValues([row.map(cell_)]);
  }

  function cell_(v) {
    v = v == null ? '' : String(v);
    return /^[=+@]/.test(v) ? "'" + v : v;
  }

  function settings_() {
    const s = {};
    Object.keys(DEFAULTS).forEach(function (k) { s[k] = DEFAULTS[k]; });
    rows_('Pengaturan').forEach(function (r) { s[r.Kunci] = r.Nilai; });
    return s;
  }

  function setSetting_(k, v) {
    const sh = sheet_('Pengaturan');
    const r = rows_('Pengaturan').find(function (x) { return x.Kunci === k; });
    if (r) writeRow_(sh, r._row, [k, v]); else appendText_(sh, [k, v]);
  }

  function nextUrut_(tahun, all) {
    all = all || rows_('SuratKeluar');
    let max = 0;
    all.forEach(function (r) {
      if (r.Tahun === String(tahun)) {
        const n = Number(r['No Urut']) || 0;
        if (n > max) max = n;
      }
    });
    return max + 1;
  }

  function formatNomor_(s, urut, d, kode) {
    const digit = Number(s.digitUrut) || 3;
    return String(s.formatNomor || DEFAULTS.formatNomor)
      .replace(/\{urut\}/g, pad_(urut, digit))
      .replace(/\{bulan\}/g, ROMAWI[d.getMonth()])
      .replace(/\{bulanAngka\}/g, pad_(d.getMonth() + 1, 2))
      .replace(/\{tahun\}/g, String(d.getFullYear()))
      .replace(/\{kode\}/g, kode || '');
  }

  function folder_(parent, name) {
    const it = parent.getFoldersByName(name);
    return it.hasNext() ? it.next() : parent.createFolder(name);
  }

  /**
   * Susunan folder surat keluar:
   *   kategori = jenis       → 01. Surat Keluar / <Jenis> / <Tahun>
   *   kategori berisi banyak → 01. Surat Keluar / <Kategori> / <Jenis> / <Tahun>
   */
  function folderKategori_(kategori, jenis) {
    const k = safeName_(kategori || jenis || 'Lainnya');
    const j = safeName_(jenis || '');
    const parts = [F.KELUAR, k];
    if (j && j.toLowerCase() !== k.toLowerCase()) parts.push(j);
    return folderPath_(parts);
  }

  function folderKeluar_(kategori, jenis, tahun) {
    const base = folderKategori_(kategori, jenis);
    return folder_(base, String(tahun));
  }

  function folderMasuk_(jenis, tahun) {
    return folderPath_([F.MASUK, jenisMasuk_(jenis), String(tahun)]);
  }

  function jenisMasuk_(j) {
    return JENIS_MASUK.indexOf(j) >= 0 ? j : 'Lainnya';
  }

  function folderPath_(parts) {
    let f = root_();
    parts.forEach(function (p) { f = folder_(f, p); });
    return f;
  }

  function parseDate_(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
  }

  function ymd_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
  function stamp_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); }
  function pad_(n, len) { n = String(n); while (n.length < len) n = '0' + n; return n; }
  function uid_() { return Utilities.getUuid().split('-')[0] + Date.now().toString(36); }

  function safeName_(s) {
    return String(s).replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 150);
  }

  function ext_(mime, name) {
    if (name && /\.[a-z0-9]{2,5}$/i.test(name)) return name.match(/\.[a-z0-9]{2,5}$/i)[0].toLowerCase();
    const map = { 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
    return map[mime] || '';
  }

  function json_(o) {
    return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  }

  /**
   * ================================================================
   *  AKUN, PERAN, NOTIFIKASI (2 LAPIS), WA, VERIFIKASI QR
   *  File kedua di proyek Apps Script yang sama dengan Code.gs
   * ================================================================
   *  Lapis 1 : Kotak Masuk di aplikasi — SELALU tercatat, tidak bergantung WA
   *  Lapis 2 : WhatsApp (Wablas / Fonnte) — opsional. Bila token mati / gagal,
   *            proses surat tetap jalan; status WA hanya dicatat "gagal".
   * ================================================================
   */

  const PERAN = {
    admin: 'Sekretaris / Admin',
    mudir: 'Mudir (Pimpinan)',
    kabag: 'Kepala Bagian',
    bendahara: 'Bendahara',
    guru: 'Guru / Pembina',
    wali: 'Wali Santri',
  };
  const PENGELOLA = ['admin', 'mudir'];           // boleh mengelola persuratan
  const SESI_JAM = 24 * 14;                        // token berlaku 14 hari
  const WA_MAKS_PERCOBAAN = 3;

  /** Aksi yang boleh dipanggil tanpa login */
  const AKSI_PUBLIK = { login: true, verify: true };
  /** Aksi yang boleh dipanggil semua pengguna yang login (pembatasan rinci di dalam fungsi) */
  const AKSI_SEMUA = {
    ping: true, me: true, changeMyPin: true, getSettings: true,
    listNotif: true, readNotif: true, getFile: true,
    listPending: true, approve: true, reject: true,
    listDisposisiSaya: true, tindakLanjut: true, listTemplates: true,
  };

  /* ================================================================
   *  SANDI & TOKEN
   * ================================================================ */
  function secret_() {
    const P = props_();
    let s = P.getProperty('HMAC_SECRET');
    if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); P.setProperty('HMAC_SECRET', s); }
    return s;
  }

  function hashPin_(pin, salt) {
    let h = salt + '|' + pin;
    for (let i = 0; i < 300; i++) {
      h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt));
    }
    return h;
  }

  function b64w_(s) { return Utilities.base64EncodeWebSafe(s).replace(/=+$/, ''); }
  function sign_(payload) { return b64w_(Utilities.computeHmacSha256Signature(payload, secret_())); }



  function randomPin_(n) {
    let s = '';
    while (s.length < (n || 6)) s += String(Math.floor(Math.random() * 10));
    return s;
  }

  /* ================================================================
   *  PENGGUNA
   * ================================================================ */

  function terkait_(u) {
    try { const t = JSON.parse(u.Terkait || '[]'); return Array.isArray(t) ? t : []; } catch (e) { return []; }
  }

  function meOut_(u) {
    return {
      id: u.ID, nama: u.Nama, username: u.Username, role: u.Peran, peran: PERAN[u.Peran] || u.Peran,
      terkait: terkait_(u), noWa: u['No WA'], status: u.Status || 'Aktif',
      wajibGanti: u['Wajib Ganti PIN'] === 'ya', loginTerakhir: u['Login Terakhir'], dibuat: u.Dibuat,
    };
  }

  function normUser_(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ''); }

  function normPhone_(s) {
    let d = String(s || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.indexOf('0') === 0) d = '62' + d.slice(1);
    else if (d.indexOf('8') === 0) d = '62' + d;
    return d.length >= 10 ? d : '';
  }

  /** Membuat akun admin pertama bila belum ada (dipanggil dari setup) */


  function api_me(p, me) {
    return { user: meOut_(me), unread: unreadCount_(me.ID) };
  }






  /** Buat akun wali otomatis dari data santri aktif (satu akun per nomor HP wali; kakak-adik digabung) */

  /** Buat akun guru/pengurus dari data guru aktif */

  /** Akun-akun yang terkait dengan santri / guru tertentu */
  function usersForPeople_(santriIds, guruIds) {
    const s = santriIds || [], g = guruIds || [];
    return users_().filter(function (u) {
      if (u.Status === 'Nonaktif') return false;
      const t = terkait_(u);
      return t.some(function (x) { return s.indexOf(x) >= 0 || g.indexOf(x) >= 0; });
    });
  }
  function usersByRole_(roles) {
    return users_().filter(function (u) { return u.Status !== 'Nonaktif' && roles.indexOf(u.Peran) >= 0; });
  }

  /* ================================================================
   *  NOTIFIKASI — LAPIS 1 (APLIKASI) + LAPIS 2 (WA, OPSIONAL)
   * ================================================================ */
  function unreadCount_(uid) {
    return rows_('Notifikasi').filter(function (n) { return n.Untuk === uid && !n.Dibaca; }).length;
  }

  /**
   * Kirim notifikasi ke banyak akun. Lapis 1 SELALU dicatat lebih dulu.
   * WA hanya dicoba setelahnya; kegagalan WA tidak pernah membatalkan proses.
   */
  function notify_(users, n, dari) {
    const seen = {};
    users = (users || []).filter(function (u) { if (!u || seen[u.ID] || u.Status === 'Nonaktif') return false; seen[u.ID] = 1; return true; });
    const hasil = { app: 0, wa: { terkirim: 0, antri: 0, gagal: 0, nonaktif: 0, 'tanpa nomor': 0 } };
    if (!users.length) return hasil;

    // ---- LAPIS 1: Kotak Masuk aplikasi ----
    const waOn = waEnabled_();
    const now = stamp_();
    const rows = users.map(function (u) {
      return {
        ID: 'N' + uid_(), Untuk: u.ID, Judul: n.judul || 'Notifikasi', Pesan: n.pesan || '', Jenis: n.jenis || 'info',
        Ref: n.ref || '', Dibuat: now, Dibaca: '', Dari: dari ? dari.Nama : 'Sistem',
        WA: !waOn ? 'nonaktif' : (normPhone_(u['No WA']) ? 'antri' : 'tanpa nomor'), 'Info WA': '', 'Percobaan WA': '0',
      };
    });
    const sh = sheet_('Notifikasi');
    const start = sh.getLastRow() + 1;
    const h = HEAD.Notifikasi;
    const rg = sh.getRange(start, 1, rows.length, h.length);
    rg.setNumberFormat('@');
    rg.setValues(rows.map(function (o) { return h.map(function (k) { return cell_(o[k]); }); }));
    hasil.app = rows.length;
    // Tambahan WASIAT: surat untuk wali juga dikabarkan lewat notifikasi push aplikasi WASIAT
    try {
      if (n.jenis === 'surat') users.forEach(function (u) {
        if (u.Peran !== 'wali') return;
        terkait_(u).forEach(function (nisn) { if (String(nisn).indexOf('G:') !== 0) kirimPushKeWali(nisn, n.judul || 'Surat dari pondok', n.pesan || ''); });
      });
    } catch (e) { Logger.log('Push wali (persuratan) dilewati: ' + e.message); }

    // ---- LAPIS 2: WA (dicoba langsung untuk sedikit penerima, sisanya lewat antrian) ----
    try {
      if (waOn) {
        if (rows.some(function (o) { return o.WA === 'antri'; }) && rows.length > 5) pastikanPemicuWa_();
        const langsung = rows.length <= 5;
        if (langsung) {
          const colWa = h.indexOf('WA') + 1;
          const out = rows.map(function (o, i) {
            if (o.WA !== 'antri') return [o.WA, '', '0'];
            const r = sendWa_(users[i]['No WA'], waText_(o));
            return [r.status === 'terkirim' ? 'terkirim' : 'antri', r.info || '', '1'];
          });
          sh.getRange(start, colWa, out.length, 3).setValues(out);
          out.forEach(function (x) { hasil.wa[x[0]] = (hasil.wa[x[0]] || 0) + 1; });
        } else {
          rows.forEach(function (o) { hasil.wa[o.WA] = (hasil.wa[o.WA] || 0) + 1; });
        }
      } else {
        hasil.wa.nonaktif = rows.length;
      }
    } catch (e) {
      Logger.log('WA dilewati: ' + e.message);   // tidak pernah menggagalkan proses utama
    }
    return hasil;
  }

  function waText_(o) {
    const s = settings_();
    const url = s.appUrl ? '\n\nBuka aplikasi: ' + s.appUrl : '';
    return '*' + o.Judul + '*\n' + o.Pesan + url + '\n\n_' + (s.namaResmi || 'Pondok Pesantren') + '_';
  }


  /** Kirim satu pesan WA. Tidak pernah melempar error. */

  function catatWa_(ok, info) {
    try {
      props_().setProperty('WA_LAST', JSON.stringify({ ok: ok, waktu: stamp_(), info: String(info).slice(0, 200) }));
    } catch (e) { }
  }

  /**
   * Pemicu waktu (dibuat oleh setup): mengirim WA yang masih antri, coba ulang
   * maksimal 3 kali. Kalau WA tetap gagal, notifikasi tetap ada di aplikasi.
   */
  function prosesAntrianWa() {
    if (!waEnabled_()) return;
    const lock = kunciSurat_();
    if (!lock.tryLock(5000)) return;
    try {
      const sh = sheet_('Notifikasi');
      const h = HEAD.Notifikasi;
      const colWa = h.indexOf('WA') + 1;
      const list = rows_('Notifikasi').filter(function (n) { return n.WA === 'antri'; }).slice(0, 40);
      if (!list.length) return;
      const users = {}; users_().forEach(function (u) { users[u.ID] = u; });
      let gagalBeruntun = 0;
      list.forEach(function (n) {
        if (gagalBeruntun >= 3) return;                       // WA sedang bermasalah → coba lagi nanti
        const u = users[n.Untuk];
        const coba = Number(n['Percobaan WA'] || 0) + 1;
        let st, info;
        if (!u || !normPhone_(u['No WA'])) { st = 'tanpa nomor'; info = ''; }
        else {
          const r = sendWa_(u['No WA'], waText_(n));
          if (r.status === 'terkirim') { st = 'terkirim'; info = ''; gagalBeruntun = 0; }
          else { st = coba >= WA_MAKS_PERCOBAAN ? 'gagal' : 'antri'; info = r.info || ''; gagalBeruntun++; }
        }
        sh.getRange(n._row, colWa, 1, 3).setValues([[st, info, String(coba)]]);
      });
    } finally { lock.releaseLock(); }
  }


  function api_listNotif(p, me) {
    const all = rows_('Notifikasi').filter(function (n) { return n.Untuk === me.ID; });
    all.sort(function (a, b) { return a.Dibuat < b.Dibuat ? 1 : -1; });
    return {
      unread: all.filter(function (n) { return !n.Dibaca; }).length,
      list: all.slice(0, Number(p.limit || 100)).map(function (n) {
        return { id: n.ID, judul: n.Judul, pesan: n.Pesan, jenis: n.Jenis, ref: n.Ref, dibuat: n.Dibuat, dibaca: n.Dibaca, dari: n.Dari, wa: n.WA };
      }),
    };
  }

  function api_readNotif(p, me) {
    const sh = sheet_('Notifikasi');
    const col = HEAD.Notifikasi.indexOf('Dibaca') + 1;
    const now = stamp_();
    rows_('Notifikasi').forEach(function (n) {
      if (n.Untuk !== me.ID || n.Dibaca) return;
      if (p.all || n.ID === p.id || (p.ref && n.Ref === p.ref)) sh.getRange(n._row, col).setNumberFormat('@').setValue(now);
    });
    return { unread: unreadCount_(me.ID) };
  }

  function api_waTest(p) {
    const r = sendWa_(p.nomor, '*Uji coba notifikasi*\nPesan ini dikirim dari aplikasi persuratan ' + (settings_().namaResmi || '') + '. Jika Anda menerimanya, WA sudah tersambung.');
    return r;
  }


  /* ================================================================
   *  VERIFIKASI QR (PUBLIK)
   * ================================================================ */
  function api_verify(p) {
    const k = String(p.kode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (k.length < 8) return { ditemukan: false };
    const r = rows_('SuratKeluar').find(function (x) { return String(x['Kode Verifikasi']).replace(/[^A-Z0-9]/g, '') === k; });
    const s = settings_();
    if (!r) return { ditemukan: false, lembaga: s.namaResmi };
    const st = statusOf_(r);
    return {
      ditemukan: true, lembaga: s.namaResmi,
      nomor: r['Nomor Surat'], tanggal: r.Tanggal, jenis: r.Jenis, perihal: r.Perihal,
      penandatangan: r.Penandatangan, disetujuiPada: r['Disetujui Pada'],
      sah: !!r['File ID'] && st !== ST.BATAL, status: st === ST.BATAL ? st : 'Terbit',
    };
  }


  /* ================================================================
   *  PENYESUAIAN UNTUK WASIAT
   *  - Akun: memakai akun WASIAT (sheet RoleAkses). Tidak ada akun/PIN terpisah.
   *  - Data santri & guru: dibaca dari data WASIAT (Santri, Rombel, Guru, RoleAkses);
   *    isian tambahan (NIS, TTL, asrama, alamat, dll.) disimpan di Buku Agenda.
   *  - WhatsApp: memakai pengaturan WhatsApp WASIAT (Wablas/Fonnte).
   *  - Kunci: kunci khusus persuratan, TIDAK menahan kunci transaksi WASIAT
   *    (kantin/saldo/SPP tetap lancar walau PDF surat sedang dibuat).
   *  - Properti skrip diberi awalan SURAT_ agar tidak bertabrakan dengan WASIAT.
   * ================================================================ */
  function props_() {
    const P = PropertiesService.getScriptProperties();
    return {
      getProperty: function (k) { return P.getProperty('SURAT_' + k); },
      setProperty: function (k, v) { return P.setProperty('SURAT_' + k, v); },
      deleteProperty: function (k) { return P.deleteProperty('SURAT_' + k); },
    };
  }

  /** Kunci khusus persuratan: kunci skrip hanya dipegang sesaat untuk memasang penanda di cache. */
  function kunciSurat_() {
    let dipegang = false;
    function coba() {
      const l = LockService.getScriptLock();
      if (!l.tryLock(10000)) return false;
      try {
        const c = CacheService.getScriptCache();
        if (c.get('SURAT_KUNCI')) return false;
        c.put('SURAT_KUNCI', '1', 120);
        return true;
      } finally { l.releaseLock(); }
    }
    function tunggu(ms) {
      const batas = Date.now() + (ms || 30000);
      while (true) {
        if (coba()) { dipegang = true; return true; }
        if (Date.now() > batas) return false;
        Utilities.sleep(400);
      }
    }
    return {
      waitLock: function (ms) { if (!tunggu(ms)) throw new Error('Persuratan sedang memproses surat lain. Coba lagi sebentar.'); },
      tryLock: function (ms) { return tunggu(ms); },
      releaseLock: function () { if (dipegang) { try { CacheService.getScriptCache().remove('SURAT_KUNCI'); } catch (e) { } dipegang = false; } },
    };
  }

  /* ---------------- Basis data & folder: dibuat otomatis saat pertama dipakai ---------------- */
  function db_() {
    let id = props_().getProperty('DB_ID');
    if (!id) { setup(); id = props_().getProperty('DB_ID'); }
    if (!_dbMemo || _dbMemoId !== id) { _dbMemo = SpreadsheetApp.openById(id); _dbMemoId = id; }
    return _dbMemo;
  }
  let _dbMemo = null, _dbMemoId = '';
  function root_() {
    let id = props_().getProperty('ROOT_ID');
    if (!id) { setup(); id = props_().getProperty('ROOT_ID'); }
    return DriveApp.getFolderById(id);
  }

  function setup() {
    const kunci = kunciSurat_(); kunci.waitLock(60000);
    try {
      const P = props_();
      let root = null;
      const rootId = P.getProperty('ROOT_ID');
      if (rootId) { try { root = DriveApp.getFolderById(rootId); } catch (e) { root = null; } }
      if (!root) {
        root = DriveApp.createFolder(CFG.ROOT_NAME);
        P.setProperty('ROOT_ID', root.getId());
      }
      let ss = null;
      const dbId = P.getProperty('DB_ID');
      if (dbId) { try { ss = SpreadsheetApp.openById(dbId); } catch (e) { ss = null; } }
      if (!ss) {
        ss = SpreadsheetApp.create(CFG.DB_NAME);
        DriveApp.getFileById(ss.getId()).moveTo(root);
        P.setProperty('DB_ID', ss.getId());
      }
      _dbMemo = ss; _dbMemoId = ss.getId();
      Object.keys(HEAD).forEach(function (name) { sheet_(name); });
      const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('Lembar1');
      if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
      const sh = sheet_('Pengaturan');
      const cur = rows_('Pengaturan');
      Object.keys(DEFAULTS).forEach(function (k) {
        if (!cur.some(function (r) { return r.Kunci === k; })) appendText_(sh, [k, DEFAULTS[k]]);
      });
      [F.KELUAR, F.MASUK, F.SET].forEach(function (n) { folder_(root, n); });
      JENIS_MASUK.forEach(function (n) { folder_(folder_(root, F.MASUK), n); });
      KATEGORI_BAWAAN.forEach(function (n) { folder_(folder_(root, F.KELUAR), n); });
      rows_('SuratKeluar').forEach(function (r) { if (r.Status === 'Diarsipkan') writeObj_('SuratKeluar', r._row, { Status: ST.TERBIT }, r); });
      secret_();
      pastikanPemicuWa_();
      return { folder: root.getUrl(), database: ss.getUrl() };
    } finally { kunci.releaseLock(); }
  }

  /** Pakai Buku Agenda & folder PERSURATAN yang sudah ada (dari Simpel Surat versi berdiri sendiri). */
  function hubungkanArsipLama(idSpreadsheet) {
    const id = String(idSpreadsheet || '').trim().replace(/^.*\/d\/([A-Za-z0-9_-]+).*$/, '$1');
    if (!id) throw new Error('Isi ID / link spreadsheet "00. BUKU AGENDA SURAT".');
    const ss = SpreadsheetApp.openById(id);
    const induk = DriveApp.getFileById(id).getParents();
    if (!induk.hasNext()) throw new Error('Folder induk Buku Agenda tidak ditemukan.');
    const root = induk.next();
    props_().setProperty('DB_ID', id);
    props_().setProperty('ROOT_ID', root.getId());
    _dbMemo = null;
    const hasil = setup();
    return { buku: ss.getName(), folder: root.getName(), url: hasil.folder };
  }

  /* ---------------- AKUN dari WASIAT (RoleAkses) ---------------- */
  const PETA_PERAN_WASIAT_ = [
    ['mudir', ['Mudir']],
    ['admin', ['Admin', 'Sekretaris']],
    ['kabag', ['KabagPutra', 'KabagPutri', 'Kabag']],
    ['bendahara', ['Bendahara']],
    ['guru', ['Guru', 'WaliKelas', 'Pembina', 'PembinaPutra', 'PembinaPutri', 'PemilikBarang', 'Imam']],
    ['wali', ['WaliSantri']],
  ];
  function peranDariWasiat_(level) {
    const roles = String(level || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    for (let i = 0; i < PETA_PERAN_WASIAT_.length; i++) {
      if (PETA_PERAN_WASIAT_[i][1].some(function (r) { return roles.indexOf(r) >= 0; })) return PETA_PERAN_WASIAT_[i][0];
    }
    return '';
  }
  function kunciNama_(s) { return normNama(s).replace(/[^a-z0-9]/g, ''); }
  function idGuru_(nama) { return 'G:' + kunciNama_(nama); }

  let _usersMemo = null;
  function users_() {
    if (_usersMemo) return _usersMemo;
    const hasil = [];
    const sh = getAktifSS().getSheetByName(SHEET_ROLE);
    if (sh && sh.getLastRow() > 1) {
      const sudah = {};
      sh.getDataRange().getValues().slice(1).forEach(function (r) {
        const nama = norm(r[0]); if (!nama) return;
        const peran = peranDariWasiat_(r[3]); if (!peran) return;
        const id = 'W' + kunciNama_(nama);
        if (sudah[id]) return; sudah[id] = 1;
        const roles = norm(r[3]).split(',').map(function (s) { return s.trim(); });
        const terkait = [];
        if (roles.indexOf('WaliSantri') >= 0) norm(r[4]).split(',').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (n) { terkait.push(n); });
        if (roles.some(function (x) { return x && x !== 'WaliSantri'; })) terkait.push(idGuru_(nama));
        hasil.push({
          ID: id, Nama: nama, Username: norm(r[1]) || nama, Peran: peran, Terkait: JSON.stringify(terkait),
          'No WA': norm(r[1]), Status: 'Aktif', 'Wajib Ganti PIN': '', 'Login Terakhir': '', Dibuat: '',
          _pin: norm(r[2]), _level: norm(r[3]),
        });
      });
    }
    _usersMemo = hasil;
    return hasil;
  }
  /** Versi token mengikuti PIN WASIAT: PIN diganti → sesi persuratan lama otomatis berakhir */
  function versiUser_(u) {
    const h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(u._pin || '') + '|' + u.ID + '|' + secret_());
    return Utilities.base64EncodeWebSafe(h).slice(0, 10);
  }
  function makeToken_(u) {
    const payload = [u.ID, versiUser_(u), Date.now() + SESI_JAM * 3600 * 1000].join('|');
    return b64w_(payload) + '.' + sign_(payload);
  }
  function readToken_(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    let payload;
    try { payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0] + '==='.slice((parts[0].length + 3) % 4))).getDataAsString(); }
    catch (e) { return null; }
    if (sign_(payload) !== parts[1]) return null;
    const p = payload.split('|');
    if (Number(p[2]) < Date.now()) return null;
    const u = users_().find(function (x) { return x.ID === p[0]; });
    if (!u || u.Status === 'Nonaktif' || versiUser_(u) !== p[1]) return null;
    return u;
  }
  /** Dipakai login WASIAT: token persuratan untuk akun RoleAkses ini (kosong bila perannya tidak dikenal). */
  function tokenUntukNama(nama) {
    const u = users_().find(function (x) { return x.ID === 'W' + kunciNama_(nama); });
    return u ? makeToken_(u) : '';
  }

  function api_login(p) {
    const un = String(p.username || '').trim();
    const pin = String(p.pin || '').trim();
    if (!un || !pin) throw new Error('Isi Nama / No WA dan PIN akun WASIAT Anda.');
    const cache = CacheService.getScriptCache();
    const ck = 'surat_gagal_' + kunciNama_(un).slice(0, 60);
    const gagal = Number(cache.get(ck) || 0);
    if (gagal >= 5) throw new Error('Terlalu banyak percobaan gagal. Coba lagi 10 menit lagi.');
    const u = users_().find(function (x) { return (normNama(x.Nama) === normNama(un) || (x['No WA'] && x['No WA'] === un)) && x._pin === pin; });
    if (!u) {
      cache.put(ck, String(gagal + 1), 600);
      throw new Error('Nama/No WA atau PIN salah, atau akun ini belum punya peran yang memakai persuratan. Gunakan akun WASIAT Anda.');
    }
    cache.remove(ck);
    if (p.appUrl && PENGELOLA.indexOf(u.Peran) >= 0 && /^https:\/\//.test(p.appUrl)) setSetting_('appUrl', String(p.appUrl).slice(0, 300));
    return { token: makeToken_(u), user: meOut_(u), unread: unreadCount_(u.ID) };
  }
  function api_changeMyPin() { throw new Error('PIN dikelola di WASIAT. Ganti PIN lewat akun WASIAT Anda (atau minta Admin).'); }
  function api_listUsers() {
    return users_().map(meOut_).sort(function (a, b) {
      return (a.role === b.role ? 0 : Object.keys(PERAN).indexOf(a.role) - Object.keys(PERAN).indexOf(b.role)) || a.nama.localeCompare(b.nama);
    });
  }
  function akunDiWasiat_() { throw new Error('Akun dikelola di WASIAT (Dashboard Admin → kelola akun / RoleAkses). Perubahan di sana langsung berlaku di persuratan.'); }
  function api_saveUser() { akunDiWasiat_(); }
  function api_resetPin() { akunDiWasiat_(); }
  function api_deleteUser() { akunDiWasiat_(); }
  function api_buatAkunWali() { akunDiWasiat_(); }
  function api_buatAkunGuru() { akunDiWasiat_(); }

  /** Nama pembuat surat lama (akun Simpel Surat sebelum digabung) tetap terbaca */
  let _userNames = null;
  function namaUser_(id) {
    if (!id) return '';
    if (!_userNames) {
      _userNames = {};
      try {
        const sh = db_().getSheetByName('Pengguna');
        if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues().forEach(function (r) { if (r[0]) _userNames[r[0]] = r[1]; });
      } catch (e) { }
      users_().forEach(function (u) { _userNames[u.ID] = u.Nama; });
    }
    return _userNames[id] || '';
  }

  /** Penandatangan dicocokkan dengan pencocokan nama WASIAT (gelar & ejaan "Ust." tidak mengganggu) */
  function samaNamaSurat_(a, b) {
    a = String(a || '').trim(); b = String(b || '').trim();
    if (!a || !b) return false;
    if (a.toLowerCase() === b.toLowerCase()) return true;
    try { return samaGuru_(a, b); } catch (e) { return false; }
  }
  function bolehTtd_(me, i, s, signers) {
    if (!me) return false;
    if (me.Peran === 'mudir') return true;
    const sg = signers[i];
    if (sg && samaNamaSurat_(sg.nama, me.Nama)) return true;
    return me.Peran === 'admin' && s.wajibPersetujuan === 'tidak';
  }
  function approversFor_(r) {
    let idx = 0;
    try { idx = Number((JSON.parse(r['Data JSON'] || '{}').values || {})._ttd) || 0; } catch (e) { }
    const sg = signers_(settings_())[idx];
    const aktif = users_().filter(function (u) { return u.Status !== 'Nonaktif' && u.Peran !== 'wali'; });
    const cocok = sg && sg.nama ? aktif.filter(function (u) { return samaNamaSurat_(u.Nama, sg.nama); }) : [];
    return cocok.length ? cocok : aktif.filter(function (u) { return u.Peran === 'mudir'; });
  }

  /* ---------------- DATA SANTRI & GURU dari WASIAT ---------------- */
  function tambahanOrang_(jenis) {
    const cfg = PEOPLE[jenis];
    const head = HEAD[cfg.sheet];
    return rows_(cfg.sheet).map(function (r) {
      const o = { _row: r._row };
      cfg.keys.forEach(function (k, i) { o[k] = r[head[i]]; });
      return o;
    });
  }
  function jkWasiat_(v) {
    const x = String(v || '').toLowerCase().replace(/[^a-z]/g, '');
    if (/^(l|lk|laki|lakilaki|putra|pria)$/.test(x)) return 'Laki-laki';
    if (/^(p|pr|perempuan|putri|wanita)$/.test(x)) return 'Perempuan';
    return String(v || '');
  }
  function people_(jenis) {
    if (!PEOPLE[jenis]) throw new Error('Jenis data tidak dikenal.');
    const ex = tambahanOrang_(jenis);
    const ss = getAktifSS();
    const pakai = function (a, b) { return String(a || '').trim() ? a : (b || ''); };
    if (jenis === 'santri') {
      const kelas = {}, wali = {};
      try { const sh = ss.getSheetByName(SHEET_ROMBEL); if (sh && sh.getLastRow() > 1) sh.getDataRange().getValues().slice(1).forEach(function (r) { if (norm(r[0])) kelas[norm(r[0])] = norm(r[2]); }); } catch (e) { }
      users_().forEach(function (u) {
        if (u._level.split(',').map(function (s) { return s.trim(); }).indexOf('WaliSantri') < 0) return;
        terkait_(u).forEach(function (n) { if (!wali[n]) wali[n] = { nama: u.Nama, hp: u['No WA'] }; });
      });
      const out = [];
      const sh = ss.getSheetByName(SHEET_SANTRI);
      if (sh && sh.getLastRow() > 1) sh.getDataRange().getValues().slice(1).forEach(function (r) {
        const nisn = norm(r[0]); if (!nisn) return;
        const e = ex.find(function (x) { return x.id === nisn || (x.nisn && x.nisn === nisn) || (x.nis && x.nis === nisn); }) || {};
        const w = wali[nisn] || {};
        out.push({
          id: nisn, nama: norm(r[1]), nis: e.nis || nisn, nisn: nisn, jk: pakai(e.jk, jkWasiat_(r[3])),
          tempatLahir: e.tempatLahir || '', tglLahir: e.tglLahir || '', kelas: kelas[nisn] || e.kelas || '',
          asrama: e.asrama || '', wali: pakai(e.wali, w.nama), hubunganWali: e.hubunganWali || '',
          hpWali: pakai(e.hpWali, pakai(norm(r[4]), w.hp)), alamat: e.alamat || '', status: 'Aktif', diperbarui: e.diperbarui || '',
          _row: e._row || null,
        });
      });
      return out;
    }
    // guru: sheet Guru WASIAT + tambahan (termasuk pengurus yang tidak tercatat di WASIAT)
    const out = [], sudah = {};
    const sh = ss.getSheetByName(SHEET_GURU);
    if (sh && sh.getLastRow() > 1) {
      const v = sh.getDataRange().getValues();
      const h = v[0].map(function (x) { return norm(x).toLowerCase(); });
      const kol = function (nama) { return h.indexOf(nama); };
      const iWa = kol('no wa'), iJab = kol('jabatan'), iNiy = h.findIndex(function (x) { return /^(niy|nip|niy\/nip|nuptk)$/.test(x); });
      v.slice(1).forEach(function (r) {
        const nama = norm(r[0]); if (!nama) return;
        const id = idGuru_(nama); if (sudah[id]) return; sudah[id] = 1;
        const e = ex.find(function (x) { return x.id === id || kunciNama_(x.nama) === kunciNama_(nama); }) || {};
        out.push({
          id: id, nama: pakai(e.nama, nama), niy: pakai(e.niy, iNiy >= 0 ? norm(r[iNiy]) : ''), jabatan: pakai(e.jabatan, iJab >= 0 ? norm(r[iJab]) : ''),
          jk: e.jk || '', hp: pakai(e.hp, iWa >= 0 ? norm(r[iWa]) : ''), alamat: e.alamat || '', status: e.status || 'Aktif',
          diperbarui: e.diperbarui || '', _row: e._row || null,
        });
      });
    }
    ex.forEach(function (e) {
      if (!e.nama) return;
      const id = idGuru_(e.nama);
      if (sudah[id] || sudah[e.id]) return;
      sudah[id] = 1;
      out.push(Object.assign({}, e, { id: e.id && e.id.indexOf('G:') === 0 ? e.id : id, status: e.status || 'Aktif' }));
    });
    return out;
  }
  function simpanTambahan_(jenis, d, exRow) {
    const sh = sheet_(PEOPLE[jenis].sheet);
    const row = personRow_(jenis, d);
    if (exRow) writeRow_(sh, exRow, row); else appendText_(sh, row);
  }
  function api_savePerson(p) {
    const jenis = p.jenis;
    if (!PEOPLE[jenis]) throw new Error('Jenis data tidak dikenal.');
    const d = p.data || {};
    d.nama = String(d.nama || '').replace(/\s+/g, ' ').trim();
    const lock = kunciSurat_(); lock.waitLock(30000);
    try {
      const all = people_(jenis);
      if (jenis === 'santri') {
        const s = all.find(function (x) { return x.id === d.id || (d.nisn && x.nisn === String(d.nisn).trim()); });
        if (!s) throw new Error('Santri baru ditambahkan lewat WASIAT (Admin → Data Santri). Di sini hanya melengkapi NIS, tempat/tanggal lahir, asrama, wali, dan alamat.');
        const simpan = Object.assign({}, d, { id: s.id, nama: s.nama, nisn: s.nisn, kelas: s.kelas, status: 'Aktif' });
        simpanTambahan_(jenis, simpan, s._row);
      } else {
        if (!d.nama) throw new Error('Nama wajib diisi.');
        const g = d.id ? all.find(function (x) { return x.id === d.id; }) : null;
        const id = g ? g.id : idGuru_(d.nama);
        if (!g && all.some(function (x) { return x.id === id; })) throw new Error('Nama ' + d.nama + ' sudah ada di data guru.');
        simpanTambahan_(jenis, Object.assign({}, d, { id: id, status: d.status || 'Aktif' }), g ? g._row : null);
      }
      _usersMemo = null;
      return { id: d.id, list: api_listPeople({ jenis: jenis })[jenis] };
    } finally { lock.releaseLock(); }
  }
  function api_deletePerson(p) {
    const r = people_(p.jenis).find(function (x) { return x.id === p.id; });
    if (!r) throw new Error('Data tidak ditemukan.');
    if (!r._row) throw new Error(p.jenis === 'santri' ? 'Data santri dikelola di WASIAT. Di sini tidak ada isian tambahan untuk dihapus.' : 'Data guru ini berasal dari WASIAT dan tidak bisa dihapus di sini.');
    sheet_(PEOPLE[p.jenis].sheet).deleteRow(r._row);
    return { list: api_listPeople({ jenis: p.jenis })[p.jenis] };
  }
  /** Impor: hanya MELENGKAPI data yang sudah ada di WASIAT (dicocokkan NISN/NIS, lalu nama) */
  function api_importPeople(p) {
    const jenis = p.jenis, cfg = PEOPLE[jenis];
    if (!cfg) throw new Error('Jenis data tidak dikenal.');
    const rows = (p.rows || []).filter(function (r) { return r && String(r.nama || '').trim(); });
    if (!rows.length) throw new Error('Tidak ada data yang bisa diimpor.');
    if (rows.length > 3000) throw new Error('Maksimal 3000 baris sekali impor.');
    const lock = kunciSurat_(); lock.waitLock(30000);
    try {
      let ubah = 0, tambah = 0, lewat = 0;
      rows.forEach(function (d) {
        const all = people_(jenis);
        d.nama = String(d.nama).replace(/\s+/g, ' ').trim();
        const kn = kunciNama_(d.nama);
        const ex = all.find(function (r) {
          if (jenis === 'santri' && ((d.nisn && r.nisn === String(d.nisn).trim()) || (d.nis && (r.nis === String(d.nis).trim() || r.nisn === String(d.nis).trim())))) return true;
          return kunciNama_(r.nama) === kn && (!d.kelas || !r.kelas || r.kelas === d.kelas);
        });
        if (jenis === 'santri' && !ex) { lewat++; return; }
        const merged = {};
        cfg.keys.forEach(function (k) { merged[k] = (d[k] != null && String(d[k]).trim() !== '') ? d[k] : (ex ? ex[k] : ''); });
        if (jenis === 'santri') { merged.id = ex.id; merged.nama = ex.nama; merged.nisn = ex.nisn; merged.kelas = ex.kelas; merged.status = 'Aktif'; }
        else { merged.id = ex ? ex.id : idGuru_(d.nama); merged.status = merged.status || 'Aktif'; }
        simpanTambahan_(jenis, merged, ex ? ex._row : null);
        if (ex) ubah++; else tambah++;
      });
      return { ditambah: tambah, diperbarui: ubah, dilewati: lewat, list: api_listPeople({ jenis: jenis })[jenis] };
    } finally { lock.releaseLock(); }
  }

  /* ---------------- WhatsApp lewat pengaturan WASIAT ---------------- */
  function waEnabled_() {
    const s = settings_();
    try { return s.waProvider !== 'none' && waTerkonfigurasi_(); } catch (e) { return false; }
  }
  function sendWa_(phone, msg) {
    try {
      if (!normPhone_(phone)) return { status: 'tanpa nomor' };
      if (!waEnabled_()) return { status: 'nonaktif' };
      const h = kirimWA_(phone, msg, 'persuratan');
      if (h && h.dilewati) return { status: 'nonaktif', info: h.error || '' };
      catatWa_(!!(h && h.ok), h && h.ok ? 'terkirim lewat ' + (h.via || 'WA') : (h && h.error) || 'gagal');
      return { status: h && h.ok ? 'terkirim' : 'gagal', info: h && h.ok ? '' : String((h && h.error) || '').slice(0, 250) };
    } catch (e) {
      catatWa_(false, String(e.message || e));
      return { status: 'gagal', info: String(e.message || e).slice(0, 250) };
    }
  }
  function waStatus_() {
    let last = null;
    try { last = JSON.parse(props_().getProperty('WA_LAST') || 'null'); } catch (e) { }
    let antri = 0;
    try { antri = rows_('Notifikasi').filter(function (n) { return n.WA === 'antri'; }).length; } catch (e) { }
    let via = '';
    try { via = penyediaWAAktif_(); } catch (e) { }
    return { aktif: waEnabled_(), tokenTersimpan: !!via, secretTersimpan: false, terakhir: last, antri: antri, via: via, dariWasiat: true };
  }
  function pastikanPemicuWa_() {
    try {
      const ada = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'suratProsesAntrianWa'; });
      if (!ada) ScriptApp.newTrigger('suratProsesAntrianWa').timeBased().everyMinutes(5).create();
    } catch (e) { Logger.log('Pemicu WA persuratan belum dibuat: ' + e.message); }
  }

  /** Ringkasan untuk WASIAT: jumlah pemberitahuan belum dibaca akun ini */
  function ringkasUntukWasiat(token) {
    const me = readToken_(token);
    if (!me) return { ok: false };
    return { ok: true, unread: unreadCount_(me.ID), menunggu: me.Peran === 'wali' ? 0 : rows_('SuratKeluar').filter(function (r) { return statusOf_(r) === ST.MENUNGGU && bolehSetujui_(me, r); }).length };
  }

  /* ---------------- Titik masuk dari doPost WASIAT ---------------- */
  function tangani(req) {
    _usersMemo = null; _userNames = null;
    const fn = HANDLERS[req.action];
    if (!fn) return { ok: false, error: 'Aksi persuratan tidak dikenal: ' + req.action };
    try {
      if (AKSI_PUBLIK[req.action]) return { ok: true, data: fn(req.payload || {}) };
      const me = readToken_(req.token);
      if (!me) return { ok: false, auth: false, error: 'Sesi berakhir. Silakan masuk kembali dengan akun WASIAT.' };
      if (!AKSI_SEMUA[req.action] && PENGELOLA.indexOf(me.Peran) < 0) {
        return { ok: false, error: 'Akun Anda tidak memiliki akses untuk tindakan ini.' };
      }
      return { ok: true, data: fn(req.payload || {}, me) };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }

  /* ---------------- ARSIP SURAT LAMA (unggah file dari komputer) ----------------
   * Surat yang dibuat sebelum memakai aplikasi (Word/PDF/scan) dicatat ke Buku Agenda
   * dan filenya disimpan di folder Drive yang sama dengan surat lain, sehingga bisa
   * dicari, dibuka, dan dikirim ke wali dari aplikasi.
   * - Tidak memakai QR (surat lama tidak memuatnya) dan tidak lewat persetujuan.
   * - Secara bawaan TIDAK memengaruhi nomor urut surat baru (No Urut dikosongkan),
   *   kecuali "lanjutkanNomor" dicentang.
   * - Nomor yang sudah ada di arsip ditolak agar unggahan ulang tidak menggandakan data. */
  function api_arsipSuratLama(p, me) {
    const jenisArsip = p.kind === 'masuk' ? 'masuk' : 'keluar';
    const f = p.file || {};
    if (!f.base64) throw new Error('File surat belum dipilih.');
    if (String(f.base64).length > 14 * 1024 * 1024) throw new Error('File terlalu besar (maks 10 MB).');
    const perihal = String(p.perihal || '').trim();
    if (!perihal) throw new Error('Perihal wajib diisi.');
    const nomor = String(p.nomor || '').trim();
    const d = parseDate_(p.tanggal);
    const tahun = d.getFullYear();
    const kunciNomor = function (s) { return String(s || '').toUpperCase().replace(/\s+/g, ''); };

    if (jenisArsip === 'masuk') {
      const pengirim = String(p.pihak || '').trim();
      if (!pengirim) throw new Error('Pengirim wajib diisi.');
      if (nomor && nomor !== '-' && rows_('SuratMasuk').some(function (r) {
        return kunciNomor(r['Nomor Surat']) === kunciNomor(nomor) && normNama(r.Pengirim) === normNama(pengirim);
      })) throw new Error('Sudah ada di arsip: surat masuk No. ' + nomor + ' dari ' + pengirim + '.');
      const r = api_saveSuratMasuk({
        jenis: p.jenis, pengirim: pengirim, nomorSurat: nomor || '-', tanggalSurat: ymd_(d), tanggalTerima: ymd_(d),
        perihal: perihal, keterangan: String(p.keterangan || 'Arsip lama').slice(0, 500), disposisiKe: '', file: f,
      }, me);
      return { kind: 'masuk', id: r.id, nomor: r.noAgenda };
    }

    const lock = kunciSurat_();
    lock.waitLock(30000);
    try {
      const all = rows_('SuratKeluar');
      if (nomor && all.some(function (r) { return kunciNomor(r['Nomor Surat']) === kunciNomor(nomor); })) {
        throw new Error('Nomor ' + nomor + ' sudah ada di arsip surat keluar.');
      }
      const jenis = String(p.jenis || '').trim() || 'Arsip Surat Lama';
      const kategori = String(p.kategori || '').trim() || jenis;
      const tujuan = String(p.pihak || '').trim();
      const base = safeName_((nomor || ymd_(d)) + ' - ' + perihal + (tujuan && perihal.indexOf(tujuan) < 0 ? ' - ' + tujuan : ''));
      const blob = Utilities.newBlob(Utilities.base64Decode(f.base64), f.mime || 'application/octet-stream', base + ext_(f.mime, f.name));
      const file = folderKeluar_(kategori, jenis, tahun).createFile(blob);
      const santri = (p.santri || []).map(String).filter(Boolean).slice(0, 50);
      let urut = '';
      if (p.lanjutkanNomor && nomor) { const m = nomor.match(/\d+/); if (m) urut = String(Number(m[0])); }
      const o = {
        ID: uid_(), 'No Urut': urut, Tahun: String(tahun), 'Nomor Surat': nomor, Tanggal: ymd_(d),
        Jenis: jenis, Kode: '', Perihal: perihal, Tujuan: tujuan, Penandatangan: String(p.penandatangan || '').trim(),
        Status: ST.TERBIT, 'File ID': file.getId(), 'Link PDF': file.getUrl(),
        'Data JSON': JSON.stringify({ arsipLama: true, namaFileAsli: String(f.name || '').slice(0, 200) }),
        Dibuat: stamp_(), Diperbarui: stamp_(), Kategori: kategori, 'Dibuat Oleh': me.ID,
        'Disetujui Oleh': '', 'Disetujui Pada': '', 'Catatan Persetujuan': 'Arsip lama (diunggah)', 'Kode Verifikasi': '',
        'Penerima JSON': JSON.stringify(santri.length ? { santri: santri } : {}), 'Status Kirim': '', 'Revisi JSON': '',
      };
      writeObj_('SuratKeluar', null, o);
      return { kind: 'keluar', id: o.ID, nomor: nomor };
    } finally {
      lock.releaseLock();
    }
  }

  /** Hapus arsip surat lama yang salah unggah (hanya berlaku untuk arsip lama, bukan surat terbitan aplikasi). */
  function api_hapusArsipLama(p) {
    const lock = kunciSurat_();
    lock.waitLock(30000);
    try {
      const r = rows_('SuratKeluar').find(function (x) { return x.ID === p.id; });
      if (!r) throw new Error('Surat tidak ditemukan.');
      if (String(r['Data JSON'] || '').indexOf('"arsipLama":true') < 0) throw new Error('Hanya arsip surat lama yang bisa dihapus. Surat terbitan aplikasi gunakan "Batalkan".');
      if (r['File ID']) { try { DriveApp.getFileById(r['File ID']).setTrashed(true); } catch (e) { } }
      sheet_('SuratKeluar').deleteRow(r._row);
      return { id: p.id };
    } finally {
      lock.releaseLock();
    }
  }

  /** Untuk modul lain di WASIAT (mis. Keuangan): identitas pemilik token sesi WASIAT.
   *  Mengembalikan null bila token tidak sah / kedaluwarsa / PIN sudah diganti. */
  function identitasToken(token) {
    _usersMemo = null;
    const u = readToken_(token);
    if (!u) return null;
    const roles = String(u._level || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    let terkait = [];
    try { terkait = JSON.parse(u.Terkait || '[]').filter(function (x) { return String(x).indexOf('G:') !== 0; }); } catch (e) { }
    return { nama: u.Nama, roles: roles, terkait: terkait, noWa: u['No WA'] || '' };
  }
  /** Pengaturan kop + logo persuratan (untuk kwitansi & laporan keuangan). */
  function kopUntukModulLain() {
    const s = settings_();
    return { kopKiri: s.kopKiri, kopKanan: s.kopKanan, kopBar: s.kopBar, warnaKop: s.warnaKop, namaResmi: s.namaResmi, kota: s.kota,
      penandatangan: (function () { try { return JSON.parse(s.penandatangan || '[]'); } catch (e) { return []; } })() };
  }

  return {
    tangani: tangani, setup: setup, prosesAntrianWa: prosesAntrianWa, rapikanArsip: rapikanArsip,
    hubungkanArsipLama: hubungkanArsipLama, tokenUntukNama: tokenUntukNama, ringkasUntukWasiat: ringkasUntukWasiat,
    identitasToken: identitasToken, kopUntukModulLain: kopUntukModulLain
  };
})();

/** Jalankan dari editor bila ingin membuat folder & Buku Agenda persuratan lebih awal (opsional). */
function suratSetup() { const h = SURAT_.setup(); Logger.log('Persuratan siap: ' + JSON.stringify(h)); return h; }
/** Pemicu otomatis (tiap 5 menit) untuk WA persuratan yang masih antri. */
function suratProsesAntrianWa() { SURAT_.prosesAntrianWa(); }
/** Opsional: rapikan susunan folder arsip surat lama. */
function suratRapikanArsip() { SURAT_.rapikanArsip(); }
