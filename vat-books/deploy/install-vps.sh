#!/usr/bin/env bash
# osbdsyl.online — Ubuntu VPS-এ ড্যাশবোর্ড বসায়।
# আবার চালালে কোড আপডেট হয়। /etc/osbdsyl.env ও /var/lib/osbdsyl মুছে না।
#
#   sudo OPERATOR_PIN='আপনারপিন' bash deploy/install-vps.sh
#
# আগে A রেকর্ড: osbdsyl.online এবং www.osbdsyl.online → এই সার্ভারের IP।
set -euo pipefail

DOMAIN=osbdsyl.online
APP_DIR=/opt/osbdsyl/vat-books
DATA_DIR=/var/lib/osbdsyl
ENV_FILE=/etc/osbdsyl.env
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  echo "root হিসেবে চালান: sudo OPERATOR_PIN='...' bash deploy/install-vps.sh" >&2
  exit 1
fi

if [[ ! -f /etc/os-release ]] || ! grep -qiE 'ubuntu|debian' /etc/os-release; then
  echo "এই স্ক্রিপ্ট Ubuntu বা Debian-এর জন্য।" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
rm -f /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg rsync ufw \
  fonts-noto-core fonts-liberation \
  debian-keyring debian-archive-keyring apt-transport-https

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const [M,m]=process.versions.node.split(".").map(Number); process.exit((M>22||(M===22&&m>=13))?0:1)'
}

if ! node_ok; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! node_ok; then
  echo "Node 22.13 বা তার উপর দরকার।" >&2
  exit 1
fi

if ! command -v google-chrome >/dev/null 2>&1 && ! command -v google-chrome-stable >/dev/null 2>&1; then
  curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/google-chrome.deb
  apt-get install -y /tmp/google-chrome.deb || apt-get install -y -f
  rm -f /tmp/google-chrome.deb
fi
CHROME="$(command -v google-chrome || command -v google-chrome-stable)"

if ! command -v caddy >/dev/null 2>&1; then
  curl -fsSL -o /usr/local/bin/caddy "https://caddyserver.com/api/download?os=linux&arch=amd64"
  chmod 755 /usr/local/bin/caddy
fi
if ! id caddy >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/caddy --create-home --shell /usr/sbin/nologin caddy
fi
install -d -o caddy -g caddy -m 755 /etc/caddy /var/lib/caddy
install -m 644 "$SRC/deploy/caddy.service" /etc/systemd/system/caddy.service

if ! id osbdsyl >/dev/null 2>&1; then
  useradd --system --home-dir /opt/osbdsyl --shell /usr/sbin/nologin osbdsyl
fi
install -d -o osbdsyl -g osbdsyl -m 750 "$DATA_DIR"
install -d -o root -g root -m 755 /opt/osbdsyl

src_real="$(cd "$SRC" && pwd -P)"
app_real=""
if [[ -d "$APP_DIR" ]]; then
  app_real="$(cd "$APP_DIR" && pwd -P)"
fi
if [[ "$src_real" != "$app_real" ]]; then
  rsync -a --delete \
    --exclude node_modules \
    --exclude data \
    --exclude .env \
    --exclude .env.local \
    "$SRC/" "$APP_DIR/"
fi

npm ci --prefix "$APP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -z "${OPERATOR_PIN:-}" ]]; then
    echo "OPERATOR_PIN সেট করে আবার চালান।" >&2
    exit 1
  fi
  if ((${#OPERATOR_PIN} < 4)) || [[ "$OPERATOR_PIN" == *$'\n'* ]]; then
    echo "OPERATOR_PIN অন্তত ৪ অক্ষর, এক লাইনে।" >&2
    exit 1
  fi
  umask 077
  {
    echo "HOST=127.0.0.1"
    echo "PORT=8080"
    echo "COOKIE_SECURE=1"
    echo "TRUST_PROXY=1"
    echo "VAT_DATA_DIR=${DATA_DIR}"
    echo "CHROME_PATH=${CHROME}"
    printf 'OPERATOR_PIN=%s\n' "$OPERATOR_PIN"
  } >"$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "অপারেটর পিন ${ENV_FILE}-এ লেখা হয়েছে। আবার দেখানো হবে না।"
else
  echo "${ENV_FILE} আগে থেকে আছে, পিন বদলানো হয়নি।"
fi

install -m 644 "$SRC/deploy/osbdsyl.service" /etc/systemd/system/osbdsyl.service
install -m 755 "$SRC/deploy/backup-friday.sh" /usr/local/sbin/osbdsyl-backup
install -m 644 "$SRC/deploy/osbdsyl-backup.service" /etc/systemd/system/osbdsyl-backup.service
install -m 644 "$SRC/deploy/osbdsyl-backup.timer" /etc/systemd/system/osbdsyl-backup.timer
systemctl daemon-reload
systemctl enable osbdsyl
systemctl restart osbdsyl
systemctl enable --now osbdsyl-backup.timer
if ! command -v rclone >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends rclone || echo "rclone ইনস্টল হয়নি। লোকাল ব্যাকআপ চলবে, ড্রাইভ পরে।"
fi

install -m 644 "$SRC/deploy/Caddyfile" /etc/caddy/Caddyfile
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
fi

ok=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:8080/health | grep -qx ok; then
    ok=1
    break
  fi
  sleep 1
done
if [[ "$ok" -ne 1 ]]; then
  echo "ড্যাশবোর্ড উঠেনি। journalctl -u osbdsyl -n 80" >&2
  exit 1
fi

public_ip="$(curl -4 -fsSL --max-time 8 https://ifconfig.me || true)"
dns_ip="$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}' || true)"
echo "সাইট লোকালে চলছে: http://127.0.0.1:8080/health"
echo "সার্ভারের IP: ${public_ip:-অজানা}"
echo "${DOMAIN} এর DNS: ${dns_ip:-এখনো নেই}"
if [[ -n "$public_ip" && "$public_ip" == "$dns_ip" ]]; then
  echo "DNS মিলেছে। https://${DOMAIN} খুলুন।"
else
  echo "A রেকর্ড ${DOMAIN} ও www.${DOMAIN} → ${public_ip:-এই সার্ভার} দিন। মিললে Caddy নিজে HTTPS সার্টিফিকেট নেবে।"
fi
