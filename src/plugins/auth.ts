import fastifyJwt from '@fastify/jwt';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { env } from '../env';
import { ForbiddenError, UnauthorizedError } from '../shared/errors';
import { roles, type Role } from '../shared/roles';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: Role };
    user: { id: string; role: Role };
  }
}

export type AuthenticatedUserLoader = (userId: string, tokenIssuedAt: Date) => Promise<{ id: string; role: Role } | null>;

declare module 'fastify' {
  interface FastifyInstance {
    loadAuthenticatedUser: AuthenticatedUserLoader;
  }
}

const verifiedClaimsSchema = z.object({
  sub: z.uuid(),
  role: z.enum(roles),
  iat: z.number().int().nonnegative(),
});

export const authPlugin = fp<{ loadAuthenticatedUser: AuthenticatedUserLoader }>(
  async (app, options) => {
    await app.register(fastifyJwt, {
      secret: env.JWT_SECRET,
      sign: { algorithm: 'HS256', expiresIn: `${env.JWT_EXPIRES_IN}ms` },
      verify: { algorithms: ['HS256'] },
    });
    app.decorate('loadAuthenticatedUser', options.loadAuthenticatedUser);
  },
  { name: 'auth' },
);

export async function authenticate(request: FastifyRequest) {
  let claims: z.infer<typeof verifiedClaimsSchema>;
  try {
    claims = verifiedClaimsSchema.parse(await request.jwtVerify());
  } catch {
    throw new UnauthorizedError('Missing or invalid access token');
  }

  const user = await request.server.loadAuthenticatedUser(claims.sub, new Date(claims.iat * 1000));
  if (!user) {
    throw new UnauthorizedError('Missing or invalid access token');
  }
  request.user = user;
}

export function requireRole(...allowed: Role[]) {
  return async (request: FastifyRequest) => {
    if (!allowed.includes(request.user.role)) {
      throw new ForbiddenError('Role not allowed to access this resource');
    }
  };
}
