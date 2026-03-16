import type { HttpClient } from '../http.js';
import { NotFoundError } from '../errors.js';
import { Listener, Stream } from './listener.js';
import type { RequestOptions } from '../types/options.js';
import type {
  Hook,
  HookScheduleParams,
  HookListParams,
  HookListAllParams,
  BulkActionParams,
  BulkActionResult,
  QuotaInfo,
} from '../types/hooks.js';
import type { ListenHandler, ListenOptions, StreamOptions } from '../types/listener.js';

/**
 * Sub-resource for bulk hook actions.
 */
class BulkActions {
  private readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  /**
   * Retry failed hooks in bulk.
   *
   * @example
   * ```ts
   * // Retry specific hooks
   * const result = await posthook.hooks.bulk.retry({
   *   hookIDs: ['id-1', 'id-2'],
   * });
   *
   * // Retry by filter
   * const result = await posthook.hooks.bulk.retry({
   *   startTime: '2025-01-01T00:00:00Z',
   *   endTime: '2025-01-02T00:00:00Z',
   *   limit: 100,
   * });
   * ```
   */
  async retry(
    params: BulkActionParams,
    options?: RequestOptions,
  ): Promise<BulkActionResult> {
    return this.http.post<BulkActionResult>(
      '/v1/hooks/bulk/retry',
      toBulkBody(params),
      options,
    );
  }

  /**
   * Replay completed hooks in bulk (creates new hooks with the same data).
   *
   * @example
   * ```ts
   * const result = await posthook.hooks.bulk.replay({
   *   hookIDs: ['id-1', 'id-2'],
   * });
   * ```
   */
  async replay(
    params: BulkActionParams,
    options?: RequestOptions,
  ): Promise<BulkActionResult> {
    return this.http.post<BulkActionResult>(
      '/v1/hooks/bulk/replay',
      toBulkBody(params),
      options,
    );
  }

  /**
   * Cancel pending hooks in bulk.
   *
   * @example
   * ```ts
   * const result = await posthook.hooks.bulk.cancel({
   *   hookIDs: ['id-1', 'id-2'],
   * });
   * ```
   */
  async cancel(
    params: BulkActionParams,
    options?: RequestOptions,
  ): Promise<BulkActionResult> {
    return this.http.post<BulkActionResult>(
      '/v1/hooks/bulk/cancel',
      toBulkBody(params),
      options,
    );
  }
}

function toBulkBody(
  params: BulkActionParams,
): Record<string, unknown> {
  if ('hookIDs' in params && params.hookIDs) {
    return {
      hookIDs: params.hookIDs,
    };
  }
  return {
    startTime: params.startTime,
    endTime: params.endTime,
    endpointKey: params.endpointKey,
    sequenceID: params.sequenceID,
    limit: params.limit,
  };
}

/**
 * Resource for managing hooks.
 */
export class Hooks {
  private readonly http: HttpClient;

  /** Sub-resource for bulk actions on hooks. */
  readonly bulk: BulkActions;

  constructor(http: HttpClient) {
    this.http = http;
    this.bulk = new BulkActions(http);
  }

  /**
   * Schedule a new webhook delivery.
   *
   * @example
   * ```ts
   * // Schedule 5 minutes from now
   * const hook = await posthook.hooks.schedule({
   *   path: '/webhooks/user-created',
   *   postIn: '5m',
   *   data: { userId: '123', event: 'user.created' },
   * });
   *
   * // Schedule at an absolute UTC time
   * const hook = await posthook.hooks.schedule({
   *   path: '/webhooks/reminder',
   *   postAt: '2025-06-15T10:00:00Z',
   *   data: { userId: '123' },
   * });
   *
   * // Schedule at a local time with timezone
   * const hook = await posthook.hooks.schedule({
   *   path: '/webhooks/reminder',
   *   postAtLocal: '2025-06-15T10:00:00',
   *   timezone: 'America/New_York',
   *   data: { userId: '123' },
   * });
   * ```
   *
   * @returns The scheduled hook. Quota info is available via `hook._quota`.
   */
  async schedule<T = Record<string, unknown>>(
    params: HookScheduleParams<T>,
    options?: RequestOptions,
  ): Promise<Hook<T>> {
    const body: Record<string, unknown> = {
      path: params.path,
      data: params.data,
    };

    if (params.retryOverride) {
      body.retryOverride = params.retryOverride;
    }

    if ('postAt' in params && params.postAt) {
      body.postAt = params.postAt;
    } else if ('postAtLocal' in params && params.postAtLocal) {
      body.postAtLocal = params.postAtLocal;
      body.timezone = params.timezone;
    } else if ('postIn' in params && params.postIn) {
      body.postIn = params.postIn;
    }

    const { data, headers } = await this.http.postWithHeaders<Hook<T>>(
      '/v1/hooks',
      body,
      options,
    );

    // Parse quota info from response headers
    const quota = parseQuotaHeaders(headers);
    data._quota = quota;

    return data;
  }

