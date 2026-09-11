# Reglas de trabajo en este repo

API REST de finanzas personales. Express 5 + TypeScript + Mongoose sobre MongoDB
(replica set obligatorio). Producto **multiusuario real**, no una app personal:
ninguna decisión puede asumir "un solo usuario" o "poca data".

Este archivo manda sobre cualquier costumbre general. Si algo aquí contradice lo
que harías por defecto, gana lo de aquí.

---

## 1. Definición de "terminado"

Un cambio no está listo hasta que **las siete** se cumplen. No es una lista de
deseos: es el mínimo. Si algo no aplica, dilo explícitamente y por qué.

1. **`npm run ci` en verde.** Incluye typecheck de src y de tests, lint, formato,
   `fixtures:check` y la suite completa. **No incluye `npm run test:mongo`**, que es
   obligatorio aparte si tocaste índices, transacciones o paginación (§1.4). Nunca
   reportes "listo" sin haberlo corrido.
2. **Pruebas unitarias de lo nuevo**, cubriendo el camino feliz y los bordes
   (valor inválido, ausente, `null`, límite).
3. **Prueba de no-regresión**: algo que falle si el cambio rompe lo que ya
   funcionaba. Cuando arregles un bug, escribe primero la prueba que lo
   reproduce y verifica que falla sin el arreglo.
4. **Verificación real, no solo unitaria.** Los tests mockean los repositorios,
   así que **no ejercitan Mongo**: índices únicos, índices parciales, collation,
   TTL y atomicidad de transacciones son invisibles para la suite. Si tocaste
   algo de eso, pruébalo contra el Mongo local y muestra la salida.
5. **Documentación actualizada** (§4). Un cambio de comportamiento sin doc está
   incompleto.
6. **`requests/*.http` actualizadas** (§5) si cambiaste la superficie del API.
7. **Revisado por un revisor independiente** (§9): un subagente nuevo que
   recibe la tarea y lo producido, no tu razonamiento, y dice si era la mejor
   manera. Lo que señale se arregla en la misma rama, o se reporta como
   hallazgo, antes de cerrar.

---

## 2. Prohibiciones

- **No agregues logs** para depurar y los dejes. El logging de la app es
  deliberado: una línea por request en `requestLogMiddleware` y errores en el
  middleware de errores. Si necesitas trazas para investigar, úsalas y bórralas
  antes de entregar.
- **No metas secretos en logs.** Solo el host de la URI, nunca credenciales.
- **No uses `console.log`** en `src/` (hay `logger`). Los `scripts/` sí pueden.
- **No hagas hard delete.** Es un sistema financiero: soft delete o archivado.
  `archivedAt` para account/category/budget, `deletedAt` para transaction/user.
- **No uses flotantes para dinero.** Enteros en centavos, convertidos solo en el
  límite de persistencia con los helpers de `shared/money.ts`.
- **No leas-modifiques-escribas un saldo.** Siempre `$inc` atómico dentro de una
  transacción Mongo (`withTransaction`).
- **No inventes códigos de error nuevos** si ya existe uno que aplica, ni
  cambies el `code` de una respuesta existente sin decirlo: el front branchea
  por `code`, nunca por `message`.
- **No escribas a mano los request bodies del OpenAPI**: se generan desde Zod.
- **No relajes una validación para que pase un test.** Arregla el test o discute
  la regla.
- **No silencies un error.** Si algo falla, que se vea (§7).
- **No agrupes features en un commit.** Un commit por ítem (§6).
- **No borres datos del usuario** sin confirmación explícita, ni siquiera en
  desarrollo.
- **Nunca `git push` y nunca despliegues.** El dueño empuja y abre cada pull request:
  di en qué rama quedó el trabajo y para ahí. Leer del remoto (`fetch`, `pull`) es libre.
- **Nunca toques la base de datos del dueño.** La `MONGO_URI` del `.env` apunta a su
  Atlas; para trabajar se pasa por delante la URI del Mongo de Docker.

---

## 3. Estándares de código

**Capas** (la dependencia va hacia adentro, nunca al revés):

| Capa | Contiene |
| --- | --- |
| `src/domain/` | Entidades e interfaces de repositorio. Sin Mongoose. |
| `src/infrastructure/` | Modelos Mongoose y repositorios concretos. |
| `src/app/` | Servicios, controladores, rutas, validación, DTOs. |
| `src/shared/` | Utilidades transversales (dinero, fechas, errores, logger). |

