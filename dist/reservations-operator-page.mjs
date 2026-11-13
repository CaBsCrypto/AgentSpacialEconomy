import * as sdk from './vendor/reservations-wallet/kit.mjs';
import { parseBoundedJson } from './reservations-operator-core.mjs';
import { OPERATOR_POLICY } from './reservations-operator-policy.mjs';
import { createOperatorController } from './reservations-operator-wallet.mjs';
const controller = createOperatorController({ sdk, policy: OPERATOR_POLICY });
const el = id => document.getElementById(id);
let plan = null;
function status(message) { el('status').textContent = message; }
function buttons(connect = false, sign = false, download = false) { el('connect').disabled = !connect; el('sign').disabled = !sign; el('export').disabled = !download; }
async function action(work) {
  el('plan').disabled = true; buttons();
  try { await work(); } catch (error) { status(error.message || 'La operación no pudo completarse.'); }
  finally { el('plan').disabled = false; }
}
el('plan').addEventListener('change', () => action(async () => {
  plan = null; el('review').hidden = true; el('details').replaceChildren();
  const file = el('plan').files[0]; if (!file || file.size > 262144) throw Error('Selecciona un JSON de hasta 256 KiB.');
  plan = await controller.load(parseBoundedJson(await file.text()));
  const fields = [['Acción', plan.kind === 'bootstrap' ? 'Crear contrato de reservas' : 'Mantener almacenamiento'], ['Intención', plan.intentId], ['Host', plan.hostAddress], ['Proyecto', plan.projectId], ['Contrato', plan.contractId], ['SHA fuente', plan.sourceSha], ['WASM', plan.wasmHash], ['Fingerprint', plan.configFingerprint], ['Red / origen', plan.network + ' · ' + plan.origin], ['Salt', plan.salt ?? 'No aplica'], ['Ofertas', plan.offers.length ? plan.offers.join('\n') : plan.kind === 'maintain' ? 'Sólo instancia y código' : 'Ninguna'], ['Expiración', plan.simulation?.expiresAt ?? 'Falta simulación'], ['Recursos mínimos (stroops)', plan.simulation?.minResourceFee ?? 'Sin estimación'], ['Restauración', plan.simulation?.restorationRequired ? 'Requiere aprobación explícita' : 'No indicada']];
  for (const [name, value] of fields) { const term = document.createElement('dt'), detail = document.createElement('dd'); term.textContent = name; detail.textContent = value; el('details').append(term, detail); }
  el('review').hidden = false;
  await controller.readiness(); buttons(true); status('Plan válido para el candidato habilitado. Revisa los datos antes de conectar.');
}));
el('connect').addEventListener('click', () => action(async () => { const connected = await controller.connect(); buttons(false, true); status('Host verificado: ' + connected.address + '. Firmar autoriza únicamente el plan mostrado.'); }));
el('sign').addEventListener('click', () => action(async () => { await controller.sign(); buttons(false, false, true); status('Autorización firmada. Todavía no se ha transmitido ni confirmado ninguna operación.'); }));
el('export').addEventListener('click', () => {
  try { const value = controller.export(); const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'reservation-auth-' + value.intentId + '.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); status('Archivo exportado. La revisión y transmisión posterior siguen pendientes.'); }
  catch (error) { status(error.message); }
});
