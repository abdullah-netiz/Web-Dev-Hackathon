import { describe, expect, it } from 'vitest';

import {
  canEscalate,
  computeRecoveryReason,
  nextEscalationTarget,
  nextMessageStatus,
  pickRoundRobin,
  timeToFirstResponseSec,
  type Candidate,
} from './assignment.logic';

const member = (overrides: Partial<Candidate> & { userId: string }): Candidate => ({
  availability: 'AVAILABLE',
  maxOpenLeads: null,
  openLeadCount: 0,
  backupUserId: null,
  isManager: false,
  lastAssignedAt: null,
  ...overrides,
});

describe('pickRoundRobin (F3.3)', () => {
  it('never picks members who are not Available', () => {
    const pick = pickRoundRobin(
      [member({ userId: 'a', availability: 'BUSY' }), member({ userId: 'b', availability: 'ON_LEAVE' }), member({ userId: 'c', availability: 'OFFLINE' })],
      5,
    );
    expect(pick).toBeNull();
  });

  it('respects the open-lead limit, falling back to the workspace default', () => {
    const pick = pickRoundRobin(
      [member({ userId: 'a', openLeadCount: 5 }), member({ userId: 'b', openLeadCount: 2, maxOpenLeads: 2 }), member({ userId: 'c', openLeadCount: 4 })],
      5,
    );
    expect(pick?.userId).toBe('c');
  });

  it('rotates by least recently assigned', () => {
    const pick = pickRoundRobin(
      [
        member({ userId: 'a', lastAssignedAt: new Date('2026-10-18T10:00:00Z') }),
        member({ userId: 'b', lastAssignedAt: new Date('2026-10-18T09:00:00Z') }),
        member({ userId: 'c' }),
      ],
      5,
    );
    expect(pick?.userId).toBe('c');
  });
});

describe('nextEscalationTarget (F3.5)', () => {
  const candidates = [
    member({ userId: 'alice', lastAssignedAt: new Date('2026-10-18T10:00:00Z') }),
    member({ userId: 'bob', backupUserId: 'carol' }),
    member({ userId: 'carol', availability: 'BUSY' }),
    member({ userId: 'manager', isManager: true, availability: 'BUSY' }),
  ];

  it('level 1 goes to the next available employee, excluding the current assignee', () => {
    const target = nextEscalationTarget({ currentLevel: 0, maxLevels: 3, currentAssigneeId: 'bob', previousAssignees: [], candidates, maxOpenLeadsDefault: 5 });
    expect(target).toMatchObject({ userId: 'alice', level: 1 });
  });

  it('level 2 goes to the designated backup even when the backup is Busy', () => {
    const target = nextEscalationTarget({ currentLevel: 1, maxLevels: 3, currentAssigneeId: 'bob', previousAssignees: ['alice'], candidates, maxOpenLeadsDefault: 5 });
    expect(target).toMatchObject({ userId: 'carol', level: 2 });
  });

  it('level 3 goes to a manager', () => {
    const target = nextEscalationTarget({ currentLevel: 2, maxLevels: 3, currentAssigneeId: 'carol', previousAssignees: ['bob', 'alice'], candidates, maxOpenLeadsDefault: 5 });
    expect(target).toMatchObject({ userId: 'manager', level: 3 });
  });

  it('returns null once the configured number of levels is exhausted', () => {
    expect(nextEscalationTarget({ currentLevel: 3, maxLevels: 3, currentAssigneeId: 'manager', previousAssignees: [], candidates, maxOpenLeadsDefault: 5 })).toBeNull();
  });
});

describe('computeRecoveryReason (F3.7, Section 7)', () => {
  const now = new Date('2026-10-18T12:00:00Z');

  it('flags unacknowledged leads past their window as OVERDUE', () => {
    expect(computeRecoveryReason({ status: 'ASSIGNED', dueAt: new Date('2026-10-18T11:59:00Z'), escalationCount: 0, lastActivityAt: new Date('2026-10-18T11:58:00Z') }, now, 3600)).toBe('OVERDUE');
  });

  it('flags leads escalated twice or more', () => {
    expect(computeRecoveryReason({ status: 'ASSIGNED', dueAt: new Date('2026-10-18T12:05:00Z'), escalationCount: 2, lastActivityAt: new Date('2026-10-18T11:58:00Z') }, now, 3600)).toBe('ESCALATED_TWICE');
  });

  it('flags idle leads and ignores closed ones', () => {
    expect(computeRecoveryReason({ status: 'ACKNOWLEDGED', dueAt: null, escalationCount: 0, lastActivityAt: new Date('2026-10-18T09:00:00Z') }, now, 3600)).toBe('IDLE');
    expect(computeRecoveryReason({ status: 'CLOSED', dueAt: null, escalationCount: 5, lastActivityAt: new Date('2026-10-18T09:00:00Z') }, now, 3600)).toBe('NONE');
  });
});

describe('canEscalate (F3.8)', () => {
  it('only the live pending assignment may escalate', () => {
    expect(canEscalate({ status: 'PENDING', id: 'a1' }, { status: 'ASSIGNED', currentAssignmentId: 'a1' })).toBe(true);
    expect(canEscalate({ status: 'PENDING', id: 'a1' }, { status: 'ASSIGNED', currentAssignmentId: 'a2' })).toBe(false);
    expect(canEscalate({ status: 'ACKNOWLEDGED', id: 'a1' }, { status: 'ACKNOWLEDGED', currentAssignmentId: 'a1' })).toBe(false);
  });
});

describe('timeToFirstResponseSec', () => {
  it('measures from first assignment to acknowledgement', () => {
    expect(timeToFirstResponseSec(new Date('2026-10-18T12:00:00Z'), new Date('2026-10-18T12:01:30Z'))).toBe(90);
    expect(timeToFirstResponseSec(null, new Date())).toBeNull();
  });
});

describe('nextMessageStatus (I1.4 out-of-order callbacks)', () => {
  it('moves forward only and keeps terminal states', () => {
    expect(nextMessageStatus('QUEUED', 'DELIVERED')).toBe('DELIVERED');
    expect(nextMessageStatus('DELIVERED', 'SENT')).toBe('DELIVERED');
    expect(nextMessageStatus('FAILED', 'DELIVERED')).toBe('FAILED');
    expect(nextMessageStatus('SENT', 'READ')).toBe('READ');
  });
});
