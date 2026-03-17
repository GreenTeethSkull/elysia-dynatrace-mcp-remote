import { z } from "zod";
import type { DynatraceClient } from "../services/dynatrace-client";
import {
  isDavisCopilotSkillAvailable,
  generateDqlFromNaturalLanguage,
  explainDqlInNaturalLanguage,
  chatWithDavisCopilot,
  DAVIS_COPILOT_DOCS,
} from "../services/davis-copilot";

// ── generate_dql_from_natural_language ──

export const generateDqlSchema = {
  text: z
    .string()
    .describe(
      "Natural language description of what you want to query. Be specific and include time ranges, entities, and metrics of interest.",
    ),
};

export const generateDqlAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
};

export const generateDqlDescription =
  "Convert natural language queries to Dynatrace Query Language (DQL) using Davis CoPilot AI. You can ask for problem events, security issues, logs, metrics, spans, and custom data.";

export async function handleGenerateDql(
  client: DynatraceClient,
  args: { text: string },
): Promise<string> {
  const isAvailable = await isDavisCopilotSkillAvailable(client, "nl2dql");
  if (!isAvailable) {
    return `The DQL generation skill is not available. Please visit: ${DAVIS_COPILOT_DOCS.ENABLE_COPILOT}`;
  }

  const response = await generateDqlFromNaturalLanguage(client, args.text);

  let resp = `Natural Language to DQL:\n\n`;
  resp += `**Query:** "${args.text}"\n\n`;
  if (response.dql) {
    resp += `**Generated DQL:**\n\`\`\`\n${response.dql}\n\`\`\`\n\n`;
  }
  resp += `**Status:** ${response.status}\n`;

  if (
    response.metadata?.notifications &&
    response.metadata.notifications.length > 0
  ) {
    resp += `\n**Notifications:**\n`;
    response.metadata.notifications.forEach((notification) => {
      resp += `- ${notification.severity}: ${notification.message}\n`;
    });
  }

  if (response.status !== "FAILED") {
    resp += `\n**Next Steps:**\n`;
    resp += `1. Use "execute_dql" tool to run the query (you can omit running "verify_dql")\n`;
    resp += `2. If results don't match, refine your natural language description and try again\n`;
  }

  return resp;
}

// ── explain_dql_in_natural_language ──

export const explainDqlSchema = {
  dql: z.string().describe("The DQL statement to explain"),
};

export const explainDqlAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
};

export const explainDqlDescription =
  "Explain Dynatrace Query Language (DQL) statements in natural language using Davis CoPilot AI.";

export async function handleExplainDql(
  client: DynatraceClient,
  args: { dql: string },
): Promise<string> {
  const isAvailable = await isDavisCopilotSkillAvailable(client, "dql2nl");
  if (!isAvailable) {
    return `The DQL explanation skill is not available. Please visit: ${DAVIS_COPILOT_DOCS.ENABLE_COPILOT}`;
  }

  const response = await explainDqlInNaturalLanguage(client, args.dql);

  let resp = `DQL Explanation:\n\n`;
  resp += `**DQL:**\n\`\`\`\n${args.dql}\n\`\`\`\n\n`;
  resp += `**Explanation:**\n${response.explanation}\n`;

  return resp;
}

// ── chat_with_davis_copilot ──

export const chatWithDavisSchema = {
  text: z
    .string()
    .describe("Your question or request for Davis CoPilot"),
  context: z
    .string()
    .optional()
    .describe(
      "Optional context to provide additional information (like problem details, vulnerability details, entity information)",
    ),
  instruction: z
    .string()
    .optional()
    .describe("Optional instruction for how to format the response"),
};

export const chatWithDavisAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

export const chatWithDavisDescription =
  "Use this tool to ask any Dynatrace related question, in case no other more specific tool is available.";

export async function handleChatWithDavis(
  client: DynatraceClient,
  args: { text: string; context?: string; instruction?: string },
): Promise<string> {
  const isAvailable = await isDavisCopilotSkillAvailable(
    client,
    "conversation",
  );
  if (!isAvailable) {
    return `The conversation skill is not available. Please visit: ${DAVIS_COPILOT_DOCS.ENABLE_COPILOT}`;
  }

  const conversationContext: Array<{ type: string; value: string }> = [];

  if (args.context) {
    conversationContext.push({ type: "supplementary", value: args.context });
  }
  if (args.instruction) {
    conversationContext.push({ type: "instruction", value: args.instruction });
  }

  const response = await chatWithDavisCopilot(
    client,
    args.text,
    conversationContext,
  );

  let resp = `Davis CoPilot Response:\n\n`;
  resp += `**Your Question:** "${args.text}"\n\n`;
  if (response.text) {
    resp += `**Answer:**\n${response.text}\n\n`;
  }
  resp += `**Status:** ${response.status}\n`;

  if (
    response.metadata?.sources &&
    response.metadata.sources.length > 0
  ) {
    resp += `\n**Sources:**\n`;
    response.metadata.sources.forEach((source) => {
      resp += `- ${source.title || "Untitled"}: ${source.url || "No URL"}\n`;
    });
  }

  if (
    response.metadata?.notifications &&
    response.metadata.notifications.length > 0
  ) {
    resp += `\n**Notifications:**\n`;
    response.metadata.notifications.forEach((notification) => {
      resp += `- ${notification.severity}: ${notification.message}\n`;
    });
  }

  if (response.state?.conversationId) {
    resp += `\n**Conversation ID:** ${response.state.conversationId}`;
  }

  if (response.status === "FAILED") {
    resp += `\n**Your request was not successful**\n`;
  }

  return resp;
}
