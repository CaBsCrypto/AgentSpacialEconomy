# Verificación de texturas, espacios y UI

Las trece referencias están implementadas y vinculadas a capturas en [el índice](../index.json). Los originales no forman parte del repositorio.

## Resultados

| Comprobación | Resultado |
|---|---|
| Frontend completo | 368 pasan; 1 integración viva opcional preexistente omitida; 0 fallos |
| Agente | 34 pasan; 0 fallos |
| Layout y foco Chromium | 5 pasan; 320×568, 390×844, 844×390 y 1440×900 |
| Interacción del visor completo | 9 flujos; teclado, joystick, mirada, lugares, foco, ayuda, modos y mapa |
| GLTFLoader + decodificación de imágenes | 414 meshes, 294.780 vértices, 32 imágenes válidas |
| WebGL real | NVIDIA RTX 2060, ANGLE Direct3D11; 14 vistas equivalentes |
| Sin WebGL y recuperación | Plano 2D con 23 referencias; reintento y vuelta a 3D correctos |
| Errores JavaScript / assets faltantes | 0 / 0 |

El recorrido mantiene una mediana de 16,7 ms por frame (aproximadamente 60 FPS) en la GPU comprobada. Primer frame local: 1080 ms antes y 1521 ms después. El modelo comprimido pesa 4,085,849 bytes, por debajo del límite comprobado de 5 MiB. La primera exportación con texturas pesaba 8,70 MB; la final pesa 4,09 MB comprimida.

Los tiempos se midieron con respuestas HTTP servidas desde archivos locales, sin latencia de Internet. Las dimensiones móviles verifican el layout del navegador; no sustituyen una prueba en un teléfono físico. La configuración wallet se desactiva expresamente en esta fixture y no se inician transacciones.

## Comparaciones visuales

- [Arquitectura, lounge, check-in, stands y escenario](comparison-core.jpg)
- [Juegos, Energy Corner, fotomatón, Content Hub, photocall y habilidades](comparison-experiences.jpg)
- [UI móvil 390×844](after-ui-390x844.jpg)
- [UI horizontal 844×390](after-ui-844x390.jpg)
- [Vista general](after-overview.jpg)
- [Mediciones completas antes/después](render-comparison.json)
- [Flujos de interacción](ui-flows.json)
- [Fallo WebGL, plano 2D y recuperación](ui-fallback.json)

Las gráficas de baja legibilidad y los motivos complejos son reconstrucciones interpretativas, no una reproducción pixel a pixel. Las medidas y posiciones son aproximadas.

## Regresiones cubiertas

Se conservaron el corredor acortado, la eliminación de plataforma/escalera exterior, siete peldaños interiores, transformación de Merch, Passport y su entrada por el stand 16, wallet y tarjeta de escenario con sponsor. Las zonas 21–25 son informativas y no anuncian nuevas experiencias AR.

Se añadieron pruebas específicas de los tintes exportados de madera y tapizado azul: el antiguo nodo Multiply podía conservar imágenes y perder el color. Las nuevas pruebas verifican factor de color, normales y roughness. La transferencia conserva round-trip exacto del GLB y fallback único; su límite usa bytes de descarga porque las imágenes JPEG/PNG ya están comprimidas.

## Repetir

Desde la raíz del checkout, con las dependencias instaladas:

    node --test --test-concurrency=1 test/*.test.mjs
    cd agent
    npm test

Para QA de navegador, proporcionar Playwright y Chromium instalados mediante VENUE_UI_PLAYWRIGHT_MODULE y PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:

    node --test test/venue-ui.browser.mjs
    node scripts/verify-venue-render.mjs

VENUE_BASELINE_DIST permite comparar con un checkout o archivo extraído de la base; VENUE_RENDER_QA_DIR elige el directorio de salida. La instrumentación solo se añade a la respuesta JavaScript dentro de la fixture de prueba, sin API de depuración en producción.
