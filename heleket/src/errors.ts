/**
 * Base class for every error thrown by the SDK. Catch this to handle any
 * SDK-originated failure generically.
 */
export class HeleketError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/**
 * Thrown when Heleket responds with state != 0 (a business error). Carries
 * the HTTP status and raw response body so callers can log or surface the
 * exact server reply.
 */
export class ApiError extends HeleketError {
  readonly httpStatus: number;
  readonly rawBody: string;

  constructor(message: string, httpStatus: number, rawBody: string = '', options?: ErrorOptions) {
    super(message, options);
    this.httpStatus = httpStatus;
    this.rawBody = rawBody;
  }
}

/**
 * Thrown when Heleket responds with HTTP 422 and a field-level errors map.
 * Use `.fields` to surface validation messages back to the caller.
 */
export class ValidationError extends ApiError {
  readonly fields: Record<string, string[]>;

  constructor(
    message: string,
    httpStatus: number,
    fields: Record<string, string[]>,
    rawBody: string = '',
    options?: ErrorOptions,
  ) {
    super(message, httpStatus, rawBody, options);
    this.fields = fields;
  }
}

/**
 * Thrown when the HTTP transport itself fails (DNS, TCP, TLS, timeout).
 * The API was never reached, or no response was received.
 */
export class HttpError extends HeleketError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/**
 * Thrown by WebhookVerifier when the signature does not match. Treat as a
 * hard security failure — never trust the payload contents in this case.
 */
export class SignatureError extends HeleketError {
  readonly reason: string;

  constructor(reason: string) {
    super(`heleket signature error: ${reason}`);
    this.reason = reason;
  }
}
