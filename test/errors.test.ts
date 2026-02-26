import { describe, it, expect } from 'vitest';
import {
  PosthookError,
  BadRequestError,
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  RateLimitError,
  InternalServerError,
  ConnectionError,
  SignatureVerificationError,
  createError,
} from '../src/errors.js';

describe('Error classes', () => {
  describe('createError factory', () => {
    it('creates BadRequestError for 400', () => {
      const err = createError(400, 'bad request');
      expect(err).toBeInstanceOf(BadRequestError);
      expect(err).toBeInstanceOf(PosthookError);
      expect(err.status).toBe(400);
      expect(err.code).toBe('bad_request');
      expect(err.message).toBe('bad request');
    });

    it('creates AuthenticationError for 401', () => {
      const err = createError(401, 'not authorized');
      expect(err).toBeInstanceOf(AuthenticationError);
      expect(err.status).toBe(401);
      expect(err.code).toBe('authentication_error');
    });

    it('creates ForbiddenError for 403', () => {
      const err = createError(403, 'forbidden');
      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err.status).toBe(403);
      expect(err.code).toBe('forbidden');
    });

    it('creates NotFoundError for 404', () => {
      const err = createError(404, 'not found');
      expect(err).toBeInstanceOf(NotFoundError);
      expect(err.status).toBe(404);
      expect(err.code).toBe('not_found');
    });

    it('creates PayloadTooLargeError for 413', () => {
      const err = createError(413, 'payload too large');
      expect(err).toBeInstanceOf(PayloadTooLargeError);
      expect(err.status).toBe(413);
      expect(err.code).toBe('payload_too_large');
    });

    it('creates RateLimitError for 429', () => {
      const err = createError(429, 'rate limit');
      expect(err).toBeInstanceOf(RateLimitError);
      expect(err.status).toBe(429);
      expect(err.code).toBe('rate_limit_exceeded');
    });

    it('creates InternalServerError for 500', () => {
      const err = createError(500, 'internal error');
      expect(err).toBeInstanceOf(InternalServerError);
      expect(err.status).toBe(500);
      expect(err.code).toBe('internal_error');
    });

    it('creates InternalServerError for 502', () => {
      const err = createError(502, 'bad gateway');
      expect(err).toBeInstanceOf(InternalServerError);
      expect(err.status).toBe(502);
    });

    it('creates InternalServerError for 503', () => {
      const err = createError(503, 'service unavailable');
      expect(err).toBeInstanceOf(InternalServerError);
      expect(err.status).toBe(503);
    });

    it('creates generic PosthookError for unknown status', () => {
      const err = createError(418, "i'm a teapot");
      expect(err).toBeInstanceOf(PosthookError);
      expect(err.status).toBe(418);
      expect(err.code).toBe('unknown_error');
    });

    it('preserves response headers', () => {
      const headers = new Headers({ 'X-Request-Id': 'abc' });
      const err = createError(400, 'bad request', headers);
      expect(err.headers?.get('X-Request-Id')).toBe('abc');
    });
  });

  describe('instanceof checks', () => {
    it('all errors are instanceof PosthookError', () => {
      expect(new BadRequestError('test')).toBeInstanceOf(PosthookError);
      expect(new AuthenticationError('test')).toBeInstanceOf(PosthookError);
      expect(new ForbiddenError('test')).toBeInstanceOf(PosthookError);
      expect(new NotFoundError('test')).toBeInstanceOf(PosthookError);
      expect(new PayloadTooLargeError('test')).toBeInstanceOf(PosthookError);
      expect(new RateLimitError('test')).toBeInstanceOf(PosthookError);
      expect(new InternalServerError('test', 500)).toBeInstanceOf(
        PosthookError,
      );
      expect(new ConnectionError('test')).toBeInstanceOf(PosthookError);
      expect(new SignatureVerificationError('test')).toBeInstanceOf(
        PosthookError,
      );
    });

    it('all errors are instanceof Error', () => {
      expect(new PosthookError('test', 400, 'test')).toBeInstanceOf(Error);
      expect(new ConnectionError('test')).toBeInstanceOf(Error);
    });
  });

  describe('error properties', () => {
    it('ConnectionError has no status', () => {
      const err = new ConnectionError('network failed');
      expect(err.status).toBeUndefined();
      expect(err.code).toBe('connection_error');
    });

    it('SignatureVerificationError has no status', () => {
      const err = new SignatureVerificationError('invalid sig');
      expect(err.status).toBeUndefined();
      expect(err.code).toBe('signature_verification_error');
    });

    it('error name matches class name', () => {
      expect(new BadRequestError('test').name).toBe('BadRequestError');
      expect(new AuthenticationError('test').name).toBe(
        'AuthenticationError',
      );
      expect(new ConnectionError('test').name).toBe('ConnectionError');
    });
  });
});
