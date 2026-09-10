import type { PageInfo } from '../../../shared/contract.ts';
import { PAGE_SIZE_OPTIONS } from '../../../shared/contract.ts';
import { pageNumbers } from './pageNumbers.ts';

/**
 * Numbered pager.
 *
 * Numbered pages and a row count are the reason the API pages with
 * LIMIT/OFFSET rather than a cursor: a cursor names the last row seen, which
 * is enough to go forwards and nothing else. The trade is written up in
 * NOTES.md.
 */
export function Pagination({
  pageInfo,
  busy,
  onPageChange,
  onPageSizeChange,
}: {
  pageInfo: PageInfo;
  busy: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const { page, pageSize, totalItems, totalPages } = pageInfo;

  const first = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalItems);

  return (
    <nav className="pager" aria-label="Pagination">
      <div className="pager-size">
        <label htmlFor="pageSize">Rows</label>
        <select
          id="pageSize"
          value={pageSize}
          disabled={busy}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      {/* aria-live, so a screen reader hears the range change after a jump
          rather than only the button that was pressed. */}
      <p className="pager-count muted small" aria-live="polite">
        {totalItems === 0 ? 'No records' : `${first}–${last} of ${totalItems}`}
      </p>

      <div className="pager-controls">
        <button
          type="button"
          className="pager-btn"
          onClick={() => onPageChange(page - 1)}
          disabled={busy || page <= 1}
          aria-label="Previous page"
        >
          <span aria-hidden="true">‹</span>
        </button>

        {pageNumbers(page, totalPages).map((entry, i) =>
          entry === 'gap' ? (
            // Not a button: there is no single page it could sensibly go to,
            // and a focusable element that does nothing is worse than a glyph.
            <span key={`gap-${i}`} className="pager-gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              className={`pager-btn${entry === page ? ' pager-on' : ''}`}
              onClick={() => onPageChange(entry)}
              disabled={busy}
              aria-label={`Page ${entry}`}
              aria-current={entry === page ? 'page' : undefined}
            >
              {entry}
            </button>
          ),
        )}

        <button
          type="button"
          className="pager-btn"
          onClick={() => onPageChange(page + 1)}
          disabled={busy || page >= totalPages}
          aria-label="Next page"
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </nav>
  );
}
