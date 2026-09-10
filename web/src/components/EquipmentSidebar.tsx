import type { EquipmentDTO } from '../../../shared/contract.ts';
import { ErrorBox, Spinner, StatusPill } from './ui.tsx';

/**
 * The asset register.
 *
 * Two controls per row rather than one: selecting an asset and editing it are
 * different intents, and a row that did both depending on where you clicked
 * would be a trap. The edit control is only rendered for roles the API would
 * accept a write from -- showing a button that always 403s is not a UI.
 *
 * Note the markup: the row is a <li> containing two sibling <button>s, not a
 * button inside a button. Nesting them is invalid HTML and browsers recover
 * from it unpredictably.
 */
export function EquipmentSidebar({
  equipment,
  loading,
  error,
  selectedId,
  canManage,
  onSelect,
  onAdd,
  onEdit,
  onRetry,
}: {
  equipment: EquipmentDTO[];
  loading: boolean;
  error: unknown;
  selectedId: string | null;
  canManage: boolean;
  onSelect: (e: EquipmentDTO) => void;
  onAdd: () => void;
  onEdit: (e: EquipmentDTO) => void;
  onRetry: () => void;
}) {
  return (
    <nav className="sidebar" aria-label="Equipment">
      <div className="sidebar-head">
        <h2 className="sidebar-title">Equipment</h2>
        {canManage ? (
          <button type="button" className="btn btn-quiet btn-tiny" onClick={onAdd}>
            + Add
          </button>
        ) : null}
      </div>

      {error ? <ErrorBox error={error} onRetry={onRetry} /> : null}
      {loading ? <Spinner label="Loading equipment" /> : null}

      <ul className="asset-list">
        {equipment.map((e) => (
          <li key={e.id} className="asset-row">
            <button
              type="button"
              className={`asset${selectedId === e.id ? ' asset-on' : ''}`}
              onClick={() => onSelect(e)}
              aria-current={selectedId === e.id ? 'true' : undefined}
            >
              <span className="asset-code">{e.code}</span>
              <span className="asset-name">{e.name}</span>
              {e.status === 'retired' ? <StatusPill status={e.status} /> : null}
            </button>
            {canManage ? (
              <button
                type="button"
                className="asset-edit"
                onClick={() => onEdit(e)}
                aria-label={`Edit ${e.code}`}
                title={`Edit ${e.code}`}
              >
                {/* Inline, not an icon font or an SVG library: one glyph does
                    not justify a dependency. aria-hidden because the accessible
                    name is on the button. */}
                <span aria-hidden="true">✎</span>
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {!loading && !error && equipment.length === 0 ? (
        <p className="muted small">
          No equipment yet.{canManage ? ' Add the first asset above.' : ''}
        </p>
      ) : null}
    </nav>
  );
}
