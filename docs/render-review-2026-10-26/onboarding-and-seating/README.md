# Guía al tótem, mobiliario y displays · 26 de octubre

Base: `dbb228f`, rama `codex/render-textures-ui`. Incluye todas las correcciones solicitadas durante esta revisión.

[Comparativa por secciones](section-comparisons.jpg)

## Cambios comprobados

- **Tótem de wallet:** trasladado a `(2.9, -9.2)`, junto a la referencia 12. Su aproximación frontal queda libre y abre el flujo existente de wallet y USDC de prueba.
- **Guía luminosa:** 73 puntos desde el spawn, pasando por el corredor acortado y los siete peldaños hasta la aproximación. Dos capas instanciadas, sin luces ni texturas por punto; onda suave hacia el destino y modo estático con movimiento reducido. La guía también figura en el mapa.
- **Altura visible:** los puntos se apoyan sobre el acabado real de las alfombras, 2.5 cm por encima. La referencia 7 cabe en un solo peldaño y se desplaza al costado del camino.
- **Cortina:** retirada la geometría negra y su antigua colisión entre mesas de trabajo y stands.
- **Sillas y mesas:** 118 sillas de trabajo, auditorio y café, más ocho sillas de stands, usan la nueva geometría compartida. Se revisaron orientaciones, apoyos, separaciones y colisiones individuales. Las 14 mesas de trabajo/café mantienen rutas abiertas; los ocho tableros de marcas conservan sus textos.
- **Sección 13:** cuatro grupos sociales redistribuidos; sillas laterales mirando a sus mesas. Se conserva el cruce hacia stands y el pasillo central.
- **Separadores:** cuatro paneles de 3.6 m, con pasillo central de 4.4 m. El patrón conserva proporciones y resolución máxima de 2048 px.
- **Palta Labs:** palta interactiva sobre la mesa de DeFindex/Soroswap, escala 0.45 y banda trasera reservada. Su soporte ya no añade un obstáculo de suelo.
- **Passport:** display físico sobre la mesa Stellar Passport, con libro ampliado 3.8 veces, de unos 38 cm de ancho, y apoyo proporcionado. Portada, panel AR16 y comportamiento existente conservados.

## Capturas

| Revisión | Antes | Resultado |
|---|---|---|
| Sección 13 | [Antes](before-central-seating-13.jpg) | [Sillas y mesas](after-central-seating-13.jpg), [celular](after-mobile-zone-cafe.jpg) |
| Trabajo | [Antes](before-hack-seating.jpg) | [Sillas](after-hack-seating.jpg) |
| Cortina | [Antes](before-removed-curtain.jpg) | [Paso abierto](after-removed-curtain.jpg) |
| Separadores | [Antes](before-stands.jpg) | [Anchos y pasillo](after-stands.jpg) |
| Palta | [Mesa anterior](before-palta-table.jpg) | [Display abierto](after-table-3-booth-defindex-soroswap.jpg) |
| Passport | [Display anterior](before-passport-display.jpg) | [Libro ampliado](after-passport-display.jpg), [celular](after-mobile-zone-passport.jpg) |
| Tótem USDC | [Ubicación anterior](before-activation.jpg) | [Ubicación actual](after-activation.jpg) |

[Guía de entrada en celular](guide/corridor-390x844.jpg) · [Siete peldaños](guide/stairs-390x844.jpg) · [Llegada al tótem](guide/approach-390x844.jpg) · [Mapa](guide/plan-390x844.jpg)

## Validación

Los resultados están en [results.json](results.json), [comparación GPU](render-comparison.json) y [37 comprobaciones de la guía](guide/activation-guide-browser.json).

La regresión de sillas verifica geometría real del GLB y sus matrices, apoyos en el suelo y contención dentro de sus huellas de colisión. Las rutas se recorren con el movimiento real y radio de visitante de 0.24 m; la navegación sigue conectada a todas las vistas.

Se verifican 320×568, 390×844, 844×390 y 1440×900, ambos modos de visualización y paneles abiertos/cerrados. La guía se prueba por toque nativo, clic y teclado, movimiento reducido y reconstrucción de escena sin duplicados.

Las pruebas del tótem verifican acceso al panel actual. La configuración de wallet del fixture está deshabilitada y bloquea operaciones de escritura; estas pruebas no reclaman fondos. El código de canje existente permanece intacto.

El rendimiento se mide con Chromium y una GPU NVIDIA RTX 2060/D3D11, usando respuestas HTTP locales reproducibles. Los tamaños de celular y gestos táctiles se emulan; no sustituyen la revisión del propietario en un teléfono físico. Dimensiones y distribución siguen siendo estimaciones del recorrido.

