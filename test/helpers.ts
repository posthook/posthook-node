/**
 * Creates a mock fetch function that returns configurable responses.
 */
export function mockFetch(options?: {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}): {
  fetch: typeof globalThis.fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const status = options?.status ?? 200;
  const body = options?.body ?? { data: null };
  const headers = new Headers(options?.headers ?? {});
  headers.set('content-type', 'application/json');

  const fetchFn = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init: init ?? {} });

    return new Response(JSON.stringify(body), {
      status,
      headers,
    });
  };

  return { fetch: fetchFn as typeof globalThis.fetch, calls };
}

/**
 * Creates a mock fetch that returns different responses for sequential calls.
 */
export function mockFetchSequence(
  responses: Array<{
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
    networkError?: boolean;
  }>,
): {
  fetch: typeof globalThis.fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  let callIndex = 0;

  const fetchFn = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init: init ?? {} });

    const responseConfig = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;

    if (responseConfig.networkError) {
      throw new TypeError('fetch failed');
    }

    const status = responseConfig.status ?? 200;
    const body = responseConfig.body ?? { data: null };
    const headers = new Headers(responseConfig.headers ?? {});
    headers.set('content-type', 'application/json');

    return new Response(JSON.stringify(body), { status, headers });
  };

  return { fetch: fetchFn as typeof globalThis.fetch, calls };
}

/** Standard hook fixture for tests. */
export const hookFixture = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  path: '/webhooks/test',
  data: { event: 'test' },
  postAt: '2025-01-15T10:00:00Z',
  status: 'pending',
  postDurationSeconds: 0,
  attempts: 0,
  createdAt: '2025-01-15T09:55:00Z',
  updatedAt: '2025-01-15T09:55:00Z',
};
