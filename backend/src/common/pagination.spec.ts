import { describe, expect, it } from 'vitest';
import { paginate } from './pagination';

const row = (id: string) => ({ id });

describe('paginate (keyset)', () => {
  it('returns every row when the page is not full', () => {
    const result = paginate([row('a'), row('b')], 5);
    expect(result.items).toHaveLength(2);
    expect(result.meta).toEqual({ hasMore: false, nextCursor: null });
  });

  it('trims the look-ahead row and reports the next cursor', () => {
    const result = paginate([row('a'), row('b'), row('c')], 2);
    expect(result.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(result.meta).toEqual({ hasMore: true, nextCursor: 'b' });
  });

  it('handles an empty result', () => {
    expect(paginate([], 10).meta).toEqual({ hasMore: false, nextCursor: null });
  });
});
