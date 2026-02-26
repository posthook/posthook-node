import { VERSION } from './version.js';
import { createError, ConnectionError, PosthookError } from './errors.js';
import type { RequestOptions } from './types/options.js';

export interface HttpClientConfig {
  apiKey: string;
  baseURL: string;
  timeout: number;
  fetch: typeof fetch;
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
  meta?: Record<string, unknown>;
}

/**
 * Internal HTTP client that wraps fetch with auth and error handling.
 */
export class HttpClient {
  private readonly config: HttpClientConfig;

  constructor(config: HttpClientConfig) {
    this.config = config;
  }

  /**
   * Make a GET request and return the unwrapped data.
   */
  async get<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
    options?: RequestOptions,
  ): Promise<T> {
    const url = this.buildURL(path, query);
    const response = await this.request(url, { method: 'GET' }, options);
    return this.unwrap<T>(response);
  }

  /**
   * Make a POST request and return the unwrapped data.
   */
  async post<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const response = await this.request(
      this.buildURL(path),
      {
        method: 'POST',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      options,
    );
    return this.unwrap<T>(response);
  }

  /**
   * Make a POST request and return both unwrapped data and raw response headers.
   * Used for endpoints that return metadata in headers (e.g., quota info).
   */
  async postWithHeaders<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<{ data: T; headers: Headers }> {
    const response = await this.request(
      this.buildURL(path),
      {
        method: 'POST',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      options,
    );
    const data = await this.unwrap<T>(response);
    return { data, headers: response.headers };
  }

  /**
   * Make a DELETE request. Returns void.
   */
  async delete(path: string, options?: RequestOptions): Promise<void> {
    const response = await this.request(
      this.buildURL(path),
      { method: 'DELETE' },
      options,
    );
    // DELETE returns { data: {} }, we just ensure no error
    await this.unwrap(response);
  }

  private buildURL(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): string {
    const url = new URL(path, this.config.baseURL);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async request(
    url: string,
    init: RequestInit,
    options?: RequestOptions,
  ): Promise<Response> {
    const timeout = options?.timeout ?? this.config.timeout;
    const headers: Record<string, string> = {
      'X-API-Key': this.config.apiKey,
      'User-Agent': `posthook-node/${VERSION} (Node.js ${process.version}; ${process.platform})`,
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Combine user signal with timeout
    if (options?.signal) {
      if (options.signal.aborted) {
        clearTimeout(timeoutId);
        throw new ConnectionError('Request aborted');
      }
      options.signal.addEventListener('abort', () => controller.abort(), {
        once: true,
      });
    }

    try {
      const response = await this.config.fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status >= 400) {
        await this.throwApiError(response);
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof PosthookError) {
        throw error;
      }

      if (
        error instanceof Error &&
        error.name === 'AbortError'
      ) {
        throw new ConnectionError(
          options?.signal?.aborted
            ? 'Request aborted'
            : `Request timed out after ${timeout}ms`,
        );
      }

      throw new ConnectionError(
        error instanceof Error ? error.message : 'Network request failed',
      );
    }
  }

  private async unwrap<T>(response: Response): Promise<T> {
    const body = (await response.json()) as ApiResponse<T>;
    return body.data as T;
  }

  private async throwApiError(response: Response): Promise<never> {
    throw await this.buildApiError(response);
  }

  private async buildApiError(response: Response): Promise<PosthookError> {
    let message: string;
    try {
      const body = (await response.json()) as ApiResponse<unknown>;
      message = body.error ?? `HTTP ${response.status}`;
    } catch {
      message = `HTTP ${response.status}`;
    }
    return createError(response.status, message, response.headers);
  }
}
