/**
 * The wire contract between the API and the web client.
 *
 * Types only -- no runtime code, so both sides import it with `import type`
 * and nothing crosses the package boundary at build time.
 *
 * This is the single source of truth. The API's serialisers are annotated with
 * these types, so a field renamed in the database and forgotten in the
 * serialiser fails the API build; the web client imports the same types, so a
 * changed shape fails the web build too. Hand-copying the shapes into the
 * front-end would let the two drift silently until runtime.
 */

export type UserRole = 'operator' | 'supervisor' | 'admin';

/**
 * The two role gates, as the UI needs them.
 *
 * These mirror VERIFIER_ROLES and EQUIPMENT_MANAGER_ROLES in the API's
 * domain/types.ts. Deliberately a mirror and not an import: this file is the
 * wire contract, and the server's copy is the one that actually enforces
 * anything -- the client's copy only decides whether to render a button the
 * API would otherwise refuse. Any drift shows up as a 403 rather than as
 * silent over-permission, which is the failure direction to prefer.
 */
export const VERIFIER_ROLES: UserRole[] = ['supervisor', 'admin'];
export const EQUIPMENT_MANAGER_ROLES: UserRole[] = ['supervisor', 'admin'];
export type EquipmentStatus = 'active' | 'retired';
export type CleaningStatus = 'pending' | 'verified';
export type CleaningMethod = 'manual' | 'cip' | 'cop' | 'solvent_flush';
export type AuditAction = 'create' | 'update';

export type UserDTO = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};

export type EquipmentDTO = {
  id: string;
  code: string;
  name: string;
  status: EquipmentStatus;
  createdAt: string;
  updatedAt: string;
};

export type CleaningRecordDTO = {
  id: string;
  equipmentId: string;
  cleanedByUserId: string;
  cleanedAt: string;
  method: CleaningMethod;
  notes: string | null;
  status: CleaningStatus;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** One field that moved, as stored in the audit trail. */
export type FieldChangeDTO = {
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
};

/** One act of change: who, when, what kind -- and the fields it touched. */
export type AuditEventDTO = {
  id: string;
  action: AuditAction;
  actorUserId: string;
  actorLabel: string;
  occurredAt: string;
  changes: FieldChangeDTO[];
};

/**
 * Where a numbered page sits in its list.
 *
 * `page` is 1-based and is the page ACTUALLY served: a request past the end is
 * clamped to the last page rather than returning an empty table, so a client
 * corrects its own state from this rather than trusting what it asked for.
 *
 * `hasMore` is deliberately absent -- it is `page < totalPages`, and a wire
 * contract that carries derivable state eventually carries a contradiction.
 */
export type PageInfo = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

/** Every list endpoint returns this shape, so clients page uniformly. */
export type Page<T> = {
  data: T[];
  pageInfo: PageInfo;
};

/** The page sizes the record table offers. The API accepts any positive value
 *  up to its maximum; these are just the ones in the dropdown. */
export const PAGE_SIZE_OPTIONS = [10, 20, 25] as const;
export const DEFAULT_PAGE_SIZE = 20;

export type Single<T> = { data: T };

export type ErrorDetail = { path: string; message: string };

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
  };
};

/* ---------- request bodies ---------- */

export type LoginRequest = { email: string; password: string };

export type CreateEquipmentRequest = {
  code: string;
  name: string;
  status?: EquipmentStatus;
};

/** Same absent-vs-present contract as the cleaning-record patch. */
export type UpdateEquipmentRequest = Partial<{
  code: string;
  name: string;
  status: EquipmentStatus;
}>;

export type CreateCleaningRecordRequest = {
  cleanedByUserId?: string;
  cleanedAt: string;
  method: CleaningMethod;
  notes?: string | null;
};

/**
 * Partial by design. A key that is ABSENT means "leave this field alone"; a
 * key present and null means "clear it". The audit trail depends on that
 * distinction, so the type preserves it rather than collapsing both to
 * optional-undefined.
 */
export type UpdateCleaningRecordRequest = Partial<{
  cleanedByUserId: string;
  cleanedAt: string;
  method: CleaningMethod;
  notes: string | null;
  status: CleaningStatus;
}>;

/** Short forms for table cells, where a wrapped label makes rows ragged. */
export const CLEANING_METHOD_SHORT: Record<CleaningMethod, string> = {
  manual: 'Manual',
  cip: 'CIP',
  cop: 'COP',
  solvent_flush: 'Solvent flush',
};

/** Full forms for pickers and history, where there is room to be unambiguous. */
export const CLEANING_METHOD_LABELS: Record<CleaningMethod, string> = {
  manual: 'Manual',
  cip: 'Clean-in-place (CIP)',
  cop: 'Clean-out-of-place (COP)',
  solvent_flush: 'Solvent flush',
};

/**
 * Column names as the audit trail stores them, rendered for people.
 *
 * One map across both audited entities. `status` is deliberately shared -- it
 * means the same thing to a reader in either trail -- while `code` and `name`
 * only ever appear on equipment.
 */
export const AUDIT_FIELD_LABELS: Record<string, string> = {
  code: 'Code',
  name: 'Name',
  cleaned_by_user_id: 'Cleaned by',
  cleaned_at: 'Cleaned at',
  method: 'Method',
  notes: 'Notes',
  status: 'Status',
  verified_by_user_id: 'Verified by',
  verified_at: 'Verified at',
};
