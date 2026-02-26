/**
 * A duration string for relative scheduling.
 *
 * @example
 * ```ts
 * '5m'   // 5 minutes
 * '2h'   // 2 hours
 * '7d'   // 7 days
 * '30s'  // 30 seconds
 * ```
 */
export type Duration =
  | `${number}s`
  | `${number}m`
  | `${number}h`
  | `${number}d`;

/**
 * Retry strategy for per-hook retry override.
 */
export type RetryStrategy = 'fixed' | 'exponential';

/**
 * Per-hook retry configuration that overrides project defaults.
 */
export interface HookRetryOverride {
  /** Number of retries (1-15). */
  minRetries: number;
  /** Base delay between retries in seconds (5-60). */
  delaySecs: number;
  /** Retry strategy: 'fixed' or 'exponential'. */
  strategy: RetryStrategy;
  /** Backoff multiplier for exponential strategy (1.1-4.0). Defaults to 2.0. */
  backoffFactor?: number;
  /** Maximum delay in seconds for exponential strategy (60-3600). Required for exponential. */
  maxDelaySecs?: number;
  /** Whether to apply 0-25% random jitter to retry delays. */
  jitter?: boolean;
}

/**
 * Common fields for all hook scheduling modes.
 */
interface HookScheduleBase<T = Record<string, unknown>> {
  /**
   * The path to deliver the webhook to.
   * Combined with your project's domain to form the full delivery URL.
   *
   * @example '/webhooks/user-created'
   */
  path: string;

  /**
   * The JSON data payload to deliver.
   *
   * @example { userId: '123', event: 'user.created' }
   */
  data?: T;

  /**
   * Optional per-hook retry configuration.
   * When provided, overrides your project's retry settings for this hook.
   */
  retryOverride?: HookRetryOverride;
}

/**
 * Schedule a hook at an absolute UTC time (RFC 3339 format).
 *
 * @example
 * ```ts
 * await posthook.hooks.schedule({
 *   path: '/webhooks/reminder',
 *   postAt: '2025-01-15T10:00:00Z',
 *   data: { userId: '123' },
 * });
 * ```
 */
export interface HookScheduleWithPostAt<T = Record<string, unknown>>
  extends HookScheduleBase<T> {
  /** Absolute UTC time in RFC 3339 format. */
  postAt: string;
  postAtLocal?: never;
  postIn?: never;
  timezone?: never;
}

/**
 * Schedule a hook at a local time with timezone.
 *
 * @example
 * ```ts
 * await posthook.hooks.schedule({
 *   path: '/webhooks/reminder',
 *   postAtLocal: '2025-01-15T10:00:00',
 *   timezone: 'America/New_York',
 *   data: { userId: '123' },
 * });
 * ```
 */
export interface HookScheduleWithPostAtLocal<T = Record<string, unknown>>
  extends HookScheduleBase<T> {
  postAt?: never;
  /** Local time without offset (e.g. '2025-01-15T10:00:00'). */
  postAtLocal: string;
  postIn?: never;
  /** IANA timezone (e.g. 'America/New_York'). Required with postAtLocal. */
  timezone: string;
}

/**
 * Schedule a hook with a relative delay from now.
 *
 * @example
 * ```ts
 * await posthook.hooks.schedule({
 *   path: '/webhooks/reminder',
 *   postIn: '5m',
 *   data: { userId: '123' },
 * });
 * ```
 */
export interface HookScheduleWithPostIn<T = Record<string, unknown>>
  extends HookScheduleBase<T> {
  postAt?: never;
  postAtLocal?: never;
  /** Relative delay from now (e.g. '5m', '2h', '7d', '30s'). */
  postIn: Duration;
  timezone?: never;
}

/**
 * Parameters for scheduling a hook. Exactly one scheduling mode must be used:
 * - `postAt`: Absolute UTC time (RFC 3339)
 * - `postAtLocal` + `timezone`: Local time with timezone
 * - `postIn`: Relative delay from now
 */
export type HookScheduleParams<T = Record<string, unknown>> =
  | HookScheduleWithPostAt<T>
  | HookScheduleWithPostAtLocal<T>
  | HookScheduleWithPostIn<T>;

