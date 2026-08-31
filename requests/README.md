# Pruebas manuales del API (`.http`)

Pruebas modulares e interactivas del backend, una por módulo. Haces **click en
"Send Request"** sobre cualquier petición y ves la respuesta al lado — eliges la
que quieras, cambias valores a gusto, y pruebas casos de éxito y de error.

## Cómo usarlo

- **VS Code:** instala la extensión **REST Client** (`humao.rest-client`). Aparece
  un "Send Request" sobre cada petición.
- **JetBrains (WebStorm/IntelliJ):** el **HTTP Client** es nativo (ícono ▶ a la
  izquierda de cada petición). Usa `http-client.env.json` para el entorno.

Cada archivo es **autosuficiente**: arriba hace `login` y captura el `accessToken`
automáticamente; el resto de peticiones lo reutilizan. Corre primero el `login` de
cada archivo (o el `register` si aún no existe el usuario), luego lo que quieras.

## Variables

Cada archivo define arriba: `@baseUrl`, `@email`, `@password` y `@apiSecret`.
- `@apiSecret`: solo si el backend corre con `API_SECRET` seteado. En dev normal va
  **vacío** (middleware lo omite) y no hace falta tocar nada. Si lo activas, agrega
  `x-api-secret: <tu-secreto>` como header a cada request (o usa la variable).
- IDs (cuenta, categoría, transacción, budget) se capturan de las respuestas de
  `create` con `{{nombre.response.body.id}}` — así encadenas create → get → update
  → delete sin copiar/pegar.

## Prerrequisitos del backend

- `npm run start:dev` corriendo.
- MongoDB como **replica set** (docker-compose local o Atlas) — las transacciones lo exigen.

## Archivos

| Archivo | Módulo |
|---|---|
| `health.http` | Health check |
| `auth.http` | Registro (devuelve tokens, reactivación), login, refresh con rotación real, logout/logout-all, sesiones activas |
| `users.http` | Perfil (currency, lastLoginAt), timezone, currency con bloqueo, credenciales con `currentPassword` |
| `accounts.http` | Cuentas (currency estampada), default (bloqueo al archivarla), archivar/restaurar idempotentes, lectura de archivadas |
| `categories.http` | Categorías, seedKey/restore-defaults, type bloqueado con historial, unicidad case-insensitive, archivar idempotente |
| `transactions.http` | Transacciones, ADJUSTMENT, quick-add con idempotencia, hash de payload (422), filtros nuevos (categoría/fechas/tag/uncategorized), `GET /transactions/tags`, FUTURE_DATE |
| `budgets.http` | Budgets por categoría y GLOBAL, meta INCOME, effectiveFrom, overrides (set/0/DELETE), CUSTOM con expiración, sin restore |
| `stats.http` | Estadísticas (day cronológico, untagged, total real en tags, ADJUSTMENT excluido, from<=to) |

> Reemplaza al viejo `api.http` (un solo archivo, desactualizado).
>
> **Errores:** todas las respuestas de error traen un `code` estable
> (`VALIDATION`, `CURRENCY_LOCKED`, `BUDGET_PERIOD_OVERLAP`, …) — branchear por
> `code`, no por `message`. "No existe" y "no es tuyo" son **404 uniforme**.

## Alternativa si quieres una UI más rica

Si más adelante quieres carpetas + UI por petición (historial, entornos gráficos),
**Bruno** (open source, offline, guarda las peticiones como archivos en el repo) es
el siguiente paso natural. Los `.http` se mantienen como la opción de menor fricción.
