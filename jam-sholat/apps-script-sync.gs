/**
 * Backend lengkap untuk aplikasi Jadwal Sholat Masjid.
 * - Menyimpan semua pengaturan (jadwal, banner/video, pengumuman, identitas,
 *   adzan/iqomah, suara) di Google Sheets — supaya bisa dibuka & diperiksa
 *   manual kalau perlu.
 * - Jadi jembatan upload gambar banner / logo / suara adzan custom ke
 *   Google Drive, lalu mengembalikan URL publiknya ke aplikasi.
 * - Menyimpan laporan "Imam Berhalangan".
 *
 * ============================ CARA PASANG ============================
 * 1. Buka https://script.google.com -> New project.
 * 2. Hapus semua isi editor, tempel SELURUH isi file ini.
 * 3. Di toolbar atas, pilih fungsi "setup" dari dropdown (di sebelah tombol
 *    Run/ikon play), lalu klik "Run".
 *    - Google akan minta izin akses Sheets & Drive -> klik "Allow"/"Izinkan".
 *    - Ini otomatis membuat 1 Google Spreadsheet baru (semua sheet yang
 *      dibutuhkan) + 1 folder Drive untuk menyimpan banner/logo/suara.
 *    - Buka menu "Executions" (ikon jam) atau "View > Logs" untuk melihat
 *      link Spreadsheet & Folder yang baru dibuat (opsional, cuma info).
 * 4. Klik "Deploy" -> "New deployment".
 *    - Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Salin "Web app URL" yang muncul, tempel ke Pengaturan aplikasi -> tab
 *    "Adzan & Iqomah" -> "URL Sinkronisasi" -> klik "Unduh config.json" ->
 *    upload file itu ke GitHub (folder utama/root, timpa yang lama).
 *
 * Kalau nanti ganti/edit kode ini, WAJIB "New deployment" lagi (bukan edit
 * deployment lama) supaya perubahan aktif.
 * =======================================================================
 */

var SETTINGS_SHEET = 'Settings';
var REPORTS_SHEET = 'Reports';
var DAILYSETS_SHEET = 'DailySets';
var DRIVE_FOLDER_NAME = 'Banner Masjid - Jadwal Sholat App';

// ---------------------------------------------------------------------
// SETUP — jalankan fungsi ini SEKALI dari editor Apps Script
// ---------------------------------------------------------------------
function setup() {
  var props = PropertiesService.getScriptProperties();
  var ss = null;
  var existingId = props.getProperty('SHEET_ID');

  if (existingId) {
    try { ss = SpreadsheetApp.openById(existingId); } catch (err) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('Data Aplikasi Jadwal Sholat Masjid');
    props.setProperty('SHEET_ID', ss.getId());
  }

  var settingsSheet = ss.getSheetByName(SETTINGS_SHEET);
  if (!settingsSheet) settingsSheet = ss.insertSheet(SETTINGS_SHEET);
  if (settingsSheet.getLastRow() === 0) settingsSheet.appendRow(['Key', 'Value']);

  var reportsSheet = ss.getSheetByName(REPORTS_SHEET);
  if (!reportsSheet) reportsSheet = ss.insertSheet(REPORTS_SHEET);
  if (reportsSheet.getLastRow() === 0) reportsSheet.appendRow(['Key', 'Status', 'At']);

  var dailySheet = ss.getSheetByName(DAILYSETS_SHEET);
  if (!dailySheet) dailySheet = ss.insertSheet(DAILYSETS_SHEET);
  if (dailySheet.getLastRow() === 0) dailySheet.appendRow(['SetId', 'Index', 'ImageUrl']);

  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 3) ss.deleteSheet(defaultSheet);

  var folderId = props.getProperty('FOLDER_ID');
  var folder = null;
  if (folderId) {
    try { folder = DriveApp.getFolderById(folderId); } catch (err) { folder = null; }
  }
  if (!folder) {
    folder = DriveApp.createFolder(DRIVE_FOLDER_NAME);
    props.setProperty('FOLDER_ID', folder.getId());
  }

  Logger.log('===== SETUP SELESAI =====');
  Logger.log('Spreadsheet data: ' + ss.getUrl());
  Logger.log('Folder Drive banner: ' + folder.getUrl());
  Logger.log('Sekarang klik Deploy > New deployment untuk mengaktifkan Web App.');
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function getSheets_() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) throw new Error('Belum di-setup. Jalankan fungsi setup() dulu dari editor Apps Script.');
  var ss = SpreadsheetApp.openById(sheetId);
  return { settings: ss.getSheetByName(SETTINGS_SHEET), reports: ss.getSheetByName(REPORTS_SHEET), daily: ss.getSheetByName(DAILYSETS_SHEET) };
}

function readSettings_(sheet) {
  var data = sheet.getDataRange().getValues();
  var out = {};
  for (var i = 1; i < data.length; i++) {
    var key = data[i][0];
    if (!key) continue;
    try { out[key] = JSON.parse(data[i][1]); } catch (err) { out[key] = data[i][1]; }
  }
  return out;
}

function writeSetting_(sheet, key, value) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(JSON.stringify(value));
      return;
    }
  }
  sheet.appendRow([key, JSON.stringify(value)]);
}

