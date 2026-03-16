# @posthook/node

The official Node.js/TypeScript SDK for [Posthook](https://posthook.io) — schedule webhooks and deliver them reliably.

## Installation

```bash
npm install @posthook/node
```

**Requirements:** Node.js 18+ (uses native `fetch`). One runtime dependency (`ws`).

## Quick Start

```typescript
import Posthook from '@posthook/node';

const posthook = new Posthook('pk_...');

// Schedule a webhook 5 minutes from now
const hook = await posthook.hooks.schedule({
  path: '/webhooks/user-created',
  postIn: '5m',
  data: { userId: '123', event: 'user.created' },
});

console.log(hook.id);     // UUID
console.log(hook.status); // 'pending'
```

## How it works

Posthook delivers webhooks to `{your project domain}{path}`. Configure your domain in the [Posthook dashboard](https://posthook.io).

## Configuration

```typescript
const posthook = new Posthook('pk_...', {
  baseURL: 'https://api.posthook.io',  // default
  timeout: 30000,                       // default, in ms
  signingKey: 'ph_sk_...',              // for verifying incoming deliveries
});
```

### Environment variables

| Variable | Description |
|----------|-------------|
| `POSTHOOK_API_KEY` | Fallback API key (used when no key is passed to the constructor) |
| `POSTHOOK_SIGNING_KEY` | Fallback signing key for signature verification |

## Scheduling hooks

### Relative delay (`postIn`)

Schedule a webhook relative to now. Accepts `s` (seconds), `m` (minutes), `h` (hours), or `d` (days).

```typescript
const hook = await posthook.hooks.schedule({
  path: '/webhooks/send-reminder',
  postIn: '30m',
  data: { userId: '123' },
});
```

### Absolute UTC time (`postAt`)

Schedule at a specific UTC time in RFC 3339 format.

```typescript
const hook = await posthook.hooks.schedule({
  path: '/webhooks/send-reminder',
  postAt: '2025-06-15T10:00:00Z',
  data: { userId: '123' },
});
```

### Local time with timezone (`postAtLocal`)

Schedule at a local time. Posthook handles DST transitions automatically.

```typescript
const hook = await posthook.hooks.schedule({
  path: '/webhooks/send-reminder',
  postAtLocal: '2025-06-15T10:00:00',
  timezone: 'America/New_York',
  data: { userId: '123' },
});
```

### Quota info

After scheduling, quota info is available on the returned hook:

```typescript
const hook = await posthook.hooks.schedule({ ... });

if (hook._quota) {
  console.log(`${hook._quota.remaining} hooks remaining`);
  console.log(`Resets at ${hook._quota.resetsAt}`);
}
```

### Per-hook retry override

Override your project's retry settings for a specific hook:

```typescript
const hook = await posthook.hooks.schedule({
  path: '/webhooks/critical',
  postIn: '5m',
  data: { orderId: 'abc' },
  retryOverride: {
    minRetries: 10,
    delaySecs: 30,
    strategy: 'exponential',
    backoffFactor: 2.0,
    maxDelaySecs: 600,
    jitter: true,
  },
});
```

## Managing hooks

### List hooks

```typescript
// List failed hooks
const hooks = await posthook.hooks.list({ status: 'failed', limit: 50 });

// Cursor-based pagination
const nextPage = await posthook.hooks.list({
  status: 'failed',
  limit: 50,
  postAtAfter: hooks[hooks.length - 1].postAt,
});
```

### Auto-paginating iterator (`listAll`)

`listAll` yields every matching hook across all pages automatically:

```typescript
for await (const hook of posthook.hooks.listAll({ status: 'failed' })) {
  console.log(hook.id, hook.failureError);
}
```

### Get a hook

```typescript
const hook = await posthook.hooks.get('hook-uuid');
```

### Delete a hook

To cancel a pending hook, delete it before delivery. Idempotent — a 404 (already deleted) is not an error and the call returns silently.

```typescript
await posthook.hooks.delete('hook-uuid');
```

### Bulk retry / replay / cancel

```typescript
// Retry specific failed hooks
const result = await posthook.hooks.bulk.retry({
  hookIDs: ['id-1', 'id-2'],
});
console.log(`${result.affected} hooks retried`);

// Retry by time range filter
const result2 = await posthook.hooks.bulk.retry({
  startTime: '2025-01-01T00:00:00Z',
  endTime: '2025-01-02T00:00:00Z',
  limit: 100,
});

// Replay completed hooks
await posthook.hooks.bulk.replay({ hookIDs: ['id-1'] });

// Cancel pending hooks
await posthook.hooks.bulk.cancel({ hookIDs: ['id-1'] });
```

## Handling deliveries

Use `parseDelivery()` to verify the signature and parse the incoming webhook into a typed object.

**Important:** You must pass the **raw request body** (string or Buffer), not a parsed JSON object. If you use `express.json()`, the body will already be parsed and signature verification will fail.

### Express

```typescript
import express from 'express';
import Posthook from '@posthook/node';

const app = express();
const posthook = new Posthook('pk_...', { signingKey: 'ph_sk_...' });

// Use express.raw() to get the raw body for signature verification
app.post('/webhooks/user-created', express.raw({ type: '*/*' }), (req, res) => {
  try {
    const delivery = posthook.signatures.parseDelivery<{ userId: string }>(
      req.body,
      req.headers,
    );

    console.log(delivery.hookId);        // hook ID
    console.log(delivery.data.userId);   // typed as string
    console.log(delivery.postAt);        // scheduled time
    console.log(delivery.postedAt);      // actual delivery time

    res.sendStatus(200);
  } catch (err) {
    console.error('Signature verification failed:', err);
    res.sendStatus(400);
  }
});
```

### Fastify

```typescript
import Fastify from 'fastify';
import Posthook from '@posthook/node';

const fastify = Fastify({
  // Add raw body for signature verification
  rawBody: true,
});

const posthook = new Posthook('pk_...', { signingKey: 'ph_sk_...' });

fastify.post('/webhooks/user-created', (req, reply) => {
  const delivery = posthook.signatures.parseDelivery<{ userId: string }>(
    req.rawBody!,
    req.headers,
  );

  console.log(delivery.data.userId);
  reply.code(200).send();
});
```

### Generic Node.js HTTP

```typescript
import { createServer } from 'node:http';
import Posthook from '@posthook/node';

const posthook = new Posthook('pk_...', { signingKey: 'ph_sk_...' });

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    try {
      const delivery = posthook.signatures.parseDelivery(body, req.headers);
      console.log(delivery.data);
      res.writeHead(200);
      res.end();
    } catch {
      res.writeHead(400);
      res.end();
    }
  });
}).listen(3000);
```

## Async Hooks

When [async hooks](https://docs.posthook.io/essentials/async-hooks) are enabled, `parseDelivery()` returns `ack` and `nack` methods on the delivery object. Return 202 from your handler and call back when processing completes.

```typescript
app.post('/webhooks/process-video', express.raw({ type: '*/*' }), async (req, res) => {
  const delivery = posthook.signatures.parseDelivery<{ videoId: string }>(
    req.body,
    req.headers,
  );

  res.status(202).end();
  try {
    await processVideo(delivery.data.videoId);
    await delivery.ack();
  } catch (err) {
    await delivery.nack({ error: err.message });
  }
});
```

Both `ack()` and `nack()` return a `CallbackResult`:

```typescript
const result = await delivery.ack();
console.log(result.applied); // true if state changed, false if already resolved
console.log(result.status);  // "completed", "not_found", "conflict", etc.
```

`ack()` and `nack()` resolve without throwing for `200`, `404`, and `409` responses. They throw `CallbackError` for `401` (invalid token) and `410` (expired).

If processing happens in a separate worker, use the raw callback URLs instead:

```typescript
// Pass URLs through your queue
await queue.add('transcode', {
  videoId: delivery.data.videoId,
  ackUrl: delivery.ackUrl,
  nackUrl: delivery.nackUrl,
});
```

## WebSocket listener

Receive hooks in real time over a persistent WebSocket connection instead of
an HTTP endpoint. Enable WebSocket delivery in your project settings first.

### Callback style (`listen`)

Pass a handler function. The SDK manages the connection, heartbeat, and
reconnection automatically.

```typescript
import Posthook, { Result } from '@posthook/node';

const posthook = new Posthook('pk_...');

const listener = await posthook.hooks.listen(async (delivery) => {
  console.log(delivery.hookId, delivery.data);

  // Return Result.ack() to mark success
  return Result.ack();
}, {
  maxConcurrency: 5, // default: unlimited
  onConnected: (info) => console.log('Connected:', info.projectName),
  onDisconnected: (err) => console.log('Disconnected:', err?.message),
  onReconnecting: (attempt) => console.log(`Reconnecting (attempt ${attempt})...`),
});

// Block until the listener is closed
await listener.wait();
```

**Result types:**

| Factory | Effect |
|---------|--------|
| `Result.ack()` | Processing complete — hook is marked as delivered immediately |
| `Result.nack(error?)` | Reject — triggers retry according to project settings |
| `Result.accept(timeoutSecs)` | Async — you have `timeoutSecs` to call back via HTTP (see below) |

If your handler throws, the SDK automatically sends a `nack` with the error message.

### Async processing with `accept`

Use `accept` when your handler needs more time than the 10-second ack window
(e.g., video processing, third-party API calls). After returning `accept`, you
must POST to the callback URLs on the delivery to report the outcome:

```typescript
const listener = await posthook.hooks.listen(async (delivery) => {
  // Kick off background work and accept immediately
  backgroundQueue.add({ ...delivery.data, ackUrl: delivery.ackUrl, nackUrl: delivery.nackUrl });
  return Result.accept(300); // 5 minutes to call back
});

// Later, in the background worker:
await fetch(job.ackUrl, { method: 'POST' });
// or on failure:
await fetch(job.nackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'failed' }) });
```

If neither URL is called before the deadline, the hook is retried.

### Async iterator style (`stream`)

For more control, use `stream()` which returns an `AsyncIterable`. You must
explicitly ack, accept, or nack each delivery.

```typescript
const stream = await posthook.hooks.stream({
  onConnected: (info) => console.log('Connected:', info.projectName),
});

for await (const delivery of stream) {
  console.log(delivery.hookId, delivery.data);
  console.log(delivery.ws?.attempt, 'of', delivery.ws?.maxAttempts);

  stream.ack(delivery.hookId);
  // or: stream.accept(delivery.hookId, 300);
  // or: stream.nack(delivery.hookId, 'bad data');
}
```

### HTTP fallback

If your project has a domain configured, hooks are delivered via HTTP when no
WebSocket listener is connected. You can run both an HTTP endpoint and a
WebSocket listener — the server uses WebSocket when available and falls back to
HTTP automatically. Since both paths use the same `Result` type, you can share
your handler logic:

```typescript
async function processHook(delivery: PosthookDelivery): Promise<Result> {
  await processOrder(delivery.data);
  return Result.ack();
}

// HTTP delivery (Express endpoint)
app.post('/webhooks/order', express.raw({ type: '*/*' }),
  posthook.signatures.expressHandler(processHook));

// WebSocket delivery (runs alongside)
const listener = await posthook.hooks.listen(processHook);
```

### Connection lifecycle

- **Reconnection:** On disconnect the SDK reconnects with exponential backoff
  (`min(1s * 2^attempts, 30s)`), up to 10 attempts. The counter resets on a
  successful connection.
- **Heartbeat:** If no server activity is detected for 45 seconds the
  connection is considered stale and force-closed for reconnection.
- **Auth errors:** Close codes `4001` and `4003` abort immediately without
  reconnecting.

## Express handler

`signatures.expressHandler()` wraps signature verification and `Result`
dispatch into a single Express-compatible middleware:

```typescript
import express from 'express';
import Posthook, { Result } from '@posthook/node';

const app = express();
const posthook = new Posthook('pk_...', { signingKey: 'ph_sk_...' });

app.post(
  '/webhooks/order',
  express.raw({ type: '*/*' }),
  posthook.signatures.expressHandler(async (delivery) => {
    await processOrder(delivery.data);
    return Result.ack();  // 200 { ok: true }
    // Result.accept(60) -> 202 { ok: true }
    // Result.nack('bad') -> 500 { error: 'bad' }
  }),
);
```

## Handler response codes

Posthook interprets your handler's HTTP response:

- **2xx** = success (delivery complete, hook marked as completed)
- **Anything else** = failure (triggers retry according to your project/hook retry settings)

This includes 3xx redirects — they are treated as failures. Response body is ignored. Just return 200.

## Idempotency

Use `delivery.hookId` as the idempotency key. The same hook ID is sent on every retry attempt.

```typescript
app.post('/webhooks/charge', express.raw({ type: '*/*' }), async (req, res) => {
  const delivery = posthook.signatures.parseDelivery<{ orderId: string }>(
    req.body,
    req.headers,
  );

  // Check if already processed
  const exists = await db.query('SELECT 1 FROM processed_hooks WHERE hook_id = $1', [delivery.hookId]);
  if (exists.rows.length > 0) {
    return res.sendStatus(200); // Already processed, return success
  }

  // Process the webhook
  await chargeOrder(delivery.data.orderId);

  // Mark as processed
  await db.query('INSERT INTO processed_hooks (hook_id) VALUES ($1)', [delivery.hookId]);

  res.sendStatus(200);
});
```

## Error handling

All errors extend `PosthookError` and can be caught with `instanceof`:

```typescript
import Posthook, {
  PosthookError,
  AuthenticationError,
  RateLimitError,
  NotFoundError,
} from '@posthook/node';

try {
  await posthook.hooks.schedule({ path: '/test', postIn: '5m' });
} catch (err) {
  if (err instanceof RateLimitError) {
    console.log('Rate limited, retry later');
  } else if (err instanceof AuthenticationError) {
    console.log('Invalid API key');
  } else if (err instanceof NotFoundError) {
    console.log('Hook not found');
  } else if (err instanceof PosthookError) {
    console.log(`API error: ${err.message} (${err.code})`);
  }
}
```

| Error class | HTTP Status | Code |
|---|---|---|
| `BadRequestError` | 400 | `bad_request` |
| `AuthenticationError` | 401 | `authentication_error` |
| `ForbiddenError` | 403 | `forbidden` |
| `NotFoundError` | 404 | `not_found` |
| `PayloadTooLargeError` | 413 | `payload_too_large` |
| `RateLimitError` | 429 | `rate_limit_exceeded` |
| `InternalServerError` | 500+ | `internal_error` |
| `ConnectionError` | — | `connection_error` |
| `SignatureVerificationError` | — | `signature_verification_error` |
| `WebSocketError` | — | `websocket_error` |

## TypeScript

All types are exported from the package:

```typescript
import Posthook, {
  Result,
  type Hook,
  type HookScheduleParams,
  type HookListParams,
  type HookListAllParams,
  type Duration,
  type PosthookDelivery,
  type WebSocketMeta,
  type ConnectionInfo,
  type ListenOptions,
  type StreamOptions,
  type ListenHandler,
  type QuotaInfo,
  type BulkActionResult,
  type BulkActionParams,
} from '@posthook/node';
```

### Generics

Both `schedule` and `parseDelivery` accept a generic type parameter for the data payload:

```typescript
interface UserEvent {
  userId: string;
  event: string;
}

// Type-safe scheduling
const hook = await posthook.hooks.schedule<UserEvent>({
  path: '/webhooks/user',
  postIn: '5m',
  data: { userId: '123', event: 'created' }, // typed
});
console.log(hook.data.userId); // typed as string

// Type-safe delivery parsing
const delivery = posthook.signatures.parseDelivery<UserEvent>(body, headers);
console.log(delivery.data.userId); // typed as string
```

### Discriminated unions

`HookScheduleParams` is a discriminated union — TypeScript enforces that exactly one scheduling mode is used:

```typescript
// OK: postIn mode
posthook.hooks.schedule({ path: '/test', postIn: '5m' });

// OK: postAtLocal mode (timezone required)
posthook.hooks.schedule({ path: '/test', postAtLocal: '2025-01-15T10:00:00', timezone: 'US/Eastern' });

// Type error: can't mix modes
posthook.hooks.schedule({ path: '/test', postIn: '5m', postAt: '...' });

// Type error: timezone requires postAtLocal
posthook.hooks.schedule({ path: '/test', postAt: '...', timezone: 'US/Eastern' });
```

## Resources

- [Documentation](https://docs.posthook.io) — guides, concepts, and patterns
- [API Reference](https://docs.posthook.io/api-reference/introduction) — endpoint specs and examples
- [Quickstart](https://docs.posthook.io/quickstart) — get started in under 2 minutes
- [Pricing](https://posthook.io/pricing) — free tier included
- [Status](https://status.posthook.io) — uptime and incident history

## Requirements

- Node.js 18+
- Runtime dependency: `ws` (WebSocket client)
