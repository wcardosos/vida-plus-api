import type { Database } from '../../db/client';
import { createLgpdConsentRepository } from './repositories/lgpd-consent.repository';
import { createLgpdService } from './services/lgpd.service';

export function createLgpdModule(deps: { db: Database }) {
  const service = createLgpdService({ consents: createLgpdConsentRepository(deps.db) });
  return { service };
}
