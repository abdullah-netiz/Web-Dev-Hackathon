import type { Activity, Assignment, AuditEvent, Lead, RealtimeEvent, User } from "../types";
import { persist, uid, type MockDB } from "./db";

type Scoped<T> = T & { workspaceId: string };
type Listener = (e: RealtimeEvent, workspaceId: string) => void;

const listeners = new Set<Listener>();

export function onEngineEvent(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emit(workspaceId: string, e: RealtimeEvent) {
  for (const fn of listeners) fn(e, workspaceId);
}

const nowIso = () => new Date().toISOString();

export function strip<T extends { workspaceId?: string }>(row: T): Omit<T, "workspaceId"> {
  const { workspaceId: _w, ...rest } = row;
  return structuredClone(rest);
}

export function audit(
  db: MockDB,
  workspaceId: string,
  input: Omit<AuditEvent, "id" | "at"> & { at?: string },
) {
  db.audit.push({ id: uid("aud"), workspaceId, at: input.at ?? nowIso(), ...input });
}

export function activity(db: MockDB, workspaceId: string, input: Omit<Activity, "id" | "at"> & { at?: string }) {
  const row = { id: uid("act"), workspaceId, at: input.at ?? nowIso(), ...input };
  db.activities.push(row);
  return row;
}

function limitFor(db: MockDB, u: User, workspaceId: string) {
  return u.maxOpenLeads ?? db.settings[workspaceId]!.maxOpenLeadsDefault;
}

export function eligibleUsers(db: MockDB, workspaceId: string, exclude: Set<string> = new Set()) {
  return db.users
    .filter(
      (u) =>
        u.workspaceId === workspaceId &&
        u.active &&
        u.availability === "AVAILABLE" &&
        !exclude.has(u.id) &&
        u.openLeadCount < limitFor(db, u, workspaceId),
    )
    .sort((a, b) => (a.lastAssignedAt ?? "").localeCompare(b.lastAssignedAt ?? ""));
}

function previousOwners(db: MockDB, leadId: string) {
  return new Set(db.assignments.filter((a) => a.leadId === leadId).map((a) => a.userId));
}

function pickTarget(db: MockDB, lead: Scoped<Lead>, level: number): Scoped<User & { password: string }> | null {
  const W = lead.workspaceId;
  const tried = previousOwners(db, lead.id);
  const prevOwner = db.users.find((u) => u.id === lead.ownerId);
  if (level <= 1) return eligibleUsers(db, W, tried)[0] ?? eligibleUsers(db, W, new Set([lead.ownerId ?? ""]))[0] ?? null;
  if (level === 2) {
    const backup = db.users.find((u) => u.id === prevOwner?.backupUserId);
    if (backup && backup.active && backup.availability === "AVAILABLE" && backup.id !== lead.ownerId) return backup;
    return eligibleUsers(db, W, tried)[0] ?? null;
  }
  const managers = db.users
    .filter((u) => u.workspaceId === W && u.active && u.isManager && u.id !== lead.ownerId)
    .filter((u) => u.availability === "AVAILABLE" || u.availability === "BUSY")
    .sort((a, b) => (a.availability === "AVAILABLE" ? -1 : 1) - (b.availability === "AVAILABLE" ? -1 : 1));
  return managers[0] ?? null;
}

function setOwner(db: MockDB, lead: Scoped<Lead>, target: User, asg: Scoped<Assignment>) {
  const prev = db.users.find((u) => u.id === lead.ownerId);
  if (prev && prev.id !== target.id && (lead.status === "ASSIGNED" || lead.status === "ACKNOWLEDGED")) {
    prev.openLeadCount = Math.max(0, prev.openLeadCount - 1);
  }
  const t = db.users.find((u) => u.id === target.id)!;
  if (!prev || prev.id !== target.id || lead.status === "NEW") t.openLeadCount += 1;
  t.lastAssignedAt = asg.assignedAt;
  lead.ownerId = t.id;
  lead.ownerName = t.name;
  lead.status = "ASSIGNED";
  lead.current = structuredClone(asg);
  lead.firstAssignedAt ??= asg.assignedAt;
  lead.lastActivityAt = asg.assignedAt;
}

function newAssignment(
  db: MockDB,
  lead: Scoped<Lead>,
  target: User,
  level: number,
  reason: Assignment["reason"],
): Scoped<Assignment> {
  const s = db.settings[lead.workspaceId]!;
  const now = Date.now();
  const asg: Scoped<Assignment> = {
    id: uid("asg"),
    workspaceId: lead.workspaceId,
    leadId: lead.id,
    userId: target.id,
    userName: target.name,
    level,
    status: "PENDING",
    reason,
    assignedAt: new Date(now).toISOString(),
    dueAt: new Date(now + (level === 0 ? s.ackWindowSec : s.levelWindowSec) * 1000).toISOString(),
    resolvedAt: null,
  };
  db.assignments.push(asg);
  return asg;
}

function closeCurrent(db: MockDB, lead: Scoped<Lead>, status: Assignment["status"]) {
  if (!lead.current) return;
  const row = db.assignments.find((a) => a.id === lead.current!.id);
  if (row && row.status === "PENDING") {
    row.status = status;
    row.resolvedAt = nowIso();
  }
  if (lead.current.status === "PENDING") {
    lead.current.status = status;
    lead.current.resolvedAt = nowIso();
  }
}

export function assignNew(db: MockDB, lead: Scoped<Lead>) {
  const target = eligibleUsers(db, lead.workspaceId)[0];
  if (!target) {
    lead.recoveryReason = "OVERDUE";
    activity(db, lead.workspaceId, {
      entityType: "lead",
      entityId: lead.id,
      type: "ASSIGNMENT",
      actorId: null,
      actorName: "System",
      summary: "Nobody is available to take this lead. It is waiting in the recovery queue.",
    });
    emit(lead.workspaceId, { type: "lead:created", lead: strip(lead) as Lead });
    return lead;
  }
  const asg = newAssignment(db, lead, target, 0, "ROUND_ROBIN");
  setOwner(db, lead, target, asg);
  activity(db, lead.workspaceId, {
    entityType: "lead",
    entityId: lead.id,
    type: "ASSIGNMENT",
    actorId: null,
    actorName: "System",
    summary: `Assigned to ${target.name} by round-robin`,
  });
  activity(db, lead.workspaceId, {
    entityType: "contact",
    entityId: lead.contactId,
    type: "ASSIGNMENT",
    actorId: null,
    actorName: "System",
    summary: `New lead assigned to ${target.name}`,
  });
  audit(db, lead.workspaceId, {
    action: "LEAD_ASSIGNED",
    actorId: null,
    actorName: "System",
    targetType: "lead",
    targetId: lead.id,
    targetLabel: lead.contactName,
    before: null,
    after: { owner: target.name, reason: "ROUND_ROBIN", dueAt: asg.dueAt },
  });
  emit(lead.workspaceId, { type: "lead:assigned", lead: strip(lead) as Lead });
  return lead;
}

function sendAlert(db: MockDB, lead: Scoped<Lead>, target: User, reason: string) {
  const W = lead.workspaceId;
  const ok = target.telegramLinked;
  db.alerts.push({
    id: uid("alr"),
    workspaceId: W,
    leadId: lead.id,
    leadLabel: lead.contactName,
    userId: target.id,
    userName: target.name,
    channel: "TELEGRAM",
    status: ok ? "SENT" : "FAILED",
    attempts: ok ? 1 : 3,
    lastError: ok ? null : `${target.name} has not linked Telegram yet, so the alert could not be delivered.`,
    at: nowIso(),
  });
  db.events.push({
    id: uid("evt"),
    workspaceId: W,
    provider: "TELEGRAM",
    direction: "OUTBOUND",
    type: "sendMessage",
    status: ok ? "OK" : "FAILED",
    reference: `alert:${lead.id}:${lead.current?.id}`,
    error: ok ? null : "No chat linked for this employee.",
    at: nowIso(),
  });
  audit(db, W, {
    action: "ALERT_SENT",
    actorId: null,
    actorName: "System",
    targetType: "lead",
    targetId: lead.id,
    targetLabel: lead.contactName,
    before: null,
    after: { to: target.name, channel: "Telegram", delivered: ok, reason },
  });
}

export function escalate(db: MockDB, lead: Scoped<Lead>) {
  const W = lead.workspaceId;
  const s = db.settings[W]!;
  const cur = lead.current;
  if (!cur || cur.status !== "PENDING") return;
  closeCurrent(db, lead, "EXPIRED");
  const level = cur.level + 1;
  const fromName = lead.ownerName;
  const target = level <= s.escalationLevels ? pickTarget(db, lead, level) : null;
  if (!target) {
    lead.recoveryReason = "OVERDUE";
    activity(db, W, {
      entityType: "lead",
      entityId: lead.id,
      type: "ESCALATION",
      actorId: null,
      actorName: "System",
      summary:
        level > s.escalationLevels
          ? `Window expired at the last escalation level. ${fromName} still owns it; it is now in the recovery queue.`
          : `Window expired but nobody eligible could take it. ${fromName} still owns it; it is now in the recovery queue.`,
    });
    emit(W, { type: "lead:escalated", lead: strip(lead) as Lead, fromUserName: fromName });
    return;
  }
  lead.escalationCount += 1;
  const asg = newAssignment(db, lead, target, level, "ESCALATION");
  setOwner(db, lead, target, asg);
  const levelName = level === 1 ? "next available teammate" : level === 2 ? "designated backup" : "manager";
  activity(db, W, {
    entityType: "lead",
    entityId: lead.id,
    type: "ESCALATION",
    actorId: null,
    actorName: "System",
    summary: `${fromName} did not acknowledge in time. Handed to ${target.name} (${levelName}).`,
  });
  activity(db, W, {
    entityType: "contact",
    entityId: lead.contactId,
    type: "ESCALATION",
    actorId: null,
    actorName: "System",
    summary: `Lead escalated from ${fromName} to ${target.name}`,
  });
  audit(db, W, {
    action: "LEAD_ESCALATED",
    actorId: null,
    actorName: "System",
    targetType: "lead",
    targetId: lead.id,
    targetLabel: lead.contactName,
    before: { owner: fromName, level: cur.level },
    after: { owner: target.name, level, dueAt: asg.dueAt },
  });
  sendAlert(db, lead, target, `${fromName} did not acknowledge within the window`);
  emit(W, { type: "lead:escalated", lead: strip(lead) as Lead, fromUserName: fromName });
}

export function acknowledge(db: MockDB, lead: Scoped<Lead>, actor: User, how: string) {
  if (lead.status !== "ASSIGNED" || !lead.current) return false;
  if (lead.current.status === "PENDING" || lead.current.status === "EXPIRED") {
    const row = db.assignments.find((a) => a.id === lead.current!.id);
    if (row) {
      row.status = "ACKNOWLEDGED";
      row.resolvedAt = nowIso();
    }
    lead.current.status = "ACKNOWLEDGED";
    lead.current.resolvedAt = nowIso();
  }
  lead.status = "ACKNOWLEDGED";
  lead.acknowledgedAt = nowIso();
  lead.lastActivityAt = lead.acknowledgedAt;
  lead.recoveryReason = "NONE";
  if (lead.firstAssignedAt && lead.timeToFirstResponseSec == null) {
    lead.timeToFirstResponseSec = Math.round((Date.now() - new Date(lead.firstAssignedAt).getTime()) / 1000);
  }
  activity(db, lead.workspaceId, {
    entityType: "lead",
    entityId: lead.id,
    type: "ACKNOWLEDGED",
    actorId: actor.id,
    actorName: actor.name,
    summary: `${actor.name} acknowledged (${how})`,
  });
  audit(db, lead.workspaceId, {
    action: "LEAD_ACKNOWLEDGED",
    actorId: actor.id,
    actorName: actor.name,
    targetType: "lead",
    targetId: lead.id,
    targetLabel: lead.contactName,
    before: { status: "ASSIGNED" },
    after: { status: "ACKNOWLEDGED", how, timeToFirstResponseSec: lead.timeToFirstResponseSec },
  });
  emit(lead.workspaceId, { type: "lead:acknowledged", lead: strip(lead) as Lead });
  return true;
}

/** Section 7: any recorded action by the owner on the lead's contact counts as acknowledgement. */
export function touchContact(db: MockDB, workspaceId: string, contactId: string, actor: User, how: string) {
  for (const lead of db.leads) {
    if (lead.workspaceId !== workspaceId || lead.contactId !== contactId) continue;
    if (lead.status === "ACKNOWLEDGED") lead.lastActivityAt = nowIso();
    if (lead.status === "ASSIGNED" && lead.ownerId === actor.id) acknowledge(db, lead, actor, how);
  }
}

export function reassign(db: MockDB, lead: Scoped<Lead>, target: User, actor: User | null, reason: Assignment["reason"]) {
  const W = lead.workspaceId;
  const fromName = lead.ownerName;
  closeCurrent(db, lead, "REASSIGNED");
  const level = lead.current?.level ?? 0;
  const asg = newAssignment(db, lead, target, level, reason);
  setOwner(db, lead, target, asg);
  lead.acknowledgedAt = null;
  lead.recoveryReason = "NONE";
  const why = reason === "ABSENCE" ? `${fromName} became unavailable` : `reassigned by ${actor?.name}`;
  activity(db, W, {
    entityType: "lead",
    entityId: lead.id,
    type: "REASSIGNMENT",
    actorId: actor?.id ?? null,
    actorName: actor?.name ?? "System",
    summary: `Moved from ${fromName} to ${target.name}: ${why}`,
  });
  audit(db, W, {
    action: "LEAD_REASSIGNED",
    actorId: actor?.id ?? null,
    actorName: actor?.name ?? "System",
    targetType: "lead",
    targetId: lead.id,
    targetLabel: lead.contactName,
    before: { owner: fromName },
    after: { owner: target.name, reason },
  });
  emit(W, { type: "lead:assigned", lead: strip(lead) as Lead });
}

export function handleAbsence(db: MockDB, user: User & { workspaceId: string }) {
  const W = user.workspaceId;
  const s = db.settings[W]!;
  const moved: string[] = [];
  for (const lead of db.leads) {
    if (lead.workspaceId !== W || lead.ownerId !== user.id) continue;
    const pending = lead.status === "ASSIGNED";
    const ackd = lead.status === "ACKNOWLEDGED" && s.acknowledgedOnAbsence === "REASSIGN";
    if (!pending && !ackd) continue;
    const target = eligibleUsers(db, W, new Set([user.id]))[0];
    if (!target) {
      lead.recoveryReason = "OVERDUE";
      continue;
    }
    reassign(db, lead, target, null, "ABSENCE");
    moved.push(lead.id);
  }
  return moved;
}

export function recomputeRecovery(db: MockDB) {
  const now = Date.now();
  let changed = false;
  for (const lead of db.leads) {
    const s = db.settings[lead.workspaceId];
    if (!s) continue;
    let reason: Lead["recoveryReason"] = "NONE";
    if (lead.status === "ASSIGNED" || lead.status === "NEW") {
      const expired =
        !lead.current ||
        lead.current.status === "EXPIRED" ||
        (lead.current.status === "PENDING" && new Date(lead.current.dueAt).getTime() < now - 5000);
      if (lead.escalationCount >= 2) reason = "ESCALATED_TWICE";
      else if (expired) reason = "OVERDUE";
    }
    if (reason === "NONE" && lead.status === "ACKNOWLEDGED" && new Date(lead.lastActivityAt).getTime() < now - s.idleSec * 1000) {
      reason = "IDLE";
    }
    if (lead.recoveryReason !== reason) {
      lead.recoveryReason = reason;
      changed = true;
    }
  }
  return changed;
}

export function tick(db: MockDB) {
  const now = Date.now();
  let changed = false;
  for (const lead of db.leads) {
    if (lead.status === "ASSIGNED" && lead.current?.status === "PENDING" && new Date(lead.current.dueAt).getTime() <= now) {
      escalate(db, lead);
      changed = true;
    }
  }
  if (recomputeRecovery(db)) changed = true;
  if (changed) persist();
  return changed;
}
