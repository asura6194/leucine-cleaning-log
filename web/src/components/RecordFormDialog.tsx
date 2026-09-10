import { useEffect, useRef, useState } from 'react';
import type {
  CleaningMethod,
  CleaningRecordDTO,
  UpdateCleaningRecordRequest,
  UserDTO,
} from '../../../shared/contract.ts';
import { CLEANING_METHOD_LABELS } from '../../../shared/contract.ts';
import { ApiError, api } from '../api/client.ts';
import { fromLocalInputValue, toLocalInputValue } from '../api/format.ts';
import { ErrorBox, Field } from './ui.tsx';

const METHODS = Object.keys(CLEANING_METHOD_LABELS) as CleaningMethod[];

/** Sentinel for the "me" option. A select cannot hold undefined, so empty
 *  string means "the signed-in user" and is resolved to a real id on submit --
 *  never sent to the server, which requires a uuid. */
const ME = '';

/**
 * One form for both add and edit.
 *
 * On edit it sends only the fields the user actually changed. That is not an
 * optimisation -- it is what keeps the audit trail honest: submitting every
 * field on every save would be indistinguishable, server-side, from the user
 * having edited them all, and every save would record changes that never
 * happened.
 */
export function RecordFormDialog({
  equipmentId,
  record,
  users,
  currentUser,
  onSaved,
  onCancel,
}: {
  equipmentId: string;
  record: CleaningRecordDTO | null;
  users: UserDTO[];
  currentUser: UserDTO;
  onSaved: (record: CleaningRecordDTO) => void;
  onCancel: () => void;
}) {
  const editing = record !== null;
  const dialogRef = useRef<HTMLDivElement>(null);

  /**
   * The datetime-local input has MINUTE precision, but stored timestamps have
   * seconds and milliseconds. So the original is kept in the input's own
   * precision and compared against that -- never against `record.cleanedAt`.
   *
   * Comparing against the stored ISO string was a real bug: the round trip
   * through the input dropped the seconds, so the value always looked
   * different, and every edit of any other field also wrote a phantom
   * "cleaned at" line into the audit trail. 96 of 98 seeded records have
   * non-zero seconds, so it fired almost every time.
   */
  const originalCleanedAtInput = record ? toLocalInputValue(record.cleanedAt) : '';

  const [cleanedByUserId, setCleanedBy] = useState(record?.cleanedByUserId ?? ME);
  const [cleanedAt, setCleanedAt] = useState(
    record ? originalCleanedAtInput : toLocalInputValue(new Date().toISOString()),
  );
  const [method, setMethod] = useState<CleaningMethod>(record?.method ?? 'manual');
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();

    // The form is noValidate so errors render in our own style, which means
    // required-ness has to be checked here. Without this, an empty date
    // reached new Date('').toISOString() and threw a raw "Invalid time value".
    if (!cleanedAt || Number.isNaN(new Date(cleanedAt).getTime())) {
      setError(
        new ApiError(400, 'bad_request', 'Please correct the highlighted field.', [
          { path: 'cleanedAt', message: 'Enter a valid date and time.' },
        ]),
      );
      return;
    }

    // "me" is a UI convenience, not a value the API understands.
    const resolvedCleanedBy = cleanedByUserId === ME ? currentUser.id : cleanedByUserId;

    setBusy(true);
    setError(null);
    try {
      if (editing && record) {
        const patch: UpdateCleaningRecordRequest = {};

        if (resolvedCleanedBy !== record.cleanedByUserId) {
          patch.cleanedByUserId = resolvedCleanedBy;
        }
        // Compared in the input's precision, for the reason above.
        if (cleanedAt !== originalCleanedAtInput) {
          patch.cleanedAt = fromLocalInputValue(cleanedAt);
        }
        if (method !== record.method) patch.method = method;

        // An empty box and no note are the same absence. Sending null clears
        // it; omitting the key leaves it alone. Those are different requests
        // and the audit trail treats them differently.
        const trimmed = notes.trim();
        const nextNotes = trimmed === '' ? null : trimmed;
        if (nextNotes !== record.notes) patch.notes = nextNotes;

        if (Object.keys(patch).length === 0) {
          onCancel(); // nothing moved, so do not trouble the server
          return;
        }

        const res = await api.updateRecord(record.id, patch);
        onSaved(res.data);
      } else {
        const res = await api.createRecord(equipmentId, {
          cleanedByUserId: resolvedCleanedBy,
          cleanedAt: fromLocalInputValue(cleanedAt),
          method,
          notes: notes.trim() === '' ? null : notes.trim(),
        });
        onSaved(res.data);
      }
    } catch (err) {
      setError(err); // the form keeps every value the user entered
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (path: string): string | undefined =>
    error instanceof ApiError ? error.forField(path) : undefined;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        ref={dialogRef}
      >
        <h2 id="dialog-title">{editing ? 'Edit cleaning record' : 'Add cleaning record'}</h2>

        <form onSubmit={submit} noValidate>
          {error ? <ErrorBox error={error} /> : null}

          <Field
            label="Cleaned by"
            htmlFor="cleanedBy"
            error={fieldError('cleanedByUserId')}
            hint="Whoever actually performed the cleaning — not necessarily you."
          >
            <select
              id="cleanedBy"
              value={cleanedByUserId}
              onChange={(e) => setCleanedBy(e.target.value)}
            >
              <option value={ME}>Me — {currentUser.name}</option>
              {users
                .filter((u) => u.id !== currentUser.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
            </select>
          </Field>

          <Field
            label="Cleaned at"
            htmlFor="cleanedAt"
            error={fieldError('cleanedAt')}
            hint="May be back-dated after a shift, but not in the future."
          >
            <input
              id="cleanedAt"
              type="datetime-local"
              value={cleanedAt}
              onChange={(e) => setCleanedAt(e.target.value)}
              required
            />
          </Field>

          <Field label="Method" htmlFor="method" error={fieldError('method')}>
            <select
              id="method"
              value={method}
              onChange={(e) => setMethod(e.target.value as CleaningMethod)}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {CLEANING_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Notes"
            htmlFor="notes"
            error={fieldError('notes')}
            hint="Optional. Clearing it is recorded in the audit trail."
          >
            <textarea
              id="notes"
              rows={3}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>

          <div className="dialog-actions">
            <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
