import { z } from 'zod';

/**
 * Filter criteria used by list endpoints and saved lists (F2.6). Stored as JSON and compiled to a
 * Prisma `where` at read time, so saved lists update as records start or stop matching.
 */
export const criterionSchema = z.object({
  field: z.string().min(1).max(60), // built-in name or "custom.<key>"
  op: z.enum(['eq', 'neq', 'contains', 'in', 'gte', 'lte', 'between', 'isNull', 'notNull', 'hasTag', 'isTrue', 'isFalse']),
  value: z.unknown().optional(),
});

export const filtersSchema = z.object({
  logic: z.enum(['AND', 'OR']).default('AND'),
  criteria: z.array(criterionSchema).max(20).default([]),
  search: z.string().max(120).optional(),
});

export type Criterion = z.infer<typeof criterionSchema>;
export type Filters = z.infer<typeof filtersSchema>;

const BUILTIN_FIELDS: Record<string, { kind: 'string' | 'date' | 'number' | 'uuid' | 'tags' | 'enum' | 'bool' }> = {
  firstName: { kind: 'string' },
  lastName: { kind: 'string' },
  name: { kind: 'string' },
  email: { kind: 'string' },
  phone: { kind: 'string' },
  companyId: { kind: 'uuid' },
  contactId: { kind: 'uuid' },
  ownerId: { kind: 'uuid' },
  stageId: { kind: 'uuid' },
  pipelineId: { kind: 'uuid' },
  currentAssigneeId: { kind: 'uuid' },
  tags: { kind: 'tags' },
  status: { kind: 'enum' },
  source: { kind: 'enum' },
  paymentStatus: { kind: 'enum' },
  recoveryReason: { kind: 'enum' },
  optedOut: { kind: 'bool' },
  createdAt: { kind: 'date' },
  updatedAt: { kind: 'date' },
  closeDate: { kind: 'date' },
  dueAt: { kind: 'date' },
  value: { kind: 'number' },
};

type Where = Record<string, unknown>;

export function compileFilters(filters: Filters | undefined, searchFields: string[]): Where {
  if (!filters) return {};
  const parts = filters.criteria.map(compileCriterion).filter((part): part is Where => Boolean(part));
  const where: Where = parts.length ? (filters.logic === 'OR' ? { OR: parts } : { AND: parts }) : {};
  if (filters.search?.trim()) {
    const term = filters.search.trim();
    where.AND = [...((where.AND as Where[] | undefined) ?? []), { OR: searchFields.map((field) => ({ [field]: { contains: term, mode: 'insensitive' } })) }];
  }
  return where;
}

function compileCriterion(criterion: Criterion): Where | null {
  const { field, op, value } = criterion;

  if (field.startsWith('custom.')) {
    const key = field.slice('custom.'.length);
    switch (op) {
      case 'eq':
      case 'isTrue':
      case 'isFalse':
        return { custom: { path: [key], equals: op === 'eq' ? value : op === 'isTrue' } };
      case 'neq':
        return { NOT: { custom: { path: [key], equals: value } } };
      case 'contains':
        return { custom: { path: [key], string_contains: String(value ?? '') } };
      case 'gte':
        return { custom: { path: [key], gte: value } };
      case 'lte':
        return { custom: { path: [key], lte: value } };
      case 'between':
        return Array.isArray(value) ? { AND: [{ custom: { path: [key], gte: value[0] } }, { custom: { path: [key], lte: value[1] } }] } : null;
      case 'in':
        return Array.isArray(value) ? { OR: value.map((item) => ({ custom: { path: [key], equals: item } })) } : null;
      case 'isNull':
        return { OR: [{ custom: { path: [key], equals: null } }, { NOT: { custom: { path: [key], not: null } } }] };
      case 'notNull':
        return { custom: { path: [key], not: null } };
      default:
        return null;
    }
  }

  const spec = BUILTIN_FIELDS[field];
  if (!spec) return null;

  switch (op) {
    case 'eq':
      return { [field]: spec.kind === 'date' ? new Date(String(value)) : value };
    case 'neq':
      return { NOT: { [field]: spec.kind === 'date' ? new Date(String(value)) : value } };
    case 'contains':
      return spec.kind === 'string' ? { [field]: { contains: String(value ?? ''), mode: 'insensitive' } } : null;
    case 'in':
      return Array.isArray(value) ? { [field]: { in: value } } : null;
    case 'gte':
      return { [field]: { gte: spec.kind === 'date' ? new Date(String(value)) : value } };
    case 'lte':
      return { [field]: { lte: spec.kind === 'date' ? new Date(String(value)) : value } };
    case 'between':
      return Array.isArray(value) ? { [field]: { gte: spec.kind === 'date' ? new Date(String(value[0])) : value[0], lte: spec.kind === 'date' ? new Date(String(value[1])) : value[1] } } : null;
    case 'isNull':
      return { [field]: null };
    case 'notNull':
      return { NOT: { [field]: null } };
    case 'hasTag':
      return spec.kind === 'tags' ? { tags: { has: String(value) } } : null;
    case 'isTrue':
      return { [field]: true };
    case 'isFalse':
      return { [field]: false };
    default:
      return null;
  }
}