/**
 * A hook as returned by the Posthook API.
 */
export interface Hook<T = Record<string, unknown>> {
  /** Unique hook ID (UUID). */
  id: string;
  /** The delivery path. */
  path: string;
  /** The project's domain for this hook. */
  domain?: string;
  /** The JSON data payload. */
  data: T;
  /** Scheduled delivery time (RFC 3339). */
  postAt: string;
  /** Current hook status. */
  status: 'pending' | 'retry' | 'completed' | 'failed';
  /** Duration of the POST request in seconds. */
  postDurationSeconds: number;
  /** Number of delivery attempts. */
  attempts: number;
  /** Error message from the last failed attempt. */
  failureError?: string;
  /** Sequence data if the hook was created by a sequence. */
  sequenceData?: HookSequenceData;
  /** Per-hook retry override configuration. */
  retryOverride?: HookRetryOverride;
  /** When the hook was created (RFC 3339). */
  createdAt: string;
  /** When the hook was last updated (RFC 3339). */
  updatedAt: string;
  /** Quota info from the scheduling response. Only present on hooks returned by `schedule()`. */
  _quota?: QuotaInfo | null;
}

/**
 * Sequence data for hooks created by a sequence.
 */
export interface HookSequenceData {
  sequenceID: string;
  stepName: string;
  sequenceLastRunAt: string;
}

/**
 * Quota information from hook scheduling response headers.
 */
export interface QuotaInfo {
  /** Total hook quota for the billing period. */
  limit: number;
  /** Number of hooks used in the billing period. */
  usage: number;
  /** Remaining hooks in the billing period. */
  remaining: number;
  /** When the quota resets (RFC 3339). */
  resetsAt: string;
}

/**
 * Parameters for listing hooks.
 */
export interface HookListParams {
  /** Filter by hook status. */
  status?: 'pending' | 'retry' | 'completed' | 'failed';
  /** Maximum number of hooks to return (max 1000). */
  limit?: number;
  /** Number of hooks to skip for pagination. */
  offset?: number;
  /** Filter hooks scheduled before this time (RFC 3339). */
  postAtBefore?: string;
  /** Filter hooks scheduled after this time (RFC 3339). Used for cursor-based pagination. */
  postAtAfter?: string;
  /** Filter hooks created before this time (RFC 3339). */
  createdAtBefore?: string;
  /** Filter hooks created after this time (RFC 3339). */
  createdAtAfter?: string;
  /** Sort field. */
  sortBy?: 'postAt' | 'createdAt';
  /** Sort direction. */
  sortOrder?: 'ASC' | 'DESC';
}

/**
 * Parameters for auto-paginating hook listing.
 * Uses cursor-based pagination via `postAt` ordering.
 */
export interface HookListAllParams {
  /** Filter by hook status. */
  status?: 'pending' | 'retry' | 'completed' | 'failed';
  /** Start cursor: only return hooks scheduled after this time (RFC 3339, exclusive). */
  postAtAfter?: string;
  /** Number of hooks to fetch per page (default 100, max 1000). */
  pageSize?: number;
}

/**
 * Bulk action by specific hook IDs.
 */
export interface BulkByIDsParams {
  /** Hook IDs to act on (max 1000). */
  hookIDs: string[];
  startTime?: never;
  endTime?: never;
  endpointKey?: never;
  sequenceID?: never;
  limit?: never;
}

/**
 * Bulk action by filter criteria.
 */
export interface BulkByFilterParams {
  hookIDs?: never;
  /** Start of time range (RFC 3339). */
  startTime: string;
  /** End of time range (RFC 3339). */
  endTime: string;
  /** Filter by endpoint key. */
  endpointKey?: string;
  /** Filter by sequence ID. */
  sequenceID?: string;
  /** Maximum number of hooks to act on (1-1000). */
  limit: number;
}

/**
 * Parameters for bulk hook actions (retry, replay, cancel).
 * Either provide specific `hookIDs` or use filter criteria with `startTime`/`endTime`.
 */
export type BulkActionParams = BulkByIDsParams | BulkByFilterParams;

/**
 * Result of a bulk hook action.
 */
export interface BulkActionResult {
  /** Number of hooks affected by the action. */
  affected: number;
}
