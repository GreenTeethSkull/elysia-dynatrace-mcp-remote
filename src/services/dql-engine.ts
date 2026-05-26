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
import { logger } from "./logger";

export interface FilterSegment {
  id: string;
  variables?: Array<Record<string, unknown>>;
}

export interface DqlExecuteRequest {
  query: string;
  maxResultRecords?: number;
  maxResultBytes?: number;
  filterSegments?: FilterSegment[];
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

  if (budgetState?.isBudgetExceeded) {
    logger.warn("budget", `Grail budget exceeded after query`, {
      operation: "execute_dql",
      details: {
        scannedBytes,
        scannedRecords: result.scannedRecords,
        executionTimeMs: result.executionTimeMilliseconds,
        queryId: result.queryId,
        totalScannedGB: (budgetState.totalBytesScanned / 1_000_000_000).toFixed(2),
        budgetLimitGB: budgetState.budgetLimitGB,
      },
    });
  } else if (budgetState && scannedBytes > 0) {
    const usagePct = (
      (budgetState.totalBytesScanned / budgetState.budgetLimitBytes) *
      100
    ).toFixed(1);
    const level: "info" | "warn" = parseFloat(usagePct) >= 80 ? "warn" : "info";
    logger[level]("dql", `${logPrefix}`, {
      operation: "execute_dql",
      details: {
        scannedBytes,
        scannedRecords: result.scannedRecords,
        executionTimeMs: result.executionTimeMilliseconds,
        queryId: result.queryId,
        sampled: result.sampled,
        budgetUsagePct: `${usagePct}%`,
        totalScannedGB: (
          budgetState.totalBytesScanned /
          1_000_000_000
        ).toFixed(2),
        recordCount: result.records?.length || 0,
      },
    });
  } else {
    logger.info("dql", `${logPrefix}`, {
      operation: "execute_dql",
      details: {
        scannedBytes,
        scannedRecords: result.scannedRecords,
        executionTimeMs: result.executionTimeMilliseconds,
        queryId: result.queryId,
        sampled: result.sampled,
        recordCount: result.records?.length || 0,
      },
    });
  }

  return result;
}

/**
 * Verify a DQL statement syntactically.
 */
export async function verifyDqlStatement(
  client: DynatraceClient,
  dqlStatement: string,
): Promise<DqlVerifyResponse> {
  logger.info("dql", "Verifying DQL statement", {
    operation: "verify_dql",
    details: {
      dqlPreview: dqlStatement.slice(0, 200),
    },
  });

  const response = await client.post<DqlVerifyResponse>(
    "/platform/storage/query/v1/query:verify",
    { query: dqlStatement },
  );

  logger.info("dql", "DQL verification completed", {
    operation: "verify_dql",
    details: {
      valid: response.data.valid,
      notificationCount: response.data.notifications?.length || 0,
    },
  });

  return response.data;
}

/**
 * Execute a DQL statement against the Dynatrace GRAIL API.
 * Supports polling for long-running queries and optional filter segments.
 */
export async function executeDql(
  client: DynatraceClient,
  body: DqlExecuteRequest,
  budgetLimitGB?: number,
): Promise<DqlExecutionResult | undefined> {
  const queryStartTime = Date.now();

  // Check budget before executing
  if (budgetLimitGB !== undefined) {
    const tracker = getGrailBudgetTracker(budgetLimitGB);
    const currentState = tracker.getState();

    if (currentState.isBudgetExceeded) {
      logger.warn("budget", "DQL execution aborted: Grail budget exceeded", {
        operation: "execute_dql",
        status: "budget_exceeded",
        details: {
          totalScannedGB: (currentState.totalBytesScanned / 1_000_000_000).toFixed(2),
          budgetLimitGB: currentState.budgetLimitGB,
        },
      });
      const budgetWarning = generateBudgetWarning(currentState, 0);
      throw new Error(
        budgetWarning || "DQL execution aborted: Grail budget has been exceeded",
      );
    }
  }

  // Build request payload
  const payload: Record<string, unknown> = {
    query: body.query,
    maxResultRecords: body.maxResultRecords,
    maxResultBytes: body.maxResultBytes,
  };

  if (body.filterSegments && body.filterSegments.length > 0) {
    payload.filterSegments = body.filterSegments;
  }

  // Execute the query
  const response = await client.post<{
    result?: DqlQueryResult;
    requestToken?: string;
    state?: string;
  }>(
    "/platform/storage/query/v1/query:execute",
    payload,
    { "dt-client-context": userAgent },
  );

  // Immediate result
  if (response.data.result) {
    const result = createResultAndLog(
      response.data.result,
      "DQL query completed (immediate)",
      budgetLimitGB,
    );

    logger.info("dql", "DQL query completed immediately", {
      operation: "execute_dql",
      durationMs: Date.now() - queryStartTime,
      details: {
        recordCount: result.records?.length || 0,
        scannedBytes: result.scannedBytes,
        scannedRecords: result.scannedRecords,
      },
    });

    return result;
  }

  // Poll for result if we have a requestToken
  if (response.data.requestToken) {
    logger.info("dql", "DQL query polling started", {
      operation: "execute_dql",
      details: { requestToken: response.data.requestToken },
    });

    let pollResponse: {
      result?: DqlQueryResult;
      state?: string;
    };
    let pollCount = 0;

    do {
      pollCount++;
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const pollResult = await client.get<typeof pollResponse>(
        `/platform/storage/query/v1/query:poll?request-token=${encodeURIComponent(response.data.requestToken)}`,
        { "dt-client-context": userAgent },
      );

      pollResponse = pollResult.data;

      if (pollResponse.result) {
        const result = createResultAndLog(
          pollResponse.result,
          "DQL query completed (polled)",
          budgetLimitGB,
        );

        logger.info("dql", "DQL query completed after polling", {
          operation: "execute_dql",
          durationMs: Date.now() - queryStartTime,
          details: {
            pollCount,
            recordCount: result.records?.length || 0,
            scannedBytes: result.scannedBytes,
            scannedRecords: result.scannedRecords,
          },
        });

        return result;
      }
    } while (
      pollResponse.state === "RUNNING" ||
      pollResponse.state === "NOT_STARTED"
    );

    logger.warn("dql", `DQL query ended with unexpected state`, {
      operation: "execute_dql",
      durationMs: Date.now() - queryStartTime,
      details: {
        requestToken: response.data.requestToken,
        finalState: pollResponse.state,
        pollCount,
      },
    });

    return undefined;
  }

  logger.warn("dql", "DQL query returned no result and no requestToken", {
    operation: "execute_dql",
    durationMs: Date.now() - queryStartTime,
  });

  return undefined;
}