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
const STATUS_LIST = ['Hadir','Sakit','Izin','Alpa'];
const JENIS_HAFALAN_SETOR = ['Sabaq','Sabqi','Manzil','Murojaah','Tahsin'];
const JENIS_HAFALAN_NONSETOR = ['Tidak Setor','Izin','Sakit','Ghaib'];
// Untuk rekap kehadiran halaqoh: jenis-jenis ini dianggap HADIR (termasuk "Tidak Setor",
// karena santri tetap hadir di halaqoh meski hari itu tidak menyetor hafalan). Hanya
// Izin/Sakit/Ghaib yang dihitung sebagai status tersendiri (bukan Hadir).
const JENIS_HAFALAN_DIANGGAP_HADIR = ['Sabaq','Sabqi','Manzil','Murojaah','Tahsin','Tidak Setor'];

// Logo default pesantren (disematkan langsung di kode supaya selalu tampil di
// setiap laporan PDF tanpa bergantung pada link eksternal yang bisa mati/berubah).
// Bisa diganti nanti lewat menu Admin > Tampilan/Logo (LogoURL) -- kalau LogoURL
// diisi, PDF akan pakai logo dari URL itu; kalau kosong, pakai logo bawaan ini.
const LOGO_DEFAULT_BASE64 = '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';

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
    return jsonOut(safeRoute(action, e.parameter));
  } catch (err) {
    return jsonOut({ok:false, error: String(err)});
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    return jsonOut(safeRoute(body.action, body.payload || {}));
  } catch (err) {
    return jsonOut({ok:false, error: String(err)});
  }
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

    case 'getPengaturan': return {ok:true, data: getPengaturan()};
    case 'simpanPengaturan': return apiSimpanPengaturan(p);
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
    case 'setLimitHarianAdmin': return apiSetLimitHarianSantri(p);
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
    case 'setLimitHarianSantri': return apiSetLimitHarianSantri(p);
    case 'getSppSaya': return {ok:true, data: getSppSaya(p.nisn)};
    case 'validasiPinTransaksiSantri': return apiValidasiPinTransaksiSantri(p);
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
    case 'updateHafalan': return apiUpdateHafalan(p);
    case 'deleteHafalan': return apiDeleteHafalan(p);
    case 'getRekapHafalanSantri': return {ok:true, data: getRekapHafalanSantri(p.nisn, p.tahunAjaranId)};
    case 'getRekapKehadiranHalaqoh': return {ok:true, data: getRekapKehadiranHalaqoh(p.nisn, p.tahunAjaranId)};
    case 'getGrafikHafalanSantri': return {ok:true, data: getGrafikHafalanSantri(p.nisn, p.tanggalMulai, p.tanggalAkhir, p.tahunAjaranId)};

    // ---- NILAI (UTS/UAS/Tugas/Keterampilan) & RAPOR ----
    case 'getMapelGuru': return {ok:true, data: getMapelGuru(p.pengampu)};
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
  // Buat nomor referensi otomatis: REF-YYYYMM-XXXX
  const lastRow = sh.getLastRow();
  const urut = String(lastRow).padStart(4,'0');
  const noRef = norm(p.noRef) || ('REF-'+tanggal.substring(0,7).replace('-','')+'-'+urut);
  const noKwitansi = norm(p.noKwitansi) || ('KWT-'+noRef.replace('REF-',''));

  sh.appendRow([noRef, new Date(tanggal), norm(p.jenis)||'Pemasukan', norm(p.kategori),
    norm(p.uraian), Number(p.nominal)||0, norm(p.dicatatOleh), noKwitansi, norm(p.kelas)]);
  return {ok:true, noRef:noRef, noKwitansi:noKwitansi};
}

function apiHapusTransaksiKas(p) {
  if (!p.rowIndex) return {ok:false, error:'rowIndex wajib'};
  getMasterSS().getSheetByName(SHEET_KAS_UMUM).deleteRow(Number(p.rowIndex));
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
    const due = bulanJatuhTempoSPP(s.tahunMasuk);
    let tunggakanSPP = 0;
    const bulanTunggak = [];
    for (let m=1;m<=due;m++) {
      if (!s.months[m-1]) { tunggakanSPP += s.biaya; bulanTunggak.push(labelBulanSPP(m,s.tahunMasuk)); }
    }
    if (tunggakanSPP > 0) result.push({
      nisn:s.nisn, nama:s.nama, noWa:s.noWa,
      tunggakanSPP, bulanTunggak, jumlahBulan:bulanTunggak.length
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
  const nisn = norm(p.nisn);
  if (!nisn) return {ok:false, error:'NISN wajib diisi'};
  const tunggakan = getTunggakanSantri();
  const santri = tunggakan.find(t => t.nisn === nisn);
  if (!santri) return {ok:false, error:'Santri ini tidak memiliki tunggakan'};
  if (!santri.noWa) return {ok:false, error:'No WA wali santri ini tidak terdaftar'};
  const pesan = buildPesanTagihanSPP(santri.nama, santri.bulanTunggak, santri.tunggakanSPP);
  kirimWAFonnteUmum(santri.noWa, pesan);
  return {ok:true};
}

function apiKirimTagihanSppMassal() {
  const tunggakan = getTunggakanSantri();
  let terkirim = 0;
  tunggakan.forEach(function(t){
    if (!t.noWa) return;
    const pesan = buildPesanTagihanSPP(t.nama, t.bulanTunggak, t.tunggakanSPP);
    kirimWAFonnteUmum(t.noWa, pesan);
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

  // 0b) Sheet PelanggaranSpreadsheet + pengaturan Fonnte di MASTER (fitur Catat
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
    sh.getRange(2,1,3,3).setValues([['Halaqoh','Subuh',3],['Halaqoh','Duha',4],['Halaqoh','Maghrib',2]]);
    log.push('JamPelajaran: dibuat dengan contoh isian (Subuh=3, Duha=4, Maghrib=2 jam). Silakan sesuaikan dan lengkapi jam per mata pelajaran di menu Kelola Jam Pelajaran.');
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
  return SpreadsheetApp.openById(id);
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

function getAktifSS() {
  let id = PROP.getProperty(AKTIF_KEY);
  if (!id) {
    const list = getTahunAjaranList();
    const a = list.find(x => x.aktif === true);
    if (!a) throw new Error('Belum ada tahun ajaran aktif. Buka menu Setting Tahun Ajaran.');
    id = a.id;
    PROP.setProperty(AKTIF_KEY, id);
  }
  return SpreadsheetApp.openById(id);
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
  try { return SpreadsheetApp.openById(id); }
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
  try { return SpreadsheetApp.openById(id); }
  catch(e) { return getAktifSS(); }
}

// ============ PENGATURAN ============
function getPengaturan() {
  const sh = getMasterSS().getSheetByName(SHEET_PENGATURAN);
  const rows = sh.getDataRange().getValues(); rows.shift();
  const obj = {}; rows.forEach(r => obj[r[0]] = r[1]);
  // Logo bawaan (disematkan di kode) dipakai otomatis di layar (login/sidebar) selama
  // Admin belum mengisi LogoURL sendiri lewat menu Tampilan/Logo -- sama seperti yang
  // dipakai default di setiap PDF, supaya identitas visual konsisten di mana-mana.
  obj.LogoDataUriDefault = 'data:image/jpeg;base64,' + LOGO_DEFAULT_BASE64;
  return obj;
}
function apiSimpanPengaturan(p) {
  const sh = getMasterSS().getSheetByName(SHEET_PENGATURAN);
  const rows = sh.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) { if (rows[i][0] === p.key) { sh.getRange(i+1,2).setValue(p.value); return {ok:true}; } }
  sh.appendRow([p.key, p.value]);
  return {ok:true};
}

// ============ SLIDE PENGUMUMAN (tampil di bagian atas aplikasi, disimpan di Master) ============
// Disimpan di Master (bukan per tahun ajaran) karena pengumuman sifatnya berlaku umum
// saat ini, bukan riwayat historis per tahun ajaran.
function getSlideList() {
  const sh = getMasterSS().getSheetByName(SHEET_SLIDE);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.map((r,i) => ({
    rowIndex: i+2, judul: norm(r[0]), gambar: norm(r[1]), tautan: norm(r[2]),
    tampilUntuk: norm(r[3]) || 'Semua', urutan: Number(r[4])||0,
    aktif: r[5] === true || norm(r[5]).toLowerCase() === 'true'
  })).sort((a,b) => a.urutan - b.urutan);
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
  return {ok:true};
}

function apiDeleteSlide(p) {
  getMasterSS().getSheetByName(SHEET_SLIDE).deleteRow(Number(p.rowIndex));
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

  const absenRows = ss.getSheetByName(SHEET_ABSENSI).getDataRange().getValues(); absenRows.shift();
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
    const jRows = shJ.getDataRange().getValues(); jRows.shift();
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

  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(e) { return {ok:false, error:'Sistem sibuk, coba lagi'}; }
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
      // Kirim WA ke ortu kalau Fonnte aktif
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
        kirimWAFonnteUmum(noWa, pesan);
      }
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
    waktu:norm(r[1]), jenis:norm(r[2]), keterangan:norm(r[3]),
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
      waktu:norm(r[1]), nominal:Number(r[4])||0,
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
    waktu:norm(r[1]), nominal:Number(r[4])||0,
    kategori:norm(r[5]), keterangan:norm(r[6]),
    saldoSebelum:Number(r[11])||0, saldoSekarang:Number(r[12])||0
  })).sort((a,b) => (b.tanggal+b.waktu).localeCompare(a.tanggal+a.waktu));
}

