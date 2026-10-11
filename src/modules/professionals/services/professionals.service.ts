import type { Database, Transaction } from '../../../db/client';
import { ConflictError, DomainError, NotFoundError } from '../../../shared/errors';
import type { Role } from '../../../shared/roles';
import type { AuthService } from '../../auth/services/auth.service';
import type { Unit } from '../../units/entities/unit.entity';
import type { UnitsService } from '../../units/services/units.service';
import {
  CouncilRegistration,
  Professional,
  type CouncilRegistrationInput,
  type ProfessionalCategory,
  type UpdateProfessionalProps,
} from '../entities/professional.entity';
import type { Pagination, ProfessionalRepository, ProfessionalWithAccount } from '../repositories/professional.repository';

export type CreateProfessionalInput = {
  name: string;
  email: string;
  category: ProfessionalCategory;
  registration: CouncilRegistrationInput;
  specialty?: string | null;
  unitIds: string[];
};

export type UpdateProfessionalInput = UpdateProfessionalProps & {
  email?: string;
};

export type ListProfessionalsInput = {
  unitId?: string;
  category?: ProfessionalCategory;
  specialty?: string;
  includeInactive?: boolean;
};

export type ProfessionalViewer = {
  role: Role;
};

export type ProfessionalDetails = ProfessionalWithAccount & {
  units: Unit[];
};

export type PendingAppointment = {
  id: string;
  startsAt: string;
};

export type ProfessionalPendency = {
  type: string;
  count: number;
  appointments?: PendingAppointment[];
};

export type ProfessionalPendencyTarget = {
  professionalId: string;
  unitId?: string;
};

export type ProfessionalPendencyCheck = (target: ProfessionalPendencyTarget, tx: Transaction) => Promise<ProfessionalPendency | null>;

export type ProfessionalsService = ReturnType<typeof createProfessionalsService>;

