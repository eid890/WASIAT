package id.ponpeswu.wasiat;

import android.app.Activity;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Layar penuh saat alarm berbunyi (juga di atas layar kunci). */
public class AlarmActivity extends Activity {
    private int idNotif;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        Intent i = getIntent();
        idNotif = i.getIntExtra("idNotif", 0);
        String judul = i.getStringExtra("judul"), isi = i.getStringExtra("isi"), jenis = i.getStringExtra("jenis");

        LinearLayout akar = new LinearLayout(this);
        akar.setOrientation(LinearLayout.VERTICAL);
        akar.setGravity(Gravity.CENTER);
        akar.setBackgroundColor(Color.parseColor("telat".equals(jenis) ? "#7F1D1D" : "#0F5F5C"));
        int p = dp(28);
        akar.setPadding(p, p, p, p);

        TextView ikon = new TextView(this);
        ikon.setText("telat".equals(jenis) ? "⚠️" : "⏰");
        ikon.setTextSize(TypedValue.COMPLEX_UNIT_SP, 64);
        ikon.setGravity(Gravity.CENTER);
        akar.addView(ikon);

        TextView tJudul = new TextView(this);
        tJudul.setText(judul == null ? "WASIAT" : judul);
        tJudul.setTextColor(Color.WHITE);
        tJudul.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
        tJudul.setTypeface(Typeface.DEFAULT_BOLD);
        tJudul.setGravity(Gravity.CENTER);
        tJudul.setPadding(0, dp(16), 0, dp(12));
        akar.addView(tJudul);

        TextView tIsi = new TextView(this);
        tIsi.setText(isi == null ? "" : isi);
        tIsi.setTextColor(Color.parseColor("#F1F5F9"));
        tIsi.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        tIsi.setGravity(Gravity.CENTER);
        tIsi.setLineSpacing(0, 1.2f);
        akar.addView(tIsi);

        Button bBuka = tombol("telat".equals(jenis) || "sebelum".equals(jenis) ? "Buka WASIAT & isi absen" : "Buka WASIAT", "#FBBF24", "#1F2937");
        bBuka.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                matikan();
                startActivity(new Intent(AlarmActivity.this, MainActivity.class)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                        .putExtra("buka", "jadwal"));
                finish();
            }
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56));
        lp.topMargin = dp(36);
        akar.addView(bBuka, lp);

        Button bTutup = tombol("Tutup", "#FFFFFF", "#0F172A");
        bTutup.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { matikan(); finish(); }
        });
        LinearLayout.LayoutParams lp2 = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52));
        lp2.topMargin = dp(12);
        akar.addView(bTutup, lp2);

        setContentView(akar);
    }

    private Button tombol(String teks, String latar, String warna) {
        Button b = new Button(this);
        b.setText(teks);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(Color.parseColor(warna));
        GradientDrawable g = new GradientDrawable();
        g.setColor(Color.parseColor(latar));
        g.setCornerRadius(dp(14));
        b.setBackground(g);
        return b;
    }

    private void matikan() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && idNotif != 0) nm.cancel(idNotif);
    }

    @Override
    public void onBackPressed() {
        matikan();
        super.onBackPressed();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
