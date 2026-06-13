// src/server.js — SAJA store server
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { providers, PKR_PER_AED } = require('./payments');
const { notify } = require('./notify');

const app = express();
app.use(helmet({ contentSecurityPolicy: false })); // CSP off — inline scripts in storefront
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rate limiting — tighter on order creation, moderate on quotes
const orderLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many orders, please try again later.' } });
const quoteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, message: { error: 'Too many requests, please slow down.' } });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, message: { error: 'Rate limit exceeded.' } });

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';
const CUSTOM_FEE_AED = 60;
const PROMOS = { SAJA20: 0.2, EID15: 0.15 };

// Seed products on first boot
if (db.listProducts().length === 0) db.seed();

// ----------------------------------------------------------- public API
app.use('/api/', apiLimiter);
app.get('/api/products', (_req, res) => res.json(db.listProducts()));
app.get('/api/products/:handle', (req, res) => {
  const p = db.getProduct(req.params.handle);
  return p ? res.json(p) : res.status(404).json({ error: 'Not found' });
});

app.get('/api/config', (_req, res) => res.json({
  whatsapp: process.env.WHATSAPP_NUMBER || '9715XXXXXXXX',
  pkrPerAed: PKR_PER_AED,
  paymentMethods: Object.fromEntries(
    Object.entries(providers).map(([k, p]) => [k, {
      label: p.label,
      AE: p.available('AE'), PK: p.available('PK'),
    }])),
}));

// Server-side total computation — clients never set prices.
function priceOrder(body) {
  const { items = [], country, payment_method, promo } = body;
  if (!['AE', 'PK'].includes(country)) throw new Error('country must be AE or PK');
  const provider = providers[payment_method];
  if (!provider || !provider.available(country)) throw new Error('Payment method unavailable');
  if (!Array.isArray(items) || items.length === 0 || items.length > 20)
    throw new Error('Cart is empty or too large');

  let subtotalAED = 0;
  const lines = items.map(it => {
    const p = db.getProduct(it.handle);
    if (!p) throw new Error('Unknown product: ' + it.handle);
    if (!p.fabrics.includes(it.fabric)) throw new Error('Invalid fabric for ' + p.name);
    if (!p.colors.includes(it.color)) throw new Error('Invalid colour for ' + p.name);
    const qty = Math.min(Math.max(parseInt(it.qty) || 1, 1), 10);
    const isCustom = p.tier === 'atelier' || it.size === 'Custom';
    if (!isCustom && !p.sizes.includes(it.size)) throw new Error('Invalid size for ' + p.name);
    if (isCustom) {
      const m = it.measurements || {};
      for (const k of ['shoulder', 'bust', 'sleeve', 'length']) {
        const v = parseFloat(m[k]);
        if (!(v > 10 && v < 250)) throw new Error('Custom orders need valid measurements (' + k + ')');
      }
    }
    const unitAED = p.price_aed + (isCustom && p.tier !== 'atelier' ? CUSTOM_FEE_AED : 0);
    subtotalAED += unitAED * qty;
    return { handle: p.handle, name: p.name, tier: p.tier, fabric: it.fabric, color: it.color,
      size: isCustom ? 'Custom' : it.size, qty, unit_aed: unitAED,
      measurements: isCustom ? it.measurements : undefined,
      tailor_notes: (it.tailor_notes || '').slice(0, 500) || undefined };
  });

  const rate = country === 'PK' ? PKR_PER_AED : 1;
  const currency = country === 'PK' ? 'PKR' : 'AED';
  const subtotal = Math.round(subtotalAED * rate);
  const discount = Math.round(subtotal * (PROMOS[(promo || '').toUpperCase()] || 0));
  const cod_fee = provider.fee(country);
  const total = subtotal - discount + cod_fee;
  return { lines, currency, subtotal, discount, cod_fee, total };
}

app.post('/api/orders/quote', quoteLimiter, (req, res) => {
  try { const q = priceOrder(req.body); res.json(q); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/orders', orderLimiter, async (req, res) => {
  try {
    const b = req.body;
    for (const f of ['customer_name', 'phone']) {
      if (!b[f] || String(b[f]).trim().length < 3) throw new Error(f.replace('_', ' ') + ' is required');
    }
    if (b.payment_method !== 'bank' && (!b.address || b.address.trim().length < 8))
      throw new Error('Delivery address is required');
    const q = priceOrder(b);
    const order = db.createOrder({
      customer_name: String(b.customer_name).slice(0, 120),
      phone: String(b.phone).slice(0, 30),
      email: b.email ? String(b.email).slice(0, 120) : null,
      country: b.country, city: b.city, address: b.address,
      currency: q.currency, payment_method: b.payment_method,
      subtotal: q.subtotal, cod_fee: q.cod_fee, discount: q.discount, total: q.total,
      notes: (b.notes || '').slice(0, 1000), items: q.lines,
    });
    const pay = await providers[b.payment_method].initiate(order);
    notify('order_created', order);
    res.status(201).json({ order_no: order.order_no, total: order.total,
      currency: order.currency, payment: pay });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/orders/:no', (req, res) => {
  // Customer order lookup requires the matching phone — minimal privacy gate.
  const o = db.getOrder(req.params.no);
  if (!o || (req.query.phone || '').replace(/\D/g, '').slice(-7) !==
      o.phone.replace(/\D/g, '').slice(-7))
    return res.status(404).json({ error: 'Order not found' });
  res.json(o);
});

// ------------------------------------------------------------ admin API
function admin(req, res, next) {
  if (req.get('x-admin-key') === ADMIN_KEY && ADMIN_KEY !== 'change-me') return next();
  if (ADMIN_KEY === 'change-me')
    return res.status(403).json({ error: 'Set ADMIN_KEY env var before using admin.' });
  res.status(401).json({ error: 'Unauthorized' });
}
app.get('/api/admin/orders', admin, (_req, res) => res.json(db.listOrders()));
app.patch('/api/admin/orders/:no', admin, (req, res) => {
  const { status, payment_status, payment_ref } = req.body;
  if (status) db.setStatus(req.params.no, status);
  if (payment_status) db.setPayment(req.params.no, payment_status, payment_ref);
  const updated = db.getOrder(req.params.no);
  if (status) notify('status_changed', updated, { new_status: status });
  if (payment_status) notify('payment_changed', updated, { new_payment_status: payment_status });
  res.json(updated);
});

app.get('/admin', (_req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));

app.listen(PORT, () => console.log('SAJA store running on http://localhost:' + PORT));
