import { createHash, randomBytes } from 'node:crypto';
export class ServiceError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const uuid = () => randomBytes(32).toString('hex');
export const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
export const fail = (status, code, message) => { throw new ServiceError(status, code, message); };
/** Protocol 23 can simulate archived values while requesting automatic restoration. */
export function simulationRequiresRestoration(result) {
  if (result.restorePreamble) return true;
  if (!result.transactionData) return false;
  try {
    const data=result.transactionData.build?.()??result.transactionData,ext=data.ext();
    if (ext.switch()===0) return false;
    if (ext.switch()===1) return ext.resourceExt().archivedSorobanEntries().length>0;
    return true;
  } catch {return true;}
}
export function exactKeys(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => ![...required, ...optional].includes(key)) || required.some(key => !(key in value))) fail(422, 'INVALID_FIELDS', 'The request has missing or unsupported fields.');
}
export function hexId(value) { if (!/^[a-f0-9]{64}$/u.test(value ?? '')) fail(422, 'INVALID_ID', 'A valid opaque identifier is required.'); return value; }
export function text(value, max, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)) fail(422, 'INVALID_TEXT', 'A text field is missing, too long or contains unsupported characters.');
  return value.trim().normalize('NFC');
}
export function requireHost(identity, config) {
  if (!identity || identity.address !== config.hostAddress || identity.role !== 'host') fail(403, 'HOST_REQUIRED', 'Only the configured host can access this resource.');
}
