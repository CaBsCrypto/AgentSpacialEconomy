# Interfaz de reservas de prueba

`/reservas` incorpora un catálogo público y, únicamente para la identidad de anfitrión verificada por el servidor, la edición de un proyecto. La página está en español, usa HTML y módulos nativos, y no carga Three.js, anuncios ni el controlador de fondeo de ONE16. El enlace de acceso está en el pie de la landing; las rutas históricas de ONE16 y NFC se conservan.

## Acceso y capacidades

La página consulta configuración, sesión y ofertas sin iniciar mutaciones. Conectar una wallet existente y verificar el acceso son acciones separadas. La integración usa `SmartAccountKit 0.9.1`, `IndexedDBStorage` con su configuración existente y el mismo origen/RP ID; el cierre de la sesión de reservas limpia el estado privado del documento sin borrar la passkey ni sus registros de ONE16. No hay creación de wallet, solicitud de saldo, faucet o deployment en este adaptador.

La ayuda de acceso dirige a «Wallet · Testnet» en ONE16 para comprobar una wallet existente. La aceptación de H4 verifica el regreso a `/reservas` y la conexión con la misma passkey en cada navegador del piloto. Consultar el catálogo no requiere una wallet. Reservar no requiere saldo USDC.

Las capacidades del servidor controlan cada acción. `mode=CONTROLLED` muestra el alcance del piloto; `identity.mayReserve` habilita nuevas reservas de marca. La interfaz nunca recibe una allowlist. Pausar admisión o retirar una marca bloquea preparación y firma nuevas, conservando la consulta de intentos y recibos. El servidor vuelve a verificar todos los permisos. Un 401, pérdida de rol, cierre de sesión o cambio de cuenta limpia los datos privados y cancela respuestas pendientes de la identidad anterior.

Un fallo temporal al consultar la sesión (incluidos 429 y 503) muestra «Consulta de sesión pendiente» y el mensaje correspondiente, conservando datos e intención conocidos. «Volver a consultar mi sesión» reintenta lecturas sin reconectar, preparar o firmar automáticamente. Un 401 confirma que no hay sesión activa; un fallo temporal no se presenta como cierre de sesión. Las firmas pendientes locales se invalidan mientras el acceso sea incierto.

La conexión real del SDK necesita la credencial existente y su procedencia verificable. Estas pruebas no demuestran recuperación de una wallet en otro dispositivo, disponibilidad de un indexador ni compatibilidad de un autenticador físico; esas comprobaciones corresponden a H4.

## Proyecto, mapa y revisión

El guardado es explícito. Los espacios nuevos reciben ID en el servidor y deben guardarse antes de colocarlos en el mapa. Un conflicto de revisión conserva el borrador local y muestra la versión remota para compararla; reemplazar el borrador requiere confirmación. El proyecto, conversación y `approvedSnapshot` se restauran desde el servidor, sin guardar información privada en localStorage.

El asistente devuelve una propuesta visible. Aplicarla exige revisar una casilla y pulsar «Aplicar y guardar propuesta». La revisión enumera el reemplazo de espacios y la eliminación de sus puntos; la imagen se conserva. Una respuesta no modifica, aprueba, publica ni firma automáticamente.

Los mensajes estructurados del asistente se restauran como campos de texto validados, sin interpretar HTML. «Revisar propuesta del historial» permite volver a abrir una propuesta guardada; no se presupone que siga pendiente ni se vuelve a aplicar al cargar la página.

Se admiten hasta 20 espacios y un punto por espacio. El mapa admite PNG/JPEG/WebP de hasta 2 MiB y 2048 píxeles por lado; el servidor repite validación y normalización. Los puntos se colocan por toque o mediante controles de coordenadas porcentuales accesibles por teclado. Una carga fallida conserva el mapa anterior. Reemplazar una imagen limpia los puntos y requiere guardar. La imagen se presenta completa en la revisión y se avisa de que será pública; sólo se incluye el punto del espacio elegido. Si la imagen de revisión no carga, aprobar, preparar o firmar esa revisión permanece deshabilitado.

## Preparación, firma y recuperación

