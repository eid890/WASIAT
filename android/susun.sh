#!/bin/bash
# Menyusun berkas sumber Android (disimpan rata di folder android/) menjadi proyek Gradle.
# Dipakai oleh GitHub Actions (.github/workflows/apk.yml). Argumen: folder tujuan.
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-build-android}"
rm -rf "$OUT"
PKG="$OUT/app/src/main/java/id/ponpeswu/wasiat"
mkdir -p "$PKG" "$OUT/app/src/main/res/drawable"
cp "$SRC/settings.gradle" "$SRC/build.gradle" "$SRC/gradle.properties" "$OUT/"
cp "$SRC/app.build.gradle" "$OUT/app/build.gradle"
cp "$SRC/AndroidManifest.xml" "$OUT/app/src/main/AndroidManifest.xml"
cp "$SRC"/*.java "$PKG/"
cp "$SRC/ic_notif.xml" "$OUT/app/src/main/res/drawable/ic_notif.xml"
for d in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  mkdir -p "$OUT/app/src/main/res/mipmap-$d"
  cp "$SRC/ic_launcher_$d.png" "$OUT/app/src/main/res/mipmap-$d/ic_launcher.png"
done
echo "Proyek Android disusun di $OUT"