**Validación.** Zod en `src/app/validation/schemas.ts`, aplicada con
`validate(schema)`. `validate` reescribe `req.body` con lo parseado: cualquier
campo no declarado se descarta (protección contra mass assignment). Recuerda que
Zod corre **antes** de saber quién es el usuario: lo que dependa de sus datos
(moneda, por ejemplo) se valida en el servicio o la entidad.

**Errores.** `ApiError` con `code` estable. `details` siempre
`[{field, message}]`. Recurso ajeno o inexistente → **404 uniforme**, nunca 403
(no se puede sondear si un id existe).

**Comentarios: ninguno por defecto.** Escribe uno solo cuando sea estrictamente
necesario, y entonces es **una línea física** que documenta una restricción que el
código no puede expresar. Nunca envuelto en dos líneas, nunca un párrafo, y nunca el
porqué de una decisión: eso va a `docs/`. Nada de separadores, `TODO`, código
comentado ni changelog en comentarios. Si un comentario se puede borrar sin perder
una restricción, bórralo.

```ts
// Bien: una línea, una restricción que el código no dice
// Los índices parciales se validan por operación: desmarca la default antes de marcar la nueva.

// Mal: repite el código
// Incrementa el balance de la cuenta
```

**Índices.** Toda consulta nueva por un campo debe considerar su índice. Si
añades uno, va en el modelo (`src/infrastructure/models/`) y se aplica solo al
conectar en desarrollo; en producción lo crea el paso de deploy. Un índice único
parcial es una garantía de correctitud, no una optimización: trátalo como tal.

---

## 4. Documentación obligatoria

Según lo que toques:

| Cambiaste | Actualiza |
| --- | --- |
| Un endpoint (params, body, respuesta, códigos) | El bloque `@openapi` de su ruta |
| Comportamiento de un módulo | `docs/modules/<módulo>.md` |
| Algo que el frontend debe adoptar | El bloque `@openapi` de su ruta y `docs/modules/<módulo>.md`: el front genera sus tipos y sus códigos de error desde ahí. Avísale también al dueño |
| Variables de entorno | `docs/guides/environment-vars.md` y `.env.example` |
| El flujo de despliegue | `docs/guides/deployment.md` |
| Arranque o setup local | `docs/guides/getting-started.md` |
| Algo que encontraste y NO vas a arreglar | Repórtaselo al dueño como hallazgo (§7): qué es, dónde, y qué habría que decidir |

Los request bodies del OpenAPI se generan desde los schemas Zod
(`src/config/swagger.ts`); las vistas de respuesta se mantienen a mano pero sus
enums salen de `constants.ts` para que no puedan derivar. Dos reglas al tocar
una vista: los enums se referencian (`enumOf(...)`, `ERROR_CODES`,
`CATEGORY_ICONS`), nunca se copian; y la vista se envuelve en `withRequired(...)`
declarando solo lo que de verdad puede faltar — el front genera sus tipos desde
este documento, y un campo sin `required` se vuelve opcional aguas abajo.

---

## 5. Fixtures `requests/*.http`

Son la forma en que el dueño prueba el API a mano. Si cambias la superficie del
API, actualízalas en el mismo commit: endpoint nuevo, parámetro nuevo, código de
error nuevo que valga la pena poder disparar.

Dos reglas que ya costaron una tarde:

- **Una variable de captura no puede llamarse igual que su request.**
  `@accA = {{accA.response.body.id}}` es autorreferencial y llega vacío. Usa
  `@accAId`. Hay un test que lo verifica (`httpFixtures.test.ts`).
- **El cuerpo de una petición termina en el siguiente `###`.** Las
  declaraciones `@var = ...` que van después de un body necesitan un `###` en
  medio, o se envían como parte del JSON.

Los nombres de recursos que se crean y luego se reusan llevan sufijo aleatorio
(`{{$randomInt 100 999}}`) para que el archivo sea re-ejecutable: cuentas y
categorías tienen nombre único por usuario.

---

## 6. Commits

