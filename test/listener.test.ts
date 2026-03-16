import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { HttpClient } from '../src/http.js';
import { Result, Listener, Stream } from '../src/resources/listener.js';
import { WebSocketError } from '../src/errors.js';
import type { PosthookDelivery } from '../src/types/common.js';

// ---- Test helpers ----

/** Tiny HTTP + WebSocket server for integration-style tests. */
interface TestServer {
  httpServer: Server;
  wss: WebSocketServer;
  port: number;
  url: string;
  /** All WebSocket clients that connected to the server. */
  clients: WebSocket[];
  close: () => Promise<void>;
}

function hookMessage(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    type: 'hook',
    id: 'hook-001',
    path: '/webhooks/test',
    data: { event: 'test' },
    postAt: '2025-01-15T10:00:00Z',
    createdAt: '2025-01-15T09:55:00Z',
    attempt: 1,
    maxAttempts: 3,
    ...overrides,
  });
}

function connectedMessage(overrides?: Record<string, unknown>) {
  return JSON.stringify({
    type: 'connected',
    connectionId: 'conn-001',
    projectId: 'proj-001',
    projectName: 'Test Project',
    serverTime: '2025-01-15T10:00:00Z',
    ...overrides,
  });
}

async function createTestServer(options?: {
  ticketStatus?: number;
  ticketBody?: unknown;
  onWsConnection?: (ws: WebSocket) => void;
}): Promise<TestServer> {
  return new Promise((resolve) => {
    const httpServer = createServer(
      (req: IncomingMessage, res: ServerResponse) => {
        if (req.url === '/v1/ws/ticket' && req.method === 'POST') {
          const status = options?.ticketStatus ?? 200;
          const body = options?.ticketBody ?? {
            data: {
              ticket: 'test-ticket',
              url: '', // Will be set after server starts
              expiresAt: '2025-01-15T11:00:00Z',
            },
          };
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
          return;
        }
        res.writeHead(404);
        res.end();
      },
    );

    const wss = new WebSocketServer({ server: httpServer });
    const clients: WebSocket[] = [];

    wss.on('connection', (ws: WebSocket) => {
      clients.push(ws);
      if (options?.onWsConnection) {
        options.onWsConnection(ws);
      }
    });

    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      if (!addr || typeof addr === 'string') throw new Error('unexpected address');
      const port = addr.port;
      const url = `http://127.0.0.1:${port}`;

      // Patch the ticket handler to return the correct WebSocket URL
      httpServer.removeAllListeners('request');
      httpServer.on('request', (req: IncomingMessage, res: ServerResponse) => {
        if (req.url === '/v1/ws/ticket' && req.method === 'POST') {
          const status = options?.ticketStatus ?? 200;
          const body = options?.ticketBody ?? {
            data: {
              ticket: 'test-ticket',
              url: `ws://127.0.0.1:${port}`,
              expiresAt: '2025-01-15T11:00:00Z',
            },
          };
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
          return;
        }
        res.writeHead(404);
        res.end();
      });

      resolve({
        httpServer,
        wss,
        port,
        url,
        clients,
        close: () =>
          new Promise<void>((resolveClose) => {
            for (const c of clients) c.terminate();
            wss.close(() => {
              httpServer.close(() => resolveClose());
            });
          }),
      });
    });
  });
}

function createHttpClient(baseURL: string): HttpClient {
  return new HttpClient({
    apiKey: 'pk_test_123',
    baseURL,
    timeout: 5000,
    fetch: globalThis.fetch,
  });
}

