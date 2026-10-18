/**
 * Pure decision logic for the lead engine. No I/O, fully unit-tested (F3.3, F3.5, F3.7, F3.8).
 * Definitions follow Section 7 of the problem statement.
 */

export type AvailabilityStatus = 'AVAILABLE' | 'BUSY' | 'ON_LEAVE' | 'OFFLINE';
export type LeadStatus = 'NEW' | 'ASSIGNED' | 'ACKNOWLEDGED' | 'CLOSED';
export type RecoveryReason = 'NONE' | 'OVERDUE' | 'ESCALATED_TWICE' | 'IDLE';

export type Candidate = {
  userId: string;
  availability: AvailabilityStatus;
  maxOpenLeads: number | null;
  openLeadCount: number;
  backupUserId: string | null;
  isManager: boolean;
  lastAssignedAt: Date | null;
};

/** "Available employee": status Available and open-lead count below the configured limit (Section 7). */
export function isEligible(candidate: Candidate, maxOpenLeadsDefault: number): boolean {
  const limit = candidate.maxOpenLeads ?? maxOpenLeadsDefault;
  return candidate.availability === 'AVAILABLE' && candidate.openLeadCount < limit;
}

/**
 * Round-robin: eligible members ordered by lastAssignedAt (never assigned first), skipping `exclude`.
 * Deterministic for a given input; the row lock in LeadsService makes only one concurrent caller act.
 */
export function pickRoundRobin(candidates: Candidate[], maxOpenLeadsDefault: number, exclude: string[] = []): Candidate | null {
  const eligible = candidates
    .filter((candidate) => isEligible(candidate, maxOpenLeadsDefault) && !exclude.includes(candidate.userId))
    .sort((a, b) => {
      const aTime = a.lastAssignedAt?.getTime() ?? 0;
      const bTime = b.lastAssignedAt?.getTime() ?? 0;
      return aTime - bTime || a.userId.localeCompare(b.userId);
    });
  return eligible[0] ?? null;
}

export type EscalationTarget = { userId: string; level: number; reason: string } | null;

/**
 * Escalation chain (F3.5): level 1 → next eligible employee, level 2 → the current assignee's backup
 * (or any eligible member), level 3+ → a manager. Returns null when the chain is exhausted.
 */
export function nextEscalationTarget(input: {
  currentLevel: number;
  maxLevels: number;
  currentAssigneeId: string | null;
  previousAssignees: string[];
  candidates: Candidate[];
  maxOpenLeadsDefault: number;
}): EscalationTarget {
  const nextLevel = input.currentLevel + 1;
  if (nextLevel > input.maxLevels) return null;
  const exclude = [...input.previousAssignees, ...(input.currentAssigneeId ? [input.currentAssigneeId] : [])];

  if (nextLevel === 1) {
    const pick = pickRoundRobin(input.candidates, input.maxOpenLeadsDefault, exclude);
    return pick
      ? { userId: pick.userId, level: 1, reason: 'Acknowledgement window expired; moved to the next available employee' }
      : fallbackToManager(input.candidates, exclude, 1);
  }

  if (nextLevel === 2) {
    const current = input.candidates.find((candidate) => candidate.userId === input.currentAssigneeId);
    const backup = current?.backupUserId ? input.candidates.find((candidate) => candidate.userId === current.backupUserId) : undefined;
    if (backup && isReachable(backup) && !exclude.includes(backup.userId)) {
      return { userId: backup.userId, level: 2, reason: 'Second window expired; moved to the designated backup' };
    }
    const pick = pickRoundRobin(input.candidates, input.maxOpenLeadsDefault, exclude);
    return pick
      ? { userId: pick.userId, level: 2, reason: 'Second window expired; no backup available, moved to the next available employee' }
      : fallbackToManager(input.candidates, exclude, 2);
  }

  return fallbackToManager(input.candidates, exclude, nextLevel) ?? fallbackToManager(input.candidates, [], nextLevel);
}

function isReachable(candidate: Candidate): boolean {
  return candidate.availability !== 'ON_LEAVE' && candidate.availability !== 'OFFLINE';
}

function fallbackToManager(candidates: Candidate[], exclude: string[], level: number): EscalationTarget {
  const manager = candidates
    .filter((candidate) => candidate.isManager && isReachable(candidate) && !exclude.includes(candidate.userId))
    .sort((a, b) => a.userId.localeCompare(b.userId))[0];
  return manager ? { userId: manager.userId, level, reason: `Window expired at level ${level - 1}; escalated to a manager` } : null;
}

/**
 * Recovery queue item (Section 7): unacknowledged beyond its window, escalated two or more times,
 * or no recorded action for the idle period. Evaluation order fixes the reason shown (F3.7).
 */
export function computeRecoveryReason(
  lead: { status: LeadStatus; dueAt: Date | null; escalationCount: number; lastActivityAt: Date },
  now: Date,
  idleSec: number,
): RecoveryReason {
  if (lead.status === 'CLOSED') return 'NONE';
  if (lead.status === 'ASSIGNED' && lead.dueAt && lead.dueAt.getTime() < now.getTime()) return 'OVERDUE';
  if (lead.escalationCount >= 2 && lead.status !== 'ACKNOWLEDGED') return 'ESCALATED_TWICE';
  if (now.getTime() - lead.lastActivityAt.getTime() > idleSec * 1000) return 'IDLE';
  return 'NONE';
}

/** Compare-and-set guard used by the escalation processor: only the live assignment may escalate (F3.8). */
export function canEscalate(assignment: { status: string; id: string }, lead: { status: LeadStatus; currentAssignmentId: string | null }): boolean {
  return assignment.status === 'PENDING' && lead.status === 'ASSIGNED' && lead.currentAssignmentId === assignment.id;
}

/** Time to first response: from the lead's first assignment to its first acknowledgement (Section 7). */
export function timeToFirstResponseSec(firstAssignedAt: Date | null, acknowledgedAt: Date): number | null {
  if (!firstAssignedAt) return null;
  return Math.max(0, Math.round((acknowledgedAt.getTime() - firstAssignedAt.getTime()) / 1000));
}

/** WhatsApp allows free-form replies only within 24 h of the customer's last message (Twilio error 63016 otherwise). */
export function isWithinCustomerServiceWindow(lastInboundAt: Date | null, now: Date): boolean {
  return Boolean(lastInboundAt) && now.getTime() - (lastInboundAt as Date).getTime() < 24 * 3600 * 1000;
}

/** Status callbacks arrive out of order; only move forward (I1.4). */
const MESSAGE_STATUS_RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, UNDELIVERED: 9, FAILED: 9 };

export function nextMessageStatus(current: string, incoming: string): string {
  const currentRank = MESSAGE_STATUS_RANK[current] ?? 0;
  const incomingRank = MESSAGE_STATUS_RANK[incoming] ?? 0;
  if (currentRank >= 9) return current; // terminal
  return incomingRank >= currentRank ? incoming : current;
}
