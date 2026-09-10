/**
 * Row shapes as PostgreSQL returns them, and explicit mappers to the domain
 * types.
 *
 * Mapping by hand rather than casting is the deliberate cost of using the pg
 * driver directly: snake_case to camelCase is spelled out once per table, and
 * a column rename breaks the build here instead of producing `undefined` three
 * layers away.
 */
import type {
  CleaningMethod,
  CleaningRecord,
  CleaningStatus,
  Equipment,
  EquipmentStatus,
  User,
  UserRole,
} from '../domain/types.js';

export type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: UserRole;
  created_at: Date;
  updated_at: Date;
};

export type EquipmentRow = {
  id: string;
  code: string;
  name: string;
  status: EquipmentStatus;
  created_at: Date;
  updated_at: Date;
};

export type CleaningRecordRow = {
  id: string;
  equipment_id: string;
  cleaned_by_user_id: string;
  cleaned_at: Date;
  method: CleaningMethod;
  notes: string | null;
  status: CleaningStatus;
  verified_by_user_id: string | null;
  verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toEquipment = (r: EquipmentRow): Equipment => ({
  id: r.id,
  code: r.code,
  name: r.name,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toCleaningRecord = (r: CleaningRecordRow): CleaningRecord => ({
  id: r.id,
  equipmentId: r.equipment_id,
  cleanedByUserId: r.cleaned_by_user_id,
  cleanedAt: r.cleaned_at,
  method: r.method,
  notes: r.notes,
  status: r.status,
  verifiedByUserId: r.verified_by_user_id,
  verifiedAt: r.verified_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
