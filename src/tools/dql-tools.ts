import { z } from "zod";
import type { DynatraceClient } from "../services/dynatrace-client";
import {
  verifyDqlStatement as verifyDql,
  executeDql,
  type FilterSegment,
} from "../services/dql-engine";

// ── verify_dql ──

export const verifyDqlSchema = {
  dqlStatement: z.string(),
};

export const verifyDqlAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
};

export const verifyDqlDescription =
  'Syntactically verify a Dynatrace Query Language (DQL) statement on Dynatrace GRAIL before executing it. Recommended for generated DQL statements. Skip for statements created by `generate_dql_from_natural_language` tool, as well as from documentation.';

export async function handleVerifyDql(
  client: DynatraceClient,
  args: { dqlStatement: string },
): Promise<string> {
  const response = await verifyDql(client, args.dqlStatement);

  let resp = "DQL Statement Verification:\n";

  if (response.notifications && response.notifications.length > 0) {
    resp += "Please consider the following notifications:\n";
    response.notifications.forEach((notification) => {
      resp += `* ${notification.severity}: ${notification.message}\n`;
    });
  }

  if (response.valid) {
    resp += 'The DQL statement is valid - you can use the "execute_dql" tool.\n';
  } else {
    resp +=
      'The DQL statement is invalid. Please adapt your statement. Consider using "generate_dql_from_natural_language" tool for help.\n';
  }

  return resp;
}

// ── execute_dql ──

export const executeDqlSchema = {
  dqlStatement: z
    .string()
    .describe(
      'DQL Statement (Ex: "fetch [logs, spans, events, metric.series, ...], from: now()-4h, to: now() [| filter <some-filter>] [| summarize count(), by:{some-fields}]", or for metrics: "timeseries { avg(<metric-name>), value.A = avg(<metric-name>, scalar: true) }", or for entities via smartscape: "smartscapeNodes \\"[*, HOST, PROCESS, ...]\\" [| filter id == \\"<ENTITY-ID>\\"]"). When querying data for a specific entity, call the `find_entity_by_name` tool first to get an appropriate filter.',
    ),
  recordLimit: z
    .number()
    .optional()
    .default(100)
    .describe("Maximum number of records to return (default: 100)"),
  recordSizeLimitMB: z
    .number()
    .optional()
    .default(1)
    .describe("Maximum size of the returned records in MB (default: 1MB)"),
  segmentId: z
    .string()
    .optional()
    .describe("Optional Dynatrace segment ID to filter query results (e.g., 'tinjgDw6RfO')"),
};

export const executeDqlAnnotations = {
  readOnlyHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export const executeDqlDescription =
  'Get data like Logs, Metrics, Spans, Events, or Entity Data from Dynatrace GRAIL by executing a Dynatrace Query Language (DQL) statement. Use the "generate_dql_from_natural_language" tool upfront to generate or refine a DQL statement based on your request. To learn about possible fields available for filtering, use the query "fetch dt.semantic_dictionary.models | filter data_object == \\"logs\\""';

export async function handleExecuteDql(
  client: DynatraceClient,
  args: {
    dqlStatement: string;
    recordLimit: number;
    recordSizeLimitMB: number;
    segmentId?: string;
  },
  grailBudgetGB: number,
): Promise<string> {
  const { dqlStatement, recordLimit = 100, recordSizeLimitMB = 1, segmentId } = args;

  const requestPayload: {
    query: string;
    maxResultRecords: number;
    maxResultBytes: number;
    filterSegments?: FilterSegment[];
  } = {
    query: dqlStatement,
    maxResultRecords: recordLimit,
    maxResultBytes: recordSizeLimitMB * 1024 * 1024,
  };

  if (segmentId) {
    requestPayload.filterSegments = [{ id: segmentId, variables: [] }];
  }

  const response = await executeDql(
    client,
    requestPayload,
    grailBudgetGB,
  );

  if (!response) {
    return "DQL execution failed or returned no result.";
  }

  let result = `**DQL Query Results**\n\n`;

  if (response.budgetWarning) {
    result += `${response.budgetWarning}\n\n`;
  }

  if (response.scannedRecords !== undefined) {
    result += `- **Scanned Records:** ${response.scannedRecords.toLocaleString()}\n`;
  }

  if (response.scannedBytes !== undefined) {
    const scannedGB = response.scannedBytes / (1000 * 1000 * 1000);
    result += `- **Scanned Bytes:** ${scannedGB.toFixed(2)} GB`;

    if (response.budgetState) {
      const totalScannedGB = (
        response.budgetState.totalBytesScanned /
        (1000 * 1000 * 1000)
      ).toFixed(2);

      if (response.budgetState.budgetLimitGB > 0) {
        const usagePercentage = (
          (response.budgetState.totalBytesScanned /
            response.budgetState.budgetLimitBytes) *
          100
        ).toFixed(1);
        result += ` (Session total: ${totalScannedGB} GB / ${response.budgetState.budgetLimitGB} GB budget, ${usagePercentage}% used)`;
      } else {
        result += ` (Session total: ${totalScannedGB} GB)`;
      }
    }
    result += "\n";

    if (scannedGB > 500) {
      result += `    **Very High Data Usage Warning:** This query scanned ${scannedGB.toFixed(1)} GB. Please optimize your query.\n`;
    } else if (scannedGB > 50) {
      result += `    **High Data Usage Warning:** This query scanned ${scannedGB.toFixed(2)} GB.\n`;
    } else if (scannedGB > 5) {
      result += `    **Moderate Data Usage:** This query scanned ${scannedGB.toFixed(2)} GB.\n`;
    }
  }

  if (response.sampled) {
    result += `- **Sampling Used:** Yes (results may be approximate)\n`;
  }

  if (response.records.length === recordLimit) {
    result += `- **Record Limit Reached:** Results limited to ${recordLimit} records. Consider a smaller timeframe or more concise filter.\n`;
  }

  result += `\n**Query Results**: (${response.records?.length || 0} records):\n\n`;
  result += `\`\`\`json\n${JSON.stringify(response.records, null, 2)}\n\`\`\``;

  return result;
}