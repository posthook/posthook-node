import { describe, it, expect } from 'vitest';
import { HttpClient } from '../src/http.js';
import { mockFetch } from './helpers.js';
import {
  BadRequestError,
  AuthenticationError,
  NotFoundError,
  InternalServerError,
  ConnectionError,
  RateLimitError,
} from '../src/errors.js';

function createClient(fetchFn: typeof globalThis.fetch): HttpClient {
  return new HttpClient({
    apiKey: 'pk_test_123',
    baseURL: 'https://api.posthook.io',
    timeout: 5000,
    fetch: fetchFn,
  });
}

describe('HttpClient', () => {
  describe('request construction', () => {
    it('includes correct headers', async () => {
      const { fetch, calls } = mockFetch({ body: { data: {} } });
      const client = createClient(fetch);
      await client.get('/v1/test');

      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers['X-API-Key']).toBe('pk_test_123');
      expect(headers['User-Agent']).toMatch(/^posthook-node\//);
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('builds query parameters correctly', async () => {
      const { fetch, calls } = mockFetch({ body: { data: [] } });
      const client = createClient(fetch);
      await client.get('/v1/hooks', {
        status: 'failed',
        limit: 50,
        empty: undefined,
      });

      const url = new URL(calls[0].url);
      expect(url.searchParams.get('status')).toBe('failed');
      expect(url.searchParams.get('limit')).toBe('50');
      expect(url.searchParams.has('empty')).toBe(false);
    });

    it('sends JSON body on POST', async () => {
      const { fetch, calls } = mockFetch({ body: { data: {} } });
      const client = createClient(fetch);
      await client.post('/v1/hooks', { path: '/test', data: { foo: 'bar' } });

      expect(calls[0].init.method).toBe('POST');
      const body = JSON.parse(calls[0].init.body as string);
      expect(body.path).toBe('/test');
      expect(body.data.foo).toBe('bar');
    });

    it('uses DELETE method', async () => {
      const { fetch, calls } = mockFetch({ body: { data: {} } });
      const client = createClient(fetch);
      await client.delete('/v1/hooks/abc');

      expect(calls[0].init.method).toBe('DELETE');
    });

    it('merges per-request headers', async () => {
      const { fetch, calls } = mockFetch({ body: { data: {} } });
      const client = createClient(fetch);
      await client.get('/v1/test', undefined, {
        headers: { 'X-Custom': 'value' },
      });

      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers['X-Custom']).toBe('value');
      expect(headers['X-API-Key']).toBe('pk_test_123');
    });
  });

  describe('response unwrapping', () => {
    it('unwraps { data } envelope', async () => {
      const { fetch } = mockFetch({
        body: { data: { id: 'hook-1', status: 'pending' } },
      });
      const client = createClient(fetch);
      const result = await client.get<{ id: string; status: string }>(
        '/v1/hooks/hook-1',
      );
      expect(result.id).toBe('hook-1');
      expect(result.status).toBe('pending');
    });

    it('returns raw headers via postWithHeaders', async () => {
      const { fetch } = mockFetch({
        body: { data: { id: 'hook-1' } },
        headers: { 'Posthook-HookQuota-Limit': '1000' },
      });
      const client = createClient(fetch);
      const { data, headers } = await client.postWithHeaders<{ id: string }>(
        '/v1/hooks',
        { path: '/test' },
      );
      expect(data.id).toBe('hook-1');
      expect(headers.get('Posthook-HookQuota-Limit')).toBe('1000');
    });
  });

  describe('error handling', () => {
    it('throws BadRequestError on 400', async () => {
      const { fetch } = mockFetch({
        status: 400,
        body: { error: 'invalid path' },
      });
      const client = createClient(fetch);
      await expect(client.post('/v1/hooks', {})).rejects.toThrow(
        BadRequestError,
      );
    });

    it('throws AuthenticationError on 401', async () => {
      const { fetch } = mockFetch({
        status: 401,
        body: { error: 'not authorized' },
      });
      const client = createClient(fetch);
      await expect(client.get('/v1/hooks')).rejects.toThrow(
        AuthenticationError,
      );
    });

    it('throws NotFoundError on 404', async () => {
      const { fetch } = mockFetch({
        status: 404,
        body: { error: 'not found' },
      });
      const client = createClient(fetch);
      await expect(client.get('/v1/hooks/bad-id')).rejects.toThrow(
        NotFoundError,
      );
    });

    it('throws RateLimitError on 429', async () => {
      const { fetch } = mockFetch({
        status: 429,
        body: { error: 'rate limit exceeded' },
      });
      const client = createClient(fetch);
      await expect(client.post('/v1/hooks', {})).rejects.toThrow(
        RateLimitError,
      );
    });

    it('throws InternalServerError on 500', async () => {
      const { fetch } = mockFetch({
        status: 500,
        body: { error: 'internal error' },
      });
      const client = createClient(fetch);
      await expect(client.get('/v1/test')).rejects.toThrow(
        InternalServerError,
      );
    });

    it('includes error message from API response', async () => {
      const { fetch } = mockFetch({
        status: 400,
        body: { error: 'path is required' },
      });
      const client = createClient(fetch);
      await expect(client.post('/v1/hooks', {})).rejects.toThrow(
        'path is required',
      );
    });

    it('includes response headers on errors', async () => {
      const { fetch } = mockFetch({
        status: 400,
        body: { error: 'bad request' },
        headers: { 'X-Request-Id': 'req-123' },
      });
      const client = createClient(fetch);
      try {
        await client.post('/v1/hooks', {});
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestError);
        expect(
          (err as BadRequestError).headers?.get('X-Request-Id'),
        ).toBe('req-123');
      }
    });

    it('throws ConnectionError on network failure', async () => {
      const failFetch = async (): Promise<Response> => {
        throw new TypeError('fetch failed');
      };
      const client = createClient(failFetch as typeof globalThis.fetch);
      await expect(client.get('/v1/test')).rejects.toThrow(ConnectionError);
    });
  });

  describe('timeout', () => {
    it('throws ConnectionError on timeout', async () => {
      const slowFetch = async (
        _input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        return new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error('should not resolve')),
            10000,
          );
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      };

      const client = new HttpClient({
        apiKey: 'pk_test',
        baseURL: 'https://api.posthook.io',
        timeout: 50,
        fetch: slowFetch as typeof globalThis.fetch,
      });

      await expect(client.get('/v1/test')).rejects.toThrow(ConnectionError);
    });
  });
});
