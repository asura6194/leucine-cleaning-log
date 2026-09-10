import type { CleaningMethod } from '../../../shared/contract.ts';
import { CLEANING_METHOD_LABELS } from '../../../shared/contract.ts';

/**
 * Timestamps cross the wire as ISO-8601 UTC and are rendered in the viewer's
 * own zone, with the zone shown. An audit trail that displays a bare local
 * time is ambiguous the moment anyone reads it from another country.
 */
const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const dateTimeWithZone = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'long',
});

export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));
export const formatDateTimeFull = (iso: string): string => dateTimeWithZone.format(new Date(iso));

/** For a datetime-local input, which wants local time with no zone suffix. */
export function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A datetime-local value is local wall time; the API wants an instant. */
export const fromLocalInputValue = (value: string): string => new Date(value).toISOString();

/**
 * Renders an audit value for display.
 *
 * Three rules:
 *   - An empty value is an explicit dash, so "was cleared" reads differently
 *     from "nothing here".
 *   - A canonical ISO-8601 timestamp is rendered like every other date in the
 *     UI, rather than leaking the storage format.
 *   - An enum member is shown with the same label used everywhere else, so the
 *     history does not say `cop` where the table said "Clean-out-of-place".
 *     The stored value is untouched; this is presentation only.
 */
export const auditValue = (fieldName: string, value: string | null): string => {
  if (value === null) return '—';

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return formatDateTime(value);

  if (fieldName === 'method' && value in CLEANING_METHOD_LABELS) {
    return CLEANING_METHOD_LABELS[value as CleaningMethod];
  }

  return value;
};
