package id.ponpeswu.wasiat;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Menerima alarm yang dipasang Penjadwal dan menampilkan peringatan. */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(final Context c, final Intent i) {
        final String jenis = i.getStringExtra("jenis");
        if (jenis == null) return;
        final String mapel = nz(i.getStringExtra("mapel")), kelas = nz(i.getStringExtra("kelas")),
                jam = nz(i.getStringExtra("jam")), id = nz(i.getStringExtra("id"));
        final int idNotif = id.length() > 0 ? Math.abs((id + jenis).hashCode()) % 900000 : 1;
        final String sesi = mapel + (kelas.length() > 0 ? " · Kelas " + kelas : "") + (jam.length() > 0 ? " · pukul " + jam : "");

        switch (jenis) {
            case "sebelum": {
                int m = i.getIntExtra("menitSebelum", 10);
                Penjadwal.tampilkanAlarm(c, idNotif, "⏰ " + m + " menit lagi jam mengajar",
                        sesi + "\nBersiaplah menuju kelas. Jangan lupa mengisi absen setelah masuk kelas.", "sebelum");
                break;
            }
            case "telat": {
                final int m = i.getIntExtra("menitTelat", 35);
                final PendingResult hasil = goAsync();
                new Thread(new Runnable() {
                    @Override public void run() {
                        try {
                            Boolean sudah = Penjadwal.sudahAbsen(c, id);
                            if (!Boolean.TRUE.equals(sudah)) {
                                String isi = "Sudah " + m + " menit sejak " + sesi + " dimulai, tetapi absen sesi ini belum diisi. Segera isi absensinya."
                                        + (sudah == null ? "\n(Tidak dapat memastikan ke server. Abaikan bila sudah mengisi.)" : "");
                                Penjadwal.tampilkanAlarm(c, idNotif, "⚠️ Absen belum diisi", isi, "telat");
                            }
                        } finally {
                            hasil.finish();
                        }
                    }
                }).start();
                break;
            }
            case "segarkan": {
                final PendingResult hasil = goAsync();
                new Thread(new Runnable() {
                    @Override public void run() {
                        try { Penjadwal.segarkan(c); } finally { hasil.finish(); }
                    }
                }).start();
                break;
            }
            case "tes": {
                Penjadwal.tampilkanAlarm(c, Penjadwal.ID_TES, "⏰ Tes alarm WASIAT",
                        "Alarm berfungsi. Seperti inilah peringatan 10 menit sebelum jam mengajar dan pengingat absen.", "jadwal");
                break;
            }
            case "tutup": {
                NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) nm.cancel(i.getIntExtra("idNotif", 0));
                break;
            }
            default:
                break;
        }
    }

    private static String nz(String s) { return s == null ? "" : s; }
}