- **Uno por ítem.** Que varias cosas salgan de la misma revisión no las hace un
  solo cambio. Si tocan entidades distintas y no dependen entre sí, son commits
  distintos. Se agrupan solo si comparten el arreglo.
- Formato `tipo(alcance): descripción (T-nn)` en inglés, imperativo. `lefthook` corre
  formato, lint, typecheck y las pruebas relacionadas antes de cada commit, y
  `commitlint` exige la referencia. No te saltes los hooks (`--no-verify` está prohibido).
- El cuerpo explica **por qué**, y qué se rompía antes. Si la investigación
  reveló una causa no obvia, escríbela: es lo que evita repetir el error.
- No afirmes en el mensaje algo que no hiciste. Si dice "documented", que exista
  la línea de documentación.

---

## 7. Fallar ruidosamente

Este repo ya perdió tiempo tres veces por fallos silenciosos: `autoIndex` que no
creaba ningún índice y se tragaba el rechazo, un `API_SECRET` que devolvía 403
sin dejar rastro, y un paso de deploy que se saltaba la sincronización de
índices con un aviso por stderr que nadie lee.

La regla: **si algo falla, tiene que verse, y el mensaje tiene que ser cierto.**

- No captures un error para descartarlo. Si es esperado, explica en una línea
  por qué es seguro ignorarlo.
- No prometas en un mensaje de error más de lo que sabes. "No se pudo verificar"
  no es lo mismo que "no se está aplicando".
- Un fallo transitorio de red y un conflicto de datos no son lo mismo: no los
  reportes con la misma severidad.
- Prefiere abortar a continuar a medias cuando la consecuencia es un estado
  inconsistente.

---

## 8. Antes de decir que está listo

- ¿Corriste `npm run ci` y está verde?
- ¿Probaste el camino real (servidor arriba, petición de verdad) y no solo los
  mocks?
- ¿La documentación dice lo que el código hace hoy?
- ¿Actualizaste `requests/` si cambió la superficie?
- ¿Queda algún log de depuración, `console.log` o `TODO` tuyo?
- ¿El mensaje del commit describe solo lo que efectivamente hiciste?
- ¿Un revisor independiente vio la tarea y el resultado, y actuaste sobre lo
  que dijo (§9)?
- ¿Todo hallazgo que NO arreglas quedó **registrado** como entrada, no solo mencionado?

Si encuentras un problema fuera del alcance de lo que te pidieron: no lo
arregles por tu cuenta, pero tampoco te baste con mencionarlo. **Repórtaselo al
dueño como hallazgo**, para que entre en la lista de tareas del proyecto: qué
es, dónde está y qué costaría. Vale para fallos, código muerto, guardas que
faltan, asperezas e ideas, lo haya pedido el dueño o no, y vale igual si lo que
falla es del front. Escribirlo solo en un resumen de sesión o en un relevo
**no cuenta**: eso es el diario, nadie lo lee buscando trabajo pendiente, y lo
que solo vive ahí se copia de sesión en sesión y no se hace nunca. La entrada
puede decir «ahora no»; lo que no puede es faltar. Y si algo del cambio quedó
incompleto o dudoso, dilo en vez de dejarlo pasar.

---

## 9. Reglas de la casa

Las treinta reglas a las que se sujeta todo el producto, y tres sobre cómo se
trabaja. Son las mismas treinta en los dos repositorios, con el mismo número;
las marcadas «(Solo front)» se cumplen allí y aquí se dice qué toca a este
lado. Las secciones anteriores son su detalle; *Vigila* dice qué la comprueba
hoy, y «manual» significa que nada lo hace todavía.

**El dinero**

1. El dinero son enteros y solo se mueve en una operación atómica dentro de una
   transacción. Nunca decimales, nunca leer un saldo para volver a escribirlo
   (§2). *Vigila: `currencyPrecision.test.ts`, pruebas de `TransactionService`,
   suite Mongo.*
2. Nada se borra: se archiva o se marca, y toda lectura normal lo filtra (§2).
   *Vigila: pruebas puntuales; el barrido de «toda lectura filtra» es manual.*
3. Repetir una petición no repite su efecto: ids del cliente, `Idempotency-
   Key`, resultados guardados de `POST /sync`. *Vigila:
   `clientMintedId.test.ts`, `offlineWrites.mongo.test.ts`,
   `SyncBatchService.test.ts`.*
