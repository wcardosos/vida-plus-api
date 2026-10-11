import type { Database } from '../../db/client';
import type { AuthService } from '../auth/services/auth.service';
import type { UnitsService } from '../units/services/units.service';
import { professionalsRoutes } from './professionals.routes';
import { createProfessionalRepository } from './repositories/professional.repository';
import { createProfessionalsService } from './services/professionals.service';

export function createProfessionalsModule(deps: { db: Database; auth: AuthService; units: UnitsService }) {
  const service = createProfessionalsService({
    db: deps.db,
    professionals: createProfessionalRepository(deps.db),
    auth: deps.auth,
    units: deps.units,
  });
  return { service, routes: professionalsRoutes(service) };
}
