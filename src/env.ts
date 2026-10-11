import { z } from 'zod';

const durationUnits = { ms: 1, s: 1_000, min: 60_000, h: 3_600_000, d: 86_400_000 } as const;

const duration = z
  .string()
  .regex(/^[1-9]\d*(ms|s|min|h|d)$/, 'must be a positive duration such as 30min or 1h')
  .transform((value) => {
    const [, amount, unit] = /^(\d+)(\w+)$/.exec(value)!;
    return Number(amount) * durationUnits[unit as keyof typeof durationUnits];
  });

const timeZone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'must be a valid IANA time zone such as America/Fortaleza');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  TRUST_PROXY: z.stringbool().default(false),
  DATABASE_URL: z.url(),
  APP_URL: z.url().default('http://localhost:3000'),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: duration.prefault('1h'),
  RESET_TOKEN_TTL: duration.prefault('30min'),
  PASSWORD_SETUP_TOKEN_TTL: duration.prefault('72h'),
  APP_TIMEZONE: timeZone.default('America/Fortaleza'),
  TERMS_VERSION: z.string().trim().min(1).max(20).default('2026-10'),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW: duration.prefault('15min'),
  SEED_ADMIN_EMAIL: z.email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).max(128).optional(),
});

export const env = envSchema.parse(process.env);
