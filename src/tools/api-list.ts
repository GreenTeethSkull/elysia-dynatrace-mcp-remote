import { z } from "zod";
import type { DynatraceClient } from "../services/dynatrace-client";
import { executeDql, type FilterSegment } from "../services/dql-engine";

export const listApisSummarySchema = {
    segmentId: z
        .string()
        .optional()
        .describe("Optional Dynatrace segment ID to filter query results (e.g., 'tinjgDw6RfO')"),
    appFilter: z
        .string()
        .optional()
        .describe('Optional filter by application name pattern to narrow down APIs (e.g., "payments", "catalogo")'),
};

export const listApisSummaryAnnotations = {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
};

export const listApisSummaryDescription =
    "Lists all APIs with their individual metrics (volume, response time, errors, availability) in a tabular summary. Optionally filtered by Dynatrace segment or application name pattern. Use this when you need an overview of multiple APIs, not details of a single API.";

export async function handleListApisSummary(
    client: DynatraceClient,
    args: {
        segmentId?: string;
        appFilter?: string;
    },
    grailBudgetGB: number,
): Promise<string> {
    const { segmentId, appFilter } = args;
    const filterSegments: FilterSegment[] | undefined = segmentId
        ? [{ id: segmentId, variables: [] }]
        : undefined;

    // Build optional app filter
    const appFilterClause = appFilter
        ? `contains(azuremngm.prod.rh.aplicationid,"${appFilter}",caseSensitive:false) AND `
        : "";

    const summaryQuery = `timeseries {
  Cantidad = sum(
    log.azure.prod.apiid,
    rollup: total,
    scalar:true
    ),
  responsetime = avg(
    log.azure.prod.apiid,
    scalar:true
    ),
  Errores = sum(
    log.azure.prod.apiid,
    rollup: total,
    scalar:true,
    default: 0,
    filter: {
      (startsWith(azuremngm.prod.responsecode,"5") OR
      azuremngm.prod.responsecode == "0")
    }
    ),
  apiid = count(log.azure.prod.apiid, default: 0,
  filter: {
    startsWith(azuremngm.prod.responsecode, "2") or
    startsWith(azuremngm.prod.responsecode, "3") or
    startsWith(azuremngm.prod.responsecode, "4")
  }),
  apiid.0 = count(log.azure.prod.apiid, default: 0)
},
filter:{
  ${appFilterClause}azuremngm.prod.method != "OPTIONS"
},
by: {
    api=azuremngm.prod.apiid
  },
nonempty: true,
union: true
| fieldsAdd apiname = replacePattern(api,"'-V' INT","")
| lookup [
  fetch logs, from:-24h
    | filter dt.system.bucket == "catalogo_apis"
    | sort timestamp desc
    | fieldsAdd apiname = replacePattern(apiid,"'-V' INT","")
    | fields apiname, squad.owner, tribu.owner, descripcion
], sourceField:apiname, lookupField:apiname, fields:{squad = squad.owner, tribu = tribu.owner, descripcion}
| summarize array = collectArray(record(api=api, squad= squad, Cantidad=Cantidad, responsetime=responsetime, Errores=Errores)), cantidadtotal=collectArray(Cantidad), errorestotal=collectArray(Errores)
| fieldsAdd sum = arraySum(cantidadtotal)
| expand array
| fields \`api\` = array[api], \`ResponseTime\` = array[responsetime], \`Cantidad\` = array[Cantidad], \`Errores\` = array[Errores], \`Availability\` = 100 - array[Errores]/array[Cantidad]*100, \`Squad\` = array[squad]`;

    const result = await executeDql(
        client,
        { query: summaryQuery, filterSegments },
        grailBudgetGB,
    );

    if (!result || result.records.length === 0) {
        return "No APIs found matching the criteria.";
    }

    let output = "## API Summary\n\n";

    if (segmentId) {
        output += `**Segment ID:** ${segmentId}\n`;
    }
    if (appFilter) {
        output += `**App Filter:** ${appFilter}\n`;
    }
    output += `**Total APIs:** ${result.records.length}\n\n`;

    // Table header
    output += "| API | Cantidad | Response Time (ms) | Errores | Availability (%) | Squad |\n";
    output += "|-----|----------|-------------------|---------|-----------------|-------|\n";

    for (const record of result.records) {
        if (!record) continue;
        const api = String(record.api || "N/A");
        const cantidad = Number(record.Cantidad || 0).toLocaleString();
        const rt = Number(record.ResponseTime || 0).toFixed(2);
        const errores = Number(record.Errores || 0).toLocaleString();
        const avail = Number(record.Availability || 0).toFixed(2);
        const squad = String(record.Squad || "N/A");

        output += `| ${api} | ${cantidad} | ${rt} | ${errores} | ${avail} | ${squad} |\n`;
    }

    if (result.scannedBytes !== undefined) {
        const scannedGB = result.scannedBytes / (1000 * 1000 * 1000);
        output += `\n*Scanned: ${scannedGB.toFixed(3)} GB*\n`;
    }

    return output;
}