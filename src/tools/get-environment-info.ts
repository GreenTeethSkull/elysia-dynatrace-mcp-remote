import { z } from "zod";
import type { DynatraceClient } from "../services/dynatrace-client";

export const getEnvironmentInfoSchema = {};

export const getEnvironmentInfoAnnotations = {
  readOnlyHint: true,
};

export const getEnvironmentInfoDescription =
  "Get information about the connected Dynatrace Environment (Tenant) and verify the connection and authentication.";

export async function handleGetEnvironmentInfo(
  client: DynatraceClient,
  _args: Record<string, unknown>,
): Promise<string> {
  const result = await client.get(
    "/platform/management/v1/environment",
  );

  let resp = `Environment Information (also referred to as tenant):\n${JSON.stringify(result.data)}\n`;
  resp += `You can reach it via ${client.environmentUrl}\n`;

  return resp;
}
