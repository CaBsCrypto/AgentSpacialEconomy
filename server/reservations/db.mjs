import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fail } from '../identity/common.mjs';
export function createDatabase({ connectionString, pool:supplied } = {}) {
  let pool = supplied;
  const get = async () => { if (!pool) { if (!connectionString) fail(503,'DATABASE_UNCONFIGURED','Reservation storage is not configured.'); const { Pool } = await import('pg'); pool = new Pool({ connectionString, max:8, connectionTimeoutMillis:5000, statement_timeout:15000 }); } return pool; };
  return { async query(sql, args) { return (await get()).query(sql,args); },
    async transaction(work) { const client = await (await get()).connect(); try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } },
    async close() { if (pool) await pool.end(); } };
}
export async function migrate(db, directory = fileURLToPath(new URL('../../migrations/reservations/',import.meta.url))) {
  await db.transaction(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('reservations-migrations'))");
    await tx.query('CREATE TABLE IF NOT EXISTS reservations_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
      if ((await tx.query('SELECT name FROM reservations_migrations WHERE name=$1',[name])).rows.length) continue;
      await tx.query(await readFile(path.join(directory,name),'utf8'));
      await tx.query('INSERT INTO reservations_migrations(name) VALUES($1)',[name]);
    }
  });
}
export async function lock(tx, name) { await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[name]); }
/** Shared across all future Gateway consumers; no process-local budget locks. */
export async function consumeLimits(db, entries) {
  await db.transaction(async tx => {
    for (const item of [...entries].sort((a,b) => a.key.localeCompare(b.key))) {
      await lock(tx,'limit:'+item.key);
      const old = (await tx.query('SELECT used FROM resource_limits WHERE key=$1 FOR UPDATE',[item.key])).rows[0];
      const used = Number(old?.used || 0), amount = item.amount ?? 1;
      if (used + amount > item.limit) fail(429,'RATE_LIMIT','The configured resource limit has been reached.');
      await tx.query('INSERT INTO resource_limits(key,used) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET used=EXCLUDED.used',[item.key,used+amount]);
    }
  });
}
