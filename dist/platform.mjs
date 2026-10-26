import { platformContinuationUrl } from './platform-routing.mjs';

export const LANGUAGE_KEY = 'ars-language';
export const PAGE_TITLES = Object.freeze({
  en: 'Agentic Reality Space | Events you can explore',
  es: 'Agentic Reality Space | Eventos para explorar',
});
export const SPANISH_COPY = Object.freeze({
  metaDescription: 'Experiencias espaciales a medida para eventos. Conecta lugares físicos con exploración 3D, AR y una futura capa de transacciones programables.',
  skip: 'Ir al contenido',
  homeAria: 'Inicio de Agentic Reality Space',
  navAria: 'Navegación principal',
  languageAria: 'Idioma',
  navIdea: 'La idea',
  navHow: 'Cómo funciona',
  heroEyebrow: 'Una nueva dimensión para tu evento',
  heroTitle: 'Convierte tu evento en una experiencia para explorar',
  heroLede: 'Transforma un lugar físico en una experiencia digital conectada. Un espacio para que las personas descubran, las marcas participen y surjan nuevas interacciones.',
  explore: 'Explorar ONE16',
  how: 'Cómo funciona',
  heroNote: 'Empieza por el espacio. Abre la siguiente capa cuando la necesites.',
  sceneViewsAria: 'Explorar la maqueta',
  previewActivate: 'Explorar mapa 3D',
  previewDone: 'Listo',
  previewZoomIn: 'Acercar',
  previewZoomOut: 'Alejar',
  previewReset: 'Restablecer vista',
  previewRetry: 'Reintentar vista previa',
  previewInitial: 'La vista interactiva se carga al acercarte.',
  systemHeading: 'Un lugar. Una experiencia conectada.',
  systemTitle: 'Un espacio físico conectado con experiencias digitales',
  systemDescription: 'Arquitectura ilustrativa: un lugar se conecta mediante QR o NFC con experiencias espaciales y una futura capa de servicios autorizados.',
  diagramSpace: 'Espacio',
  diagramEntry: 'Acceso',
  diagramExperience: 'Experiencias',
  diagramServices: 'OBJETIVOS HUMANOS → ESPACIO → SERVICIOS AUTORIZADOS',
  systemCaption: 'Concepto de plataforma · arquitectura ilustrativa',
  sceneHint: 'Elige una vista para explorar la maqueta.',
  approachAria: 'Propuesta de la plataforma',
  bridgeOne: 'Un lugar real como punto de partida',
  bridgeTwo: 'Un espacio digital para explorar',
  bridgeThree: 'Una capa de interacción que evoluciona',
  whyEyebrow: 'Para quienes hacen posible el evento',
  whyTitle: 'Lleva la experiencia más allá del plano.',
  whyBody: 'Carteles, enlaces, stands y activaciones individuales pueden sentirse desconectados. Los reunimos en una experiencia espacial compartida, construida alrededor del lugar y su propósito.',
  visitorLine: 'Para las personas, empieza de forma simple: escanear o acercar el teléfono, entrar al espacio y explorar.',
  organizersTitle: 'Organizadores',
  organizersBody: 'Dale a tu evento una puerta de entrada digital: un entorno a medida, diseñado según el lugar, la programación y el recorrido de sus visitantes.',
  brandsTitle: 'Marcas',
  brandsBody: 'Crea una presencia que las personas puedan descubrir mediante espacios, historias e interacciones de marca dentro del evento.',
  developersTitle: 'Desarrolladores',
  developersBody: 'Construye experiencias alrededor de lugares reales, con una base compartida de acceso espacial y futuras transacciones.',
  howEyebrow: 'De un punto de contacto físico a un lugar digital',
  howTitle: 'Una forma de entrar.\nMás formas de interactuar.',
  stepOneTitle: 'Escanea. Acerca. Entra.',
  stepOneBody: 'Un código QR, una tarjeta NFC o un enlace abre la plataforma en el navegador de la persona.',
  stepTwoTitle: 'Explora el espacio.',
  stepTwoBody: 'Descubre el lugar en 3D y abre sus experiencias espaciales disponibles. El acceso a AR depende del dispositivo y del navegador.',
  stepThreeTitle: 'Abre la siguiente capa.',
  stepThreeBody: 'Añade identidad y transacciones cuando una experiencia las necesite. La capa de wallet está actualmente en un piloto de Stellar Testnet.',
  stepThreeTag: 'WALLET / PILOTO TESTNET',
  howNote: 'Primero, explora. Esta página no solicita acceso a la cámara ni una wallet.',
  one16Eyebrow: 'La primera experiencia pública',
  one16Location: 'Lisboa, Portugal',
  one16Intro: 'Un lugar real se convierte en el punto de partida de una experiencia espacial a la que puedes entrar hoy.',
  one16ImageAria: 'Explorar el espacio 3D de ONE16',
  one16ImageAlt: 'Reconstrucción 3D interpretativa de ONE16, con su pasillo de entrada, el recinto, las zonas de encuentro y el escenario principal',
  one16Preview: 'Entrar al espacio',
  one16Caption: 'Render real del demo · interpretación independiente del lugar',
  one16Availability: 'Demo 3D disponible',
  one16Body: 'Recorre el pasillo de entrada, las zonas de encuentro, los stands y el escenario principal. Descubre la demostración de Stellar Passport y los próximos pasos del piloto de wallet. Esta interpretación independiente no implica una alianza oficial.',
  evolutionEyebrow: 'Una experiencia con espacio para evolucionar',
  evolutionTitle: 'Un espacio puede hacer más que mostrar contenido.',
  evolutionBody: 'Empezamos por un lugar que las personas puedan explorar y añadimos las capacidades que tengan sentido para su propietario, sus colaboradores y sus visitantes.',
  phaseCurrent: 'Disponible',
  phasePilot: 'Piloto',
  phasePlanned: 'Planeado',
  currentTitle: 'Una experiencia espacial compartida',
  currentBody: 'El recinto 3D de ONE16, los accesos QR/NFC y la demostración de Passport forman la experiencia actual.',
  pilotTitle: 'Acceso a wallet en Stellar Testnet',
  pilotBody: 'Se están validando wallets con passkey, continuidad de sesión y fondeo con USDC de prueba. Los activos de prueba no tienen valor real.',
  advertisingTitle: 'Publicidad programable',
  advertisingBody: 'Smart contracts para espacios publicitarios y experiencias de marca, con reglas definidas por el propietario del lugar.',
  agentsTitle: 'Servicios autorizados de agentes',
  agentsBody: 'Los agentes podrían coordinar servicios aprobados dentro de un mandato y presupuesto definidos por personas, incluidos pagos por servicios mediante x402.',
  foundationEyebrow: 'La plataforma que lo conecta',
  foundationTitle: 'Construida alrededor de un lugar.\nAbierta a lo que sigue.',
  foundationLede: 'Los organizadores pueden encargar entornos inmersivos a medida. Las marcas y los desarrolladores pueden encargar activaciones y servicios dentro de esos espacios. La publicidad programable es la siguiente capa de producto.',
  browserTitle: 'Descubrir desde el navegador',
  browserBody: 'Web 3D, acceso QR/NFC y opciones de AR en dispositivos compatibles, sin convertir la wallet en el primer paso.',
  stellarTitle: 'Stellar para las transacciones',
  stellarBody: 'El piloto utiliza passkeys, wallets de contrato y USDC de prueba. Los contratos de publicidad y los servicios de pago de agentes son integraciones futuras.',
  closingEyebrow: 'Conoce el primer espacio',
  closingTitle: 'Imagina en qué podría\nconvertirse tu evento.',
  footerLine: 'Lugares físicos. Posibilidades digitales.',
  footerStatus: 'Prototipo de plataforma independiente · 2026',
  backTop: 'Volver arriba ↑',
});
const ENGLISH_LINES = Object.freeze({
  howTitle: 'One way in.\nMore ways to interact.',
  foundationTitle: 'Built around a place.\nOpen to what comes next.',
  closingTitle: 'Imagine what your\nevent could become.',
});
export const SCENE_VIEWS = Object.freeze(['space', 'entry', 'experiences']);
export const SCENE_VIEW_COPY = Object.freeze({
  en: Object.freeze({space:'A venue shaped around your event.',entry:'A link, QR or NFC brings people into the space.',experiences:'Places for content, brand activations and future services.'}),
  es: Object.freeze({space:'Un recinto diseñado alrededor de tu evento.',entry:'Un enlace, QR o NFC conecta a las personas con el espacio.',experiences:'Espacios para contenidos, activaciones de marca y futuros servicios.'}),
});
export function updateSceneCaption(documentRef, view = documentRef.getElementById?.('platformScene')?.dataset.activeView || 'space') {
  const selected = SCENE_VIEWS.includes(view) ? view : 'space';
  const host = documentRef.getElementById?.('platformScene');
  if(host) host.dataset.activeView = selected;
  const caption = documentRef.querySelector?.('[data-scene-caption]');
  if(caption) caption.textContent = SCENE_VIEW_COPY[documentRef.documentElement.lang === 'es' ? 'es' : 'en'][selected];
  for(const button of documentRef.querySelectorAll('[data-scene-view]')) button.setAttribute('aria-pressed',String(button.dataset.sceneView === selected));
  return selected;
}
const originals = new WeakMap();

