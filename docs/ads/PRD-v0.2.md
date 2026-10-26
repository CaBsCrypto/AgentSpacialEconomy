# PRD de publicidad 3D y AR con USDC de prueba y x402

**Producto:** AgentSpacialEconomy · **Versión:** 0.2 · **Fecha:** 26 de octubre de 2026  
**Estado:** nuevo PRD para producto e ingeniería; conserva la versión 0.1 como antecedente. Este documento no autoriza implementación, despliegues, conexión de wallets ni pagos.

## 1 Objetivo y decisiones confirmadas

Permitir que un anunciante entregue información de su proyecto, compre publicidad con USDC de prueba mediante x402 y entre en una cola durable. Un agente genera y audita el anuncio; un programador lo publica en el espacio digital contratado según el plan y la disponibilidad. La experiencia debe distinguir claramente **pago confirmado, procesamiento, programación y entrega**.

| Tema | Decisión confirmada para este test |
|---|---|
| Red y moneda | Stellar Testnet y USDC de prueba exclusivamente; sin fondos reales ni mainnet. |
| Inventario | Banner aéreo central y superficie del main stage dentro del mapa 3D y AR. |
| Entrada presencial | QR o NFC cerca del escenario abre la compra para esa área digital; no controla una pantalla física. NFC también es un medio confirmado de acceso mediante tarjetas. |
| Oferta | Tres planes distintos: tiempo, cantidad de apariciones y ventana exclusiva; importes configurables, todavía no proporcionados. |
| Brief | Nombre del proyecto, logo, descripción y CTA a X y al juego web o sitio web. GitHub no es el destino principal supuesto. |
| Auditoría | Automática por el agente, con controles técnicos obligatorios; no requiere aprobación humana de cada anuncio. |
| Resultado del pago | Encolado durable después de confirmar liquidación, no exhibición inmediata ni aceptación de entrega. |

**Cambios frente a 0.1:** se resuelven las seis preguntas iniciales, se reemplazan las aprobaciones rutinarias del anunciante y administrador por auditoría automática, se formalizan los tres planes y se aclaran acceso físico, cola y medición. Se conservan las distinciones entre x402, registro propio y escrow, así como los riesgos de reintentos y evidencia insuficiente.

## 2 Alcance y responsabilidades

Incluye formulario, carga segura, preauditoría, preview opcional antes de pagar, cotización, reserva de capacidad, pago testnet, generación, auditoría final automática, cola por ubicación, publicación sincronizada, CTA, recibos, reclamaciones y devoluciones. Comprar una ubicación no incluye automáticamente la otra; la interfaz puede cotizar ambas con obligaciones independientes.

Fuera del alcance: control de hardware físico, mainnet, CPM o cobro por espectadores, reconocimiento de asistentes, anclaje espacial persistente no validado, subastas y escrow no implementado. Las otras estaciones del proyecto no aumentan el inventario publicitario. El anfitrión conserva prioridad sobre las ventanas del main stage; comprar exclusividad no concede propiedad ni control del venue.

El **anunciante** aporta contenido y derechos, elige plan y autoriza el importe. El **agente creativo** produce artefactos restringidos. El **auditor automático** decide con políticas versionadas. El **scheduler** asigna capacidad y el **publicador canónico** mide entrega. El **operador** configura reglas, atiende excepciones y puede activar una parada de emergencia, pero no aprueba rutinariamente cada creativo. Separar estos permisos aunque compartan infraestructura.

## 3 Planes y reglas de entrega

Cada cotización fija ubicación, revisión, plan, unidades, precio total, fechas admisibles, prioridad del anfitrión, política de interrupción y remedios. Los precios de TIME, PASSES y EXCLUSIVE se configuran por separado; no se inventan importes ni conversiones comerciales. El precio incluye las partidas mostradas, sin cobrar silenciosamente diseño y publicación dos veces.

### TIME por duración

Compra una duración acumulada de actividad del anuncio en el publicador canónico de una ubicación, dentro de un horizonte contratado. La unidad temporal y los tramos de rotación son configurables. Solo cuentan intervalos confirmados en los que esa revisión estuvo activa; intervalos superpuestos se deduplican. Cien clientes conectados no multiplican el tiempo entregado.

