/**
 * Environment configuration for the Dynatrace MCP Server.
 * Reads and validates required environment variables.
 */

export interface DynatraceEnv {
  dtPlatformToken: string;
  dtEnvironment: string;
  grailBudgetGB: number;
}

/**
 * Reads and validates required environment variables for the Dynatrace MCP Server.
 * This server only supports Platform Token authentication (for remote/container usage).
 */
export function getDynatraceEnv(
  env: Record<string, string | undefined> = process.env,
): DynatraceEnv {
  const dtPlatformToken = env.DT_PLATFORM_TOKEN;
  const dtEnvironment = env.DT_ENVIRONMENT;
  let grailBudgetGB = parseFloat(env.DT_GRAIL_QUERY_BUDGET_GB || "1000");

  if (!dtEnvironment) {
    throw new Error(
      "Please set DT_ENVIRONMENT environment variable to your Dynatrace Platform Environment URL (e.g., https://<env-id>.apps.dynatrace.com)",
    );
  }

  if (!dtPlatformToken) {
    throw new Error(
      "Please set DT_PLATFORM_TOKEN environment variable with a valid Dynatrace Platform Token",
    );
  }

  if (!dtEnvironment.startsWith("https://")) {
    throw new Error(
      "DT_ENVIRONMENT must start with https:// (e.g., https://<env-id>.apps.dynatrace.com)",
    );
  }

  if (!/\.apps\.(dynatrace|dynatracelabs)\.com\/?$/.test(dtEnvironment)) {
    throw new Error(
      "DT_ENVIRONMENT must be a valid Dynatrace Platform URL (e.g., https://<env-id>.apps.dynatrace.com)",
    );
  }

  // For dev/labs stages, set unlimited budget (-1) unless explicitly overridden
  if (
    dtEnvironment.includes("apps.dynatracelabs.com") &&
    !env.DT_GRAIL_QUERY_BUDGET_GB
  ) {
    grailBudgetGB = -1;
  }

  if (isNaN(grailBudgetGB) || (grailBudgetGB < 0 && grailBudgetGB !== -1)) {
    throw new Error(
      "DT_GRAIL_QUERY_BUDGET_GB must be a positive number or -1 (for unlimited)",
    );
  }

  return { dtPlatformToken, dtEnvironment, grailBudgetGB };
}
