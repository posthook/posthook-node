/**
 * Base error class for all Posthook SDK errors.
 */
export class PosthookError extends Error {
  /** HTTP status code, if applicable. */
  readonly status: number | undefined;
  /** Error code string. */
  readonly code: string;
  /** Response headers, if from an HTTP response. */
  readonly headers: Headers | undefined;

  constructor(
    message: string,
    status: number | undefined,
    code: string,
    headers?: Headers,
  ) {
    super(message);
    this.name = 'PosthookError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export class BadRequestError extends PosthookError {
  constructor(message: string, headers?: Headers) {
    super(message, 400, 'bad_request', headers);
    this.name = 'BadRequestError';
  }
}

export class AuthenticationError extends PosthookError {
  constructor(message: string, headers?: Headers) {
    super(message, 401, 'authentication_error', headers);
    this.name = 'AuthenticationError';
  }
}

export class ForbiddenError extends PosthookError {
  constructor(message: string, headers?: Headers) {
    super(message, 403, 'forbidden', headers);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends PosthookError {
  constructor(message: string, headers?: Headers) {
    super(message, 404, 'not_found', headers);
    this.name = 'NotFoundError';
  }
}

export class PayloadTooLargeError extends PosthookError {
  constructor(message: string, headers?: Headers) {
    super(message, 413, 'payload_too_large', headers);
    this.name = 'PayloadTooLargeError';
  }
}

export class RateLimitError extends PosthookError {
  constructor(message: string, headers?: Headers) {
    super(message, 429, 'rate_limit_exceeded', headers);
    this.name = 'RateLimitError';
  }
}

export class InternalServerError extends PosthookError {
  constructor(message: string, status: number, headers?: Headers) {
    super(message, status, 'internal_error', headers);
    this.name = 'InternalServerError';
  }
}

export class ConnectionError extends PosthookError {
  constructor(message: string) {
    super(message, undefined, 'connection_error');
    this.name = 'ConnectionError';
  }
}

export class SignatureVerificationError extends PosthookError {
  constructor(message: string) {
    super(message, undefined, 'signature_verification_error');
    this.name = 'SignatureVerificationError';
  }
}

/**
 * Creates the appropriate error subclass from an HTTP status and message.
 */
export function createError(
  status: number,
  message: string,
  headers?: Headers,
): PosthookError {
  switch (status) {
    case 400:
      return new BadRequestError(message, headers);
    case 401:
      return new AuthenticationError(message, headers);
    case 403:
      return new ForbiddenError(message, headers);
    case 404:
      return new NotFoundError(message, headers);
    case 413:
      return new PayloadTooLargeError(message, headers);
    case 429:
      return new RateLimitError(message, headers);
    default:
      if (status >= 500) {
        return new InternalServerError(message, status, headers);
      }
      return new PosthookError(message, status, 'unknown_error', headers);
  }
}
