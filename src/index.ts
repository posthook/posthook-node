import { Posthook } from './client.js';
import { Signatures } from './resources/signatures.js';

export { Posthook };
export default Posthook;

// Version
export { VERSION } from './version.js';

// Standalone resources (for receive-only usage without an API key)
export { Signatures };

// WebSocket listener classes
export { Result, Listener, Stream } from './resources/listener.js';

/**
 * Create a standalone {@link Signatures} instance for verifying webhook
 * deliveries without a full Posthook client (no API key needed).
 *
 * Unlike constructing `Signatures` directly, this factory validates that
 * `signingKey` is present and non-empty at creation time so configuration
 * errors surface immediately rather than on the first `parseDelivery()` call.
 *
 * @param signingKey - Your Posthook signing key (required, non-empty).
 * @returns A configured {@link Signatures} instance.
 * @throws {Error} If `signingKey` is falsy or empty.
 *
 * @example
 * ```ts
 * import { createSignatures } from 'posthook';
 *
 * const signatures = createSignatures(process.env.POSTHOOK_SIGNING_KEY!);
 * const delivery = signatures.parseDelivery(body, headers);
 * ```
 */
export function createSignatures(signingKey: string): Signatures {
  if (!signingKey || signingKey.trim() === '') {
    throw new Error(
      'A non-empty signingKey is required. Pass your Posthook signing key to createSignatures().',
    );
  }
  return new Signatures(signingKey);
}

// Error classes
export {
  PosthookError,
  BadRequestError,
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  RateLimitError,
  InternalServerError,
  ConnectionError,
  SignatureVerificationError,
  CallbackError,
  WebSocketError,
} from './errors.js';

// Types — options
export type { PosthookOptions, RequestOptions } from './types/options.js';

// Types — signatures
export type { HeaderSource, VerifyOptions } from './resources/signatures.js';

// Types — hooks
export type {
  Duration,
  RetryStrategy,
  HookRetryOverride,
  HookScheduleParams,
  HookScheduleWithPostAt,
  HookScheduleWithPostAtLocal,
  HookScheduleWithPostIn,
  Hook,
  QuotaInfo,
  HookListParams,
  HookListAllParams,
  BulkByIDsParams,
  BulkByFilterParams,
  BulkActionParams,
  BulkActionResult,
} from './types/hooks.js';

// Types — common
export type { PosthookDelivery, CallbackResult, WebSocketMeta } from './types/common.js';

// Types — listener
export type {
  ConnectionInfo,
  ListenHandler,
  ListenOptions,
  StreamOptions,
  ForwardRequest,
} from './types/listener.js';
