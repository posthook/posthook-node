import { HttpClient } from './http.js';
import { Hooks } from './resources/hooks.js';
import { Result } from './resources/listener.js';
import { Signatures } from './resources/signatures.js';
import type { PosthookOptions } from './types/options.js';

const DEFAULT_BASE_URL = 'https://api.posthook.io';
const DEFAULT_TIMEOUT = 30_000;

/**
 * The Posthook client. Use this to schedule, manage, and verify webhooks.
 *
 * @example
 * ```ts
 * import Posthook from 'posthook';
 *
 * const posthook = new Posthook('pk_...');
 *
 * const hook = await posthook.hooks.schedule({
 *   path: '/webhooks/user-created',
 *   postIn: '5m',
 *   data: { userId: '123' },
 * });
 * ```
 */
export class Posthook {
  /** Result factories for WebSocket listener handlers. */
  static readonly Result = Result;

  /** Schedule, list, get, delete, and bulk-manage hooks. */
  readonly hooks: Hooks;

  /** Verify webhook signatures and parse deliveries. */
  readonly signatures: Signatures;

  /**
   * Create a new Posthook client.
   *
   * @param apiKey - Your Posthook API key (starts with `pk_`). Falls back to `POSTHOOK_API_KEY` env var.
   * @param options - Client configuration options.
   */
  constructor(
    apiKey?: string,
    options?: PosthookOptions,
  ) {
    const resolvedKey = apiKey ?? process.env.POSTHOOK_API_KEY;
    if (!resolvedKey) {
      throw new Error(
        'Posthook API key is required. Pass it as the first argument or set the POSTHOOK_API_KEY environment variable.',
      );
    }

    const signingKey =
      options?.signingKey ?? process.env.POSTHOOK_SIGNING_KEY;

    const http = new HttpClient({
      apiKey: resolvedKey,
      baseURL: options?.baseURL ?? DEFAULT_BASE_URL,
      timeout: options?.timeout ?? DEFAULT_TIMEOUT,
      fetch: options?.fetch ?? globalThis.fetch,
    });

    this.hooks = new Hooks(http);
    this.signatures = new Signatures(signingKey);
  }
}
