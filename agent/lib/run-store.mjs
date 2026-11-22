import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { join, dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Ledger } from '../ledger.mjs';

/** Replace a complete JSON file on the same filesystem, never truncate the previous state. */
export async function atomicWriteJson(file, value, { renameFile = rename } = {}) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2));
    await handle.sync();
    await handle.close(); handle = null;
    await renameFile(temporary, file);
    // Directory fsync is supported on Unix. Windows rejects opening/syncing directories.
    let directory;
    try { directory = await open(dirname(file), 'r'); await directory.sync(); }
    catch (error) { if (!['EISDIR', 'EPERM', 'EINVAL', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error; }
    finally { await directory?.close(); }
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function readOptional(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

/** One writer owns loading, migration, payment and saving for the entire run. */
export async function openRunState({ directory, runId, mandate }) {
  if (typeof runId !== 'string' || !runId || runId.length > 160) throw Error('Use a nonempty run id of at most 160 characters.');
  const name = runId.replace(/[^A-Za-z0-9._-]/g, '_');
  await mkdir(directory, { recursive: true });
  const files = {
    state: join(directory, `run-${name}.json`),
    ledger: join(directory, `ledger-${name}.json`),
    results: join(directory, `results-${name}.json`),
    lock: join(directory, `run-${name}.lock`),
  };
  let lock;
  try { lock = await open(files.lock, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw Object.assign(new Error('This run is locked. Confirm no process owns it and reconcile any uncertain payment before removing its lock. Never use a new run id to bypass an uncertain payment.'), { code: 'RUN_LOCKED' });
  }
  const token = randomUUID();
  let closed = false, saving = Promise.resolve();
  const close = async () => {
    if (closed) return;
    closed = true;
    try { await saving; }
    finally {
      await lock.close();
      const owner = await readOptional(files.lock);
      if (owner?.token === token) await unlink(files.lock);
    }
  };
  try {
    await lock.writeFile(JSON.stringify({ token, runId, pid: process.pid, host: hostname(), startedAt: new Date().toISOString() }));
    await lock.sync();
    const snapshot = await readOptional(files.state);
    let json, results;
    if (snapshot !== undefined) {
      if (!snapshot || snapshot.version !== 1 || snapshot.runId !== runId || !snapshot.ledger || !snapshot.results) throw Error('Unsupported or mismatched run snapshot; reconciliation is required.');
      ({ ledger: json, results } = snapshot);
    } else {
      json = await readOptional(files.ledger); results = await readOptional(files.results);
      if (results !== undefined && json === undefined) throw Error('Legacy results have no ledger; reconcile the incomplete run before continuing.');
      if (json === null) throw Error('Invalid legacy ledger; reconciliation is required.');
      if (results === undefined) results = {};
    }
    if (json && (json.runId !== runId || !isDeepStrictEqual(json.mandate, mandate))) throw Error('The saved run id or mandate differs; do not reuse this payment state.');
    if (!results || typeof results !== 'object' || Array.isArray(results)) throw Error('Invalid saved payment results; reconciliation is required.');
    const ledger = json ? Ledger.restore(mandate, json) : new Ledger(mandate, { runId });
    const save = () => {
      if (closed) return Promise.reject(Error('The run store is closed.'));
      const value = { version: 1, runId, ledger: ledger.toJSON(), results: structuredClone(results) };
      // Capture one coherent pair before queuing; a failed write poisons later saves.
      const frozen = structuredClone(value);
      saving = saving.then(async () => {
        await atomicWriteJson(files.state, frozen);
        // Compatibility views are not read once the canonical snapshot exists.
        await atomicWriteJson(files.ledger, frozen.ledger);
        await atomicWriteJson(files.results, frozen.results);
      });
      return saving;
    };
    return { ledger, results, runId, files, save, close };
  } catch (error) {
    await close();
    throw error;
  }
}
