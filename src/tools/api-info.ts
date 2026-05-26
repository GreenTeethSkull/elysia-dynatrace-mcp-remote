import { z } from "zod";
import type { DynatraceClient } from "../services/dynatrace-client";
import { executeDql, type FilterSegment } from "../services/dql-engine";

export const getApiInfoSchema = {
    apiName: z
        .string()
        .optional()
        .describe("Optional API name to filter results. If not provided, returns aggregated metrics for all APIs."),
    segmentId: z
        .string()
        .optional()
        .describe("Optional Dynatrace segment ID to filter query results (e.g., 'tinjgDw6RfO')"),
};

export const getApiInfoAnnotations = {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
};

export const getApiInfoDescription =
    "Obtains information about APIs monitored in Dynatrace, including volume, response time, errors, and availability. If a specific API name is provided, it also returns the associated backend microservice, tribe, and squad. Results can be filtered by Dynatrace segments.";

export async function handleGetApiInfo(
    client: DynatraceClient,
    args: {
        apiName?: string;
        segmentId?: string;
    },
    grailBudgetGB: number,
): Promise<string> {
    const { apiName, segmentId } = args;
    const filterSegments: FilterSegment[] | undefined = segmentId ? [{ id: segmentId, variables: [] }] : undefined;

    const apiFilter = apiName
        ? `contains(azuremngm.prod.apiid,"${apiName}",caseSensitive:false)`
        : null;

    const baseFilter = apiFilter
        ? `${apiFilter} AND azuremngm.prod.method != "OPTIONS"`
        : `azuremngm.prod.method != "OPTIONS"`;

    // Query 1: Volume
    const volumeQuery = `timeseries volumen = sum(
  log.azure.prod.apiid,
  rollup: total,
  scalar: true,
  filter: {
    ${baseFilter}
  }
)`;

    // Query 2: Response Time
    const responseTimeQuery = `timeseries {
  responsetime = avg(
    log.azure.prod.apiid,
    scalar:true,
    filter: {
      ${baseFilter}
    }
  )
},
nonempty: true,
union: true`;

    // Query 3: Errors
    const errorsQuery = apiName
        ? `timeseries volumen = sum(
  log.azure.prod.apiid,
  rollup: total,
  scalar: true,
  filter: {
    ${apiFilter} AND
    (startsWith(azuremngm.prod.responsecode,"5") OR
      azuremngm.prod.responsecode == "0") AND
    azuremngm.prod.method != "OPTIONS"
  }
)`
        : `timeseries volumen = sum(
  log.azure.prod.apiid,
  rollup: total,
  scalar: true,
  filter: {
    azuremngm.prod.method != "OPTIONS" AND
    (startsWith(azuremngm.prod.responsecode,"5") OR
      azuremngm.prod.responsecode == "0")
  }
)`;

    // Execute base queries
    const results: string[] = [];
    results.push("## API Information\n");

    if (apiName) {
        results.push(`**API Name:** ${apiName}\n`);
    } else {
        results.push("**Scope:** All APIs (aggregated)\n");
    }

    if (segmentId) {
        results.push(`**Segment ID:** ${segmentId}\n`);
    }

    // Execute Volume query
    const volumeResult = await executeDql(
        client,
        { query: volumeQuery, filterSegments },
        grailBudgetGB,
    );

    let volumeValue = 0;
    if (volumeResult && volumeResult.records.length > 0) {
        const record = volumeResult.records[0] as Record<string, unknown> | null;
        if (record && "volumen" in record) {
            volumeValue = Number(record.volumen) || 0;
        }
    }

    // Execute Response Time query
    const rtResult = await executeDql(
        client,
        { query: responseTimeQuery, filterSegments },
        grailBudgetGB,
    );

    let responseTimeValue = 0;
    if (rtResult && rtResult.records.length > 0) {
        const record = rtResult.records[0] as Record<string, unknown> | null;
        if (record && "responsetime" in record) {
            responseTimeValue = Number(record.responsetime) || 0;
        }
    }

    // Execute Errors query
    const errorsResult = await executeDql(
        client,
        { query: errorsQuery, filterSegments },
        grailBudgetGB,
    );

    let errorsValue = 0;
    if (errorsResult && errorsResult.records.length > 0) {
        const record = errorsResult.records[0] as Record<string, unknown> | null;
        if (record && "volumen" in record) {
            errorsValue = Number(record.volumen) || 0;
        }
    }

    // Calculate Availability
    const availability = volumeValue > 0
        ? ((volumeValue - errorsValue) / volumeValue) * 100
        : 0;

    results.push("### Metrics\n");
    results.push(`- **Volume:** ${volumeValue.toLocaleString()} requests`);
    if (volumeResult?.scannedBytes !== undefined) {
        const scannedGB = volumeResult.scannedBytes / (1000 * 1000 * 1000);
        results.push(` (scanned: ${scannedGB.toFixed(3)} GB)`);
    }
    results.push("\n");

    results.push(`- **Response Time:** ${responseTimeValue.toFixed(2)} ms`);
    if (rtResult?.scannedBytes !== undefined) {
        const scannedGB = rtResult.scannedBytes / (1000 * 1000 * 1000);
        results.push(` (scanned: ${scannedGB.toFixed(3)} GB)`);
    }
    results.push("\n");

    results.push(`- **Errors:** ${errorsValue.toLocaleString()} requests`);
    if (errorsResult?.scannedBytes !== undefined) {
        const scannedGB = errorsResult.scannedBytes / (1000 * 1000 * 1000);
        results.push(` (scanned: ${scannedGB.toFixed(3)} GB)`);
    }
    results.push("\n");

    results.push(`- **Availability:** ${availability.toFixed(2)}%`);
    results.push("\n");

    // Only execute backend and tribe/squad queries if apiName is provided
    if (apiName) {
        results.push("\n### Backend & Ownership\n");

        // Query 4: Backend (microservice)
        const backendQuery = `timeseries Cantidad = sum(
  log.azure.prod.apiid,
  rollup: total,
  scalar: true
),
filter: {
  contains(azuremngm.prod.apiid,"${apiName}",caseSensitive:false) AND
  \`azuremngm.prod.backendurl\` ~ "https://aks*"
},
by: {
  azuremngm.prod.apiid,
  azuremngm.prod.backendurl
}
| parse \`azuremngm.prod.backendurl\`, """'https://' LD:host '/' (DATA '/v' INT):ingresspath '/' LD:endpoint"""
| filter isNotNull(host) and isNotNull(ingresspath)
| fieldsAdd
    api_id = \`azuremngm.prod.apiid\`,
    join_key = concat(host, "/", ingresspath)
| dedup api_id
| lookup [
    smartscapeNodes K8S_INGRESS
    | parse k8s.object, "JSON:k8s.object"
    | expand rules = k8s.object[spec][rules]
    | fieldsAdd
        cluster = k8s.cluster.name,
        host_mapped = if(isNotNull(rules[host]), then: rules[host],
            else: if(cluster == "AKS-Canal-Prod", then: "aks0100.ppsprod.com.pe",
                else: "aks0200.ppsprod.com.pe"))
    | expand paths = rules[http][paths]
    | fieldsFlatten paths, fields: { path, backend }
    | fieldsAdd
        service = backend[service][name],
        join_key_ingress = concat(host_mapped, path)
    | fieldsKeep service, join_key_ingress, cluster, host_mapped
  ], sourceField: join_key, lookupField: join_key_ingress, fields: { service, cluster, host_mapped }
| filter isNotNull(service)
| summarize ms = collectArray(service)
| fieldsAdd c = if(arraySize(ms)>1,"all",else : arrayFirst(ms))
| fieldsAdd Workload = c
| fields Workload`;

        const backendResult = await executeDql(
            client,
            { query: backendQuery, filterSegments },
            grailBudgetGB,
        );

        let workloads: string[] = [];
        if (backendResult && backendResult.records.length > 0) {
            workloads = backendResult.records
                .filter((r): r is Record<string, unknown> => r !== null)
                .map((r) => String(r.Workload || ""))
                .filter((w) => w.length > 0);
        }

        results.push(`- **Backend Workload(s):** ${workloads.length > 0 ? workloads.join(", ") : "N/A"}\n`);

        // Query 5: Tribe and Squad
        const tribeSquadQuery = `fetch logs, from:-24h
| filter dt.system.bucket == "catalogo_apis"
| sort timestamp desc
| fieldsAdd apiname = replacePattern(apiid,"'-V' INT","")
| filter contains(content,"${apiName}",caseSensitive:false)
| fields apiname, squad.owner, tribu.owner`;

        const tribeSquadResult = await executeDql(
            client,
            { query: tribeSquadQuery, filterSegments },
            grailBudgetGB,
        );

        let squad = "N/A";
        let tribu = "N/A";

        if (tribeSquadResult && tribeSquadResult.records.length > 0) {
            const firstRecord = tribeSquadResult.records[0] as Record<string, unknown> | null;
            if (firstRecord) {
                squad = String(firstRecord["squad.owner"] || "N/A");
                tribu = String(firstRecord["tribu.owner"] || "N/A");
            }
        }

        results.push(`- **Squad:** ${squad}\n`);
        results.push(`- **Tribu:** ${tribu}\n`);
    }

    return results.join("");
}