Política propuesta: pausas del anfitrión, retirada de seguridad y caídas del publicador detienen el contador. Un fallo de un teléfono no detiene por sí solo el publicador ni acredita una vista. Reanudar dentro de la ventana acordada; si resulta imposible, registrar déficit y aplicar reprogramación consentida o devolución correspondiente. La cotización debe mostrar esta política antes del pago.

### PASSES por apariciones

Compra N reproducciones completas de duración fija y declarada por pase, contadas una vez por ubicación en la secuencia canónica. Cada pase tiene identificador único, revisión, inicio y fin. Un pase interrumpido no cuenta como completo; se reinicia o reprograma sin duplicarlo. No se factura por espectador, dispositivo, sesión AR, recarga ni callback del cliente. La evidencia de un publicador no constituye prueba independiente de audiencia.

### EXCLUSIVE por ventana exclusiva

Compra una ubicación concreta durante un intervalo acotado `[inicio, fin)`, sin otros anuncios en ese espacio. No excluye el contenido prioritario del anfitrión ni el resto del mapa; esa salvedad y sus compensaciones deben ser visibles antes de pagar. Reservar capacidad contra solapamientos con TIME, PASSES y otras exclusivas. No cobrar una exclusiva sin ventana factible; estar en cola no permite desplazar reservas ya comprometidas. Si una interrupción impide cumplir, no declarar entregado todo el intervalo.

## 4 Recorrido de compra y estados visibles

1. El QR, NFC o enlace abre una página móvil con la ubicación preseleccionada. Verificar el identificador en servidor y mostrarlo al usuario; el enlace no confiere permisos administrativos.
2. El anunciante introduce nombre, logo, descripción y destinos de X y juego o web; declara autorización sobre marca e imágenes. Puede revisar una preview gratuita y limitada por cuota antes de pagar. No es aprobación humana obligatoria ni acceso ilimitado al generador.
3. La preauditoría valida archivos, enlaces y contenido. Solo un brief admitido puede recibir cotización pagable; esto reduce, pero no elimina, rechazos posteriores.
4. El servidor calcula disponibilidad y reserva atómicamente capacidad con vencimiento. La cotización muestra plan, cantidades, precio, red, activo, beneficiario, plazos y condiciones. El usuario autoriza ese pago, no gastos futuros.
5. Mientras firma o liquida, la interfaz muestra `PAYMENT_PENDING`. Solo después de liquidación confirmada crea o recupera la entrada durable `QUEUED` y devuelve recibo con identificador consultable. El recibo puede llegar rápidamente, pero no se promete latencia cero ni publicación instantánea.
6. La cola muestra subestados `PROCESSING`, `AUDITING` y `SCHEDULED`, con avance y motivo de espera. El agente genera las adaptaciones y la auditoría final examina exactamente sus hashes y CTA. Si pasan, se programan automáticamente, sin exigir clic de aprobación del cliente ni del administrador.
7. El anunciante consulta progreso por ubicación, unidades entregadas, déficit, recibos y reclamaciones. Un rechazo posterior al pago se informa como `BLOCKED` o `QUARANTINED`, nunca como entrega satisfactoria.

Las posiciones globales son orientativas: planes, ventanas y ubicaciones tienen restricciones distintas. Mostrar ETA como rango o “pendiente de auditoría/disponibilidad”, con causa y actualización; no prometer un orden global FIFO ni una hora garantizada cuando no existe reserva firme.

## 5 Requisitos funcionales y de seguridad

### RF01 Contenido y auditoría automática

Autenticación, autorización por campaña, cuotas y límites configurados de texto, bytes y dimensiones. Aceptar inicialmente PNG, JPEG y WebP; verificar bytes reales, redecodificar, eliminar metadatos y rasterizar salidas. Rechazar ejecutables, HTML y SVG activo. Aislar procesamiento sin red innecesaria y limitar descompresión, almacenamiento y frecuencia.

