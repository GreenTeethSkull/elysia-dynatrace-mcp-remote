import { z } from "zod";
import type { DynatraceClient } from "../services/dynatrace-client";
import { executeDql } from "../services/dql-engine";

export const kubernetesEventsSchema = {
  clusterId: z
    .string()
    .optional()
    .describe(
      "The Kubernetes Cluster Id (k8s.cluster.uid). Leave empty if you don't know the Cluster Id.",
    ),
  kubernetesEntityId: z
    .string()
    .optional()
    .describe(
      "The Dynatrace Kubernetes Entity Id (dt.entity.kubernetes_cluster). Leave empty if unknown, or use find_entity_by_name to find it.",
    ),
  eventType: z
    .enum([
      "OMPLIANCE_FINDING",
      "COMPLIANCE_SCAN_COMPLETED",
      "CUSTOM_INFO",
      "DETECTION_FINDING",
      "ERROR_EVENT",
      "OSI_UNEXPECTEDLY_UNAVAILABLE",
      "PROCESS_RESTART",
      "RESOURCE_CONTENTION_EVENT",
      "SERVICE_CLIENT_ERROR_RATE_INCREASED",
      "SERVICE_CLIENT_SLOWDOWN",
      "SERVICE_ERROR_RATE_INCREASED",
      "SERVICE_SLOWDOWN",
      "SERVICE_UNEXPECTED_HIGH_LOAD",
      "SERVICE_UNEXPECTED_LOW_LOAD",
    ])
    .optional(),
  maxEventsToDisplay: z
    .number()
    .default(10)
    .describe("Maximum number of events to display in the response."),
  timeframe: z
    .string()
    .optional()
    .default("24h")
    .describe(
      'Timeframe to query events (e.g., "12h", "24h", "7d", "30d"). Default: "24h".',
    ),
};

export const kubernetesEventsAnnotations = {
  readOnlyHint: true,
};

export const kubernetesEventsDescription =
  "Get all events from a specific Kubernetes (K8s) cluster";

export async function handleKubernetesEvents(
  client: DynatraceClient,
  args: {
    clusterId?: string;
    kubernetesEntityId?: string;
    eventType?: string;
    maxEventsToDisplay: number;
    timeframe: string;
  },
): Promise<string> {
  const {
    clusterId,
    kubernetesEntityId,
    eventType,
    maxEventsToDisplay,
    timeframe,
  } = args;

  let dql = `fetch events, from: now()-${timeframe}, to: now()`;

  if (!clusterId && !kubernetesEntityId) {
    dql += ` | filter isNotNull(k8s.cluster.uid) | limit 50`;
  } else {
    const filters: string[] = [];
    if (clusterId) filters.push(`k8s.cluster.uid == "${clusterId}"`);
    if (kubernetesEntityId)
      filters.push(
        `dt.entity.kubernetes_cluster == "${kubernetesEntityId}"`,
      );
    dql += ` | filter ${filters.join(" or ")} | limit 50`;
  }

  if (eventType) {
    dql += ` | filter eventType == "${eventType}"`;
  }

  dql += " | sort timestamp desc";

  const result = await executeDql(client, { query: dql });

  if (result && result.records && result.records.length > 0) {
    let resp = `Found ${result.records.length} events! Displaying the top ${maxEventsToDisplay} events:\n`;

    result.records.slice(0, maxEventsToDisplay).forEach((event: any) => {
      if (event) {
        resp += `- Event ${event["event.id"]} (${event["event.type"]}) on Kubernetes Entity ID ${event["dt.entity.kubernetes_cluster"]} with status ${event["event.status"]}: ${event["event.name"]} - started at ${event["event.start"]}, ended at ${event["event.end"]}, duration: ${event["duration"]}\n`;
      }
    });

    resp +=
      `\nNext Steps:` +
      `\n1. Consider filtering by \`eventType\` to find specific events.` +
      `\n2. Use "execute_dql" to get more details: "fetch events | filter event.id == \\"<event-id>\\""`;

    return resp;
  }

  return "No events found for the specified Kubernetes cluster. Try leaving clusterId and kubernetesEntityId empty to get events from all clusters.";
}
