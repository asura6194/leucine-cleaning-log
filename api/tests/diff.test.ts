import { describe, expect, it } from 'vitest';
import { canonicalValue, columnFor, computeCreateDiff, computeDiff } from '../src/domain/diff.js';
import {
  CLEANING_RECORD_AUDIT,
  EQUIPMENT_AUDIT,
  type CleaningRecord,
  type Equipment,
} from '../src/domain/types.js';

const LABELS = new Map([
  ['11111111-1111-4111-8111-111111111111', 'Priya Nair <priya@leucine.test>'],
  ['22222222-2222-4222-8222-222222222222', 'Ravi Kumar <ravi@leucine.test>'],
]);
const resolve = (id: string): string => LABELS.get(id) ?? id;

const PRIYA = '11111111-1111-4111-8111-111111111111';
const RAVI = '22222222-2222-4222-8222-222222222222';

function record(overrides: Partial<CleaningRecord> = {}): CleaningRecord {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    equipmentId: '44444444-4444-4444-8444-444444444444',
    cleanedByUserId: PRIYA,
    cleanedAt: new Date('2026-09-08T09:14:22.000Z'),
    method: 'manual',
    notes: null,
    status: 'pending',
    verifiedByUserId: null,
    verifiedAt: null,
    createdAt: new Date('2026-09-08T09:14:22.000Z'),
    updatedAt: new Date('2026-09-08T09:14:22.000Z'),
    ...overrides,
  };
}

describe('computeDiff', () => {
  it('returns nothing for an empty patch', () => {
    expect(computeDiff(CLEANING_RECORD_AUDIT, record(), {}, resolve)).toEqual([]);
  });

  it('reports a single changed field', () => {
    expect(computeDiff(CLEANING_RECORD_AUDIT, record(), { method: 'cip' }, resolve)).toEqual([
      { field: 'method', oldValue: 'manual', newValue: 'cip' },
    ]);
  });

  it('reports several fields changed in one save', () => {
    const changes = computeDiff(CLEANING_RECORD_AUDIT, record(), { method: 'cip', notes: 'Rinse extended.' }, resolve);
    expect(changes).toHaveLength(2);
    expect(changes.map((c) => c.field).sort()).toEqual(['method', 'notes']);
  });

  it('reports null to value', () => {
    expect(computeDiff(CLEANING_RECORD_AUDIT, record(), { notes: 'First note.' }, resolve)).toEqual([
      { field: 'notes', oldValue: null, newValue: 'First note.' },
    ]);
  });

  it('reports value to null', () => {
    const changes = computeDiff(CLEANING_RECORD_AUDIT, record({ notes: 'Existing note.' }), { notes: null }, resolve);
    expect(changes).toEqual([{ field: 'notes', oldValue: 'Existing note.', newValue: null }]);
  });

  it('ignores a field submitted with the value it already has', () => {
    expect(computeDiff(CLEANING_RECORD_AUDIT, record({ method: 'cip' }), { method: 'cip' }, resolve)).toEqual([]);
  });

  it('distinguishes an absent key from an explicit null', () => {
    const current = record({ notes: 'Keep me.' });
    // absent -> leave alone
    expect(computeDiff(CLEANING_RECORD_AUDIT, current, { method: 'cip' }, resolve)).toEqual([
      { field: 'method', oldValue: 'manual', newValue: 'cip' },
    ]);
    // explicit null -> clear it
    expect(computeDiff(CLEANING_RECORD_AUDIT, current, { notes: null }, resolve)).toEqual([
      { field: 'notes', oldValue: 'Keep me.', newValue: null },
    ]);
  });

  it('treats a key set to undefined as absent, not as a request to clear it', () => {
    // JSON cannot carry undefined so this cannot arrive over HTTP, but a
    // constructed patch can hold it, and clearing the note would be silent
    // data loss.
    const current = record({ notes: 'Keep me.' });
    expect(computeDiff(CLEANING_RECORD_AUDIT, current, { notes: undefined }, resolve)).toEqual([]);
  });

  it('ignores fields that are not on the auditable allowlist', () => {
    // updated_at changes on every save; auditing it would add a meaningless
    // line to every event.
    const patch = { updatedAt: new Date('2030-01-01T00:00:00Z'), id: 'something-else' };
    expect(computeDiff(CLEANING_RECORD_AUDIT, record(), patch as never, resolve)).toEqual([]);
  });

  it('treats equal timestamps written differently as unchanged', () => {
    const current = record({ cleanedAt: new Date('2026-09-08T09:14:22.000Z') });
    for (const equivalent of [
      '2026-09-08T09:14:22Z',
      '2026-09-08T09:14:22.000Z',
      '2026-09-08T09:14:22+00:00',
      '2026-09-08T14:44:22+05:30',
      new Date('2026-09-08T09:14:22.000Z'),
    ]) {
      expect(computeDiff(CLEANING_RECORD_AUDIT, current, { cleanedAt: new Date(equivalent) }, resolve)).toEqual([]);
    }
  });

  it('reports a genuinely different timestamp', () => {
    const changes = computeDiff(CLEANING_RECORD_AUDIT, record(), { cleanedAt: new Date('2026-09-08T10:00:00Z') }, resolve);
    expect(changes).toEqual([
      {
        field: 'cleanedAt',
        oldValue: '2026-09-08T09:14:22.000Z',
        newValue: '2026-09-08T10:00:00.000Z',
      },
    ]);
  });

  it('records user references as labels, not raw ids', () => {
    const changes = computeDiff(CLEANING_RECORD_AUDIT, record(), { cleanedByUserId: RAVI }, resolve);
    expect(changes).toEqual([
      {
        field: 'cleanedByUserId',
        oldValue: 'Priya Nair <priya@leucine.test>',
        newValue: 'Ravi Kumar <ravi@leucine.test>',
      },
    ]);
  });

  it('treats an empty string note as no note', () => {
    // '' and null are the same absence of a note; letting them differ would
    // put a meaningless '' -> null line in the trail.
    expect(computeDiff(CLEANING_RECORD_AUDIT, record({ notes: null }), { notes: '' }, resolve)).toEqual([]);
  });
});

