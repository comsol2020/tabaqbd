#!/usr/bin/env bash
# /var/lib/osbdsyl জিপ করে একই ফাইলে লেখে।
# rclone-এ gdrive: রিমোট থাকলে Google Drive-এ osbdsyl-backup.zip রিরাইট হয়।
# /etc/osbdsyl.env এই জিপে যায় না।
# সময়সূচি: শুক্রবার ০২:০০ Asia/Dhaka (deploy/osbdsyl-backup.cron)।
set -euo pipefail

DATA_DIR=/var/lib/osbdsyl
OUT_DIR=/var/backups/osbdsyl
OUT="$OUT_DIR/osbdsyl-backup.zip"
REMOTE="${OSBDSYL_DRIVE_REMOTE:-gdrive:osbdsyl-backup.zip}"

install -d -m 700 "$OUT_DIR"

python3 - "$DATA_DIR" "$OUT" <<'PY'
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
tmp = out + ".tmp"
if os.path.exists(tmp):
    os.remove(tmp)
with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for root, _dirs, files in os.walk(src):
        for name in files:
            path = os.path.join(root, name)
            zf.write(path, os.path.relpath(path, src))
os.replace(tmp, out)
os.chmod(out, 0o600)
print(f"local backup written: {out}")
PY

if ! command -v rclone >/dev/null 2>&1; then
  echo "rclone নেই, ড্রাইভে পাঠানো হয়নি।"
  exit 0
fi
if ! rclone listremotes 2>/dev/null | grep -qx 'gdrive:'; then
  echo "gdrive রিমোট সেট নেই, ড্রাইভে পাঠানো হয়নি।"
  exit 0
fi
rclone copyto "$OUT" "$REMOTE" --drive-use-trash=false
echo "drive rewritten: $REMOTE"