4. La misma cifra sale igual en el servidor y sin conexión, y el cliente nunca
   calcula dinero salvo la proyección offline, marcada como tal; los fixtures
   de paridad son el contrato entre los dos. *Vigila: `fixtures:check` en el
   gate y en CI; `parityFixtures.mongo.test.ts`.*
5. Las fechas se juzgan en la zona horaria del usuario y cada movimiento
   congela su día contable (`dayKey`). *Vigila: `dayKey.test.ts`,
   `accountingDay.mongo.test.ts`.*
6. (Solo front) Sin conexión no se mienta: la copia local es desechable, lo
   escrito sin red es sagrado, y el espejo nunca inventa una cifra que nadie
   calculó. Aquí: los endpoints que el espejo sustituye no se retiran sin el
   dueño (`docs/modules/sync.md`). *Vigila: manual.*

**Cada usuario ve solo lo suyo**

7. Toda consulta lleva el usuario, y lo ajeno contesta igual que lo
   inexistente: 404 (§3). *Vigila: `tsc` cuando el usuario está en la firma; la
   comparación en el servicio es manual.*
8. Solo entra lo declarado: cada ruta valida con su esquema y lo no declarado
   desaparece; lo que deriva el servidor no se acepta del cliente (§3).
   *Vigila: `schemas.test.ts`, `validate.test.ts`, `openapiCoverage.test.ts`.*
9. (Solo front) La sesión vive en cookies httpOnly y el navegador nunca ve un
   token ni la URL del back. Aquí: JWT HS256 explícito, refresh rotado por
   familia, `tokenVersion` como interruptor (`docs/modules/auth.md`). *Vigila:
   `AuthService.test.ts`, `refreshRotation.mongo.test.ts`.*
10. Los secretos no aparecen en logs ni en el repositorio (§2). *Vigila:
    `requestLogMiddleware.test.ts` (redacción de pino); nada escanea el repo:
    manual.*
11. La configuración se lee una vez y se valida al arrancar en
    `shared/constants.ts`; falta una variable y el proceso no arranca (§4).
    *Vigila: Zod al importar.*

**Cada cosa en su sitio**

12. Las capas se respetan y la dependencia va hacia dentro: rutas →
    controladores → servicios → interfaces de repositorio; solo
    `infrastructure/` conoce Mongoose (§3). *Vigila: manual: ESLint no tiene
    reglas de límites.*
13. Una sola fuente para cada verdad: constantes en un sitio, OpenAPI generado
    desde Zod y desde las constantes, fixtures generados. Nada se copia a mano
    (§4). *Vigila: `swaggerContract.test.ts`, `fixtures:check`.*
14. Se hace como ya se hace: repositorio por interfaz, un helper de paginación,
    un traductor de errores. Un módulo nuevo tiene la misma forma que los demás
    (`docs/guides/adding-new-features.md`). *Vigila: `tsc` (el `implements`);
    el resto es manual.*

**El código se lee solo**

15. Ningún comentario por defecto; si es imprescindible, una línea con una
    restricción que el código no puede decir. El porqué va a `docs/modules/` o
    a un ADR en `docs/architecture/decisions/` (§3). *Vigila: manual.*
16. Nombres que dicen su papel, formato automático, números con nombre y nada
    muerto: ni `TODO`, ni código comentado, ni exports que nadie importa, ni
    flags que nadie lee. *Vigila: Prettier, `noUnusedLocals`; el orden de
    imports solo avisa; los exports sin uso son manual.*
17. Tipos estrictos y sin escapes: sin `any`, sin `!`, y cada aserción
    justificada. *Vigila: `tsc` estricto; ESLint solo avisa: manual.*

**Los fallos se ven**

18. Nunca se silencia un error y el mensaje dice la verdad. Un fallo de red no
    es un conflicto de datos (§7). *Vigila: `errorMiddleware.test.ts`; manual.*
19. Todo error lleva un `code` estable y el cliente branchea por él, nunca por
    el texto (§3). *Vigila: `tsc` (el `code` está tipado contra `ERROR_CODES`);
    `swaggerContract.test.ts`.*

**Las pruebas prueban**

20. Todo cambio trae pruebas del camino feliz y de los bordes, y un arreglo
    empieza por la prueba que falla (§1). *Vigila: manual.*
