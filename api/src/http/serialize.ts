/**
 * Domain objects to JSON.
 *
 * Written out per type rather than handing domain objects to res.json(). Three
 * reasons: Date must cross the wire as ISO-8601 rather than whatever the
 * serialiser happens to do; an explicit shape means adding a column to a table
 * cannot accidentally publish it (password_hash being the obvious one); and the
 * return types come from shared/contract.ts, which the web client also imports
 * -- so a shape change that is not mirrored on both sides fails a build rather
 * than surfacing at runtime.
 */
import type {
  AuditEventDTO,
  CleaningRecordDTO,
  EquipmentDTO,
  Page,
  PageInfo,
  UserDTO,
} from '../../../shared/contract.js';
import type { AuditEvent, CleaningRecord, Equipment, User } from '../domain/types.js';

export const equipmentJson = (e: Equipment): EquipmentDTO => ({
  id: e.id,
  code: e.code,
  name: e.name,
  status: e.status,
  createdAt: e.createdAt.toISOString(),
  updatedAt: e.updatedAt.toISOString(),
});

export const cleaningRecordJson = (r: CleaningRecord): CleaningRecordDTO => ({
  id: r.id,
  equipmentId: r.equipmentId,
  cleanedByUserId: r.cleanedByUserId,
  cleanedAt: r.cleanedAt.toISOString(),
  method: r.method,
  notes: r.notes,
  status: r.status,
  verifiedByUserId: r.verifiedByUserId,
  verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export const userJson = (u: User): UserDTO => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
});

export const auditEventJson = (e: AuditEvent): AuditEventDTO => ({
  id: e.id,
  action: e.action,
  actorUserId: e.actorUserId,
  actorLabel: e.actorLabel,
  occurredAt: e.occurredAt.toISOString(),
  changes: e.changes,
});

/** Every list response has the same shape, so clients page uniformly. */
export const pageJson = <T>(items: T[], info: PageInfo): Page<T> => ({
  data: items,
  pageInfo: info,
});
