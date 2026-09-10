import type {
  CleaningRecordDTO,
  CleaningStatus,
  EquipmentDTO,
  PageInfo,
  UserDTO,
} from '../../../shared/contract.ts';
import { CLEANING_METHOD_LABELS, CLEANING_METHOD_SHORT } from '../../../shared/contract.ts';
import { formatDateTime } from '../api/format.ts';
import { Pagination } from './Pagination.tsx';
import { EmptyState, ErrorBox, Spinner, StatusPill } from './ui.tsx';

const FILTERS: { label: string; value: CleaningStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Verified', value: 'verified' },
];

export function RecordsTable({
  equipment,
  records,
  usersById,
  loading,
  error,
  pageInfo,
  filter,
  canVerify,
  selectedId,
  verifyingId,
  assetHistoryOpen,
  onFilterChange,
  onPageChange,
  onPageSizeChange,
  onAdd,
  onEdit,
  onVerify,
  onShowHistory,
  onShowAssetHistory,
  onRetry,
}: {
  equipment: EquipmentDTO;
  records: CleaningRecordDTO[];
  usersById: Map<string, UserDTO>;
  loading: boolean;
  error: unknown;
  pageInfo: PageInfo | null;
  filter: CleaningStatus | 'all';
  canVerify: boolean;
  selectedId: string | null;
  verifyingId: string | null;
  assetHistoryOpen: boolean;
  onFilterChange: (f: CleaningStatus | 'all') => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onAdd: () => void;
  onEdit: (r: CleaningRecordDTO) => void;
  onVerify: (r: CleaningRecordDTO) => void;
  onShowHistory: (r: CleaningRecordDTO) => void;
  onShowAssetHistory: () => void;
  onRetry: () => void;
}) {
  const nameOf = (id: string | null): string =>
    id ? (usersById.get(id)?.name ?? id.slice(0, 8)) : '—';

  return (
    <section className="records">
      <header className="records-head">
        <div>
          <div className="records-title">
            <h2>{equipment.code}</h2>
            <StatusPill status={equipment.status} />
          </div>
          <p className="muted">{equipment.name}</p>
        </div>
        <div className="records-actions">
          {/* Readable by every role, not only managers: an operator looking at
              a record dated before a rename should be able to see the rename. */}
          <button
            type="button"
            className="btn btn-quiet"
            onClick={onShowAssetHistory}
            aria-pressed={assetHistoryOpen}
          >
            Asset history
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onAdd}
            disabled={equipment.status === 'retired'}
            title={
              equipment.status === 'retired'
                ? 'Retired equipment cannot take new cleaning records'
                : undefined
            }
          >
            Add cleaning record
          </button>
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            type="button"
            aria-selected={filter === f.value}
            className={`tab${filter === f.value ? ' tab-on' : ''}`}
            onClick={() => onFilterChange(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? <ErrorBox error={error} onRetry={onRetry} /> : null}
      {loading ? <Spinner label="Loading records" /> : null}

      {!loading && !error && records.length === 0 ? (
        <EmptyState
          title="No cleaning records"
          hint={
            filter === 'all'
              ? 'Add the first one with the button above.'
              : `No records with status "${filter}".`
          }
        />
      ) : null}

      {records.length > 0 && (
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th scope="col">Cleaned at</th>
                <th scope="col">Method</th>
                <th scope="col">Cleaned by</th>
                <th scope="col">Status</th>
                <th scope="col">Verified by</th>
                <th scope="col">Notes</th>
                <th scope="col" className="right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className={selectedId === r.id ? 'row-on' : undefined}>
                  <td className="nowrap tnum">{formatDateTime(r.cleanedAt)}</td>
                  <td className="nowrap" title={CLEANING_METHOD_LABELS[r.method]}>
                    {CLEANING_METHOD_SHORT[r.method]}
                  </td>
                  <td className="nowrap">{nameOf(r.cleanedByUserId)}</td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td className="nowrap">{nameOf(r.verifiedByUserId)}</td>
                  <td className="notes" title={r.notes ?? undefined}>
                    {r.notes ?? <span className="muted">—</span>}
                  </td>
                  <td className="right nowrap">
                    <button type="button" className="btn btn-quiet" onClick={() => onEdit(r)}>
                      Edit
                    </button>
                    {/* Only offered to roles that may actually do it -- the
                        server enforces it regardless, but showing a button
                        that always fails is not a UI. */}
                    {canVerify && r.status === 'pending' ? (
                      <button
                        type="button"
                        className="btn btn-quiet"
                        onClick={() => onVerify(r)}
                        disabled={verifyingId === r.id}
                      >
                        {verifyingId === r.id ? 'Verifying…' : 'Verify'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => onShowHistory(r)}
                      aria-pressed={selectedId === r.id}
                    >
                      History
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Rendered whenever the server sent pageInfo, including for an empty
          result: the page-size control has to stay reachable, or a filter that
          matches nothing at 25 rows leaves the user with no way back. */}
      {pageInfo ? (
        <Pagination
          pageInfo={pageInfo}
          busy={loading}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}
    </section>
  );
}
