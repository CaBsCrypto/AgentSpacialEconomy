const messages = {
  idle: 'Prepara tu wallet para recibir USDC de prueba.',
  preparing: 'Preparando la activación…',
  available: 'Crea una wallet con la passkey de tu teléfono o conecta la que ya tienes.',
  connected: 'Tu wallet está conectada. Puedes recibir los USDC de prueba.',
  'awaiting-passkey': 'Confirma la passkey en tu teléfono para continuar.',
  deploying: 'Creando tu wallet en Stellar Testnet…',
  checking: 'Comprobando tu wallet y su saldo…',
  funding: 'Solicitando USDC de prueba a Sozu…',
  receiving: 'Esperando la confirmación de los USDC en Testnet…',
  pending: 'La recepción sigue pendiente. Puedes continuar y comprobarla después.',
  ready: 'Tu wallet está lista para continuar la experiencia.',
  unavailable: 'La activación está en preparación. Puedes continuar la experiencia 3D.',
  error: 'No se pudo completar la activación. Puedes continuar y volver a intentarlo.',
};

export function bindWalletPanel({ dialog, controller, documentRef = dialog.ownerDocument, onClose = () => {} } = {}) {
  const doc = documentRef;
  if (!doc.getElementById('walletStyles')) {
    const stylesheet = doc.createElement('link');
    stylesheet.id = 'walletStyles';
    stylesheet.rel = 'stylesheet';
    stylesheet.href = './wallet.css?v=wallet1';
    doc.head.append(stylesheet);
  }
  const element = (tag, text, className) => {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  dialog.classList.add('wallet-panel');
  dialog.setAttribute('aria-labelledby', 'activationTitle');
  const close = element('button', '×', 'wallet-close');
  close.id = 'closeActivation';
  close.type = 'button';
  close.setAttribute('aria-label', 'Cerrar wallet y continuar la experiencia');
  const eyebrow = element('p', 'ONE16 / STELLAR TESTNET', 'wallet-eyebrow');
  const title = element('h2', 'Tu wallet para la experiencia');
  title.id = 'activationTitle';
  const introduction = element('p', 'Una passkey en tu teléfono. USDC de prueba para explorar lo que viene.', 'wallet-introduction');
  const status = element('p', '', 'wallet-status');
  status.id = 'walletStatus';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const availability = element('p', '', 'wallet-availability');
  availability.id = 'walletAvailability';
  availability.setAttribute('role', 'status');
  availability.hidden = true;
  const card = element('div', null, 'wallet-account');
  const balance = element('strong', '0 USDC', 'wallet-balance');
  const network = element('span', 'USDC de prueba · sin valor real', 'wallet-network');
  const address = element('code', null, 'wallet-address');
  address.setAttribute('aria-label', 'Dirección de tu wallet');
  const explorer = element('a', 'Ver en Stellar Expert ↗', 'wallet-explorer');
  explorer.target = '_blank';
  explorer.rel = 'noopener noreferrer';
  card.append(balance, network, address, explorer);
  const actions = element('div', null, 'wallet-actions');
  const create = element('button', 'Crear wallet con passkey', 'wallet-primary');
  create.id = 'walletCreate';
  create.type = 'button';
  const connect = element('button', 'Ya tengo una wallet', 'wallet-secondary');
  connect.id = 'walletConnect';
  connect.type = 'button';
  const receive = element('button', 'Recibir USDC de prueba', 'wallet-primary');
  receive.id = 'walletReceive';
  receive.type = 'button';
  const retry = element('button', 'Comprobar recepción', 'wallet-secondary');
  retry.id = 'walletRetry';
  retry.type = 'button';
  const verify = element('button', 'Verificar mi passkey', 'wallet-secondary');
  verify.id = 'walletVerify'; verify.type = 'button';
  const verification = element('p', '', 'wallet-note');
  verification.id = 'walletVerification'; verification.setAttribute('role', 'status'); verification.setAttribute('aria-live', 'polite'); verification.hidden = true;
  const continueButton = element('button', 'Continuar experiencia', 'wallet-secondary');
  continueButton.id = 'walletContinue';
  continueButton.type = 'button';
  const notice = element('p', 'La clave de tu passkey permanece en el autenticador. Aquí conservamos la sesión para volver a conectar en este navegador.', 'wallet-note');
  const limits = element('p', 'Piloto Testnet · los fondos dependen de la disponibilidad y los límites de Sozu.', 'wallet-note');
  const timings = element('p', '', 'wallet-timings');
  timings.hidden = true;
  actions.append(create, connect, receive, retry, verify, continueButton);
  dialog.replaceChildren(close, eyebrow, title, introduction, status, availability, card, actions, verification, notice, limits, timings);

  let cooldownTimer;
  const clearCooldown = () => { if (cooldownTimer != null) clearTimeout(cooldownTimer); cooldownTimer = null; };
  const update = state => {
    clearCooldown();
    dialog.dataset.walletState = state.status;
    dialog.setAttribute('aria-busy', String(state.busy));
    status.textContent = state.status === 'error' ? (state.error?.message || messages.error) : state.status === 'unavailable' ? (state.unavailableReason || messages.unavailable) : state.requiresAction ? 'Todo está preparado. Toca de nuevo para confirmar tu passkey.' : messages[state.status] || messages.idle;
    if (state.error?.cancelled) status.textContent = 'La confirmación se canceló. Puedes volver a intentarlo.';
    availability.hidden = state.availability?.available !== false || state.status === 'ready';
    availability.textContent = state.availability?.reason === 'ip_limit' ? 'Se agotó el cupo de USDC para esta conexión. Puedes crear o conectar tu wallet y continuar; la recepción de fondos seguirá pendiente.' : 'El faucet no tiene USDC disponibles en este momento. Puedes crear o conectar tu wallet y continuar; la recepción de fondos seguirá pendiente.';
    card.hidden = !state.address;
    address.textContent = state.address || '';
    balance.textContent = (state.balance || '0') + ' USDC';
    if (state.address) explorer.href = 'https://stellar.expert/explorer/testnet/contract/' + encodeURIComponent(state.address);
    const canAuthenticate = state.prepared && !state.busy && !state.address;
    create.hidden = !!state.address || state.status === 'unavailable';
    connect.hidden = create.hidden;
    create.textContent = state.pendingDeployment ? 'Retomar mi wallet' : 'Crear wallet con passkey';
    create.disabled = !canAuthenticate;
    connect.disabled = !canAuthenticate;
    receive.hidden = !state.address || !['connected', 'available'].includes(state.status);
    receive.disabled = state.busy;
    retry.hidden = !['error', 'pending', 'unavailable'].includes(state.status);
    retry.textContent = state.status === 'unavailable' ? 'Comprobar activación' : state.address ? state.claimState === 'failed' ? 'Reintentar recepción' : 'Comprobar recepción' : 'Volver a preparar';
    const retryAt = state.nextAvailableAt ? new Date(state.nextAvailableAt).getTime() : 0;
    retry.disabled = state.busy || retryAt > Date.now();
    if (Number.isFinite(retryAt) && retryAt > Date.now()) {
      status.textContent += ' Próximo intento: ' + new Date(retryAt).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + '.';
      if (dialog.open) {
        cooldownTimer = setTimeout(() => update(controller.state), Math.min(retryAt - Date.now() + 50, 2147483647));
        cooldownTimer?.unref?.();
      }
    }
    verify.hidden = !state.address; verify.disabled = state.busy || !state.canVerifyPasskey;
    verify.textContent = state.verificationBusy ? 'Verificando passkey…' : 'Verificar mi passkey';
    verification.hidden = !state.verificationBusy && !state.verificationError && !state.passkeyProof;
    verification.textContent = state.verificationBusy ? 'Confirma la passkey de esta misma wallet en tu teléfono.' : state.verificationError ? (state.verificationError.cancelled ? 'La verificación se canceló. Tu wallet sigue conectada.' : state.verificationError.message) : state.passkeyProof ? 'Passkey verificada para esta wallet.' : '';
    continueButton.textContent = state.status === 'ready' ? 'Continuar con mi wallet' : 'Continuar experiencia';
    const activationMs = state.timings.activation;
    timings.hidden = activationMs == null;
    if (activationMs != null) timings.textContent = 'Activación: ' + (activationMs / 1000).toFixed(1) + ' s';
  };
  const unsubscribe = controller.subscribe(update);
  const closePanel = () => { if (dialog.open) dialog.close(); };
  const onClosed = () => { clearCooldown(); onClose(); };
  const onCreate = () => { void controller.ensureWalletReady({ create: true }); };
  const onConnect = () => { void controller.connect(); };
  const onVerify = () => { void controller.verifyPasskey(); };
  const onReceive = () => { void controller.ensureWalletReady({ create: false }); };
  const onRetry = () => {
    const state = controller.state;
    if (!state.address) void controller.prepare();
    else if (state.claimState === 'failed') void controller.retryFunding();
    else void controller.refresh();
  };
  close.addEventListener('click', closePanel);
  continueButton.addEventListener('click', closePanel);
  create.addEventListener('click', onCreate);
  connect.addEventListener('click', onConnect);
  receive.addEventListener('click', onReceive);
  verify.addEventListener('click', onVerify);
  retry.addEventListener('click', onRetry);
  dialog.addEventListener('close', onClosed);
  return {
    open() { if (!dialog.open) dialog.showModal(); update(controller.state); return controller.refreshConfiguration ? controller.refreshConfiguration() : controller.prepare(); },
    close: closePanel,
    destroy() {
      clearCooldown();
      unsubscribe();
      close.removeEventListener('click', closePanel);
      continueButton.removeEventListener('click', closePanel);
      create.removeEventListener('click', onCreate);
      connect.removeEventListener('click', onConnect);
      receive.removeEventListener('click', onReceive);
      verify.removeEventListener('click', onVerify);
      retry.removeEventListener('click', onRetry);
      dialog.removeEventListener('close', onClosed);
    },
  };
}




