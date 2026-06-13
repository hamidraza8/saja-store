# SAJA Store — Self-Hosted E-Commerce

Your own store, fully owned: Node.js + Express + SQLite (Node's built-in driver — zero native dependencies). Storefront, customizer with made-to-measure orders, server-side pricing, COD & bank-transfer payments working today, card gateways ready to activate, and an admin panel.

## Run locally
```bash
npm install
cp .env.example .env        # then edit: set a strong ADMIN_KEY + your WhatsApp number
ADMIN_KEY=your-long-key WHATSAPP_NUMBER=9715XXXXXXX node src/server.js
# Store:  http://localhost:3000
# Admin:  http://localhost:3000/admin  (enter your ADMIN_KEY)
```
Products auto-seed from `data/products.json` on first boot. Edit that file (or the DB) to change the catalog; delete `data/saja.db` and restart to re-seed.

## What's implemented
- **Catalog API** — `GET /api/products`, single product, store config.
- **Server-side pricing** — the client never sets prices. `POST /api/orders/quote`
  validates every fabric/colour/size against the catalog, prices in AED, converts
  to PKR for Pakistan, applies promo codes (`SAJA20`, `EID15` — edit in
  `src/server.js`), and adds COD fees (AED 10 / PKR 200).
- **Orders** — `POST /api/orders` creates the order with measurement validation
  for custom pieces (shoulder/bust/sleeve/length required, sane ranges).
- **Customer lookup** — `GET /api/orders/:no?phone=…` requires the matching
  phone's last 7 digits — no enumeration of other people's orders.
- **Admin** — `/admin` panel + `GET/PATCH /api/admin/orders` guarded by the
  `x-admin-key` header. Statuses: new → confirmed → stitching → qc → shipped →
  delivered (or cancelled). Payment states: pending/paid/failed/refunded.
- **Payments** (`src/payments/index.js`) — `cod` and `bank` work now; `telr`
  (UAE cards) and `jazzcash` (PK) are documented adapters: they appear in
  checkout automatically once their env vars are set and the TODOs are wired.

## Deploy (pick one)
**Railway / Render (easiest):** push this folder to a GitHub repo → create a
service from it → set env vars (`ADMIN_KEY`, `WHATSAPP_NUMBER`, `PORT` if asked)
→ attach a persistent disk/volume mounted at `data/` so the SQLite file survives
deploys → point `sajaatelier.com` / `saja.pk` at it.

**VPS (most control, ~$5/mo):** Ubuntu server → install Node 22 → clone the
project → `npm install` → run with a process manager (`systemd` or `pm2`) →
put Nginx or Caddy in front for HTTPS (Caddy does certificates automatically).

Either way: **HTTPS is mandatory before taking real customer data.**

## Activating card payments (when merchant accounts are approved)
1. **Telr (UAE):** fill `TELR_STORE_ID` / `TELR_AUTH_KEY` in `.env`, then in
   `src/payments/index.js` implement the `initiate()` TODO: create the hosted
   order via Telr's API, return its redirect URL, and add a webhook route that
   verifies the result and calls `db.setPayment(order_no,'paid',ref)`.
2. **JazzCash (PK):** same pattern with the `pp_*` fields and the
   HMAC-SHA256 `pp_SecureHash` using your integrity salt. Test on
   sandbox.jazzcash.com.pk first.
3. Stripe UAE can replace Telr with the same adapter shape if you prefer.
The checkout UI picks up newly-available methods automatically from
`/api/config` — no frontend changes needed.

## Security checklist before going live
- [ ] Strong random `ADMIN_KEY` (the server refuses admin access on the default)
- [ ] HTTPS everywhere; never serve checkout over http
- [ ] Back up `data/saja.db` daily (it's a single file — copy it somewhere safe)
- [ ] Add rate limiting (e.g. `express-rate-limit`) on `/api/orders` before ads
- [ ] Keep promo codes & the PKR rate (`src/payments/index.js`) current
- [ ] Replace Pexels placeholder photos with your own faceless shoot

## Roadmap when volume grows
SQLite happily handles your first thousands of orders. When you outgrow it:
swap `src/db.js` for Postgres (the module's function signatures are the
contract — nothing else changes), add email/WhatsApp notifications on status
change, and an inventory counter for Essentials.
