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
  const timings = {}, listeners = new Set();
  let openSource = 'wallet';
  const snapshot = state => state == null ? null : structuredClone(state);
  const currentState = () => snapshot(controller?.state);
  let accessLabel, accessAddress, accessGroup, accessState = {status: 'preparing', busy: true};
  const shortAddress = address => address ? address.slice(0, 5) + '…' + address.slice(-4) : '';
  function renderAccess(state = accessState) {
    accessState = state;
    if (!quickButton) return;
    const balance = state.balance || '0';
    accessLabel.textContent = state.address ? 'Mi wallet · ' + balance + ' USDC' : state.status === 'preparing' ? 'Wallet · preparando…' : 'Wallet · Testnet';
    accessAddress.textContent = shortAddress(state.address); accessAddress.hidden = !state.address;
    quickButton.setAttribute('aria-busy', String(state.status === 'preparing'));
    quickButton.setAttribute('aria-label', state.address ? 'Abrir mi wallet, ' + balance + ' USDC de prueba. Dirección ' + shortAddress(state.address) : 'Abrir wallet de Stellar Testnet');
    quickButton.title = state.address ? state.address + ' · ' + balance + ' USDC de prueba' : 'Preparar o consultar mi wallet de Testnet';
  }
  function mountAccess() {
    if (!quickButton) {
      quickButton = documentRef.getElementById('walletQuickOpen') || documentRef.createElement('button');
      quickButton.type = 'button'; quickButton.id = 'walletQuickOpen'; quickButton.dataset.walletOpen = 'true';
      accessLabel = documentRef.createElement('span'); accessLabel.className = 'wallet-access-label';
      accessAddress = documentRef.createElement('span'); accessAddress.className = 'wallet-access-address';
      quickButton.replaceChildren(accessLabel, accessAddress);
      quickButton.addEventListener('click', () => void open());
      renderAccess(controller?.state || accessState);
    }
    const help = documentRef.getElementById('help'), viewer = documentRef.getElementById('viewer');
    const toolbar = help?.closest?.('.toolbar') || help?.parentElement;
    if (toolbar && (!viewer || !viewer.hidden)) {
      accessGroup ||= documentRef.getElementById('walletHelpControls');
      if (!accessGroup) {
        accessGroup = documentRef.createElement('span'); accessGroup.id = 'walletHelpControls'; accessGroup.className = 'wallet-help-controls';
        toolbar.insertBefore(accessGroup, help); accessGroup.append(help);
      }
      if (quickButton.parentElement !== accessGroup) accessGroup.insertBefore(quickButton, help);
      quickButton.className = 'wallet-toolbar-open'; quickButton.dataset.walletPlacement = 'toolbar';
      toolbar.classList?.add('has-wallet-access');
    } else {
      if (quickButton.parentElement !== documentRef.body) documentRef.body.append(quickButton);
      quickButton.className = 'wallet-quick-open'; quickButton.dataset.walletPlacement = 'direct';
    }
  }
  documentRef.addEventListener('visibilitychange', () => {
    if (documentRef.visibilityState === 'visible' && controller) void controller.refreshConfiguration?.();
  });
  const notify = (type, detail) => {
    const EventClass = documentRef.defaultView?.CustomEvent || globalThis.CustomEvent;
    if (EventClass) documentRef.dispatchEvent(new EventClass(type, {detail}));
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
      dialog.addEventListener('close', () => {
        ++generation; opening = null;
        notify('one16-wallet-close', {source: openSource, state: currentState()});
        openSource = 'wallet';
      });
    }
    return dialog;
  }
  function prepare() {
    if (preparation) return preparation;
    timings.prepareStarted = now();
    ensureStyles();
    preparation = loadModules().then(async ([wallet, ui]) => {
      controller ??= wallet.createWalletController();
      panel ??= ui.bindWalletPanel({dialog: getDialog(), controller, documentRef,
        // Fires before close, retaining the source of this opening. It is an
        // acknowledgement, not proof of funding; guided-tour validates state.
        onContinue: state => notify('one16-wallet-continue', {source: openSource, state: snapshot(state)}),
      });
      if (!subscribed) {subscribed = true; controller.subscribe(state => {
        renderAccess(state);
        for (const listener of listeners) { try { listener(snapshot(state)); } catch {} }
      });}
      await controller.prepare();
      timings.prepared = now();
      return controller;
    }).catch(error => {preparation = null; throw error;});
    preparation.catch(() => {});
    return preparation;
  }
  function afterFirstFrame() {
    if (!documentRef.body) return;
    if (firstFrame && quickButton?.dataset.walletPlacement === 'toolbar' && !documentRef.getElementById('viewer')?.hidden) return;
    // NFC can reveal its frame before entering the venue: move the same control on return.
    mountAccess();
    if (firstFrame) return;
    firstFrame = true;
    timings.firstFrame = now();
    ensureStyles();
    idle(() => {void prepare().catch(() => {});});
  }
  function open({source = 'wallet'} = {}) {
    if (opening) return opening;
    // A second trigger cannot relabel an already-open wallet as a totem visit.
    if (dialogRef?.open) return Promise.resolve(controller);
    openSource = source === 'totem' ? 'totem' : 'wallet';
    const token = ++generation;
    timings.opened = now();
    notify('one16-wallet-open', {source: openSource, state: currentState()});
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
  return {
    afterFirstFrame, prepare, open,
    // Observing is read-only: it never loads modules or starts preparation.
    get state() {return currentState();},
    subscribe(listener) {
      listeners.add(listener);
      try { listener(currentState()); } catch {}
      return () => listeners.delete(listener);
    },
    get controller() {return controller;}, get timings() {return {...timings};},
  };
}

export function getWorldWallet(documentRef = globalThis.document) {
  if (!experiences.has(documentRef)) experiences.set(documentRef, createWorldWallet({documentRef}));
  return experiences.get(documentRef);
}
