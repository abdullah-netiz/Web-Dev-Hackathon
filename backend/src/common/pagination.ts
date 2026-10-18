import { z } from 'zod';

/**
 * Keyset pagination on (createdAt desc, id) (Q9). Cursor = base64url(`${createdAtISO}|${id}`).
 * Lists return `{ data, meta: { nextCursor, hasMore, total? } }`.
 */
export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
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

/** Prisma `where` fragment that continues after the cursor for `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`. */
export function cursorWhere(cursor?: string) {
  const decoded = decodeCursor(cursor);
  if (!decoded) return {};
  return {
    OR: [{ createdAt: { lt: decoded.createdAt } }, { createdAt: decoded.createdAt, id: { lt: decoded.id } }],
  };
}

export function pageResult<T extends { createdAt: Date; id: string }>(rows: T[], limit: number, total?: number) {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return { data, meta: { nextCursor: hasMore && last ? encodeCursor(last) : null, hasMore, total } };
}
