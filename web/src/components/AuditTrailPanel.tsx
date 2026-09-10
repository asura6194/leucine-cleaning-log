import { useCallback, useEffect, useState } from 'react';
import type { AuditEventDTO } from '../../../shared/contract.ts';
import { AUDIT_FIELD_LABELS } from '../../../shared/contract.ts';
import { api } from '../api/client.ts';
import { auditValue, formatDateTimeFull } from '../api/format.ts';
import { EmptyState, ErrorBox, Spinner } from './ui.tsx';

/**
 * What the panel is showing history for. The audit tables are polymorphic on
 * (entity_type, entity_id), so the panel is too -- one component serves both
 * trails rather than a near-copy per entity.
 */
export type AuditSubject = {
  kind: 'cleaning_record' | 'equipment';
  id: string;
  /** Shown under the heading, so the drawer says what it is about. */
  label: string;
};

const HEADINGS: Record<AuditSubject['kind'], { title: string; hint: string }> = {
  cleaning_record: {
    title: 'Change history',
    hint: 'Editing this record will record an entry here.',
  },
  equipment: {
    title: 'Asset history',
    hint: 'Renaming or retiring this asset will record an entry here.',
  },
};

/**
 * The field-level history for one audited row.
 *
 * Rendered as one block per EVENT, with a row per field inside it -- which is
 * the shape the two-table audit design produces. Flattening it to one row per
 * field change would lose the fact that "Priya changed the method and the
 * notes" was a single act.
 */
export function AuditTrailPanel({
  subject,
  onClose,
}: {
  subject: AuditSubject;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<AuditEventDTO[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const { kind, id } = subject;

  const load = useCallback(async () => {
    setError(null);
    setEvents(null);
    try {
      const page =
        kind === 'equipment'
          ? await api.equipmentAudit(id, { pageSize: 50 })
          : await api.auditHistory(id, { pageSize: 50 });
      setEvents(page.data);
    } catch (err) {
      setError(err);
    }
  }, [kind, id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <aside className="drawer" aria-label="Audit trail">
      <header className="drawer-head">
        <div>
          <span className="eyebrow">Audit trail</span>
          <h2>{HEADINGS[kind].title}</h2>
          <p className="muted small">{subject.label}</p>
          <p className="muted mono small">{id}</p>
        </div>
        <button type="button" className="btn btn-quiet" onClick={onClose} aria-label="Close audit trail">
          Close
        </button>
      </header>

      <div className="drawer-body">
        {error ? <ErrorBox error={error} onRetry={() => void load()} /> : null}
        {!error && events === null ? <Spinner label="Loading history" /> : null}

        {events?.length === 0 ? (
          <EmptyState title="No history yet" hint={HEADINGS[kind].hint} />
        ) : null}

        {events?.map((event) => (
          <article key={event.id} className="event">
            <header className="event-head">
              <span className={`tag tag-${event.action}`}>{event.action}</span>
              <strong>{event.actorLabel}</strong>
              <time dateTime={event.occurredAt}>{formatDateTimeFull(event.occurredAt)}</time>
            </header>

            {event.changes.length === 0 ? (
              <p className="muted small">No field changes recorded.</p>
            ) : (
              // A real table with header cells: this is tabular data, and a
              // screen reader should be able to navigate it as such.
              <table className="changes">
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">Was</th>
                    <th scope="col">Became</th>
                  </tr>
                </thead>
                <tbody>
                  {event.changes.map((c) => (
                    <tr key={c.fieldName}>
                      <th scope="row">{AUDIT_FIELD_LABELS[c.fieldName] ?? c.fieldName}</th>
                      <td className="was">{auditValue(c.fieldName, c.oldValue)}</td>
                      <td className="became">{auditValue(c.fieldName, c.newValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        ))}
      </div>
    </aside>
  );
}
