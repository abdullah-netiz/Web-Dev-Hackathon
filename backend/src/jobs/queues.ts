export const QUEUES = {
  escalation: 'escalation', // delayed job per acknowledgement window
  integrations: 'integrations', // outbound provider calls (Twilio, Lemon Squeezy, Google)
  alerts: 'alerts', // Slack escalation alerts
  inbound: 'inbound', // verified inbound webhooks (Twilio, Lemon Squeezy) processed off the request path
  payments: 'payments', // payment expiry sweep
  housekeeping: 'housekeeping', // recovery sweep, metrics, reconciliation
} as const;

export const JOB_NAMES = {
  escalate: 'escalate',
  sendMessage: 'send-message',
  sendAlert: 'send-alert',
  processInbound: 'process-inbound',
  recoverySweep: 'recovery-sweep',
  reconcile: 'reconcile',
  expirePayments: 'expire-payments',
} as const;

/** BullMQ job ids must not contain ':' (docs.bullmq.io/guide/jobs/job-ids). */
export function escalationJobId(leadId: string, assignmentId: string): string {
  return `esc-${leadId}-${assignmentId}`;
}

export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86400 },
};
