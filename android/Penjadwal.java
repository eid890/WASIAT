package id.ponpeswu.wasiat;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;

/**
 * Menyimpan jadwal mengajar guru dan memasang alarm di HP:
 *  - "sebelum": X menit sebelum jam mengajar dimulai (bawaan 10 menit)
 *  - "telat"  : Y menit setelah jam mengajar dimulai bila absen belum diisi (bawaan 35 menit);
 *               tepat sebelum berbunyi, status absen dicek ulang ke server WASIAT.
 *  - "segarkan": memperbarui jadwal dari server setiap hari pukul 05.00.
 */
public final class Penjadwal {
    static final String PREF = "wasiat_alarm";
    static final String KANAL_ALARM = "alarm_mengajar_v1";
    static final String KANAL_INFO = "info_wasiat_v1";
    static final int ID_SEGARKAN = 990001;
    static final int ID_TES = 990002;

    private Penjadwal() {}

    static SharedPreferences pref(Context c) {
        return c.getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    /** Dipanggil dari halaman web (WasiatApp.jadwalkan) atau setelah menyegarkan dari server. */
    static synchronized void simpan(Context c, String json) {
        try {
            JSONObject o = new JSONObject(json);
            SharedPreferences.Editor e = pref(c).edit();
            if (o.has("url")) e.putString("url", o.optString("url"));
            if (o.has("token")) e.putString("token", o.optString("token"));
            if (o.has("nama")) e.putString("nama", o.optString("nama"));
            e.putInt("menitSebelum", o.optInt("menitSebelum", pref(c).getInt("menitSebelum", 10)));
            e.putInt("menitTelat", o.optInt("menitTelat", pref(c).getInt("menitTelat", 35)));
            if (o.has("sesi")) e.putString("sesi", o.getJSONArray("sesi").toString());
            e.putLong("diperbarui", System.currentTimeMillis());
            e.apply();
        } catch (Exception ignored) {}
        jadwalkanUlang(c);
    }

    static synchronized void hapusSemua(Context c) {
        batalkanSemua(c);
        pref(c).edit().clear().apply();
    }

    private static void batalkanSemua(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        String kode = pref(c).getString("kode", "");
        if (am != null && kode.length() > 0) {
            for (String k : kode.split(",")) {
                try {
                    int id = Integer.parseInt(k);
                    am.cancel(pi(c, id, new Intent(c, AlarmReceiver.class)));
                } catch (Exception ignored) {}
            }
        }
        pref(c).edit().putString("kode", "").apply();
    }

    static PendingIntent pi(Context c, int kode, Intent i) {
        return PendingIntent.getBroadcast(c, kode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Memasang ulang semua alarm dari jadwal yang tersimpan. */
    static synchronized void jadwalkanUlang(Context c) {
        batalkanSemua(c);
        SharedPreferences p = pref(c);
        if (p.getString("token", "").length() == 0) return;
        int sebelum = p.getInt("menitSebelum", 10), telat = p.getInt("menitTelat", 35);
        long kini = System.currentTimeMillis();
        StringBuilder kode = new StringBuilder();
        try {
            JSONArray arr = new JSONArray(p.getString("sesi", "[]"));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject s = arr.getJSONObject(i);
                long mulai = s.optLong("mulai", 0);
                if (mulai <= 0) continue;
                String id = s.optString("id");
                long tA = mulai - sebelum * 60000L, tB = mulai + telat * 60000L;
                if (tA > kini) {
                    int k = (id + "|sebelum").hashCode();
                    pasang(c, k, tA, niat(c, "sebelum", s, sebelum, telat));
                    kode.append(k).append(',');
                }
                if (tB > kini && !s.optBoolean("sudahAbsen", false)) {
                    int k = (id + "|telat").hashCode();
                    pasang(c, k, tB, niat(c, "telat", s, sebelum, telat));
                    kode.append(k).append(',');
                }
            }
        } catch (Exception ignored) {}
        // Penyegaran harian pukul 05.00 (atau 2 jam lagi bila belum pernah berhasil)
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, 5);
        cal.set(Calendar.MINUTE, 0);
        cal.set(Calendar.SECOND, 0);
        if (cal.getTimeInMillis() <= kini) cal.add(Calendar.DAY_OF_YEAR, 1);
        Intent seg = new Intent(c, AlarmReceiver.class).putExtra("jenis", "segarkan");
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi(c, ID_SEGARKAN, seg));
            kode.append(ID_SEGARKAN).append(',');
        }
        p.edit().putString("kode", kode.toString()).apply();
    }

    private static Intent niat(Context c, String jenis, JSONObject s, int sebelum, int telat) {
        return new Intent(c, AlarmReceiver.class)
                .putExtra("jenis", jenis)
                .putExtra("id", s.optString("id"))
                .putExtra("mapel", s.optString("mapel"))
                .putExtra("kelas", s.optString("kelas"))
                .putExtra("jam", s.optString("jam"))
                .putExtra("jamKe", s.optString("jamKe"))
                .putExtra("menitSebelum", sebelum)
                .putExtra("menitTelat", telat);
    }

    static void pasang(Context c, int kode, long waktu, Intent i) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent p = pi(c, kode, i);
        try {
            // setAlarmClock = jenis alarm paling andal (tetap berbunyi saat HP mode hemat daya)
            Intent buka = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent tampil = PendingIntent.getActivity(c, 1, buka, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            if (bolehAlarmTepat(c)) {
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(waktu, tampil), p);
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, waktu, p);
            }
        } catch (SecurityException se) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, waktu, p);
        }
    }

    static boolean bolehAlarmTepat(Context c) {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    // ---------------- Notifikasi ----------------

    static void siapkanKanal(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(KANAL_ALARM) == null) {
            NotificationChannel k = new NotificationChannel(KANAL_ALARM, "Alarm jam mengajar", NotificationManager.IMPORTANCE_HIGH);
            k.setDescription("Peringatan 10 menit sebelum mengajar dan pengingat bila absen belum diisi");
            Uri bunyi = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (bunyi == null) bunyi = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            k.setSound(bunyi, new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            k.enableVibration(true);
            k.setVibrationPattern(new long[]{0, 800, 400, 800, 400, 800});
            k.enableLights(true);
            k.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            k.setBypassDnd(true);
            nm.createNotificationChannel(k);
        }
        if (nm.getNotificationChannel(KANAL_INFO) == null) {
            NotificationChannel k = new NotificationChannel(KANAL_INFO, "Info WASIAT", NotificationManager.IMPORTANCE_DEFAULT);
            nm.createNotificationChannel(k);
        }
    }

    /** Notifikasi gaya alarm: bunyi alarm berulang sampai disentuh, muncul di layar kunci. */
    static void tampilkanAlarm(Context c, int idNotif, String judul, String isi, String jenis) {
        siapkanKanal(c);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        Intent buka = new Intent(c, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra("buka", "jadwal")
                .putExtra("tutupNotif", idNotif);
        PendingIntent piBuka = PendingIntent.getActivity(c, idNotif, buka, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent layar = new Intent(c, AlarmActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION)
                .putExtra("judul", judul).putExtra("isi", isi).putExtra("jenis", jenis).putExtra("idNotif", idNotif);
        PendingIntent piLayar = PendingIntent.getActivity(c, idNotif + 1, layar, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent tutup = new Intent(c, AlarmReceiver.class).putExtra("jenis", "tutup").putExtra("idNotif", idNotif);
        PendingIntent piTutup = pi(c, idNotif + 2, tutup);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, KANAL_ALARM) : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_notif)
                .setContentTitle(judul)
                .setContentText(isi)
                .setStyle(new Notification.BigTextStyle().bigText(isi))
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setColor(0xFF0F5F5C)
                .setContentIntent(piBuka)
                .setFullScreenIntent(piLayar, true)
                .addAction(new Notification.Action.Builder(null, "jadwal".equals(jenis) ? "Buka" : "Isi Absen", piBuka).build())
                .addAction(new Notification.Action.Builder(null, "Tutup", piTutup).build());
        if (Build.VERSION.SDK_INT >= 26) {
            b.setTimeoutAfter(5 * 60 * 1000L); // bunyi berhenti sendiri setelah 5 menit
        } else {
            Uri bunyi = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            b.setPriority(Notification.PRIORITY_MAX)
                    .setSound(bunyi, android.media.AudioManager.STREAM_ALARM)
                    .setVibrate(new long[]{0, 800, 400, 800, 400, 800});
        }
        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT; // bunyi berulang seperti alarm
        try {
            nm.notify(idNotif, n);
        } catch (SecurityException ignored) {}
    }

    static void tampilkanInfo(Context c, int idNotif, String judul, String isi) {
        siapkanKanal(c);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        Intent buka = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent piBuka = PendingIntent.getActivity(c, idNotif, buka, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, KANAL_INFO) : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_notif).setContentTitle(judul).setContentText(isi)
                .setStyle(new Notification.BigTextStyle().bigText(isi)).setAutoCancel(true).setContentIntent(piBuka);
        try { nm.notify(idNotif, b.build()); } catch (SecurityException ignored) {}
    }

    // ---------------- Server WASIAT ----------------

    /** Meminta jadwal terbaru ke server. Mengembalikan objek "data" atau null bila gagal. */
    static JSONObject mintaJadwal(Context c, int hari) {
        SharedPreferences p = pref(c);
        String url = p.getString("url", ""), token = p.getString("token", "");
        if (url.length() == 0 || token.length() == 0) return null;
        HttpURLConnection k = null;
        try {
            JSONObject badan = new JSONObject();
            badan.put("modul", "premium");
            badan.put("action", "getJadwalAlarmGuru");
            badan.put("payload", new JSONObject().put("hari", hari));
            badan.put("token", token);
            k = (HttpURLConnection) new URL(url).openConnection();
            k.setInstanceFollowRedirects(true);
            k.setConnectTimeout(8000);
            k.setReadTimeout(15000);
            k.setRequestMethod("POST");
            k.setDoOutput(true);
            k.setRequestProperty("Content-Type", "text/plain;charset=utf-8");
            byte[] isi = badan.toString().getBytes(StandardCharsets.UTF_8);
            OutputStream os = k.getOutputStream();
            os.write(isi);
            os.close();
            int kodeHttp = k.getResponseCode();
            // Apps Script menjawab dengan pengalihan 302 ke googleusercontent; ikuti manual bila perlu
            if (kodeHttp >= 300 && kodeHttp < 400) {
                String lok = k.getHeaderField("Location");
                k.disconnect();
                if (lok == null) return null;
                k = (HttpURLConnection) new URL(lok).openConnection();
                k.setConnectTimeout(8000);
                k.setReadTimeout(15000);
                kodeHttp = k.getResponseCode();
            }
            if (kodeHttp != 200) return null;
            InputStream in = k.getInputStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            int n;
            while ((n = in.read(b)) > 0) buf.write(b, 0, n);
            in.close();
            JSONObject j = new JSONObject(new String(buf.toByteArray(), StandardCharsets.UTF_8));
            if (!j.optBoolean("ok")) {
                if (j.optBoolean("perluLogin")) p.edit().putBoolean("perluLogin", true).apply();
                return null;
            }
            return j.optJSONObject("data");
        } catch (Exception e) {
            return null;
        } finally {
            if (k != null) k.disconnect();
        }
    }

    /** Menyegarkan jadwal 7 hari dari server lalu memasang ulang alarm. */
    static boolean segarkan(Context c) {
        JSONObject d = mintaJadwal(c, 7);
        if (d == null) { jadwalkanUlang(c); return false; }
        try {
            JSONObject simpan = new JSONObject();
            simpan.put("menitSebelum", d.optInt("menitSebelum", 10));
            simpan.put("menitTelat", d.optInt("menitTelat", 35));
            simpan.put("sesi", d.optJSONArray("sesi") != null ? d.optJSONArray("sesi") : new JSONArray());
            simpan(c, simpan.toString());
            return true;
        } catch (Exception e) {
            jadwalkanUlang(c);
            return false;
        }
    }

    /**
     * Apakah sesi ini sudah diabsen? TRUE = sudah / tidak perlu (izin, libur, digantikan),
     * FALSE = belum, null = tidak bisa dicek (tidak ada internet).
     */
    static Boolean sudahAbsen(Context c, String id) {
        JSONObject d = mintaJadwal(c, 1);
        if (d == null) return null;
        JSONArray arr = d.optJSONArray("sesi");
        if (arr == null) return Boolean.TRUE;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject s = arr.optJSONObject(i);
            if (s != null && id.equals(s.optString("id"))) return s.optBoolean("sudahAbsen", false);
        }
        return Boolean.TRUE; // sesi tidak ada lagi (izin disetujui, libur, atau digantikan)
    }

    static String statusIzinJson(Context c) {
        try {
            JSONObject o = new JSONObject();
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            o.put("notifikasi", nm == null || nm.areNotificationsEnabled());
            o.put("alarmTepat", bolehAlarmTepat(c));
            boolean layar = true;
            if (Build.VERSION.SDK_INT >= 34 && nm != null) layar = nm.canUseFullScreenIntent();
            o.put("layarPenuh", layar);
            boolean baterai = true;
            if (Build.VERSION.SDK_INT >= 23) {
                android.os.PowerManager pm = (android.os.PowerManager) c.getSystemService(Context.POWER_SERVICE);
                baterai = pm == null || pm.isIgnoringBatteryOptimizations(c.getPackageName());
            }
            o.put("baterai", baterai);
            SharedPreferences p = pref(c);
            o.put("jumlahSesi", new JSONArray(p.getString("sesi", "[]")).length());
            o.put("diperbarui", p.getLong("diperbarui", 0));
            o.put("menitSebelum", p.getInt("menitSebelum", 10));
            o.put("menitTelat", p.getInt("menitTelat", 35));
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }
}
