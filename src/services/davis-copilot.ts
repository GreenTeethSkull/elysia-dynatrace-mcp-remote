import { DynatraceClient } from "./dynatrace-client";

export const DAVIS_COPILOT_DOCS = {
  ENABLE_COPILOT:
    "https://docs.dynatrace.com/docs/discover-dynatrace/platform/davis-ai/copilot/copilot-getting-started#enable-davis-copilot",
} as const;

export interface Nl2DqlResponse {
  dql?: string;
  status: string;
  messageToken?: string;
  metadata?: {
    notifications?: Array<{ severity: string; message: string }>;
  };
}

export interface Dql2NlResponse {
  summary?: string;
  explanation?: string;
  status?: string;
  messageToken?: string;
  metadata?: {
    notifications?: Array<{ severity: string; message: string }>;
  };
}

export interface ConversationResponse {
  text?: string;
  status?: string;
  messageToken?: string;
  metadata?: {
    sources?: Array<{ title?: string; url?: string; type?: string }>;
    notifications?: Array<{ severity: string; message: string }>;
  };
  state?: {
    conversationId?: string;
    version?: string;
    skillName?: string;
  };
}

export async function isDavisCopilotSkillAvailable(
  client: DynatraceClient,
  skill: string,
): Promise<boolean> {
  try {
    const response = await client.get<{ skills?: string[] }>(
      "/platform/davis/copilot/v1/skills",
    );
    const availableSkills = response.data.skills || [];
    return availableSkills.includes(skill);
  } catch {
    return false;
  }
}

export async function generateDqlFromNaturalLanguage(
  client: DynatraceClient,
  text: string,
): Promise<Nl2DqlResponse> {
  const response = await client.post<Nl2DqlResponse>(
    "/platform/davis/copilot/v1/skills/nl2dql:generate",
    { text },
  );
  return response.data;
}

export async function explainDqlInNaturalLanguage(
  client: DynatraceClient,
  dql: string,
): Promise<Dql2NlResponse> {
  const response = await client.post<Dql2NlResponse>(
    "/platform/davis/copilot/v1/skills/dql2nl:explain",
    { dql },
  );
  return response.data;
}

export async function chatWithDavisCopilot(
  client: DynatraceClient,
  text: string,
  context?: Array<{ type: string; value: string }>,
  annotations?: Record<string, string>,
  state?: { conversationId?: string },
): Promise<ConversationResponse> {
  const response = await client.post<ConversationResponse>(
    "/platform/davis/copilot/v1/skills/conversations:message",
    { text, context, annotations, state },
  );
  return response.data;
}