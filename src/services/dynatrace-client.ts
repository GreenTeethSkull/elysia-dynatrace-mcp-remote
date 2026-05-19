/**
 * Dynatrace HTTP Client for making authenticated API calls.
 * Uses Platform Token authentication via Bearer token.
 */

import { SERVER_NAME, SERVER_VERSION, REQUEST_TIMEOUT_MS } from "../constants";
import { logger } from "./logger";

export interface DynatraceClientConfig {
  environmentUrl: string;
  platformToken: string;
}

export interface DynatraceApiResponse<T = unknown> {
  data: T;
  status: number;
  headers: Headers;
}

export class DynatraceClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly userAgent: string;

  constructor(config: DynatraceClientConfig) {
    this.baseUrl = config.environmentUrl.replace(/\/$/, "");
    this.token = config.platformToken;
    this.userAgent = `${SERVER_NAME}/v${SERVER_VERSION} (${process.platform}-${process.arch})`;
  }

  /**
   * Make an authenticated HTTP request to the Dynatrace API.
   */
  async request<T = unknown>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      timeout?: number;
    } = {},
  ): Promise<DynatraceApiResponse<T>> {
    const { method = "GET", body, headers = {}, timeout = REQUEST_TIMEOUT_MS } = options;

    const url = `${this.baseUrl}${path}`;
    const startTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": this.userAgent,
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");

        logger.error("http", `Dynatrace API error`, {
          operation: `${method} ${path}`,
          durationMs,
          status: "error",
          details: {
            httpStatus: response.status,
            statusText: response.statusText,
            body: errorBody.slice(0, 500),
          },
        });

        throw new DynatraceApiError(
          `Dynatrace API error: ${response.status} ${response.statusText}`,
          response.status,
          errorBody,
        );
      }

      const data = (await response.json()) as T;

      logger.info("http", `Dynatrace API call completed`, {
        operation: `${method} ${path}`,
        durationMs,
        status: "success",
        details: { httpStatus: response.status },
      });

      return { data, status: response.status, headers: response.headers };
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;

      if (error instanceof DynatraceApiError) {
        throw error;
      }

      const errMsg =
        error instanceof Error ? error.message : String(error);

      logger.error("http", `Dynatrace API call failed`, {
        operation: `${method} ${path}`,
        durationMs,
        status: "error",
        details: { error: errMsg },
      });

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Make a POST request.
   */
  async post<T = unknown>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<DynatraceApiResponse<T>> {
    return this.request<T>(path, { method: "POST", body, headers });
  }

  /**
   * Make a GET request.
   */
  async get<T = unknown>(
    path: string,
    headers?: Record<string, string>,
  ): Promise<DynatraceApiResponse<T>> {
    return this.request<T>(path, { method: "GET", headers });
  }

  /**
   * Test the connection by fetching environment information.
   */
  async testConnection(): Promise<{
    success: boolean;
    info?: unknown;
    error?: string;
  }> {
    try {
      const result = await this.get(
        "/platform/management/v1/environment",
      );
      return { success: true, info: result.data };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  get environmentUrl(): string {
    return this.baseUrl;
  }
}

export class DynatraceApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "DynatraceApiError";
  }
}