La aprobación persiste una versión inmutable; no publica. Preparar es una segunda operación y firmar requiere una nueva acción explícita. Antes de obtener un token de firma, el navegador decodifica el HostFunction y su única autorización y compara acción, contrato, proyecto, espacio, oferta, actor, red, regla 0 y expiración con la revisión. Sólo admite `publish` o `reserve`, sin subinvocaciones. La firma debe conservar íntegra la autorización original salvo su campo de firma, incluyendo nonce y expiración. Editar el borrador invalida una firma de publicación aún no solicitada.

El token de firma vive sólo en memoria y se consume una vez. El cliente envía exactamente el XDR recibido y la autorización firmada; no construye pagos ni transacciones alternativas. El resumen completo de la versión vuelve a mostrarse antes de firmar, también después de recuperar una intención.

Los HTTP tienen un límite local de 20 segundos y no reintentan mutaciones. Si se pierde `prepare`, la UI consulta `auth/session.pendingAttempt` y después GET del intento. Si se pierde `submit`, presenta incertidumbre y consulta; no vuelve a firmar ni enviar. Un PREPARED recuperado requiere revisión explícita para obtener la misma preparación del servidor. SUBMITTING/PENDING se consultan como máximo cada 15 segundos mientras la pestaña está visible; NEEDS_RECONCILIATION permanece manual. El ID opaco `?intento=` permite volver a consultar un recibo, pero el servidor verifica su propietario y no lo considera autorización.

Sólo se muestra confirmación con estado CONFIRMED, un hash y ledger válidos y una proyección de oferta compatible con actor/oferta. El backend exige además la evidencia de transacción, evento y lectura de contrato descrita en `docs/reservations-backend.md`; el navegador no presenta un simple envío como éxito.

## Archivos y reproducción

- `dist/reservations.html`, `.css`, `.mjs`: página, estilo y controlador de flujo.
- `dist/reservations-api.mjs`, `reservations-state.mjs`, `reservations-wallet.mjs`: transporte, reglas de edición/recibos y validación/firma.
- `src/reservations-wallet-entry.mjs` y `scripts/build-reservations-wallet.mjs`: generación reproducible del bundle y sus licencias en `dist/vendor/reservations-wallet/`. No se edita ese bundle a mano.
- `scripts/serve-wallet.mjs`, `dist/platform-routing.mjs`, `vercel.json`: rutas adicionales a `/reservas` y `/api/reservations.js`, manteniendo URL original, cuerpo de imagen y respuestas sin caché.

Integrar primero los cambios de backend/dependencias: el package del backend declara `@simplewebauthn/browser 14.0.0`, Playwright `1.64.1`, Sharp y el script `build:reservations`. No instalar dependencias sobre las junctions usadas para esta implementación.

```sh
node scripts/build-reservations-wallet.mjs
node scripts/prepare-site-origin.mjs
node --test test/reservations-ui.test.mjs test/platform-routing.test.mjs test/site-origin.test.mjs
node --test --test-concurrency=2 test/*.test.mjs
cd agent && npm test
```

El verificador de navegador usa Playwright con un Chromium local instalado; no descarga navegadores. Por defecto usa la resolución de Playwright y permite un ejecutable existente mediante `PLAYWRIGHT_CHROMIUM_EXECUTABLE`:

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = '<ruta absoluta a Chromium o chrome-headless-shell.exe>'
node scripts/verify-reservations-ui.mjs
```

El script intercepta API y wallet mediante adaptadores de prueba, bloquea orígenes externos y genera un plano sintético. No contiene un fallback de producción. Sus capturas y resultados se escriben en `docs/reviews/reservations-ui/`, marcados **FIXTURE LOCAL · SIN FIRMAS NI RED**. Cubren acceso/restauración, edición, conflictos, propuesta explícita, cargas fallidas, límites de mapa, revisión, incertidumbre de prepare/submit, caducidad, permiso retirado, pausa y tamaños 360/390/768 px. Las comprobaciones XDR usan objetos de SDK locales; las del navegador no prueban una passkey real.

Esta evidencia permite revisar H3 y no sustituye H4. Todavía se requieren pruebas autorizadas con autenticadores físicos, dos cuentas y aislamiento, backend y PostgreSQL integrados, el contrato desplegado, recursos verificados y recibos reales en Testnet. Las pruebas con adaptadores no establecen disponibilidad ni cobertura económica de los proveedores reales. Mantener el modo deshabilitado o controlado según el gate del proyecto.
