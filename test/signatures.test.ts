import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { Signatures } from '../src/resources/signatures.js';
import { createSignatures } from '../src/index.js';
import { CallbackError, SignatureVerificationError } from '../src/errors.js';

/**
 * Compute signature matching the Go implementation for test verification.
 */
function computeGoSignature(key: string, timestamp: number, body: string): string {
  const signedPayload = `${timestamp}.${body}`;
  const hmac = createHmac('sha256', key);
  hmac.update(signedPayload);
  return 'v1,' + hmac.digest('hex');
}

describe('Signatures resource', () => {
  let realDateNow: typeof Date.now;

  beforeEach(() => {
    realDateNow = Date.now;
    // Fix "now" to 1700000000 for timestamp tolerance tests
    vi.spyOn(Date, 'now').mockReturnValue(1700000000 * 1000);
  });

  afterEach(() => {
    Date.now = realDateNow;
    vi.restoreAllMocks();
  });

  describe('cross-language signature verification', () => {
    // These test vectors match the Go backend's signature tests

    it('verifies single key (TestComputePosthookSignature_SingleKey)', () => {
      const key = 'test-secret-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-123',
        path: '/webhooks/test',
        data: { event: 'test' },
        postAt: '2025-01-15T10:00:00Z',
        postedAt: '2025-01-15T10:00:01Z',
        createdAt: '2025-01-15T09:55:00Z',
        updatedAt: '2025-01-15T10:00:01Z',
      });

      const expectedSig = computeGoSignature(key, timestamp, body);
      const signatures = new Signatures(key);

      const delivery = signatures.parseDelivery(body, {
        'posthook-id': 'hook-123',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': expectedSig,
      });

      expect(delivery.hookId).toBe('hook-123');
      expect(delivery.timestamp).toBe(timestamp);
      expect(delivery.data).toEqual({ event: 'test' });
      expect(delivery.path).toBe('/webhooks/test');
      expect(delivery.postAt).toBe('2025-01-15T10:00:00Z');
      expect(delivery.postedAt).toBe('2025-01-15T10:00:01Z');
      expect(delivery.createdAt).toBe('2025-01-15T09:55:00Z');
      expect(delivery.updatedAt).toBe('2025-01-15T10:00:01Z');
    });

    it('verifies manual test case (TestComputePosthookSignature_VerifyManual)', () => {
      const key = 'my-webhook-secret';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-456',
        path: '/webhooks/charge',
        data: { user_id: 123 },
        postAt: '2025-01-15T10:00:00Z',
        postedAt: '2025-01-15T10:00:00Z',
        createdAt: '2025-01-15T09:55:00Z',
        updatedAt: '2025-01-15T10:00:00Z',
      });

      const expectedSig = computeGoSignature(key, timestamp, body);
      const signatures = new Signatures(key);

      const delivery = signatures.parseDelivery<{ user_id: number }>(
        body,
        {
          'posthook-id': 'hook-456',
          'posthook-timestamp': String(timestamp),
          'posthook-signature': expectedSig,
        },
      );

      expect(delivery.data.user_id).toBe(123);
      expect(delivery.path).toBe('/webhooks/charge');
    });

    it('verifies multiple signatures for key rotation', () => {
      const activeKey = 'active-key';
      const retiringKey = 'retiring-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-789', path: '/test', data: { event: 'test' },
        postAt: '', postedAt: '', createdAt: '', updatedAt: '',
      });

      // Build signature header with two keys (like Go does during rotation)
      const activeSig = computeGoSignature(activeKey, timestamp, body);
      const retiringSig = computeGoSignature(retiringKey, timestamp, body);
      const signatureHeader = `${activeSig} ${retiringSig}`;

      // Consumer verifies with the active key — should match first entry
      const signatures = new Signatures(activeKey);
      const delivery = signatures.parseDelivery(body, {
        'posthook-id': 'hook-789',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': signatureHeader,
      });
      expect(delivery.hookId).toBe('hook-789');

      // Consumer verifies with the retiring key — should match second entry
      const signaturesOld = new Signatures(retiringKey);
      const deliveryOld = signaturesOld.parseDelivery(body, {
        'posthook-id': 'hook-789',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': signatureHeader,
      });
      expect(deliveryOld.hookId).toBe('hook-789');
    });

    it('produces deterministic signatures', () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = '{"event":"test"}';

      const sig1 = computeGoSignature(key, timestamp, body);
      const sig2 = computeGoSignature(key, timestamp, body);
      expect(sig1).toBe(sig2);
    });

    it('different timestamps produce different signatures', () => {
      const key = 'test-key';
      const body = '{"event":"test"}';

      const sig1 = computeGoSignature(key, 1700000000, body);
      const sig2 = computeGoSignature(key, 1700000001, body);
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('signature format', () => {
    it('signature starts with v1,', () => {
      const sig = computeGoSignature('test-key', 1700000000, 'test');
      expect(sig).toMatch(/^v1,/);
    });

    it('hex part is 64 characters (SHA256)', () => {
      const sig = computeGoSignature('test-key', 1700000000, 'test body');
      const hexPart = sig.slice(3); // Remove "v1,"
      expect(hexPart).toHaveLength(64);
      expect(hexPart).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('error cases', () => {
    it('throws when no signing key is configured', () => {
      const signatures = new Signatures(undefined);
      expect(() =>
        signatures.parseDelivery('{}', {
          'posthook-id': 'id',
          'posthook-timestamp': '1700000000',
          'posthook-signature': 'v1,abc',
        }),
      ).toThrow(SignatureVerificationError);
      expect(() =>
        signatures.parseDelivery('{}', {
          'posthook-id': 'id',
          'posthook-timestamp': '1700000000',
          'posthook-signature': 'v1,abc',
        }),
      ).toThrow('No signing key provided');
    });

    it('throws when Posthook-Timestamp header is missing', () => {
      const signatures = new Signatures('test-key');
      expect(() =>
        signatures.parseDelivery('{}', {
          'posthook-id': 'id',
          'posthook-signature': 'v1,abc',
        }),
      ).toThrow('Missing Posthook-Timestamp header');
    });

    it('throws when Posthook-Signature header is missing', () => {
      const signatures = new Signatures('test-key');
      expect(() =>
        signatures.parseDelivery('{}', {
          'posthook-id': 'id',
          'posthook-timestamp': '1700000000',
        }),
      ).toThrow('Missing Posthook-Signature header');
    });

    it('returns empty hookId when Posthook-Id header is missing', () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-no-id',
        path: '/test',
        data: {},
        postAt: '',
        postedAt: '',
        createdAt: '',
        updatedAt: '',
      });
      const sig = computeGoSignature(key, timestamp, body);
      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(body, {
        'posthook-timestamp': String(timestamp),
        'posthook-signature': sig,
      });
      expect(delivery.hookId).toBe('');
    });

    it('throws when timestamp is too old', () => {
      // Date.now is mocked to 1700000000*1000
      // Use a timestamp 6 minutes ago (beyond 5-minute tolerance)
      const signatures = new Signatures('test-key');
      const oldTimestamp = 1700000000 - 360;
      const body = '{}';
      const sig = computeGoSignature('test-key', oldTimestamp, body);

      expect(() =>
        signatures.parseDelivery(body, {
          'posthook-id': 'id',
          'posthook-timestamp': String(oldTimestamp),
          'posthook-signature': sig,
        }),
      ).toThrow('Timestamp is too old');
    });

    it('throws when timestamp is in the future beyond tolerance', () => {
      const signatures = new Signatures('test-key');
      const futureTimestamp = 1700000000 + 360;
      const body = '{}';
      const sig = computeGoSignature('test-key', futureTimestamp, body);

      expect(() =>
        signatures.parseDelivery(body, {
          'posthook-id': 'id',
          'posthook-timestamp': String(futureTimestamp),
          'posthook-signature': sig,
        }),
      ).toThrow('Timestamp is too old or too far in the future');
    });

    it('throws when body is tampered', () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const originalBody = '{"event":"test"}';
      const sig = computeGoSignature(key, timestamp, originalBody);

      const signatures = new Signatures(key);
      const tamperedBody = '{"event":"hacked"}';

      expect(() =>
        signatures.parseDelivery(tamperedBody, {
          'posthook-id': 'id',
          'posthook-timestamp': String(timestamp),
          'posthook-signature': sig,
        }),
      ).toThrow('Signature verification failed');
    });

    it('throws when wrong key is used', () => {
      const timestamp = 1700000000;
      const body = '{"event":"test"}';
      const sig = computeGoSignature('correct-key', timestamp, body);

      const signatures = new Signatures('wrong-key');

      expect(() =>
        signatures.parseDelivery(body, {
          'posthook-id': 'id',
          'posthook-timestamp': String(timestamp),
          'posthook-signature': sig,
        }),
      ).toThrow('Signature verification failed');
    });

    it('throws when body is not valid JSON', () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = 'not json';
      const sig = computeGoSignature(key, timestamp, body);

      const signatures = new Signatures(key);

      expect(() =>
        signatures.parseDelivery(body, {
          'posthook-id': 'id',
          'posthook-timestamp': String(timestamp),
          'posthook-signature': sig,
        }),
      ).toThrow('Failed to parse request body as JSON');
    });
  });

  describe('header handling', () => {
    it('works with Headers API (fetch-style)', () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({ id: 'hook-h1', path: '/test', data: { test: true }, postAt: '', postedAt: '', createdAt: '', updatedAt: '' });
      const sig = computeGoSignature(key, timestamp, body);

      const headers = new Headers();
      headers.set('Posthook-Id', 'hook-h1');
      headers.set('Posthook-Timestamp', String(timestamp));
      headers.set('Posthook-Signature', sig);

      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(body, headers);
      expect(delivery.hookId).toBe('hook-h1');
    });

    it('works with plain object headers (Express-style)', () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({ id: 'hook-h2', path: '/test', data: { test: true }, postAt: '', postedAt: '', createdAt: '', updatedAt: '' });
      const sig = computeGoSignature(key, timestamp, body);

      // Express normalizes to lowercase
      const headers = {
        'posthook-id': 'hook-h2',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': sig,
      };

      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(body, headers);
      expect(delivery.hookId).toBe('hook-h2');
    });

    it('works with title-case object headers', () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({ id: 'hook-tc', path: '/test', data: { test: true }, postAt: '', postedAt: '', createdAt: '', updatedAt: '' });
      const sig = computeGoSignature(key, timestamp, body);

      const headers = {
        'Posthook-Id': 'hook-tc',
        'Posthook-Timestamp': String(timestamp),
        'Posthook-Signature': sig,
      };

      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(body, headers);
      expect(delivery.hookId).toBe('hook-tc');
    });

    it('works with Buffer body', () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const bodyStr = JSON.stringify({
        id: 'hook-buf',
        path: '/buf',
        data: { buffer: true },
        postAt: '2025-01-15T10:00:00Z',
        postedAt: '2025-01-15T10:00:01Z',
        createdAt: '2025-01-15T09:55:00Z',
        updatedAt: '2025-01-15T10:00:01Z',
      });
      const sig = computeGoSignature(key, timestamp, bodyStr);

      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(Buffer.from(bodyStr), {
        'posthook-id': 'hook-buf',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': sig,
      });
      expect(delivery.data).toEqual({ buffer: true });
      expect(delivery.path).toBe('/buf');
    });
  });

  describe('options', () => {
    it('accepts custom tolerance', () => {
      const key = 'test-key';
      // Timestamp 10 minutes ago (would fail default 5-min tolerance)
      const timestamp = 1700000000 - 600;
      const body = JSON.stringify({ id: 'hook-tol', path: '/test', data: { test: true }, postAt: '', postedAt: '', createdAt: '', updatedAt: '' });
      const sig = computeGoSignature(key, timestamp, body);

      const signatures = new Signatures(key);

      // With 15-minute tolerance, should pass
      const delivery = signatures.parseDelivery(
        body,
        {
          'posthook-id': 'hook-tol',
          'posthook-timestamp': String(timestamp),
          'posthook-signature': sig,
        },
        { tolerance: 900 },
      );
      expect(delivery.hookId).toBe('hook-tol');
    });

    it('accepts per-call signing key override', () => {
      const constructorKey = 'wrong-key';
      const overrideKey = 'correct-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({ id: 'hook-override', path: '/test', data: { test: true }, postAt: '', postedAt: '', createdAt: '', updatedAt: '' });
      const sig = computeGoSignature(overrideKey, timestamp, body);

      const signatures = new Signatures(constructorKey);

      // Constructor key would fail, but override should work
      const delivery = signatures.parseDelivery(
        body,
        {
          'posthook-id': 'hook-override',
          'posthook-timestamp': String(timestamp),
          'posthook-signature': sig,
        },
        { signingKey: overrideKey },
      );
      expect(delivery.hookId).toBe('hook-override');
    });
  });

  describe('async hooks enrichment', () => {
    it('attaches ack/nack methods and URLs when callback headers are present', () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-async',
        path: '/test',
        data: { async: true },
        postAt: '',
        postedAt: '',
        createdAt: '',
        updatedAt: '',
      });
      const sig = computeGoSignature(key, timestamp, body);

      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(body, {
        'posthook-id': 'hook-async',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': sig,
        'posthook-ack-url': 'https://api.posthook.io/v1/hooks/hook-async/ack?token=tok123',
        'posthook-nack-url': 'https://api.posthook.io/v1/hooks/hook-async/nack?token=tok123',
      });

      expect(delivery.ackUrl).toBe('https://api.posthook.io/v1/hooks/hook-async/ack?token=tok123');
      expect(delivery.nackUrl).toBe('https://api.posthook.io/v1/hooks/hook-async/nack?token=tok123');
      expect(typeof delivery.ack).toBe('function');
      expect(typeof delivery.nack).toBe('function');
    });

    it('does not attach ack/nack when callback headers are absent', () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-sync',
        path: '/test',
        data: { async: false },
        postAt: '',
        postedAt: '',
        createdAt: '',
        updatedAt: '',
      });
      const sig = computeGoSignature(key, timestamp, body);

      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(body, {
        'posthook-id': 'hook-sync',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': sig,
      });

      expect(delivery.ackUrl).toBeUndefined();
      expect(delivery.nackUrl).toBeUndefined();
      expect(delivery.ack).toBeUndefined();
      expect(delivery.nack).toBeUndefined();
    });

    it('does not attach ack/nack when only one callback header is present', () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-partial',
        path: '/test',
        data: {},
        postAt: '',
        postedAt: '',
        createdAt: '',
        updatedAt: '',
      });
      const sig = computeGoSignature(key, timestamp, body);

      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(body, {
        'posthook-id': 'hook-partial',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': sig,
        'posthook-ack-url': 'https://api.posthook.io/v1/hooks/hook-partial/ack?token=tok',
        // Missing posthook-nack-url
      });

      expect(delivery.ack).toBeUndefined();
      expect(delivery.nack).toBeUndefined();
    });

    it('ack() calls fetch with POST to the ack URL', async () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-ack-fetch',
        path: '/test',
        data: {},
        postAt: '',
        postedAt: '',
        createdAt: '',
        updatedAt: '',
      });
      const sig = computeGoSignature(key, timestamp, body);

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { status: 'completed' } }), { status: 200 }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(body, {
        'posthook-id': 'hook-ack-fetch',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': sig,
        'posthook-ack-url': 'https://api.posthook.io/v1/hooks/hook-ack-fetch/ack?token=tok',
        'posthook-nack-url': 'https://api.posthook.io/v1/hooks/hook-ack-fetch/nack?token=tok',
      });

      await delivery.ack!();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.posthook.io/v1/hooks/hook-ack-fetch/ack?token=tok',
        expect.objectContaining({ method: 'POST' }),
      );

      vi.unstubAllGlobals();
    });

    it('nack() calls fetch with POST and JSON body', async () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-nack-fetch',
        path: '/test',
        data: {},
        postAt: '',
        postedAt: '',
        createdAt: '',
        updatedAt: '',
      });
      const sig = computeGoSignature(key, timestamp, body);

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { status: 'nacked' } }), { status: 200 }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(body, {
        'posthook-id': 'hook-nack-fetch',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': sig,
        'posthook-ack-url': 'https://api.posthook.io/v1/hooks/hook-nack-fetch/ack?token=tok',
        'posthook-nack-url': 'https://api.posthook.io/v1/hooks/hook-nack-fetch/nack?token=tok',
      });

      await delivery.nack!({ error: 'processing failed' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.posthook.io/v1/hooks/hook-nack-fetch/nack?token=tok',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'processing failed' }),
        }),
      );

      vi.unstubAllGlobals();
    });
  });

  describe('ack/nack error handling', () => {
    it('ack() throws CallbackError on 401', async () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-ack-err',
        path: '/test',
        data: {},
        postAt: '',
        postedAt: '',
        createdAt: '',
        updatedAt: '',
      });
      const sig = computeGoSignature(key, timestamp, body);

      const mockFetch = vi.fn().mockResolvedValue(new Response('token expired', { status: 401 }));
      vi.stubGlobal('fetch', mockFetch);

      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(body, {
        'posthook-id': 'hook-ack-err',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': sig,
        'posthook-ack-url': 'https://api.posthook.io/v1/hooks/hook-ack-err/ack?token=tok',
        'posthook-nack-url': 'https://api.posthook.io/v1/hooks/hook-ack-err/nack?token=tok',
      });

      await expect(delivery.ack!()).rejects.toThrow(CallbackError);
      await expect(delivery.ack!()).rejects.toThrow('ack failed: 401');

      vi.unstubAllGlobals();
    });

    it('nack() throws CallbackError on 500', async () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-nack-err',
        path: '/test',
        data: {},
        postAt: '',
        postedAt: '',
        createdAt: '',
        updatedAt: '',
      });
      const sig = computeGoSignature(key, timestamp, body);

      const mockFetch = vi.fn().mockResolvedValue(new Response('internal error', { status: 500 }));
      vi.stubGlobal('fetch', mockFetch);

      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(body, {
        'posthook-id': 'hook-nack-err',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': sig,
        'posthook-ack-url': 'https://api.posthook.io/v1/hooks/hook-nack-err/ack?token=tok',
        'posthook-nack-url': 'https://api.posthook.io/v1/hooks/hook-nack-err/nack?token=tok',
      });

      await expect(delivery.nack!({ error: 'bad' })).rejects.toThrow(CallbackError);
      await expect(delivery.nack!({ error: 'bad' })).rejects.toThrow('nack failed: 500');

      vi.unstubAllGlobals();
    });

    it('ack() returns applied:true on success', async () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-ack-ok',
        path: '/test',
        data: {},
        postAt: '',
        postedAt: '',
        createdAt: '',
        updatedAt: '',
      });
      const sig = computeGoSignature(key, timestamp, body);

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { status: 'completed' } }), { status: 200 }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(body, {
        'posthook-id': 'hook-ack-ok',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': sig,
        'posthook-ack-url': 'https://api.posthook.io/v1/hooks/hook-ack-ok/ack?token=tok',
        'posthook-nack-url': 'https://api.posthook.io/v1/hooks/hook-ack-ok/nack?token=tok',
      });

      const result = await delivery.ack!();
      expect(result).toEqual({ applied: true, status: 'completed' });

      vi.unstubAllGlobals();
    });

    it('ack() returns applied:false on idempotent no-op', async () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-ack-noop',
        path: '/test',
        data: {},
        postAt: '',
        postedAt: '',
        createdAt: '',
        updatedAt: '',
      });
      const sig = computeGoSignature(key, timestamp, body);

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { status: 'failed' } }), { status: 200 }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(body, {
        'posthook-id': 'hook-ack-noop',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': sig,
        'posthook-ack-url': 'https://api.posthook.io/v1/hooks/hook-ack-noop/ack?token=tok',
        'posthook-nack-url': 'https://api.posthook.io/v1/hooks/hook-ack-noop/nack?token=tok',
      });

      const result = await delivery.ack!();
      expect(result).toEqual({ applied: false, status: 'failed' });

      vi.unstubAllGlobals();
    });

    it('ack() returns applied:false on 404', async () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-ack-404',
        path: '/test',
        data: {},
        postAt: '',
        postedAt: '',
        createdAt: '',
        updatedAt: '',
      });
      const sig = computeGoSignature(key, timestamp, body);

      const mockFetch = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
      vi.stubGlobal('fetch', mockFetch);

      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(body, {
        'posthook-id': 'hook-ack-404',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': sig,
        'posthook-ack-url': 'https://api.posthook.io/v1/hooks/hook-ack-404/ack?token=tok',
        'posthook-nack-url': 'https://api.posthook.io/v1/hooks/hook-ack-404/nack?token=tok',
      });

      const result = await delivery.ack!();
      expect(result).toEqual({ applied: false, status: 'not_found' });

      vi.unstubAllGlobals();
    });

    it('ack() returns applied:false on 409', async () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-ack-409',
        path: '/test',
        data: {},
        postAt: '',
        postedAt: '',
        createdAt: '',
        updatedAt: '',
      });
      const sig = computeGoSignature(key, timestamp, body);

      const mockFetch = vi.fn().mockResolvedValue(new Response('conflict', { status: 409 }));
      vi.stubGlobal('fetch', mockFetch);

      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(body, {
        'posthook-id': 'hook-ack-409',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': sig,
        'posthook-ack-url': 'https://api.posthook.io/v1/hooks/hook-ack-409/ack?token=tok',
        'posthook-nack-url': 'https://api.posthook.io/v1/hooks/hook-ack-409/nack?token=tok',
      });

      const result = await delivery.ack!();
      expect(result).toEqual({ applied: false, status: 'conflict' });

      vi.unstubAllGlobals();
    });

    it('ack() throws CallbackError on 410', async () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-ack-410',
        path: '/test',
        data: {},
        postAt: '',
        postedAt: '',
        createdAt: '',
        updatedAt: '',
      });
      const sig = computeGoSignature(key, timestamp, body);

      const mockFetch = vi.fn().mockResolvedValue(new Response('gone', { status: 410 }));
      vi.stubGlobal('fetch', mockFetch);

      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(body, {
        'posthook-id': 'hook-ack-410',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': sig,
        'posthook-ack-url': 'https://api.posthook.io/v1/hooks/hook-ack-410/ack?token=tok',
        'posthook-nack-url': 'https://api.posthook.io/v1/hooks/hook-ack-410/nack?token=tok',
      });

      await expect(delivery.ack!()).rejects.toThrow(CallbackError);
      await expect(delivery.ack!()).rejects.toThrow('ack failed: 410');

      vi.unstubAllGlobals();
    });

    it('nack() returns applied:true on success', async () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-nack-ok',
        path: '/test',
        data: {},
        postAt: '',
        postedAt: '',
        createdAt: '',
        updatedAt: '',
      });
      const sig = computeGoSignature(key, timestamp, body);

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { status: 'nacked' } }), { status: 200 }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(body, {
        'posthook-id': 'hook-nack-ok',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': sig,
        'posthook-ack-url': 'https://api.posthook.io/v1/hooks/hook-nack-ok/ack?token=tok',
        'posthook-nack-url': 'https://api.posthook.io/v1/hooks/hook-nack-ok/nack?token=tok',
      });

      const result = await delivery.nack!({ error: 'processing failed' });
      expect(result).toEqual({ applied: true, status: 'nacked' });

      vi.unstubAllGlobals();
    });

    it('nack() returns applied:false on 409', async () => {
      const key = 'test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-nack-409',
        path: '/test',
        data: {},
        postAt: '',
        postedAt: '',
        createdAt: '',
        updatedAt: '',
      });
      const sig = computeGoSignature(key, timestamp, body);

      const mockFetch = vi.fn().mockResolvedValue(new Response('conflict', { status: 409 }));
      vi.stubGlobal('fetch', mockFetch);

      const signatures = new Signatures(key);
      const delivery = signatures.parseDelivery(body, {
        'posthook-id': 'hook-nack-409',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': sig,
        'posthook-ack-url': 'https://api.posthook.io/v1/hooks/hook-nack-409/ack?token=tok',
        'posthook-nack-url': 'https://api.posthook.io/v1/hooks/hook-nack-409/nack?token=tok',
      });

      const result = await delivery.nack!();
      expect(result).toEqual({ applied: false, status: 'conflict' });

      vi.unstubAllGlobals();
    });
  });

  describe('createSignatures factory', () => {
    it('returns a working Signatures instance for a valid key', () => {
      const key = 'factory-test-key';
      const timestamp = 1700000000;
      const body = JSON.stringify({
        id: 'hook-factory',
        path: '/factory',
        data: { factory: true },
        postAt: '',
        postedAt: '',
        createdAt: '',
        updatedAt: '',
      });
      const sig = computeGoSignature(key, timestamp, body);

      const signatures = createSignatures(key);

      const delivery = signatures.parseDelivery(body, {
        'posthook-id': 'hook-factory',
        'posthook-timestamp': String(timestamp),
        'posthook-signature': sig,
      });
      expect(delivery.hookId).toBe('hook-factory');
      expect(delivery.data).toEqual({ factory: true });
    });

    it('throws immediately when signingKey is an empty string', () => {
      expect(() => createSignatures('')).toThrow(
        'A non-empty signingKey is required',
      );
    });

    it('throws immediately when signingKey is only whitespace', () => {
      expect(() => createSignatures('   ')).toThrow(
        'A non-empty signingKey is required',
      );
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    it('throws immediately when signingKey is undefined (bypassing types)', () => {
      expect(() => createSignatures(undefined as any)).toThrow(
        'A non-empty signingKey is required',
      );
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    it('throws immediately when signingKey is null (bypassing types)', () => {
      expect(() => createSignatures(null as any)).toThrow(
        'A non-empty signingKey is required',
      );
    });
  });
});