function apiTambahSaldoSantriManual(p) {
  const nisn = norm(p.nisn), nominal = Number(p.nominal)||0, oleh = norm(p.oleh);
  if (!nisn || nominal <= 0) return {ok:false, error:'NISN dan nominal wajib diisi'};
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(e) { return {ok:false, error:'Sistem sibuk, coba lagi'}; }
  try {
    const ss = getAktifSS();
    const shSantri = ss.getSheetByName(SHEET_SANTRI);
    const rows = shSantri.getDataRange().getValues();
    const header = rows[0];
    const iSaldo = header.indexOf('Saldo Kantin');
    for (let i=1;i<rows.length;i++) {
      if (norm(rows[i][0]) === nisn) {
        const saldoSebelum = Number(rows[i][iSaldo])||0;
        const saldoBaru = saldoSebelum + nominal;
        shSantri.getRange(i+1, iSaldo+1).setValue(saldoBaru);
        // Catat ke TransaksiKantin
        const tz = Session.getScriptTimeZone();
        const shTK = getAktifKantinSS().getSheetByName(SHEET_TRANSAKSI_KANTIN);
        shTK.appendRow([
          Utilities.formatDate(new Date(),tz,'yyyy-MM-dd'),
          Utilities.formatDate(new Date(),tz,'HH:mm:ss'),
          nisn, norm(rows[i][1]), nominal, 'Top Up Saldo',
          'Top Up Manual oleh '+oleh, 1, 0, '', 0, saldoSebelum, saldoBaru
        ]);
        return {ok:true, saldoBaru:saldoBaru, nama:norm(rows[i][1])};
      }
    }
    return {ok:false, error:'Santri tidak ditemukan'};
  } finally { lock.releaseLock(); }
}

function apiSimpanJurnal(p) {
  const sh = getAktifSS().getSheetByName(SHEET_JURNAL_MENGAJAR);
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
  const absenRows = shAbsen.getDataRange().getValues(); absenRows.shift();
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
function getBarangList() {
  const sh = getAktifKantinSS().getSheetByName(SHEET_BARANG);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues(); rows.shift();
  return rows.map((r,i) => ({
    rowIndex: i+2, nama: norm(r[0]), harga: Number(r[1])||0, potongan: Number(r[2])||0, pemilik: norm(r[3]), noWaPemilik: norm(r[4])
  })).filter(x => x.nama);
}

function apiSaveBarang(p) {
  const nama = norm(p.nama);
  if (!nama) return {ok:false, error:'Nama barang wajib diisi'};
  const harga = Number(p.harga) || 0;
  if (harga <= 0) return {ok:false, error:'Harga wajib diisi dan lebih dari 0'};
  const sh = getAktifKantinSS().getSheetByName(SHEET_BARANG);
  const baris = [nama, harga, Number(p.potongan)||0, norm(p.pemilik), norm(p.noWaPemilik)];
  if (p.rowIndex && Number(p.rowIndex) > 1) {
    sh.getRange(Number(p.rowIndex), 1, 1, 5).setValues([baris]);
  } else {
    sh.appendRow(baris);
  }
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
  const rows = getAktifSS().getSheetByName(SHEET_SANTRI).getDataRange().getValues(); rows.shift();
  return rows.filter(r => r[0]).map(r => ({nisn:norm(r[0]), nama:norm(r[1])}));
}

function hitungTotalBelanjaHariIniSantri(nisn, tanggalStr) {
  const sh = getAktifKantinSS().getSheetByName(SHEET_TRANSAKSI_KANTIN);
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  let total = 0;
  rows.forEach(function(r){
    if (norm(r[2]) !== nisn || norm(r[5]) !== 'Kantin') return;
    const d = (r[0] instanceof Date) ? r[0] : new Date(r[0]);
    if (Utilities.formatDate(d, tz, 'yyyy-MM-dd') === tanggalStr) total += Number(r[4]) || 0;
  });
  return total;
}

// Proses satu transaksi belanja: validasi PIN Transaksi santri, cek limit harian & saldo,
// potong saldo santri, catat ke TransaksiKantin, tambahkan ke SaldoPemilik. Dibungkus
// LockService supaya aman dari race-condition kalau ada 2 kasir memproses bersamaan.
function apiProsesTransaksiKantin(p) {
  const nisn = norm(p.nisn), pinInput = norm(p.pinTransaksi), pemilik = norm(p.pemilik);
  const items = p.items || [];
  if (!nisn || !pinInput) return {ok:false, error:'Santri dan PIN Transaksi wajib diisi'};
  if (!items.length) return {ok:false, error:'Keranjang kosong'};

  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) { return {ok:false, error:'Sistem sedang sibuk, coba lagi.'}; }
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
    const pinTersimpan = norm(row[iPin]);
    if (!pinTersimpan) return {ok:false, error:'Santri ini belum punya PIN Transaksi. Minta Admin mengaturnya dulu di menu Data Santri.'};
    if (pinTersimpan !== pinInput) return {ok:false, error:'PIN Transaksi salah'};

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
      return [todayStr, waktu, nisn, namaSantri, nominal, 'Kantin', it.nama, it.jumlah, potongan, pemilik, masuk, saldo, saldoSekarang];
    });
    shTK.getRange(shTK.getLastRow()+1, 1, rowsTK.length, 13).setValues(rowsTK);

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

    return {ok:true, saldoSekarang: saldoSekarang, namaSantri: namaSantri, total: total};
  } finally {
    lock.releaseLock();
  }
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
// tandai baris pengajuan jadi "Disetujui", kirim WA (kalau Fonnte diatur).
function apiSetujuiPenarikan(p) {
  const rowIndex = Number(p.rowIndex);
  const disetujuiOleh = norm(p.disetujuiOleh);
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return {ok:false, error:'Sistem sedang sibuk, coba lagi.'}; }
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
      kirimWAFonnteUmum(noWa, 'Assalamualaikum Wr. Wb.\n\n*PENARIKAN SALDO DISETUJUI*\n\nHalo *'+pemilik+'*,\nPengajuan tarik saldo Anda sebesar Rp'+nominal.toLocaleString('id-ID')+' telah disetujui.\n\nSisa saldo: Rp'+saldoSekarang.toLocaleString('id-ID')+'\n\nWassalamualaikum Wr. Wb.');
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
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return {ok:false, error:'Sistem sedang sibuk, coba lagi.'}; }
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
      kirimWAFonnteUmum(noWaWali, pesan);
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

