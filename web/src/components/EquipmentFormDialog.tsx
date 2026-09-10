import { useEffect, useRef, useState } from 'react';
import type {
  EquipmentDTO,
  EquipmentStatus,
  UpdateEquipmentRequest,
} from '../../../shared/contract.ts';
import { ApiError, api } from '../api/client.ts';
import { ErrorBox, Field } from './ui.tsx';

/**
 * One form for adding and editing an asset.
 *
 * Like the record form, an edit sends only the fields that actually moved.
 * Submitting every field on every save would be indistinguishable, server
 * side, from the user having edited them all, and the asset's audit trail
 * would fill with changes nobody made.
 *
 * Retirement lives here rather than in the sidebar because it is the one
 * destructive-looking action in the app, and it deserves the deliberateness of
 * being inside a dialog with a confirmation step -- even though nothing is
 * actually destroyed: the row stays and its status changes, so the cleaning
 * history keeps a parent to point at.
 */
export function EquipmentFormDialog({
  equipment,
  onSaved,
  onCancel,
}: {
  equipment: EquipmentDTO | null;
  onSaved: (equipment: EquipmentDTO, created: boolean) => void;
  onCancel: () => void;
}) {
  const editing = equipment !== null;
  const dialogRef = useRef<HTMLDivElement>(null);

  const [code, setCode] = useState(equipment?.code ?? '');
  const [name, setName] = useState(equipment?.name ?? '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('input')?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  /** Client-side mirror of the server's Zod rules, so the common mistakes do
   *  not need a round trip. The server still validates; this is not a gate. */
  function localError(): ApiError | null {
    const details: { path: string; message: string }[] = [];
    if (code.trim().length < 2) details.push({ path: 'code', message: 'At least 2 characters.' });
    if (code.trim().length > 32) details.push({ path: 'code', message: 'At most 32 characters.' });
    if (name.trim().length < 1) details.push({ path: 'name', message: 'Required.' });
    if (name.trim().length > 120) details.push({ path: 'name', message: 'At most 120 characters.' });
    return details.length
      ? new ApiError(400, 'bad_request', 'Please correct the highlighted fields.', details)
      : null;
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();

    const invalid = localError();
    if (invalid) {
      setError(invalid);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (editing && equipment) {
        const patch: UpdateEquipmentRequest = {};
        if (code.trim() !== equipment.code) patch.code = code.trim();
        if (name.trim() !== equipment.name) patch.name = name.trim();

        if (Object.keys(patch).length === 0) {
          onCancel(); // nothing moved, so do not trouble the server
          return;
        }

        const res = await api.updateEquipment(equipment.id, patch);
        onSaved(res.data, false);
      } else {
        const res = await api.createEquipment({ code: code.trim(), name: name.trim() });
        onSaved(res.data, true);
      }
    } catch (err) {
      setError(err); // the form keeps every value the user entered
    } finally {
      setBusy(false);
    }
  }

  async function retire(): Promise<void> {
    if (!equipment) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.retireEquipment(equipment.id);
      onSaved(res.data, false);
    } catch (err) {
      setError(err);
      setConfirmRetire(false);
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (path: string): string | undefined =>
    error instanceof ApiError ? error.forField(path) : undefined;

  const status: EquipmentStatus = equipment?.status ?? 'active';

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="equipment-dialog-title"
        ref={dialogRef}
      >
        <h2 id="equipment-dialog-title">{editing ? 'Edit equipment' : 'Add equipment'}</h2>

        <form onSubmit={submit} noValidate>
          {error ? <ErrorBox error={error} /> : null}

          <Field
            label="Code"
            htmlFor="equipment-code"
            error={fieldError('code')}
            hint="Short unique identifier, e.g. TNK-101. Renaming it is recorded in the audit trail."
          >
            <input
              id="equipment-code"
              value={code}
              maxLength={32}
              autoComplete="off"
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </Field>

          <Field label="Name" htmlFor="equipment-name" error={fieldError('name')}>
            <input
              id="equipment-name"
              value={name}
              maxLength={120}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>

          {editing && status === 'active' ? (
            <div className="danger-zone">
              {confirmRetire ? (
                <>
                  <p className="small">
                    Retiring stops new cleaning records being logged against this asset. Nothing is
                    deleted — the record history stays, and the change is written to the audit
                    trail.
                  </p>
                  <div className="danger-actions">
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => setConfirmRetire(false)}
                      disabled={busy}
                    >
                      Keep active
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => void retire()}
                      disabled={busy}
                    >
                      {busy ? 'Retiring…' : 'Yes, retire it'}
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-quiet danger-link"
                  onClick={() => setConfirmRetire(true)}
                  disabled={busy}
                >
                  Retire this equipment
                </button>
              )}
            </div>
          ) : null}

          {editing && status === 'retired' ? (
            <p className="muted small">
              This asset is retired. Retirement is one-way in this build; bringing it back would be
              a new status transition and a new audit action.
            </p>
          ) : null}

          <div className="dialog-actions">
            <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add equipment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
