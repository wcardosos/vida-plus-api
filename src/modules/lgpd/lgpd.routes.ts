import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authenticate, requireRole } from '../../plugins/auth';
import { errorResponseSchema } from '../../shared/error-response';
import {
  consentParamsSchema,
  consentResponseSchema,
  grantConsentBodySchema,
  revokedConsentResponseSchema,
  toConsentResponse,
  toRevokedConsentResponse,
} from './lgpd.schemas';
import type { LgpdService } from './services/lgpd.service';

const tags = ['lgpd'];
const security = [{ bearerAuth: [] }];

export function lgpdRoutes(lgpdService: LgpdService): FastifyPluginAsync {
  return async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.get(
      '/me/consents',
      {
        onRequest: authenticate,
        preHandler: requireRole('PATIENT'),
        schema: {
          tags,
          summary: 'Consents of the authenticated patient, active and revoked, newest first',
          security,
          response: { 200: z.array(consentResponseSchema), 401: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema },
        },
      },
      async (request) => (await lgpdService.listOwnConsents(request.user.id)).map(toConsentResponse),
    );

    app.post(
      '/me/consents',
      {
        onRequest: authenticate,
        preHandler: requireRole('PATIENT'),
        schema: {
          tags,
          summary: 'Grant a consent for a purpose under the current terms version; fails while one is active for that purpose',
          security,
          body: grantConsentBodySchema,
          response: {
            201: consentResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            409: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const consent = await lgpdService.grantOwnConsent(request.user.id, request.body.purpose);
        reply.code(201);
        return toConsentResponse(consent);
      },
    );

    app.post(
      '/me/consents/:consentId/revoke',
      {
        onRequest: authenticate,
        preHandler: requireRole('PATIENT'),
        schema: {
          tags,
          summary: 'Revoke an active consent; revoking the teleconsultation consent cancels the future teleconsultations of the patient',
          security,
          params: consentParamsSchema,
          response: {
            200: revokedConsentResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request) => toRevokedConsentResponse(await lgpdService.revokeOwnConsent(request.user.id, request.params.consentId)),
    );
  };
}
