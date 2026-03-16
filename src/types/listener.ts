import type { PosthookDelivery } from './common.js';

// ---- Wire-format message types (internal use by listener) ----

export interface ForwardRequest {
  body: string;
  signature: string;
  authorization?: string;
  posthookId?: string;
  posthookTimestamp?: string;
  posthookSignature?: string;
}

export interface HookWireMessage {
  type: 'hook';
  id: string;
  path: string;
  data: unknown;
  postAt: string;
  postedAt?: string;
  createdAt: string;
  updatedAt?: string;
  timestamp?: number;
  attempt: number;
  maxAttempts: number;
  ackUrl?: string;
  nackUrl?: string;
  forwardRequest?: ForwardRequest;
}

export interface ConnectedWireMessage {
  type: 'connected';
  connectionId: string;
  projectId: string;
  projectName: string;
  serverTime: string;
}

export interface PingWireMessage {
  type: 'ping';
  timestamp: string;
}

export interface ClosingWireMessage {
  type: 'closing';
  reason: string;
  message: string;
}

export interface ErrorWireMessage {
  type: 'error';
  code: string;
  message: string;
}

export interface AckTimeoutWireMessage {
  type: 'ack_timeout';
  hookId: string;
  attempt: number;
}

export interface AsyncAckWireMessage {
  type: 'async_ack';
  hookId: string;
  ackUrl: string;
  nackUrl: string;
  deadline: string;
}

export type ServerWireMessage =
  | ConnectedWireMessage
  | HookWireMessage
  | PingWireMessage
  | ClosingWireMessage
  | ErrorWireMessage
  | AckTimeoutWireMessage
  | AsyncAckWireMessage;

// ---- Public types ----

/**
 * Information about the established WebSocket connection.
 */
export interface ConnectionInfo {
  /** Unique ID for this connection. */
  connectionId: string;
  /** The project ID this connection is authenticated for. */
  projectId: string;
  /** The project name. */
  projectName: string;
}

/**
 * Handler function for incoming hook deliveries.
 * Return a `Result` to ack, accept, or nack the delivery.
 */
export type ListenHandler = (delivery: PosthookDelivery) => Promise<Result>;

/**
 * Shared WebSocket connection options.
 */
export interface BaseConnectionOptions {
  /**
   * Enable forward mode. When true, the server includes pre-computed
   * HTTP request data (`forwardRequest`) in hook messages.
   */
  forwardMode?: boolean;
  /** Called when the WebSocket connection is established. */
  onConnected?: (info: ConnectionInfo) => void;
  /** Called when the WebSocket connection is lost. */
  onDisconnected?: (error?: Error) => void;
  /** Called before each reconnection attempt. */
  onReconnecting?: (attempt: number) => void;
  /** Called when the server reports an ack timeout for a delivery. */
  onAckTimeout?: (hookId: string, attempt: number) => void;
}

/**
 * Options for `hooks.listen()`.
 */
export interface ListenOptions extends BaseConnectionOptions {
  /**
   * Maximum number of concurrent handler invocations.
   * Defaults to unlimited. Deliveries that arrive while at capacity
   * are nacked immediately so the server can retry them.
   */
  maxConcurrency?: number;
}

/**
 * Options for `hooks.stream()`.
 */
export interface StreamOptions extends BaseConnectionOptions {
  /**
   * Called when a delivery arrives, before it enters the iterator queue.
   * Return `false` to suppress the delivery (it will not be yielded by
   * the iterator). Useful for intercepting retries of the same hook.
   */
  onDelivery?: (delivery: PosthookDelivery) => boolean | void;
}

// Forward-declare Result here as a type re-export; the class itself lives in listener.ts
import type { Result } from '../resources/listener.js';
export type { Result };
