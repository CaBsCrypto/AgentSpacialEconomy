# Revisión visual del recorrido · 26 de octubre de 2026

Se analizaron los 13 videos completos (311,14 s) con OpenAI Whisper mediante faster-whisper 1.2.1: modelo multilingüe small, español, CPU int8, beam 5 y tiempos por palabra. Cuatro clips ambiguos se contrastaron con medium. Audio decodificado a PCM mono 16 kHz con FFmpeg. Cada video se inspeccionó además mediante 12 fotogramas distribuidos por su duración y detalles a resolución nativa.

Base aprobada: 298fefa (créditos/sponsor). Rama: codex/render-textures-ui. Los originales permanecen en Drive y en caché local fuera del repositorio. Los JSON conservan las salidas automáticas originales y las notas de revisión; los SRT usan la mejor pasada disponible. Los clips sin voz fiable tienen SRT vacío: no se convierten alucinaciones de Whisper en instrucciones.

## Evidencia y aceptación

| Video | Sección | Evidencia | Cambio y aceptación |
|---|---|---|---|
| [VID_20261025_210243989.mp4](https://drive.google.com/file/d/19cCwcqgxvaqiSbVEUQrLenrOhQhNeR85/view) | stands | 0.00–35.95 s | Ocho posiciones sobre cuatro divisores, proporciones y continuidad del pasillo. |
| [VID_20261026_021119922.mp4](https://drive.google.com/file/d/1aS8Fo6md58ZhAeQKwsuQVXTD-Eq--am_/view) | stands | 16.54–58.98 s | Cuatro divisores, ocho mesas con marcas, lámparas y circulación amplia. |
| [VID_20261026_021305476.mp4](https://drive.google.com/file/d/1VHKT2L4sOEuYScC0wnU9uDLzGhT0Y-sh/view) | games | 0.00–22.38 s | Teclado de unos 3 m, pantalla, arcade, retícula 4x3 y asientos. |
| [VID_20261026_021331223.mp4](https://drive.google.com/file/d/1qY7nm-ZG4X4WtdnulXIBIQ_OV4YGvEGt/view) | games | 0.00–5.16 s | Joysticks, botones, dos marcadores numéricos y tiras LED. |
| [VID_20261026_021339259.mp4](https://drive.google.com/file/d/1iUUzred-QCoMsZu27e6yZc5TJVcqEcss/view) | games | 18.12–29.30 s | Distribución conectada y escala coherente, sin ocupar pasillos. |
| [VID_20261026_021740335.mp4](https://drive.google.com/file/d/1hXVliyLp15dJN_Z5_xLd6jQlH9q5HYZh/view) | arrival | 0.75–6.39 s | Pufs cilíndricos amarillos y sillones azules en lounge inferior. |
| [VID_20261026_021758544.mp4](https://drive.google.com/file/d/13HJlelvF6bwUaujoK2jbao3YBeLEoVBR/view) | arrival | 1.12–15.88 s | Sillones azules, asiento en L y pufs amarillos; siete peldaños intactos. |
| [VID_20261026_021823025.mp4](https://drive.google.com/file/d/1fhDU0VvYF-4Vwpey8HCZYfD9zEKM4bAc/view) | checkin | 0.00–14.16 s | Check-in & Info Desk, Mentors & Judges, Hackers; backdrop negro/amarillo con marcas. |
| [VID_20261026_021853331.mp4](https://drive.google.com/file/d/1__pjABw6BVMb4ZDINN7W8a_qZhuqSUOB/view) | skills | 0.27–12.27 s | Pizarra móvil con Looking for a team, Designer, Frontend, Backend y notas genéricas. |
| [VID_20261026_021930226.mp4](https://drive.google.com/file/d/1mbmtD7OtALczYADl1AvNMbyzi-LO0QaT/view) | energy-photobooth | 0.00–31.62 s | Portería con red, Come Move With Us, mural Made to Move y cámara en trípode. |
| [VID_20261026_022007525.mp4](https://drive.google.com/file/d/1YqRr_ZnRK4L86yZunMWAOQ5M8Q3gqE_9/view) | content-hub | 0.00–22.68 s | Sala accesible, muebles y luz de grabación; sin panel nuevo de contenidos. |
| [VID_20261026_022050141.mp4](https://drive.google.com/file/d/1EK2QjwVJ0oiT8lT3pdD2u3dfdLWUt4gO/view) | stage | 7.70–29.66 s | Backdrop, panel lateral, dos torres Move, cuatro focos verdes y atril; sponsor funcional. |
| [VID_20261026_022127885.mp4](https://drive.google.com/file/d/1bdPxLGQ3kMWWNZECajyxNhjH45tyZ2z_/view) | photo | 0.05–8.81 s | Retícula 8x3 ilustrada, beanbag negro y dos pufs blancos. |

## Decisiones y límites de la reconstrucción

- UI actual pulida; paneles plegables y legibilidad en móvil y horizontal.
- Equilibrio móvil/escritorio: mapas compartidos de hasta 1K, gráficas hasta 2K y límites de DPR existentes.
- Cuatro divisores con dos caras crean ocho posiciones; las marcas mencionadas no son paneles independientes.
- Posiciones y medidas son estimaciones visuales. La distribución por caras se contrastó con ambos recorridos de stands.
- Juegos y Content Hub son objetos y ambientación visual. Las luces del arcade respetan movimiento reducido.
- Notas de habilidades y pantallas usan contenido genérico; no se reproducen datos de asistentes.
- Logos pequeños o textos no legibles se dejan sin inventar. PaltaLabs está apoyado por voz; Machu queda como duda de reconocimiento.
- Mantener revisión 1 y 4–20; agregar 21 juegos, 22 habilidades, 23 Energy Corner, 24 fotomatón y 25 Content Hub.
- Conservar Passport, wallet, tarjeta dinámica del escenario y sponsor; no añadir disponibilidad AR a las zonas visuales.

## Fuentes editables y reproducción

Las familias de materiales y gráficas se generan mediante scripts/generate-venue-appearance.py; la geometría sigue en los módulos Python de model/. El flujo completo se ejecuta con scripts/rebuild-venue.ps1. Las gráficas son reconstrucciones interpretativas a partir de la evidencia; el material fuente privado no se incrusta en los assets públicos.

## Verificación

Los resultados y las capturas comparativas se guardan en verification/. El registro index.json vincula cada petición con su criterio de aceptación y resultado de implementación.

## Resultado de implementación

Las 13 referencias están cerradas en index.json y enlazadas a capturas. [Ver informe de validación y comparativas](verification/README.md). Rama local codex/render-textures-ui; 368 pruebas frontend, 34 del agente y 5 de layout/foco pasan. Primera vista medida en GPU real; las dimensiones móviles se verificaron en Chromium.
