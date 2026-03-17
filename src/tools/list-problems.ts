import { z } from "zod";
import type { DynatraceClient } from "../services/dynatrace-client";
import { executeDql } from "../services/dql-engine";

export const listProblemsSchema = {
  timeframe: z
    .string()
    .optional()
    .default("24h")
    .describe(
      'Timeframe to query problems (e.g., "12h", "24h", "7d", "30d"). Default: "24h". Supports hours (h) and days (d).',
    ),
  status: z
    .enum(["ACTIVE", "CLOSED", "ALL"])
    .optional()
    .default("ALL")
    .describe(
      'Filter problems by their status. "ACTIVE": only active problems, "CLOSED": only closed problems, "ALL": all problems (default)',
    ),
  additionalFilter: z
    .string()
    .optional()
    .describe(
      "Additional DQL filter for dt.davis.problems - filter by entity type (preferred), like 'dt.entity.<service|host|application|$type> == \"<entity-id>\"', or by entity tags",
    ),
  maxProblemsToDisplay: z
    .number()
    .min(1)
    .max(5000)
    .default(10)
    .describe("Maximum number of problems to display in the response."),
};

export const listProblemsAnnotations = {
  readOnlyHint: true,
};

export const listProblemsDescription =
  'List all problems (based on "fetch dt.davis.problems") known on Dynatrace, sorted by their recency.';

export async function handleListProblems(
  client: DynatraceClient,
  args: {
    timeframe: string;
    status: string;
    additionalFilter?: string;
    maxProblemsToDisplay: number;
  },
  dtEnvironment: string,
): Promise<string> {
  const { timeframe, status, additionalFilter, maxProblemsToDisplay } = args;

  let statusFilter = "";
  if (status === "ACTIVE") statusFilter = "| filter isNull(event.end)";
  else if (status === "CLOSED")
    statusFilter = "| filter not(isNull(event.end))";

  const dql = `fetch dt.davis.problems, from: now()-${timeframe}, to: now()
| filter isNull(dt.davis.is_duplicate) OR not(dt.davis.is_duplicate)
${statusFilter}
${additionalFilter ? `| filter ${additionalFilter}` : ""}
| fieldsAdd
   duration = (coalesce(event.end, now()) - event.start)/1000000000,
   affected_entities_count = arraySize(affected_entity_ids),
   event_count = arraySize(dt.davis.event_ids),
   affected_users_count = dt.davis.affected_users_count,
   problem_id = event.id
| fields display_id, event.name, event.description, event.status, event.category, event.start, event.end,
         root_cause_entity_id, root_cause_entity_name, duration, affected_entities_count,
         event_count, affected_users_count, problem_id, dt.davis.mute.status, dt.davis.mute.user,
         entity_tags, labels.alerting_profile, maintenance.is_under_maintenance,
         aws.account.id, azure.resource.group, azure.subscription, cloud.provider, cloud.region,
         dt.cost.costcenter, dt.cost.product, dt.host_group.id, dt.security_context, gcp.project.id,
         host.name,
         k8s.cluster.name, k8s.cluster.uid, k8s.container.name, k8s.namespace.name, k8s.node.name, k8s.pod.name, k8s.service.name, k8s.workload.kind, k8s.workload.name
| sort event.start desc
`;

  const result = await executeDql(client, {
    query: dql,
    maxResultRecords: 5000,
    maxResultBytes: 5_000_000,
  });

  if (result && result.records && result.records.length > 0) {
    let resp = `Found ${result.records.length} problems! Displaying the top ${maxProblemsToDisplay} problems:\n`;

    result.records.slice(0, maxProblemsToDisplay).forEach((problem) => {
      if (problem) {
        resp += `Problem ${problem["display_id"]} (problemId/event.id: ${problem["problem_id"]})) with event.status ${problem["event.status"]}, event.category ${problem["event.category"]}: ${problem["event.name"]} - affects ${problem["affected_users_count"]} users and ${problem["affected_entities_count"]} entities for a duration of ${problem["duration"]}s\n`;
      }
    });

    resp +=
      `\nNext Steps:` +
      `\n1. Use "execute_dql" tool with the following query to get more details about a specific problem:` +
      `\n"fetch dt.davis.problems, from: now()-${timeframe}, to: now() | filter event.id == \\"<problem-id>\\" | fields event.description, event.status, event.category, event.start, event.end, root_cause_entity_id, root_cause_entity_name, duration, affected_entities_count, event_count, affected_users_count, problem_id, dt.davis.mute.status, entity_tags"` +
      `\n2. Use "chat_with_davis_copilot" tool and provide problemId along with details from step 1 as context.` +
      `\n3. Tell the user to visit ${dtEnvironment}/ui/apps/dynatrace.davis.problems/problem/<problem-id> for more details.`;

    return resp;
  }

  return "No problems found";
}
