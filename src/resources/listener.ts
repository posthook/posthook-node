import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { HttpClient } from '../http.js';
import { AuthenticationError, ForbiddenError, WebSocketError } from '../errors.js';
import type { PosthookDelivery } from '../types/common.js';
import type {
  ConnectionInfo,
  ListenHandler,
  ListenOptions,
  StreamOptions,
  HookWireMessage,
  ServerWireMessage,
  AckTimeoutWireMessage,
} from '../types/listener.js';

// ---- Ticket API response ----

interface TicketData {
  ticket: string;
  url: string;
  expiresAt: string;
}

// ---- Constants ----

/** Server sends pings every 30s; if we see nothing in 45s the connection is stale. */
const HEARTBEAT_TIMEOUT_MS = 45_000;
const MAX_RECONNECT_ATTEMPTS = 10;
/** WebSocket close codes that indicate auth failure (do not reconnect). */
const AUTH_CLOSE_CODES = new Set([4001, 4003]);
/** Pre-serialized pong response (static payload, avoids per-ping allocation). */
const PONG_MSG = JSON.stringify({ type: 'pong' });

// ---- Result class ----

/**
 * Represents the outcome of processing a hook delivery.
 *
 * Use the static factory methods to create instances:
 * - `Result.ack()` -- mark as delivered successfully
 * - `Result.accept(timeout)` -- accept for async processing
 * - `Result.nack(error?)` -- reject and trigger retry
 */
export class Result {
  /** The kind of result: `ack`, `accept`, or `nack`. */
  readonly kind: 'ack' | 'accept' | 'nack';
  /** Timeout in seconds (only for `accept`). */
  readonly timeout?: number;
  /** Error that caused the nack (only for `nack`). */
  readonly error?: Error;

  private constructor(kind: 'ack' | 'accept' | 'nack', timeout?: number, error?: Error) {
    this.kind = kind;
    this.timeout = timeout;
    this.error = error;
  }

  /** Acknowledge the delivery as successfully processed. */
  static ack(): Result {
    return new Result('ack');
  }

  /**
   * Accept the delivery for async processing.
   * @param timeout -- Maximum seconds before the server times the hook out.
   */
  static accept(timeout: number): Result {
    return new Result('accept', timeout);
  }

  /**
   * Reject the delivery, triggering a retry.
   * @param error -- An optional error or message describing the failure.
   */
  static nack(error?: Error | string): Result {
    const err = typeof error === 'string' ? new Error(error) : error;
    return new Result('nack', undefined, err);
  }
}

// ---- Helpers ----

function hookMessageToDelivery(msg: HookWireMessage): PosthookDelivery {
  return {
    hookId: msg.id,
    path: msg.path,
    data: msg.data as Record<string, unknown>,
    postAt: msg.postAt,
    postedAt: msg.postedAt ?? '',
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt ?? '',
    timestamp: msg.timestamp ?? 0,
    ackUrl: msg.ackUrl,
    nackUrl: msg.nackUrl,
    ws: {
      attempt: msg.attempt,
      maxAttempts: msg.maxAttempts,
      forwardRequest: msg.forwardRequest,
    },
  };
}

async function fetchTicket(client: HttpClient): Promise<TicketData> {
  return client.post<TicketData>('/v1/ws/ticket');
}

function reconnectDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 30_000);
}

// ---- BaseConnection class ----

/**
 * Shared WebSocket connection logic: ticket fetch, heartbeat, reconnection.
 * Subclasses provide hook handling and lifecycle callbacks.
 */
abstract class BaseConnection {
  protected readonly client: HttpClient;
  protected readonly forwardMode: boolean;
  protected readonly onAckTimeoutCb?: (hookId: string, attempt: number) => void;

  protected ws: WebSocket | null = null;
  protected closed = false;
  protected reconnectAttempts = 0;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActivity = 0;

  constructor(client: HttpClient, forwardMode?: boolean, onAckTimeout?: (hookId: string, attempt: number) => void) {
    this.client = client;
    this.forwardMode = forwardMode ?? false;
    this.onAckTimeoutCb = onAckTimeout;
  }

  // ---- Subclass hooks ----

  /** Called when a hook message arrives. */
  protected abstract onHook(msg: HookWireMessage): void;

  /** Called when a `connected` message arrives. */
  protected abstract onConnected(info: ConnectionInfo): void;

  /** Called when the WebSocket closes (after heartbeat is stopped and ws is nulled). */
  protected abstract onClose(code: number, reason: Buffer): void;

  /** Called when a reconnect is about to be attempted. */
  protected abstract onReconnecting(attempt: number): void;

