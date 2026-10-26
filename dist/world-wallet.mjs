// Wallet preparation starts only after the real first 3D frame.
const experiences = new WeakMap();

export function isActivationObject(object) {
  for (let node = object; node; node = node.parent) {
    if (/^ActivationTotem(?:$|[\s_/.•])/i.test(node.name || '')) return true;
  }
  return false;
}

export function createWorldWallet({
  documentRef = globalThis.document,
  loadModules = () => Promise.all([import('./wallet-controller.mjs'), import('./wallet-panel.mjs')]),
  idle = callback => globalThis.requestIdleCallback
    ? globalThis.requestIdleCallback(callback, {timeout: 4000})
    : globalThis.setTimeout(callback, 500),
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  let firstFrame = false, preparation, controller, panel, quickButton, style, opening, dialogRef, subscribed = false, generation = 0;
  const timings = {};
  documentRef.addEventListener('visibilitychange', () => {
    if (documentRef.visibilityState === 'visible' && controller) void controller.refreshConfiguration?.();
  });
  const notify = type => {
    const EventClass = documentRef.defaultView?.CustomEvent || globalThis.CustomEvent;
    if (EventClass) documentRef.dispatchEvent(new EventClass(type));
  };
  function ensureStyles() {
    if (style || !documentRef.head) return;
    const existing = documentRef.getElementById('walletStyles');
    if (existing) {style = existing; return;}
    style = documentRef.createElement('link');
    style.id = 'walletStyles';
    style.rel = 'stylesheet';
    style.href = new URL('./wallet.css?v=1', import.meta.url).href;
    documentRef.head.append(style);
  }
  function getDialog() {
    let dialog = documentRef.getElementById('activationDialog');
    if (!dialog) {
      dialog = documentRef.createElement('dialog');
      dialog.id = 'activationDialog';
      documentRef.body.append(dialog);
    }
    if (dialogRef !== dialog) {
      dialogRef = dialog;
      dialog.addEventListener('close', () => {++generation; opening = null; notify('one16-wallet-close');});
    }
    return dialog;
  }
  function prepare() {
    if (preparation) return preparation;
    timings.prepareStarted = now();
    ensureStyles();
    preparation = loadModules().then(async ([wallet, ui]) => {
      controller ??= wallet.createWalletController();
      panel ??= ui.bindWalletPanel({dialog: getDialog(), controller, documentRef});
      if (!subscribed) {subscribed = true; controller.subscribe(state => {
        if (quickButton) quickButton.textContent = state.phase === 'ready' || state.status === 'ready'
          ? 'Mi wallet · Testnet' : 'Wallet · Testnet';
      });}
      await controller.prepare();
      timings.prepared = now();
      return controller;
    }).catch(error => {preparation = null; throw error;});
    preparation.catch(() => {});
    return preparation;
  }
  function afterFirstFrame() {
    if (firstFrame || !documentRef.body) return;
    firstFrame = true;
    timings.firstFrame = now();
    ensureStyles();
    quickButton = documentRef.createElement('button');
    quickButton.type = 'button';
    quickButton.id = 'walletQuickOpen';
    quickButton.className = 'wallet-quick-open';
    quickButton.dataset.walletOpen = 'true';
    quickButton.textContent = 'Wallet · Testnet';
    quickButton.addEventListener('click', () => void open());
    documentRef.body.append(quickButton);
    idle(() => {void prepare().catch(() => {});});
  }
  function open() {
    if (opening) return opening;
    const token = ++generation;
    timings.opened = now();
    notify('one16-wallet-open');
    ensureStyles();
    const dialog = getDialog();
    if (!panel && !dialog.open) {
      const loading = documentRef.createElement('p');
      loading.setAttribute('role', 'status');
      loading.textContent = 'Preparando tu wallet de prueba…';
      dialog.replaceChildren(loading);
      dialog.showModal();
    }
    opening = prepare().then(() => {if (token === generation) return panel.open();}).catch(() => {
      if (token !== generation) return;
      const message = documentRef.createElement('p'), close = documentRef.createElement('button');
      message.textContent = 'No se pudo preparar la wallet. Puedes continuar y volver a intentarlo.';
      message.setAttribute('role', 'alert');
      close.type = 'button'; close.textContent = 'Continuar la experiencia';
      close.addEventListener('click', () => dialog.close());
      dialog.replaceChildren(message, close);
    }).finally(() => {if (token === generation) opening = null;});
    return opening;
  }
  return {afterFirstFrame, prepare, open, get controller() {return controller;}, get timings() {return {...timings};}};
}

export function getWorldWallet(documentRef = globalThis.document) {
  if (!experiences.has(documentRef)) experiences.set(documentRef, createWorldWallet({documentRef}));
  return experiences.get(documentRef);
}
