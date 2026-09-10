/**
 * The page-number window.
 *
 * A pure function with no DOM, so it needs no rendering library to test. The
 * properties asserted are the ones a pager actually gets wrong: losing the
 * current page, changing width as you move through it, or drawing a gap that
 * hides nothing.
 */
import { describe, expect, it } from 'vitest';
import { pageNumbers } from '../src/components/pageNumbers.ts';

describe('pageNumbers', () => {
  it('shows every page when they all fit', () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('abbreviates the tail when near the start', () => {
    expect(pageNumbers(1, 12)).toEqual([1, 2, 3, 4, 5, 'gap', 12]);
    expect(pageNumbers(4, 12)).toEqual([1, 2, 3, 4, 5, 'gap', 12]);
  });

  it('abbreviates the head when near the end', () => {
    expect(pageNumbers(12, 12)).toEqual([1, 'gap', 8, 9, 10, 11, 12]);
    expect(pageNumbers(9, 12)).toEqual([1, 'gap', 8, 9, 10, 11, 12]);
  });

  it('abbreviates both sides in the middle', () => {
    expect(pageNumbers(6, 12)).toEqual([1, 'gap', 5, 6, 7, 'gap', 12]);
  });

  it('always contains the current page', () => {
    for (let total = 1; total <= 40; total++) {
      for (let page = 1; page <= total; page++) {
        expect(pageNumbers(page, total), `page ${page} of ${total}`).toContain(page);
      }
    }
  });

  it('always offers the first and last page, so no page is unreachable', () => {
    for (let total = 1; total <= 40; total++) {
      for (let page = 1; page <= total; page++) {
        const w = pageNumbers(page, total);
        expect(w[0]).toBe(1);
        expect(w[w.length - 1]).toBe(total);
      }
    }
  });

  it('keeps a constant width once abbreviating, so the control does not reflow', () => {
    // A pager that changes size under the cursor makes you misclick.
    for (let total = 8; total <= 40; total++) {
      for (let page = 1; page <= total; page++) {
        expect(pageNumbers(page, total), `page ${page} of ${total}`).toHaveLength(7);
      }
    }
  });

  it('never emits a gap that stands for nothing', () => {
    // A gap between 4 and 6 hides exactly one page and should have been that
    // page instead. Every gap must skip at least two.
    for (let total = 1; total <= 40; total++) {
      for (let page = 1; page <= total; page++) {
        const w = pageNumbers(page, total);
        w.forEach((entry, i) => {
          if (entry !== 'gap') return;
          const before = w[i - 1] as number;
          const after = w[i + 1] as number;
          expect(after - before, `gap between ${before} and ${after}`).toBeGreaterThan(2);
        });
      }
    }
  });

  it('is strictly increasing, with no repeats', () => {
    for (let total = 1; total <= 40; total++) {
      for (let page = 1; page <= total; page++) {
        const nums = pageNumbers(page, total).filter((e): e is number => e !== 'gap');
        expect([...nums]).toEqual([...new Set(nums)].sort((a, b) => a - b));
      }
    }
  });
});
