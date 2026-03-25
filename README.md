# Dynatrace MCP Server (ElysiaJS + Bun)

Servidor MCP (Model Context Protocol) remoto para Dynatrace, construido con ElysiaJS y Bun. Expone herramientas para consultar métricas de aplicación, ejecutar queries DQL, buscar problemas, obtener información del entorno y más.

## Características

- **Remote MCP Server**: Implementa el protocolo MCP vía Streamable HTTP (stateless)
- **TypeScript + Bun**: Código type-safe con el runtime de Bun de alto rendimiento
- **ElysiaJS**: Framework web ultrarrápido y minimalista
- **Rate Limiting**: Protección contra abusos (5 llamadas por minuto)
- **Grail Budget Tracker**: Control de consumo de queries DQL en GRAIL
- **Docker Ready**: Despliegue contenedorizado listo para producción

## Herramientas Disponibles

El servidor expone las siguientes 12 herramientas (tools) MCP:

| Herramienta | Descripción |
|-------------|-------------|
| `get_environment_info` | Obtiene información del entorno de Dynatrace incluyendo versión,cluster ID, y configuraciones relevantes. |
| `list_problems` | Lista problemas (Davis problems) de Dynatrace con filtros por estado, prioridad y timeframe. |
| `find_entity_by_name` | Busca entidades por nombre para obtener su ID y tipo. Ideal para filtrar queries DQL. |
| `verify_dql` | Verifica sintácticamente una sentencia DQL antes de ejecutarla. |
| `execute_dql` | Ejecuta queries DQL en GRAIL para obtener logs, métricas, eventos, trazas y datos de entidades. |
| `generate_dql_from_natural_language` | Genera queries DQL a partir de descripciones en lenguaje natural. |
| `explain_dql_in_natural_language` | Explica queries DQL en lenguaje natural para facilitar su comprensión. |
| `workload_details` | Obtiene detalles de workloads de Kubernetes incluyendo servicios, pods y métricas de rendimiento. |
| `chat_with_davis_copilot` | Interactúa con el Copiloto de Davis para obtener análisis de problemas y recomendaciones. |
| `get_kubernetes_events` | Recupera eventos de clusters Kubernetes monitorizados por Dynatrace. |
| `list_exceptions` | Lista excepciones capturadas por Dynatrace OneAgent. |
| `get_application_metrics` | Obtiene métricas de aplicación incluyendo disponibilidad, latencia, MTTR, errores, volumetría y métricas ponderadas. |

## Requisitos Previos

- [Bun](https://bun.sh) - Runtime de JavaScript de alto rendimiento
- [Dynatrace](https://www.dynatrace.com) - Cuenta de Dynatrace con acceso a la API de Platform
- [Platform Token](https://docs.dynatrace.com/docs/dynatrace-api/basics/authentication) - Token de autenticación para la API de Dynatrace

## Configuración

### Variables de Entorno

| Variable | Requerido | Descripción | Valor por defecto |
|----------|-----------|-------------|-------------------|
| `DT_ENVIRONMENT` | Sí | URL del entorno de Dynatrace (e.g., `https://abc123.apps.dynatrace.com`) | - |
| `DT_PLATFORM_TOKEN` | Sí | Platform Token para autenticación | - |
| `PORT` | No | Puerto del servidor | `3000` |
| `HOST` | No | Host donde bindea el servidor | `0.0.0.0` |
| `CORS_ORIGIN` | No | Orígenes permitidos para CORS | `*` |
| `DT_GRAIL_QUERY_BUDGET_GB` | No | Presupuesto de queries DQL en GB | `1000` |
| `LOG_LEVEL` | No | Nivel de logging | `info` |

### Archivo .env

Crea un archivo `.env` en la raíz del proyecto:

```bash
# Required: Dynatrace environment URL
DT_ENVIRONMENT=https://your-environment-id.apps.dynatrace.com

# Required: Platform Token for authentication
DT_PLATFORM_TOKEN=dt0c01.XXXXXXXX.YYYYYYYY

# Optional: Server configuration
PORT=3000
HOST=0.0.0.0

# Optional: CORS origins
CORS_ORIGIN=*

# Optional: Grail query budget in GB
DT_GRAIL_QUERY_BUDGET_GB=1000

# Optional: Log level
LOG_LEVEL=info
```

## Instalación y Ejecución

### 1. Instalar dependencias

```bash
bun install
```

### 2. Configurar variables de entorno

Copia el archivo `.env.example` a `.env` y completa los valores:

```bash
cp .env.example .env
# Edita .env con tus credenciales
```

### 3. Ejecutar en desarrollo

```bash
bun run dev
```

El servidor se iniciara en `http://localhost:3000`

### 4. Ejecutar en producción

```bash
bun run start
```

O compilar a binario:

```bash
bun run build
./server
```

## Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/` | Información del servidor |
| GET | `/health` | Health check |
| POST | `/mcp` | Endpoint MCP para recibir requests JSON-RPC |

## Docker

### Ejecutar localmente para pruebas

Si ya tienes la imagen publicada en Docker Hub o quieres probar localmente:

```bash
# Ejecutar el contenedor
docker run -p 3000:3000 \
  --env-file .env \
  elysia-dynatrace-mcp-remote:latest
```

O si prefieres pasar las variables directamente:

```bash
docker run -p 3000:3000 \
  -e DT_ENVIRONMENT=https://tu-entorno.apps.dynatrace.com \
  -e DT_PLATFORM_TOKEN=tu-token-aqui \
  elysia-dynatrace-mcp-remote:latest
```

Verificar que el contenedor está corriendo:

```bash
curl http://localhost:3000/health
```

### Build de la imagen local

```bash
docker build -t elysia-dynatrace-mcp-remote .
```

### Ejecutar el contenedor

```bash
docker run -p 3000:3000 --env-file .env elysia-dynatrace-mcp-remote
```

### Usando Docker Compose

```bash
docker-compose up -d
```

## Publicar en Docker Hub

### Build multi-arquitectura (arm64 + amd64)

```bash
# Login to Docker Hub
docker login

# Build y push para ambas arquitecturas
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t your-dockerhub-username/elysia-dynatrace-mcp-remote:latest \
  --push .
```

# Build y push para ambas arquitecturas con usuario
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t greenteethskull/elysia-dynatrace-mcp-remote:latest \
  --push .
```

### Pull de la imagen

```bash
docker pull your-dockerhub-username/elysia-dynatrace-mcp-remote:latest
```

## Uso con MCP Clients

Una vez ejecutado el servidor, puedes conectarlo con clientes MCP como:

- Claude Desktop
- Cursor
- Continue
- Otros clientes compatibles con MCP via Streamable HTTP

### Configuración de ejemplo para Cursor

Agrega esto a tu configuración de Cursor:

```json
{
  "mcpServers": {
    "dynatrace": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Ejemplos de Uso

### Obtener métricas de aplicación

```typescript
// Tool: get_application_metrics
// Parameters:
{
  "applicationCode": "MIEP",
  "timeframe": "-24h"
}
```

### Ejecutar una query DQL

```typescript
// Tool: execute_dql
// Parameters:
{
  "dqlStatement": "fetch logs, from:-1h | filter content == \"error\" | limit 10"
}
```

### Listar problemas activos

```typescript
// Tool: list_problems
// Parameters:
{
  "status": "ACTIVE",
  "priority": "HIGH"
}
```

## Licencia

MIT
