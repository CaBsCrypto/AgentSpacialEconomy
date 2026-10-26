# Entrega final: guía hasta las empresas

Rama `codex/render-textures-ui`; base `349175e`. Revisión autorizada el 26 de octubre de 2026.

El tótem USDC está adelantado junto a la barra: posición Three `(2.6, 0, -5.6)`, aproximación `(2.6, -4.3)`. La ruta de entrada conserva los siete escalones. Tras confirmar una wallet Testnet con USDC y pulsar Continuar desde el tótem, se sustituye por un tramo común y dos ramales a Stellar Passport y DeFindex/Soroswap. Ambos pueden completarse en cualquier orden. Passport exige su primer fotograma real; Palta exige interacción manual visible. Cada ramal visitado se atenúa; tras ambos se apaga la guía y aparece «Recorrido completado».

El avance se conserva por pestaña, wallet y configuración, incluido el retorno de AR y la reconstrucción de escena. «Reiniciar guía» conserva la wallet. La palta tiene pedestal al 87,5% y fruto al 108%, también en animación. Los ocho separadores tienen nombres horizontales; las gráficas de las mesas permanecen intactas. No hay referencias numeradas públicas; se conservan IDs y accesos funcionales.

## Verificación

| Comprobación | Resultado |
|---|---|
| Frontend | 446 pasan; 1 prueba opcional preexistente omitida |
| Agente | 34 pasan |
| UI: cuatro tamaños, paneles abiertos/cerrados | 5 pasan |
| Entrada: caminar, escalones, toque y reconstrucción | [37 pasan](entry/activation-guide-browser.json) |
| Recorrido completo: ambos órdenes, estados wallet, gestos y movimiento reducido | [20 pasan](flow/guided-tour-browser.json) |
| Plano de empresas en cuatro tamaños | [7 pasan](map/guided-tour-browser.json) |
| Modelo del recinto | 4.001 MiB gzip, presupuesto 5 MiB; 32 imágenes decodificadas |
| Comparación GPU | NVIDIA RTX 2060 / D3D11, mediana 16,7 ms (~60 FPS) en ambas versiones |
| Primer fotograma local | 2678,1 ms antes → 2338,7 ms después |

Los tiempos anteriores corresponden a HTTP local con los módulos y assets originales, no a una estimación de red celular. El flujo se comprobó con el controlador/panel reales y un proveedor restaurado de prueba de solo lectura: no se crearon passkeys, firmaron operaciones ni enviaron POST de wallet. El iframe real de Passport sí renderizó con GPU; su primer fotograma se retuvo y liberó para verificar el hito. Las pruebas de wallet existentes conservan los casos de creación/fondeo. La verificación del deployment se registra por separado.

Resultados y hashes: [results.json](results.json). Comparación de 42 vistas equivalentes por versión: [render-comparison.json](render/render-comparison.json).

## Comparaciones por sección

| Sección | Antes | Después |
|---|---|---|
| Tótem adelantado | [captura](render/before-activation.jpg) | [captura](render/after-activation.jpg) |
| Palta y mesa | [captura](render/before-palta-table.jpg) | [captura](flow/normal-completed-passport-first.jpg) |
| DRIPS | [captura](render/before-header-1-booth-drips.jpg) | [captura](render/after-header-1-booth-drips.jpg) |
| GUAVA | [captura](render/before-header-2-booth-guava.jpg) | [captura](render/after-header-2-booth-guava.jpg) |
| DeFindex / Soroswap | [captura](render/before-header-3-booth-defindex-soroswap.jpg) | [captura](render/after-header-3-booth-defindex-soroswap.jpg) |
| THE AHA COMPANY | [captura](render/before-header-4-booth-aha.jpg) | [captura](render/after-header-4-booth-aha.jpg) |
| Trustless Work / Grantfox | [captura](render/before-header-5-booth-grantfox-trustless.jpg) | [captura](render/after-header-5-booth-grantfox-trustless.jpg) |
| Stellar Passport | [captura](render/before-header-6-booth-passport.jpg) | [captura](render/after-header-6-booth-passport.jpg) |
| 57BLOCKS | [captura](render/before-header-7-booth-57blocks.jpg) | [captura](render/after-header-7-booth-57blocks.jpg) |
| OpenZeppelin | [captura](render/before-header-8-booth-openzeppelin.jpg) | [captura](render/after-header-8-booth-openzeppelin.jpg) |

Los ocho rótulos y las ocho mesas se revisaron individualmente. Los encabezados están libres de espejo, verticalidad, deformación y solapes; Passport queda libre de su columna y póster. Algunas tomas enfocadas en la mesa recortan el encabezado superior por el HUD; las tomas `header-*` verifican su lectura completa. El fruto vuelve a orientarse hacia el visitante al tocarlo.

Plano real de empresas: [320×568](map/companies-plan-320x568.jpg), [390×844](map/companies-plan-390x844.jpg), [844×390](map/companies-plan-844x390.jpg), [1440×900](map/companies-plan-1440x900.jpg). Capturas UI de paneles: [ui/](ui/).

## Reproducción

1. Regenerar con `scripts/rebuild-venue.ps1 -Blender <blender-4.3.2> -Python <python> -SkipGraphics`; generar Palta con `python model/palta_reveal.py --out dist/assets/palta-reveal.glb` y conservar el hash de caché sincronizado.
2. Ejecutar `node --test --test-concurrency=1 test/*.test.mjs`, las pruebas de `agent/` y `test/venue-ui.browser.mjs`.
3. Ejecutar en serie `scripts/verify-venue-render.mjs`, `scripts/verify-activation-guide.mjs` y `scripts/verify-guided-tour.mjs`. La variable `GUIDED_TOUR_QA_MAP_ONLY=1` limita la última a los cuatro planos.

Las dimensiones siguen siendo estimaciones del recorrido original. El escenario, Content Hub, cocina, muebles, Passport, fútbol y demás correcciones previamente aprobadas se conservan.


## Preview final verificado

Deployment `dpl_3FmNrJ11a69VYxb2wgbVgsqJPRxc`, estado READY, entorno preview; commit publicado `ac0308ef52f2cc9e874b3c0eeff16f4cb44563b0`. La comprobación móvil real confirmó el hash exacto del modelo comprimido, GPU NVIDIA/D3D11, ausencia de referencias numeradas, configuración Testnet correspondiente al dominio del preview, panel de wallet con Continuar sin saldo manteniendo la entrada, y primer fotograma real de Passport con retorno al recinto. Sin errores JS/HTTP ni POST automáticos de wallet.

[Resultado del deployment](deployment/deployment-verification.json), [recorrido móvil](deployment/after-mobile.jpg), [wallet](deployment/wallet-mobile.jpg), [Passport](deployment/passport-mobile.jpg). El enlace temporal entregado en el chat vence el **27 de octubre, 05:39 (America/Santiago)**; su parámetro de acceso no se guarda en Git.

En una muestra de red real desde este equipo, la descarga del modelo pasó de 1516,6 ms / 4.212.324 bytes a 2765,3 ms / 4.195.606 bytes; el primer fotograma fue 4125,7 → 4379,3 ms. Son muestras individuales con variación de red/CDN, no una mejora de latencia ni una medición celular. La comparación local equivalente mantuvo 16,7 ms por fotograma. Las pruebas móviles usan viewport y gestos de Chromium con GPU; no sustituyen una prueba en hardware Android/iPhone.
