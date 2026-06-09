# AGENTS.md — Instrucciones para Agentes de IA

Este archivo proporciona contexto esencial del proyecto **elysia-dynatrace-mcp-remote** para que cualquier agente de IA pueda trabajar efectivamente en él.

## Descripción del Proyecto

Servidor MCP (Model Context Protocol) remoto para Dynatrace, construido con ElysiaJS y Bun. Expone 14 herramientas para consultar métricas, ejecutar queries DQL, buscar problemas, obtener información de workloads y más. Diseñado para ser consumido por agentes de IA (Claude, Cursor, etc.) vía Streamable HTTP.

## Stack Tecnológico

- **Runtime**: Bun (JavaScript/TypeScript runtime de alto rendimiento)
- **Framework Web**: ElysiaJS (ultrarrápido, type-safe)
- **Protocolo**: MCP (Model Context Protocol) via Streamable HTTP
- **Lenguaje**: TypeScript
- **Contenedorización**: Docker (multi-stage build)
- **Autenticación**: Dynatrace Platform Token

## Arquitectura

### Flujo de Request

```
Cliente MCP (Claude/Cursor/Agente)
  ↓ POST /mcp (JSON-RPC)
ElysiaJS Server
  ↓ Crea McpServer + StreamableHTTPServerTransport por request
McpServer (instancia aislada)
  ↓ Ejecuta tool handler
DynatraceClient
  ↓ HTTP requests a Dynatrace API
Dynatrace Platform
```

### Concurrencia

**IMPORTANTE**: Cada request POST `/mcp` crea una nueva instancia de `McpServer` y `StreamableHTTPServerTransport`. Esto permite manejar múltiples requests simultáneos sin conflictos de estado compartido.

- **Antes (bug)**: Un solo `McpServer` compartido → fallaba con concurrencia > 1
- **Ahora (fix)**: `createMcpServer()` factory por request → concurrencia ilimitada

### Rate Limiting

- **Límite**: 60 tool calls por ventana de 60 segundos (global, no por cliente)
- **Configuración**: `src/constants.ts` → `RATE_LIMIT_MAX_CALLS = 60`, `RATE_LIMIT_WINDOW_MS = 60_000`
- **Implementación**: Array en memoria `toolCallTimestamps` en `src/tools/index.ts`
- **Comportamiento**: Cuando se excede, retorna error JSON-RPC con mensaje de rate limit

## Estructura de Archivos

```
src/
├── index.ts                    # Entry point - inicializa servidor
├── server.ts                   # ElysiaJS app + endpoint /mcp + concurrencia
├── constants.ts                # Constantes globales (rate limit, timeouts, etc.)
├── services/
│   ├── dynatrace-client.ts     # Cliente HTTP para Dynatrace API
│   ├── dynatrace-env.ts        # Validación de variables de entorno
│   ├── dql-engine.ts           # Ejecución y validación de queries DQL
│   ├── davis-copilot.ts        # Integración con Davis Copilot API
│   └── logger.ts               # Sistema de logging estructurado
├── tools/
│   ├── index.ts                # Registro de tools + rate limiting + error handling
│   ├── get-environment-info.ts # Tool: get_environment_info
│   ├── list-problems.ts        # Tool: list_problems
│   ├── find-entity-by-name.ts  # Tool: find_entity_by_name
│   ├── dql-tools.ts            # Tools: verify_dql, execute_dql
│   ├── davis-copilot-tools.ts  # Tools: generate_dql, explain_dql, chat_with_davis
│   ├── workload-details.ts     # Tool: workload_details
│   ├── kubernetes-events.ts    # Tool: get_kubernetes_events
│   ├── list-exceptions.ts      # Tool: list_exceptions
│   ├── application-metrics.ts  # Tool: get_application_metrics
│   ├── api-info.ts             # Tool: get_api_info
│   └── api-list.ts             # Tool: list_apis_summary
├── utils/                      # Utilidades generales
├── mcp/                        # (vacío, reservado para futuro)
└── plugins/                    # Plugins de Elysia

```

## Comandos

### Desarrollo

```bash
bun install          # Instalar dependencias
bun run dev          # Servidor con hot reload (--watch)
bun run start        # Servidor en modo producción
bun run build        # Compilar a binario único (./server)
bun test             # Ejecutar tests (actualmente no hay tests)
bunx tsc --noEmit    # Type check sin emitir archivos
```

### Docker

```bash
docker build -t elysia-dynatrace-mcp-remote .
docker run -p 3000:3000 --env-file .env elysia-dynatrace-mcp-remote
docker-compose up -d
```

### Multi-arquitectura (arm64 + amd64)

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t greenteethskull/elysia-dynatrace-mcp-remote:latest \
  --push .
```

## Variables de Entorno

| Variable | Requerido | Default | Descripción |
|----------|-----------|---------|-------------|
| `DT_ENVIRONMENT` | Sí | - | URL del entorno Dynatrace (e.g., `https://abc123.apps.dynatrace.com`) |
| `DT_PLATFORM_TOKEN` | Sí | - | Platform Token para autenticación |
| `PORT` | No | `3000` | Puerto del servidor |
| `HOST` | No | `0.0.0.0` | Host donde bindea el servidor |
| `CORS_ORIGIN` | No | `*` | Orígenes permitidos para CORS |
| `DT_GRAIL_QUERY_BUDGET_GB` | No | `1000` | Presupuesto de queries DQL en GB (-1 = ilimitado) |
| `LOG_LEVEL` | No | `info` | Nivel de logging (debug, info, warn, error) |

## Herramientas MCP Disponibles (14 tools)

