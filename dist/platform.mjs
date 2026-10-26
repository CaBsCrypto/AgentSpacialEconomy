import { platformContinuationUrl } from './platform-routing.mjs';

export const LANGUAGE_KEY = 'ars-language';
export const PAGE_TITLES = Object.freeze({
  en: 'Agentic Realities · Spatial AI for Venues and Events',
  es: 'Agentic Realities · IA espacial para recintos y eventos',
});
export const SPANISH_COPY = Object.freeze({
  metaDescription: 'Agentic Realities: IA espacial para recintos y eventos. Define objetivos y un presupuesto en USDC con tope; los agentes coordinan contenidos, datos, pantallas y AR para las personas de tu espacio, con un comprobante por cada pago.',
  skip: 'Ir al contenido',
  homeAria: 'Inicio de Agentic Realities',
  navAria: 'Navegación principal',
  navSpaces: 'Espacios',
  navServices: 'Servicios',
  navDemos: 'Demos',
  navHow: 'Cómo funciona',
  navQuote: 'Cotizar',
  languageAria: 'Idioma',
  heroEyebrow: 'IA espacial para recintos y eventos',
  heroTitle: 'Espacios que responden a sus personas',
  heroLede: 'Define objetivos y un presupuesto con tope. Los agentes coordinan contenidos, datos, pantallas y AR para todas las personas de tu espacio, y cada pago queda con su comprobante.',
  heroQuote: 'Solicitar cotización',
  heroDemos: 'Probar las demos',
  heroNote: 'Desde un evento de pocos días hasta un edificio abierto todo el año.',
  systemHeading: 'Un lugar. Una experiencia conectada.',
  systemDescription: 'Arquitectura ilustrativa: un lugar se conecta mediante QR o NFC con experiencias espaciales y una futura capa de servicios autorizados.',
  systemTitle: 'Un espacio físico conectado con experiencias digitales',
  sceneViewsAria: 'Explorar la maqueta',
  diagramSpace: 'Espacio',
  diagramEntry: 'Acceso',
  diagramExperience: 'Experiencias',
  sceneHint: 'Elige una vista para explorar la maqueta.',
  systemCaption: 'Concepto de plataforma · arquitectura ilustrativa',
  diagramServices: 'OBJETIVOS HUMANOS → ESPACIO → SERVICIOS AUTORIZADOS',
  approachAria: 'Propuesta de la plataforma',
  bridgeOne: 'Objetivos y un presupuesto con tope',
  bridgeTwo: 'Agentes que coordinan el espacio',
  bridgeThree: 'Experiencias que las personas ven y usan',
  whyEyebrow: 'Un nuevo espacio de oportunidades',
  whyTitle: 'Espacios físicos que trabajan para las personas que los recorren.',
  whyBody: 'Quien administra un espacio tiene ahora un nuevo tipo de operador: agentes que convierten un presupuesto en experiencias personalizadas, servicios mejor coordinados e indicadores de cómo las personas viven el espacio.',
  visitorLine: 'Para las personas, empieza de forma simple: escanear o acercar el teléfono, entrar al espacio y explorar.',
  managersTitle: 'Administradores y anfitriones',
  managersBody: 'Operadores de recintos, anfitriones de eventos, administradores de campus y edificios. Definen el mandato, aprueban lo que requiere aprobación y ven cada pago.',
  peopleTitle: 'Las personas del espacio',
  peopleBody: 'Asistentes, estudiantes, trabajadores y visitantes reciben experiencias pensadas para ellos: adónde ir, qué está pasando y a quién conocer.',
  brandsTitle: 'Marcas y patrocinadores',
  brandsBody: 'Pagan al espacio por tiempo en pantalla y activaciones, así el espacio gana además de gastar.',
  valueAria: 'Lo que gana un espacio',
  valuePersonalTitle: 'Experiencias personalizadas',
  valuePersonalBody: 'Cada persona encuentra lo que le importa: sesiones, stands, personas y ofertas, en 3D, en pantallas o en AR.',
  valueEfficiencyTitle: 'Eficiencia',
  valueEfficiencyBody: 'Los agentes compran datos, IA y contenidos por solicitud con los topes que tú defines. Proveedores y servicios esperan tu aprobación.',
  valueWellbeingTitle: 'Indicadores de bienestar',
  valueWellbeingBody: 'Objetivos, participación y uso del espacio, medidos para que puedas mostrar lo que tu espacio devuelve a las personas.',
  spacesEyebrow: 'Tipos de espacio',
  spacesTitle: 'Desde un evento de pocos días hasta espacios abiertos todo el año.',
  spacesBody: 'Un mandato, créditos y el mismo catálogo de recursos, adaptados a cada espacio.',
  spaceEventTime: 'Unos días',
  spaceEventTitle: 'Eventos y recintos',
  spaceEventBody: 'Conferencias, festivales, ferias y demo days. Objetivo de ejemplo: que los asistentes descubran proyectos y sesiones.',
  spaceYear: 'Todo el año',
  spaceCampusTitle: 'Universidades y campus',
  spaceCampusBody: 'Jornadas abiertas, laboratorios y vida estudiantil. Objetivo de ejemplo: conectar a estudiantes con programas, laboratorios y eventos.',
  spacePublicTitle: 'Edificios públicos',
  spacePublicBody: 'Centros cívicos, museos y bibliotecas. Objetivo de ejemplo: orientar a los visitantes y medir cómo se usan los servicios.',
  spaceCorporateTitle: 'Edificios corporativos',
  spaceCorporateBody: 'Oficinas, hubs de innovación y showrooms. Objetivo de ejemplo: coordinar visitas, salas y eventos internos.',
  spaceMallTitle: 'Centros comerciales',
  spaceMallBody: 'Malls y barrios comerciales. Objetivo de ejemplo: convertir pantallas y muros en espacios pagados y medibles.',
  chipMandate: 'Un mandato',
  chipCredits: 'Créditos',
  chipCatalog: 'Mismo catálogo de recursos',
  chipYear: 'Agentes operando todo el año',
  servicesEyebrow: 'Servicios',
  servicesTitle: 'Lo que entregamos en cada espacio.',
  servicesBody: 'Cada servicio muestra su estado actual: disponible, en piloto sobre Stellar testnet, planeado o a pedido.',
  phaseCurrent: 'Disponible',
  svcTwinTitle: 'Gemelo digital y activaciones AR',
  svcTwinBody: "Una versión 3D de tu espacio con accesos QR y NFC, además de vías experimentales de AR en dispositivos compatibles. La colocación física en AR aún no está verificada.",
  phaseRecorded: 'Ejecución registrada en testnet',
  svcAgentsTitle: 'Operación de agentes con mandato',
  svcAgentsBody: "Objetivos, créditos y un tope por compra registrados. Los agentes compran datos y contenidos mediante x402; las compras sobre el tope se bloquean para revisión del operador.",
  phasePilot: 'Piloto',
  svcScreensTitle: 'Tiempo en pantalla y patrocinios',
  svcScreensBody: "El panel muestra una orden registrada de pantalla por 5 USDC de prueba. El pago con passkey, la revisión de creatividades y la entrega en pantalla forman parte de un piloto controlado separado.",
  svcWalletTitle: 'Wallet de visitantes y Passport',
  svcWalletBody: "Una wallet con passkey y USDC de prueba, y una demostración del modelo de Stellar Passport. La sincronización de perfiles sigue planeada. Sin frase semilla.",
  phasePlanned: 'Planeado',
  svcIndicatorsTitle: 'Indicadores y reportes',
  svcIndicatorsBody: 'Avance de cada objetivo, en qué se usó cada crédito, cuánto recaudó el espacio y cómo participaron las personas.',
  phaseRequest: 'A pedido',
  svcCustomTitle: 'Entornos e integraciones a medida',
  svcCustomBody: 'Tu recinto modelado en 3D, tus canales y fuentes de datos conectados, tus proveedores en el catálogo.',
  plansEyebrow: 'Modelos de trabajo',
  plansTitle: "Elige un alcance. Prepara tu solicitud.",
  plansBody: "Modelos de trabajo propuestos: un mandato por evento o mensual, más un margen sobre servicios. La disponibilidad y el alcance del piloto se acuerdan antes de contratar.",
  planEventTime: 'Unos días · un recinto',
  planEventTitle: 'Piloto de evento',
  planEventBody: "Alcance propuesto: gemelo digital, acceso QR y NFC, y una demostración acotada de agentes. La publicidad y los reportes dependen de la validación del piloto.",
  planQuote: 'Cotizar',
  planSeasonTime: 'Varios eventos · uno o más recintos',
  planSeasonTitle: 'Temporada',
  planSeasonBody: "Alcance propuesto: reutilizar el piloto en varias fechas y evaluar después los patrocinios y el inventario de pantallas recurrentes.",
  planPermanentTime: 'Todo el año · mandato mensual',
  planPermanentTitle: 'Espacio permanente',
  planPermanentBody: "Alcance propuesto: adaptar el piloto a un campus, edificio o centro comercial. La operación continua de agentes y los indicadores siguen planeados.",
  demosEyebrow: 'Pruébalo',
  demosTitle: 'Dos demos, dos miradas.',
  demoVisitorTag: 'B2C · Para visitantes',
  demoVisitorTitle: 'Recorre el espacio',
  demoVisitorBody: 'Entra al gemelo digital de ONE16, encuentra cada activación, crea en el tótem una wallet con passkey y USDC de prueba, y abre el Stellar Passport.',
  demoVisitorMain: 'Entrar a ONE16',
  demoVisitorAlt: 'Passport espacial',
  demoHostTag: 'B2B · Para administradores y anfitriones',
  demoHostTitle: 'Opera el espacio',
  demoHostBody: "Revisa el mandato registrado, los presupuestos en créditos, los comprobantes de testnet y la compra bloqueada por superar el tope. El panel también muestra una orden registrada de pantalla; aquí no hay pago público de anuncios.",
  demoHostMain: 'Panel del operador',
  demoHostAlt: "Evidencia registrada de publicidad",
  demoNote: 'Ambas demos usan Stellar testnet con activos de prueba. Nada de lo que hagas ahí mueve dinero real.',
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
  previewActivate: 'Explorar mapa 3D',
  previewDone: 'Listo',
  previewZoomIn: 'Acercar',
  previewZoomOut: 'Alejar',
  previewReset: 'Restablecer vista',
  previewRetry: 'Reintentar vista previa',
  one16Preview: 'Entrar al espacio',
  previewInitial: 'La vista interactiva se carga al acercarte.',
  one16Caption: 'Render real del demo · interpretación independiente del lugar',
  one16Availability: 'Demo 3D disponible',
  one16Body: 'Recorre el pasillo de entrada, las zonas de encuentro, los stands y el escenario principal. Descubre la demostración de Stellar Passport y los próximos pasos del piloto de wallet. Esta interpretación independiente no implica una alianza oficial.',
  explore: 'Explorar ONE16',
  evolutionEyebrow: 'En qué punto está cada capa',
  evolutionTitle: 'Un espacio puede hacer más que mostrar contenido.',
  evolutionBody: 'Empezamos por un lugar que las personas puedan explorar y añadimos las capacidades que tengan sentido para su propietario, sus colaboradores y sus visitantes.',
  currentTitle: 'Una experiencia espacial compartida',
  currentBody: 'El recinto 3D de ONE16, los accesos QR/NFC y la demostración de Passport forman la experiencia actual.',
  pilotTitle: 'Acceso a wallet en Stellar Testnet',
  pilotBody: 'Se están validando wallets con passkey, continuidad de sesión y fondeo con USDC de prueba. Los activos de prueba no tienen valor real.',
  advertisingTitle: 'Publicidad programable',
  advertisingBody: "Un piloto controlado separado en testnet completó una compra con passkey y cinco pases de pantalla de un minuto. Las compras públicas aún no están disponibles. Revisa la evidencia registrada en testnet.",
  agentsTitle: 'Servicios autorizados de agentes',
  agentsBody: 'La demo registrada compra datos del venue y una tarjeta para el escenario mediante x402, dentro de un presupuesto definido por personas. Abre el dashboard para revisar cada pago de testnet.',
  foundationEyebrow: 'La plataforma que lo conecta',
  foundationTitle: 'Construida alrededor de un lugar.\nAbierta a lo que sigue.',
  foundationLede: 'Los organizadores pueden encargar entornos inmersivos a medida. Las marcas y los desarrolladores pueden encargar activaciones y servicios dentro de esos espacios. La publicidad programable es la siguiente capa de producto.',
  browserTitle: 'Descubrir desde el navegador',
  browserBody: 'Web 3D, acceso QR/NFC y opciones de AR en dispositivos compatibles, sin convertir la wallet en el primer paso.',
  stellarTitle: 'Stellar para las transacciones',
  stellarBody: "La demo de agentes combina x402 y USDC de prueba con un tope de presupuesto SEP-41. El panel muestra una orden de publicidad pagada y registrada en un contrato de Soroban. Las wallets de visitantes siguen como piloto separado.",
  quoteEyebrow: 'Solicitar cotización',
  quoteTitle: 'Cuéntanos sobre tu espacio.',
  quoteBody: "Elige el tipo de espacio, el alcance y lo que quieres lograr. Prepara una solicitud para copiar y compartir por un canal de contacto que ya uses.",
  quotePrivacy: "Tu solicitud permanece en esta página hasta que la copies. Este sitio no envía ni guarda tus datos. El envío por correo aún no está disponible.",
  contactTitle: '¿Prefieres conversar primero?',
  fieldSpace: 'Tipo de espacio',
  optEvent: 'Evento o recinto',
  optCampus: 'Universidad o campus',
  optPublic: 'Edificio público',
  optCorporate: 'Edificio corporativo',
  optMall: 'Centro comercial',
  optOther: 'Otro',
  fieldScope: 'Alcance',
  optScopeEvent: 'Piloto de evento (unos días)',
  optScopeSeason: 'Temporada (varios eventos)',
  optScopePermanent: 'Espacio permanente (todo el año)',
  fieldPeople: 'Personas esperadas',
  optPeopleSmall: 'Hasta 500',
  optPeopleMedium: 'De 500 a 5.000',
  optPeopleLarge: 'Más de 5.000',
  fieldBudget: 'Rango de presupuesto',
  optBudgetUnknown: 'Aún no lo sé',
  optBudgetLow: 'Menos de USD 5.000',
  optBudgetMid: 'De USD 5.000 a 20.000',
  optBudgetHigh: 'Más de USD 20.000',
  fieldServices: 'Servicios',
  fieldGoal: '¿Qué quieres lograr y cuándo?',
  fieldName: 'Tu nombre',
  fieldOrg: 'Organización',
  fieldEmail: 'Correo',
  fieldCity: 'Ciudad y país',
  quoteUnavailable: 'Activa JavaScript para preparar una solicitud. No se envía ningún dato ingresado aquí.',
  quoteSubmit: 'Preparar mi solicitud',
  quoteError: 'Agrega tu nombre, un correo válido, el tipo de espacio y el alcance.',
  quoteReady: "Tu solicitud está lista para copiar. Compártela por tu canal de contacto habitual; esta página no la ha enviado.",
  quoteCopy: 'Copiar solicitud',
  closingEyebrow: 'Tu espacio, lo que viene',
  closingTitle: 'Imagina en qué podría\nconvertirse tu espacio.',
  footerLine: 'IA espacial para recintos y eventos.',
  footerStatus: 'Prototipo de plataforma independiente · Stellar testnet · 2026',
  footerDashboard: 'Panel ↗',
  footerContact: "Preparar solicitud",
  backTop: 'Volver arriba ↑',
});
const ENGLISH_LINES = Object.freeze({
  howTitle: 'One way in.\nMore ways to interact.',
  foundationTitle: 'Built around a place.\nOpen to what comes next.',
  closingTitle: 'Imagine what your\nspace could become.',
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

/** Quote requests stay on the visitor's device and can only be copied explicitly. */
export const QUOTE_SUBJECT = Object.freeze({ en: 'Quote request · Agentic Realities', es: 'Solicitud de cotización · Agentic Realities' });
const QUOTE_FEEDBACK = Object.freeze({
  en: { copied: 'Request copied. You can paste it into your usual contact channel.', failed: 'Copy was unavailable. Select the request above and copy it manually.' },
  es: { copied: 'Solicitud copiada. Puedes pegarla en tu canal de contacto habitual.', failed: 'No se pudo copiar. Selecciona la solicitud de arriba y cópiala manualmente.' },
});
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function validateQuote(values = {}) {
  return Boolean(String(values.name || '').trim() && EMAIL_PATTERN.test(String(values.email || '').trim()) && values.space && values.scope);
}
export function buildQuoteRequest(rows = [], { language = 'en' } = {}) {
  const subject = QUOTE_SUBJECT[language === 'es' ? 'es' : 'en'];
  const body = rows.filter(([label, value]) => label && value).map(([label, value]) => label + ': ' + value).join('\n');
  return { subject, body, text: subject + '\n\n' + body };
}
export function readQuoteForm(form) {
  const rows = [], values = {};
  for (const field of form.querySelectorAll('[data-quote-field]')) {
    const label = field.querySelector('[data-quote-label]')?.textContent.trim() || '';
    const select = field.querySelector('select'), checks = [...field.querySelectorAll('input[type="checkbox"]')];
    let value = '';
    if (select) { values[select.name] = select.value; value = select.options[select.selectedIndex]?.textContent.trim() || ''; }
    else if (checks.length) {
      const chosen = checks.filter(check => check.checked);
      values[checks[0].name] = chosen.map(check => check.value);
      value = chosen.map(check => check.closest('label')?.textContent.trim() || check.value).join(', ');
    } else {
      const input = field.querySelector('input,textarea');
      if (input) { values[input.name] = input.value; value = input.value.trim(); }
    }
    rows.push([label, value]);
  }
  return { rows, values };
}
export function mountQuoteForm({ documentRef, getLanguage = () => 'en', clipboard = globalThis.navigator?.clipboard } = {}) {
  const form = documentRef?.getElementById?.('quoteForm');
  if (!form) return null;
  const error = form.querySelector('[data-quote-error]'), result = form.querySelector('[data-quote-result]');
  const summary = form.querySelector('[data-quote-summary]'), copy = form.querySelector('[data-quote-copy]');
  const prepare = form.querySelector('[data-quote-prepare]'), unavailable = form.querySelector('[data-quote-unavailable]');
  const copyStatus = form.querySelector('[data-quote-copy-status]');
  const bindings = [];
  const on = (node, type, listener) => { node?.addEventListener(type, listener); bindings.push([node, type, listener]); };
  const clearResult = () => { if (result) result.hidden = true; if (copyStatus) copyStatus.hidden = true; };
  on(form, 'input', clearResult);
  on(form, 'change', clearResult);
  on(prepare, 'click', () => {
    const { rows, values } = readQuoteForm(form);
    if (copyStatus) copyStatus.hidden = true;
    if (!validateQuote(values)) { if (error) error.hidden = false; if (result) result.hidden = true; return; }
    if (error) error.hidden = true;
    const request = buildQuoteRequest(rows, { language: getLanguage() });
    if (summary) summary.textContent = request.text;
    if (result) result.hidden = false;
  });
  on(copy, 'click', async () => {
    const feedback = QUOTE_FEEDBACK[getLanguage() === 'es' ? 'es' : 'en'];
    let message = feedback.failed;
    try {
      if (clipboard?.writeText) { await clipboard.writeText(summary?.textContent || ''); message = feedback.copied; }
    } catch {}
    if (copyStatus) { copyStatus.textContent = message; copyStatus.hidden = false; }
  });
  for (const link of documentRef.querySelectorAll('[data-quote-scope]')) {
    on(link, 'click', () => { const scope = form.querySelector('#quoteScope'); if (scope) scope.value = link.dataset.quoteScope; clearResult(); });
  }
  if (prepare) prepare.disabled = false;
  if (unavailable) unavailable.hidden = true;
  return { destroy() { if (prepare) prepare.disabled = true; if (unavailable) unavailable.hidden = false; for (const [node, type, listener] of bindings) node?.removeEventListener(type, listener); } };
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
  const quoteTask=mountQuoteForm({documentRef,getLanguage:()=>language});
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
    destroy() { sceneTask?.destroy();previewTask?.destroy();quoteTask?.destroy(); for (const [button, listener] of bindings) button.removeEventListener('click', listener); },
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


