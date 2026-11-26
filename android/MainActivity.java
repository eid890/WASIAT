package id.ponpeswu.wasiat;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.Dialog;
import android.app.DownloadManager;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Aplikasi Android WASIAT: membuka situs WASIAT (wasiat.vercel.app) di dalam aplikasi dan
 * menyediakan jembatan "WasiatApp" untuk alarm jam mengajar, menyimpan berkas, dan mencetak.
 */
public class MainActivity extends Activity {
    static final String SITUS = "https://wasiat.vercel.app/";
    static final String HOST = "wasiat.vercel.app";
    private static final int KODE_BERKAS = 41;
    private static final int KODE_IZIN = 42;

    WebView web;
    WebView webPopup;
    Dialog dialogPopup;
    private ValueCallback<Uri[]> panggilBerkas;
    private PermissionRequest mintaKamera;
    private final Handler utama = new Handler(Looper.getMainLooper());

    // Penyesuaian kecil untuk WebView: unduhan blob, cetak, jendela baru
    static final String SHIM =
            "(function(){if(window.__wasiatShim)return;window.__wasiatShim=1;" +
            "var peta={};try{var buat=URL.createObjectURL.bind(URL);URL.createObjectURL=function(o){var u=buat(o);try{if(o instanceof Blob)peta[u]=o;}catch(e){}return u;};" +
            "var cabut=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=function(u){setTimeout(function(){delete peta[u];try{cabut(u);}catch(e){}},60000);};}catch(e){}" +
            "function kirim(b,nama){var fr=new FileReader();fr.onload=function(){var s=String(fr.result),i=s.indexOf(',');WasiatApp.simpanBerkas(nama||'berkas',b.type||'application/octet-stream',s.slice(i+1));};fr.readAsDataURL(b);}" +
            "function simpan(h,nama){if(peta[h]){kirim(peta[h],nama);return;}fetch(h).then(function(r){return r.blob();}).then(function(b){kirim(b,nama);}).catch(function(e){alert('Gagal menyimpan berkas: '+e.message);});}" +
            "var klik=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){var h=this.href||'';if(/^(blob:|data:)/.test(h)){simpan(h,this.getAttribute('download')||document.title);return;}return klik.apply(this,arguments);};" +
            "document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a'):null;if(!a)return;var h=a.href||'';if(/^(blob:|data:)/.test(h)){e.preventDefault();e.stopPropagation();simpan(h,a.getAttribute('download')||document.title);}},true);" +
            "window.print=function(){WasiatApp.cetak(document.title||'WASIAT');};" +
            "var buka=window.open;window.open=function(){var w=buka.apply(window,arguments);try{if(w){var p=function(){try{w.print=function(){WasiatApp.cetakPopup(w.document.title||'WASIAT');};}catch(e){}};p();setTimeout(p,300);setTimeout(p,1200);}}catch(e){}return w;};" +
            "})();";

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (Build.VERSION.SDK_INT >= 21) getWindow().setStatusBarColor(Color.parseColor("#0F5F5C"));
        Penjadwal.siapkanKanal(this);

        web = buatWebView(false);
        FrameLayout akar = new FrameLayout(this);
        akar.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(akar);

        if (b != null) web.restoreState(b);
        else web.loadUrl(alamatAwal(getIntent()));

