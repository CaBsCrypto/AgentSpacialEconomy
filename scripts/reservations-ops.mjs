#!/usr/bin/env node
// Offline only: files in, review artifacts out. No environment, credentials, RPC or signing.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import * as sdk from '@stellar/stellar-sdk';
import { PINS, attachSimulation, createPlan, digest, parseBoundedJson, validatePlan, validateSignedExport } from '../dist/reservations-operator-core.mjs';

export async function run(args, io = { read: readFile }) {
  const [command, inputPath, extraPath] = args;
  if (!inputPath || args.length > 3 || !['bootstrap', 'maintain', 'review', 'check', 'check-signed'].includes(command)) throw Error('Uso: bootstrap input.json reservation.wasm | maintain input.json | review plan.json captura.json | check plan.json | check-signed plan.json firma.json');
  const input = parseBoundedJson(await io.read(inputPath, 'utf8'));
  if (command === 'bootstrap') {
    if (!extraPath || input.kind !== 'bootstrap') throw Error('Bootstrap requiere kind=bootstrap y el WASM local.');
    const wasm = await io.read(extraPath);
    if (wasm.length > 1000000 || await digest(wasm) !== PINS.wasmHash) throw Error('El WASM no coincide con el candidato revisado.');
    return createPlan(sdk, input);
  }
  if (command === 'maintain') {
    if (extraPath || input.kind !== 'maintain') throw Error('Mantenimiento requiere kind=maintain.');
    return createPlan(sdk, input);
  }
  if (command === 'review' || command === 'check-signed') {
    if (!extraPath) throw Error('Falta el segundo archivo.');
    const extra = parseBoundedJson(await io.read(extraPath, 'utf8'));
    return command === 'review' ? attachSimulation(sdk, input, extra) : validateSignedExport(sdk, input, extra);
  }
  if (extraPath) throw Error('Check sólo recibe un plan.');
  await validatePlan(sdk, input);
  return { status: input.simulation ? 'REVIEWED_OFFLINE' : 'DRAFT_NOT_SIGNABLE', intentId: input.intentId, contractId: input.contractId, configFingerprint: input.configFingerprint, externalEvidenceVerified: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await run(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error('Operación rechazada: ' + error.message); process.exitCode = 1; }
}
