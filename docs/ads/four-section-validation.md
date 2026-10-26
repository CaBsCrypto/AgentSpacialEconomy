# Validación de publicidad y pagos en cuatro secciones

La corrida nueva y su auditoría independiente verificaron **seis pagos únicos de 5 USDC de Testnet, total exacto 30 USDC**, y seis compromisos completos en un registro aislado. Todas las órdenes permanecen `Queued`, con entrega acreditada igual a cero. La combinación con los últimos cambios del piloto pasó las comprobaciones locales descritas abajo.

## Aislamiento y procedencia

- Rama local: `codex/validate-ads-four-sections`, creada desde `7fc2fb8` en `ads-four-sections-validation`.
- PR evaluado: [CaBsCrypto/AgentSpacialEconomy #30](https://github.com/CaBsCrypto/AgentSpacialEconomy/pull/30).
- `a9a3c40` conserva la corrección concurrente de recuperación de `33372de`; el archivo de prueba coincide exactamente con el original.
- `950aa15` incorpora y corrige el experimento, con una oferta independiente, verificación de pagos y separación entre grabación y entrega.
- `a5bfe1f58533dc0d17d434a2ed9b82cccdf01436` corrige el arranque. Es el commit exacto, con árbol limpio, que ejecutó la corrida nueva.
- Durante la validación, el original avanzó a `104770ec85cf66e933b2da623129d798de8cf83c`. Se conservaron también los cuatro archivos de `eae5282` y `104770e`: configuración de compatibilidad wallet, evidencia de preaudit, serialización JSON de previews y su prueba. Se copiaron byte a byte a esta rama. Al cierre, el original avanzó a `33bbc94a9346ab2e6e3e40216e871691e75a348b`, que solo actualiza documentación y evidencia del piloto completado por el trabajo concurrente; también se conservaron exactamente sus once archivos. Esa evidencia del piloto es independiente de los seis pagos y compromisos Queued de esta validación. [Comparación de los once archivos](four-section-validation/pilot-completion-source-hashes.json).
- No se modificó el checkout original ni se hizo push, merge o despliegue público. Únicamente se creó el registro **Testnet** autorizado. El correo referido era contexto recibido; no se enviaron correos.

## Comportamiento corregido

`/paid/ad-slot`, su oferta `main-stage-test-5m` y el checkout passkey conservan su contrato anterior. El piloto humano mantiene cinco pases completos de un minuto por 5 USDC de prueba. El experimento usa `/paid/ad-section` y `main-stage-section-test-5m`: una sección A–D durante 300000 ms por exactamente 5 USDC. Se valida la sección antes del pago.

El comprador valida red, activo, receptor e importe tanto en preflight como al firmar el desafío definitivo. Cada orden tiene un diario exclusivo por run ID y admite un solo intento de creación de payload. Un resultado incierto detiene la secuencia y exige conciliación de solo lectura; no se reintenta el cobro.

La contabilización usa unidades enteras y transferencias confirmadas, con pagador, receptor, activo, importe y hash correctos. Exige seis pagos únicos y saldo coherente. La auditoría reconstruye cada compromiso y verifica todos sus campos: orden, revisión, términos, manifiesto, pago, beneficiario, plazo, ubicación, plan, unidades e intervalo. También comprueba WASM, creación del contrato y las seis transacciones de registro.

`/one16` conserva la pantalla anfitriona y el piloto. `/one16?sections` es una demostración explícita: no publica ni envía atestaciones del piloto. El descarte de escena libera temporizadores y texturas; datos inválidos o consultas fallidas recuperan el anfitrión. El dashboard enlaza esa vista, identifica la grabación y distingue el informe fechado de la consulta actual de estados. Reproducir nunca incrementa ingresos, presupuesto o entrega.

La automatización produce un directorio exclusivo por ejecución, guarda fallos parciales con estado `FAILED` y no sobrescribe ni publica la grabación versionada. Se exige commit y run ID coherentes, seis pagos/30 USDC, seis compromisos y WASM esperado para declarar `VERIFIED`.

## Corrida nueva y conciliación

- Run ID: `2026-10-26T10:12:02.195Z` (07:12:02 de Santiago).
- Commit de ejecución: `a5bfe1f58533dc0d17d434a2ed9b82cccdf01436`; árbol limpio al iniciar.
- Estado: `VERIFIED`; auditoría independiente: `2026-10-26T10:17:10.364Z`.
- Red: `stellar:testnet`; activo: `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.
- Tesorería: [`GA27HQJ6GFTA5GENPVAEF634U2GJZ7Q6T7ITPNPBFSHAN4QULMTDF2CJ`](https://stellar.expert/explorer/testnet/account/GA27HQJ6GFTA5GENPVAEF634U2GJZ7Q6T7ITPNPBFSHAN4QULMTDF2CJ); saldo inicial `0.0000000`, final `30.0000000` USDC.
- Registro: [`CANKOM7W6ZEQA7H32XYQ65YDN3I4WYR6K37EVIF72OIN5ID3TXXL2LW4`](https://stellar.expert/explorer/testnet/contract/CANKOM7W6ZEQA7H32XYQ65YDN3I4WYR6K37EVIF72OIN5ID3TXXL2LW4); [transacción de creación](https://stellar.expert/explorer/testnet/tx/f67b29bd7c3239e43459949af8e68248a84bc1d2ee1837b63a655b4631dc015c).
- WASM esperado y leído: `d9caf94b2dfb159c7d46bf5779d358d6cced9ee7a94bd69e2bb1fa354b5ee526`.
- Total: `300000000` unidades, `30` USDC; seis intentos y seis pagos confirmados.

| Orden / sección | Pagador | Pago de 5 USDC | Registro | Intervalo UTC / estado |
| --- | --- | --- | --- | --- |
| #1 / A | [`GCFXW7UW…`](https://stellar.expert/explorer/testnet/account/GCFXW7UWP77KW7HHKHFJYWZN6HZMMY7TPXLWZMA542K3VEDBCOIK6PFW) | [`09033a1175e6…`](https://stellar.expert/explorer/testnet/tx/09033a1175e64c15810488ba34d7cc81b109e716fbaea2655e22f69ce47ea5eb) | [`13d6250ddf5e…`](https://stellar.expert/explorer/testnet/tx/13d6250ddf5e8b5f1431f80446ab82083ff60c5b4f65bddfb4f8636dd2353e71) | 10:14:07.371–10:19:07.371 / Queued, 0 ms |
| #2 / B | [`GALC2QKS…`](https://stellar.expert/explorer/testnet/account/GALC2QKS55OQVQXTVTVCF4Z57SQ6SCRZWWKIVGPYCNYQIMBTUB7UN2WR) | [`5e96d9eecc03…`](https://stellar.expert/explorer/testnet/tx/5e96d9eecc03e169a99191de47709beb3e93c2c0c745299473441414bc7194d4) | [`916f2d9cb2f3…`](https://stellar.expert/explorer/testnet/tx/916f2d9cb2f3a67f7f724ea8426f8c4284304f78be95eca88153788476a955c4) | 10:14:22.689–10:19:22.689 / Queued, 0 ms |
| #3 / C | [`GDVP4VEH…`](https://stellar.expert/explorer/testnet/account/GDVP4VEH25UARY3MGQ2ZNUOFDEDPKJJ7BKWSJKAR37VYL4ZDXWU3VWZK) | [`2ee97b728bc2…`](https://stellar.expert/explorer/testnet/tx/2ee97b728bc2ec358e2a5779399e9d9b028b0436e42c99a6e7805c65761b0ca7) | [`63d62ebecc27…`](https://stellar.expert/explorer/testnet/tx/63d62ebecc271474dcdf13183e540be05f8509681814a0e3fccba4751ece3296) | 10:14:32.395–10:19:32.395 / Queued, 0 ms |
| #4 / D | [`GBPL2JMC…`](https://stellar.expert/explorer/testnet/account/GBPL2JMCHNSHNRMDOZ6AIWXZKNWDOEL32IUFSVDVSMGYMACPDAAAA5SI) | [`ea696a614c7f…`](https://stellar.expert/explorer/testnet/tx/ea696a614c7fa60c2e363d09a1a296fdbdaed03583e386e3c9aec083ae506095) | [`363c9dad19c8…`](https://stellar.expert/explorer/testnet/tx/363c9dad19c8cbe57a09fc86191f8b05fe9306be8e15998755f58ac17618d351) | 10:14:42.131–10:19:42.131 / Queued, 0 ms |
| #5 / A | [`GCNSRFGT…`](https://stellar.expert/explorer/testnet/account/GCNSRFGTM66V5ZLPLH7WBQS3O36THKZMFDXLFHKQLG4P37HA32LABYIT) | [`ad714b3fe0bc…`](https://stellar.expert/explorer/testnet/tx/ad714b3fe0bc1cb0f75cb844d3d7f5dc83065ffc68b92bb91e4b38062be6ea4f) | [`7d5641c241ec…`](https://stellar.expert/explorer/testnet/tx/7d5641c241ecb3ce141f02fb8b0a11842db3b791e416f8d9ea5119af982e60a2) | 10:19:07.371–10:24:07.371 / Queued, 0 ms |
| #6 / C | [`GCRBS7IX…`](https://stellar.expert/explorer/testnet/account/GCRBS7IXADEKR6T737S5JAEDUR4T2CKXN4EHYRVKIPIU6QEYDEZT2BFN) | [`91b5a764fe0d…`](https://stellar.expert/explorer/testnet/tx/91b5a764fe0d2c13a1636931245c3a91d2397fe0dfa4f7159f05539a12f1e948) | [`c106e6208a5d…`](https://stellar.expert/explorer/testnet/tx/c106e6208a5d0fa687f195b11f83604fa6eb676196702bb9a17dfde0567f1709) | 10:19:32.395–10:24:32.395 / Queued, 0 ms |

Los hashes completos, las identidades, los términos y los resultados de lectura están en [fresh-audit.json](four-section-validation/fresh-audit.json). El resultado original de la ejecución está en [fresh-run.json](four-section-validation/fresh-run.json); ambos conservan su propia fecha de comprobación. La auditoría de las 10:17:10 UTC confirmó por separado las seis transferencias y las siete transacciones del registro.

La secuencia es A/B/C/D/A/C. Cada intervalo dura exactamente 300000 ms; las segundas órdenes de A y C comienzan al terminar las primeras, sin solapamientos dentro de una sección. Se compró tiempo y se registraron compromisos; no se acreditó reproducción, audiencia ni entrega.

## Grabación histórica y diagnóstico fallido

La grabación versionada sigue siendo la corrida `2026-10-26T08:56:32.475Z`, procedente de `62c34e6e1d79f77c3c5e04f3ba4db84602229826`. Se auditó en modo lectura: seis pagos, 30 USDC y siete transacciones de registro. Su informe es [historical-audit.json](four-section-validation/historical-audit.json). No se reutilizó como resultado nuevo ni se reinterpretaron sus términos antiguos como la nueva oferta.

El primer intento nuevo, `2026-10-26T09:59:41.097Z`, sobre `950aa15`, terminó `FAILED` porque la espera de arranque de 20 segundos no bastó. Registra cero intentos publicitarios y cero órdenes. Sí hubo fondeo de cuentas temporales y un intercambio de tokens de prueba, identificados en [failed-startup-run.json](four-section-validation/failed-startup-run.json); no fueron compras publicitarias. Se conservó ese diagnóstico y se usó otra identidad/directorio para el intento exitoso.

La corrección verifica salud/red antes del fondeo, usa un plazo absoluto de 120 segundos y conserva diagnósticos del proceso. En la corrida exitosa el servicio estuvo listo en 7920 ms. El gasto publicitario nuevo total entre ambos intentos fue **30 USDC de Testnet**, sin cobros ambiguos ni repetidos.

## Pruebas y distinción de fallos

| Comprobación | Resultado final | Evidencia |
| --- | --- | --- |
| Build combinado | PASS: origen, wallet, ads y acceso QR/NFC | [build.txt](four-section-validation/build.txt) |
| Frontend / raíz combinada | **771 pasan, 0 fallos, 2 omitidos**; 773 casos, 307,4 s | [frontend-tests.txt](four-section-validation/frontend-tests.txt) |
| Agente | **73 pasan, 0 fallos, 0 omitidos** | [agent-tests.txt](four-section-validation/agent-tests.txt) |
| Suites de base de datos | **40 pasan, 0 fallos, 0 omitidos**, incluidos cuatro casos de preview JSON | [postgres-summary.json](four-section-validation/postgres-summary.json), [log](four-section-validation/postgres-tests.txt) |
| Contrato Rust | **9 pasan, 0 fallos** | [rust-summary.json](four-section-validation/rust-summary.json), [log](four-section-validation/rust-tests.txt) |
| Auditoría histórica | 6 pagos / 30 USDC; 7 transacciones de registro | [historical-audit.json](four-section-validation/historical-audit.json) |
| Corrida nueva y auditoría independiente | 6 pagos / 30 USDC; 7 transacciones de registro, WASM y compromisos completos | [fresh-audit.json](four-section-validation/fresh-audit.json) |

El código combinado probado está en `b8aa31a96ff41866fa19891da6a86464740ee94b`; los commits posteriores solo guardan documentación y evidencia. La primera suite completa corregida, anterior a los cuatro casos nuevos del piloto concurrente, pasó 767 casos con las mismas dos omisiones.

Los dos omitidos son el smoke Chromium serverless de Linux y una simulación Stellar opcional de lectura con SmartAccountKit. No se presentan como pruebas ejecutadas en Windows.

PostgreSQL 17.11 se ejecutó en `127.0.0.1:55432`, base aislada `ads_test`, con 13 migraciones y esquemas aleatorios. **Dos casos de corte eligen PGlite explícitamente**; los restantes fixtures, incluidos los tres nuevos de persistencia de preview, usan PostgreSQL nativo. El cuarto caso nuevo comprueba la conversión de parámetros de `pg` sin base. [Prueba del backend](four-section-validation/postgres-proof.json), [limpieza](four-section-validation/postgres-cleanup.json) y [parada](four-section-validation/postgres-stop.txt) confirman cero esquemas temporales y servidor detenido.

Rust usó Cargo 1.95.0, lockfile y dependencias offline. Permanecen seis advertencias previas por `Events::publish` obsoleto. El contrato no fue modificado.

El fallo previo de recuperación se reprodujo antes de incorporar el experimento: la ventana de 10 minutos no permitía el intento adicional con los intervalos actuales. El fixture corregido a 905 segundos conserva el caso de seis intentos para completar cinco pases; no modifica la oferta ni el planificador. Evidencias: [fallo reproducido](four-section-validation/baseline-recovery-failure.txt) y [caso corregido](four-section-validation/recovery-corrected.txt).

La primera suite tras la integración detectó seis fallos del harness de publicación Palta, que no cargaba el nuevo controlador. Se adaptó el harness y se añadieron comprobaciones de aislamiento del preview y descarte tardío; la suite completa posterior pasó. El fallo de arranque del runner se corrigió y se cubrió con ocho casos adicionales. La corrección PostgreSQL del preview procede del trabajo concurrente del piloto, no de una regresión introducida por las secciones.

Los casos negativos cubren cinco pagos de seis, hashes duplicados, pagador/receptor/activo/importe/red incorrectos, saldo inconsistente, compromiso alterado, WASM incorrecto, resultados de otro run/commit, desafío de pago cambiado y firma fallida. Las pruebas visuales cubren rotación A/B/C/D/A/C, límites sin solapamientos, datos inválidos, fallo de consulta, descarte y recreación de escenas.

## Navegador y límites

Se revisaron localmente wallet, oferta original, anuncios, navegación, anfitrión, preview y dashboard. El preflight HTTP verificó 400 para sección inválida/ausente, 402 para ambas ofertas y el requisito exacto de 5 USDC de la nueva ruta, sin firmas ni pagos: [resultado HTTP](four-section-validation/http-preflight.json).

Capturas:
- [Pantalla anfitriona](four-section-validation/default-stage.jpg).
- [Preview de cuatro secciones](four-section-validation/sections-preview.jpg).
- [Oferta original de cinco pases](four-section-validation/pilot-offer.jpg).
- [Dashboard con evidencia histórica separada](four-section-validation/dashboard-evidence.jpg).

La wallet local mostró que faltaba configuración privada; el checkout permaneció desactivado. No se efectuó autenticación humana, firma passkey ni una nueva compra del piloto. Se preservó la evidencia previa de compatibilidad y las correcciones concurrentes, pero esta validación no acredita una compra humana nueva ni cinco entregas del piloto. La venta real de secciones desde passkey, activar checkout y acreditar entrega quedan fuera del alcance.

`npm ci` no completó una instalación limpia por caché incompleta y errores `EEXIST`; atravesar la junction C:→D: también produjo errores de filesystem. Las pruebas/build usaron Node v22.20.0 y las dependencias instaladas del original mediante junctions, usadas solo para lectura. Los dos pares de lockfiles son semánticamente iguales. No se instaló sobre esos enlaces ni se modificaron dependencias/configuración privada del original. Esto valida la combinación con esas dependencias, no una instalación limpia de CI.

Las consultas de red prueban el estado observado en las fechas del informe. Una futura pérdida del histórico de Testnet o caída de RPC/Horizon debe producir un resultado no verificado, no reutilizar una marca verde antigua.

## Evidencia y reproducción

```text
npm run build
node --test --test-concurrency=2 test/*.test.mjs
cd agent
node --test --test-concurrency=2 test/*.test.mjs
# Desde la raíz, con PostgreSQL local aislado configurado:
node .ads-qa/run-native-combined.mjs
# CARGO_TARGET_DIR apunta a la ruta física de .ads-qa/cargo-target:
cargo +stable test --locked --offline --manifest-path contracts/ads-registry/Cargo.toml
# Ya ejecutado una vez; NO repetir compras para verificar:
node agent/screen-ci.mjs --out agent/out/validation-2026-10-26-ready
# Auditoría de lectura, salida nueva:
node agent/verify-screen.mjs --input agent/out/validation-2026-10-26-ready/screen.json --out NUEVO_ARCHIVO.json
```

Las claves temporales solo estuvieron en memoria/procesos; no forman parte de los artefactos. El escaneo no imprime coincidencias. [secret-scan.json](four-section-validation/secret-scan.json) registra el resultado, y [manifest.json](four-section-validation/manifest.json) identifica los artefactos por SHA-256.

La referencia oficial consultada mediante Raven explica que una transacción enviada puede permanecer pendiente y que se debe consultar su resultado final: [Stellar, sendTransaction y getTransaction](https://developers.stellar.org/docs/build/guides/dapps/frontend-guide#sendtransaction-and-gettransaction). La evidencia concreta de esta validación es el XDR y las lecturas registradas en los informes, no la mera respuesta de envío.
