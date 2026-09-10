import type { ReactNode } from 'react';
import type { CleaningStatus, EquipmentStatus } from '../../../shared/contract.ts';
import { ApiError } from '../api/client.ts';

/**
 * State is encoded in form as well as in text -- a coloured pill, not just a
 * word -- so what needs attention reads at a glance rather than requiring the
 * row to be read.
 */
export function StatusPill({ status }: { status: CleaningStatus | EquipmentStatus }) {
  return <span className={`pill pill-${status}`}>{status}</span>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}…
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="state">
      <strong>{title}</strong>
      {hint ? <span className="muted">{hint}</span> : null}
    </div>
  );
}

/**
 * Errors say what went wrong and, where the server named fields, which ones.
 * No apologies, no "something went wrong" when we know more than that.
 */
export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof ApiError ? error.details : [];

  return (
    <div className="errorbox" role="alert">
      <div className="errorbox-msg">{message}</div>
      {details.length > 0 && (
        <ul className="errorbox-details">
          {details.map((d, i) => (
            <li key={i}>
              <code>{d.path}</code> {d.message}
            </li>
          ))}
        </ul>
      )}
      {onRetry && (
        <button type="button" className="btn btn-quiet" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string;
  children: ReactNode;
}) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;
  return (
    <div className={`field${error ? ' field-invalid' : ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error ? (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="field-error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