function readReports_(sheet) {
  var data = sheet.getDataRange().getValues();
  var out = {};
  for (var i = 1; i < data.length; i++) {
    var key = data[i][0];
    if (!key) continue;
    out[key] = { status: data[i][1], at: data[i][2] };
  }
  return out;
}

function writeReport_(sheet, key, status) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      if (status === null) sheet.deleteRow(i + 1);
      else sheet.getRange(i + 1, 2, 1, 2).setValues([[status, Date.now()]]);
      return;
    }
  }
  if (status !== null) sheet.appendRow([key, status, Date.now()]);
}

function readDailySets_(sheet) {
  var data = sheet.getDataRange().getValues();
  var out = {};
  for (var i = 1; i < data.length; i++) {
    var setId = data[i][0];
    if (!setId) continue;
    if (!out[setId]) out[setId] = [];
    out[setId][data[i][1]] = data[i][2];
  }
  // compact any sparse arrays (shouldn't normally happen) and drop empty slots
  Object.keys(out).forEach(function(k){ out[k] = out[k].filter(function(v){ return typeof v !== 'undefined'; }); });
  return out;
}

function writeDailySet_(sheet, setId, images) {
  var data = sheet.getDataRange().getValues();
  // remove existing rows for this setId (iterate bottom-up so row indices stay valid while deleting)
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === setId) sheet.deleteRow(i + 1);
  }
  var rows = images.map(function(url, idx){ return [setId, idx, url]; });
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
}

function handleUploadFile_(body) {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('FOLDER_ID');
  if (!folderId) return { ok: false, error: 'Folder Drive belum ada. Jalankan fungsi setup() dulu.' };
  var folder = DriveApp.getFolderById(folderId);
  var bytes = Utilities.base64Decode(body.dataBase64);
  var blob = Utilities.newBlob(bytes, body.mimeType || 'application/octet-stream', body.filename || 'file');
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var url = 'https://drive.google.com/uc?export=view&id=' + file.getId();
  return { ok: true, url: url, fileId: file.getId() };
}

function extractSheetId_(url) {
  var m = (url || '').match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  return url; // assume they pasted the raw Sheet ID directly
}

// Reads an arbitrary Google Sheet the admin's account has access to (e.g. a
// grades spreadsheet), for the "Pengumuman dari Google Sheets" banner feature.
function handleReadSheet_(body) {
  try {
    var id = extractSheetId_(body.sheetUrl);
    var ss = SpreadsheetApp.openById(id);
    var sheet = body.tabName ? ss.getSheetByName(body.tabName) : ss.getSheets()[0];
    if (!sheet) return { ok: false, error: 'Tab/sheet "' + body.tabName + '" tidak ditemukan.' };
    var values = sheet.getDataRange().getValues();
    return { ok: true, rows: values };
  } catch (err) {
    return { ok: false, error: 'Gagal membaca sheet: ' + err.message + ' (pastikan URL benar & akun ini punya akses).' };
  }
}

// Retrieves a previously-uploaded file's raw bytes (used by the "Penampil PDF"
// feature to fetch a whole PDF once, cache it in the browser, and render
// whichever page is needed each day — avoids CORS issues with fetching
// Drive links directly, and avoids re-uploading the file page-by-page.
function handleGetFile_(body) {
  try {
    var file = DriveApp.getFileById(body.fileId);
    var blob = file.getBlob();
    var sizeMb = blob.getBytes().length / (1024*1024);
    if (sizeMb > 25) {
      return { ok: false, error: 'File berukuran ' + sizeMb.toFixed(1) + 'MB, terlalu besar untuk cara ini. Pakai fitur "Set Harian dari PDF" (konversi ke gambar) untuk file sebesar ini.' };
    }
    var base64 = Utilities.base64Encode(blob.getBytes());
    return { ok: true, dataBase64: base64, mimeType: blob.getContentType() };
  } catch (err) {
    return { ok: false, error: 'Gagal mengambil file: ' + err.message };
  }
}

// ---------------------------------------------------------------------
// Web App entry points
// ---------------------------------------------------------------------
function doGet(e) {
  var sheets = getSheets_();
  var state = readSettings_(sheets.settings);
  state.reports = readReports_(sheets.reports);
  state.dailySets = readDailySets_(sheets.daily);
  return ContentService.createTextOutput(JSON.stringify(state)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var body = JSON.parse(e.postData.contents);

  if (body.action === 'uploadImage' || body.action === 'uploadFile') {
    var result = handleUploadFile_(body);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }
  if (body.action === 'readSheet') {
    var sheetResult = handleReadSheet_(body);
    return ContentService.createTextOutput(JSON.stringify(sheetResult)).setMimeType(ContentService.MimeType.JSON);
  }
  if (body.action === 'getFile') {
    var fileResult = handleGetFile_(body);
    return ContentService.createTextOutput(JSON.stringify(fileResult)).setMimeType(ContentService.MimeType.JSON);
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheets = getSheets_();
    if (body.action === 'saveDailySet') {
      writeDailySet_(sheets.daily, body.setId, body.images || []);
    } else if (typeof body.key !== 'undefined') {
      writeSetting_(sheets.settings, body.key, body.value);
    } else if (body.iso && body.prayerKey) {
      var key = body.iso + '#' + body.prayerKey;
      writeReport_(sheets.reports, key, body.action === 'clear' ? null : 'absen');
    }
  } finally {
    lock.releaseLock();
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}
