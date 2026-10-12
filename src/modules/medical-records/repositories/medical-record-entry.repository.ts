import { and, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { Database, DbExecutor, Transaction } from '../../../db/client';
import type { FieldCipher } from '../../../shared/crypto';
import { IcdCode, MedicalRecordEntry } from '../entities/medical-record-entry.entity';
import { medicalRecordEntries } from '../schema';

type MedicalRecordEntryRow = typeof medicalRecordEntries.$inferSelect;

export type Period = {
  from?: Date;
  to?: Date;
};

export type CurrentEntry = {
  entry: MedicalRecordEntry;
  versionCount: number;
};

export type MedicalRecordEntryRepository = ReturnType<typeof createMedicalRecordEntryRepository>;

export function createMedicalRecordEntryRepository(db: Database, cipher: FieldCipher) {
  const decryptNullable = (value: string | null) => (value === null ? null : cipher.decrypt(value));
  const encryptNullable = (value: string | null) => (value === null ? null : cipher.encrypt(value));

  function toEntity(row: MedicalRecordEntryRow): MedicalRecordEntry {
    return MedicalRecordEntry.restore({
      id: row.id,
      patientId: row.patientId,
      professionalId: row.professionalId,
      appointmentId: row.appointmentId,
      admissionId: row.admissionId,
      previousEntryId: row.previousEntryId,
      anamnesis: cipher.decrypt(row.anamnesis),
      icdCode: IcdCode.restore(cipher.decrypt(row.icdCode)),
      diagnosisNotes: decryptNullable(row.diagnosisNotes),
      conduct: cipher.decrypt(row.conduct),
      correctionReason: decryptNullable(row.correctionReason),
      createdAt: row.createdAt,
    });
  }

  return {
    async insert(entry: MedicalRecordEntry, executor: DbExecutor = db): Promise<void> {
      await executor.insert(medicalRecordEntries).values({
        id: entry.id,
        patientId: entry.patientId,
        professionalId: entry.professionalId,
        appointmentId: entry.appointmentId,
        admissionId: entry.admissionId,
        previousEntryId: entry.previousEntryId,
        anamnesis: cipher.encrypt(entry.anamnesis),
        icdCode: cipher.encrypt(entry.icdCode.value),
        diagnosisNotes: encryptNullable(entry.diagnosisNotes),
        conduct: cipher.encrypt(entry.conduct),
        correctionReason: encryptNullable(entry.correctionReason),
        createdAt: entry.createdAt,
      });
    },

    async findById(id: string, executor: DbExecutor = db): Promise<MedicalRecordEntry | null> {
      const [row] = await executor.select().from(medicalRecordEntries).where(eq(medicalRecordEntries.id, id));
      return row ? toEntity(row) : null;
    },

    async lock(id: string, tx: Transaction): Promise<void> {
      await tx.select({ id: medicalRecordEntries.id }).from(medicalRecordEntries).where(eq(medicalRecordEntries.id, id)).for('update');
    },

    async hasCorrection(id: string, executor: DbExecutor = db): Promise<boolean> {
      const [row] = await executor
        .select({ id: medicalRecordEntries.id })
        .from(medicalRecordEntries)
        .where(eq(medicalRecordEntries.previousEntryId, id));
      return row !== undefined;
    },

    async findChain(id: string, executor: DbExecutor = db): Promise<MedicalRecordEntry[]> {
      const { rows } = await executor.execute<{ id: string; depth: number }>(sql`
        WITH RECURSIVE older(id, previous_entry_id, depth) AS (
          SELECT id, previous_entry_id, 0 FROM ${medicalRecordEntries} WHERE id = ${id}
          UNION ALL
          SELECT e.id, e.previous_entry_id, o.depth - 1 FROM ${medicalRecordEntries} e JOIN older o ON e.id = o.previous_entry_id
        ),
        newer(id, depth) AS (
          SELECT id, 0 FROM ${medicalRecordEntries} WHERE id = ${id}
          UNION ALL
          SELECT e.id, n.depth + 1 FROM ${medicalRecordEntries} e JOIN newer n ON e.previous_entry_id = n.id
        )
        SELECT id, depth FROM older UNION SELECT id, depth FROM newer
      `);
      if (rows.length === 0) {
        return [];
      }
      const depthOf = new Map(rows.map((row) => [row.id, Number(row.depth)]));
      const entries = await executor.select().from(medicalRecordEntries).where(inArray(medicalRecordEntries.id, [...depthOf.keys()]));
      return entries.sort((a, b) => depthOf.get(b.id)! - depthOf.get(a.id)!).map(toEntity);
    },

    async findCurrentByPatient(patientId: string, period: Period): Promise<CurrentEntry[]> {
      const links = await db
        .select({ id: medicalRecordEntries.id, previousEntryId: medicalRecordEntries.previousEntryId })
        .from(medicalRecordEntries)
        .where(eq(medicalRecordEntries.patientId, patientId));
      const previousOf = new Map(links.map((link) => [link.id, link.previousEntryId]));
      const corrected = new Set(links.map((link) => link.previousEntryId));
      const currentIds = links.filter((link) => !corrected.has(link.id)).map((link) => link.id);
      if (currentIds.length === 0) {
        return [];
      }

      const conditions: SQL[] = [inArray(medicalRecordEntries.id, currentIds)];
      if (period.from) conditions.push(gte(medicalRecordEntries.createdAt, period.from));
      if (period.to) conditions.push(lt(medicalRecordEntries.createdAt, period.to));
      const rows = await db
        .select()
        .from(medicalRecordEntries)
        .where(and(...conditions))
        .orderBy(desc(medicalRecordEntries.createdAt), desc(medicalRecordEntries.id));

      const versionCount = (id: string) => {
        let count = 1;
        for (let previous = previousOf.get(id); previous; previous = previousOf.get(previous)) {
          count += 1;
        }
        return count;
      };
      return rows.map((row) => ({ entry: toEntity(row), versionCount: versionCount(row.id) }));
    },
  };
}