La auditoría combina reglas deterministas obligatorias, moderación acotada por modelo y validación final del manifiesto. Las reglas duras incluyen esquema, MIME, dimensiones, límites, URL, dominios y permisos. **No son simplemente las reglas del agente x402:** x402 resuelve el pago; un motor de políticas en código controla contenido, CTA, permisos y publicación, y servidor o contrato imponen contabilidad y programación. No basta escribir estas restricciones en un prompt. El modelo devuelve un veredicto estructurado y razones, con presupuesto de tiempo y llamadas; no puede dispensar controles duros. Un error, resultado incierto o riesgo de seguridad falla cerrado: cuarentena y no publicación. Registrar versiones de política y modelo, veredictos y trazas mínimas.

El contenido del anunciante es dato no confiable: instrucciones incrustadas no autorizan herramientas, pagos, cambios de horarios, beneficiarios ni políticas. El generador no recibe secretos, firma de wallet ni permisos de administración. El publicador solo acepta manifiestos auditados e inmutables mediante capacidades específicas. Una modificación de logo, texto, CTA o archivo crea otra revisión y obliga a repetir auditoría; no añade cargos sin autorización.

La automatización no garantiza moderación infalible. Debe detectar y mitigar fraude, suplantación, derechos y privacidad, contenido prohibido y CTA maliciosos. Mantener retirada de emergencia, motivos comprensibles y canal de apelación. La intervención del operador es una excepción opcional para investigar, no una etapa obligatoria de toda compra; no puede ignorar barreras técnicas de seguridad.

### RF02 Diseño y enlaces

Generar imagen y manifiesto por ubicación, texto alternativo y tarjeta móvil accesible. Ratios provisionales: banner 4:1 y main stage 16:9, sujetos a medidas reales. Probar legibilidad, contraste, márgenes y CTA sin estirar. Sin scripts, destellos, sonido automático ni animación intensa en el MVP.

Permitir HTTPS y destinos admitidos por configuración. Normalizar URL, rechazar credenciales embebidas, esquemas activos y destinos internos; controlar SSRF y cada redirección en inspecciones. Vincular CTA a destino auditado, sin redireccionador abierto. Mostrar dominio antes de abrirlo mediante acción explícita. QR o NFC no reemplazan el enlace accesible en el propio teléfono. Los cambios maliciosos detectados en destinos requieren suspensión y reauditoría.

### RF03 Inventario y scheduler

Mantener `venue_center_banner` y `main_stage_screen` como identificadores digitales estables. Usar calendario por ubicación, hora del servidor, intervalos semiabiertos y playlists con versión monotónica. Si una orden incluye ambas ubicaciones, reservar ambas o ninguna; no degradarla silenciosamente.

La reserva atómica comprende demanda real del plan, plazo de generación y auditoría, y ventanas disponibles. Para PASSES reservar N pases de duración conocida; para TIME, capacidad suficiente para la duración; para EXCLUSIVE, el intervalo completo sin conflicto. Validar nuevamente al comprometer. Reserva vencida más pago tardío pasa a reconciliación y alternativa consentida o devolución: no a sobreventa.

Aplicar justicia determinista entre órdenes elegibles, con política versionada: respetar compromisos y ventanas exclusivas; dentro de capacidad rotativa compatible, distribuir turnos sin inanición. Desempatar por fecha de compromiso y luego `order_id`; documentar límites por campaña y antigüedad. No alterar prioridades arbitrariamente por decisión del modelo. Las ventanas previamente bloqueadas del anfitrión no están a la venta. Una interrupción extraordinaria registra deuda de entrega.

### RF04 Publicación y experiencia espacial

Aplicar revisión y playlist idempotentemente; confirmar versión antes de contar actividad. Los clientes sincronizan desde tiempo del servidor, no generan su propia contabilidad. Retirar contenido expirado o suspendido incluso con caché; ante vigencia no verificable, mostrar contenido neutral. El fin de la ventana detiene visualización, pero no borra obligaciones incumplidas.

Validar posición, altura y escala del banner sin obstruir señalética ni rutas. Un anclaje manual por teléfono no garantiza alineación física compartida. Sin AR, cámara o permisos, conservar mapa 3D y tarjeta móvil. Probar móviles reales; una limitación WebGL del navegador cloud no acredita un fallo del teléfono.

