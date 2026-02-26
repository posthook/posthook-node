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
}