  /**
   * Get a hook by ID.
   *
   * @example
   * ```ts
   * const hook = await posthook.hooks.get('hook-uuid');
   * console.log(hook.status);
   * ```
   */
  async get<T = Record<string, unknown>>(
    id: string,
    options?: RequestOptions,
  ): Promise<Hook<T>> {
    if (!id) {
      throw new Error('hook id is required');
    }
    return this.http.get<Hook<T>>(`/v1/hooks/${encodeURIComponent(id)}`, undefined, options);
  }

  /**
   * List hooks with optional filters and pagination.
   *
   * @example
   * ```ts
   * // List failed hooks
   * const hooks = await posthook.hooks.list({ status: 'failed', limit: 50 });
   *
   * // Cursor-based pagination
   * const nextPage = await posthook.hooks.list({
   *   status: 'failed',
   *   limit: 50,
   *   postAtAfter: hooks[hooks.length - 1].postAt,
   * });
   * ```
   */
  async list<T = Record<string, unknown>>(
    params?: HookListParams,
    options?: RequestOptions,
  ): Promise<Hook<T>[]> {
    const query: Record<string, string | number | undefined> = {};

    if (params) {
      if (params.status) query.status = params.status;
      if (params.limit !== undefined) query.limit = params.limit;
      if (params.offset !== undefined) query.offset = params.offset;
      if (params.postAtBefore) query.postAtBefore = params.postAtBefore;
      if (params.postAtAfter) query.postAtAfter = params.postAtAfter;
      if (params.createdAtBefore)
        query.createdAtBefore = params.createdAtBefore;
      if (params.createdAtAfter)
        query.createdAtAfter = params.createdAtAfter;
      if (params.sortBy) query.sortBy = params.sortBy;
      if (params.sortOrder) query.sortOrder = params.sortOrder;
    }

    return this.http.get<Hook<T>[]>('/v1/hooks', query, options);
  }

  /**
   * Auto-paginating iterator that yields every matching hook across all pages.
   *
   * @example
   * ```ts
   * for await (const hook of posthook.hooks.listAll({ status: 'failed' })) {
   *   console.log(hook.id, hook.failureError);
   * }
   * ```
   */
  async *listAll<T = Record<string, unknown>>(
    params?: HookListAllParams,
    options?: RequestOptions,
  ): AsyncGenerator<Hook<T>, void, undefined> {
    const pageSize = params?.pageSize ?? 100;
    let cursor: string | undefined = params?.postAtAfter;

    while (true) {
      const page = await this.list<T>(
        {
          status: params?.status,
          limit: pageSize,
          sortBy: 'postAt',
          sortOrder: 'ASC',
          postAtAfter: cursor,
        },
        options,
      );

      for (const hook of page) {
        yield hook;
      }

      if (page.length < pageSize) {
        break;
      }
      cursor = page[page.length - 1].postAt;
    }
  }

  /**
   * Delete a hook by ID. To cancel a pending hook, delete it before
   * delivery. Idempotent — returns silently on 404 (already deleted).
   *
   * @example
   * ```ts
   * await posthook.hooks.delete('hook-uuid');
   * ```
   */
  async delete(id: string, options?: RequestOptions): Promise<void> {
    if (!id) {
      throw new Error('hook id is required');
    }
    try {
      return await this.http.delete(`/v1/hooks/${encodeURIComponent(id)}`, options);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return;
      }
      throw error;
    }
  }

  /**
   * Open a persistent WebSocket connection and deliver incoming hooks to
   * `handler`. Returns a {@link Listener} that stays connected (with
   * automatic reconnection) until you call `listener.close()`.
   *
   * @example
   * ```ts
   * const listener = await posthook.hooks.listen(async (delivery) => {
   *   console.log(delivery.hookId, delivery.data);
   *   return Result.ack();
   * });
   *
   * // Block until closed:
   * await listener.wait();
   * ```
   */
  async listen(handler: ListenHandler, options?: ListenOptions): Promise<Listener> {
    const listener = new Listener(this.http, handler, options);
    await listener.start();
    return listener;
  }

  /**
   * Open a persistent WebSocket connection and return an async-iterable
   * {@link Stream} of deliveries. You must explicitly ack, accept, or nack
   * each delivery.
   *
   * @example
   * ```ts
   * const stream = await posthook.hooks.stream();
   * for await (const delivery of stream) {
   *   console.log(delivery.hookId, delivery.data);
   *   stream.ack(delivery.hookId);
   * }
   * ```
   */
  async stream(options?: StreamOptions): Promise<Stream> {
    const stream = new Stream(this.http, options);
    await stream.start();
    return stream;
  }
}

function parseQuotaHeaders(headers: Headers): QuotaInfo | null {
  const limit = headers.get('Posthook-HookQuota-Limit');
  if (!limit) return null;

  return {
    limit: parseInt(limit, 10),
    usage: parseInt(headers.get('Posthook-HookQuota-Usage') ?? '0', 10),
    remaining: parseInt(
      headers.get('Posthook-HookQuota-Remaining') ?? '0',
      10,
    ),
    resetsAt: headers.get('Posthook-HookQuota-Resets-At') ?? '',
  };
}
