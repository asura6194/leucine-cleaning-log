/** Enum members, mirroring migrations/002_enums.sql. */
export const USER_ROLES = ['operator', 'supervisor', 'admin'] as const;
export const EQUIPMENT_STATUSES = ['active', 'retired'] as const;
export const CLEANING_STATUSES = ['pending', 'verified'] as const;
export const CLEANING_METHODS = ['manual', 'cip', 'cop', 'solvent_flush'] as const;
export const AUDIT_ENTITIES = ['cleaning_record', 'equipment'] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];
export type CleaningStatus = (typeof CLEANING_STATUSES)[number];
export type CleaningMethod = (typeof CLEANING_METHODS)[number];
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

/** Roles permitted to move a cleaning record to 'verified'. Segregation of duties. */
export const VERIFIER_ROLES: readonly UserRole[] = ['supervisor', 'admin'];

/**
 * Roles permitted to change the equipment register. Operators log cleanings;
 * the list of assets those cleanings hang off is controlled master data, and
 * renaming an asset silently re-labels every record already written against
 * it. Same two roles as VERIFIER_ROLES today, kept separate because they
 * answer different questions and could diverge.
 */
export const EQUIPMENT_MANAGER_ROLES: readonly UserRole[] = ['supervisor', 'admin'];

export type User = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
};

export type Equipment = {
  id: string;
  code: string;
  name: string;
  status: EquipmentStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type CleaningRecord = {
  id: string;
  equipmentId: string;
  cleanedByUserId: string;
  cleanedAt: Date;
  method: CleaningMethod;
  notes: string | null;
  status: CleaningStatus;
  verifiedByUserId: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/* ---------- the audit specification ---------- */

/**
 * How a value is rendered into the single canonical string the audit trail
 * stores. Two values that mean the same thing must produce the same string,
 * or a diff reports phantom changes.
 */
export type FieldKind = 'userRef' | 'timestamp' | 'enum' | 'text';

/** One auditable field: how to render it, and the column it is stored under. */
export type AuditFieldSpec = { readonly kind: FieldKind; readonly column: string };

/**
 * Everything the audit engine needs to know about one entity.
 *
 * The engine is generic over this rather than hard-coded to cleaning records,
 * which is what lets equipment reuse it without a second diff function. The
 * field map is an ALLOWLIST, not a denylist: id is immutable, created_at is
 * structural, and updated_at changes on every single save, so auditing it
 * would append a meaningless line to every event.
 */
export type AuditSpec<TField extends string> = {
  readonly entity: AuditEntity;
  readonly fields: Readonly<Record<TField, AuditFieldSpec>>;
};

export const CLEANING_RECORD_AUDIT = {
  entity: 'cleaning_record',
  fields: {
    cleanedByUserId: { kind: 'userRef', column: 'cleaned_by_user_id' },
    cleanedAt: { kind: 'timestamp', column: 'cleaned_at' },
    method: { kind: 'enum', column: 'method' },
    notes: { kind: 'text', column: 'notes' },
    status: { kind: 'enum', column: 'status' },
    verifiedByUserId: { kind: 'userRef', column: 'verified_by_user_id' },
    verifiedAt: { kind: 'timestamp', column: 'verified_at' },
  },
} as const satisfies AuditSpec<CleaningRecordField>;

export type CleaningRecordField =
  | 'cleanedByUserId'
  | 'cleanedAt'
  | 'method'
  | 'notes'
  | 'status'
  | 'verifiedByUserId'
  | 'verifiedAt';

/**
 * Equipment is master data: a rename or a retirement changes what every
 * historical cleaning record appears to be about, so it is audited on the same
 * terms as the records themselves.
 */
export const EQUIPMENT_AUDIT = {
  entity: 'equipment',
  fields: {
    code: { kind: 'text', column: 'code' },
    name: { kind: 'text', column: 'name' },
    status: { kind: 'enum', column: 'status' },
  },
} as const satisfies AuditSpec<EquipmentField>;

export type EquipmentField = 'code' | 'name' | 'status';

/** One field that moved, in the canonical text form the audit trail stores. */
export type FieldChange = {
  field: string;
  oldValue: string | null;
  newValue: string | null;
};

export type AuditAction = 'create' | 'update';

export type AuditEvent = {
  id: string;
  action: AuditAction;
  actorUserId: string;
  actorLabel: string;
  occurredAt: Date;
  changes: { fieldName: string; oldValue: string | null; newValue: string | null }[];
};

/**
 * A partial update. A key that is ABSENT means "leave this field alone"; a key
 * present and null means "clear it". Those are different requests, and the
 * diff has to tell them apart -- hence `in` checks rather than undefined
 * checks throughout.
 */
export type CleaningRecordPatch = Partial<{
  cleanedByUserId: string;
  cleanedAt: Date;
  method: CleaningMethod;
  notes: string | null;
  status: CleaningStatus;
}>;

/** A partial equipment update. Same absent-vs-null contract as the record patch. */
export type EquipmentPatch = Partial<{
  code: string;
  name: string;
  status: EquipmentStatus;
}>;

export type AuthenticatedUser = Pick<User, 'id' | 'email' | 'name' | 'role'>;

/** "Priya Nair <priya@leucine.test>" -- frozen into audit_events.actor_label. */
export function actorLabel(user: Pick<User, 'name' | 'email'>): string {
  return `${user.name} <${user.email}>`;
}
