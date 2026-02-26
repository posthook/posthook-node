# @posthook/node

The official Node.js/TypeScript SDK for [Posthook](https://posthook.io) — schedule webhooks and deliver them reliably.

## Installation

```bash
npm install @posthook/node
```

**Requirements:** Node.js 18+ (uses native `fetch`). Zero runtime dependencies.

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
  baseURL: 'https://api.posthook.io', // default
  timeout: 30000,                      // default, in ms
  signingKey: 'ph_sk_...',               // for verifying incoming deliveries
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

Deleting a hook that has already been delivered (404) is not an error — the call returns silently.

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

## TypeScript

All types are exported from the package:

```typescript
import Posthook, {
  type Hook,
  type HookScheduleParams,
  type HookListParams,
  type HookListAllParams,
  type Duration,
  type PosthookDelivery,
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

## Requirements

- Node.js 18+
- Zero runtime dependencies
