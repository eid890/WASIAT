/* WASIAT - mesin cetak Rapor Kurikulum Merdeka (Kurmer)
 * Format mengikuti Laporan Hasil Belajar Kurikulum Merdeka madrasah (sampul, identitas peserta
 * didik, capaian hasil belajar, ekstrakurikuler/prestasi/ketidakhadiran/catatan), disesuaikan
 * dengan identitas Pondok Pesantren Wihdatul Ummah. Data sudah disiapkan app.js; berkas ini
 * hanya menyusun HTML halaman cetak.
 */
(function(){
'use strict';
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function br(s){ return String(s == null ? '' : s).split(/\r?\n/).map(esc).join('<br>'); }
var BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
function tglIndo(t){
  var m = String(t || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(t || '');
  return Number(m[3]) + ' ' + BULAN[Number(m[2]) - 1] + ' ' + m[1];
}
var ROMAWI = ['','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
var HURUF = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/* ---- predikat & deskripsi capaian ---- */
var AMBANG = [90, 80, 70];
function predikat(n, ambang){
  var a = ambang || AMBANG;
  if (n === '' || n == null || isNaN(Number(n))) return '';
  n = Number(n);
  return n >= a[0] ? 'sangat baik' : n >= a[1] ? 'baik' : n >= a[2] ? 'cukup baik' : 'perlu bimbingan';
}
function kapital(s){ s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function rapikanMateri(m){ return String(m || '').trim().replace(/[.\s]+$/, ''); }
function deskripsi(n, materi, ambang){
  var p = predikat(n, ambang), m = rapikanMateri(materi);
  if (!p) return '';
  if (p === 'perlu bimbingan') return m ? 'Perlu bimbingan dalam ' + m + '.' : 'Perlu bimbingan untuk mencapai capaian pembelajaran semester ini.';
  return 'Menunjukkan penguasaan yang ' + p + (m ? ' dalam ' + m : '') + '.';
}
function nilaiEkskul(n){
  if (n === '' || n == null || isNaN(Number(n))) return String(n == null ? '' : n);
  n = Number(n); return n >= 90 ? 'Sangat Baik' : n >= 80 ? 'Baik' : n >= 70 ? 'Cukup' : 'Kurang';
}

/* ---- gaya halaman ---- */
function css(cfg){
  var f4 = (cfg.kertas || 'A4') === 'F4', h = f4 ? 330 : 297;
  var wm = cfg.watermark ? watermarkUrl(cfg.watermark) : '';
  return '@page{size:' + (f4 ? '215mm 330mm' : 'A4') + ';margin:0}' +
  '*{box-sizing:border-box}html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
  'body{margin:0;background:#5b6b78;font-family:Arial,Helvetica,sans-serif;color:#000}' +
  '.hal{width:' + (f4 ? 215 : 210) + 'mm;height:' + h + 'mm;margin:10px auto;background:#fff;position:relative;overflow:hidden;padding:12mm 15mm 16mm 18mm;page-break-after:always;break-after:page}' +
  '.hal:last-child{page-break-after:auto;break-after:auto}' +
  (wm ? '.hal.wm{background-image:url("' + wm + '");background-repeat:repeat;background-size:62mm 46mm}' : '') +
  '.wmlogo{position:absolute;left:50%;top:50%;width:105mm;height:105mm;margin:-52mm 0 0 -52mm;opacity:.07;object-fit:contain;pointer-events:none}' +
  '.isi{position:relative}' +
  /* kop */
  '.kop{display:flex;align-items:center;gap:8px;border-bottom:3px double #000;padding-bottom:5px;margin-bottom:8px}' +
  '.kop img{width:21mm;height:21mm;object-fit:contain;flex:0 0 21mm}.kop .kt{flex:1;text-align:center;font-family:"Times New Roman",Times,serif;line-height:1.18}' +
  '.kop .b1{font-size:10.5pt;font-weight:bold;letter-spacing:.3px}.kop .b2{font-size:15pt;font-weight:bold;letter-spacing:.5px}' +
  '.kop .b3,.kop .b4{font-size:9.5pt;font-style:italic}.kop .kosong{width:21mm;flex:0 0 21mm}' +
  /* identitas ringkas */
  '.idt{width:100%;font-size:9pt;border-collapse:collapse;margin:2px 0 4px}.idt td{padding:1px 2px;vertical-align:top}.idt td.l{width:19mm}.idt td.s{width:3mm}' +
  '.idt td.l2{width:28mm}.garis{border-bottom:1.2px solid #000;margin:3px 0 10px}' +
  '.judul{text-align:center;font-weight:bold;font-size:12pt;margin:6px 0 10px;letter-spacing:.3px}' +
  /* tabel nilai */
  '.tn{width:100%;border-collapse:collapse;font-size:8.6pt}.tn th,.tn td{border:1px solid #000;padding:3px 4px;vertical-align:middle}' +
  '.tn th{background:#e7e7e7;text-align:center;font-weight:bold}.tn td.no{width:6mm;text-align:center}.tn td.mp{width:44mm}' +
  '.tn td.na{width:16mm;text-align:center}.tn td.ds{text-align:justify;font-size:8.1pt;line-height:1.25}.tn td.sub{padding-left:12px}' +
  '.tn tr.jml td{font-weight:bold}.tn td.nob{border-top:0;border-bottom:0}.tn td.nob1{border-bottom:0}.tn td.nob2{border-top:0}' +
  /* halaman 2 */
  '.sek{font-weight:bold;font-size:10pt;margin:10px 0 2px}.tk{width:100%;border-collapse:collapse;font-size:8.8pt}' +
  '.tk th,.tk td{border:1px solid #000;padding:3px 5px;height:6mm}.tk th{background:#e7e7e7}.tk td.c{text-align:center}' +
  '.kotak{border:1px solid #000;padding:4px 6px;font-size:8.8pt;min-height:13mm;white-space:pre-wrap}.kotak.tinggi{min-height:20mm}' +
  '.naik{border:1px solid #000;padding:5px 6px;font-size:9pt;margin-top:12px}' +
  '.ttd{width:100%;border-collapse:collapse;font-size:9.5pt;margin-top:14px;page-break-inside:avoid}.ttd td{vertical-align:top;padding:0}' +
  '.ttd .sp{height:19mm}.ttd .nm{font-weight:bold;text-decoration:underline}.ttd .gs{display:inline-block;min-width:45mm;border-bottom:1px solid #000;height:1px}' +
  '.kaki{position:absolute;left:18mm;right:15mm;bottom:8mm;display:flex;justify-content:space-between;font-size:7.5pt}' +
  /* sampul */
  '.sampul{text-align:center;font-family:Arial,Helvetica,sans-serif}.sampul .lg1{width:26mm;height:26mm;object-fit:contain;margin-top:14mm}' +
  '.sampul .atas{font-size:9.5pt;margin-top:4px;letter-spacing:.3px}.sampul .jdl{font-family:"Times New Roman",Times,serif;font-weight:bold;font-size:17pt;line-height:1.5;margin-top:20mm}' +
  '.sampul .lg2{width:42mm;height:42mm;object-fit:contain;margin:20mm 0 26mm}.sampul .data{width:150mm;margin:0 auto;text-align:left;font-weight:bold;font-size:11.5pt;border-collapse:collapse}' +
  '.sampul .data td{padding:4px 2px}.sampul .data td.l{width:45mm}.sampul .data td.s{width:6mm}' +
  '.sampul .bawah{position:absolute;left:0;right:0;bottom:24mm;text-align:center;font-weight:bold;font-size:11pt;line-height:1.45}.sampul .bawah .n{font-size:14pt}' +
  /* identitas */
  '.ip{font-family:"Times New Roman",Times,serif;font-size:10.5pt}.ip table.d{border-collapse:collapse;width:100%}.ip table.d td{padding:1.6px 2px;vertical-align:top}' +
  '.ip td.no{width:9mm;text-align:right;padding-right:5px}.ip td.l{width:62mm}.ip td.s{width:4mm}.ip .tt{display:flex;justify-content:flex-end;gap:14px;margin-top:10mm}' +
  '.ip .foto{width:30mm;height:40mm;border:1px solid #000;display:flex;align-items:center;justify-content:center;font-size:8pt;margin-top:12mm;overflow:hidden}.ip .foto img{width:100%;height:100%;object-fit:cover}' +
  '.ip .ttdk{width:72mm;font-size:10.5pt}.ip .ttdk .sp{height:20mm}' +
  '@media print{body{background:#fff}.hal{margin:0;box-shadow:none}.noprint{display:none!important}}' +
  '@media screen{.hal{box-shadow:0 2px 10px rgba(0,0,0,.35)}}';
}
function watermarkUrl(teks){
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="234" height="174"><text x="20" y="120" transform="rotate(-30 117 87)" font-family="Arial" font-size="13" font-weight="bold" fill="rgba(0,0,0,0.055)">' +
    esc(teks) + '</text></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function kop(cfg){
  var k = cfg.kop || {}, kiri = cfg.logo || '', kanan = cfg.logoKanan || '';
  return '<div class="kop">' + (kiri ? '<img src="' + esc(kiri) + '" alt="">' : '<span class="kosong"></span>') +
    '<div class="kt">' + (k.b1 ? '<div class="b1">' + esc(k.b1) + '</div>' : '') + '<div class="b2">' + esc(k.b2 || '') + '</div>' +
    (k.b3 ? '<div class="b3">' + esc(k.b3) + '</div>' : '') + (k.b4 ? '<div class="b4">' + esc(k.b4) + '</div>' : '') + '</div>' +
    (kanan ? '<img src="' + esc(kanan) + '" alt="">' : '<span class="kosong"></span>') + '</div>';
}
function identitasRingkas(cfg, s){
  var p = cfg.periode || {}, L = cfg.lembaga || {};
  var r = function(a, b, c, d){ return '<tr><td class="l">' + a + '</td><td class="s">:</td><td>' + b + '</td><td class="l2">' + c + '</td><td class="s">:</td><td style="width:34mm">' + d + '</td></tr>'; };
  return '<table class="idt">' +
    r('Nama', esc(s.nama), 'Kelas', esc(s.kelasLabel || p.kelas)) +
    r('NIS/NISN', esc([s.nis, s.nisn].filter(Boolean).join(' / ')), 'Fase', esc(p.fase || 'D')) +
    r(esc(cfg.labelSatuan || 'Satuan Pendidikan'), esc(L.namaPendek || L.nama || ''), 'Semester', esc(p.semester || '')) +
    r('Alamat', esc(L.alamatPendek || L.alamat || ''), 'Tahun Pelajaran', esc(p.tahun || '')) + '</table><div class="garis"></div>';
}
function kaki(cfg, s, n){
  return '<div class="kaki"><span>' + esc([s.kelasLabel || (cfg.periode || {}).kelas, s.nama, s.nisn].filter(Boolean).join(' _ ')) + '</span><span>Halaman ' + n + '</span></div>';
}
function bungkus(cfg, kelas, isi, opsi){
  opsi = opsi || {};
  return '<section class="hal' + (cfg.watermark && !opsi.tanpaWm ? ' wm' : '') + (kelas ? ' ' + kelas : '') + '">' +
    (opsi.logoTengah && cfg.logo ? '<img class="wmlogo" src="' + esc(cfg.logo) + '" alt="">' : '') + '<div class="isi">' + isi + '</div>' + (opsi.kaki || '') + '</section>';
}

/* ---- halaman ---- */
function halSampul(cfg, s){
  var sp = cfg.sampul || {}, L = cfg.lembaga || {};
  // sampul tanpa logo kecil & tulisan di bagian atas (permintaan pondok); judul turun ke tengah atas
  var isi = '<div style="height:34mm"></div>' +
    '<div class="jdl">' + [sp.j1, sp.j2, sp.j3, sp.j4].filter(Boolean).map(esc).join('<br>') + '</div>' +
    (cfg.logo ? '<img class="lg2" src="' + esc(cfg.logo) + '" alt="">' : '<div style="height:80mm"></div>') +
    '<table class="data"><tr><td class="l">NAMA</td><td class="s">:</td><td>' + esc(s.nama) + '</td></tr>' +
    '<tr><td class="l">NIS</td><td class="s">:</td><td>' + esc(s.nis || '') + '</td></tr>' +
    '<tr><td class="l">NISN</td><td class="s">:</td><td>' + esc(s.nisn || '') + '</td></tr></table>';
  var bawah = '<div class="bawah"><div class="n">' + esc(sp.bawah1 || L.nama || '') + '</div>' + [sp.bawah2, sp.bawah3].filter(Boolean).map(function(x){ return '<div>' + esc(x) + '</div>'; }).join('') + '</div>';
  return bungkus(cfg, 'sampul', isi, {kaki: bawah});
}
function halIdentitas(cfg, s){
  var L = cfg.lembaga || {};
  var b = function(no, l, v, sub){ return '<tr><td class="no">' + (no ? no + '.' : '') + '</td><td class="l">' + (sub ? '&nbsp;&nbsp;&nbsp;' : '') + esc(l) + '</td><td class="s">:</td><td>' + esc(v == null ? '' : v) + '</td></tr>'; };
  var rows = [
    b(1, 'Nama Peserta Didik', s.nama), b(2, 'NIS', s.nis), b(3, 'NISN', s.nisn), b(4, 'Tempat, Tanggal Lahir', s.ttl), b(5, 'Jenis Kelamin', s.jk),
    b(6, 'Agama', s.agama || 'Islam'), b(7, 'Status dalam Keluarga', s.statusKel), b(8, 'Anak ke', s.anakKe), b(9, 'Alamat Peserta Didik', s.alamat),
    b(10, 'Nomor Telepon Rumah/HP', s.telp), b(11, 'Sekolah Asal', s.sekolahAsal), b(12, 'Diterima di satuan pendidikan ini', ''),
    b('', 'a. Di kelas', s.diterimaKelas, 1), b('', 'b. Pada tanggal', tglIndo(s.diterimaTgl), 1), b(13, 'Nama Orang Tua', ''),
    b('', 'a. Ayah', s.ayah, 1), b('', 'b. Ibu', s.ibu, 1), b(14, 'Alamat Orang Tua', s.alamatOrtu), b(15, 'Pekerjaan Orang Tua', ''),
    b('', 'a. Ayah', s.pekAyah, 1), b('', 'b. Ibu', s.pekIbu, 1), b(16, 'Nama Wali Peserta Didik', s.waliNama),
    b('', 'Pekerjaan Wali', s.waliPek, 1), b('', 'Alamat Wali Peserta Didik', s.waliAlamat, 1)
  ].join('');
  var tgl = cfg.tglIdentitas || s.diterimaTgl;
  var isi = kop(cfg) + '<div class="ip"><div class="judul" style="font-family:\'Times New Roman\',serif">IDENTITAS PESERTA DIDIK</div><table class="d">' + rows + '</table>' +
    '<div class="tt"><div class="foto">' + (s.foto ? '<img src="' + esc(s.foto) + '" alt="">' : 'Pas foto<br>3 x 4') + '</div>' +
    '<div class="ttdk">' + esc(cfg.kota || 'Poso') + ', ' + esc(tglIndo(tgl)) + '<br>' + esc(L.jabatanKepala || 'Mudir') + '<div class="sp"></div><b><u>' + esc(L.kepala || '') + '</u></b><br>' +
    (L.niyKepala ? 'NIY. ' + esc(L.niyKepala) : '') + '</div></div></div>';
  return bungkus(cfg, '', isi, {logoTengah: true});
}
function halCapaian(cfg, s){
  var baris = [], no = 0, sub = 0, rows = s.mapel || [];
  for (var i = 0; i < rows.length; i++) {
    var m = rows[i];
    if (m.judul) {
      no++; sub = 0;
      var anak = 0; for (var j = i + 1; j < rows.length && rows[j].sub; j++) anak++;
      baris.push('<tr><td class="no' + (anak ? ' nob1' : '') + '">' + no + '</td><td class="mp" colspan="1"><b style="font-weight:normal">' + esc(m.nama) + '</b></td><td class="na"></td><td class="ds"></td></tr>');
      continue;
    }
    if (m.sub) {
      var akhir = !(rows[i + 1] && rows[i + 1].sub);
      baris.push('<tr><td class="no ' + (akhir ? 'nob2' : 'nob') + '"></td><td class="mp sub">' + HURUF.charAt(sub++) + '. ' + esc(m.nama) + '</td><td class="na">' + esc(m.nilai) + '</td><td class="ds">' + esc(m.desk) + '</td></tr>');
      continue;
    }
    no++; sub = 0;
    baris.push('<tr><td class="no">' + no + '</td><td class="mp">' + esc(m.nama) + '</td><td class="na">' + esc(m.nilai) + '</td><td class="ds">' + esc(m.desk) + '</td></tr>');
  }
  baris.push('<tr class="jml"><td colspan="2">Jumlah</td><td class="na">' + esc(s.jumlah) + '</td><td></td></tr>');
  if (cfg.tampilRata && s.rata !== '' && s.rata != null) baris.push('<tr class="jml"><td colspan="2">Rata-rata</td><td class="na">' + esc(s.rata) + '</td><td></td></tr>');
  var isi = kop(cfg) + identitasRingkas(cfg, s) + '<div class="judul">CAPAIAN HASIL BELAJAR</div>' +
    '<table class="tn"><tr><th colspan="2">Mata Pelajaran</th><th>Nilai Akhir</th><th>Capaian Kompetensi</th></tr>' + baris.join('') + '</table>';
  return bungkus(cfg, '', isi, {kaki: kaki(cfg, s, 1)});
}
function halLanjutan(cfg, s){
  var L = cfg.lembaga || {}, p = cfg.periode || {};
  var ek = (s.ekskul || []).slice(); while (ek.length < 2) ek.push({});
  var pr = (s.prestasi || []).slice(); while (pr.length < 3) pr.push({});
  var h = s.hadir || {};
  var isi =
    '<div class="sek" style="margin-top:0">Ekstrakurikuler</div><table class="tk"><tr><th style="width:9mm">No</th><th>Kegiatan Ekstrakurikuler</th><th style="width:26mm">Nilai</th><th>Keterangan</th></tr>' +
      ek.map(function(x, i){ return '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(x.nama) + '</td><td class="c">' + esc(x.nilai) + '</td><td>' + esc(x.ket) + '</td></tr>'; }).join('') + '</table>' +
    '<div class="sek">Prestasi</div><table class="tk"><tr><th style="width:9mm">No</th><th style="width:62mm">Jenis Prestasi</th><th>Keterangan</th></tr>' +
      pr.map(function(x, i){ return '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(x.jenis) + '</td><td>' + esc(x.ket) + '</td></tr>'; }).join('') + '</table>' +
    '<div class="sek">Ketidakhadiran</div><table class="tk">' +
      [['Sakit', h.s], ['Izin', h.i], ['Tanpa Keterangan', h.a]].map(function(x){ return '<tr><td style="width:62mm"><b>' + x[0] + '</b></td><td class="c" style="width:26mm">' + esc(x[1] == null || x[1] === '' ? 0 : x[1]) + '</td><td>Hari</td></tr>'; }).join('') + '</table>' +
    '<div class="sek">Catatan Wali Kelas</div><div class="kotak">' + esc(s.catatan || '') + '</div>' +
    '<div class="sek">Tanggapan Orang Tua/Wali</div><div class="kotak tinggi"></div>' +
    (s.naik ? '<div class="naik">Keterangan Kenaikan Kelas: <b>' + esc(s.naik) + '</b></div>' : '') +
    '<table class="ttd"><tr><td style="width:55%;padding-top:5mm">Orang Tua/Wali<div class="sp"></div><span class="gs"></span></td>' +
      '<td>' + esc(cfg.kota || 'Poso') + ', ' + esc(tglIndo(cfg.tglRapor)) + '<br>Wali Kelas<div class="sp"></div><span class="nm">' + esc(p.wali || '') + '</span><br>NIY. ' + esc(p.niyWali || '-') + '</td></tr>' +
      '<tr><td colspan="2" style="padding:6mm 0 0 34%">Mengetahui,<br>' + esc(L.jabatanKepala || 'Mudir') + '<div class="sp"></div><span class="nm">' + esc(L.kepala || '') + '</span><br>NIY. ' + esc(L.niyKepala || '-') + '</td></tr></table>';
  return bungkus(cfg, '', isi, {kaki: kaki(cfg, s, 2), logoTengah: true});
}


/* ---- Lembar CAPAIAN HAFALAN (dipakai rapor Kurmer & K13) ----
 * s.hafalan = {bulan:[{label, labelPanjang, teks, status, rincian}], jumlahRingkas, jumlah, totalSemesterTeks, pengampu, halaqoh}
 * Gaya dibatasi di dalam .hfw supaya aman disisipkan ke dokumen rapor K13. */
function cssHafalan(){
  return '.hfw{font-family:Arial,Helvetica,sans-serif;color:#000;font-size:10pt}.hfw *{box-sizing:border-box}' +
  '.hfw .kop{display:flex;align-items:center;gap:8px;border-bottom:3px double #000;padding-bottom:5px;margin-bottom:8px}' +
  '.hfw .kop img{width:21mm;height:21mm;object-fit:contain;flex:0 0 21mm}.hfw .kop .kt{flex:1;text-align:center;font-family:"Times New Roman",Times,serif;line-height:1.18}' +
  '.hfw .kop .b1{font-size:10.5pt;font-weight:bold}.hfw .kop .b2{font-size:15pt;font-weight:bold;letter-spacing:.5px}.hfw .kop .b3,.hfw .kop .b4{font-size:9.5pt;font-style:italic}.hfw .kop .kosong{width:21mm;flex:0 0 21mm}' +
  '.hfw .hj{text-align:center;font-weight:bold;font-size:12pt;margin:8px 0 2px;letter-spacing:.3px}.hfw .hs{text-align:center;font-weight:bold;font-size:10.5pt;margin:0 0 10px}' +
  '.hfw .hid{border-collapse:collapse;font-size:10pt;margin:0 0 10px}.hfw .hid td{padding:2px 3px;vertical-align:top}.hfw .hid td.l{width:42mm}.hfw .hid td.s{width:4mm}' +
  '.hfw .ht{width:100%;border-collapse:collapse;font-size:9.6pt}.hfw .ht th,.hfw .ht td{border:1px solid #000;padding:5px 6px;vertical-align:middle}' +
  '.hfw .ht th{background:#e7e7e7;text-align:center;font-weight:bold}.hfw .ht td.c{text-align:center}.hfw .ht td.no{width:9mm;text-align:center}.hfw .ht td.bl{width:38mm}.hfw .ht td.cp{width:40mm;text-align:center}' +
  '.hfw .ht tr.tot td{font-weight:bold;background:#f4f4f4}.hfw .ht .kc{display:block;font-weight:normal;font-size:8.4pt;color:#333}' +
  '.hfw .hk{font-size:8pt;color:#333;margin-top:6px;line-height:1.35}' +
  '.hfw .httd{width:100%;border-collapse:collapse;font-size:10pt;margin-top:12mm}.hfw .httd td{vertical-align:top}.hfw .httd .sp{height:19mm}.hfw .httd .nm{font-weight:bold;text-decoration:underline}' +
  '.hf-k13 .hf-pad{position:absolute;left:0;top:0;right:0;bottom:0;padding:12mm 15mm 16mm 18mm}' +
  '.hf-k13 .hf-kaki{position:absolute;left:18mm;right:15mm;bottom:8mm;display:flex;justify-content:space-between;font-size:7.5pt;font-family:Arial}';
}
function isiHafalan(cfg, s){
  var h = s.hafalan || {}, p = cfg.periode || {}, L = cfg.lembaga || {};
  var bln = h.bulan || [];
  var teksBulan = function(b){ return b.status === 'ulang' ? 'Mengulang setoran' : (b.teks || '–'); };
  var baris = bln.length ? bln.map(function(b, i){
    return '<tr><td class="no">' + (i + 1) + '</td><td class="bl">' + esc(b.labelPanjang || b.label) + '</td><td class="cp">' + esc(teksBulan(b)) + '</td><td>' + esc(b.rincian || (b.status === 'murojaah' ? 'Murojaah (mengulang hafalan lama)' : '–')) + '</td></tr>';
  }).join('') : '<tr><td colspan="4" class="c">Belum ada catatan hafalan pada semester ini.</td></tr>';
  var isi = kop(cfg) +
    '<div class="hj">CAPAIAN HAFALAN AL-QUR\'AN SANTRI</div><div class="hs">SEMESTER ' + esc(String(p.semester || '').toUpperCase()) + ' TAHUN PELAJARAN ' + esc(p.tahun || '') + '</div>' +
    '<table class="hid">' +
      [['Nama Peserta Didik', s.nama], [cfg.labelSatuanHafalan || 'Nama PK PPS', cfg.namaSatuanHafalan || L.namaPendek || L.nama], ['Nomor Induk', s.nis], ['NISN', s.nisn],
       ['Kelas', s.kelasLabel || p.kelas], ['Halaqoh', h.halaqoh]].map(function(r){ return '<tr><td class="l">' + esc(r[0]) + '</td><td class="s">:</td><td>' + esc(r[1] || '') + '</td></tr>'; }).join('') + '</table>' +
    '<table class="ht"><tr><th style="width:9mm">No</th><th>Bulan</th><th>Capaian Hafalan Baru</th><th>Surah dan Ayat yang Dihafal</th></tr>' + baris +
      '<tr class="tot"><td colspan="2">Hafalan baru semester ini</td><td class="cp">' + esc(h.totalSemesterTeks || '–') + '</td><td></td></tr>' +
      '<tr class="tot"><td colspan="2">Jumlah Hafalan</td><td class="cp">' + esc(h.jumlahRingkas || '–') + '</td><td>' + (h.jumlah && h.jumlah !== '–' ? '<span class="kc">' + esc(h.jumlah) + '</span>' : '') + '</td></tr></table>' +
    '<div class="hk">Keterangan: 1 lembar = 2 halaman mushaf. Hafalan baru dihitung dari setoran Sabaq; halaman yang disetor ulang tidak dihitung dua kali. ' +
      'Jumlah Hafalan = seluruh hafalan sejak masuk pondok (termasuk semester sebelumnya).</div>' +
    '<table class="httd"><tr><td style="width:55%"></td><td>' + esc(cfg.kota || 'Poso') + ', ' + esc(tglIndo(cfg.tglRapor)) + '<br>Pengampu Hafalan<div class="sp"></div><span class="nm">' + esc(h.pengampu || '') + '</span></td></tr></table>';
  return '<div class="hfw">' + isi + '</div>';
}
function halHafalan(cfg, s){
  if (!s.hafalan) return '';
  return bungkus(cfg, '', isiHafalan(cfg, s), {kaki: kaki(cfg, s, 3), logoTengah: true});
}
// Untuk rapor K13: satu lembar A4 memakai kelas .page milik mesin rapor K13
function halHafalanK13(cfg, s){
  if (!s.hafalan) return '';
  return '<section class="page hf-k13"><div class="hf-pad">' + isiHafalan(cfg, s) + '</div><div class="hf-kaki"><span>' + esc([s.kelasLabel || (cfg.periode || {}).kelas, s.nama, s.nisn].filter(Boolean).join(' _ ')) + '</span><span>Capaian Hafalan</span></div></section>';
}

var LEMBAR = [['sampul', 'Sampul', halSampul], ['identitas', 'Identitas peserta didik', halIdentitas], ['capaian', 'Capaian hasil belajar', halCapaian], ['lanjutan', 'Ekstrakurikuler, prestasi, kehadiran & catatan', halLanjutan], ['hafalan', 'Capaian hafalan', halHafalan]];
function halaman(cfg, daftar, lembar){
  var pg = LEMBAR.filter(function(x){ return !lembar || !lembar.length || lembar.indexOf(x[0]) >= 0; });
  return (daftar || []).map(function(s){ return pg.map(function(x){ return x[2](cfg, s); }).join(''); }).join('');
}
window.RaporKM = {
  LEMBAR: LEMBAR.map(function(x){ return [x[0], x[1]]; }), ROMAWI: ROMAWI, AMBANG: AMBANG,
  predikat: predikat, deskripsi: deskripsi, nilaiEkskul: nilaiEkskul, tglIndo: tglIndo, kapital: kapital,
  css: css, halaman: halaman, cssHafalan: cssHafalan, halHafalanK13: halHafalanK13,
  dokumen: function(judul, cfg, daftar, lembar){
    var f4 = (cfg.kertas || 'A4') === 'F4';
    return '<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>' + esc(judul) + '</title><style>' + css(cfg) + cssHafalan() + '</style></head><body>' +
      '<div class="noprint" style="font:14px Arial;background:#fef9c3;padding:10px 14px;position:sticky;top:0;z-index:5">Di jendela cetak: Kertas <b>' + (f4 ? 'F4 / Folio (215 x 330 mm)' : 'A4') + '</b>, Margin <b>None / Tidak ada</b>, Skala <b>100</b>, centang <b>Background graphics / Grafik latar</b>. ' +
      '<button onclick="window.print()" style="margin-left:6px;padding:5px 14px;font-weight:bold">&#128424;&#65039; Cetak / Simpan PDF</button></div>' +
      halaman(cfg, daftar, lembar) + '</body></html>';
  }
};
})();
