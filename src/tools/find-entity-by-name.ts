import { z } from "zod";
import type { DynatraceClient } from "../services/dynatrace-client";
import { executeDql } from "../services/dql-engine";
import {
  DYNATRACE_ENTITY_TYPES_ALL,
  DYNATRACE_ENTITY_TYPES_BASICS,
  getEntityTypeFromId,
} from "../utils/entity-types";

export const findEntityByNameSchema = {
  entityNames: z
    .array(z.string())
    .describe(
      "Names of the entities to search for - try with one name at first (identifiers like package.json id), and only try with multiple names if the first search was unsuccessful",
    ),
  maxEntitiesToDisplay: z
    .number()
    .default(10)
    .describe("Maximum number of entities to display in the response."),
  extendedSearch: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Set this to true if you want a comprehensive search over all available entity types.",
    ),
};

export const findEntityByNameAnnotations = {
  readOnlyHint: true,
};

export const findEntityByNameDescription =
  'Find the entityId and type of a monitored entity (service, host, process-group, application, kubernetes-node, custom-app, ...) within the topology on Dynatrace, based on the name of the entity. Run this before querying data like logs, metrics, problems, events. If no entity name is known, make an educated guess with common identifiers like package.json `id`/`name`, helm chart names, kubernetes manifest names, and alike.';

function generateDqlSearchEntityCommand(
  entityNames: string[],
  extendedSearch: boolean,
): string {
  if (!entityNames || entityNames.length === 0) {
    throw new Error("No entity names supplied to search for");
  }

  const entityTypes = extendedSearch
    ? DYNATRACE_ENTITY_TYPES_ALL
    : DYNATRACE_ENTITY_TYPES_BASICS;

  const fetchDqlCommands = entityTypes.map((entityType, index) => {
    const dql = `fetch ${entityType} | search "*${entityNames.join('*" OR "*')}*" | fieldsAdd entity.type | expand tags`;
    return index === 0 ? dql : `  | append [ ${dql} ]\n`;
  });

  return fetchDqlCommands.join("");
}

export async function handleFindEntityByName(
  client: DynatraceClient,
  args: {
    entityNames: string[];
    maxEntitiesToDisplay: number;
    extendedSearch: boolean;
  },
): Promise<string> {
  const { entityNames, maxEntitiesToDisplay, extendedSearch } = args;

  // Try Smartscape first
  try {
    const smartscapeDql = `smartscapeNodes "*" | search "*${entityNames.join('*" OR "*')}*" | fields id, name, type`;
    const smartscapeResult = await executeDql(client, {
      query: smartscapeDql,
    });

    if (
      smartscapeResult &&
      smartscapeResult.records &&
      smartscapeResult.records.length > 0
    ) {
      const validEntities = smartscapeResult.records.filter(
        (
          entity,
        ): entity is {
          id: string;
          type: string;
          name: string;
          [key: string]: unknown;
        } => !!(entity && entity.id && entity.type && entity.name),
      );

      let resp = `Found ${validEntities.length} monitored entities via Smartscape! Displaying the first ${Math.min(maxEntitiesToDisplay, validEntities.length)} valid entities:\n`;

      validEntities.slice(0, maxEntitiesToDisplay).forEach((entity) => {
        resp += `- Entity '${entity.name}' of entity-type '${entity.type}' has entity id '${entity.id}' and tags ${entity["tags"] ? JSON.stringify(entity["tags"]) : "none"} - DQL Filter: '| filter dt.smartscape.${String(entity.type).toLowerCase()} == "${entity.id}"'\n`;
      });

      resp +=
        "\n\n**Next Steps:**\n" +
        '1. Fetch more details about the entity using `execute_dql` with: "smartscapeNodes \\"<entity-type>\\" | filter id == <entity-id>"\n' +
        "2. Perform a sanity check that found entities are actually the ones you are looking for.\n" +
        '3. Find available metrics with: "fetch metric.series | filter dt.smartscape.<entity-type> == <entity-id> | limit 20"\n' +
        "4. Find problems for this entity using `list_problems` tool with the provided DQL-Filter\n" +
        '5. Explore relationships with: "smartscapeEdges \\"*\\" | filter source_id == <entity-id> or target_id == <entity-id>"\n';

      return resp;
    }
  } catch {
    console.error("Smartscape search failed, falling back to classic entities");
  }

  // Fallback to classic entities API
  const classicDql = generateDqlSearchEntityCommand(entityNames, extendedSearch);
  const result = await executeDql(client, { query: classicDql });

  if (result && result.records && result.records.length > 0) {
    const validEntities = result.records.filter(
      (
        entity,
      ): entity is { id: string; [key: string]: unknown } =>
        !!(entity && entity.id && entity["entity.type"] && entity["entity.name"]),
    );

    let resp = `Found ${validEntities.length} monitored entities! Displaying the first ${Math.min(maxEntitiesToDisplay, validEntities.length)} entities:\n`;

    validEntities.slice(0, maxEntitiesToDisplay).forEach((entity) => {
      const entityType = getEntityTypeFromId(String(entity.id));
      resp += `- Entity '${entity["entity.name"]}' of entity-type '${entity["entity.type"]}' has entity id '${entity.id}' and tags ${entity["tags"] ? entity["tags"] : "none"} - DQL Filter: '| filter ${entityType} == "${entity.id}"'\n`;
    });

    resp +=
      "\n\n**Next Steps:**\n" +
      '1. Fetch more details using `execute_dql`: "fetch dt.entity.<entity-type> | filter id == <entity-id>"\n' +
      "2. Perform a sanity check that found entities match what you're looking for.\n" +
      '3. Find metrics: "fetch metric.series | filter dt.entity.<entity-type> == <entity-id> | limit 20"\n' +
      "4. Find problems using `list_problems` tool with the provided DQL-Filter\n";

    return resp;
  }

  return "No monitored entity found with the specified name. Try to broaden your search term or check for typos.";
}
