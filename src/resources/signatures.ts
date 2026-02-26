import { createHmac, timingSafeEqual } from 'node:crypto';
import { SignatureVerificationError } from '../errors.js';
import type { PosthookDelivery } from '../types/common.js';

const DEFAULT_TOLERANCE_SECONDS = 300; // 5 minutes

export interface VerifyOptions {
  /**
   * Maximum age of the timestamp in seconds.
   * @default 300 (5 minutes)
   */
  tolerance?: number;
}

export type HeaderSource =
  | Headers
  | Record<string, string | string[] | undefined>
  | { get(name: string): string | null };

interface DeliveryPayload<T> {
  id: string;
  path: string;
  data: T;
  postAt: string;
  postedAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Resource for verifying webhook signatures and parsing deliveries.
 */
export class Signatures {
  private readonly signingKey: string | undefined;

  constructor(signingKey: string | undefined) {
    this.signingKey = signingKey;
  }

  /**
   * Verify the signature and parse a webhook delivery into a typed object.
   *
   * @example
   * ```ts
   * // Express handler (must use raw body!)
   * app.post('/webhooks/user-created', express.raw({ type: '*\/*' }), (req, res) => {
   *   const delivery = posthook.signatures.parseDelivery<{ userId: string }>(
   *     req.body,
   *     req.headers,
   *   );
   *   console.log(delivery.data.userId); // typed as string
   *   res.sendStatus(200);
   * });
   * ```
   *
   * @param body - The raw request body (string or Buffer).
   * @param headers - The request headers containing `Posthook-Timestamp` and `Posthook-Signature`.
   * @param options - Optional verification options (tolerance, custom signing key).
   * @returns A typed delivery object.
   * @throws {SignatureVerificationError} If the signature is invalid, missing, or the timestamp is too old.
   */
  parseDelivery<T = Record<string, unknown>>(
    body: string | Buffer | Uint8Array,
    headers: HeaderSource,
    options?: VerifyOptions & { signingKey?: string },
  ): PosthookDelivery<T> {
    const key = options?.signingKey ?? this.signingKey;
    if (!key) {
      throw new SignatureVerificationError(
        'No signing key provided. Pass a signingKey to the Posthook constructor or to parseDelivery options.',
      );
    }

    const timestampStr = getHeader(headers, 'posthook-timestamp');
    if (!timestampStr) {
      throw new SignatureVerificationError(
        'Missing Posthook-Timestamp header',
      );
    }

    const signatureHeader = getHeader(headers, 'posthook-signature');
    if (!signatureHeader) {
      throw new SignatureVerificationError(
        'Missing Posthook-Signature header',
      );
    }

    const hookId = getHeader(headers, 'posthook-id') ?? '';

    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) {
      throw new SignatureVerificationError(
        'Invalid Posthook-Timestamp header: not a number',
      );
    }

    // Check timestamp tolerance
    const tolerance = options?.tolerance ?? DEFAULT_TOLERANCE_SECONDS;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > tolerance) {
      throw new SignatureVerificationError(
        `Timestamp is too old or too far in the future (difference: ${Math.abs(now - timestamp)}s, tolerance: ${tolerance}s)`,
      );
    }

    // Verify signature
    const bodyStr =
      typeof body === 'string'
        ? body
        : body instanceof Buffer
          ? body.toString('utf-8')
          : new TextDecoder().decode(body);
    const expectedSig = computeSignature(key, timestamp, bodyStr);

    // The header can contain multiple space-separated signatures (for key rotation)
    const signatures = signatureHeader.split(' ');
    let verified = false;
    for (const sig of signatures) {
      if (safeCompare(expectedSig, sig)) {
        verified = true;
        break;
      }
    }

    if (!verified) {
      throw new SignatureVerificationError(
        'Signature verification failed: no matching signature found',
      );
    }

    // Parse the body
    let payload: DeliveryPayload<T>;
    try {
      payload = JSON.parse(bodyStr) as DeliveryPayload<T>;
    } catch {
      throw new SignatureVerificationError(
        'Failed to parse request body as JSON',
      );
    }

    return {
      hookId,
      timestamp,
      path: payload.path ?? '',
      data: payload.data,
      postAt: payload.postAt ?? '',
      postedAt: payload.postedAt ?? '',
      createdAt: payload.createdAt ?? '',
      updatedAt: payload.updatedAt ?? '',
    };
  }
}

/**
 * Compute a Posthook signature matching the Go implementation.
 * Format: "v1,<hex-encoded HMAC-SHA256>"
 * Signed payload: "{timestamp}.{body}"
 */
function computeSignature(
  key: string,
  timestamp: number,
  body: string,
): string {
  const signedPayload = `${timestamp}.${body}`;
  const hmac = createHmac('sha256', key);
  hmac.update(signedPayload);
  return 'v1,' + hmac.digest('hex');
}

/**
 * Timing-safe string comparison for signature verification.
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf-8'), Buffer.from(b, 'utf-8'));
  } catch {
    return false;
  }
}

/**
 * Case-insensitive header lookup that works with various header types.
 */
function getHeader(
  headers: HeaderSource,
  name: string,
): string | null {
  // Headers API (fetch Response.headers)
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name);
  }

  // Plain object (Express req.headers, etc.)
  const record = headers as Record<string, string | string[] | undefined>;
  const lowerName = name.toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === lowerName) {
      const value = record[key];
      if (Array.isArray(value)) return value[0] ?? null;
      return value ?? null;
    }
  }
  return null;
}
