/**
 * Tool registry - registers all Dynatrace MCP tools on the McpServer.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape, ZodTypeAny } from "zod";
import { z } from "zod";

import type { DynatraceClient } from "../services/dynatrace-client";
import { DynatraceApiError } from "../services/dynatrace-client";
import { RATE_LIMIT_MAX_CALLS, RATE_LIMIT_WINDOW_MS } from "../constants";
import { logger } from "../services/logger";

// Tool imports
import {
  getEnvironmentInfoSchema,
  getEnvironmentInfoAnnotations,
  getEnvironmentInfoDescription,
  handleGetEnvironmentInfo,
} from "./get-environment-info";
import {
  listProblemsSchema,
  listProblemsAnnotations,
  listProblemsDescription,
  handleListProblems,
} from "./list-problems";
import {
  findEntityByNameSchema,
  findEntityByNameAnnotations,
  findEntityByNameDescription,
  handleFindEntityByName,
} from "./find-entity-by-name";
import {
  verifyDqlSchema,
  verifyDqlAnnotations,
  verifyDqlDescription,
  handleVerifyDql,
  executeDqlSchema,
  executeDqlAnnotations,
  executeDqlDescription,
  handleExecuteDql,
} from "./dql-tools";
import {
  generateDqlSchema,
  generateDqlAnnotations,
  generateDqlDescription,
  handleGenerateDql,
  explainDqlSchema,
  explainDqlAnnotations,
  explainDqlDescription,
  handleExplainDql,
  chatWithDavisSchema,
  chatWithDavisAnnotations,
  chatWithDavisDescription,
  handleChatWithDavis,
} from "./davis-copilot-tools";
import {
  workloadDetailsSchema,
  workloadDetailsAnnotations,
  workloadDetailsDescription,
  handleWorkloadDetails,
} from "./workload-details";
import {
  kubernetesEventsSchema,
  kubernetesEventsAnnotations,
  kubernetesEventsDescription,
  handleKubernetesEvents,
} from "./kubernetes-events";
import {
  listExceptionsSchema,
  listExceptionsAnnotations,
  listExceptionsDescription,
  handleListExceptions,
} from "./list-exceptions";
import {
  getApplicationMetricsSchema,
  getApplicationMetricsAnnotations,
  getApplicationMetricsDescription,
  handleGetApplicationMetrics,
} from "./application-metrics";

// Rate limiting state
let toolCallTimestamps: number[] = [];

/**
 * Sanitize args for logging: redact sensitive fields, truncate long strings.
 */
function sanitizeArgsForLogging(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object") return {};
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (k.toLowerCase().includes("token") || k.toLowerCase().includes("secret")) {
      safe[k] = "[REDACTED]";
    } else if (typeof v === "string" && v.length > 200) {
      safe[k] = v.slice(0, 200) + "...";
    } else {
      safe[k] = v;
    }
  }
  return safe;
}

/**
 * Wrapper that adds rate limiting, error handling, and response formatting to each tool.
 */