describe('computeCreateDiff', () => {
  it('records every field that holds a value, and no others', () => {
    const changes = computeCreateDiff(CLEANING_RECORD_AUDIT, record({ notes: 'Initial note.' }), resolve);

    expect(changes.every((c) => c.oldValue === null)).toBe(true);
    expect(changes.map((c) => c.field).sort()).toEqual([
      'cleanedAt',
      'cleanedByUserId',
      'method',
      'notes',
      'status',
    ]);
    // verifiedByUserId and verifiedAt are still null: null -> null is not a
    // change, and the database CHECK would reject the row anyway.
    expect(changes.map((c) => c.field)).not.toContain('verifiedAt');
  });
});

describe('canonicalValue', () => {
  it('renders an absent value as null, never the string "null"', () => {
    expect(canonicalValue('text', null)).toBeNull();
    expect(canonicalValue('text', undefined)).toBeNull();
  });

  it('throws on a value that cannot be a timestamp', () => {
    // Validation should have rejected this upstream, so reaching here is a bug.
    expect(() => canonicalValue('timestamp', 'not-a-date')).toThrow(TypeError);
  });
});

/**
 * The point of making the engine generic: equipment reuses it whole. If these
 * pass without a second diff implementation existing, the abstraction earned
 * its keep.
 */
describe('the same engine over equipment', () => {
  function asset(overrides: Partial<Equipment> = {}): Equipment {
    return {
      id: '55555555-5555-4555-8555-555555555555',
      code: 'TNK-101',
      name: 'Blending Tank 101',
      status: 'active',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  it('reports a renamed asset', () => {
    expect(computeDiff(EQUIPMENT_AUDIT, asset(), { name: 'Blending Tank 101A' })).toEqual([
      { field: 'name', oldValue: 'Blending Tank 101', newValue: 'Blending Tank 101A' },
    ]);
  });

  it('reports retirement as an ordinary status change', () => {
    expect(computeDiff(EQUIPMENT_AUDIT, asset(), { status: 'retired' })).toEqual([
      { field: 'status', oldValue: 'active', newValue: 'retired' },
    ]);
  });

  it('ignores timestamps and the id, which are not on the equipment allowlist', () => {
    const patch = { updatedAt: new Date('2030-01-01T00:00:00Z'), id: 'x' };
    expect(computeDiff(EQUIPMENT_AUDIT, asset(), patch as never)).toEqual([]);
  });

  it('records all three fields on creation', () => {
    expect(computeCreateDiff(EQUIPMENT_AUDIT, asset()).map((c) => c.field)).toEqual([
      'code',
      'name',
      'status',
    ]);
  });
});

describe('columnFor', () => {
  it('maps a field to the column the audit trail stores it under', () => {
    expect(columnFor(CLEANING_RECORD_AUDIT, 'cleanedByUserId')).toBe('cleaned_by_user_id');
    expect(columnFor(EQUIPMENT_AUDIT, 'code')).toBe('code');
  });

  it('throws when a change is written against the wrong spec', () => {
    // Only reachable as a programming error, but it fails loudly rather than
    // writing an audit line under an undefined column name.
    expect(() => columnFor(EQUIPMENT_AUDIT, 'cleanedAt')).toThrow(/no audited field/);
  });
});
