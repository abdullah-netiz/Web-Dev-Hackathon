export type WidgetUnit = 'count' | 'currency' | 'seconds' | 'people';

export interface WidgetDefinition {
  key: string;
  label: string;
  definition: string;
  unit: WidgetUnit;
  personal: boolean;
}

/**
 * One definition per figure, worded to match Section 7, so the dashboard, lists
 * and exports can never disagree (F5.2, Q12).
 */
export const WIDGETS: WidgetDefinition[] = [
  {
    key: 'leads_new_today',
    label: 'New leads today',
    definition: 'Leads created from any intake source since the start of today.',
    unit: 'count',
    personal: true,
  },
  {
    key: 'avg_first_response',
    label: 'Average time to first response',
    definition: "Time from a lead's first assignment to its first acknowledgement.",
    unit: 'seconds',
    personal: true,
  },
  {
    key: 'recovery_queue',
    label: 'Recovery queue',
    definition:
      'Leads unacknowledged beyond their window, escalated two or more times, or with no recorded action for the configured idle period.',
    unit: 'count',
    personal: true,
  },
  {
    key: 'escalations_24h',
    label: 'Escalations (24h)',
    definition:
      'Automatic reassignments caused by an expired acknowledgement window in the last 24 hours; manual reassignments are counted separately.',
    unit: 'count',
    personal: false,
  },
  {
    key: 'pipeline_value_by_stage',
    label: 'Open pipeline value by stage',
    definition:
      'Sum of values of opportunities not in a won or lost stage, grouped by stage; shown only to users permitted to see values.',
    unit: 'currency',
    personal: false,
  },
  {
    key: 'team_availability',
    label: 'Team availability',
    definition:
      'Members by status; an available employee has status Available and an open-lead count below the configured limit.',
    unit: 'people',
    personal: false,
  },
  {
    key: 'upcoming_appointments',
    label: 'Upcoming appointments',
    definition: 'Appointments created from the platform that are scheduled to start from now on.',
    unit: 'count',
    personal: true,
  },
  {
    key: 'payments_this_month',
    label: 'Payments received this month',
    definition: "Collected revenue: payments confirmed by the provider's webhook, minus confirmed refunds.",
    unit: 'currency',
    personal: false,
  },
];

export const WIDGET_KEYS: string[] = WIDGETS.map((widget) => widget.key);

export function isWidgetKey(value: string): boolean {
  return WIDGET_KEYS.includes(value);
}