## 6 Pagos y registro verificable

x402 paga un recurso o servicio; no aporta automáticamente escrow, aceptación de arte ni arbitraje. En Stellar `exact`, la transacción contiene una invocación de transferencia del token: no debe asumirse que ejecuta atómicamente un contrato propio de campaña. `/verify` no equivale a liquidación; habilitar el trabajo pagado tras confirmar settlement. [Especificación oficial](https://raw.githubusercontent.com/x402-foundation/x402/main/specs/schemes/exact/scheme_exact_stellar.md).

Fijar `stellar:testnet` y una allowlist exacta de USDC de prueba. La guía oficial identifica el emisor `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` y contrato `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`; cotejarlos con la configuración antes de habilitar cobros. Verificar soporte de firma de auth entries en la wallet elegida; no prometer compatibilidad móvil universal. [Guía Stellar de x402](https://developers.stellar.org/docs/build/agentic-payments/x402).

La orden vincula durablemente `order_id`, cotización, revisión, red, activo y emisor/contrato, importe entero, beneficiario, pagador, nonce, vencimiento y clave idempotente. Un hash aislado no acredita pago. Validar transferencia y unicidad; una transacción no satisface varias órdenes. Persistir intento y huella autorizada antes de transmitir, y asociar después el hash de liquidación.

Ante timeout, consultar el intento original y bloquear nuevo cobro hasta reconciliar. Doble clic, reenvío y caída posterior a settlement no deben duplicar cargos ni trabajos. Una outbox durable conecta liquidación, cola y publicación con consumidores deduplicados; no prometer atomicidad entre blockchain y base de datos. Una clave repetida con payload diferente devuelve conflicto.

**Arquitectura propuesta:** pago x402 directo al operador más registro Soroban propio de compromiso y cumplimiento. El registro no custodia fondos. Escrow es una alternativa futura mediante financiación separada y autorización explícita, con política y auditoría propias; no cobrar dos veces la misma colocación ni incluir `release_funds` en un registro sin custodia.

El contrato propio registra compromisos mínimos: orden, revisión, hashes de términos y manifiesto, referencia de pago, ubicaciones, unidades, ventanas, emisor autorizado y plazos. `queued` acredita recepción del trabajo, no entrega aceptada. La finalización automática exige un resumen firmado del publicador con unidades cumplidas por ubicación, intervalos o pases deduplicables y hashes correctos. El contrato verifica firma, permisos, nonce y reglas; **no observa personas ni prueba vistas físicas**. La confianza en el publicador debe declararse.

La aceptación automática basada en esas reglas no requiere aprobación humana por defecto, pero conserva derecho a disputar y no cierra todas las vías de remedio. Un keeper realiza transacciones de vencimiento; el contrato no se ejecuta espontáneamente. Entrega parcial y diseño se registran por separado. Raven sirve como fuente MCP de documentación y contexto Stellar, no como diseñador, publicador, firmante del usuario ni contrato ya disponible. [Documentación de Raven](https://raven.stellar.org/docs).

## 7 Ciclo de vida y recuperación

- **Orden:** `DRAFT → PREAUDITED → QUOTED → RESERVED → PAYMENT_PENDING → QUEUED → LIVE → COMPLETED`; procesamiento, auditoría y programación son subestados de cola. Alternativas: `BLOCKED`, `QUARANTINED`, `CANCELLED`, `RECONCILIATION_REQUIRED`.
- **Pago:** `REQUIRED → AUTHORIZED → SETTLING → SETTLED`; alternativas `FAILED`, `EXPIRED`, `RECONCILIATION_REQUIRED`. Autorizado no significa pagado.
- **Ubicación:** `PENDING → SCHEDULED → ACTIVE → PARTIAL → FULFILLED`; también `PAUSED`, `FAILED`, `DISPUTED`. Una campaña solo completa cuando todas sus obligaciones están satisfechas o cerradas explícitamente con remedio.
- **Devolución:** `REQUESTED → APPROVED → SUBMITTED → CONFIRMED`; conservar errores recuperables y recibo real de transferencia. Una anotación contable no equivale a devolver fondos.

Si la auditoría final bloquea una orden pagada, conservar recibo y fondos pendientes de resolución, ofrecer corrección permitida o devolución según términos; no publicar ni tratar el dinero como entrega ganada. Si hay fallo parcial, calcular déficit y compensación por ubicación. Si cambia la ventana, obtener consentimiento para reprogramar. La disputa preserva evidencia y suspende el cierre controvertido; en pago directo no congela mágicamente fondos ya transferidos.

Entidades mínimas: Campaign, CreativeRevision, AuditVerdict, Quote, Order, PaymentAttempt, SlotReservation, Placement, PlaylistVersion, DeliveryEvidence, Dispute, Refund y AuditEvent. Minimizar datos personales; nunca guardar secretos o archivos originales en cadena. Registrar actor, motivo, versión y efecto económico de cada transición.

## 8 Criterios de aceptación y puertas de salida

1. QR y NFC abren compra del área correcta; no controlan hardware. Brief admite nombre, logo, descripción, X y juego o web.
2. Los tres planes tienen precio y semántica visibles. TIME no cuenta pausas; PASSES no cuenta pases interrumpidos; varios clientes no multiplican entrega; EXCLUSIVE bloquea otros anuncios solo en su ubicación y ventana.
3. Contenido inseguro falla antes del pago cuando se detecta; un creativo generado se audita nuevamente. Prompt injection, archivo activo y CTA malicioso no consiguen permisos ni publicación.
4. Pago confirmado produce una única entrada durable consultable y recibo; autorización sin settlement no la marca pagada. Red, activo, importe, beneficiario, nonce y orden se comprueban.
5. Reintentos, timeout y caída después de liquidación recuperan la orden sin doble cobro. CI falla si esperaba liquidaciones y obtuvo cero; mocks no cuentan como evidencia testnet.
6. Dos compradores de la última capacidad no provocan sobreventa. Exclusiva imposible se rechaza sin cobro. Expiración, pago tardío y déficit tienen reconciliación demostrable.
7. Una orden válida pasa generación, auditoría y programación sin aprobación humana rutinaria. Cuarentena explica motivo y remedio; parada de emergencia retira cachés y detiene cómputo aplicable.
8. Evidencia manipulada, replay y firma ajena son rechazados. `queued`, `LIVE`, entrega atestada y vistas humanas no se presentan como equivalentes.
9. Fallo parcial, reclamación y devolución se prueban; solo una transferencia confirmada permite mostrar “reembolsado”. Probar Android e iPhone reales, red lenta, permisos denegados y fallback.

**Puertas:** política e inventario configurados → pruebas locales de seguridad y contabilidad → integración con recuperación → end to end testnet autorizado → validación móvil y espacial. Ninguna puerta sustituye otra. El antecedente v0.1 reportó 106 pruebas y pagos previos de 0.01 y 0.05, pero no prueba este nuevo flujo. Sus riesgos de doble pago y CI verde sin liquidaciones siguen siendo bloqueadores hasta aportar evidencia nueva.

## 9 Configuración pendiente y corte del MVP

No reabrir decisiones confirmadas. Antes de habilitar compras deben fijarse importes por plan y ubicación, unidad de TIME, duración de pase, ventanas exclusivas, calendario del anfitrión, ubicación y medidas precisas, wallet beneficiaria pública, límites de contenido, presupuesto del agente, plazos de reserva y procesamiento, revisiones incluidas, política y plazo de devolución, autoridad de disputa y retención de datos. Son campos de configuración y reglas comerciales pendientes, no permiso para inventarlos ni para cobrar sin términos completos.

Demo objetivo: entrada QR o NFC → brief y preauditoría → plan y reserva → pago testnet autorizado → cola durable → generación y auditoría automática → publicación → evidencia por ubicación → expiración y remedio cuando corresponda. Incluir una recuperación sin doble cobro y un caso parcial. Priorizar pagos seguros y estado durable antes del diseño generativo y del registro propio. Si falta un componente, declararlo simulado; no presentar fixtures, AR no validada o contratos no desplegados como producción.
