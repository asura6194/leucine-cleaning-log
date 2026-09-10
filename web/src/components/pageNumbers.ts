/**
 * The page numbers to render: always the first and last, always the current
 * and its neighbours, with a gap standing in for the rest.
 *
 * In its own module, with no JSX and no React import, so it can be tested as
 * the plain function it is. The window is a fixed width once it abbreviates,
 * so the control never changes size as you move through it -- a pager that
 * reflows under the cursor makes you misclick.
 */
export function pageNumbers(page: number, totalPages: number): (number | 'gap')[] {
  // Seven or fewer fits without abbreviating, and abbreviating anyway would
  // hide pages for no gain.
  if (totalPages <= 7) return range(1, totalPages);

  if (page <= 4) return [...range(1, 5), 'gap', totalPages];
  if (page >= totalPages - 3) return [1, 'gap', ...range(totalPages - 4, totalPages)];
  return [1, 'gap', page - 1, page, page + 1, 'gap', totalPages];
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
