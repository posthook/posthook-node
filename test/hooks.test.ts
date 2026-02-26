import { describe, it, expect } from 'vitest';
import { Posthook } from '../src/client.js';
import { mockFetch, mockFetchSequence, hookFixture } from './helpers.js';

function createClient(fetchFn: typeof globalThis.fetch): Posthook {
  return new Posthook('pk_test_123', { fetch: fetchFn });
}

describe('Hooks resource', () => {
  describe('schedule', () => {
    it('posts to /v1/hooks with postIn', async () => {
      const { fetch, calls } = mockFetch({
        status: 201,
        body: { data: hookFixture },
      });
      const client = createClient(fetch);

      const hook = await client.hooks.schedule({
        path: '/webhooks/test',
        postIn: '5m',
        data: { event: 'test' },
      });

      expect(hook.id).toBe(hookFixture.id);
      expect(calls[0].url).toMatch(/\/v1\/hooks$/);
      expect(calls[0].init.method).toBe('POST');

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.path).toBe('/webhooks/test');
      expect(body.postIn).toBe('5m');
      expect(body.data).toEqual({ event: 'test' });
    });

    it('posts with postAt', async () => {
      const { fetch, calls } = mockFetch({
        status: 201,
        body: { data: hookFixture },
      });
      const client = createClient(fetch);

      await client.hooks.schedule({
        path: '/webhooks/test',
        postAt: '2025-01-15T10:00:00Z',
      });

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.postAt).toBe('2025-01-15T10:00:00Z');
      expect(body.postIn).toBeUndefined();
      expect(body.postAtLocal).toBeUndefined();
    });

    it('posts with postAtLocal and timezone', async () => {
      const { fetch, calls } = mockFetch({
        status: 201,
        body: { data: hookFixture },
      });
      const client = createClient(fetch);

      await client.hooks.schedule({
        path: '/webhooks/test',
        postAtLocal: '2025-01-15T10:00:00',
        timezone: 'America/New_York',
      });

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.postAtLocal).toBe('2025-01-15T10:00:00');
      expect(body.timezone).toBe('America/New_York');
    });

    it('includes retryOverride when provided', async () => {
      const { fetch, calls } = mockFetch({
        status: 201,
        body: { data: hookFixture },
      });
      const client = createClient(fetch);

      await client.hooks.schedule({
        path: '/webhooks/test',
        postIn: '5m',
        retryOverride: {
          minRetries: 5,
          delaySecs: 10,
          strategy: 'exponential',
          backoffFactor: 2.0,
          maxDelaySecs: 300,
        },
      });

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.retryOverride.minRetries).toBe(5);
      expect(body.retryOverride.strategy).toBe('exponential');
    });

    it('extracts quota info from response headers', async () => {
      const { fetch } = mockFetch({
        status: 201,
        body: { data: hookFixture },
        headers: {
          'Posthook-HookQuota-Limit': '10000',
          'Posthook-HookQuota-Usage': '500',
          'Posthook-HookQuota-Remaining': '9500',
          'Posthook-HookQuota-Resets-At': '2025-02-01T00:00:00Z',
        },
      });
      const client = createClient(fetch);

      const hook = await client.hooks.schedule({
        path: '/webhooks/test',
        postIn: '5m',
      });

      expect(hook._quota).toEqual({
        limit: 10000,
        usage: 500,
        remaining: 9500,
        resetsAt: '2025-02-01T00:00:00Z',
      });
    });

    it('sets _quota to null when headers are absent', async () => {
      const { fetch } = mockFetch({
        status: 201,
        body: { data: hookFixture },
      });
      const client = createClient(fetch);

      const hook = await client.hooks.schedule({
        path: '/webhooks/test',
        postIn: '5m',
      });

      expect(hook._quota).toBeNull();
    });

    it('_quota is visible in JSON serialization', async () => {
      const { fetch } = mockFetch({
        status: 201,
        body: { data: hookFixture },
        headers: {
          'Posthook-HookQuota-Limit': '10000',
          'Posthook-HookQuota-Usage': '500',
          'Posthook-HookQuota-Remaining': '9500',
          'Posthook-HookQuota-Resets-At': '2025-02-01T00:00:00Z',
        },
      });
      const client = createClient(fetch);
      const hook = await client.hooks.schedule({
        path: '/webhooks/test',
        postIn: '5m',
      });

      // _quota should appear in JSON serialization
      const json = JSON.parse(JSON.stringify(hook));
      expect(json._quota).toBeDefined();
      expect(json._quota.limit).toBe(10000);
      // And accessible directly
      expect(hook._quota).toBeDefined();
    });
  });

  describe('get', () => {
    it('throws on empty id', async () => {
      const { fetch } = mockFetch({ body: { data: hookFixture } });
      const client = createClient(fetch);
      await expect(client.hooks.get('')).rejects.toThrow('hook id is required');
    });

    it('gets /v1/hooks/{id}', async () => {
      const { fetch, calls } = mockFetch({
        body: { data: hookFixture },
      });
      const client = createClient(fetch);

      const hook = await client.hooks.get(hookFixture.id);

      expect(hook.id).toBe(hookFixture.id);
      expect(calls[0].url).toContain(`/v1/hooks/${hookFixture.id}`);
      expect(calls[0].init.method).toBe('GET');
    });
  });

  describe('list', () => {
    it('gets /v1/hooks with query params', async () => {
      const { fetch, calls } = mockFetch({
        body: { data: [hookFixture] },
      });
      const client = createClient(fetch);

      const hooks = await client.hooks.list({
        status: 'failed',
        limit: 50,
        sortOrder: 'DESC',
      });

      expect(hooks).toHaveLength(1);
      const url = new URL(calls[0].url);
      expect(url.pathname).toBe('/v1/hooks');
      expect(url.searchParams.get('status')).toBe('failed');
      expect(url.searchParams.get('limit')).toBe('50');
      expect(url.searchParams.get('sortOrder')).toBe('DESC');
    });

    it('works without params', async () => {
      const { fetch, calls } = mockFetch({
        body: { data: [] },
      });
      const client = createClient(fetch);

      const hooks = await client.hooks.list();

      expect(hooks).toEqual([]);
      const url = new URL(calls[0].url);
      expect(url.pathname).toBe('/v1/hooks');
      expect(url.search).toBe('');
    });

    it('passes pagination params', async () => {
      const { fetch, calls } = mockFetch({
        body: { data: [] },
      });
      const client = createClient(fetch);

      await client.hooks.list({
        postAtAfter: '2025-01-15T10:00:00Z',
        limit: 25,
      });

      const url = new URL(calls[0].url);
      expect(url.searchParams.get('postAtAfter')).toBe(
        '2025-01-15T10:00:00Z',
      );
      expect(url.searchParams.get('limit')).toBe('25');
    });
  });

  describe('delete', () => {
    it('throws on empty id', async () => {
      const { fetch } = mockFetch({ body: { data: {} } });
      const client = createClient(fetch);
      await expect(client.hooks.delete('')).rejects.toThrow(
        'hook id is required',
      );
    });

    it('sends DELETE to /v1/hooks/{id}', async () => {
      const { fetch, calls } = mockFetch({ body: { data: {} } });
      const client = createClient(fetch);

      await client.hooks.delete(hookFixture.id);

      expect(calls[0].init.method).toBe('DELETE');
      expect(calls[0].url).toContain(`/v1/hooks/${hookFixture.id}`);
    });

    it('swallows 404 errors', async () => {
      const { fetch } = mockFetch({
        status: 404,
        body: { error: 'not found' },
      });
      const client = createClient(fetch);

      // Should not throw
      await client.hooks.delete('already-gone-id');
    });
  });

  describe('bulk', () => {
    it('posts retry with hookIDs', async () => {
      const { fetch, calls } = mockFetch({
        body: {
          data: { affected: 2 },
        },
      });
      const client = createClient(fetch);

      const result = await client.hooks.bulk.retry({
        hookIDs: ['id-1', 'id-2'],
      });

      expect(result.affected).toBe(2);
      expect(calls[0].url).toContain('/v1/hooks/bulk/retry');
      const body = JSON.parse(calls[0].init.body as string);
      expect(body.hookIDs).toEqual(['id-1', 'id-2']);
      expect(body.projectID).toBeUndefined();
    });

    it('posts replay with filter params', async () => {
      const { fetch, calls } = mockFetch({
        body: {
          data: { affected: 5 },
        },
      });
      const client = createClient(fetch);

      const result = await client.hooks.bulk.replay({
        startTime: '2025-01-01T00:00:00Z',
        endTime: '2025-01-02T00:00:00Z',
        limit: 100,
      });

      expect(result.affected).toBe(5);
      const body = JSON.parse(calls[0].init.body as string);
      expect(body.startTime).toBe('2025-01-01T00:00:00Z');
      expect(body.endTime).toBe('2025-01-02T00:00:00Z');
      expect(body.limit).toBe(100);
      expect(body.hookIDs).toBeUndefined();
    });

    it('posts cancel', async () => {
      const { fetch, calls } = mockFetch({
        body: {
          data: { affected: 3 },
        },
      });
      const client = createClient(fetch);

      await client.hooks.bulk.cancel({
        hookIDs: ['id-1'],
      });

      expect(calls[0].url).toContain('/v1/hooks/bulk/cancel');
    });
  });

  describe('listAll', () => {
    it('yields all hooks across pages using cursor pagination', async () => {
      const hook2 = {
        ...hookFixture,
        id: 'hook-page-2',
        postAt: '2025-01-16T10:00:00Z',
      };
      const { fetch, calls } = mockFetchSequence([
        { body: { data: [hookFixture, hookFixture] } },
        { body: { data: [hook2] } },
      ]);
      const client = createClient(fetch);

      const hooks = [];
      for await (const hook of client.hooks.listAll({
        status: 'failed',
        pageSize: 2,
      })) {
        hooks.push(hook);
      }

      expect(hooks).toHaveLength(3);
      expect(hooks[0].id).toBe(hookFixture.id);
      expect(hooks[2].id).toBe('hook-page-2');
      expect(calls).toHaveLength(2);

      // First request: no cursor yet
      const url1 = new URL(calls[0].url);
      expect(url1.searchParams.get('sortBy')).toBe('postAt');
      expect(url1.searchParams.get('sortOrder')).toBe('ASC');
      expect(url1.searchParams.get('status')).toBe('failed');
      expect(url1.searchParams.has('postAtAfter')).toBe(false);

      // Second request: cursor from last hook's postAt
      const url2 = new URL(calls[1].url);
      expect(url2.searchParams.get('postAtAfter')).toBe(hookFixture.postAt);
      expect(url2.searchParams.get('sortBy')).toBe('postAt');
      expect(url2.searchParams.get('sortOrder')).toBe('ASC');
    });

    it('handles empty result', async () => {
      const { fetch } = mockFetch({ body: { data: [] } });
      const client = createClient(fetch);

      const hooks = [];
      for await (const hook of client.hooks.listAll()) {
        hooks.push(hook);
      }

      expect(hooks).toHaveLength(0);
    });

    it('stops on short page', async () => {
      const { fetch, calls } = mockFetch({
        body: { data: [hookFixture] },
      });
      const client = createClient(fetch);

      const hooks = [];
      for await (const hook of client.hooks.listAll({ pageSize: 100 })) {
        hooks.push(hook);
      }

      expect(hooks).toHaveLength(1);
      expect(calls).toHaveLength(1);
    });

    it('passes initial postAtAfter as start cursor', async () => {
      const { fetch, calls } = mockFetch({ body: { data: [] } });
      const client = createClient(fetch);

      const hooks = [];
      for await (const hook of client.hooks.listAll({
        postAtAfter: '2025-01-01T00:00:00Z',
      })) {
        hooks.push(hook);
      }

      const url = new URL(calls[0].url);
      expect(url.searchParams.get('postAtAfter')).toBe(
        '2025-01-01T00:00:00Z',
      );
    });
  });
});
