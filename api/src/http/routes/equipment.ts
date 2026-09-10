import { Router } from 'express';
import { currentUser, requireAuth, requireRole } from '../../auth/session.js';
import { EQUIPMENT_MANAGER_ROLES } from '../../domain/types.js';
import {
  createEquipment,
  getEquipment,
  getEquipmentAuditHistory,
  listEquipment,
  patchEquipment,
  retireEquipment,
} from '../../services/equipment.js';
import {
  createCleaningRecordForEquipment,
  listCleaningRecords,
} from '../../services/cleaningRecords.js';
import { handle } from '../handler.js';
import { auditEventJson, cleaningRecordJson, equipmentJson, pageJson } from '../serialize.js';
import {
  createCleaningRecordBody,
  createEquipmentBody,
  idParam,
  listCleaningRecordsQuery,
  listEquipmentQuery,
  paginationQuery,
  parseOrThrow,
  updateEquipmentBody,
} from '../validation.js';

export const equipmentRouter = Router();

// Reads require a session too: a cleaning log is not public data.
equipmentRouter.use(requireAuth);

/**
 * Writes to the register need more than a session.
 *
 * Operators log cleanings; they do not maintain the asset list. This is the
 * same shape of rule as the verify gate on cleaning records, and it is applied
 * as middleware here AND checked nowhere else, because unlike verification
 * there is no second caller of these operations to protect.
 */
const requireEquipmentManager = requireRole(...EQUIPMENT_MANAGER_ROLES);

equipmentRouter.get(
  '/',
  handle(async (req, res) => {
    const { status, ...request } = parseOrThrow(listEquipmentQuery, req.query, 'query parameters');
    const page = await listEquipment({ ...(status ? { status } : {}), request });
    res.status(200).json(pageJson(page.items.map(equipmentJson), page.info));
  }),
);

equipmentRouter.post(
  '/',
  requireEquipmentManager,
  handle(async (req, res) => {
    const body = parseOrThrow(createEquipmentBody, req.body, 'request body');
    const equipment = await createEquipment({
      input: body,
      actor: currentUser(req),
      requestId: req.requestId,
    });
    res.status(201).json({ data: equipmentJson(equipment) });
  }),
);

equipmentRouter.get(
  '/:id',
  handle(async (req, res) => {
    const { id } = parseOrThrow(idParam, req.params, 'equipment id');
    res.status(200).json({ data: equipmentJson(await getEquipment(id)) });
  }),
);

equipmentRouter.patch(
  '/:id',
  requireEquipmentManager,
  handle(async (req, res) => {
    const { id } = parseOrThrow(idParam, req.params, 'equipment id');
    const body = parseOrThrow(updateEquipmentBody, req.body, 'request body');

    // The actor comes from the session, never the body.
    const equipment = await patchEquipment({
      id,
      patch: body,
      actor: currentUser(req),
      requestId: req.requestId,
    });

    res.status(200).json({ data: equipmentJson(equipment) });
  }),
);

/**
 * DELETE retires the asset rather than removing the row -- cleaning history
 * must keep a parent to point at. The verb is what a caller reaches for; the
 * returned record shows what actually happened (status: 'retired').
 */
equipmentRouter.delete(
  '/:id',
  requireEquipmentManager,
  handle(async (req, res) => {
    const { id } = parseOrThrow(idParam, req.params, 'equipment id');
    const equipment = await retireEquipment({
      id,
      actor: currentUser(req),
      requestId: req.requestId,
    });
    res.status(200).json({ data: equipmentJson(equipment) });
  }),
);

/**
 * Field-level history for one asset, newest event first.
 *
 * Readable by anyone with a session even though only managers can write:
 * an operator looking at a record dated before a rename should be able to see
 * that the rename happened.
 */
equipmentRouter.get(
  '/:id/audit',
  handle(async (req, res) => {
    const { id } = parseOrThrow(idParam, req.params, 'equipment id');
    const request = parseOrThrow(paginationQuery, req.query, 'query parameters');
    const page = await getEquipmentAuditHistory({ equipmentId: id, request });
    res.status(200).json(pageJson(page.items.map(auditEventJson), page.info));
  }),
);

/* ---------- cleaning records nested under their equipment ---------- */

equipmentRouter.get(
  '/:id/cleaning-records',
  handle(async (req, res) => {
    const { id } = parseOrThrow(idParam, req.params, 'equipment id');
    const { status, ...request } = parseOrThrow(
      listCleaningRecordsQuery,
      req.query,
      'query parameters',
    );

    const page = await listCleaningRecords({
      equipmentId: id,
      ...(status ? { status } : {}),
      request,
    });

    res.status(200).json(pageJson(page.items.map(cleaningRecordJson), page.info));
  }),
);

equipmentRouter.post(
  '/:id/cleaning-records',
  handle(async (req, res) => {
    const { id } = parseOrThrow(idParam, req.params, 'equipment id');
    const body = parseOrThrow(createCleaningRecordBody, req.body, 'request body');

    const record = await createCleaningRecordForEquipment({
      equipmentId: id,
      input: body,
      actor: currentUser(req),
      requestId: req.requestId,
    });

    res.status(201).json({ data: cleaningRecordJson(record) });
  }),
);
