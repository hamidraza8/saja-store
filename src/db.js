// src/db.js — SQLite layer (Node built-in node:sqlite, zero native deps)
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'saja.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  handle TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK(tier IN ('essentials','signature','atelier')),
  price_aed REAL NOT NULL,
  compare_aed REAL,
  description TEXT,
  fabrics TEXT NOT NULL,   -- JSON array
  colors TEXT NOT NULL,    -- JSON array
  sizes TEXT NOT NULL,     -- JSON array
  image TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'new'
    CHECK(status IN ('new','confirmed','stitching','qc','shipped','delivered','cancelled')),
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  country TEXT NOT NULL CHECK(country IN ('AE','PK')),
  city TEXT, address TEXT,
  currency TEXT NOT NULL,
  payment_method TEXT NOT NULL,   -- cod | bank | card
  payment_status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed | refunded
  payment_ref TEXT,
  subtotal REAL NOT NULL, cod_fee REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0, total REAL NOT NULL,
  notes TEXT,
  items TEXT NOT NULL             -- JSON array of line items incl. measurements
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
`);

function seed() {
  const products = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'products.json'), 'utf8'));
  const up = db.prepare(`INSERT INTO products (handle,name,tier,price_aed,compare_aed,description,fabrics,colors,sizes,image)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(handle) DO UPDATE SET name=excluded.name, tier=excluded.tier,
      price_aed=excluded.price_aed, compare_aed=excluded.compare_aed, description=excluded.description,
      fabrics=excluded.fabrics, colors=excluded.colors, sizes=excluded.sizes, image=excluded.image`);
  for (const p of products) {
    up.run(p.handle, p.name, p.tier, p.price, p.compare, p.desc,
      JSON.stringify(p.fabrics), JSON.stringify(p.colors), JSON.stringify(p.sizes), p.img);
  }
  return products.length;
}

const parse = r => r && ({ ...r, fabrics: JSON.parse(r.fabrics), colors: JSON.parse(r.colors), sizes: JSON.parse(r.sizes) });

module.exports = {
  seed,
  listProducts: () => db.prepare('SELECT * FROM products WHERE active=1').all().map(parse),
  getProduct: h => parse(db.prepare('SELECT * FROM products WHERE handle=? AND active=1').get(h)),
  createOrder(o) {
    const order_no = 'SJ' + Date.now().toString(36).toUpperCase() +
      Math.floor(Math.random() * 90 + 10);
    db.prepare(`INSERT INTO orders
      (order_no,customer_name,phone,email,country,city,address,currency,payment_method,
       subtotal,cod_fee,discount,total,notes,items)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(order_no, o.customer_name, o.phone, o.email || null, o.country, o.city || null,
        o.address || null, o.currency, o.payment_method, o.subtotal, o.cod_fee,
        o.discount, o.total, o.notes || null, JSON.stringify(o.items));
    return this.getOrder(order_no);
  },
  getOrder: no => {
    const r = db.prepare('SELECT * FROM orders WHERE order_no=?').get(no);
    return r && { ...r, items: JSON.parse(r.items) };
  },
  listOrders: () => db.prepare('SELECT * FROM orders ORDER BY id DESC').all()
    .map(r => ({ ...r, items: JSON.parse(r.items) })),
  setStatus: (no, status) =>
    db.prepare('UPDATE orders SET status=? WHERE order_no=?').run(status, no),
  setPayment: (no, payment_status, ref) =>
    db.prepare('UPDATE orders SET payment_status=?, payment_ref=? WHERE order_no=?')
      .run(payment_status, ref || null, no),
};

if (require.main === module && process.argv.includes('--seed')) {
  console.log('Seeded', seed(), 'products');
}