export function resolvePlatformLanguage({ search = '', storedLanguage } = {}) {
  const query = new URLSearchParams(search).get('lang');
  if (query === 'en' || query === 'es') return query;
  return storedLanguage === 'es' ? 'es' : 'en';
}

function original(node, attribute) {
  let values = originals.get(node);
  if (!values) { values = new Map(); originals.set(node, values); }
  if (!values.has(attribute)) values.set(attribute, attribute === 'text' ? (ENGLISH_LINES[node.dataset.i18n] || node.textContent) : node.getAttribute(attribute));
  return values.get(attribute);
}

export function applyPlatformLanguage(documentRef, requestedLanguage) {
  const language = requestedLanguage === 'es' ? 'es' : 'en';
  for (const node of documentRef.querySelectorAll('[data-i18n]')) {
    const english = original(node, 'text');
    node.textContent = language === 'es' ? (SPANISH_COPY[node.dataset.i18n] ?? english) : english;
  }
  for (const [source, target] of [['data-i18n-content', 'content'], ['data-i18n-aria', 'aria-label'], ['data-i18n-alt', 'alt']]) {
    for (const node of documentRef.querySelectorAll('[' + source + ']')) {
      const english = original(node, target), key = node.getAttribute(source);
      node.setAttribute(target, language === 'es' ? (SPANISH_COPY[key] ?? english) : english);
    }
  }
  documentRef.documentElement.lang = language;
  documentRef.documentElement.dataset.language = language;
  documentRef.title = PAGE_TITLES[language];
  for (const button of documentRef.querySelectorAll('[data-language]')) button.setAttribute('aria-pressed', String(button.dataset.language === language));
  for(const link of documentRef.querySelectorAll('[data-one16-link],a[href="/one16"]')) {
    link.setAttribute('data-one16-link','');link.setAttribute('href','/one16?lang='+language);
  }
  updateSceneCaption(documentRef);
  return language;
}