/** Wait for a specific number of messages from a WebSocket client. */
function collectMessages(
  ws: WebSocket,
  count: number,
  timeoutMs = 2000,
): Promise<Record<string, unknown>[]> {
  const messages: Record<string, unknown>[] = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for ${count} messages (got ${messages.length})`,
        ),
      );
    }, timeoutMs);

    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
      if (messages.length >= count) {
        clearTimeout(timer);
        resolve(messages);
      }
    });
  });
}

// ---- Tests ----

describe('Result', () => {
  it('creates ack result', () => {
    const r = Result.ack();
    expect(r.kind).toBe('ack');
    expect(r.timeout).toBeUndefined();
    expect(r.error).toBeUndefined();
  });

  it('creates accept result with timeout', () => {
    const r = Result.accept(60);
    expect(r.kind).toBe('accept');
    expect(r.timeout).toBe(60);
    expect(r.error).toBeUndefined();
  });

  it('creates nack result with Error', () => {
    const err = new Error('something failed');
    const r = Result.nack(err);
    expect(r.kind).toBe('nack');
    expect(r.error).toBe(err);
    expect(r.timeout).toBeUndefined();
  });

  it('creates nack result with string', () => {
    const r = Result.nack('bad input');
    expect(r.kind).toBe('nack');
    expect(r.error?.message).toBe('bad input');
  });

  it('creates nack result with no error', () => {
    const r = Result.nack();
    expect(r.kind).toBe('nack');
    expect(r.error).toBeUndefined();
  });
});

describe('Listener', () => {
  let server: TestServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('fetches ticket and connects via WebSocket', async () => {
    const connectedInfo = vi.fn();

    server = await createTestServer({
      onWsConnection: (ws) => {
        ws.send(connectedMessage());
      },
    });

    const client = createHttpClient(server.url);
    const handler = vi.fn().mockResolvedValue(Result.ack());
    const listener = new Listener(client, handler, {
      onConnected: connectedInfo,
    });

    await listener.start();

    expect(connectedInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-001',
        projectId: 'proj-001',
        projectName: 'Test Project',
      }),
    );

    listener.close();
  });

  it('dispatches hook delivery to handler and sends ack', async () => {
    const handler = vi.fn().mockResolvedValue(Result.ack());
    let serverWs: WebSocket | null = null;

    server = await createTestServer({
      onWsConnection: (ws) => {
        serverWs = ws;
        ws.send(connectedMessage());
      },
    });

    const client = createHttpClient(server.url);
    const listener = new Listener(client, handler);
    await listener.start();

    // Collect the ack message from the client
    const messagesPromise = collectMessages(serverWs!, 1);

    // Send a hook
    serverWs!.send(hookMessage());

    const messages = await messagesPromise;
    expect(messages[0]).toEqual({ type: 'ack', hookId: 'hook-001' });

    // Verify handler was called with correct delivery
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        hookId: 'hook-001',
        path: '/webhooks/test',
        data: { event: 'test' },
        ws: expect.objectContaining({
          attempt: 1,
          maxAttempts: 3,
        }),
      }),
    );

    listener.close();
  });

  it('sends accept message with timeout', async () => {
    const handler = vi.fn().mockResolvedValue(Result.accept(120));
    let serverWs: WebSocket | null = null;

    server = await createTestServer({
      onWsConnection: (ws) => {
        serverWs = ws;
        ws.send(connectedMessage());
      },
    });

    const client = createHttpClient(server.url);
    const listener = new Listener(client, handler);
    await listener.start();

    const messagesPromise = collectMessages(serverWs!, 1);
    serverWs!.send(hookMessage());

    const messages = await messagesPromise;
    expect(messages[0]).toEqual({
      type: 'accept',
      hookId: 'hook-001',
      timeout: 120,
    });

    listener.close();
  });

  it('sends nack on handler error', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('processing failed'));
    let serverWs: WebSocket | null = null;

    server = await createTestServer({
      onWsConnection: (ws) => {
        serverWs = ws;
        ws.send(connectedMessage());
      },
    });

    const client = createHttpClient(server.url);
    const listener = new Listener(client, handler);
    await listener.start();

    const messagesPromise = collectMessages(serverWs!, 1);
    serverWs!.send(hookMessage());

    const messages = await messagesPromise;
    expect(messages[0]).toEqual({
      type: 'nack',
      hookId: 'hook-001',
      error: 'processing failed',
    });

    listener.close();
  });

  it('sends nack when handler returns nack result', async () => {
    const handler = vi.fn().mockResolvedValue(Result.nack('rejected'));
    let serverWs: WebSocket | null = null;

    server = await createTestServer({
      onWsConnection: (ws) => {
        serverWs = ws;
        ws.send(connectedMessage());
      },
    });

    const client = createHttpClient(server.url);
    const listener = new Listener(client, handler);
    await listener.start();

    const messagesPromise = collectMessages(serverWs!, 1);
    serverWs!.send(hookMessage());

    const messages = await messagesPromise;
    expect(messages[0]).toEqual({
      type: 'nack',
      hookId: 'hook-001',
      error: 'rejected',
    });

    listener.close();
  });

  it('reconnects on disconnect', async () => {
    const onDisconnected = vi.fn();
    const onReconnecting = vi.fn();
    let connectionCount = 0;

    server = await createTestServer({
      onWsConnection: (ws) => {
        connectionCount++;
        ws.send(connectedMessage());
        if (connectionCount === 1) {
          // Close the first connection to trigger reconnect
          setTimeout(() => ws.close(1001, 'going away'), 50);
        }
      },
    });

    const client = createHttpClient(server.url);
    const handler = vi.fn().mockResolvedValue(Result.ack());
    const listener = new Listener(client, handler, {
      onDisconnected,
      onReconnecting,
    });

    await listener.start();

    // Wait for the reconnect to complete
    await new Promise<void>((resolve) => {
      const check = () => {
        if (connectionCount >= 2) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      setTimeout(check, 200);
    });

    expect(connectionCount).toBeGreaterThanOrEqual(2);
    expect(onDisconnected).toHaveBeenCalled();
    expect(onReconnecting).toHaveBeenCalledWith(1);

    listener.close();
  });

  it('does not reconnect on auth error close code', async () => {
    const onReconnecting = vi.fn();

    server = await createTestServer({
      onWsConnection: (ws) => {
        ws.send(connectedMessage());
        setTimeout(() => ws.close(4001, 'unauthorized'), 50);
      },
    });

    const client = createHttpClient(server.url);
    const handler = vi.fn().mockResolvedValue(Result.ack());
    const listener = new Listener(client, handler, {
      onReconnecting,
    });

    await listener.start();

    // Wait enough time for a reconnect attempt
    await new Promise((r) => setTimeout(r, 300));

    // Should NOT have tried to reconnect
    expect(onReconnecting).not.toHaveBeenCalled();

    listener.close();
  });

  it('close() resolves the wait() promise', async () => {
    server = await createTestServer({
      onWsConnection: (ws) => {
        ws.send(connectedMessage());
      },
    });

    const client = createHttpClient(server.url);
    const handler = vi.fn().mockResolvedValue(Result.ack());
    const listener = new Listener(client, handler);
    await listener.start();

    const waitPromise = listener.wait();
    listener.close();

    // wait() should resolve (not hang)
    await expect(
      Promise.race([
        waitPromise.then(() => 'resolved'),
        new Promise((r) => setTimeout(() => r('timeout'), 1000)),
      ]),
    ).resolves.toBe('resolved');
  });

  it('handles handler exception and converts to nack', async () => {
    const handler = vi.fn().mockImplementation(() => {
      throw new Error('sync throw');
    });
    let serverWs: WebSocket | null = null;

    server = await createTestServer({
      onWsConnection: (ws) => {
        serverWs = ws;
        ws.send(connectedMessage());
      },
    });

    const client = createHttpClient(server.url);
    const listener = new Listener(client, handler);
    await listener.start();

    const messagesPromise = collectMessages(serverWs!, 1);
    serverWs!.send(hookMessage());

    const messages = await messagesPromise;
    expect(messages[0]).toEqual({
      type: 'nack',
      hookId: 'hook-001',
      error: 'sync throw',
    });

    listener.close();
  });

  it('nacks overflow hooks at capacity instead of queuing', async () => {
    const handlerCalls: string[] = [];
    const handler = vi.fn().mockImplementation(async (delivery: PosthookDelivery) => {
      handlerCalls.push(delivery.hookId);
      await new Promise((r) => setTimeout(r, 200));
      return Result.ack();
    });
    let serverWs: WebSocket | null = null;

    server = await createTestServer({
      onWsConnection: (ws) => {
        serverWs = ws;
        ws.send(connectedMessage());
      },
    });

    const client = createHttpClient(server.url);
    const listener = new Listener(client, handler, { maxConcurrency: 1 });
    await listener.start();

    // Collect 2 messages: 1 nack for overflow + 1 ack for the handled hook
    const messagesPromise = collectMessages(serverWs!, 2, 3000);

    // Send hooks A and B quickly — only 1 slot available
    serverWs!.send(hookMessage({ id: 'hook-a' }));
    await new Promise((r) => setTimeout(r, 20));
    serverWs!.send(hookMessage({ id: 'hook-b' }));

    const messages = await messagesPromise;

    // Only hook-a should have been handled
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handlerCalls).toEqual(['hook-a']);
    // hook-b was nacked immediately
    expect(messages).toHaveLength(2);
    const nack = messages.find(m => m.type === 'nack');
    const ack = messages.find(m => m.type === 'ack');
    expect(nack).toEqual(expect.objectContaining({ type: 'nack', hookId: 'hook-b' }));
    expect(ack).toEqual({ type: 'ack', hookId: 'hook-a' });

    listener.close();
  });

  it('retries on pre-connected close and eventually connects', async () => {
    const onConnected = vi.fn();
    const onReconnecting = vi.fn();
    let connectionCount = 0;

    server = await createTestServer({
      onWsConnection: (ws) => {
        connectionCount++;
        if (connectionCount === 1) {
          // First connection: close immediately without sending connected
          ws.close(1001, 'going away');
        } else {
          // Second connection: send connected normally
          ws.send(connectedMessage());
        }
      },
    });

    const client = createHttpClient(server.url);
    const handler = vi.fn().mockResolvedValue(Result.ack());
    const listener = new Listener(client, handler, {
      onConnected,
      onReconnecting,
    });

    // start() should eventually resolve after retrying
    await listener.start();

    expect(onConnected).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-001',
        projectId: 'proj-001',
      }),
    );
    expect(onReconnecting).toHaveBeenCalledWith(1);
    expect(connectionCount).toBe(2);

    listener.close();
  });

  it('rejects immediately on pre-connected auth close', async () => {
    const onReconnecting = vi.fn();

    server = await createTestServer({
      onWsConnection: (ws) => {
        // Close with auth error code without sending connected message
        ws.close(4001, 'unauthorized');
      },
    });

    const client = createHttpClient(server.url);
    const handler = vi.fn().mockResolvedValue(Result.ack());
    const listener = new Listener(client, handler, {
      onReconnecting,
    });

    // start() should reject with WebSocketError containing 'Authentication'
    let caughtError: unknown;
    try {
      await listener.start();
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(WebSocketError);
    expect((caughtError as WebSocketError).message).toMatch(/Authentication/);

    // onReconnecting should NOT have been called
    expect(onReconnecting).not.toHaveBeenCalled();

    listener.close();
  });

  it('handler finishing on dead connection is a silent no-op', async () => {
    // Scenario: connection drops while handler is running. Handler finishes
    // and calls sendResult() — but the WebSocket is closed, so the result
    // is silently dropped. No crash, no unhandled rejection.
    let serverWs: WebSocket | null = null;
    let handlerStartedResolve: (() => void) | null = null;
    const handlerStartedPromise = new Promise<void>((r) => {
      handlerStartedResolve = r;
    });
    let handlerFinishedResolve: (() => void) | null = null;
    const handlerFinished = new Promise<void>((r) => {
      handlerFinishedResolve = r;
    });

    server = await createTestServer({
      onWsConnection: (ws) => {
        serverWs = ws;
        ws.send(connectedMessage());
      },
    });

    const client = createHttpClient(server.url);
    let externalResolve: (() => void) | null = null;
    const handlerGate = new Promise<void>((r) => {
      externalResolve = r;
    });

    const handler = vi.fn().mockImplementation(async () => {
      handlerStartedResolve!();
      // Block until we release the gate
      await handlerGate;
      handlerFinishedResolve!();
      return Result.ack();
    });

    const listener = new Listener(client, handler);
    await listener.start();

    // Send a hook
    serverWs!.send(hookMessage({ id: 'hook-a' }));

    // Wait for handler to start
    await handlerStartedPromise;

    // Kill the WebSocket connection while handler is in-flight
    serverWs!.close(1001, 'going away');

    // Small delay to let the close propagate
    await new Promise((r) => setTimeout(r, 50));

    // Release the handler — it will try to send ack on the dead connection
    externalResolve!();
    await handlerFinished;

    // No crash, no unhandled rejection — handler completed silently
    expect(handler).toHaveBeenCalledTimes(1);

    listener.close();
  });

  it('respects maxConcurrency option', async () => {
    let concurrentCount = 0;
    let maxSeen = 0;

    const handler = vi.fn().mockImplementation(async () => {
      concurrentCount++;
      maxSeen = Math.max(maxSeen, concurrentCount);
      await new Promise((r) => setTimeout(r, 100));
      concurrentCount--;
      return Result.ack();
    });

    let serverWs: WebSocket | null = null;

    server = await createTestServer({
      onWsConnection: (ws) => {
        serverWs = ws;
        ws.send(connectedMessage());
      },
    });

    const client = createHttpClient(server.url);
    const listener = new Listener(client, handler, { maxConcurrency: 2 });
    await listener.start();

    // Send 3 hooks quickly - only 2 should run concurrently
    const messagesPromise = collectMessages(serverWs!, 3, 5000);
    serverWs!.send(hookMessage({ id: 'hook-a' }));
    serverWs!.send(hookMessage({ id: 'hook-b' }));
    serverWs!.send(hookMessage({ id: 'hook-c' }));

    const messages = await messagesPromise;

    // All 3 should get responses (2 acks + 1 nack for concurrency limit, or
    // the third was queued and acked after one finished)
    expect(messages).toHaveLength(3);
    expect(maxSeen).toBeLessThanOrEqual(2);

    listener.close();
  });
});

describe('Stream', () => {
  let server: TestServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('yields deliveries as an async iterator', async () => {
    let serverWs: WebSocket | null = null;

    server = await createTestServer({
      onWsConnection: (ws) => {
        serverWs = ws;
        ws.send(connectedMessage());
      },
    });

    const client = createHttpClient(server.url);
    const stream = new Stream(client);
    await stream.start();

    // Send a hook
    serverWs!.send(hookMessage());

    // Consume one delivery from the iterator
    const iterator = stream[Symbol.asyncIterator]();
    const result = await iterator.next();

    expect(result.done).toBe(false);
    expect(result.value.hookId).toBe('hook-001');
    expect(result.value.data).toEqual({ event: 'test' });
    expect(result.value.ws).toEqual(
      expect.objectContaining({ attempt: 1, maxAttempts: 3 }),
    );

    stream.close();
  });

  it('ack() sends ack message', async () => {
    let serverWs: WebSocket | null = null;

    server = await createTestServer({
      onWsConnection: (ws) => {
        serverWs = ws;
        ws.send(connectedMessage());
      },
    });

    const client = createHttpClient(server.url);
    const stream = new Stream(client);
    await stream.start();

    const messagesPromise = collectMessages(serverWs!, 1);
    serverWs!.send(hookMessage());

    // Consume the delivery
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();

    // Ack it
    stream.ack('hook-001');

    const messages = await messagesPromise;
    expect(messages[0]).toEqual({ type: 'ack', hookId: 'hook-001' });

    stream.close();
  });

  it('nack() sends nack message with error', async () => {
    let serverWs: WebSocket | null = null;

    server = await createTestServer({
      onWsConnection: (ws) => {
        serverWs = ws;
        ws.send(connectedMessage());
      },
    });

    const client = createHttpClient(server.url);
    const stream = new Stream(client);
    await stream.start();

    const messagesPromise = collectMessages(serverWs!, 1);
    serverWs!.send(hookMessage());

    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();

    stream.nack('hook-001', 'bad data');

    const messages = await messagesPromise;
    expect(messages[0]).toEqual({
      type: 'nack',
      hookId: 'hook-001',
      error: 'bad data',
    });

    stream.close();
  });

  it('accept() sends accept message with timeout', async () => {
    let serverWs: WebSocket | null = null;

    server = await createTestServer({
      onWsConnection: (ws) => {
        serverWs = ws;
        ws.send(connectedMessage());
      },
    });

    const client = createHttpClient(server.url);
    const stream = new Stream(client);
    await stream.start();

    const messagesPromise = collectMessages(serverWs!, 1);
    serverWs!.send(hookMessage());

    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();

    stream.accept('hook-001', 300);

    const messages = await messagesPromise;
    expect(messages[0]).toEqual({
      type: 'accept',
      hookId: 'hook-001',
      timeout: 300,
    });

    stream.close();
  });

  it('close() terminates the async iterator', async () => {
    server = await createTestServer({
      onWsConnection: (ws) => {
        ws.send(connectedMessage());
      },
    });

    const client = createHttpClient(server.url);
    const stream = new Stream(client);
    await stream.start();

    const iterator = stream[Symbol.asyncIterator]();

    // Close while waiting for next delivery
    const nextPromise = iterator.next();
    stream.close();

    const result = await nextPromise;
    expect(result.done).toBe(true);
  });

  it('reconnects on disconnect and continues yielding', async () => {
    let connectionCount = 0;
    const onReconnecting = vi.fn();

    server = await createTestServer({
      onWsConnection: (ws) => {
        connectionCount++;
        ws.send(connectedMessage());
        if (connectionCount === 1) {
          // Send a hook then disconnect
          ws.send(hookMessage({ id: 'hook-before-disconnect' }));
          setTimeout(() => ws.close(1001, 'going away'), 50);
        } else if (connectionCount === 2) {
          // Send a hook on reconnect
          setTimeout(() => {
            ws.send(hookMessage({ id: 'hook-after-reconnect' }));
          }, 50);
        }
      },
    });

    const client = createHttpClient(server.url);
    const stream = new Stream(client, { onReconnecting });
    await stream.start();

    const deliveries: PosthookDelivery[] = [];
    const iterator = stream[Symbol.asyncIterator]();

    // Get the first delivery
    const first = await iterator.next();
    deliveries.push(first.value);

    // Wait for reconnect and second delivery
    const second = await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<PosthookDelivery>>((_, reject) =>
        setTimeout(() => reject(new Error('timed out waiting for second delivery')), 5000),
      ),
    ]);
    deliveries.push(second.value);

    expect(deliveries[0].hookId).toBe('hook-before-disconnect');
    expect(deliveries[1].hookId).toBe('hook-after-reconnect');
    expect(onReconnecting).toHaveBeenCalledWith(1);

    stream.close();
  });
});

describe('WebSocketError', () => {
  it('has correct properties', () => {
    const err = new WebSocketError('connection lost');
    expect(err).toBeInstanceOf(WebSocketError);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('connection lost');
    expect(err.code).toBe('websocket_error');
    expect(err.status).toBeUndefined();
    expect(err.name).toBe('WebSocketError');
  });
});
