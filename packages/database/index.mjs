import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync, openSync, closeSync, unlinkSync, chmodSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const defaultMigrations = fileURLToPath(new URL('../../migrations/', import.meta.url));

function migrate(db, directory) {
  const files = readdirSync(directory).filter(f => f.endsWith('.sql')).sort();
  const migrations = files.map((name, i) => {
    if (Number(name.match(/^(\d+)-[\w-]+\.sql$/)?.[1]) !== i + 1) throw new Error('Invalid migration sequence');
    const sql = readFileSync(join(directory, name), 'utf8').replace(/\r\n/g, '\n');
    return { version:i + 1, sql, checksum:createHash('sha256').update(sql).digest('hex') };
  });
  if (!migrations.length) throw new Error('Missing migrations');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL) STRICT');
    const applied = db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all();
    for (const [i, row] of applied.entries()) {
      if (row.version !== i + 1 || migrations[i]?.checksum !== row.checksum) throw new Error('Migration history mismatch');
    }
    for (const m of migrations.slice(applied.length)) {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations(version, checksum) VALUES (?, ?)').run(m.version, m.checksum);
    }
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

export function openState(path, { migrationsDir = defaultMigrations } = {}) {
  mkdirSync(dirname(resolve(path)), { recursive:true, mode:0o700 });
  const db = new DatabaseSync(path, { timeout:5000, enableForeignKeyConstraints:true, allowExtension:false });
  try {
    if (process.platform !== 'win32') chmodSync(path, 0o600);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
    migrate(db, migrationsDir);
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('State integrity check failed');
  } catch (error) { db.close(); throw error; }
  return {
    getSetting(key) {
      const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
      return row ? JSON.parse(row.value) : null;
    },
    setSetting(key, value) {
      const json = JSON.stringify(value);
      if (typeof key !== 'string' || !key || json === undefined) throw new TypeError('Invalid setting');
      db.prepare("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").run(key,json);
    },
    health() {
      return { ok:db.prepare('PRAGMA quick_check').get().quick_check === 'ok', journalMode:db.prepare('PRAGMA journal_mode').get().journal_mode };
    },
    async backup(destination) {
      // Exclusive reservation prevents accidental replacement of an existing backup.
      const fd = openSync(destination, 'wx', 0o600); closeSync(fd);
      try {
        await backup(db, destination);
        const copy = new DatabaseSync(destination, { readOnly:true });
        try { if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup integrity check failed'); }
        finally { copy.close(); }
      } catch (error) { unlinkSync(destination); throw error; }
    },
    close() { db.close(); }
  };
}
