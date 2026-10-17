import type { Database } from '../../db/client';
import { lgpdRoutes } from './lgpd.routes';
import { createLgpdConsentRepository } from './repositories/lgpd-consent.repository';
import { createLgpdService, type LgpdServiceConfig } from './services/lgpd.service';

export function createLgpdModule(deps: { db: Database; clock?: () => Date; config: LgpdServiceConfig }) {
  const service = createLgpdService({
    db: deps.db,
    consents: createLgpdConsentRepository(deps.db),
    clock: deps.clock ?? (() => new Date()),
    config: deps.config,
  });
  return { service, routes: lgpdRoutes(service) };
}
