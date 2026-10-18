import { z } from 'zod';

/**
 * Keyset pagination on (createdAt desc, id) (Q9). Cursor = base64url(`${createdAtISO}|${id}`).
 * Lists return `{ data, meta: { nextCursor, hasMore, total? } }`.
 */
export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** 1-based page for numbered tables; ignored when a cursor is given. */
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function decodeCursor(cursor?: string): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

/**
 * Prisma `where` fragment that continues after the cursor for `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`.
 * Expressed with `NOT` so spreading it never overwrites an `OR` (permission scope) or `AND` (filters) in the same object.
 */
export function cursorWhere(cursor?: string) {
  const decoded = decodeCursor(cursor);
  if (!decoded) return {};
  return {
    NOT: { OR: [{ createdAt: { gt: decoded.createdAt } }, { createdAt: decoded.createdAt, id: { gte: decoded.id } }] },
  };
}

/** Offset for numbered pages (Q9: several hundred records, so offset cost is negligible). */
export function skipFor(p: { page?: number; cursor?: string; limit: number }): number {
  return p.page && !p.cursor ? (p.page - 1) * p.limit : 0;
}

export function pageResult<T extends { createdAt: Date; id: string }>(rows: T[], limit: number, total?: number) {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return { data, meta: { nextCursor: hasMore && last ? encodeCursor(last) : null, hasMore, total } };
}