  /** Called when max reconnect attempts are exhausted. */
  protected abstract onReconnectExhausted(): void;

  // ---- Connection management ----

  protected async connectOnce(): Promise<void> {
    const ticket = await fetchTicket(this.client);
    const params = new URLSearchParams({ ticket: ticket.ticket });
    if (this.forwardMode) {
      params.set('forward', 'true');
    }
    const url = `${ticket.url}?${params.toString()}`;

    return new Promise<void>((resolve, reject) => {
      if (this.closed) {
        resolve();
        return;
      }

      const ws = new WebSocket(url);
      this.ws = ws;
      let resolved = false;

      ws.on('open', () => {
        this.startHeartbeat();
      });

      ws.on('ping', () => {
        this.resetHeartbeat();
      });

      ws.on('message', (data: WebSocket.RawData) => {
        this.resetHeartbeat();
        let msg: ServerWireMessage;
        try {
          msg = JSON.parse(data.toString()) as ServerWireMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'connected': {
            this.reconnectAttempts = 0;
            const info: ConnectionInfo = {
              connectionId: msg.connectionId,
              projectId: msg.projectId,
              projectName: msg.projectName,
            };
            this.onConnected(info);
            if (!resolved) {
              resolved = true;
              resolve();
            }
            break;
          }
          case 'hook':
            this.onHook(msg);
            break;
          case 'ping':
            ws.send(PONG_MSG);
            break;
          case 'ack_timeout':
            if (this.onAckTimeoutCb) {
              const ackMsg = msg as AckTimeoutWireMessage;
              this.onAckTimeoutCb(ackMsg.hookId, ackMsg.attempt);
            }
            break;
          case 'closing':
          case 'error':
          case 'async_ack':
            break;
        }
      });

      ws.on('close', (code: number, reason: Buffer) => {
        this.stopHeartbeat();
        this.ws = null;

        if (!resolved) {
          resolved = true;
          if (AUTH_CLOSE_CODES.has(code)) {
            reject(new WebSocketError(`Authentication failed (close code ${code})`));
          } else {
            reject(new WebSocketError(`Connection closed before handshake (close code ${code})`));
          }
          // Don't call onClose or scheduleReconnect for pre-connected closes;
          // connectWithRetry handles retry.
          return;
        }

        this.onClose(code, reason);

        if (this.closed) return;

        if (AUTH_CLOSE_CODES.has(code)) {
          this.closed = true;
          this.onReconnectExhausted();
          return;
        }

        this.scheduleReconnect();
      });

      ws.on('error', () => {
        // The 'close' event always follows 'error', so reconnect logic runs there.
      });
    });
  }

  /**
   * Connect with retry loop for pre-connected failures. Auth errors propagate
   * immediately; other failures retry with exponential backoff.
   */
  protected async connectWithRetry(): Promise<void> {
    while (!this.closed) {
      try {
        await this.connectOnce();
        return;
      } catch (err) {
        if (this.closed) return;
        // Auth errors: propagate immediately, do not retry
        if (
          err instanceof AuthenticationError ||
          err instanceof ForbiddenError ||
          (err instanceof WebSocketError && err.message.includes('Authentication'))
        ) {
          throw err;
        }
        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          this.closed = true;
          this.onReconnectExhausted();
          throw new WebSocketError('Connection failed after max reconnect attempts');
        }
        const delay = reconnectDelay(this.reconnectAttempts);
        this.reconnectAttempts++;
        this.onReconnecting(this.reconnectAttempts);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  // ---- Heartbeat ----

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastActivity = Date.now();
    this.heartbeatTimer = setTimeout(() => this.checkHeartbeat(), HEARTBEAT_TIMEOUT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private resetHeartbeat(): void {
    this.lastActivity = Date.now();
    this.startHeartbeat();
  }

  private checkHeartbeat(): void {
    const elapsed = Date.now() - this.lastActivity;
    if (elapsed >= HEARTBEAT_TIMEOUT_MS) {
      // Connection appears stale -- force close to trigger reconnect.
      if (this.ws) {
        this.ws.terminate();
      }
    } else {
      this.heartbeatTimer = setTimeout(
        () => this.checkHeartbeat(),
        HEARTBEAT_TIMEOUT_MS - elapsed,
      );
    }
  }

  // ---- Reconnection ----

  protected scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.closed = true;
      this.onReconnectExhausted();
      return;
    }

    const delay = reconnectDelay(this.reconnectAttempts);
    this.reconnectAttempts++;
    this.onReconnecting(this.reconnectAttempts);

    setTimeout(() => {
      if (this.closed) return;
      this.connectOnce().catch((err) => {
        if (this.closed) return;
        if (
          err instanceof AuthenticationError ||
          err instanceof ForbiddenError ||
          (err instanceof WebSocketError && err.message.includes('Authentication'))
        ) {
          this.closed = true;
          this.onReconnectExhausted();
          return;
        }
        // Pre-connected non-auth failure during reconnect: retry
        this.scheduleReconnect();
      });
    }, delay);
  }

  // ---- Shared close helpers ----

  protected closeWebSocket(): void {
    this.closed = true;
    // stopHeartbeat is accessed via the private field, so we inline the logic:
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000);
      this.ws = null;
    }
  }
}

