import { and, asc, desc, eq, gte, inArray, lt, type SQL } from 'drizzle-orm';
import type { Database, DbExecutor } from '../../../db/client';
import type { FieldCipher } from '../../../shared/crypto';
import { PrescriptionItem } from '../entities/prescription-item.entity';
import { Prescription } from '../entities/prescription.entity';
import { prescriptionItems, prescriptions } from '../schema';
import type { Period } from './medical-record-entry.repository';

type PrescriptionRow = typeof prescriptions.$inferSelect;
type PrescriptionItemRow = typeof prescriptionItems.$inferSelect;

export type PrescriptionRepository = ReturnType<typeof createPrescriptionRepository>;

export function createPrescriptionRepository(db: Database, cipher: FieldCipher) {
  function toItem(row: PrescriptionItemRow): PrescriptionItem {
    return PrescriptionItem.restore({
      id: row.id,
      position: row.position,
      medication: cipher.decrypt(row.medication),
      dose: cipher.decrypt(row.dose),
      dosageInstructions: cipher.decrypt(row.dosageInstructions),
      duration: cipher.decrypt(row.duration),
    });
  }

  async function withItems(rows: PrescriptionRow[], executor: DbExecutor): Promise<Prescription[]> {
    if (rows.length === 0) {
      return [];
    }
    const itemRows = await executor
      .select()
      .from(prescriptionItems)
      .where(
        inArray(
          prescriptionItems.prescriptionId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(prescriptionItems.prescriptionId), asc(prescriptionItems.position));
    const itemsOf = new Map<string, PrescriptionItem[]>();
    for (const itemRow of itemRows) {
      itemsOf.set(itemRow.prescriptionId, [...(itemsOf.get(itemRow.prescriptionId) ?? []), toItem(itemRow)]);
    }
    return rows.map((row) =>
      Prescription.restore({
        id: row.id,
        medicalRecordEntryId: row.medicalRecordEntryId,
        patientId: row.patientId,
        prescriberId: row.prescriberId,
        issuedAt: row.issuedAt,
        validUntil: row.validUntil,
        verificationCode: row.verificationCode,
        items: itemsOf.get(row.id) ?? [],
      }),
    );
  }

  return {
    async insert(prescription: Prescription, executor: DbExecutor = db): Promise<void> {
      await executor.insert(prescriptions).values({
        id: prescription.id,
        medicalRecordEntryId: prescription.medicalRecordEntryId,
        patientId: prescription.patientId,
        prescriberId: prescription.prescriberId,
        issuedAt: prescription.issuedAt,
        validUntil: prescription.validUntil,
        verificationCode: prescription.verificationCode,
      });
      await executor.insert(prescriptionItems).values(
        prescription.getItems().map((item) => ({
          id: item.id,
          prescriptionId: prescription.id,
          position: item.position,
          medication: cipher.encrypt(item.medication),
          dose: cipher.encrypt(item.dose),
          dosageInstructions: cipher.encrypt(item.dosageInstructions),
          duration: cipher.encrypt(item.duration),
        })),
      );
    },

    async findById(id: string, executor: DbExecutor = db): Promise<Prescription | null> {
      const rows = await executor.select().from(prescriptions).where(eq(prescriptions.id, id));
      const [prescription] = await withItems(rows, executor);
      return prescription ?? null;
    },

    async findByPatient(patientId: string, period: Period): Promise<Prescription[]> {
      const conditions: SQL[] = [eq(prescriptions.patientId, patientId)];
      if (period.from) conditions.push(gte(prescriptions.issuedAt, period.from));
      if (period.to) conditions.push(lt(prescriptions.issuedAt, period.to));
      const rows = await db
        .select()
        .from(prescriptions)
        .where(and(...conditions))
        .orderBy(desc(prescriptions.issuedAt), desc(prescriptions.id));
      return withItems(rows, db);
    },
  };
}