// Kirim WA umum (dipakai modul Kantin) -- terpisah dari kirimWAFonnte milik modul
// Pelanggaran karena target spreadsheetnya beda (Kantin: aktif tahun ajaran, bukan
// spreadsheet Pelanggaran terpisah), tapi caranya sama: lewat Fonnte kalau token diatur.
function kirimWAFonnteUmum(target, pesan) {
  const token = getPengaturan().FonnteToken;
  if (!target || !token) return;
  try {
    UrlFetchApp.fetch('https://api.fonnte.com/send', {
      method:'post', contentType:'application/json',
      headers: {'Authorization': token},
      payload: JSON.stringify({target: target, message: pesan}),
      muteHttpExceptions: true
    });
  } catch (err) { /* diamkan -- notifikasi WA tidak boleh menggagalkan proses utama */ }
}

// ============ SPP: BIAYA BULANAN & STATUS PEMBAYARAN (36 bulan / 3 tahun dari TahunMasuk) ============
const BULAN_INDO_SPP = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

function headerSPP(){
  var h = ['NISN','Biaya SPP'];
  for (var i=1;i<=36;i++) h.push('Bulan'+i);
  return h;
}

/** Label "Agustus 2026" dari nomor bulan (1-36) relatif ke TahunMasuk santri */
function labelBulanSPP(idx, tahunMasuk){
  var yearOffset = Math.floor((idx-1)/12);
  var monthIdx = (idx-1)%12;
  var year = parseInt(tahunMasuk) + yearOffset;
  return BULAN_INDO_SPP[monthIdx] + ' ' + year;
}