// ---- Listener class ----

/**
 * A long-lived WebSocket listener that dispatches incoming hook deliveries to
 * a user-provided handler. Thin wrapper over {@link Stream} — every delivery
 * attempt is dispatched independently (no per-hookId dedup or local queuing).
 *
 * When all `maxConcurrency` slots are busy, overflow deliveries are nacked
 * immediately so the server can retry them (possibly on another listener).
 *
 * Create via `posthook.hooks.listen(handler, options)`.
 */
export class Listener extends EventEmitter {
  private readonly stream: Stream;
  private readonly handler: ListenHandler;
  private readonly maxConcurrency: number;

  private inFlight = 0;
  private closed = false;
  private waitResolve: (() => void) | null = null;

  /** @internal */
  constructor(client: HttpClient, handler: ListenHandler, options?: ListenOptions) {
    super();
    this.handler = handler;
    this.maxConcurrency = options?.maxConcurrency ?? Infinity;
    this.stream = new Stream(client, {
      forwardMode: options?.forwardMode,
      onConnected: (info) => {
        this.emit('connected', info);
        options?.onConnected?.(info);
      },
      onDisconnected: (err) => {
        this.emit('disconnected', err);
        options?.onDisconnected?.(err);
      },
      onReconnecting: (attempt) => {
        this.emit('reconnecting', attempt);
        options?.onReconnecting?.(attempt);
      },
      onAckTimeout: options?.onAckTimeout,
    });
  }

  /**
   * Connect to the WebSocket server. Resolves once the first `connected`
   * message is received, then starts consuming deliveries in the background.
   * @internal -- called by `Hooks.listen()`.
   */
  async start(): Promise<void> {
    await this.stream.start();
    this.consumeLoop();
  }

  /**
   * Gracefully close the connection. No further reconnections will occur.
   */
  close(): void {
    this.closed = true;
    this.stream.close();
    if (this.waitResolve) {
      this.waitResolve();
      this.waitResolve = null;
    }
  }

  /**
   * Returns a promise that resolves when the listener is closed
   * (either via `close()` or after exhausting reconnect attempts).
   */
  wait(): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waitResolve = resolve;
    });
  }

  // ---- Internal consume loop ----

  private async consumeLoop(): Promise<void> {
    for await (const delivery of this.stream) {
      if (this.inFlight >= this.maxConcurrency) {
        this.stream.nack(delivery.hookId, 'At capacity');
        continue;
      }

      this.inFlight++;
      this.runHandler(delivery);
    }

    // Stream ended (closed or reconnects exhausted)
    if (this.waitResolve) {
      this.waitResolve();
      this.waitResolve = null;
    }
  }

  private runHandler(delivery: PosthookDelivery): void {
    const run = async () => {
      let result: Result;
      try {
        result = await this.handler(delivery);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        result = Result.nack(errMsg);
      }

      switch (result.kind) {
        case 'ack':
          this.stream.ack(delivery.hookId);
          break;
        case 'accept':
          this.stream.accept(delivery.hookId, result.timeout!);
          break;
        case 'nack':
          this.stream.nack(delivery.hookId, result.error?.message);
          break;
      }

      this.inFlight--;
    };

    run();
  }
}

// ---- Stream class ----

