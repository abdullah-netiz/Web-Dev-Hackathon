export const LEADS_QUEUE = 'leads';
export const ESCALATION_JOB = 'escalate-assignment';
export const OPEN_LEAD_STATUSES = ['NEW', 'ASSIGNED'] as const;

/** Deterministic job id `esc-<leadId>-<assignmentId>` so a re-enqueue never doubles an escalation (F3.8). */
export function escalationJobId(leadId: string, assignmentId: string): string {
  return `esc-${leadId}-${assignmentId}`;
}
