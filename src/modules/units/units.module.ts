import type { Database } from '../../db/client';
import { createUnitRepository } from './repositories/unit.repository';
import { createUnitsService } from './services/units.service';
import { unitsRoutes } from './units.routes';

export function createUnitsModule(deps: { db: Database }) {
  const service = createUnitsService({ db: deps.db, units: createUnitRepository(deps.db) });
  return { service, routes: unitsRoutes(service) };
}
