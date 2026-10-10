import { pino, type DestinationStream, type Logger } from 'pino';
import { env } from '../config/env.js';

// Never log secrets (DreamLand §9). `*.x` covers one level of nesting; the audit log
// (Task 2.6) does its own deep redaction.
const REDACT_PATHS = [
  'password',
  '*.password',
  'token',
  '*.token',
  'req.headers.cookie',
  'req.headers.authorization',
  // Added by Vercel to requests it proxies to us; a bearer-style value, so keep it out of logs
  'req.headers["x-vercel-proxy-signature"]',
  'res.headers["set-cookie"]',
];

/** Create a JSON logger with secrets replaced by "[redacted]". */
export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options = { level, redact: { paths: REDACT_PATHS, censor: '[redacted]' } };
  return destination ? pino(options, destination) : pino(options);
}

/** The app logger (DreamLand §5) — use this instead of console.*. */
export const logger = createLogger(env.LOG_LEVEL);
