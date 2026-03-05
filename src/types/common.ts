/**
 * Result of an ack or nack callback.
 *
 * Both `ack()` and `nack()` resolve (not throw) for all expected outcomes,
 * including race conditions where the hook already moved on. Check `applied`
 * to see if your callback changed the hook's state.
 */
export interface CallbackResult {
  /**
   * Whether the callback changed the hook's state.
   *
   * `true` — your ack/nack was applied (hook completed, retried, or failed).
   * `false` — the hook was already resolved, deleted, or moved to a new attempt.
   * Either way, no action is needed.
   */
  applied: boolean;
  /**
   * The hook's current status.
   *
   * On success: `"completed"` (ack) or `"nacked"` (nack).
   * On no-op: `"completed"`, `"failed"`, `"not_found"`, or `"conflict"`.
   */
  status: string;
}

/**
 * A parsed and verified webhook delivery.
 * Returned by `posthook.signatures.parseDelivery()`.
 */
export interface PosthookDelivery<T = Record<string, unknown>> {
  /** The hook ID from the `Posthook-Id` header. */
  hookId: string;
  /** The Unix timestamp from the `Posthook-Timestamp` header. */
  timestamp: number;
  /** The delivery path from the parsed body. */
  path: string;
  /** The parsed JSON data payload, typed as `T`. */
  data: T;
  /** Scheduled delivery time (RFC 3339). */
  postAt: string;
  /** Actual delivery time (RFC 3339). */
  postedAt: string;
  /** When the hook was created (RFC 3339). */
  createdAt: string;
  /** When the hook was last updated (RFC 3339). */
  updatedAt: string;

  /**
   * Acknowledge async processing completion.
   * Present when the project has async hooks enabled.
   *
   * Resolves with `{ applied: true }` when the callback was processed, or
   * `{ applied: false }` if the hook was already resolved (e.g., timeout
   * fired first). Both are safe — no action needed either way.
   *
   * Throws `CallbackError` only for unexpected failures (invalid token,
   * expired token, server error).
   *
   * @param body - Optional JSON body to send with the callback. Posthook
   *               currently ignores ack bodies.
   */
  ack?: (body?: unknown) => Promise<CallbackResult>;
  /**
   * Reject async processing (negative acknowledgement). Triggers retry or
   * failure based on your project's retry settings.
   *
   * Resolves with `{ applied: true }` when the nack was processed, or
   * `{ applied: false }` if the hook was already resolved. Both are safe.
   *
   * Throws `CallbackError` only for unexpected failures (invalid token,
   * expired token, server error).
   *
   * @param body - Optional JSON body explaining the failure, captured for
   *               debugging in the dashboard (max 8KB).
   */
  nack?: (body?: unknown) => Promise<CallbackResult>;
  /** Raw ack callback URL. Pass to another process/service if needed. */
  ackUrl?: string;
  /** Raw nack callback URL. Pass to another process/service if needed. */
  nackUrl?: string;
}
