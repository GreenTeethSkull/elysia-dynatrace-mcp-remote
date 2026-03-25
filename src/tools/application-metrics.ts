import { z } from "zod";
import type { DynatraceClient } from "../services/dynatrace-client";
import { executeDql } from "../services/dql-engine";

export const getApplicationMetricsSchema = {
  applicationCode: z
    .string()
    .describe("Application code to filter metrics (e.g., MIEP)"),
  timeframe: z
    .string()
    .optional()
    .default("-24h")
    .describe("Time range for metrics (e.g., -24h, -7d, -30d). Default: -24h"),
};

export const getApplicationMetricsAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
};

export const getApplicationMetricsDescription =
  "Retrieves application performance metrics from Dynatrace GRAIL including availability, latency, MTTR, errors, request volumes, weighted availability, and weighted latency. Use this tool to get a comprehensive view of application health and performance.";

export async function handleGetApplicationMetrics(
  client: DynatraceClient,
  args: { applicationCode: string; timeframe: string },
  grailBudgetGB: number,
): Promise<string> {
  const { applicationCode, timeframe } = args;

//   const dqlStatement = `fetch bizevents, from:${timeframe}
// | filter event.provider == "dt.workflow.clevel.test"
// | filter app.code == "${applicationCode}"
// | fields app.code, metric.time, metric.availability, metric.latency, metric.mttr, metric.errors, metric.request.success, metric.request.failed, metric.weighted.availability, metric.weighted.latency
// | sort metric.time desc`;

  const dqlStatement = `fetch bizevents, from:${timeframe}
| filter event.provider == "dt.workflow.clevel.test"
| filter app.code == "${applicationCode}"
| summarize 
  {
    availability=avg(metric.availability),
    latency_ms = avg(metric.latency),
    mttr_min = avg(metric.mttr),
    errors = sum(metric.errors),
    request.success = sum(metric.request.success),
    request.failed = sum(metric.request.failed),
    weighted.availability = avg(metric.weighted.availability),
    weighted.latency_ms = avg(metric.weighted.latency)
  },
  by:{app.code}`;

  const response = await executeDql(
    client,
    {
      query: dqlStatement,
      maxResultRecords: 100,
      maxResultBytes: 1024 * 1024,
    },
    grailBudgetGB,
  );

  if (!response || response.records.length === 0) {
    return `No metrics found for application code "${applicationCode}" in the specified timeframe (${timeframe}).`;
  }

  let result = `**Application Metrics for: ${applicationCode}**\n`;
  result += `Timeframe: Last ${timeframe.replace("-", "")}\n`;
  result += `Records found: ${response.records.length}\n\n`;

  if (response.scannedRecords !== undefined) {
    result += `- **Scanned Records:** ${response.scannedRecords.toLocaleString()}\n`;
  }

  if (response.budgetWarning) {
    result += `${response.budgetWarning}\n`;
  }

  result += `\n**Metrics Data**:\n\n`;
  result += `\`\`\`json\n${JSON.stringify(response.records, null, 2)}\n\`\`\``;

  return result;
}
