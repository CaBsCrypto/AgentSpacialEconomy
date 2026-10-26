# Segunda revisión del recorrido · 26 de octubre

Base: `da9b680`, rama `codex/render-textures-ui`. Esta revisión incorpora el plan aprobado por secciones y la captura adicional de comidas. Los videos originales siguen fuera de Git; sus transcripciones y el índice están en el directorio padre.

[Comparación visual por secciones](section-comparisons.jpg) · [Vista de las ocho mesas](tables-overview.jpg)

## Evidencia por sección

| Sección | Referencia | Resultado y capturas |
|---|---|---|
| Lounge inferior | 021740335; 021758544, 8–15,5 s | Cuatro módulos azules y cuatro pufs, dos L laterales y dos butacas perpendiculares bajo la baranda. Piezas independientes, respaldo inclinado y costuras cerradas. [Antes](before-lower-lounge-left.jpg), [izquierda](after-lower-lounge-left.jpg), [derecha](after-lower-lounge-right.jpg), [hacia baranda](after-lower-lounge-rail.jpg). |
| Check-in | 021823025, 10 s | Áreas exclusivas para identidad y Made to Move; título elevado sobre el mostrador. [Comparación](before-checkin-close.jpg), [resultado](after-checkin-close.jpg). |
| Habilidades | 021853331, 1–11 s; BACK END solicitado expresamente | Cinco contenedores con cada estampilla completamente dentro y rotulada. Vista de llegada centrada para formato vertical. [Cerca](after-skills-close.jpg), [celular](after-mobile-zone-skills.jpg). |
| Pantalla, teclado y sofá | 021305476; 021339259 | Pantalla junto al muro, teclado paralelo de 3,25 m y sofá mirando al punto intermedio pantalla/cuadro. Doce motivos diferentes. [Resultado](after-keyboard.jpg), [celular](after-mobile-zone-games.jpg). |
| Arcade | 021339259, 8,5 s; 021331223 | Dieciocho pulsadores, triángulos enfrentados 1–3–5, inicio central, dos barras LED y marcadores superiores. [Cenital](after-arcade-above.jpg), [oblicua](after-arcade.jpg). |
| Ocho mesas | 021119922; 210243989 | Wordmarks horizontales sobre mesas blancas, lectura desde cada visitante, sin reversos ni hardware sobre el texto. Separación libre de 1,05 m. Las ocho capturas individuales figuran debajo. |
| Content Hub | 022007525, 10 y 13 s | Dos cuerpos, 6,6 × 4,85 m, acceso conservado, mobiliario dentro del nuevo límite, cuatro luminarias y dos luces locales sin sombras. [Interior](after-content-hub.jpg), [luminarias](after-content-hub-lights.jpg), [celular](after-mobile-zone-content-hub.jpg). |
| Fútbol | 021930226; interacción solicitada | Pelota y red independientes, tiro por toque o botón accesible, impacto, regreso automático y movimiento reducido. [Pruebas y capturas](football/football-browser.json). |
| Comidas | Captura adjunta por el propietario | Perspectiva oblicua que muestra el mostrador principal completo en vertical, sin centrar el panel de check-in. [Antes](before-buffet.jpg), [resultado](after-buffet.jpg), [celular](after-mobile-zone-buffet.jpg). |
| Passport y referencia 19 | Diseño existente | Passport conserva panel, imagen e ID16, con aproximación lateral accesible. Referencia 19: “Zona de fotos · junto al escenario”. [Passport](after-mobile-zone-passport-stand16.jpg), [fotos](after-photocall.jpg). |

## Las ocho mesas

1. [DRIPS](after-table-1-booth-drips.jpg)
2. [GUAVA](after-table-2-booth-guava.jpg)
3. [DeFindex / Soroswap](after-table-3-booth-defindex-soroswap.jpg)
4. [THE AHA COMPANY](after-table-4-booth-aha.jpg)
5. [Grantfox / Trustless Work](after-table-5-booth-grantfox-trustless.jpg)
6. [Stellar Passport](after-table-6-booth-passport.jpg)
7. [57BLOCKS](after-table-7-booth-57blocks.jpg)
8. [OpenZeppelin](after-table-8-booth-openzeppelin.jpg)

## Verificación reproducible

Los resultados cuantitativos están en [results.json](results.json), [render-comparison.json](render-comparison.json), [football-browser.json](football/football-browser.json) y [football-layout.json](football/football-layout.json).

- Suites completas de frontend y agente; regresiones de geometría, gráficas, orientación UV, colisiones, recorridos, Passport y ciclo de fútbol.
- UI a 320×568, 390×844, 844×390 y 1440×900: paneles abiertos/cerrados, recorrido y vista general, controles de 44 px y acción de fútbol sin solapes.
- Navegador Chromium con GPU NVIDIA RTX 2060/D3D11, modelo y módulos reales. La comparación de rendimiento usa respuestas HTTP locales reproducibles; no representa una conexión móvil física.
- Gestos nativos de navegador: toque, arrastre, arrastre con retorno al origen, dos dedos, repetición durante animación, Enter, salida de zona y movimiento reducido.
- GLB parseado y sus 32 imágenes decodificadas, texturas MASK de una cara y presupuesto comprimido de 5 MiB.
- Capturas de celular mediante viewport/touch emulados. La revisión en un teléfono físico corresponde al enlace final del preview.

Comandos principales: `scripts/rebuild-venue.ps1`, `node --test --test-concurrency=1 test/*.test.mjs`, la misma suite en `agent/`, `node --test test/venue-ui.browser.mjs`, `node scripts/verify-venue-render.mjs` y `node scripts/verify-football-browser.mjs`. Los scripts de navegador aceptan rutas de Playwright y Chromium por variables de entorno.

Las dimensiones, posiciones y motivos ilegibles siguen siendo estimaciones del video. Los marcadores 654/255 reproducen un instante de referencia, y el arcade sigue siendo una reconstrucción visual. La pantalla dinámica del escenario, sponsor, wallet, siete peldaños, corredor acortado y limpieza exterior se conservan.

