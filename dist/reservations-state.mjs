export const HEX_ID = /^[a-f0-9]{64}$/;
export const ACTIVE_ATTEMPTS = new Set(['PREPARED', 'SUBMITTING', 'PENDING', 'NEEDS_RECONCILIATION']);
export const clone = value => JSON.parse(JSON.stringify(value));
export const shortAddress = value => typeof value === 'string' && value.length > 16 ? value.slice(0, 8) + '…' + value.slice(-6) : String(value || '');

export function editableProject(project) {
  return { title: project.title || '', context: project.context || '', spaces: clone(project.spaces || []), map: project.map ? clone(project.map) : null };
}
export function draftChanged(project, draft) { return JSON.stringify(editableProject(project)) !== JSON.stringify(draft); }
export function projectPayload(project, draft) {
  if (!Number.isSafeInteger(project?.revision) || !HEX_ID.test(project.id || '')) throw Error('Proyecto no verificado.');
  if (typeof draft.title !== 'string' || !draft.title.trim() || draft.title.trim().length > 120 || typeof draft.context !== 'string' || draft.context.length > 4000) throw Error('Completa un título de hasta 120 caracteres y un contexto de hasta 4000.');
  if (!Array.isArray(draft.spaces) || draft.spaces.length > 20) throw Error('El piloto admite hasta 20 espacios.');
  const ids = new Set();
  const spaces = draft.spaces.map(space => {
    if (!space.name?.trim() || space.name.trim().length > 80 || typeof space.purpose !== 'string' || space.purpose.length > 500) throw Error('Cada espacio necesita un nombre de hasta 80 caracteres y un propósito de hasta 500.');
    if (space.id && (!HEX_ID.test(space.id) || ids.has(space.id) || !project.spaces.some(item => item.id === space.id))) throw Error('El espacio no pertenece a la versión guardada.');
    if (space.id) ids.add(space.id);
    return { ...(space.id ? { id: space.id } : {}), name: space.name.trim(), purpose: space.purpose };
  });
  let map = null;
  if (draft.map) {
    if (!HEX_ID.test(draft.map.mediaId || '') || !Array.isArray(draft.map.points) || draft.map.points.length > 20) throw Error('Revisa el mapa guardado.');
    const placed = new Set();
    const points = draft.map.points.map(point => {
      if (!ids.has(point.spaceId) || placed.has(point.spaceId) || ![point.x, point.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw Error('Guarda los espacios antes de ubicarlos; usa un punto por espacio entre 0 y 100%.');
      placed.add(point.spaceId); return { spaceId: point.spaceId, x: point.x, y: point.y };
    });
    map = { mediaId: draft.map.mediaId, points };
  }
  return { expectedRevision: project.revision, title: draft.title.trim(), context: draft.context, spaces, map };
}
export function validateProposal(proposal) {
  if (!proposal || typeof proposal.summary !== 'string' || proposal.summary.length > 4000 || typeof proposal.title !== 'string' || !proposal.title.trim() || proposal.title.length > 120 || typeof proposal.context !== 'string' || proposal.context.length > 4000 || !Array.isArray(proposal.spaces) || !proposal.spaces.length || proposal.spaces.length > 20) throw Error('La propuesta no tiene un formato válido.');
  const spaces = proposal.spaces.map(space => {
    if (typeof space.name !== 'string' || !space.name.trim() || space.name.length > 80 || typeof space.purpose !== 'string' || space.purpose.length > 500) throw Error('La propuesta contiene un espacio inválido.');
    return { name: space.name, purpose: space.purpose };
  });
  return { summary: proposal.summary, title: proposal.title, context: proposal.context, spaces };
}
export function applyProposal(draft, proposal) {
  const validated = validateProposal(proposal);
  return { title: validated.title, context: validated.context, spaces: clone(validated.spaces), map: draft.map ? { mediaId: draft.map.mediaId, points: [] } : null };
}
export function removeSpace(draft, index) {
  const result = clone(draft), removed = result.spaces.splice(index, 1)[0];
  if (result.map && removed?.id) result.map.points = result.map.points.filter(point => point.spaceId !== removed.id);
  return result;
}
export function pointFromPointer(clientX, clientY, bounds) {
  if (!(bounds.width > 0 && bounds.height > 0)) throw Error('El mapa aún no tiene dimensiones.');
  return { x: Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height)) };
}
export function safeExplorerUrl(receipt) {
  if (!/^[a-f0-9]{64}$/.test(receipt?.txHash || '')) return null;
  // Construct a fixed Testnet link; never trust a provider-supplied URL.
  return 'https://stellar.expert/explorer/testnet/tx/' + receipt.txHash;
}
export function confirmedReceipt(result, identity) {
  const { attempt, receipt } = result || {};
  if (attempt?.state !== 'CONFIRMED' || !['publish', 'reserve'].includes(attempt.operation) || ![attempt.id, attempt.offerId, attempt.snapshotId].every(value => HEX_ID.test(value || '')) || !receipt || !safeExplorerUrl(receipt) || !Number.isSafeInteger(receipt.ledger) || receipt.ledger < 1 || attempt.actorAddress !== identity?.address || receipt.offer?.id !== attempt.offerId || ![receipt.offer.projectId, receipt.offer.spaceId].every(value => HEX_ID.test(value || ''))) return null;
  if (attempt.operation === 'reserve' && (receipt.offer.state !== 'RESERVED' || receipt.offer.holder !== identity.address)) return null;
  if (attempt.operation === 'publish' && (!['AVAILABLE', 'RESERVED'].includes(receipt.offer.state) || receipt.offer.host !== identity.address)) return null;
  return receipt;
}
export const attemptCopy = state => ({ PREPARED: 'Intención preparada. Revisa antes de firmar.', SUBMITTING: 'Enviando la operación autorizada. Aún no está confirmada.', PENDING: 'Operación enviada. Aún no está confirmada.', NEEDS_RECONCILIATION: 'Este intento necesita verificación antes de continuar. No vuelvas a firmar.', CONFIRMED: 'Resultado recibido; comprobando el recibo.', REJECTED: 'La operación no se confirmó.', CONFLICT: 'La oferta cambió o ya está reservada. Consulta su estado.' }[state] || 'No podemos confirmar el resultado. Consulta el intento antes de continuar.');
