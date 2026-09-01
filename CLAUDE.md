# Reglas de trabajo en este repo

API REST de finanzas personales. Express 5 + TypeScript + Mongoose sobre MongoDB
(replica set obligatorio). Producto **multiusuario real**, no una app personal:
ninguna decisión puede asumir "un solo usuario" o "poca data".

Este archivo manda sobre cualquier costumbre general. Si algo aquí contradice lo
que harías por defecto, gana lo de aquí.

---

## 1. Definición de "terminado"

Un cambio no está listo hasta que **las seis** se cumplen. No es una lista de
deseos: es el mínimo. Si algo no aplica, dilo explícitamente y por qué.

1. **`npm run ci` en verde.** Incluye typecheck de src y de tests, lint, formato
   y la suite completa. Nunca reportes "listo" sin haberlo corrido.
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

**Comentarios: mínimos.** Comenta la restricción no evidente o el porqué de una
decisión, no lo que el código ya dice. Una o dos líneas. Nada de changelog en
comentarios: para eso está git.

```ts
// Bien: explica una restricción invisible en el código
// Los índices parciales se validan por operación, incluso dentro de una
// transacción: hay que desmarcar la default vieja ANTES de marcar la nueva.

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
| Algo que el frontend debe adoptar | `auditoria/FASE-2-CONTRATO-FRONTEND.md` |
| Variables de entorno | `docs/guides/environment-vars.md` y `.env.example` |
| El flujo de despliegue | `docs/guides/deployment.md` |
| Arranque o setup local | `docs/guides/getting-started.md` |

Los request bodies del OpenAPI se generan desde los schemas Zod
(`src/config/swagger.ts`); las vistas de respuesta se mantienen a mano pero sus
enums salen de `constants.ts` para que no puedan derivar. Si añades un enum a
una vista, usa `enumOf(...)`, no una lista literal.

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
- Formato `tipo(alcance): descripción` en inglés, imperativo.
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

Si encuentras un problema fuera del alcance de lo que te pidieron: repórtalo,
no lo arregles por tu cuenta. Y si algo del cambio quedó incompleto o dudoso,
dilo en vez de dejarlo pasar.

---

## Comandos

```bash
npm run start:dev        # servidor con recarga (necesita Mongo arriba)
docker compose up -d mongo   # replica set de un nodo
npm run ci               # gate completo: typecheck x2, lint, formato, tests
npm test                 # solo la suite
npm run format           # aplica Prettier
npm run db:sync-indexes  # crea/borra índices según los esquemas
npm run seed:test        # semilla determinística para las pruebas del front
```