export function createProfessionalsService(deps: {
  db: Database;
  professionals: ProfessionalRepository;
  auth: AuthService;
  units: UnitsService;
}) {
  const { db, professionals, auth, units } = deps;
  const pendencyChecks: ProfessionalPendencyCheck[] = [];

  function registerPendencyCheck(check: ProfessionalPendencyCheck): void {
    pendencyChecks.push(check);
  }

  async function ensureNoPendencies(target: ProfessionalPendencyTarget, message: string, tx: Transaction): Promise<void> {
    const pendencies: ProfessionalPendency[] = [];
    for (const check of pendencyChecks) {
      const pendency = await check(target, tx);
      if (pendency && pendency.count > 0) {
        pendencies.push(pendency);
      }
    }
    if (pendencies.length > 0) {
      throw new DomainError(message, { pendencies });
    }
  }

  function isAdmin(viewer: ProfessionalViewer): boolean {
    return viewer.role === 'ADMIN';
  }

  async function ensureActiveUnit(unitId: string, tx: Transaction): Promise<void> {
    try {
      await units.getActiveById(unitId, tx);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new DomainError(`Unit ${unitId} does not exist`);
      }
      throw error;
    }
  }

  async function withDetails(items: ProfessionalWithAccount[], onlyActiveUnits = false): Promise<ProfessionalDetails[]> {
    const linked = await units.listByIds(items.flatMap(({ professional }) => professional.unitIds));
    const byId = new Map(linked.map((unit) => [unit.id, unit]));
    return items.map((item) => ({
      ...item,
      units: item.professional.unitIds
        .map((unitId) => byId.get(unitId))
        .filter((unit): unit is Unit => unit !== undefined && (!onlyActiveUnits || unit.isActive())),
    }));
  }

  async function withAccount(professional: Professional, tx?: Transaction): Promise<ProfessionalWithAccount> {
    const user = await auth.getUser(professional.userId, tx);
    return { professional, account: { email: user.email, active: user.active } };
  }

  async function loadForUpdate(id: string, tx: Transaction): Promise<Professional> {
    const professional = await professionals.findByIdForUpdate(id, tx);
    if (!professional) {
      throw new NotFoundError('Professional not found');
    }
    return professional;
  }

  async function create(input: CreateProfessionalInput): Promise<ProfessionalDetails> {
    const now = new Date();
    const created = await db.transaction(async (tx) => {
      const registration = CouncilRegistration.create(input.registration, input.category);
      if (await professionals.existsByRegistration(registration, undefined, tx)) {
        throw new ConflictError('Council registration is already in use');
      }
      for (const unitId of new Set(input.unitIds)) {
        await ensureActiveUnit(unitId, tx);
      }

      const user = await auth.createUser({ email: input.email, role: 'PROFESSIONAL' }, tx);
      const professional = Professional.create(
        {
          userId: user.id,
          name: input.name,
          category: input.category,
          registration: input.registration,
          specialty: input.specialty,
          unitIds: input.unitIds,
        },
        now,
      );
      await professionals.insert(professional, tx);
      return { professional, account: { email: user.email, active: user.active } };
    });

    await auth.issuePasswordSetup(created.professional.userId);
    const [details] = await withDetails([created]);
    return details;
  }

  async function getById(id: string): Promise<ProfessionalDetails> {
    const professional = await professionals.findById(id);
    if (!professional) {
      throw new NotFoundError('Professional not found');
    }
    const [details] = await withDetails([await withAccount(professional)]);
    return details;
  }

  async function getByUserId(userId: string): Promise<ProfessionalDetails> {
    const professional = await professionals.findByUserId(userId);
    if (!professional) {
      throw new NotFoundError('Professional not found');
    }
    const [details] = await withDetails([await withAccount(professional)]);
    return details;
  }

  async function update(id: string, changes: UpdateProfessionalInput): Promise<ProfessionalDetails> {
    const updated = await db.transaction(async (tx) => {
      const professional = await loadForUpdate(id, tx);
      const previousRegistration = professional.registration;
      professional.update(changes);

      if (!professional.registration.equals(previousRegistration) && (await professionals.existsByRegistration(professional.registration, professional.id, tx))) {
        throw new ConflictError('Council registration is already in use');
      }
      if (changes.email !== undefined) {
        await auth.updateEmail(professional.userId, changes.email, tx);
      }
      await professionals.update(professional, tx);
      return withAccount(professional, tx);
    });

    const [details] = await withDetails([updated]);
    return details;
  }

  async function linkUnit(id: string, unitId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const professional = await loadForUpdate(id, tx);
      if (professional.isLinkedTo(unitId)) {
        throw new ConflictError('Professional is already linked to this unit');
      }
      await ensureActiveUnit(unitId, tx);
      professional.linkUnit(unitId);
      await professionals.update(professional, tx);
    });
  }

  async function unlinkUnit(id: string, unitId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const professional = await loadForUpdate(id, tx);
      if (!professional.isLinkedTo(unitId)) {
        throw new NotFoundError('Professional is not linked to this unit');
      }
      professional.unlinkUnit(unitId);
      await ensureNoPendencies({ professionalId: id, unitId }, 'Professional has pendencies in this unit that prevent the unlinking', tx);
      await professionals.update(professional, tx);
    });
  }

  async function setActive(id: string, active: boolean): Promise<void> {
    await db.transaction(async (tx) => {
      const professional = await professionals.findById(id, tx);
      if (!professional) {
        throw new NotFoundError('Professional not found');
      }
      if (active) {
        await auth.activate(professional.userId, tx);
      } else {
        await ensureNoPendencies({ professionalId: id }, 'Professional has pendencies that prevent the deactivation', tx);
        await auth.deactivate(professional.userId, tx);
      }
    });
  }

  async function deactivate(id: string): Promise<void> {
    await setActive(id, false);
  }

  async function activate(id: string): Promise<void> {
    await setActive(id, true);
  }

  async function list(viewer: ProfessionalViewer, input: ListProfessionalsInput, pagination: Pagination) {
    const { includeInactive, ...filters } = input;
    const active = isAdmin(viewer) && includeInactive ? undefined : true;
    const { items, total } = await professionals.findMany({ ...filters, active }, pagination);
    return { items: await withDetails(items, !isAdmin(viewer)), total };
  }

  async function listByIds(ids: string[]): Promise<Professional[]> {
    return professionals.findByIds([...new Set(ids)]);
  }

  return { registerPendencyCheck, create, getById, getByUserId, update, linkUnit, unlinkUnit, deactivate, activate, list, listByIds };
}
