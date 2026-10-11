import type { FastifyInstance } from 'fastify';

export const now = new Date('2026-10-11T12:00:00.000Z');

export const monday = '2026-10-12';

export const clock = () => now;

export function localTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00-03:00`);
}

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export function requester(app: FastifyInstance) {
  return (method: Method, url: string, token?: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
}
