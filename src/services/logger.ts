/**
 * Structured JSON logger for Application Insights via stderr.
 *
 * App Service Diagnostic Settings capture stderr as AppServiceConsoleLogs.
 * Each log entry is a JSON line with:
 *  - timestamp: ISO 8601
 *  - level: info | warn | error
 *  - category: functional area (mcp, tool, dql, http, budget, ratelimit, startup)
 *  - message: human-readable summary
 *  - operation: name of the MCP tool or HTTP method+path
 *  - durationMs: elapsed time for the operation
 *  - status: success | error | rate_limited
 *  - details: free-form metadata (args summary, error message, scanned bytes, etc.)
 */

export type LogCategory =
  | "startup"
  | "mcp"
  | "tool"
  | "dql"
  | "http"
  | "budget"
  | "ratelimit";

export type OperationStatus =
  | "success"
  | "error"
  | "rate_limited"
  | "budget_exceeded";

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  category: LogCategory;
  message: string;
  operation?: string;
  durationMs?: number;
  status?: OperationStatus;
  details?: Record<string, unknown>;
}

function emit(entry: LogEntry): void {
  // All logging goes to stderr to avoid interfering with MCP protocol on stdout
  console.error(JSON.stringify(entry));
}

export const logger = {
  info(
    category: LogCategory,
    message: string,
    options?: {
      operation?: string;
      durationMs?: number;
      status?: OperationStatus;
      details?: Record<string, unknown>;
    },
  ): void {
    emit({
      timestamp: new Date().toISOString(),
      level: "info",
      category,
      message,
      ...options,
    });
  },

  warn(
    category: LogCategory,
    message: string,
    options?: {
      operation?: string;
      durationMs?: number;
      status?: OperationStatus;
      details?: Record<string, unknown>;
    },
  ): void {
    emit({
      timestamp: new Date().toISOString(),
      level: "warn",
      category,
      message,
      ...options,
    });
  },

  error(
    category: LogCategory,
    message: string,
    options?: {
      operation?: string;
      durationMs?: number;
      status?: OperationStatus;
      details?: Record<string, unknown>;
    },
  ): void {
    emit({
      timestamp: new Date().toISOString(),
      level: "error",
      category,
      message,
      ...options,
    });
  },
};

// Keep old `log` export for backward compatibility (used by server.ts onRequest)
export function log(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  data?: Record<string, unknown>,
): void {
  logger.info("mcp", message, { details: data });
}