| Tool | Descripción | Archivo |
|------|-------------|---------|
| `get_environment_info` | Info del entorno Dynatrace | `tools/get-environment-info.ts` |
| `list_problems` | Lista problemas Davis | `tools/list-problems.ts` |
| `find_entity_by_name` | Busca entidades por nombre | `tools/find-entity-by-name.ts` |
| `verify_dql` | Valida sintaxis DQL | `tools/dql-tools.ts` |
| `execute_dql` | Ejecuta queries en GRAIL | `tools/dql-tools.ts` |
| `generate_dql_from_natural_language` | Genera DQL desde texto | `tools/davis-copilot-tools.ts` |
| `explain_dql_in_natural_language` | Explica DQL en texto | `tools/davis-copilot-tools.ts` |
| `chat_with_davis_copilot` | Chat con Davis Copilot | `tools/davis-copilot-tools.ts` |
| `workload_details` | Detalles de workloads K8s | `tools/workload-details.ts` |
| `get_kubernetes_events` | Eventos de clusters K8s | `tools/kubernetes-events.ts` |
| `list_exceptions` | Excepciones capturadas | `tools/list-exceptions.ts` |
| `get_application_metrics` | Métricas de aplicación | `tools/application-metrics.ts` |
| `get_api_info` | Métricas de API específica | `tools/api-info.ts` |
| `list_apis_summary` | Resumen de todas las APIs | `tools/api-list.ts` |

## Convenciones de Código

### Estructura de Tool

Cada tool sigue este patrón:

```typescript
// 1. Schema Zod para validación de parámetros
export const toolNameSchema = { ... };

// 2. Anotaciones MCP (metadata)
export const toolNameAnnotations = { ... };

// 3. Descripción para el agente
export const toolNameDescription = "...";

// 4. Handler que ejecuta la lógica
export async function handleToolName(
  client: DynatraceClient,
  args: z.infer<typeof toolNameSchema>,
  ...extras
): Promise<string> {
  // Implementación
}
```

### Registro de Tools

Todos los tools se registran en `src/tools/index.ts` usando `createToolHandler()`:

```typescript
server.tool(
  "tool_name",
  toolNameDescription,
  toolNameSchema,
  toolNameAnnotations,
  createToolHandler("tool_name", (args) => handleToolName(client, args)),
);
```

`createToolHandler` agrega:
- Rate limiting (60 calls/60s)
- Logging estructurado
- Error handling (DynatraceApiError, errores genéricos)
- Formateo de respuesta

### Logging

Sistema de logging estructurado en `src/services/logger.ts`:

```typescript
logger.info("category", "message", {
  operation: "operation_name",
  status: "success" | "error" | "rate_limited",
  durationMs: 1234,
  details: { ... }
});
```

**Categorías**: `mcp`, `tool`, `dql`, `http`, `budget`, `ratelimit`, `startup`

### Cliente Dynatrace

`src/services/dynatrace-client.ts`:
- Usa `fetch` nativo de Bun
- Autenticación via header `Authorization: Api-Token <token>`
- Timeout: 30 segundos (`REQUEST_TIMEOUT_MS`)
- Clase `DynatraceApiError` para errores HTTP de Dynatrace

## Endpoints HTTP

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/` | Info del servidor |
| GET | `/health` | Health check |
| POST | `/mcp` | Endpoint MCP (JSON-RPC) |
| GET | `/mcp` | 405 - No soportado (stateless) |
| DELETE | `/mcp` | 405 - No soportado (stateless) |

## Testing de Carga

Script externo para pruebas de concurrencia:

```bash
python mcp_load_test.py \
  --endpoint http://0.0.0.0:3000/mcp \
  --tool workload_details \
  --args '{"workload": "mi-app", "timeframe": "2h", "limit": 10}' \
  --concurrency 5 --total 10 -o results.json
```

## Problemas Conocidos y Soluciones

### Bug de Concurrencia (RESUELTO)

**Problema**: Un solo `McpServer` compartido causaba fallos con requests simultáneos.

**Solución**: Crear nuevo `McpServer` por request en `server.ts`:

```typescript
.post("/mcp", async ({ request, set }) => {
  const mcpServer = createMcpServer(dtClient, env.dtEnvironment, env.grailBudgetGB);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  // ... manejo de request
});
```

### Rate Limit Excedido

Si ves errores de rate limit:
- Aumenta `RATE_LIMIT_MAX_CALLS` en `src/constants.ts`
- Considera implementar rate limiting por cliente (actualmente es global)

## Notas de Seguridad

- **NUNCA** commitear el archivo `.env` con tokens reales
- El `.gitignore` ya excluye `.env`
- Los logs redactan campos sensibles (`token`, `secret`)
- Validar siempre inputs con schemas Zod

## Mantenimiento

### Agregar Nuevo Tool

1. Crear archivo `src/tools/nuevo-tool.ts`
2. Exportar: `schema`, `annotations`, `description`, `handler`
3. Importar en `src/tools/index.ts`
4. Registrar con `server.tool(...)` dentro de `registerAllTools()`
5. Actualizar README.md y este AGENTS.md

### Actualizar Dependencias

```bash
bun update
bunx tsc --noEmit  # Verificar tipos
bun run build      # Verificar build
```

### Publicar Nueva Versión

1. Actualizar versión en `package.json` y `src/constants.ts`
2. Build multi-arquitectura Docker
3. Push a Docker Hub
4. Tag en Git

## Contacto y Soporte

- **Autor**: Angel Rios (SRE @ Pacífico Seguros)
- **Repo**: https://github.com/greenteethskull/elysia-dynatrace-mcp-remote
- **Issues**: Reportar en GitHub Issues

## Licencia

MIT