/** Berapa bulan (relatif hari ini) yang sudah jatuh tempo untuk satu santri */
function bulanJatuhTempoSPP(tahunMasuk){
  var today = new Date();
  var maxIdx = 0;
  for (var m=1; m<=36; m++){
    var d = new Date(parseInt(tahunMasuk), m-1, 1);
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
  const rows = shSpp.getDataRange().getValues(); rows.shift();
  return rows.filter(function(r){ return r[0]; }).map(function(r){
    const nisn = norm(r[0]);
    const info = santriMap[nisn] || { nama:'(NISN tidak ditemukan di data Santri)', tahunMasuk: new Date().getFullYear(), noWa:'' };
    return { nisn: nisn, nama: info.nama, noWa: info.noWa, tahunMasuk: info.tahunMasuk, biaya: Number(r[1])||0, months: r.slice(2, 38) };
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
  const rows = sh.getDataRange().getValues();
  for (var i=1;i<rows.length;i++){
    if (norm(rows[i][0]) === nisn) { sh.getRange(i+1,2).setValue(biaya); return {ok:true}; }
  }
  var baris = [nisn, biaya];
  for (var j=0;j<36;j++) baris.push('');
  sh.appendRow(baris);
  return {ok:true};
}

// Tandai satu bulan LUNAS / batalkan (klik lagi buat kosongkan). Begitu baru saja
// ditandai LUNAS, otomatis kirim WA konfirmasi ke wali santri (kalau Fonnte diatur
// dan No WA Ortu terisi).
function apiToggleSppBulan(p){
  const nisn = norm(p.nisn);
  const bulan = Number(p.bulan);
  if (!nisn || bulan < 1 || bulan > 36) return {ok:false, error:'Data tidak valid'};
  const ss = getAktifSS();
  const sh = getAktifSppSS().getSheetByName(SHEET_SPP);
  const rows = sh.getDataRange().getValues();
  var rowIdx = -1, biayaBaris = 0;
  for (var i=1;i<rows.length;i++){ if (norm(rows[i][0]) === nisn) { rowIdx = i+1; biayaBaris = Number(rows[i][1])||0; break; } }
  if (rowIdx === -1) return {ok:false, error:'Santri ini belum punya data SPP. Atur biaya SPP dulu di menu "Atur Biaya SPP".'};

  const col = 3 + bulan; // A=NISN, B=Biaya, C=Bulan1, ...
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
          kirimWAFonnteUmum(noWa, 'Assalamualaikum Wr. Wb.\n\nYth. Orang Tua/Wali Santri *'+nama+'*\n\nAlhamdulillah, pembayaran SPP bulan *'+labelBulanSPP(bulan, tahunMasuk)+'* telah berhasil diproses.\n\nJumlah: Rp'+biayaBaris.toLocaleString('id-ID')+'\nStatus: LUNAS \u2713\n\nJazakumullah khairan atas kerjasamanya.');
        }
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
  const raw = String(p.tsv || '');
  if (!raw.trim()) return {ok:false, error:'Data yang ditempel masih kosong'};
  const lines = raw.split(/\r?\n/).filter(function(l){ return l.trim() !== ''; });
  if (!lines.length) return {ok:false, error:'Data yang ditempel masih kosong'};

  const firstCells = lines[0].split('\t');
  const firstCellLower = (firstCells[0]||'').toString().trim().toLowerCase();
  if (firstCellLower === 'id' || firstCellLower === 'nama') lines.shift();
  if (!lines.length) return {ok:false, error:'Tidak ada data setelah baris header dilewati'};

  const ss = getAktifSS();
  const santriRows = ss.getSheetByName(SHEET_SANTRI).getDataRange().getValues();
  const namaIndex = {}; // nama (lowercase) -> daftar NISN yang punya nama itu
  for (var i=1;i<santriRows.length;i++) {
    var nm = norm(santriRows[i][1]).toLowerCase();
    if (!nm) continue;
    if (!namaIndex[nm]) namaIndex[nm] = [];
    namaIndex[nm].push(norm(santriRows[i][0]));
  }

  const shSpp = getAktifSppSS().getSheetByName(SHEET_SPP);
  const sppRows = shSpp.getDataRange().getValues();
  const nisnToRow = {};
  for (var j=1;j<sppRows.length;j++) { if (sppRows[j][0]) nisnToRow[norm(sppRows[j][0])] = j+1; }

  var ditambah = 0, diperbarui = 0, dilewati = 0;
  var alasanDilewati = [];

  lines.forEach(function(line, idx){
    var cells = line.split('\t');
    var nama, biaya, months;
    if (cells.length >= 40) {
      // format lama: ID, NAMA, NoHP, BiayaSPP, TahunMasuk, Bulan1..36
      nama = (cells[1]||'').toString().trim();
      biaya = Number(cells[3]) || 0;
      months = cells.slice(5, 41);
    } else {
      // format ringkas: NAMA, BiayaSPP, Bulan1..36
      nama = (cells[0]||'').toString().trim();
      biaya = Number(cells[1]) || 0;
      months = cells.slice(2, 38);
    }

    if (!nama) { dilewati++; alasanDilewati.push('Baris '+(idx+1)+': nama kosong, dilewati'); return; }
    const kandidat = namaIndex[nama.toLowerCase()];
    if (!kandidat || kandidat.length === 0) { dilewati++; alasanDilewati.push('"'+nama+'": tidak ditemukan di data Santri'); return; }
    if (kandidat.length > 1) { dilewati++; alasanDilewati.push('"'+nama+'": ada lebih dari 1 santri nama sama persis, lewati (atur manual)'); return; }
    const nisn = kandidat[0];

    while (months.length < 36) months.push('');
    const bulanBersih = months.map(function(m){ return String(m||'').trim().toLowerCase().indexOf('lunas') === 0 ? 'Lunas' : ''; });

    const baris = [nisn, biaya].concat(bulanBersih);
    if (nisnToRow[nisn]) {
      shSpp.getRange(nisnToRow[nisn], 1, 1, baris.length).setValues([baris]);
      diperbarui++;
    } else {
      shSpp.appendRow(baris);
      nisnToRow[nisn] = shSpp.getLastRow();
      ditambah++;
    }
  });

  return {ok:true, ditambah:ditambah, diperbarui:diperbarui, dilewati:dilewati, alasanDilewati:alasanDilewati};
}

// ============ KANTIN: SISI WALI SANTRI (lihat saldo, riwayat, ajukan tambah saldo) ============
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

function getRiwayatTransaksiSantriKantin(nisn, tglMulai, tglAkhir) {
  nisn = norm(nisn);
  const sh = getAktifKantinSS().getSheetByName(SHEET_TRANSAKSI_KANTIN);
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  return rows.map(function(r){
    const d = (r[0] instanceof Date) ? r[0] : new Date(r[0]);
    return { tanggal: Utilities.formatDate(d,tz,'yyyy-MM-dd'), waktu: norm(r[1]), nisn: norm(r[2]), kategori: norm(r[5]),
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
// Fonnte diatur DAN ada akun ber-role Bendahara dengan No WA terisi).
function apiAjukanTopUpSaldo(p) {
  const nisn = norm(p.nisn), namaSantri = norm(p.namaSantri), nominal = Number(p.nominal) || 0, noWaWali = norm(p.noWaWali);
  if (!nisn || nominal <= 0) return {ok:false, error:'Nominal wajib diisi dan lebih dari 0'};
  const sh = getAktifKantinSS().getSheetByName(SHEET_PENGAJUAN_TOPUP);
  const tz = Session.getScriptTimeZone();
  sh.appendRow([Utilities.formatDate(new Date(),tz,'yyyy-MM-dd'), Utilities.formatDate(new Date(),tz,'HH:mm:ss'), nisn, namaSantri, nominal, noWaWali, 'Pending', '', '']);

  const noWaBendahara = getNoWABendahara();
  if (noWaBendahara) {
    kirimWAFonnteUmum(noWaBendahara, 'Assalamualaikum Wr. Wb.\n\n*PENGAJUAN TAMBAH SALDO*\n\nSantri: *'+namaSantri+'*\nNominal: Rp'+nominal.toLocaleString('id-ID')+'\n\nMohon dicek bukti transfer dari wali santri, lalu setujui lewat dashboard Bendahara.\n\nWassalamualaikum Wr. Wb.');
  }
  return {ok:true, noWaBendahara: noWaBendahara};
}

// Orang tua mengatur/mengubah limit belanja harian anaknya sendiri (0 = tanpa limit).
function apiSetLimitHarianSantri(p) {
  const nisn = norm(p.nisn);
  const limit = Number(p.limit) || 0;
  if (!nisn) return {ok:false, error:'NISN wajib diisi'};
  if (limit < 0) return {ok:false, error:'Limit tidak boleh negatif'};
  const sh = getAktifSS().getSheetByName(SHEET_SANTRI);
  const rows = sh.getDataRange().getValues();
  const header = rows[0];
  const iLimit = header.indexOf('Limit Harian Kantin');
  for (let i=1;i<rows.length;i++) {
    if (norm(rows[i][0]) === nisn) { sh.getRange(i+1, iLimit+1).setValue(limit); return {ok:true}; }
  }
  return {ok:false, error:'Data santri tidak ditemukan'};
}

// Status SPP SATU santri saja -- dipakai dashboard Wali Santri, tidak pernah
// mengekspos data SPP santri lain lewat aksi ini.
function getSppSaya(nisn) {
  nisn = norm(nisn);
  const santriRows = getAktifSS().getSheetByName(SHEET_SANTRI).getDataRange().getValues();
  let tahunMasuk = new Date().getFullYear();
  for (let i=1;i<santriRows.length;i++) { if (norm(santriRows[i][0]) === nisn) { tahunMasuk = santriRows[i][2]; break; } }

  const shSpp = getAktifSppSS().getSheetByName(SHEET_SPP);
  const rows = shSpp.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) {
    if (norm(rows[i][0]) === nisn) {
      const biaya = Number(rows[i][1]) || 0;
      const months = rows[i].slice(2, 38);
      const due = bulanJatuhTempoSPP(tahunMasuk);
      const bulanTunggakan = [];
      for (let m=1;m<=due;m++) { if (!months[m-1]) bulanTunggakan.push(labelBulanSPP(m, tahunMasuk)); }
      return { adaSpp:true, biaya:biaya, bulanTunggakan:bulanTunggakan, totalTunggakan: bulanTunggakan.length*biaya };
    }
  }
  return { adaSpp:false, biaya:0, bulanTunggakan:[], totalTunggakan:0 };
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
function kirimWAFonnte(target, pesan) {
  const token = getPengaturan().FonnteToken;
  const ss = getPelanggaranAktifSS();
  const shLog = ss.getSheetByName(SHEET_LOG_NOTIF);
  if (!target || !token) {
    if (shLog) shLog.appendRow([new Date(), target||'-', pesan.substring(0,200), token ? 'Gagal: nomor tujuan kosong' : 'Gagal: Token Fonnte belum diatur Admin']);
    return;
  }
  try {
    const resp = UrlFetchApp.fetch('https://api.fonnte.com/send', {
      method:'post', contentType:'application/json',
      headers: {'Authorization': token},
      payload: JSON.stringify({target: target, message: pesan}),
      muteHttpExceptions: true
    });
    const kode = resp.getResponseCode();
    if (shLog) shLog.appendRow([new Date(), target, pesan.substring(0,200), kode===200 ? 'Berhasil' : ('Gagal HTTP '+kode)]);
  } catch (err) {
    if (shLog) shLog.appendRow([new Date(), target, pesan.substring(0,200), 'Error: '+err]);
  }
}

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
    kirimWAFonnte(noWaOrtu, pesan);
  }
  if (statusBaru === 'Habis' && statusLama !== 'Habis') {
    if (noWaOrtu) {
      kirimWAFonnte(noWaOrtu, 'Assalamualaikum Wr. Wb.\n\n*NOTIFIKASI POIN HABIS*\n\nPoin santri *'+namaSantri+'* telah *HABIS* (0 poin) pada bulan ini.\n\nDengan demikian ananda akan mendapat pembinaan sesuai aturan pondok. Untuk koordinasi bisa menghubungi pengurus.\n\nWassalamualaikum Wr. Wb.');
    }
    const grup = getPengaturan().GrupPengajarWA;
    if (grup) kirimWAFonnte(grup, '*PERHATIAN - POIN HABIS*\n\nSantri: *'+namaSantri+'*\nKelas: '+kelasSantri+'\nSisa Poin: 0 / '+modal);
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
  return SpreadsheetApp.openById(id);
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
function apiLogin(loginId, pin) {
  loginId = norm(loginId); pin = norm(pin);
  if (!loginId || !pin) return {ok:false, error:'Nama/No WA dan PIN wajib diisi'};
  const sh = getAktifSS().getSheetByName(SHEET_ROLE);
  const rows = sh.getDataRange().getValues(); rows.shift();
  const found = rows.find(r => (norm(r[0]) === loginId || norm(r[1]) === loginId) && norm(r[2]) === pin);
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

  return {ok:true, user: {
    nama: norm(found[0]), noWa: norm(found[1]),
    roles: roles, level: roles[0],
    nisnAnak: norm(found[4]),
    waliKelas: waliKelas  // kelas yang ditangani sebagai Wali Kelas
  }};
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
  const sudahDigantikan = {};
  penggantianHariIni.forEach(function(x){
    sudahDigantikan[x.mapel+'|'+x.kelas+'|'+x.jamKe+'|'+x.guruAsli] = true;
  });

  // Ambil SEMUA jadwal guru ini (semua hari, termasuk yang tidak ada harinya)
  const semuaJadwal = rows
    .filter(r => normNama(norm(r[2])) === normNama(pengampu))
    .filter(function(r){
      // Khusus hari ini: filter yang sudah digantikan
      if (norm(r[3]) === namaHariIni) {
        return !sudahDigantikan[norm(r[0])+'|'+norm(r[1])+'|'+r[4]+'|'+pengampu];
      }
      return true;
    })
    .map(r => ({
      mapel:norm(r[0]), kelas:norm(r[1]), pengampu:norm(r[2]),
      hari:norm(r[3]), jamKe:r[4], pengganti:false,
      hariIni: normNama(norm(r[3])) === normNama(namaHariIni),
      tanpaHari: !norm(r[3]) // jadwal yang belum diisi harinya
    }));

  // Jadwal penggantian hari ini (guru ini menggantikan guru lain)
  const jadwalPengganti = penggantianHariIni
    .filter(function(x){ return normNama(x.guruPengganti) === normNama(pengampu); })
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
    const key = item.mapel + '|' + item.kelas + '|' + item.hari + '|' + (item.pengganti ? ('P|'+(item.guruAsli||'')) : 'A');
    if (!kelompok[key]) {
      kelompok[key] = {
        mapel: item.mapel, kelas: item.kelas, pengampu: item.pengampu,
        hari: item.hari, pengganti: item.pengganti, guruAsli: item.guruAsli||'',
        jamKeList: [], hariIni: item.hariIni, tanpaHari: item.tanpaHari
      };
      urutanKey.push(key);
    }
    kelompok[key].jamKeList.push(item.jamKe);
    // Kalau salah satu jamKe-nya hari ini, tandai sebagai hari ini
    if (item.hariIni) kelompok[key].hariIni = true;
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
  const rombelRows = ss.getSheetByName(SHEET_ROMBEL).getDataRange().getValues(); rombelRows.shift();
  const santriRows = ss.getSheetByName(SHEET_SANTRI).getDataRange().getValues(); santriRows.shift();
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

function apiSubmitAbsensi(p) {
  if (!p || !p.items || !p.items.length) return {ok:false, error:'Tidak ada data santri untuk disimpan'};
  const sh = getAktifSS().getSheetByName(SHEET_ABSENSI);
  const tanggal = p.tanggal || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const daftarJamKe = (p.jamKeList && p.jamKeList.length) ? p.jamKeList : [p.jamKe];
  const existing = sh.getDataRange().getValues();

  const [ty, tm, td] = tanggal.split('-').map(Number);
  const indexBaris = {};
  for (let i=1;i<existing.length;i++) {
    const r = existing[i];
    const d = (r[0] instanceof Date) ? r[0] : new Date(r[0]);
    if (d.getFullYear()===ty && (d.getMonth()+1)===tm && d.getDate()===td && r[3]===p.mapel && daftarJamKe.indexOf(Number(r[2])) !== -1) {
      indexBaris[String(r[2])+'|'+norm(r[6])] = i+1;
    }
  }

  const rowsToAdd = [];
  let diupdate = 0;
  daftarJamKe.forEach(function(jamKe){
    (p.items || []).forEach(it => {
      const s1 = it.sikap1!=null? it.sikap1:4, s2 = it.sikap2!=null? it.sikap2:4, s3 = it.sikap3!=null? it.sikap3:4, s4 = it.sikap4!=null? it.sikap4:4;
      const nilaiSikap = hitungNilaiSikap(s1,s2,s3,s4);
      const rowIdx = indexBaris[String(jamKe)+'|'+norm(it.nisn)];
      if (rowIdx) {
        sh.getRange(rowIdx,9,1,8).setValues([[it.status, it.keterangan||'', s1,s2,s3,s4, nilaiSikap, new Date()]]);
        diupdate++;
      } else {
        rowsToAdd.push([tanggal, p.hari, jamKe, p.mapel, p.kelas, p.pengampu, it.nisn, it.nama, it.status, it.keterangan||'', s1,s2,s3,s4, nilaiSikap, new Date(), p.tipeAbsen||'Akademik', p.waktuHalaqoh||'']);
      }
    });
  });
  if (rowsToAdd.length) sh.getRange(sh.getLastRow()+1,1,rowsToAdd.length,18).setValues(rowsToAdd);
  refreshRekapNilaiAman();

  // Kirim WA otomatis ke ortu untuk santri yang Alpa/Sakit/Izin
  try {
    kirimNotifAbsensiKeOrtu(p.items, tanggal, p.mapel, p.kelas, p.pengampu);
  } catch(e) { Logger.log('Notif WA absensi gagal: ' + e.message); }

  return {ok:true, ditambah: rowsToAdd.length, diupdate: diupdate};
}

// Kirim WA ke ortu santri yang tidak hadir (Alpa, Sakit, Izin)
// ============ ABSENSI HALAQOH (Role Pembina) ============

// Submit absensi halaqoh Maghrib -- disimpan di sheet Absensi dengan TipeAbsen='Halaqoh'
function apiSubmitAbsensiHalaqoh(p) {
  if (!p.items || !p.items.length) return {ok:false, error:'Tidak ada data santri'};
  const sh = getAktifSS().getSheetByName(SHEET_ABSENSI);
  const tz = Session.getScriptTimeZone();
  const tanggal = p.tanggal || Utilities.formatDate(new Date(),tz,'yyyy-MM-dd');
  const waktuHalaqoh = norm(p.waktuHalaqoh)||'Maghrib';
  const namaHalaqoh = norm(p.namaHalaqoh);
  const pengampu = norm(p.pengampu);

  // Cek sudah ada data hari ini untuk halaqoh ini
  const existing = sh.getDataRange().getValues();
  const [ty,tm,td] = tanggal.split('-').map(Number);
  const indexBaris = {};
  for (let i=1;i<existing.length;i++) {
    const r = existing[i];
    const d = r[0] instanceof Date ? r[0] : new Date(r[0]);
    if (d.getFullYear()===ty && (d.getMonth()+1)===tm && d.getDate()===td &&
        norm(r[3])===namaHalaqoh && norm(r[16])==='Halaqoh' && norm(r[17])===waktuHalaqoh) {
      indexBaris[norm(r[6])] = i+1;
    }
  }

  const rowsToAdd = [];
  let diupdate = 0;
  p.items.forEach(function(it) {
    const rowIdx = indexBaris[norm(it.nisn)];
    if (rowIdx) {
      sh.getRange(rowIdx,9,1,2).setValues([[it.status, it.keterangan||'']]);
      diupdate++;
    } else {
      // TipeAbsen=Halaqoh, WaktuHalaqoh=Maghrib, JamKe=0 (bukan jam pelajaran reguler)
      rowsToAdd.push([tanggal, p.hari||'', 0, namaHalaqoh, p.gender||'',
        pengampu, it.nisn, it.nama, it.status, it.keterangan||'',
        4,4,4,4, 100, new Date(), 'Halaqoh', waktuHalaqoh]);
    }
  });
  if (rowsToAdd.length) sh.getRange(sh.getLastRow()+1,1,rowsToAdd.length,18).setValues(rowsToAdd);

  // Kirim WA notif ke ortu santri yang tidak hadir
  try { kirimNotifAbsensiKeOrtu(p.items, tanggal, namaHalaqoh+' ('+waktuHalaqoh+')', p.gender, pengampu); } catch(e){}

  return {ok:true, ditambah:rowsToAdd.length, diupdate:diupdate};
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
  const rows = sh.getDataRange().getValues(); rows.shift();
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
    else if (status==='Izin') perSantri[nisn].izin++;
    else perSantri[nisn].alpa++;
  });

  // Filter gender kalau diminta
  let result = Object.values(perSantri);
  if (gender) {
    const shSantri = getAktifSS().getSheetByName(SHEET_SANTRI);
    const santriRows = shSantri.getDataRange().getValues(); santriRows.shift();
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
  const rows = sh.getDataRange().getValues(); rows.shift();
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
  if (!pengaturan.FonnteToken) return; // Token belum diatur, skip
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

    kirimWAFonnteUmum(noWa, pesan);
    Utilities.sleep(200); // Jeda antar pengiriman agar tidak rate-limit
  });
}



// Dipakai fitur "lihat riwayat tahun ajaran lain" (read-only) -- TIDAK PERNAH mengubah
// tahun ajaran aktif untuk input data baru. p.tahunAjaranId opsional; kalau kosong,
// tetap pakai tahun ajaran aktif seperti biasa.
function getSSTarget(tahunAjaranId) {
  return tahunAjaranId ? SpreadsheetApp.openById(tahunAjaranId) : getAktifSS();
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
  const rows = sh.getDataRange().getValues(); rows.shift();
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
    else if (status==='Izin') perSantri[nisn].izin++;
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
  const rows = sh.getDataRange().getValues(); rows.shift();
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
  const anggota = shAnggota.getDataRange().getValues(); anggota.shift();
  const daftarAnggota = anggota.filter(r => norm(r[2])===namaHalaqoh).map(r => ({nisn:norm(r[0]),nama:norm(r[1])}));

  // Siapa yang sudah isi hari ini
  const shHafalan = getAktifSS().getSheetByName(SHEET_HAFALAN);
  const hafRows = shHafalan.getDataRange().getValues(); hafRows.shift();
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
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  return rows.map((r,idx) => ({
      rowIndex: idx+2,
      tanggal: Utilities.formatDate(new Date(r[0]), tz, 'yyyy-MM-dd'),
      hari:r[1], jamKe:r[2], mapel:r[3], kelas:r[4], pengampu:r[5],
      nisn:r[6], nama:r[7], status:r[8], keterangan:r[9],
      sikap1:r[10], sikap2:r[11], sikap3:r[12], sikap4:r[13], nilaiSikap:r[14]
    }))
    .filter(r => (!p.pengampu || r.pengampu === p.pengampu))
    .filter(r => (!p.mapel || r.mapel === p.mapel))
    .filter(r => (!p.nisn || String(r.nisn) === String(p.nisn)))
    .filter(r => (!p.tanggalMulai || r.tanggal >= p.tanggalMulai))
    .filter(r => (!p.tanggalAkhir || r.tanggal <= p.tanggalAkhir))
    .sort((a,b) => b.tanggal.localeCompare(a.tanggal) || a.jamKe-b.jamKe);
}

function apiUpdateAbsensi(p) {
  const sh = getAktifSS().getSheetByName(SHEET_ABSENSI);
  const s1 = p.sikap1!=null?p.sikap1:4, s2 = p.sikap2!=null?p.sikap2:4, s3 = p.sikap3!=null?p.sikap3:4, s4 = p.sikap4!=null?p.sikap4:4;
  const nilaiSikap = hitungNilaiSikap(s1,s2,s3,s4);
  sh.getRange(p.rowIndex,9,1,8).setValues([[p.status, p.keterangan||'', s1,s2,s3,s4, nilaiSikap, new Date()]]);
  return {ok:true};
}

function apiDeleteAbsensi(p) {
  getAktifSS().getSheetByName(SHEET_ABSENSI).deleteRow(Number(p.rowIndex));
  return {ok:true};
}

// ============ REKAP SANTRI (kehadiran + nilai sikap) ============
function getRekapSantri(nisn, tahunAjaranId) {
  const rows = getRiwayatAbsensi({nisn: nisn, tahunAjaranId: tahunAjaranId});
  const perMapel = {};
  rows.forEach(r => {
    if (!perMapel[r.mapel]) perMapel[r.mapel] = {Hadir:0,Sakit:0,Izin:0,Alpa:0,total:0,totalSikap:0,jmlSikap:0};
    perMapel[r.mapel][r.status] = (perMapel[r.mapel][r.status]||0) + 1;
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
  const rows = sh.getDataRange().getValues(); rows.shift();
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
  const mapelRows = ss.getSheetByName(SHEET_MAPEL).getDataRange().getValues(); mapelRows.shift();
  const absensiRows = ss.getSheetByName(SHEET_ABSENSI).getDataRange().getValues(); absensiRows.shift();
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
// Sabaq/Sabqi/Manzil/Murojaah/Tahsin/Tidak Setor dihitung HADIR. Izin/Sakit/Ghaib dihitung
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
  const jamList = getJamPelajaranList(tahunAjaranId);
  const jamMapel = {}, jamHalaqoh = {};
  jamList.forEach(j => { if (j.jenis === 'Halaqoh') jamHalaqoh[j.nama] = j.jumlahJam; else if (j.jenis === 'Mapel') jamMapel[j.nama] = j.jumlahJam; });

  const sesiUnik = {};
  const absensiRows = ss.getSheetByName(SHEET_ABSENSI).getDataRange().getValues(); absensiRows.shift();
  absensiRows.forEach(r => {
    const d = (r[0] instanceof Date) ? r[0] : new Date(r[0]);
    if (d.getMonth()+1 !== bulan || d.getFullYear() !== tahun) return;
    const guru = norm(r[5]);
    if (pengampu && guru !== pengampu) return;
    const tglStr = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    const mapel = norm(r[3]), kelas = norm(r[4]);
    const key = 'M|'+tglStr+'|'+r[2]+'|'+mapel+'|'+kelas+'|'+guru;
    if (!sesiUnik[key]) sesiUnik[key] = { tanggal: tglStr, jenis:'Mata Pelajaran', keterangan: mapel+' - '+kelas, pengampu: guru, jam: jamMapel[mapel] || 0 };
  });
  const hafalanRows = ss.getSheetByName(SHEET_HAFALAN).getDataRange().getValues(); hafalanRows.shift();
  hafalanRows.forEach(r => {
    const d = (r[0] instanceof Date) ? r[0] : new Date(r[0]);
    if (d.getMonth()+1 !== bulan || d.getFullYear() !== tahun) return;
    const guru = norm(r[3]);
    if (pengampu && guru !== pengampu) return;
    const tglStr = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    const waktu = norm(r[1]), halaqoh = norm(r[2]);
    const key = 'H|'+tglStr+'|'+waktu+'|'+halaqoh+'|'+guru;
    if (!sesiUnik[key]) sesiUnik[key] = { tanggal: tglStr, jenis:'Halaqoh ('+waktu+')', keterangan: halaqoh, pengampu: guru, jam: jamHalaqoh[waktu] || 0 };
  });

  const daftar = Object.keys(sesiUnik).map(k => sesiUnik[k]).sort((a,b) => a.tanggal.localeCompare(b.tanggal));
  if (pengampu) {
    const totalJam = daftar.reduce((s,x) => s + x.jam, 0);
    return { mode:'detail', pengampu: pengampu, riwayat: daftar, totalJam: totalJam };
  }
  const perGuru = {};
  daftar.forEach(x => { perGuru[x.pengampu] = (perGuru[x.pengampu]||0) + x.jam; });
  const ringkasan = Object.keys(perGuru).map(g => ({pengampu:g, totalJam: perGuru[g]})).sort((a,b) => b.totalJam - a.totalJam);
  return { mode:'ringkasan', daftar: ringkasan };
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
  // - hapus tanda hubung yang berada di antara kata (As-Shiddiq = Asshiddiq)
  // - hapus spasi ganda
  // - trim
  // - hapus karakter non-breaking space dan karakter mirip spasi lainnya
  return norm(s)
    .toLowerCase()
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ') // non-breaking spaces
    .replace(/\s*-\s*/g, '')    // tanda hubung + spasi sekitarnya → dihapus (As-Shiddiq = Asshiddiq)
    .replace(/\s+/g, ' ')       // spasi ganda → satu spasi
    .trim();
}

function daftarPengampu(pengampuStr) {
  pengampuStr = norm(pengampuStr);
  // Pisahkan beberapa pengampu dengan titik koma (;) supaya tidak bentrok dengan
  // koma dalam gelar akademik (S.Pd, S.H, S.Pd.I, dll).
  // Kalau tidak ada titik koma, perlakukan seluruh string sebagai satu pengampu
  // (backward compatible dengan data lama yang isinya satu nama + gelar).
  if (pengampuStr.indexOf(';') !== -1) {
    return pengampuStr.split(';').map(function(s){ return s.trim(); }).filter(Boolean);
  }
  // Satu pengampu saja (nama lengkap + gelar boleh mengandung koma)
  return [pengampuStr];
}

// Cek apakah nama pengampu cocok -- toleran terhadap perbedaan kapitalisasi & spasi.
// Untuk halaqoh dengan beberapa pengampu, pisahkan dengan titik koma (;) di sheet.
function pengampuCocok(listPengampu, pengampu) {
  var target = normNama(pengampu);
  return listPengampu.some(function(p){ return normNama(p) === target; });
}

function getHalaqohList() {
  const sh = getAktifSS().getSheetByName(SHEET_HALAQOH);
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

  const penggantianHariIni = getDaftarPenggantian().filter(function(x){ return x.tanggal === hariIniTanggal && x.jenisSesi === 'Halaqoh' && x.waktu === waktu; });
  const sudahDigantikan = {};
  penggantianHariIni.forEach(function(x){ sudahDigantikan[x.halaqoh+'|'+x.guruAsli] = true; });

  const daftarSendiri = getHalaqohList().filter(function(h){
    if (!pengampuCocok(h.pengampuList, pengampu) || normNama(h.waktu) !== normNama(waktu)) return false;
    return !sudahDigantikan[h.namaHalaqoh+'|'+pengampu];
  }).map(function(h){ return Object.assign({}, h, {pengganti:false}); });

  const daftarPengganti = penggantianHariIni.filter(function(x){ return normNama(x.guruPengganti) === normNama(pengampu); })
    .map(function(x){
      const asli = getHalaqohList().find(function(h){ return h.namaHalaqoh === x.halaqoh; });
      return { namaHalaqoh: x.halaqoh, pengampu: pengampu, waktu: waktu, gender: asli ? asli.gender : '', pengganti:true, guruAsli: x.guruAsli };
    });

  return daftarSendiri.concat(daftarPengganti);
}

// ============ HAFALAN ============
function apiGetSantriUntukHafalan(namaHalaqoh, waktu, tanggal, pengampuDiminta) {
  namaHalaqoh = norm(namaHalaqoh);
  if (!namaHalaqoh) return {ok:false, error:'Halaqoh tidak valid'};
  const ss = getAktifSS();
  const anggotaRows = ss.getSheetByName(SHEET_HALAQOH_ANGGOTA).getDataRange().getValues(); anggotaRows.shift();
  const anggota = anggotaRows.filter(r => r[0] && norm(r[2]) === namaHalaqoh);
  if (!anggota.length) return {ok:true, data: [], peringatan: 'Belum ada santri di halaqoh "'+namaHalaqoh+'". Minta Admin menambahkan di menu Kelola Halaqoh.'};

  const hafalanRows = ss.getSheetByName(SHEET_HAFALAN).getDataRange().getValues(); hafalanRows.shift();
  const tz = Session.getScriptTimeZone();

  // KUNCI SESI: kalau halaqoh ini punya lebih dari satu pengampu, dan sesi (tanggal+
  // waktu+halaqoh) INI SAJA sudah diisi oleh pengampu LAIN, tolak akses supaya tidak
  // ada dua pengampu mencatat data yang sama/berbeda untuk santri yang sama di sesi
  // yang sama (mencegah data ganda/bentrok).
  if (tanggal && waktu) {
    for (let i=0;i<hafalanRows.length;i++) {
      const r = hafalanRows[i];
      const d = (r[0] instanceof Date) ? r[0] : new Date(r[0]);
      const tglStr = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
      if (tglStr === tanggal && norm(r[1]) === norm(waktu) && norm(r[2]) === namaHalaqoh) {
        const pengampuSudahIsi = norm(r[3]);
        if (pengampuSudahIsi && pengampuSudahIsi !== norm(pengampuDiminta)) {
          return {ok:false, error:'Halaqoh "'+namaHalaqoh+'" untuk sesi tanggal '+tanggal+' ('+waktu+') sudah diisi oleh '+pengampuSudahIsi+'. Tidak bisa diisi ulang oleh pengampu lain (mencegah data ganda). Kalau ada kesalahan pencatatan, minta '+pengampuSudahIsi+' membetulkannya lewat menu Riwayat Hafalan > Edit.'};
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
  const sh = getAktifSS().getSheetByName(SHEET_HAFALAN);
  const tanggal = p.tanggal || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const existing = sh.getDataRange().getValues();

  const [ty, tm, td] = tanggal.split('-').map(Number);
  const indexBaris = {};
  for (let i=1;i<existing.length;i++) {
    const r = existing[i];
    const d = (r[0] instanceof Date) ? r[0] : new Date(r[0]);
    if (d.getFullYear()===ty && (d.getMonth()+1)===tm && d.getDate()===td && norm(r[1])===norm(p.waktu) && norm(r[2])===norm(p.halaqoh)) {
      indexBaris[norm(r[4])] = i+1;
    }
  }

  const rowsToAdd = [];
  let diupdate = 0;
  (p.items||[]).forEach(function(it){
    const rowIdx = indexBaris[norm(it.nisn)];
    if (rowIdx) {
      sh.getRange(rowIdx,7,1,7).setValues([[it.jenisHafalan, it.surah||'', it.ayat||'', it.juz||'', it.halamanKe||'', it.nilai||'', new Date()]]);
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
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  return rows.map((r,idx) => ({
      rowIndex: idx+2, tanggal: Utilities.formatDate(new Date(r[0]), tz, 'yyyy-MM-dd'),
      waktu:r[1], halaqoh:r[2], pengampu:r[3], nisn:r[4], nama:r[5],
      jenis:r[6], surah:r[7], ayat:r[8], juz:r[9], halamanKe:r[10], nilai:r[11]
    }))
    .filter(r => (!p.pengampu || r.pengampu === p.pengampu))
    .filter(r => (!p.halaqoh || r.halaqoh === p.halaqoh))
    .filter(r => (!p.nisn || String(r.nisn) === String(p.nisn)))
    .filter(r => (!p.tanggalMulai || r.tanggal >= p.tanggalMulai))
    .filter(r => (!p.tanggalAkhir || r.tanggal <= p.tanggalAkhir))
    .sort((a,b) => b.tanggal.localeCompare(a.tanggal));
}

function apiUpdateHafalan(p) {
  const sh = getAktifSS().getSheetByName(SHEET_HAFALAN);
  sh.getRange(p.rowIndex,7,1,7).setValues([[p.jenisHafalan, p.surah||'', p.ayat||'', p.juz||'', p.halamanKe||'', p.nilai||'', new Date()]]);
  return {ok:true};
}

function apiDeleteHafalan(p) {
  getAktifSS().getSheetByName(SHEET_HAFALAN).deleteRow(Number(p.rowIndex));
  return {ok:true};
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
  const rows = sh.getDataRange().getValues(); rows.shift();
  const tz = Session.getScriptTimeZone();
  const riwayat = rows.filter(r=>norm(r[4])===nisn).map(r=>({
      tanggal: Utilities.formatDate(new Date(r[0]),tz,'yyyy-MM-dd'), waktu:norm(r[1]), halaqoh:norm(r[2]), pengampu:norm(r[3]),
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
  for (let i=1;i<roleRows.length;i++) { if (norm(roleRows[i][0]) === namaLama && norm(roleRows[i][3]) === 'Guru') { rowIndex = i+1; break; } }
  if (rowIndex === -1) return {ok:false, error:'Akun guru tidak ditemukan'};

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
  let pesanRombel = '';
  if (p.kelas) { const hasil = apiTambahSantriKeRombel({nisn:nisn, kelas: norm(p.kelas)}); if (!hasil.ok) pesanRombel = ' (Catatan rombel: ' + hasil.error + ')'; }
  return {ok:true, pesanRombel: pesanRombel};
}

function apiImportSantriMassal(p) {
  const ss = getAktifSS();
  const shSantri = ss.getSheetByName(SHEET_SANTRI);
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

// ============ NILAI (UTS/UAS/Tugas/Keterampilan) & RAPOR - TAHAP 2 ============
const JENIS_NILAI_LIST = ['UTS','UAS','Tugas','Keterampilan'];

// Daftar mapel+kelas yang diampu guru (semua hari, bukan cuma hari ini) - dipakai utk form input nilai
function getMapelGuru(pengampu) {
  pengampu = norm(pengampu);
  const sh = getAktifSS().getSheetByName(SHEET_MAPEL);
  const rows = sh.getDataRange().getValues(); rows.shift();
  const seen = {}; const hasil = [];
  rows.filter(r => norm(r[2]) === pengampu).forEach(r => {
    const key = norm(r[0]) + '|' + norm(r[1]);
    if (!seen[key]) { seen[key] = true; hasil.push({mapel:norm(r[0]), kelas:norm(r[1])}); }
  });
  return hasil;
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
  const rows = sh.getDataRange().getValues(); rows.shift();
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
    else if (status==='Izin') perSantri[nisn].izin++;
    else perSantri[nisn].alpa++;
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
  const rombelRows = ss.getSheetByName(SHEET_ROMBEL).getDataRange().getValues(); rombelRows.shift();
  const santriDiKelas = new Set(rombelRows.filter(r=>norm(r[2])===kelas).map(r=>norm(r[0])));
  // Ambil halaqoh masing-masing santri
  const anggotaRows = ss.getSheetByName(SHEET_HALAQOH_ANGGOTA).getDataRange().getValues(); anggotaRows.shift();
  const mapHalaqoh = {};
  anggotaRows.filter(r=>santriDiKelas.has(norm(r[0]))).forEach(r=>{ mapHalaqoh[norm(r[0])]=norm(r[2]); });
  // Ambil data hafalan
  const shH = ss.getSheetByName(SHEET_HAFALAN);
  if (!shH) return [];
  const hafalanRows = shH.getDataRange().getValues(); hafalanRows.shift();
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
  const nilaiRows = shNilai ? shNilai.getDataRange().getValues() : [];
  if (nilaiRows.length) nilaiRows.shift();

  // Ambil data absensi untuk kehadiran
  const shAbsen = ss.getSheetByName(SHEET_ABSENSI);
  const absenRows = shAbsen ? shAbsen.getDataRange().getValues() : [];
  if (absenRows.length) absenRows.shift();

  // Ambil daftar santri di kelas ini
  const shSantri = ss.getSheetByName(SHEET_SANTRI);
  const santriRows = shSantri.getDataRange().getValues(); santriRows.shift();
  const shRombel = ss.getSheetByName(SHEET_ROMBEL);
  const rombelRows = shRombel.getDataRange().getValues(); rombelRows.shift();
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
    // Huruf dari Nilai Sikap Rapor: A>=90, B>=80, C>=70, D<70
    const huruf = nilaiSikapRapor>=90?'A':nilaiSikapRapor>=80?'B':nilaiSikapRapor>=70?'C':'D';

    // Nilai Sikap Rapor = (Rata-rata poin per sesi ÷ 16) × 100
    // Poin per sesi = total 4 kolom sikap (max 16 per sesi)
    const rataSikapPerSesi = d.sesiSikap > 0 ? d.totalPoinSikap / d.sesiSikap : 0;
    const nilaiSikapRapor = Math.round(rataSikapPerSesi / 16 * 100);
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
  const rombelRows = ss.getSheetByName(SHEET_ROMBEL).getDataRange().getValues(); rombelRows.shift();
  const tz = Session.getScriptTimeZone();
  const waktu = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');

  // Baca SEKALI, kelompokkan per NISN di memori.
  const absensiRows = ss.getSheetByName(SHEET_ABSENSI).getDataRange().getValues(); absensiRows.shift();
  const absensiPerNisn = {};
  absensiRows.forEach(r => {
    const nisn = norm(r[6]);
    if (!absensiPerNisn[nisn]) absensiPerNisn[nisn] = [];
    absensiPerNisn[nisn].push({ mapel: norm(r[3]), status: norm(r[8]), nilaiSikap: r[14] });
  });

  const nilaiRows = ss.getSheetByName(SHEET_NILAI).getDataRange().getValues(); nilaiRows.shift();
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
function refreshRekapNilaiAman() {
  try { refreshRekapNilaiSheet(); } catch (err) { Logger.log('Gagal refresh RekapNilai: ' + err); }
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
