import { z } from "zod";
import type { DynatraceClient } from "../services/dynatrace-client";
import { executeDql } from "../services/dql-engine";

export const workloadDetailsSchema = {
  workload: z.string().describe("The name of the workload to query."),
  timeframe: z
    .string()
    .optional()
    .default("2h")
    .describe('Timeframe to query (e.g., "2h", "24h"). Default: "2h".'),
  limit: z
    .number()
    .optional()
    .default(10)
    .describe("Limit for the number of results per category. Default: 10."),
};

export const workloadDetailsAnnotations = {
  readOnlyHint: true,
};

export const workloadDetailsDescription =
  "Get details for a specific Kubernetes workload, including Logs, Traces, and Exceptions. This tool executes 3 parallel queries to provide a comprehensive view.";

export async function handleWorkloadDetails(
  client: DynatraceClient,
  args: { workload: string; timeframe: string; limit: number },
): Promise<string> {
  const { workload, timeframe, limit } = args;

  const logsQuery = `fetch logs, from: now()-${timeframe}, to: now()
| filter k8s.container.name=="${workload}" and (contains(content,"error",caseSensitive:false) or loglevel=="ERROR")
| sort timestamp desc | limit ${limit} | fields timestamp,content`;

  const tracesQuery = `fetch spans, from: now()-${timeframe}, to: now()
| filter request.is_root_span==true and isNotNull(endpoint.name)
| filter (matchesValue(\`k8s.workload.name\`,"${workload}") or matchesValue(\`dt.kubernetes.workload.name\`,"${workload}")) and request.is_failed==true
| fieldsAdd http.response.status_code=coalesce(http.response.status_code,toLong(http.status_code))
| fields dt.entity.service,duration,endpoint.name,http.response.status_code,start_time,trace.id,url.path,dt.agent.module.id,span.id,dt.system.sampling_ratio
| fieldsAdd dt.entity.service.entity.name=entityAttr(dt.entity.service,"entity.name")
| filter contains(dt.entity.service.entity.name,"Web") | limit ${limit}`;

  const exceptionsQuery = `fetch spans, from: now()-${timeframe}, to: now()
| filter dt.kubernetes.workload.name=="${workload}"
| fieldsAdd exception_message = span.events[0][exception.message], exception_type = span.events[0][exception.type]
| filter isNotNull(exception_message) or isNotNull(exception_type)
| summarize count(),by:{exception_message,exception_type}`;

  const [logsResult, tracesResult, exceptionsResult] = await Promise.all([
    executeDql(client, { query: logsQuery, maxResultRecords: limit }),
    executeDql(client, { query: tracesQuery, maxResultRecords: limit }),
    executeDql(client, { query: exceptionsQuery, maxResultRecords: limit }),
  ]);

  const logs = logsResult?.records || [];
  const traces = tracesResult?.records || [];
  const exceptions = exceptionsResult?.records || [];

  let resp = `Workload Details for "${workload}" (Timeframe: ${timeframe}):\n\n`;

  resp += `LOGS:\n`;
  if (logs.length > 0) {
    logs.forEach((log: any) => {
      resp += `- ${log.timestamp}: ${log.content}\n`;
    });
  } else {
    resp += `No logs found.\n`;
  }
  resp += `\n`;

  resp += `TRACES:\n`;
  if (traces.length > 0) {
    traces.forEach((trace: any) => {
      resp += `- Trace ID: ${trace["trace.id"]}, Duration: ${trace.duration}, Status: ${trace["http.response.status_code"]}, Endpoint: ${trace["endpoint.name"]}\n`;
    });
  } else {
    resp += `No traces found.\n`;
  }
  resp += `\n`;

  resp += `EXCEPTIONS:\n`;
  if (exceptions.length > 0) {
    exceptions.forEach((exception: any) => {
      resp += `- Message: ${exception.exception_message}, Type: ${exception.exception_type}, Count: ${exception.count}\n`;
    });
  } else {
    resp += `No exceptions found.\n`;
  }

  return resp;
}
