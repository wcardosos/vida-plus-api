import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod';

const tags = [
  'auth',
  'units',
  'patients',
  'professionals',
  'scheduling',
  'medical-records',
  'exams',
  'admissions',
  'notifications',
  'audit',
  'lgpd',
  'reports',
  'health',
];

export const swaggerPlugin = fp(
  async (app) => {
    await app.register(fastifySwagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'Vida Plus API',
          description: 'Healthcare management API: patients, professionals, scheduling, telehealth, medical records, inpatient care and LGPD compliance.',
          version: '1.0.0',
        },
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
        tags: tags.map((name) => ({ name })),
      },
      transform: jsonSchemaTransform,
      transformObject: jsonSchemaTransformObject,
    });

    await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
  },
  { name: 'swagger' },
);
