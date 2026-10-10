import fastifyJwt from '@fastify/jwt';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../env';
import { ForbiddenError, UnauthorizedError } from '../shared/errors';
import type { Role } from '../shared/roles';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: Role };
    user: { id: string; role: Role };
  }
}

export const authPlugin = fp(
  async (app) => {
    await app.register(fastifyJwt, {
      secret: env.JWT_SECRET,
      formatUser: (payload) => ({ id: payload.sub, role: payload.role }),
    });
  },
  { name: 'auth' },
);

export async function authenticate(request: FastifyRequest) {
  try {
    await request.jwtVerify();
  } catch {
    throw new UnauthorizedError('Missing or invalid access token');
  }
}

export function requireRole(...allowed: Role[]) {
  return async (request: FastifyRequest) => {
    if (!allowed.includes(request.user.role)) {
      throw new ForbiddenError('Role not allowed to access this resource');
    }
  };
}
