/**
 * The audit diff.
 *
 * A pure module: no Express, no pg, no imports beyond the domain types. That
 * is deliberate -- it is why this file's tests need neither a server nor a
 * database, and it is the file most worth reading to understand the audit
 * trail.
 *
 * The engine is generic over an AuditSpec rather than tied to one table.
 * Cleaning records and equipment are both audited, and a second copy of this
 * logic for the second entity would be the version that quietly drifts.
 */
import type { AuditFieldSpec, AuditSpec, FieldChange, FieldKind } from './types.js';

/**
 * Resolves a user id to the label stored in the audit trail. Injected rather
 * than imported so that computeDiff stays pure and testable: the service
 * supplies a resolver backed by the database, tests supply a plain map.
 */
export type LabelResolver = (userId: string) => string;

const identityResolver: LabelResolver = (userId) => userId;

/**
 * Renders a value to the single canonical string the audit trail stores.
 *
 * The contract that matters: two values meaning the same thing MUST produce
 * the same string. Without that, a save that changed nothing reports phantom
 * changes -- a Date and its own ISO string are not `===`, and
 * '2026-09-08T09:14:22+00:00' and '2026-09-08T09:14:22Z' are the same instant
 * written two ways.
 *
 * An empty value is null, never the string 'null', so it reaches the database
 * as SQL NULL.
 */
export function canonicalValue(
  kind: FieldKind,
  value: unknown,
  resolveLabel: LabelResolver = identityResolver,
): string | null {
  if (value === null || value === undefined) return null;

  switch (kind) {
    case 'timestamp': {
      const date = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(date.getTime())) {
        // Validation should have rejected this long before here, so an invalid
        // date at this point is a bug, not bad input. Fail loudly.
        throw new TypeError(`not a valid timestamp: ${String(value)}`);
      }
      return date.toISOString();
    }

    case 'userRef':
      return resolveLabel(String(value));

    case 'enum':
    case 'text': {
      const text = String(value);
      // An empty note and no note are the same absence of a note. Collapsing
      // them here stops '' -> null churn appearing in the trail.
      return text.length === 0 ? null : text;
    }
  }
}

/**
 * Compares the row as it stands against the incoming patch, returning one
 * entry per field that actually moved.
 *
 * Four rules, each with a test:
 *   1. A field absent from the patch -- or present as undefined -- is not
 *      being changed. An explicit null IS a change: it clears the field.
 *   2. A field present with a value equal to the current one is not a change.
 *      Compared after canonical rendering, so equivalent-but-differently-
 *      written values do not register.
 *   3. Only fields in the spec are considered. Anything else in the patch is
 *      ignored here -- validation is what rejects unknown keys.
 *   4. The order of the result follows the spec, not the patch, so two
 *      equivalent saves produce identically ordered history.
 *
 * `current` is typed as holding every field the spec names, which is the check
 * that a spec cannot name a column its entity does not have. NoInfer pins
 * TField to the spec: without it TypeScript widens the parameter to every key
 * of the record passed in, and then complains that the spec is missing `id`
 * and `createdAt` -- fields that must not be audited. The values stay
 * `unknown` because one signature serves several entities; canonicalValue is
 * total over what it can receive, and validation has already constrained the
 * shapes before anything reaches here.
 */
export function computeDiff<TField extends string>(
  spec: AuditSpec<TField>,
  current: Readonly<Record<NoInfer<TField>, unknown>>,
  patch: Readonly<Partial<Record<NoInfer<TField>, unknown>>>,
  resolveLabel: LabelResolver = identityResolver,
): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const [field, { kind }] of fieldsOf(spec)) {
    // Rule 1. `in` rather than a truthiness or undefined check, so an
    // explicit null ("clear this") is honoured while an omitted key is left
    // alone -- those are different requests.
    //
    // undefined counts as ABSENT, not as null. JSON cannot carry undefined, so
    // this cannot arise over HTTP, but a constructed object can hold
    // { notes: undefined }, and treating that as "clear the note" would wipe a
    // note nobody touched. Verified against the validation layer: Zod omits
    // missing optional keys, but preserves ones explicitly set to undefined.
    if (!(field in patch)) continue;
    const proposed = (patch as Record<string, unknown>)[field];
    if (proposed === undefined) continue;

    const oldValue = canonicalValue(kind, (current as Record<string, unknown>)[field], resolveLabel);
    const newValue = canonicalValue(kind, proposed, resolveLabel);

    if (oldValue === newValue) continue; // rule 2

    changes.push({ field, oldValue, newValue });
  }

  return changes;
}

/**
 * The audit lines for a newly created row: every field holding a value moved
 * from nothing to that value.
 *
 * Fields still empty at creation emit no line, because null -> null is not a
 * change -- and the database enforces that with a CHECK constraint, so writing
 * one would fail rather than pass silently.
 */
export function computeCreateDiff<TField extends string>(
  spec: AuditSpec<TField>,
  row: Readonly<Record<NoInfer<TField>, unknown>>,
  resolveLabel: LabelResolver = identityResolver,
): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const [field, { kind }] of fieldsOf(spec)) {
    const newValue = canonicalValue(kind, (row as Record<string, unknown>)[field], resolveLabel);
    if (newValue === null) continue;
    changes.push({ field, oldValue: null, newValue });
  }

  return changes;
}

/** The column an audited field is stored under, per the spec. */
export function columnFor<TField extends string>(spec: AuditSpec<TField>, field: string): string {
  const entry = (spec.fields as Record<string, AuditFieldSpec>)[field];
  if (!entry) {
    // Only reachable if a FieldChange was built against a different spec than
    // the one being written with, which is a programming error, not bad input.
    throw new Error(`${spec.entity}: no audited field named ${field}`);
  }
  return entry.column;
}

/** The spec's fields as iterable [name, spec] pairs, in declaration order. */
function fieldsOf(spec: AuditSpec<string>): [string, AuditFieldSpec][] {
  return Object.entries(spec.fields as Record<string, AuditFieldSpec>);
}
