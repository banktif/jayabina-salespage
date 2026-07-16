#!/bin/bash
set -euo pipefail

OUT_DIR="admin-public"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

cp admin/index.html "$OUT_DIR/index.html"
cp theme.css admin-modern.css jc-api.js admin-favicon.svg admin-manifest.json "$OUT_DIR/"

# Security headers for the dedicated admin hostname.
cat > "$OUT_DIR/_headers" <<'EOF'
/*
  X-Robots-Tag: noindex, nofollow, noarchive
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/
  Cache-Control: no-store, max-age=0

/index.html
  Cache-Control: no-store, max-age=0

/*.html
  Cache-Control: no-store, max-age=0
EOF

echo "JAYABINA admin build ready: $OUT_DIR"