        mintaIzinNotifikasi();
        tutupNotif(getIntent());
    }

    private String alamatAwal(Intent i) {
        String buka = i == null ? null : i.getStringExtra("buka");
        return buka != null ? SITUS + "?buka=" + Uri.encode(buka) : SITUS;
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        tutupNotif(i);
        String buka = i.getStringExtra("buka");
        if (buka != null && web != null) {
            web.evaluateJavascript("window.wasiatBuka?wasiatBuka('" + buka.replaceAll("[^a-z]", "") + "'):location.assign('" + SITUS + "?buka=" + buka.replaceAll("[^a-z]", "") + "')", null);
        }
    }

    private void tutupNotif(Intent i) {
        if (i == null) return;
        int id = i.getIntExtra("tutupNotif", 0);
        if (id != 0) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(id);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle b) {
        super.onSaveInstanceState(b);
        if (web != null) web.saveState(b);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.evaluateJavascript("window.wasiatSegarkanAlarm&&wasiatSegarkanAlarm()", null);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
        CookieManager.getInstance().flush();
    }

    private WebView buatWebView(final boolean popup) {
        final WebView w = new WebView(this);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(true);
        s.setAllowFileAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " WASIAT-Android/" + namaVersi());
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true);
        w.setBackgroundColor(Color.WHITE);
        w.addJavascriptInterface(new Jembatan(w), "WasiatApp");

        w.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return arahkan(v, r.getUrl(), popup);
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                v.evaluateJavascript(SHIM, null);
            }
        });

        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView v, int p) {
                if (p >= 80) v.evaluateJavascript(SHIM, null);
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams prm) {
                if (panggilBerkas != null) panggilBerkas.onReceiveValue(null);
                panggilBerkas = cb;
                try {
                    Intent i = prm.createIntent();
                    if (prm.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(Intent.createChooser(i, "Pilih berkas"), KODE_BERKAS);
                    return true;
                } catch (ActivityNotFoundException e) {
                    panggilBerkas = null;
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(final PermissionRequest req) {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        boolean kamera = false;
                        for (String r : req.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) kamera = true;
                        if (!kamera) { req.deny(); return; }
                        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                            req.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                        } else {
                            mintaKamera = req;
                            requestPermissions(new String[]{Manifest.permission.CAMERA}, KODE_IZIN);
                        }
                    }
                });
            }

            @Override
            public boolean onCreateWindow(WebView v, boolean dialog, boolean gestur, Message pesan) {
                bukaPopup();
                WebView.WebViewTransport t = (WebView.WebViewTransport) pesan.obj;
                t.setWebView(webPopup);
                pesan.sendToTarget();
                // document.write ke jendela baru tidak selalu memicu onPageFinished: suntik ulang
                for (int k = 1; k <= 6; k++) {
                    utama.postDelayed(new Runnable() {
                        @Override public void run() { if (webPopup != null) webPopup.evaluateJavascript(SHIM, null); }
                    }, k * 700L);
                }
                return true;
            }

            @Override
            public void onCloseWindow(WebView v) {
                tutupPopup();
            }
        });

        w.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String ua, String cd, String mime, long len) {
                if (url.startsWith("blob:") || url.startsWith("data:")) return; // ditangani SHIM
                try {
                    DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                    String nama = URLUtil.guessFileName(url, cd, mime);
                    r.setMimeType(mime);
                    r.addRequestHeader("User-Agent", ua);
                    String kuki = CookieManager.getInstance().getCookie(url);
                    if (kuki != null) r.addRequestHeader("Cookie", kuki);
                    r.setTitle(nama);
                    r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, nama);
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (dm != null) dm.enqueue(r);
                    Toast.makeText(MainActivity.this, "Mengunduh " + nama + "...", Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    bukaLuar(Uri.parse(url));
                }
            }
        });
        return w;
    }

    /** Situs WASIAT tetap di dalam aplikasi; tautan lain (WhatsApp, telepon, peta, dll.) dibuka aplikasi lain. */
    private boolean arahkan(WebView v, Uri u, boolean popup) {
        String skema = u.getScheme() == null ? "" : u.getScheme();
        if (("https".equals(skema) || "http".equals(skema)) && HOST.equals(u.getHost())) return false;
        if ("about".equals(skema) || "blob".equals(skema) || "data".equals(skema) || "javascript".equals(skema)) return false;
        bukaLuar(u);
        if (popup) tutupPopup();
        return true;
    }

    private void bukaLuar(Uri u) {
        try {
            Intent i;
            if ("intent".equals(u.getScheme())) i = Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME);
            else i = new Intent(Intent.ACTION_VIEW, u);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, "Tidak ada aplikasi untuk membuka tautan ini.", Toast.LENGTH_SHORT).show();
        }
    }

    private void bukaPopup() {
        tutupPopup();
        webPopup = buatWebView(true);
        dialogPopup = new Dialog(this, android.R.style.Theme_Material_Light_NoActionBar);
        dialogPopup.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialogPopup.setContentView(webPopup);
        dialogPopup.setOnKeyListener((d, kode, ev) -> {
            if (kode == KeyEvent.KEYCODE_BACK && ev.getAction() == KeyEvent.ACTION_UP) {
                if (webPopup != null && webPopup.canGoBack()) webPopup.goBack();
                else tutupPopup();
                return true;
            }
            return false;
        });
        dialogPopup.show();
    }

    private void tutupPopup() {
        if (dialogPopup != null) {
            try { dialogPopup.dismiss(); } catch (Exception ignored) {}
            dialogPopup = null;
        }
        if (webPopup != null) {
            try { webPopup.destroy(); } catch (Exception ignored) {}
            webPopup = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int kode, int hasil, Intent data) {
        if (kode == KODE_BERKAS) {
            if (panggilBerkas != null) {
                Uri[] hasilUri = null;
                if (hasil == RESULT_OK && data != null) {
                    if (data.getClipData() != null) {
                        int n = data.getClipData().getItemCount();
                        hasilUri = new Uri[n];
                        for (int i = 0; i < n; i++) hasilUri[i] = data.getClipData().getItemAt(i).getUri();
                    } else if (data.getData() != null) {
                        hasilUri = new Uri[]{data.getData()};
                    }
                }
                panggilBerkas.onReceiveValue(hasilUri);
                panggilBerkas = null;
            }
            return;
        }
        super.onActivityResult(kode, hasil, data);
    }

    @Override
    public void onRequestPermissionsResult(int kode, String[] izin, int[] hasil) {
        super.onRequestPermissionsResult(kode, izin, hasil);
        if (kode == KODE_IZIN && mintaKamera != null) {
            boolean ok = false;
            for (int i = 0; i < izin.length; i++) if (Manifest.permission.CAMERA.equals(izin[i]) && hasil[i] == PackageManager.PERMISSION_GRANTED) ok = true;
            if (ok) mintaKamera.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else mintaKamera.deny();
            mintaKamera = null;
        }
    }

    private void mintaIzinNotifikasi() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, KODE_IZIN + 1);
        }
    }

    String namaVersi() {
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            return pi.versionName;
        } catch (Exception e) { return "1.0"; }
    }

    long kodeVersi() {
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
        } catch (Exception e) { return 1; }
    }

    void cetakWebView(final WebView w, final String judul) {
        if (w == null) return;
        utama.postDelayed(new Runnable() {
            @Override public void run() {
                try {
                    PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                    String nama = (judul == null || judul.trim().isEmpty() ? "WASIAT" : judul.trim()).replaceAll("[\\\\/:*?\"<>|]", "-");
                    PrintDocumentAdapter ad = w.createPrintDocumentAdapter(nama);
                    if (pm != null) pm.print(nama, ad, new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Gagal membuka menu cetak: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
        }, 700);
    }

    void simpanKeUnduhan(String nama, String mime, byte[] isi) throws Exception {
        nama = nama.replaceAll("[\\\\/:*?\"<>|]", "-");
        Uri hasil = null;
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Downloads.DISPLAY_NAME, nama);
            cv.put(MediaStore.Downloads.MIME_TYPE, mime);
            cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            hasil = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
            if (hasil == null) throw new Exception("tidak bisa membuat berkas");
            OutputStream os = getContentResolver().openOutputStream(hasil);
            if (os == null) throw new Exception("tidak bisa menulis berkas");
            os.write(isi);
            os.close();
        } else {
            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, KODE_IZIN + 2);
                throw new Exception("izinkan penyimpanan lalu ulangi");
            }
            File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            if (!dir.exists()) dir.mkdirs();
            File f = new File(dir, nama);
            FileOutputStream fo = new FileOutputStream(f);
            fo.write(isi);
            fo.close();
        }
        final Uri bukaUri = hasil;
        final String namaAkhir = nama, mimeAkhir = mime;
        runOnUiThread(new Runnable() {
            @Override public void run() {
                Toast.makeText(MainActivity.this, "Tersimpan di folder Download: " + namaAkhir, Toast.LENGTH_LONG).show();
                if (bukaUri != null) {
                    try {
                        Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(bukaUri, mimeAkhir)
                                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                    } catch (Exception ignored) {}
                }
            }
        });
    }

    /** Fungsi yang bisa dipanggil halaman web: window.WasiatApp.* */
    class Jembatan {
        private final WebView milik;
        Jembatan(WebView w) { milik = w; }

        @JavascriptInterface public String versi() { return namaVersi(); }
        @JavascriptInterface public long versiKode() { return kodeVersi(); }

        @JavascriptInterface public void jadwalkan(String json) {
            Penjadwal.simpan(getApplicationContext(), json);
        }

        @JavascriptInterface public void hapusJadwal() {
            Penjadwal.hapusSemua(getApplicationContext());
        }

        @JavascriptInterface public String statusIzin() {
            return Penjadwal.statusIzinJson(getApplicationContext());
        }

        @JavascriptInterface public void tesAlarm(int detik) {
            Intent i = new Intent(getApplicationContext(), AlarmReceiver.class).putExtra("jenis", "tes");
            Penjadwal.pasang(getApplicationContext(), Penjadwal.ID_TES, System.currentTimeMillis() + Math.max(3, detik) * 1000L, i);
        }

        @JavascriptInterface public void bukaPengaturan(final String jenis) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    try {
                        Intent i;
                        if ("alarm".equals(jenis) && Build.VERSION.SDK_INT >= 31) {
                            i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName()));
                        } else if ("layar".equals(jenis) && Build.VERSION.SDK_INT >= 34) {
                            i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getPackageName()));
                        } else if ("baterai".equals(jenis)) {
                            i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()));
                        } else if ("notifikasi".equals(jenis) && Build.VERSION.SDK_INT >= 26) {
                            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                        } else {
                            i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
                        }
                        startActivity(i);
                    } catch (Exception e) {
                        try {
                            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
                        } catch (Exception ignored) {}
                    }
                }
            });
        }

        @JavascriptInterface public void simpanBerkas(String nama, String mime, String base64) {
            try {
                simpanKeUnduhan(nama == null || nama.isEmpty() ? "berkas" : nama, mime == null ? "application/octet-stream" : mime, Base64.decode(base64, Base64.DEFAULT));
            } catch (final Exception e) {
                runOnUiThread(new Runnable() {
                    @Override public void run() { Toast.makeText(MainActivity.this, "Gagal menyimpan: " + e.getMessage(), Toast.LENGTH_LONG).show(); }
                });
            }
        }

        @JavascriptInterface public void cetak(final String judul) {
            runOnUiThread(new Runnable() { @Override public void run() { cetakWebView(milik, judul); } });
        }

        @JavascriptInterface public void cetakPopup(final String judul) {
            runOnUiThread(new Runnable() { @Override public void run() { cetakWebView(webPopup != null ? webPopup : milik, judul); } });
        }

        @JavascriptInterface public void tutupJendela() {
            runOnUiThread(new Runnable() { @Override public void run() { if (milik == webPopup) tutupPopup(); } });
        }

        @JavascriptInterface public void bagikan(String teks) {
            Intent i = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, teks);
            Intent p = Intent.createChooser(i, "Bagikan");
            p.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(p);
        }
    }
}