/** Two frame boundaries leave the first page paint free of the scene dependency graph. */
export function deferPlatformScene({
  host, documentRef = host.ownerDocument, onSelectView = () => {},
  loadScene = () => import('./platform-scene.mjs?v=premium-1'),
  requestFrame = callback => globalThis.requestAnimationFrame(callback),
  cancelFrame = id => globalThis.cancelAnimationFrame(id),
} = {}) {
  let disposed=false,first=0,second=0,scene,selected='space';
  first=requestFrame(()=>{first=0;second=requestFrame(()=>{
    second=0;if(disposed)return;
    Promise.resolve().then(loadScene).then(module=>{
      if(disposed)return;
      scene=module.mountPlatformScene(host,{documentRef,onSelectView});
      scene.setView?.(selected);
    }).catch(()=>{if(!disposed)host.dataset.sceneState='fallback';});
  });});
  return {
    setView(view){selected=SCENE_VIEWS.includes(view)?view:'space';scene?.setView?.(selected);},
    destroy(){disposed=true;if(first)cancelFrame(first);if(second)cancelFrame(second);scene?.dispose();},
  };
}

/** The real venue graph is fetched only when its section approaches the viewport. */
export function deferOne16Preview({
  host,language='en',loadPreview=()=>import('./one16-preview.mjs?v=1'),
  windowRef=host.ownerDocument?.defaultView||globalThis,
  IntersectionObserverClass=windowRef.IntersectionObserver,
}={}) {
  let disposed=false,started=false,controller,observer,error=false;
  const retry=host.querySelector('[data-preview-retry]');
  const failure=()=>{host.dataset.previewState='error';const status=host.querySelector('[data-preview-status]');if(status)status.textContent=language==='es'?'No se pudo cargar la vista previa. Puedes reintentar o entrar al recorrido.':'The preview could not load. Retry or enter the full experience.';if(retry)retry.hidden=false;};
  const start=()=>{
    if(disposed||started)return;started=true;
    Promise.resolve().then(loadPreview).then(module=>{
      if(disposed)return;error=false;observer?.disconnect();
      controller=module.mountOne16Preview(host,{language});
    }).catch(()=>{if(!disposed){started=false;error=true;failure();}});
  };
  const onRetry=()=>{if(error)start();};retry?.addEventListener('click',onRetry);
  const check=()=>{const rect=host.getBoundingClientRect();if(rect.top<=(windowRef.innerHeight||0)+200&&rect.bottom>=-200)start();};
  if(IntersectionObserverClass){observer=new IntersectionObserverClass(entries=>{if(entries.some(entry=>entry.isIntersecting))start();},{rootMargin:'200px'});observer.observe(host);}
  else{windowRef.addEventListener?.('scroll',check,{passive:true});windowRef.addEventListener?.('resize',check);check();}
  return {
    setLanguage(value){language=value==='es'?'es':'en';controller?.setLanguage(language);if(error)failure();},
    destroy(){disposed=true;observer?.disconnect();windowRef.removeEventListener?.('scroll',check);windowRef.removeEventListener?.('resize',check);retry?.removeEventListener('click',onRetry);controller?.dispose();},
  };
}

