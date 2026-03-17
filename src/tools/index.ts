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

// Rate limiting state
let toolCallTimestamps: number[] = [];

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
      return {
        content: [
          {
            type: "text",
            text: "Rate limit exceeded: Maximum 5 tool calls per 20 seconds. Please try again later.",
          },
        ],
        isError: true,
      };
    }

    toolCallTimestamps.push(startTime);

    try {
      const response = await handler(args);
      return {
        content: [{ type: "text", text: response }],
      };
    } catch (error: unknown) {
      if (error instanceof DynatraceApiError) {
        let additionalInfo = "";
        if (error.status === 403) {
          additionalInfo =
            " Note: Your user is most likely lacking the necessary permissions/scopes for this API Call.";
        }
        return {
          content: [
            {
              type: "text",
              text: `Dynatrace API Error: ${error.message} (HTTP ${error.status}).${additionalInfo} Body: ${error.body}`,
            },
          ],
          isError: true,
        };
      }

      const message =
        error instanceof Error ? error.message : String(error);
      console.error(`Tool ${name} error:`, error);
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

  console.error(`Registered 11 Dynatrace MCP tools.`);
}
