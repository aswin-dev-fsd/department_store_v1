import type { Request, RequestHandler } from 'express';
import {
  ipKeyGenerator,
  rateLimit,
  type AugmentedRequest,
  type Logger,
  type Options,
} from 'express-rate-limit';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const MINUTE_MS = 60_000;

interface LoginLimit {
  /** Failed logins allowed inside one window; the next attempt is refused. */
  limit: number;
  windowMs: number;
}

/**
 * Failed-login limits (Task 7.1, proposed values).
 * - per IP + username: slows one machine guessing one account's password
 * - per username, any IP: the IP can be spoofed whenever the API is reached directly
 *   (architecture.md §14), so the account also has its own, higher cap
 */
export const LOGIN_LIMITS = Object.freeze({
  perIpAndUsername: Object.freeze({ limit: 10, windowMs: 15 * MINUTE_MS }),
  perUsername: Object.freeze({ limit: 30, windowMs: 60 * MINUTE_MS }),
} satisfies Record<string, LoginLimit>);

/** The username a login attempt names, as the login service matches it (trimmed, any case). */
function attemptedUsername(req: Request): string | undefined {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || !('username' in body)) return undefined;
  const { username } = body;
  if (typeof username !== 'string') return undefined;
  return username.trim().toLowerCase() || undefined;
}

// The library's own warnings (e.g. a misconfigured trust proxy) go to the app log, not the console
const rateLimitLogger: Logger = {
  warn: (error, message) => logger.warn({ err: error }, message ?? 'express-rate-limit warning'),
  error: (error, message) => logger.error({ err: error }, message ?? 'express-rate-limit error'),
};

function retryAfterSeconds(req: Request, windowMs: number): number {
  const resetTime = (req as AugmentedRequest).rateLimit?.resetTime;
  const ms = resetTime ? resetTime.getTime() - Date.now() : windowMs;
  return Math.max(1, Math.ceil(ms / 1000));
}

function limiter(
  { limit, windowMs }: LoginLimit,
  keyGenerator: Options['keyGenerator'],
): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator,
    // Only a refused login (401) counts: successes, 422s and server faults never use up attempts
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401,
    // Nothing to count without a username: the schema answers that request with 422
    skip: (req) => attemptedUsername(req) === undefined,
    // Don't tell a guesser how many tries are left; Retry-After is set on refusal only
    standardHeaders: false,
    legacyHeaders: false,
    logger: rateLimitLogger,
    handler: (req, res, next) => {
      const seconds = retryAfterSeconds(req, windowMs);
      const minutes = Math.ceil(seconds / 60);
      res.setHeader('Retry-After', String(seconds));
      next(
        new AppError(
          'TOO_MANY_ATTEMPTS',
          `Too many failed logins. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
          { retryAfterSeconds: seconds },
          429,
        ),
      );
    },
  });
}

/**
 * Login rate limit: after too many failed logins, POST /auth/login answers 429
 * TOO_MANY_ATTEMPTS (with Retry-After) until the window ends. Counts live in memory, per
 * app instance; each client runs a single API process. Call once per app, at start-up.
 */
export function loginRateLimit(): RequestHandler[] {
  return [
    limiter(
      LOGIN_LIMITS.perIpAndUsername,
      // ipKeyGenerator groups an IPv6 address by its /56, so one host can't rotate addresses
      (req) => `${ipKeyGenerator(req.ip ?? '')}|${attemptedUsername(req) ?? ''}`,
    ),
    limiter(LOGIN_LIMITS.perUsername, (req) => attemptedUsername(req) ?? ''),
  ];
}
