import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Posthook } from '../src/client.js';
import { mockFetch } from './helpers.js';

describe('Posthook client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('accepts API key as first argument', () => {
    const { fetch } = mockFetch();
    const client = new Posthook('pk_test_123', { fetch });
    expect(client).toBeDefined();
    expect(client.hooks).toBeDefined();
    expect(client.signatures).toBeDefined();
  });

  it('falls back to POSTHOOK_API_KEY env var', () => {
    process.env.POSTHOOK_API_KEY = 'pk_env_456';
    const { fetch } = mockFetch();
    const client = new Posthook(undefined, { fetch });
    expect(client).toBeDefined();
  });

  it('throws if no API key is provided', () => {
    delete process.env.POSTHOOK_API_KEY;
    expect(() => new Posthook()).toThrow('Posthook API key is required');
  });

  it('accepts custom baseURL', async () => {
    const { fetch, calls } = mockFetch({
      body: { data: [] },
    });
    const client = new Posthook('pk_test', {
      fetch,
      baseURL: 'https://custom.api.com',
    });
    await client.hooks.list();
    expect(calls[0].url).toMatch(/^https:\/\/custom\.api\.com/);
  });

  it('accepts custom timeout', () => {
    const { fetch } = mockFetch();
    const client = new Posthook('pk_test', { fetch, timeout: 5000 });
    expect(client).toBeDefined();
  });

  it('passes signing key to signatures resource', () => {
    const { fetch } = mockFetch();
    const client = new Posthook('pk_test', {
      fetch,
      signingKey: 'sk_test_signing',
    });
    expect(client.signatures).toBeDefined();
  });

  it('reads POSTHOOK_SIGNING_KEY from env', () => {
    process.env.POSTHOOK_SIGNING_KEY = 'sk_env_signing';
    const { fetch } = mockFetch();
    const client = new Posthook('pk_test', { fetch });
    expect(client.signatures).toBeDefined();
  });
});
