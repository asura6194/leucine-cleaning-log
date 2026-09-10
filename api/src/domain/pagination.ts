/**
 * Offset pagination.
 *
 * One contract for every list endpoint: `?page=&pageSize=` in, `pageInfo` out.
 * A pure module -- no Express, no pg -- so the arithmetic that decides which
 * rows a page covers is testable without a server or a database, and so there
 * is exactly one place where "page 3 of 25 rows" turns into LIMIT and OFFSET.
 *
 * Why offset rather than keyset, given the list is ordered by a timestamp:
 * the UI has numbered pages and a total, and neither is expressible with a
 * cursor -- a cursor names the last row seen, which is enough to go forwards
 * and nothing else. The cost is real but bounded by size: OFFSET makes the
 * database walk past every skipped row, and the total needs a COUNT. At a few
 * thousand records per asset both are sub-millisecond; the point where it
 * stops being free, and what to do then, is written up in NOTES.md.
 */
import { config } from '../config.js';
import type { PageInfo } from '../../../shared/contract.js';

export type PageRequest = { page?: number; pageSize?: number };

/** Resolved bounds for one page: what to put in LIMIT and OFFSET. */
export type PageBounds = { limit: number; offset: number; page: number; pageSize: number };

/**
 * Turns a requested page into bounds, given how many rows actually match.
 *
 * Clamping happens here rather than in each repository, so every endpoint
 * behaves the same way at the edges:
 *
 *   pageSize   clamped to the configured maximum, so no caller can ask for an
 *              unbounded response by sending pageSize=1000000
 *   page       clamped to the last page that exists. Page 9 of a 12-page list
 *              stops existing the moment the page size changes from 10 to 25,
 *              and the honest answer is the last page plus a pageInfo saying
 *              which page that turned out to be -- not an empty grid the user
 *              has to diagnose, and not a 404 for a page they can see a button
 *              for.
 */
export function resolvePage(request: PageRequest, totalItems: number): PageBounds {
  const pageSize = Math.min(
    request.pageSize && request.pageSize > 0 ? request.pageSize : config.pagination.defaultLimit,
    config.pagination.maxLimit,
  );

  // An empty list is ONE empty page, not zero pages: the pager still has to
  // render, and "page 1 of 0" is not a thing.
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(Math.max(1, request.page ?? 1), totalPages);

  return { limit: pageSize, offset: (page - 1) * pageSize, page, pageSize };
}

export function pageInfo(bounds: PageBounds, totalItems: number): PageInfo {
  return {
    page: bounds.page,
    pageSize: bounds.pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / bounds.pageSize)),
  };
}
