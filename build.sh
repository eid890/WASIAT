#!/bin/bash
# Script build WASIAT — jalankan sebelum push ke GitHub
# Otomatis update CACHE_VERSION di sw.js berdasarkan hash index.html

HASH=$(md5sum index.html | cut -c1-8)
DATE=$(date +%Y%m%d)
VERSION="wasiat-${DATE}-${HASH}"

# Update sw.js
sed -i "s/const CACHE_VERSION = 'wasiat-[^']*'/const CACHE_VERSION = '$VERSION'/" sw.js

echo "✅ Build selesai"
echo "   CACHE_VERSION = $VERSION"
echo "   Siap push ke GitHub"
