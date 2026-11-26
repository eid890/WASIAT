package id.ponpeswu.wasiat;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Alarm Android hilang saat HP dinyalakan ulang / jam diubah: pasang lagi dari jadwal tersimpan. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(final Context c, Intent i) {
        Penjadwal.jadwalkanUlang(c);
        final PendingResult hasil = goAsync();
        new Thread(new Runnable() {
            @Override public void run() {
                try { Penjadwal.segarkan(c); } finally { hasil.finish(); }
            }
        }).start();
    }
}
