import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import type { PageInfo } from '../../../shared/contract.js';
import { columnFor } from '../domain/diff.js';
import { pageInfo, resolvePage, type PageRequest } from '../domain/pagination.js';
import type { AuditAction, AuditEntity, AuditEvent, AuditSpec, FieldChange } from '../domain/types.js';

/**
 * Writes one audit event and its field-change lines.
 *
 * Takes a transaction client, never the pool, and there is no overload that
 * accepts the pool: an audit row committed independently of the change it
 * describes is worse than no audit row, because it is wrong rather than
 * missing.
 */
export async function insertAuditEvent(
  client: PoolClient,
  args: {
    /** Supplies both the entity_type written and the column each field maps to. */
    spec: AuditSpec<string>;
    entityId: string;
    action: AuditAction;
    actorUserId: string;
    actorLabel: string;
    requestId: string | null;
    changes: readonly FieldChange[];
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO audit_events
       (entity_type, entity_id, action, actor_user_id, actor_label, request_id)
     VALUES ($1::audit_entity, $2, $3::audit_action, $4, $5, $6)
     RETURNING id`,
    [
      args.spec.entity,
      args.entityId,
      args.action,
      args.actorUserId,
      args.actorLabel,
      args.requestId,
    ],
  );
  const eventId = rows[0]!.id;

  if (args.changes.length > 0) {
    // One statement for N lines via UNNEST, rather than a query per field.
    await client.query(
      `INSERT INTO audit_field_changes (audit_event_id, field_name, old_value, new_value)
       SELECT $1, * FROM UNNEST($2::text[], $3::text[], $4::text[])`,
      [
        eventId,
        args.changes.map((c) => columnFor(args.spec, c.field)),
        args.changes.map((c) => c.oldValue),
        args.changes.map((c) => c.newValue),
      ],
    );
  }

  return eventId;
}

type AuditRow = {
  id: string;
  action: AuditAction;
  actor_user_id: string;
  actor_label: string;
  occurred_at: Date;
  changes: { fieldName: string; oldValue: string | null; newValue: string | null }[] | null;
};

/**
 * Audit history for one audited row, newest event first, each event carrying
 * its own field-change lines.
 *
 * The lines are aggregated in SQL with json_agg rather than fetched in a
 * second query and stitched together in JavaScript. One round trip, and the
 * grouping is done where the join already is.
 *
 * Paginated like every other list, because no endpoint should be able to
 * return an unbounded set -- even one that will usually hold a handful of
 * rows. Ordered by the event id, which is a monotonic bigint and therefore a
 * total order on its own: two events can share `occurred_at`, so ordering by
 * the timestamp alone would not be stable.
 */
export async function listAuditEvents(args: {
  entityType: AuditEntity;
  entityId: string;
  request: PageRequest;
}): Promise<{ items: AuditEvent[]; info: PageInfo }> {
  const { rows: countRows } = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM audit_events
      WHERE entity_type = $1::audit_entity AND entity_id = $2`,
    [args.entityType, args.entityId],
  );
  const totalItems = Number(countRows[0]!.total);
  const bounds = resolvePage(args.request, totalItems);

  const conditions = ['e.entity_type = $1::audit_entity', 'e.entity_id = $2'];
  const params: unknown[] = [args.entityType, args.entityId, bounds.limit, bounds.offset];

  const { rows } = await pool.query<AuditRow>(
    `SELECT e.id, e.action, e.actor_user_id, e.actor_label, e.occurred_at,
            (
              SELECT json_agg(
                       json_build_object(
                         'fieldName', c.field_name,
                         'oldValue',  c.old_value,
                         'newValue',  c.new_value
                       ) ORDER BY c.field_name
                     )
                FROM audit_field_changes c
               WHERE c.audit_event_id = e.id
            ) AS changes
       FROM audit_events e
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.id DESC
      LIMIT $3 OFFSET $4`,
    params,
  );

  const items = rows.map(
    (r): AuditEvent => ({
      id: r.id,
      action: r.action,
      actorUserId: r.actor_user_id,
      actorLabel: r.actor_label,
      occurredAt: r.occurred_at,
      changes: r.changes ?? [],
    }),
  );

  return { items, info: pageInfo(bounds, totalItems) };
}
