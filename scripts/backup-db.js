#!/usr/bin/env node
// scripts/backup-db.js — copies saja.db to a timestamped backup.
// Run daily via cron/Task Scheduler: node scripts/backup-db.js
// Keeps the last 14 backups by default; older ones are deleted.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'saja.db');
const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');
const KEEP = parseInt(process.env.BACKUP_KEEP) || 14;

if (!fs.existsSync(DB_PATH)) {
  console.error('Database not found at', DB_PATH);
  process.exit(1);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dest = path.join(BACKUP_DIR, `saja-${stamp}.db`);
fs.copyFileSync(DB_PATH, dest);
console.log('Backed up →', dest);

// Prune old backups
const backups = fs.readdirSync(BACKUP_DIR)
  .filter(f => f.startsWith('saja-') && f.endsWith('.db'))
  .sort();
while (backups.length > KEEP) {
  const old = backups.shift();
  fs.unlinkSync(path.join(BACKUP_DIR, old));
  console.log('Pruned', old);
}
