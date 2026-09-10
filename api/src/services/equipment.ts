/**
 * The equipment register.
 *
 * Equipment is master data: renaming an asset silently re-labels every
 * cleaning record already written against it, and retiring one stops new
 * records being logged. Both are exactly the kind of change an inspector asks
 * about, so the write path here is the same shape as the one for cleaning
 * records -- lock, diff, write, audit, all in one transaction.
 */
import type { PageInfo } from '../../../shared/contract.js';
import { withTransaction } from '../db/tx.js';
import { computeCreateDiff, computeDiff } from '../domain/diff.js';
import {
  EQUIPMENT_AUDIT,
  actorLabel,
  type AuditEvent,
  type AuthenticatedUser,
  type Equipment,
  type EquipmentPatch,
  type EquipmentStatus,
} from '../domain/types.js';
import type { PageRequest } from '../domain/pagination.js';
import { ConflictError, NotFoundError } from '../http/errors.js';
import { insertAuditEvent, listAuditEvents } from '../repositories/audit.js';
import {
  findEquipmentById,
  insertEquipment,
  listEquipmentPage,
  updateEquipment,
} from '../repositories/equipment.js';

export async function createEquipment(args: {
  input: { code: string; name: string; status?: EquipmentStatus };
  actor: AuthenticatedUser;
  requestId: string;
}): Promise<Equipment> {
  return withTransaction(async (client) => {
    // A duplicate code surfaces as 409 via translateDatabaseError rather than
    // being pre-checked with a SELECT. Checking first would still race: two
    // concurrent requests can both pass the check and one still has to lose at
    // the unique index. The constraint is the authority; the translation just
    // gives it a decent HTTP status. The transaction rolls back with it, so no
    // orphan audit event is left behind.
    const equipment = await insertEquipment(client, {
      code: args.input.code,
      name: args.input.name,
      status: args.input.status ?? 'active',
    });

    await insertAuditEvent(client, {
      spec: EQUIPMENT_AUDIT,
      entityId: equipment.id,
      action: 'create',
      actorUserId: args.actor.id,
      actorLabel: actorLabel(args.actor),
      requestId: args.requestId,
      changes: computeCreateDiff(EQUIPMENT_AUDIT, equipment),
    });

    return equipment;
  });
}

export async function getEquipment(id: string): Promise<Equipment> {
  const equipment = await findEquipmentById(id);
  if (!equipment) throw new NotFoundError('equipment', id);
  return equipment;
}

export async function listEquipment(args: {
  status?: EquipmentStatus;
  request: PageRequest;
}): Promise<{ items: Equipment[]; info: PageInfo }> {
  return listEquipmentPage({
    ...(args.status ? { status: args.status } : {}),
    request: args.request,
  });
}

/**
 * The audited update. Same six steps as the cleaning-record path, minus the
 * label resolution -- equipment holds no user references, so the diff needs no
 * resolver and the default identity one is never consulted.
 */
export async function patchEquipment(args: {
  id: string;
  patch: EquipmentPatch;
  actor: AuthenticatedUser;
  requestId: string;
}): Promise<Equipment> {
  return withTransaction(async (client) => {
    /* 1 - load and lock, before the diff reads the old values. */
    const current = await findEquipmentById(args.id, { client, forUpdate: true });
    if (!current) throw new NotFoundError('equipment', args.id);

    /* 2 - compare. */
    const changes = computeDiff(EQUIPMENT_AUDIT, current, args.patch);

    /* 3 - a save that changed nothing writes nothing, and no empty event. */
    if (changes.length === 0) return current;

    /* 4 - the row and its audit event, in this same transaction. */
    const updated = await updateEquipment(client, args.id, args.patch);
    if (!updated) throw new NotFoundError('equipment', args.id);

    await insertAuditEvent(client, {
      spec: EQUIPMENT_AUDIT,
      entityId: updated.id,
      action: 'update',
      actorUserId: args.actor.id,
      actorLabel: actorLabel(args.actor),
      requestId: args.requestId,
      changes,
    });

    return updated;
  });
}

/**
 * "Delete" means retire.
 *
 * A hard delete would either orphan cleaning history or cascade it away, and
 * both are wrong for an auditable system -- so the row stays and its status
 * changes. The endpoint keeps the DELETE verb because that is what a caller
 * reaches for; the response says what actually happened, and the audit trail
 * records it as an ordinary status change.
 */
export async function retireEquipment(args: {
  id: string;
  actor: AuthenticatedUser;
  requestId: string;
}): Promise<Equipment> {
  const equipment = await getEquipment(args.id);
  if (equipment.status === 'retired') {
    throw new ConflictError('That equipment is already retired.');
  }
  return patchEquipment({ ...args, patch: { status: 'retired' } });
}

export async function getEquipmentAuditHistory(args: {
  equipmentId: string;
  request: PageRequest;
}): Promise<{ items: AuditEvent[]; info: PageInfo }> {
  await getEquipment(args.equipmentId); // 404 rather than an empty history
  return listAuditEvents({
    entityType: 'equipment',
    entityId: args.equipmentId,
    request: args.request,
  });
}
