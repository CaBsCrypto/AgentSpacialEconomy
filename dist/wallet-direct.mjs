/** A top-level wallet entry: preparation is read-only and all ceremonies remain explicit. */
export function mountWalletDirect({
  documentRef = globalThis.document,
  locationRef = globalThis.location,
  loadModules = () => Promise.all([import('./wallet-controller.mjs'), import('./wallet-panel.mjs')]),
} = {}) {
  const dialog = documentRef.getElementById('activationDialog');
  const status = documentRef.getElementById('walletDirectStatus');
  const retry = documentRef.getElementById('walletDirectRetry');
  let pending, controller, panel, disposed = false;
  const open = () => {
    if (disposed) return Promise.resolve();
    if (pending) return pending;
    status.textContent = 'Preparando el acceso a tu wallet…'; retry.hidden = true; retry.disabled = true;
    pending = Promise.resolve().then(loadModules).then(([wallet, ui]) => {
      if (disposed) return;
      controller ??= wallet.createWalletController();
      panel ??= ui.bindWalletPanel({ dialog, controller, documentRef, onClose() {
        if (!disposed) locationRef.assign('/one16?lang=es');
      } });
      return panel.open();
    }).then(() => {
      if (!disposed) status.textContent = 'El panel de tu wallet está abierto. Confirma cualquier acción desde sus botones.';
    }).catch(() => {
      if (disposed) return;
      status.textContent = 'No se pudo preparar la wallet. Reintenta o continúa a ONE16.';
      retry.hidden = false; retry.focus?.();
    }).finally(() => { pending = null; if (!disposed) retry.disabled = false; });
    return pending;
  };
  const onRetry = () => { void open(); };
  retry.addEventListener('click', onRetry);
  const ready = open();
  return {
    ready, open,
    get controller() { return controller; },
    dispose() { disposed = true; retry.removeEventListener('click', onRetry); panel?.destroy(); },
  };
}

if (typeof document !== 'undefined') mountWalletDirect();
