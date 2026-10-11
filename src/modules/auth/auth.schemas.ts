import { z } from 'zod';
import { roles } from '../../shared/roles';
import { Email, type User } from './entities/user.entity';

export const roleSchema = z.enum(roles).meta({ id: 'Role' });

export const emailSchema = z.email().max(Email.maxLength);

export const passwordSchema = z.string().min(8).max(128);

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const accessTokenResponseSchema = z
  .object({
    accessToken: z.string(),
    tokenType: z.literal('Bearer'),
    expiresIn: z.number().int().describe('Seconds until the access token expires'),
  })
  .meta({ id: 'AccessToken' });

export const forgotPasswordBodySchema = z.object({
  email: emailSchema,
});

export const resetPasswordBodySchema = z.object({
  token: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid password reset token')
    .describe('Token received in the password reset link'),
  password: passwordSchema,
});

export const userResponseSchema = z
  .object({
    id: z.uuid(),
    email: z.string(),
    role: roleSchema,
    active: z.boolean(),
    lastLoginAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'User' });

export function toUserResponse(user: User): z.infer<typeof userResponseSchema> {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    active: user.active,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}
