import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/errors';
import { ScheduleBlock, type CreateScheduleBlockProps } from './schedule-block.entity';

const now = new Date('2026-10-11T12:00:00.000Z');

function validProps(overrides: Partial<CreateScheduleBlockProps> = {}): CreateScheduleBlockProps {
  return {
    professionalId: '11111111-1111-4111-8111-111111111111',
    startsAt: new Date('2026-10-20T03:00:00.000Z'),
    endsAt: new Date('2026-10-25T03:00:00.000Z'),
    reason: 'Férias',
    ...overrides,
  };
}

function at(iso: string) {
  return new Date(`2026-10-${iso}:00.000Z`);
}

describe('ScheduleBlock.create', () => {
  it('generates a UUID id and keeps the trimmed reason', () => {
    const block = ScheduleBlock.create(validProps({ reason: '  Férias  ' }), now);

    expect(block.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(block.reason).toBe('Férias');
    expect(block.startsAt).toEqual(validProps().startsAt);
    expect(block.createdAt).toEqual(now);
  });

  it.each([
    ['before', '2026-10-19T03:00:00.000Z'],
    ['equal to', '2026-10-20T03:00:00.000Z'],
  ])('rejects an end %s the start', (_, endsAt) => {
    expect(() => ScheduleBlock.create(validProps({ endsAt: new Date(endsAt) }))).toThrow(new DomainError('endsAt must be after startsAt'));
  });

  it.each(['', '   '])('rejects the empty reason %j', (reason) => {
    expect(() => ScheduleBlock.create(validProps({ reason }))).toThrow(new DomainError('reason is required'));
  });

  it('rejects a reason longer than 200 characters', () => {
    expect(() => ScheduleBlock.create(validProps({ reason: 'a'.repeat(201) }))).toThrow(DomainError);
  });

  it('requires a professional', () => {
    expect(() => ScheduleBlock.create(validProps({ professionalId: '' }))).toThrow(new DomainError('professionalId is required'));
  });
});

describe('ScheduleBlock.overlaps', () => {
  const block = ScheduleBlock.create(validProps({ startsAt: at('20T12:00'), endsAt: at('20T14:00') }));

  it('is true for a partial overlap at either end', () => {
    expect(block.overlaps(at('20T11:30'), at('20T12:30'))).toBe(true);
    expect(block.overlaps(at('20T13:30'), at('20T14:30'))).toBe(true);
  });

  it('is true for an interval inside or around the block', () => {
    expect(block.overlaps(at('20T12:30'), at('20T13:00'))).toBe(true);
    expect(block.overlaps(at('20T11:00'), at('20T15:00'))).toBe(true);
  });

  it('is false for adjacent intervals', () => {
    expect(block.overlaps(at('20T11:30'), at('20T12:00'))).toBe(false);
    expect(block.overlaps(at('20T14:00'), at('20T14:30'))).toBe(false);
  });
});
