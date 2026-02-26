/**
 * Configuration options for the Posthook client.
 */
export interface PosthookOptions {
  /**
   * Base URL for the Posthook API.
   * @default "https://api.posthook.io"
   */
  baseURL?: string;

  /**
   * Request timeout in milliseconds.
   * @default 30000
   */
  timeout?: number;

  /**
   * Custom fetch implementation. Defaults to the global `fetch`.
   */
  fetch?: typeof fetch;

  /**
   * Signing key for verifying webhook signatures.
   * Falls back to the `POSTHOOK_SIGNING_KEY` environment variable.
   */
  signingKey?: string;
}

/**
 * Per-request options that override client defaults.
 */
export interface RequestOptions {
  /**
   * AbortSignal for cancelling the request.
   */
  signal?: AbortSignal;

  /**
   * Request timeout in milliseconds, overrides client default.
   */
  timeout?: number;

  /**
   * Additional headers to include in the request.
   */
  headers?: Record<string, string>;
}
