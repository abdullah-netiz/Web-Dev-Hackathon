import { z } from 'zod';

const optionalText = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).max(120).optional(),
);

/** Shared list query: keyset pagination + full-text search term (Q6, Q9). */
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
  q: optionalText,
});

export type ListQuery = z.infer<typeof listQuerySchema>;

/** Fetches one extra row so the caller can tell whether another page exists. */
export function keysetArgs(query: ListQuery): {
  take: number;
  skip?: number;
  cursor?: { id: string };
} {
  return {
    take: query.limit + 1,
    ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
  };
}

export interface PageMeta {
  nextCursor: string | null;
  hasMore: boolean;
}

export function paginate<T extends { id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; meta: PageMeta } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, meta: { hasMore, nextCursor: hasMore && last ? last.id : null } };
}

export function paginatedResponse<T extends { id: string }>(
  rows: T[],
  limit: number,
): { data: T[]; meta: PageMeta } {
  const { items, meta } = paginate(rows, limit);
  return { data: items, meta };
}