/**
 * An async-iterable stream of hook deliveries. Each iteration yields a
 * `PosthookDelivery` that must be explicitly acked, accepted, or nacked.
 *
 * Create via `posthook.hooks.stream(options)`.
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
export class Stream implements AsyncIterable<PosthookDelivery> {
  private readonly conn: StreamConnection;
  private readonly options: StreamOptions;

  /** Pending deliveries waiting to be consumed by the iterator. */
  private queue: PosthookDelivery[] = [];
  /** Resolve function for the next delivery when the queue is empty. */
  private waiting: ((value: IteratorResult<PosthookDelivery>) => void) | null = null;

  /** @internal */
  constructor(client: HttpClient, options?: StreamOptions) {
    this.options = options ?? {};
    this.conn = new StreamConnection(client, this, options?.forwardMode, options?.onAckTimeout);
  }

  /**
   * Connect to the WebSocket server. Resolves once connected.
   * @internal -- called by `Hooks.stream()`.
   */
  async start(): Promise<void> {
    await this.conn.connect();
  }

  /**
   * Acknowledge a delivery as successfully processed.
   */
  ack(hookId: string): void {
    this.send({ type: 'ack', hookId });
  }

  /**
   * Accept a delivery for async processing.
   * @param hookId -- The hook ID.
   * @param timeout -- Maximum seconds before the server times the hook out.
   */
  accept(hookId: string, timeout: number): void {
    this.send({ type: 'accept', hookId, timeout });
  }

  /**
   * Reject a delivery, triggering a retry.
   * @param hookId -- The hook ID.
   * @param error -- Optional error message.
   */
  nack(hookId: string, error?: string): void {
    const payload: Record<string, unknown> = { type: 'nack', hookId };
    if (error) payload.error = error;
    this.send(payload);
  }

  /**
   * Close the stream. The async iterator will terminate.
   */
  close(): void {
    this.conn.shutdown();
    // Signal the iterator that we're done
    if (this.waiting) {
      this.waiting({ value: undefined as unknown as PosthookDelivery, done: true });
      this.waiting = null;
    }
  }

  // ---- AsyncIterable implementation ----

  [Symbol.asyncIterator](): AsyncIterator<PosthookDelivery> {
    return {
      next: (): Promise<IteratorResult<PosthookDelivery>> => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.conn.isClosed()) {
          return Promise.resolve({ value: undefined as unknown as PosthookDelivery, done: true });
        }
        return new Promise<IteratorResult<PosthookDelivery>>((resolve) => {
          this.waiting = resolve;
        });
      },
      return: (): Promise<IteratorResult<PosthookDelivery>> => {
        this.close();
        return Promise.resolve({ value: undefined as unknown as PosthookDelivery, done: true });
      },
    };
  }

  // ---- Internal callbacks from StreamConnection ----

  /** @internal -- called by StreamConnection */
  _handleConnected(info: ConnectionInfo): void {
    this.options.onConnected?.(info);
  }

  /** @internal -- called by StreamConnection */
  _handleHook(msg: HookWireMessage): void {
    const delivery = hookMessageToDelivery(msg);
    if (this.options.onDelivery) {
      const result = this.options.onDelivery(delivery);
      if (result === false) return;
    }
    this.pushDelivery(delivery);
  }

  /** @internal -- called by StreamConnection */
  _handleClose(_code: number, _reason: Buffer): void {
    this.options.onDisconnected?.(
      new WebSocketError(
        `WebSocket closed: ${_code}${_reason.length ? ' ' + _reason.toString() : ''}`,
      ),
    );
  }

  /** @internal -- called by StreamConnection */
  _handleReconnecting(attempt: number): void {
    this.options.onReconnecting?.(attempt);
  }

  /** @internal -- called by StreamConnection */
  _handleExhausted(): void {
    // Close the stream when reconnects are exhausted or auth fails
    this.close();
  }

  // ---- Private helpers ----

  private pushDelivery(delivery: PosthookDelivery): void {
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: delivery, done: false });
    } else {
      this.queue.push(delivery);
    }
  }

  private send(payload: Record<string, unknown>): void {
    const ws = this.conn.getWebSocket();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }
}

/** @internal -- connection logic for Stream, delegating lifecycle events back to Stream. */
class StreamConnection extends BaseConnection {
  private readonly stream: Stream;

  constructor(client: HttpClient, stream: Stream, forwardMode?: boolean, onAckTimeout?: (hookId: string, attempt: number) => void) {
    super(client, forwardMode, onAckTimeout);
    this.stream = stream;
  }

  async connect(): Promise<void> {
    await this.connectWithRetry();
  }

  shutdown(): void {
    this.closeWebSocket();
  }

  isClosed(): boolean {
    return this.closed;
  }

  getWebSocket(): WebSocket | null {
    return this.ws;
  }

  protected onHook(msg: HookWireMessage): void {
    this.stream._handleHook(msg);
  }

  protected onConnected(info: ConnectionInfo): void {
    this.stream._handleConnected(info);
  }

  protected onClose(code: number, reason: Buffer): void {
    this.stream._handleClose(code, reason);
  }

  protected onReconnecting(attempt: number): void {
    this.stream._handleReconnecting(attempt);
  }

  protected onReconnectExhausted(): void {
    this.stream._handleExhausted();
  }
}
