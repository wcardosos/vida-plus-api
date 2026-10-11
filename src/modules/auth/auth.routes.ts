import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '../../env';
import { authenticate } from '../../plugins/auth';
import { errorResponseSchema } from '../../shared/error-response';
import {
  accessTokenResponseSchema,
  forgotPasswordBodySchema,
  loginBodySchema,
  resetPasswordBodySchema,
  toUserResponse,
  userResponseSchema,
} from './auth.schemas';
import type { AuthService } from './auth.service';

const authRateLimit = { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: env.AUTH_RATE_LIMIT_WINDOW };

export function authRoutes(authService: AuthService): FastifyPluginAsync {
  return async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.post(
      '/auth/login',
      {
        config: { rateLimit: authRateLimit },
        schema: {
          tags: ['auth'],
          summary: 'Exchange email and password for an access token',
          body: loginBodySchema,
          response: {
            200: accessTokenResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            422: errorResponseSchema,
            429: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const user = await authService.login(request.body);
        const accessToken = await reply.jwtSign({ sub: user.id, role: user.role });
        return { accessToken, tokenType: 'Bearer' as const, expiresIn: Math.floor(env.JWT_EXPIRES_IN / 1000) };
      },
    );

    app.post(
      '/auth/logout',
      {
        onRequest: authenticate,
        schema: {
          tags: ['auth'],
          summary: 'Log out; the client must discard its token, which stays valid until it expires',
          security: [{ bearerAuth: [] }],
          response: { 204: z.undefined(), 401: errorResponseSchema },
        },
      },
      async (_request, reply) => {
        reply.code(204).send();
      },
    );

    app.get(
      '/auth/me',
      {
        onRequest: authenticate,
        schema: {
          tags: ['auth'],
          summary: 'Get the authenticated user',
          security: [{ bearerAuth: [] }],
          response: { 200: userResponseSchema, 401: errorResponseSchema },
        },
      },
      async (request) => toUserResponse(await authService.getUser(request.user.id)),
    );

    app.post(
      '/auth/password/forgot',
      {
        config: { rateLimit: authRateLimit },
        schema: {
          tags: ['auth'],
          summary: 'Request a password reset link by email; the response does not reveal whether the email exists',
          body: forgotPasswordBodySchema,
          response: { 202: z.undefined(), 400: errorResponseSchema, 429: errorResponseSchema },
        },
      },
      async (request, reply) => {
        await authService.requestPasswordReset(request.body.email);
        reply.code(202).send();
      },
    );

    app.post(
      '/auth/password/reset',
      {
        schema: {
          tags: ['auth'],
          summary: 'Set a new password using a password reset token',
          body: resetPasswordBodySchema,
          response: { 204: z.undefined(), 400: errorResponseSchema, 422: errorResponseSchema },
        },
      },
      async (request, reply) => {
        await authService.resetPassword(request.body);
        reply.code(204).send();
      },
    );
  };
}