export function mountPlatform({
  documentRef = globalThis.document,
  locationRef = globalThis.location,
  historyRef = globalThis.history,
  storage,
} = {}) {
  const continuation = platformContinuationUrl(locationRef.href);
  if (continuation) {
    locationRef.replace(continuation);
    return { redirected: true, destroy() {} };
  }
  // Resolve legacy routes before touching preference storage or binding this page.
  let preferences = storage, storedLanguage;
  try { preferences ??= globalThis.localStorage; storedLanguage = preferences?.getItem(LANGUAGE_KEY); } catch {}
  let language = applyPlatformLanguage(documentRef, resolvePlatformLanguage({ search: locationRef.search, storedLanguage }));
  let sceneTask, previewTask;
  const change = requested => {
    language = applyPlatformLanguage(documentRef, requested);
    try { preferences?.setItem(LANGUAGE_KEY, language); } catch {}
    try {
      const url = new URL(locationRef.href);
      url.searchParams.set('lang', language);
      historyRef?.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch {}
    previewTask?.setLanguage(language);
    return language;
  };
  const host = documentRef.getElementById?.('platformScene');
  const setSceneView = view => {const selected=updateSceneCaption(documentRef,view);sceneTask?.setView(selected);};
  sceneTask = host ? deferPlatformScene({host,documentRef,onSelectView:setSceneView}) : null;
  const previewHost=documentRef.getElementById?.('one16Preview');
  previewTask=previewHost?deferOne16Preview({host:previewHost,language}):null;
  const bindings=[];
  for(const button of documentRef.querySelectorAll('[data-scene-view]')){
    const onClick=()=>setSceneView(button.dataset.sceneView);button.addEventListener('click',onClick);bindings.push([button,onClick]);
  }
  for (const button of documentRef.querySelectorAll('[data-language]')) {
    const onClick = () => change(button.dataset.language);
    button.addEventListener('click', onClick);
    bindings.push([button, onClick]);
  }
  return {
    redirected: false,
    get language() { return language; },
    setLanguage: change,
    setView:setSceneView,
    destroy() { sceneTask?.destroy();previewTask?.destroy(); for (const [button, listener] of bindings) button.removeEventListener('click', listener); },
  };
}

/** BFCache retains paused views; a real document exit releases both owned WebGL scenes. */
export function bindPlatformLifecycle(controller, windowRef = globalThis) {
  const release = () => windowRef.removeEventListener?.('pagehide',onHide);
  const onHide = event => { if(!event.persisted){release();controller.destroy();} };
  windowRef.addEventListener?.('pagehide',onHide);
  return release;
}
if (typeof document !== 'undefined') bindPlatformLifecycle(mountPlatform());