function createToolHandler(
  name: string,
  handler: (args: any) => Promise<string>,
): (args: any) => Promise<CallToolResult> {
  return async (args: any): Promise<CallToolResult> => {
    const startTime = Date.now();

    // Rate limiting: max N calls per window
    const windowStart = startTime - RATE_LIMIT_WINDOW_MS;
    toolCallTimestamps = toolCallTimestamps.filter((ts) => ts > windowStart);

    if (toolCallTimestamps.length >= RATE_LIMIT_MAX_CALLS) {
      logger.warn("ratelimit", `Rate limit exceeded for tool`, {
        operation: name,
        status: "rate_limited",
        details: { maxCalls: RATE_LIMIT_MAX_CALLS, windowMs: RATE_LIMIT_WINDOW_MS },
      });
      return {
        content: [
          {
            type: "text",
            text: "Rate limit exceeded: Maximum 5 tool calls per 60 seconds. Please try again later.",
          },
        ],
        isError: true,
      };
    }

    toolCallTimestamps.push(startTime);

    logger.info("tool", `Tool call started`, {
      operation: name,
      details: { args: sanitizeArgsForLogging(args) },
    });

    try {
      const response = await handler(args);
      const durationMs = Date.now() - startTime;

      logger.info("tool", `Tool call completed successfully`, {
        operation: name,
        durationMs,
        status: "success",
        details: {
          responsePreview:
            response.length > 300 ? response.slice(0, 300) + "..." : response,
        },
      });

      return {
        content: [{ type: "text", text: response }],
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;

      if (error instanceof DynatraceApiError) {
        logger.error("tool", `Dynatrace API error in tool`, {
          operation: name,
          durationMs,
          status: "error",
          details: {
            httpStatus: error.status,
            apiError: error.message,
            body: error.body.slice(0, 500),
          },
        });
        return {
          content: [
            {
              type: "text",
              text: `Dynatrace API Error: ${error.message} (HTTP ${error.status}). Body: ${error.body}`,
            },
          ],
          isError: true,
        };
      }

      const message =
        error instanceof Error ? error.message : String(error);

      logger.error("tool", `Tool call failed`, {
        operation: name,
        durationMs,
        status: "error",
        details: { error: message },
      });

      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  };
}

/**
 * Register all Dynatrace MCP tools on the given McpServer.
 */
export function registerAllTools(
  server: McpServer,
  client: DynatraceClient,
  dtEnvironment: string,
  grailBudgetGB: number,
): void {
  // get_environment_info
  server.tool(
    "get_environment_info",
    getEnvironmentInfoDescription,
    getEnvironmentInfoSchema,
    getEnvironmentInfoAnnotations,
    createToolHandler("get_environment_info", () =>
      handleGetEnvironmentInfo(client, {}),
    ),
  );

  // list_problems
  server.tool(
    "list_problems",
    listProblemsDescription,
    listProblemsSchema,
    listProblemsAnnotations,
    createToolHandler("list_problems", (args) =>
      handleListProblems(client, args, dtEnvironment),
    ),
  );

  // find_entity_by_name
  server.tool(
    "find_entity_by_name",
    findEntityByNameDescription,
    findEntityByNameSchema,
    findEntityByNameAnnotations,
    createToolHandler("find_entity_by_name", (args) =>
      handleFindEntityByName(client, args),
    ),
  );

  // verify_dql
  server.tool(
    "verify_dql",
    verifyDqlDescription,
    verifyDqlSchema,
    verifyDqlAnnotations,
    createToolHandler("verify_dql", (args) => handleVerifyDql(client, args)),
  );

  // execute_dql
  server.tool(
    "execute_dql",
    executeDqlDescription,
    executeDqlSchema,
    executeDqlAnnotations,
    createToolHandler("execute_dql", (args) =>
      handleExecuteDql(client, args, grailBudgetGB),
    ),
  );

  // generate_dql_from_natural_language
  server.tool(
    "generate_dql_from_natural_language",
    generateDqlDescription,
    generateDqlSchema,
    generateDqlAnnotations,
    createToolHandler("generate_dql_from_natural_language", (args) =>
      handleGenerateDql(client, args),
    ),
  );

  // explain_dql_in_natural_language
  server.tool(
    "explain_dql_in_natural_language",
    explainDqlDescription,
    explainDqlSchema,
    explainDqlAnnotations,
    createToolHandler("explain_dql_in_natural_language", (args) =>
      handleExplainDql(client, args),
    ),
  );

  // workload_details
  server.tool(
    "workload_details",
    workloadDetailsDescription,
    workloadDetailsSchema,
    workloadDetailsAnnotations,
    createToolHandler("workload_details", (args) =>
      handleWorkloadDetails(client, args),
    ),
  );

  // chat_with_davis_copilot
  server.tool(
    "chat_with_davis_copilot",
    chatWithDavisDescription,
    chatWithDavisSchema,
    chatWithDavisAnnotations,
    createToolHandler("chat_with_davis_copilot", (args) =>
      handleChatWithDavis(client, args),
    ),
  );

  // get_kubernetes_events
  server.tool(
    "get_kubernetes_events",
    kubernetesEventsDescription,
    kubernetesEventsSchema,
    kubernetesEventsAnnotations,
    createToolHandler("get_kubernetes_events", (args) =>
      handleKubernetesEvents(client, args),
    ),
  );

  // list_exceptions
  server.tool(
    "list_exceptions",
    listExceptionsDescription,
    listExceptionsSchema,
    listExceptionsAnnotations,
    createToolHandler("list_exceptions", (args) =>
      handleListExceptions(client, args, dtEnvironment),
    ),
  );

  // get_application_metrics
  server.tool(
    "get_application_metrics",
    getApplicationMetricsDescription,
    getApplicationMetricsSchema,
    getApplicationMetricsAnnotations,
    createToolHandler("get_application_metrics", (args) =>
      handleGetApplicationMetrics(client, args, grailBudgetGB),
    ),
  );

  logger.info("startup", "MCP tools registered", {
    details: { count: 12 },
  });
}
