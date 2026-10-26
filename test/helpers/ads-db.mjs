// Local PGlite or an explicitly isolated PostgreSQL CI database. Never a chain fixture.
import { randomBytes } from 'node:crypto';
import { migrate, createDatabase } from '../../server/ads/db.mjs';

const SCHEMA = /^ads_test_[a-f0-9]{24}$/;
function adapter(client) {
  return {
    async query(sql, params) {
      const result = params?.length ? await client.query(sql, params) : (await client.exec(sql)).at(-1);
      const rows = result?.rows ?? [];
      return { ...result, rows, rowCount: /^\s*(?:SELECT|WITH)\b/iu.test(sql) ? rows.length : (result?.affectedRows ?? rows.length) };
    },
  };
}

/** Reject unsafe configuration before constructing a driver or opening a connection. */
export function validateTestPostgresUrl(value, env = process.env) {
  if (env.NODE_ENV !== 'test') throw new Error('ADS_TEST_DATABASE_URL requires NODE_ENV=test.');
  let url;
  try { url = new URL(value); } catch { throw new Error('ADS_TEST_DATABASE_URL must be a valid PostgreSQL test URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== '/ads_test' || url.search || url.hash) {
    throw new Error('ADS_TEST_DATABASE_URL must select exactly ads_test, without query or fragment overrides.');
  }
  return url.href;
}

async function postgresDatabase({ connectionString, applyMigrations, loadPg }) {
  const pg = await loadPg();
  const Pool = pg.Pool ?? pg.default?.Pool;
  const schema = 'ads_test_' + randomBytes(12).toString('hex');
  if (!SCHEMA.test(schema)) throw new Error('Invalid isolated test schema.');
  const bootstrap = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, application_name: 'ads-test-bootstrap' });
  let pool, created = false, closed = false;
  const assertDatabase = async () => {
    const result = await bootstrap.query('SELECT current_database() AS name');
    if (result.rows[0]?.name !== 'ads_test') throw new Error('Refusing database setup or teardown outside ads_test.');
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      if (pool) await pool.end();
      if (created) {
        await assertDatabase();
        if (!SCHEMA.test(schema)) throw new Error('Refusing to remove an invalid test schema.');
        await bootstrap.query(`DROP SCHEMA "${schema}" CASCADE`);
      }
    } finally { await bootstrap.end(); }
  };
  try {
    await assertDatabase();
    const client = await bootstrap.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ads-test-btree-gist'))");
      await client.query('CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public');
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query('COMMIT');
      created = true;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    // Generated identifier only; connection-local search_path never changes PGOPTIONS or other env.
    pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000, options: `-c search_path=${schema},public`, application_name: 'ads-test-fixture' });
    const selected = await pool.query('SELECT current_database() AS database, current_schema() AS schema');
    if (selected.rows[0]?.database !== 'ads_test' || selected.rows[0]?.schema !== schema) throw new Error('Refusing migrations outside the isolated test schema.');
    const db = { ...createDatabase({ pool }), testDatabase: true, testBackend: 'postgres', testSchema: schema, close };
    if (applyMigrations) await migrate(db);
    return db;
  } catch (error) { await close(); throw error; }
}

/** Production migrations and constraints run unchanged in both backends. */
export async function createTestDatabase({ applyMigrations = true, env = process.env, loadPg = () => import('pg') } = {}) {
  if (env.ADS_TEST_DATABASE_URL) {
    const connectionString = validateTestPostgresUrl(env.ADS_TEST_DATABASE_URL, env);
    return postgresDatabase({ connectionString, applyMigrations, loadPg });
  }
  const [{ PGlite }, { btree_gist }] = await Promise.all([import('@electric-sql/pglite'), import('@electric-sql/pglite/contrib/btree_gist')]);
  const engine = new PGlite({ extensions: { btree_gist } });
  await engine.waitReady;
  const db = { testDatabase: true, testBackend: 'pglite', engine, ...adapter(engine), transaction: work => engine.transaction(tx => work(adapter(tx))), close: () => engine.close() };
  try { if (applyMigrations) await migrate(db); return db; }
  catch (error) { await db.close(); throw error; }
}
export const createAdsTestDatabase = createTestDatabase;
