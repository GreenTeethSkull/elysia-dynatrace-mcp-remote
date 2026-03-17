/**
 * DQL Execution Engine - core query engine for Dynatrace GRAIL.
 * Replaces @dynatrace-sdk/client-query with direct API calls via fetch.
 */

import { DynatraceClient, DynatraceApiError } from "./dynatrace-client";
import {
  getGrailBudgetTracker,
  generateBudgetWarning,
  type GrailBudgetState,
} from "../utils/grail-budget-tracker";
import { SERVER_NAME, SERVER_VERSION } from "../constants";

export interface DqlExecuteRequest {
  query: string;
  maxResultRecords?: number;
  maxResultBytes?: number;
}

export interface DqlVerifyResponse {
  valid: boolean;
  notifications?: Array<{
    severity: string;
    message: string;
  }>;
}

export interface DqlQueryResult {
  records: Array<Record<string, unknown> | null>;
  metadata?: {
    grail?: {
      scannedBytes?: number;
      scannedRecords?: number;
      executionTimeMilliseconds?: number;
      queryId?: string;
      sampled?: boolean;
    };
  };
}

export interface DqlExecutionResult {
  records: Array<Record<string, unknown> | null>;
  metadata?: DqlQueryResult["metadata"];
  scannedBytes?: number;
  scannedRecords?: number;
  executionTimeMilliseconds?: number;
  queryId?: string;
  sampled?: boolean;
  budgetState?: GrailBudgetState;
  budgetWarning?: string;
}

const userAgent = `${SERVER_NAME}/v${SERVER_VERSION} (${process.platform}-${process.arch})`;

function createResultAndLog(
  queryResult: DqlQueryResult,
  logPrefix: string,
  budgetLimitGB?: number,
): DqlExecutionResult {
  const scannedBytes = queryResult.metadata?.grail?.scannedBytes || 0;

  let budgetState: GrailBudgetState | undefined;
  let budgetWarning: string | undefined;

  if (budgetLimitGB !== undefined) {
    const tracker = getGrailBudgetTracker(budgetLimitGB);
    budgetState = tracker.addBytesScanned(scannedBytes);
    budgetWarning =
      generateBudgetWarning(budgetState, scannedBytes) || undefined;
  }

  const result: DqlExecutionResult = {
    records: queryResult.records,
    metadata: queryResult.metadata,
    scannedBytes,
    scannedRecords: queryResult.metadata?.grail?.scannedRecords,
    executionTimeMilliseconds:
      queryResult.metadata?.grail?.executionTimeMilliseconds,
    queryId: queryResult.metadata?.grail?.queryId,
    sampled: queryResult.metadata?.grail?.sampled,
    budgetState,
    budgetWarning,
  };

  console.error(
    `${logPrefix} scannedBytes=${result.scannedBytes} scannedRecords=${result.scannedRecords} executionTime=${result.executionTimeMilliseconds}ms queryId=${result.queryId}`,
  );

  return result;
}

/**
 * Verify a DQL statement syntactically.
 */
export async function verifyDqlStatement(
  client: DynatraceClient,
  dqlStatement: string,
): Promise<DqlVerifyResponse> {
  const response = await client.post<DqlVerifyResponse>(
    "/platform/storage/query/v1/query:verify",
    { query: dqlStatement },
  );
  return response.data;
}

/**
 * Execute a DQL statement against the Dynatrace GRAIL API.
 * Supports polling for long-running queries.
 */
export async function executeDql(
  client: DynatraceClient,
  body: DqlExecuteRequest,
  budgetLimitGB?: number,
): Promise<DqlExecutionResult | undefined> {
  // Check budget before executing
  if (budgetLimitGB !== undefined) {
    const tracker = getGrailBudgetTracker(budgetLimitGB);
    const currentState = tracker.getState();

    if (currentState.isBudgetExceeded) {
      console.error("DQL execution aborted: Grail budget has been exceeded");
      const budgetWarning = generateBudgetWarning(currentState, 0);
      throw new Error(
        budgetWarning || "DQL execution aborted: Grail budget has been exceeded",
      );
    }
  }

  // Execute the query
  const response = await client.post<{
    result?: DqlQueryResult;
    requestToken?: string;
    state?: string;
  }>(
    "/platform/storage/query/v1/query:execute",
    {
      query: body.query,
      maxResultRecords: body.maxResultRecords,
      maxResultBytes: body.maxResultBytes,
    },
    { "dt-client-context": userAgent },
  );

  // Immediate result
  if (response.data.result) {
    return createResultAndLog(
      response.data.result,
      "execute_dql - Metadata:",
      budgetLimitGB,
    );
  }

  // Poll for result if we have a requestToken
  if (response.data.requestToken) {
    let pollResponse: {
      result?: DqlQueryResult;
      state?: string;
    };

    do {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const pollResult = await client.get<typeof pollResponse>(
        `/platform/storage/query/v1/query:poll?request-token=${encodeURIComponent(response.data.requestToken)}`,
        { "dt-client-context": userAgent },
      );

      pollResponse = pollResult.data;

      if (pollResponse.result) {
        return createResultAndLog(
          pollResponse.result,
          "execute_dql Metadata (polled):",
          budgetLimitGB,
        );
      }
    } while (
      pollResponse.state === "RUNNING" ||
      pollResponse.state === "NOT_STARTED"
    );

    console.error(
      `execute_dql with requestToken ${response.data.requestToken} ended with state ${pollResponse.state}`,
    );
    return undefined;
  }

  console.error("execute_dql did not respond with a requestToken");
  return undefined;
}