21. Lo que los mocks no ven se prueba de verdad: índices, transacciones y
    colación contra Mongo real (§1.4, `npm run test:mongo`). *Vigila: el job
    `mongo` del CI; en local solo si se corre.*
22. Las pruebas son deterministas, no dependen del orden, y la cobertura tiene
    un umbral que alguien ejecuta. *Vigila: manual: Jest no baraja y no hay
    `coverageThreshold`.*

**Barato de mantener funcionando**

23. El código se escribe pensando en el coste, no solo se indexa: cada consulta
    pide únicamente lo que se va a usar, tiene su índice, y se mide con datos
    realistas. Si se puede acelerar sin empeorar el código ni el resultado, se
    hace (§3). *Vigila: pruebas que leen `schema.indexes()`; cronometrar es
    manual.*
24. La capa gratuita se protege por diseño: pocas conexiones, respuestas
    justas, una petición por dato, sin peticiones repetidas ni temporizadores
    que despierten la nube sin motivo. *Vigila: `mongoConnection.test.ts`; el
    consumo real es manual.*
25. (Solo front) El front respeta sus presupuestos de peso y de Lighthouse.
    Aquí: las respuestas salen sin campos internos y paginadas
    (`swaggerContract.test.ts`). *Vigila: `swaggerContract.test.ts`.*

**La pantalla es la del diseño**

26. (Solo front) Nada llega a una pantalla sin estar antes en el diseño.
    *Vigila: no aplica.*
27. (Solo front) Todo color por token, todo texto en los dos idiomas, todo
    control accesible. Aquí: los enums que la UI pinta salen de `constants.ts`
    y viajan por el OpenAPI. *Vigila: `swaggerContract.test.ts`.*
28. (Solo front) Toda vista tiene sus cuatro estados. Aquí: todo error que el
    front deba distinguir lleva `code` (regla 19). *Vigila: `tsc`.*

**Se puede seguir y se puede mantener**

29. Un fallo se sigue de punta a punta: una línea de log por petición y un
    `x-request-id` que el cliente manda y el log recoge, sin ruido ni datos
    personales (§2). *Vigila: `requestLogMiddleware.test.ts`,
    `requestIdMiddleware.test.ts`.*
30. La documentación dice lo que el código hace hoy, cada decisión no obvia
    queda escrita, una decisión revertida se marca en la original y un
    documento que ya no es verdad se retira (§4). *Vigila:
    `openapiCoverage.test.ts` para las rutas; el resto es manual.*

**Las reglas sobre las reglas**

- Toda regla tiene quien la vigile. Una regla cuyo *Vigila* dice «manual» se
  comprueba en la revisión independiente de abajo, y decirlo aquí es el mínimo.
  *Vigila: esta lista.*
- Un cambio no está terminado hasta que se cumple §1: gate verde y leído,
  verificado contra lo real, un commit por ítem, sin defectos conocidos
  callados. Lo que se encuentra y no se arregla se reporta al dueño como
  hallazgo (§8), y él le pone número en su lista. *Vigila: el gate,
  `commitlint`, `lefthook`.*
- Cada cambio terminado lo revisa un revisor independiente antes de cerrarlo:
  un subagente nuevo cuando el trabajo lo hizo un agente, otra persona cuando
  lo hizo un humano. Recibe la tarea y lo producido (el diff, la salida del
  gate, la verificación real, los docs), no el razonamiento de quien lo hizo, y
  dice si se hizo de la mejor manera y qué cambiaría. Lo que señale se arregla
  en la misma rama antes de entregar el commit (`amend`, o un commit más si el
  primero ya se reportó); lo que no se arregla se reporta como hallazgo.
  *Vigila: manual.*

---

## Comandos

```bash
npm run start:dev        # servidor con recarga (necesita Mongo arriba)
docker compose up -d mongo   # replica set de un nodo
npm run ci               # gate completo: typecheck x2, lint, formato, tests
npm test                 # solo la suite
npm run format           # aplica Prettier
npm run db:sync-indexes  # crea/borra índices según los esquemas
npm run test:mongo       # suite contra Mongo real (NO la incluye `npm run ci`)
npm run seed:test        # semilla determinística para las pruebas del front
```
