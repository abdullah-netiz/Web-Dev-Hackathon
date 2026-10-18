import type { OpportunityRow } from './opportunities/opportunities.repository';

/**
 * `value` is hidden unless the caller may see amounts (F1.4). Every opportunity
 * response — list or single — passes through here.
 */
export function serializeOpportunity<T extends { value: unknown }>(
  opportunity: T,
  permissions: readonly string[],
): Omit<T, 'value'> & { value?: T['value'] } {
  if (permissions.includes('crm.view_values')) {
    return opportunity;
  }
  const { value: _hidden, ...rest } = opportunity;
  return rest;
}

export function serializeOpportunities(
  rows: OpportunityRow[],
  permissions: readonly string[],
): Array<Omit<OpportunityRow, 'value'> & { value?: OpportunityRow['value'] }> {
  return rows.map((row) => serializeOpportunity(row, permissions));
}
