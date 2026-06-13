#!/bin/bash
# SAJA Store — First-time VPS setup script
# Run on the Hetzner VPS as root:
#   curl -sL <raw-github-url>/deployment/setup-vps.sh | bash
# Or copy it over and run: bash /opt/saja-store/deployment/setup-vps.sh
#
# Prerequisites:
#   - DNS A record: saja.torin.pk → 91.99.20.199 (must be live before running)
#   - Docker & Docker Compose already installed (from tailor-application)

set -e

echo "=== SAJA Store — VPS Setup ==="

# ---- 1. Shared Docker network ----
if ! docker network inspect web >/dev/null 2>&1; then
  echo "Creating shared 'web' Docker network..."
  docker network create web
else
  echo "Shared 'web' network already exists."
fi

# ---- 2. Install Certbot if missing ----
if ! command -v certbot &>/dev/null; then
  echo "Installing Certbot..."
  apt-get update -qq
  apt-get install -y -qq certbot
fi

# ---- 3. SSL certificate via Let's Encrypt ----
# Stop nginx temporarily so certbot can bind to port 80 (standalone mode)
echo "Obtaining SSL certificate for saja.torin.pk..."
echo "(Nginx will be stopped briefly for verification)"

# Stop the tailor nginx if running
docker compose -f /opt/tailor-application/deployment/docker-compose.yml stop nginx 2>/dev/null || true

certbot certonly --standalone \
  -d saja.torin.pk \
  --non-interactive \
  --agree-tos \
  --email "${CERT_EMAIL:-admin@torin.pk}" \
  --cert-name saja.torin.pk

# Also renew/get torin.pk cert if it doesn't exist in certbot yet
if [ ! -d /etc/letsencrypt/live/torin.pk ]; then
  echo "Also obtaining cert for torin.pk + www.torin.pk..."
  certbot certonly --standalone \
    -d torin.pk -d www.torin.pk \
    --non-interactive \
    --agree-tos \
    --email "${CERT_EMAIL:-admin@torin.pk}" \
    --cert-name torin.pk
fi

# ---- 4. Symlink certs to the paths nginx expects ----
echo "Linking certificates..."

# SAJA cert
ln -sf /etc/letsencrypt/live/saja.torin.pk/fullchain.pem /etc/ssl/certs/saja.torin.pk.crt
ln -sf /etc/letsencrypt/live/saja.torin.pk/privkey.pem /etc/ssl/private/saja.torin.pk.key

# Torin cert (update if now managed by certbot)
if [ -d /etc/letsencrypt/live/torin.pk ]; then
  ln -sf /etc/letsencrypt/live/torin.pk/fullchain.pem /etc/ssl/certs/torin.pk.crt
  ln -sf /etc/letsencrypt/live/torin.pk/privkey.pem /etc/ssl/private/torin.pk.key
fi

# ---- 5. Setup auto-renewal cron ----
if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
  echo "Adding certbot auto-renewal cron..."
  (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --pre-hook 'docker compose -f /opt/tailor-application/deployment/docker-compose.yml stop nginx' --post-hook 'docker compose -f /opt/tailor-application/deployment/docker-compose.yml start nginx' --quiet") | crontab -
fi

# ---- 6. Setup SAJA project directory ----
echo "Setting up SAJA store..."
mkdir -p /opt/saja-store
cd /opt/saja-store

if [ ! -f deployment/.env ]; then
  echo "Creating .env from template..."
  mkdir -p deployment
  if [ -f deployment/.env.example ]; then
    cp deployment/.env.example deployment/.env
  else
    cat > deployment/.env <<'ENVEOF'
ADMIN_KEY=change-me-to-a-long-random-string
WHATSAPP_NUMBER=9715XXXXXXXX
ENVEOF
  fi
  echo ""
  echo "!!! IMPORTANT: Edit /opt/saja-store/deployment/.env with your real values !!!"
  echo "    nano /opt/saja-store/deployment/.env"
  echo ""
fi

# ---- 7. Add SAJA backup to cron ----
if ! crontab -l 2>/dev/null | grep -q "saja-store"; then
  echo "Adding daily SAJA backup cron (2:30 AM)..."
  (crontab -l 2>/dev/null; echo "30 2 * * * cd /opt/saja-store && node scripts/backup-db.js >> /var/log/saja-backup.log 2>&1") | crontab -
fi

# ---- 8. Restart tailor nginx (picks up new config + certs) ----
echo "Restarting tailor nginx with updated config..."
cd /opt/tailor-application/deployment
docker compose up -d nginx

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit /opt/saja-store/deployment/.env (set ADMIN_KEY)"
echo "  2. Clone your SAJA repo to /opt/saja-store (or git init + remote add)"
echo "  3. cd /opt/saja-store/deployment && docker compose up -d --build"
echo "  4. Visit https://saja.torin.pk"
echo ""
