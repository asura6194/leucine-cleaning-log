import { Router } from 'express';
import { currentUser, requireAuth } from '../../auth/session.js';
import {
  getAuditHistory,
  getCleaningRecord,
  updateCleaningRecordById,
} from '../../services/cleaningRecords.js';
import { handle } from '../handler.js';
import { auditEventJson, cleaningRecordJson, pageJson } from '../serialize.js';
import {
  idParam,
  paginationQuery,
  parseOrThrow,
  updateCleaningRecordBody,
} from '../validation.js';

export const cleaningRecordRouter = Router();

cleaningRecordRouter.use(requireAuth);

cleaningRecordRouter.get(
  '/:id',
  handle(async (req, res) => {
    const { id } = parseOrThrow(idParam, req.params, 'record id');
    res.status(200).json({ data: cleaningRecordJson(await getCleaningRecord(id)) });
  }),
);

cleaningRecordRouter.patch(
  '/:id',
  handle(async (req, res) => {
    const { id } = parseOrThrow(idParam, req.params, 'record id');
    const body = parseOrThrow(updateCleaningRecordBody, req.body, 'request body');

    // The actor comes from the session, never the body. A caller that could
    // name its own actor could forge audit history.
    const record = await updateCleaningRecordById({
      id,
      patch: body,
      actor: currentUser(req),
      requestId: req.requestId,
    });

    res.status(200).json({ data: cleaningRecordJson(record) });
  }),
);

/** Field-level history for one record, newest event first. */
cleaningRecordRouter.get(
  '/:id/audit',
  handle(async (req, res) => {
    const { id } = parseOrThrow(idParam, req.params, 'record id');
    const request = parseOrThrow(paginationQuery, req.query, 'query parameters');
    const page = await getAuditHistory({ recordId: id, request });
    res.status(200).json(pageJson(page.items.map(auditEventJson), page.info));
  }),
);
