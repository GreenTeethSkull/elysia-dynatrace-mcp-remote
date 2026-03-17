import { z } from "zod";
import type { DynatraceClient } from "../services/dynatrace-client";
import { executeDql } from "../services/dql-engine";

export const listExceptionsSchema = {
  timeframe: z
    .string()
    .optional()
    .default("24h")
    .describe(
      'Timeframe to query (e.g., "12h", "24h", "7d", "30d", "30m"). Default: "24h". Supports days (d), hours (h) and minutes (m).',
    ),
  additionalFilter: z
    .string()
    .optional()
    .describe(
      "Additional DQL filter for user.events - filter by error id, application id, application entity, or OS name. Leave empty to get all exceptions.",
    ),
  maxExceptionsToDisplay: z
    .number()
    .default(10)
    .describe("Maximum number of exceptions to display in the response."),
};

export const listExceptionsAnnotations = {
  readOnlyHint: true,
};

export const listExceptionsDescription =
  "List all exceptions known on Dynatrace starting with the most recent.";

export async function handleListExceptions(
  client: DynatraceClient,
  args: {
    timeframe: string;
    additionalFilter?: string;
    maxExceptionsToDisplay: number;
  },
  dtEnvironment: string,
): Promise<string> {
  const { timeframe, additionalFilter, maxExceptionsToDisplay } = args;

  const dql = `fetch user.events, from: now()-${timeframe}, to: now()
| filter isNotNull(exception.stack_trace)
| filter isNotNull(error.id)
${additionalFilter ? `| filter ${additionalFilter}` : ""}
| fields error.id, error.type, exception.message, os.name, dt.rum.application.id, dt.rum.application.entity, start_time
| sort start_time desc
`;

  const result = await executeDql(client, {
    query: dql,
    maxResultRecords: maxExceptionsToDisplay,
    maxResultBytes: 5_000_000,
  });

  if (result && result.records && result.records.length > 0) {
    let resp = `Found ${result.records.length} exceptions! Displaying the top ${maxExceptionsToDisplay} exceptions:\n`;

    result.records.slice(0, maxExceptionsToDisplay).forEach((exception: any) => {
      if (exception) {
        resp += `At start_time ${exception["start_time"]} the exception with error.type ${exception["error.type"]}, error.id ${exception["error.id"]} and os.name ${exception["os.name"]} happened for dt.rum.application.id ${exception["dt.rum.application.id"]} with dt.rum.application.entity ${exception["dt.rum.application.entity"]}.\nThe exception.message is ${exception["exception.message"]}\n\n`;
      }
    });

    resp +=
      `\nNext Steps:` +
      `\n1. Use "execute_dql" to get stack traces: "fetch user.events, from: now()-${timeframe}, to: now() | filter error.id == toUid(\\"<error.id>\\")"` +
      `\n2. Tell the user to visit ${dtEnvironment}/ui/apps/dynatrace.error.inspector/explorer for more details.`;

    return resp;
  }

  return "No exceptions found";
}
