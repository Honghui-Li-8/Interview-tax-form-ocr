#!/usr/bin/env bash
# Usage:
#   DOMAIN=yourdomain.com bash setup-deploy.sh          # with HTTPS
#   bash setup-deploy.sh                                 # HTTP only
#   START_STEP=3 DOMAIN=... bash setup-deploy.sh         # resume from step 3
#
# Run from the repo root. All steps are idempotent — safe to re-run.

set -euo pipefail

DOMAIN="${DOMAIN:-}"
START_STEP="${START_STEP:-1}"
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_USER="$(whoami)"
API_PORT=3001
TOTAL_STEPS=7

_step_num=0
_step_name="(init)"

# ── colors ────────────────────────────────────────────────────────────────────
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }

# ── error trap ────────────────────────────────────────────────────────────────
on_error() {
  red ""
  red "✗  Step $_step_num/$TOTAL_STEPS failed — $_step_name"
  red "   Failed command : $BASH_COMMAND"
  red "   Script line    : ${BASH_LINENO[0]}"
  echo ""
  echo "Fix the issue above, then resume from this step:"
  if [[ -n "$DOMAIN" ]]; then
    echo "  START_STEP=$_step_num DOMAIN=$DOMAIN bash setup-deploy.sh"
  else
    echo "  START_STEP=$_step_num bash setup-deploy.sh"
  fi
}
trap on_error ERR

# ── step runner ───────────────────────────────────────────────────────────────
run_step() {
  local num="$1" name="$2" fn="$3"
  _step_num=$num
  _step_name=$name
  if [[ $num -lt $START_STEP ]]; then
    yellow "  skip  step $num/$TOTAL_STEPS — $name"
    return 0
  fi
  green ""
  green "==> Step $num/$TOTAL_STEPS — $name"
  $fn
}

# ── step 1: env check ─────────────────────────────────────────────────────────
step_env_check() {
  if [[ ! -f "$REPO_ROOT/server/.env" ]]; then
    red "server/.env not found."
    echo "  cp server/.env.example server/.env"
    echo "  Fill in JWT_SECRET, MASTER_ENCRYPTION_KEY, AUTH_USERS, then re-run."
    exit 1
  fi
  green "  server/.env found"
}

# ── step 2: system deps ───────────────────────────────────────────────────────
step_system_deps() {
  sudo apt-get update -qq
  sudo apt-get install -y -qq nginx poppler-utils certbot python3-certbot-nginx

  if ! command -v node &>/dev/null || \
     [[ "$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')" -lt 20 ]]; then
    yellow "  Node.js 20 not found — installing"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
    sudo apt-get install -y -qq nodejs
  else
    green "  Node.js $(node --version) already installed"
  fi

  if ! command -v pm2 &>/dev/null; then
    yellow "  pm2 not found — installing"
    sudo npm install -g pm2 --quiet
  else
    green "  pm2 already installed"
  fi
}

# ── step 3: build server ──────────────────────────────────────────────────────
step_build_server() {
  cd "$REPO_ROOT/server"
  mkdir -p data
  npm install --silent
  npm run build
  green "  Server built → server/dist/"
}

# ── step 4: build frontend ────────────────────────────────────────────────────
step_build_frontend() {
  cd "$REPO_ROOT/web"
  npm install --silent

  # Use a relative URL so the browser calls /api/... on the same origin.
  # Nginx proxies /api to Express — no IP or domain needs to be hardcoded.
  if grep -q 'VITE_SERVER_URL' "$REPO_ROOT/web/.env" 2>/dev/null; then
    sed -i "s|VITE_SERVER_URL=.*|VITE_SERVER_URL=|" "$REPO_ROOT/web/.env"
  else
    echo "VITE_SERVER_URL=" >> "$REPO_ROOT/web/.env"
  fi

  npm run build
  green "  Frontend built → web/dist/ (relative API URLs via Nginx)"
}

# ── step 5: nginx config ──────────────────────────────────────────────────────
step_nginx() {
  # Nginx (www-data) needs execute permission on the home directory to traverse into web/dist
  chmod o+x "$HOME"

  # .mjs files must be served as text/javascript for ES module scripts
  sudo sed -i 's/text\/javascript\s*js;/text\/javascript js mjs;/' /etc/nginx/mime.types
  local conf="/etc/nginx/sites-available/tax-ocr"

  # Self-signed cert for HTTPS when no domain is provided.
  # Certbot (step 7) replaces this if DOMAIN is set.
  if [[ ! -f /etc/ssl/certs/tax-ocr.crt ]]; then
    local cn="${DOMAIN:-$(hostname -I | awk '{print $1}')}"
    sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout /etc/ssl/private/tax-ocr.key \
      -out /etc/ssl/certs/tax-ocr.crt \
      -subj "/CN=$cn" 2>/dev/null
    green "  Self-signed certificate generated (CN=$cn)"
  fi

  sudo tee "$conf" > /dev/null <<NGINX
server {
    listen 443 ssl;
    listen 80;
    server_name ${DOMAIN:-_};

    ssl_certificate     /etc/ssl/certs/tax-ocr.crt;
    ssl_certificate_key /etc/ssl/private/tax-ocr.key;

    root $REPO_ROOT/web/dist;
    index index.html;

    location ~* \.mjs$ {
        types { text/javascript mjs; }
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass         http://127.0.0.1:${API_PORT}/api/;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout    900s;
        proxy_connect_timeout 900s;
        proxy_send_timeout    900s;
    }
}
NGINX

  sudo ln -sf "$conf" /etc/nginx/sites-enabled/tax-ocr
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t
  sudo systemctl reload nginx
  green "  Nginx configured and reloaded"
}

# ── step 6: pm2 ───────────────────────────────────────────────────────────────
step_pm2() {
  cd "$REPO_ROOT/server"
  if pm2 describe api &>/dev/null; then
    pm2 restart api
    green "  API restarted"
  else
    pm2 start npm --name api -- run start
    green "  API started"
  fi
  pm2 save

  STARTUP_CMD="$(sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp "$HOME" | grep 'sudo' || true)"
  if [[ -n "$STARTUP_CMD" ]]; then
    eval "$STARTUP_CMD"
    green "  pm2 hooked into systemd (survives reboot)"
  fi
}

# ── step 7: https ─────────────────────────────────────────────────────────────
step_https() {
  if [[ -z "$DOMAIN" ]]; then
    yellow "  No DOMAIN set — skipping Certbot"
    return 0
  fi
  sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
    --email "admin@$DOMAIN" --redirect
  green "  Certificate issued — HTTPS active"
}

# ── run all steps ─────────────────────────────────────────────────────────────
run_step 1 "Check environment"    step_env_check
run_step 2 "Install system deps"  step_system_deps
run_step 3 "Build server"         step_build_server
run_step 4 "Build frontend"       step_build_frontend
run_step 5 "Configure Nginx"      step_nginx
run_step 6 "Start API with pm2"   step_pm2
run_step 7 "Enable HTTPS"         step_https

# ── done ──────────────────────────────────────────────────────────────────────
green ""
green "✓  All $TOTAL_STEPS steps complete"
echo ""
echo "Verify:"
echo "  pm2 status"
echo "  curl localhost/health"
if [[ -n "$DOMAIN" ]]; then
  echo "  open https://$DOMAIN"
else
  echo "  open http://<your-ec2-ip>"
fi
