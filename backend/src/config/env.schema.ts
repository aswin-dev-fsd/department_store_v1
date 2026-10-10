import { z } from 'zod';

const DEV_FRONTEND_ORIGIN = 'http://localhost:5173';

const postgresUrl = z.url({
  protocol: /^postgres(ql)?$/,
  error: 'must be a postgres:// or postgresql:// URL',
});

const booleanString = z
  .enum(['true', 'false'], { error: 'must be "true" or "false"' })
  .transform((value) => value === 'true');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: postgresUrl,
  // Only the test suite needs this; deployed servers don't set it
  TEST_DATABASE_URL: postgresUrl.optional(),
  // Comma-separated allow-list
  CORS_ORIGIN: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(12),
  COOKIE_SECURE: booleanString.default(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = Omit<z.output<typeof EnvSchema>, 'CORS_ORIGIN'> & { CORS_ORIGIN: string[] };

/**
 * Validate environment variables. Throws one error listing every problem by variable name;
 * values are never included, because they may be secrets.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw invalidEnv(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const raw = result.data;
  const corsOrigins = (
    raw.CORS_ORIGIN ?? (raw.NODE_ENV === 'production' ? '' : DEV_FRONTEND_ORIGIN)
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (raw.NODE_ENV === 'production') {
    // DreamLand §9: explicit CORS allow-list, never "*", HTTPS-only cookies
    const problems: string[] = [];
    if (corsOrigins.length === 0) problems.push('CORS_ORIGIN: required in production');
    if (corsOrigins.includes('*')) problems.push('CORS_ORIGIN: "*" is not allowed in production');
    if (!raw.COOKIE_SECURE) problems.push('COOKIE_SECURE: must be "true" in production');
    if (problems.length > 0) throw invalidEnv(problems);
  }

  return { ...raw, CORS_ORIGIN: corsOrigins };
}

function invalidEnv(problems: string[]): Error {
  return new Error(`Invalid environment variables:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
}
