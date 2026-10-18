import type { Api, ListParams } from "../contract";
import { ApiError } from "../errors";
import type {
  Appointment,
  AuditEvent,
  Availability,
  Contact,
  DashboardMetrics,
  Filter,
  Lead,
  Message,
  Opportunity,
  Payment,
  Permission,
  RealtimeEvent,
  Session,
  User,
} from "../types";
import { ALL_PERMISSIONS, CONNECTION_COPY, createEmptyWorkspace, loadDB, persist, resetDB, uid, type MockDB } from "./db";
import {
  acknowledge,
  activity,
  assignNew,
  audit,
  emit,
  handleAbsence,
  onEngineEvent,
  reassign,
  recomputeRecovery,
  strip,
  tick,
  touchContact,
} from "./engine";

const TOKEN_KEY = "baton.mock.token";
const failedLogins = new Map<string, number[]>();
const wait = (ms = 140 + Math.random() * 220) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

function fail(status: number, code: string, message: string, action?: string, details?: unknown): never {
  throw new ApiError(status, { code, message, action, details });
}

function getToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function ctx() {
  const db = loadDB();
  const token = getToken();
  const session = db.sessions.find((s) => s.token === token);
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
    fail(401, "UNAUTHENTICATED", "Your session has ended.", "Log in again to continue.");
  }
  const user = db.users.find((u) => u.id === session.userId && u.workspaceId === session.workspaceId);
  if (!user || !user.active) fail(401, "UNAUTHENTICATED", "This account is no longer active.", "Ask your Owner to reactivate it.");
  const ws = db.workspaces.find((w) => w.id === session.workspaceId)!;
  const role = db.roles.find((r) => r.id === user.roleId);
  const perms = new Set<Permission>(user.baseLevel === "OWNER" ? ALL_PERMISSIONS : (role?.permissions ?? []));
  const W = ws.id;
  const can = (p: Permission) => perms.has(p);
  const need = (p: Permission, what: string) => {
    if (!can(p)) fail(403, "FORBIDDEN", `You don't have permission to ${what}.`, "Ask an Owner or Admin to grant it in Settings → Roles.");
  };
  return { db, user, ws, W, perms, can, need };
}

function sessionFor(db: MockDB, userId: string): Session {
  const user = db.users.find((u) => u.id === userId)!;
  const token = uid("tok");
  const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  db.sessions.push({ token, userId, workspaceId: user.workspaceId, expiresAt });
  window.localStorage.setItem(TOKEN_KEY, token);
  persist();
  return buildSession(db, token);
}

function buildSession(db: MockDB, token: string): Session {
  const s = db.sessions.find((x) => x.token === token)!;
  const user = db.users.find((u) => u.id === s.userId)!;
  const role = db.roles.find((r) => r.id === user.roleId);
  const { password: _p, ...publicUser } = user;
  return {
    token,
    user: strip(publicUser) as User,
    workspace: strip(db.workspaces.find((w) => w.id === s.workspaceId)! as never) as never,
    permissions: user.baseLevel === "OWNER" ? ALL_PERMISSIONS : (role?.permissions ?? []),
    expiresAt: s.expiresAt,
  };
}

function publicUser(u: MockDB["users"][number]): User {
  const { password: _p, workspaceId: _w, ...rest } = u;
  return structuredClone(rest);
}

function maskOpp(o: MockDB["opportunities"][number], canValues: boolean): Opportunity {
  const out = strip(o) as Opportunity;
  if (!canValues) delete out.value;
  return out;
}

function matches(row: Record<string, unknown>, f: Filter): boolean {
  const raw = f.field.startsWith("custom.") ? (row.custom as Record<string, unknown>)?.[f.field.slice(7)] : row[f.field];
  const v = f.value;
  switch (f.op) {
    case "eq":
      return v === "" ? raw == null || raw === "" : String(raw ?? "") === String(v);
    case "neq":
      return String(raw ?? "") !== String(v);
    case "contains":
      return Array.isArray(raw) ? raw.includes(v) : String(raw ?? "").toLowerCase().includes(String(v).toLowerCase());
    case "in":
      return Array.isArray(v) && v.map(String).includes(String(raw));
    case "gte":
      return raw != null && String(raw) >= String(v);
    case "lte":
      return raw != null && String(raw) <= String(v);
    case "isTrue":
      return raw === true;
    case "isFalse":
      return raw !== true;
  }
}

function paginate<T>(rows: T[], params: ListParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, params.pageSize ?? 25);
  return { data: rows.slice((page - 1) * pageSize, page * pageSize), meta: { total: rows.length, page, pageSize } };
}

function contactName(c: Contact) {
  return `${c.firstName} ${c.lastName}`;
}

function visibleLeads(c: ReturnType<typeof ctx>) {
  return c.db.leads.filter((l) => l.workspaceId === c.W && (c.can("leads.view_all") || l.ownerId === c.user.id));
}

function findLead(c: ReturnType<typeof ctx>, id: string) {
  const lead = visibleLeads(c).find((l) => l.id === id);
  if (!lead) fail(404, "NOT_FOUND", "This lead doesn't exist or isn't visible to you.", "Go back to the leads list.");
  return lead;
}

function stageById(db: MockDB, W: string, stageId: string) {
  for (const p of db.pipelines) if (p.workspaceId === W) for (const s of p.stages) if (s.id === stageId) return { pipeline: p, stage: s };
  return null;
}

function computeMetrics(c: ReturnType<typeof ctx>): DashboardMetrics {
  const { db, W, user } = c;
  const company = c.can("dashboard.company");
  const canValues = c.can("crm.view_values");
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const monthStart = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);
  const leads = db.leads.filter((l) => l.workspaceId === W && (company || l.ownerId === user.id));
  const responded = leads.filter((l) => l.timeToFirstResponseSec != null);
  const opps = db.opportunities.filter((o) => o.workspaceId === W && (company || o.ownerId === user.id));
  const stages = db.pipelines.filter((p) => p.workspaceId === W).flatMap((p) => p.stages.map((s) => ({ ...s, pipelineName: p.name })));
  const openStages = stages.filter((s) => !s.isWon && !s.isLost);
  const payments = db.payments.filter((p) => p.workspaceId === W && (company || p.requestedById === user.id));
  const collected = payments.filter((p) => p.paidAt && new Date(p.paidAt) >= monthStart && ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"].includes(p.status));
  const collectedSum = collected.reduce((s, p) => s + (p.amount ?? 0) - (p.refundedAmount ?? 0), 0);
  const openValue = opps.filter((o) => openStages.some((s) => s.id === o.stageId)).reduce((s, o) => s + (o.value ?? 0), 0);
  const pendingPay = payments.filter((p) => p.status === "PENDING").reduce((s, p) => s + (p.amount ?? 0), 0);
  const members = db.users.filter((u) => u.workspaceId === W && u.active);
  const availability = { AVAILABLE: 0, BUSY: 0, ON_LEAVE: 0, OFFLINE: 0 } as Record<Availability, number>;
  for (const m of members) availability[m.availability] += 1;
  const dayEsc = Date.now() - 86_400_000;
  const escalations = db.audit.filter(
    (a) => a.workspaceId === W && a.action === "LEAD_ESCALATED" && new Date(a.at).getTime() >= dayEsc && (company || leads.some((l) => l.id === a.targetId)),
  ).length;
  const trend: DashboardMetrics["responseTrend"] = [];
  for (let d = 13; d >= 0; d--) {
    const start = new Date(startOfDay.getTime() - d * 86_400_000);
    const end = new Date(start.getTime() + 86_400_000);
    const inDay = leads.filter((l) => new Date(l.createdAt) >= start && new Date(l.createdAt) < end);
    const r = inDay.filter((l) => l.timeToFirstResponseSec != null);
    trend.push({
      day: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
      leads: inDay.length,
      avgSec: r.length ? Math.round(r.reduce((s, l) => s + l.timeToFirstResponseSec!, 0) / r.length) : null,
    });
  }
  return {
    scope: company ? "COMPANY" : "PERSONAL",
    currency: c.ws.currency,
    newLeadsToday: leads.filter((l) => new Date(l.createdAt) >= startOfDay).length,
    openPipelineByStage: canValues
      ? openStages.map((s) => {
          const inStage = opps.filter((o) => o.stageId === s.id);
          return { pipelineName: s.pipelineName, stageId: s.id, stageName: s.name, count: inStage.length, value: inStage.reduce((x, o) => x + (o.value ?? 0), 0) };
        })
      : null,
    avgTimeToFirstResponseSec: responded.length ? Math.round(responded.reduce((s, l) => s + l.timeToFirstResponseSec!, 0) / responded.length) : null,
    recoveryCount: leads.filter((l) => l.recoveryReason !== "NONE" && l.status !== "CLOSED").length,
    escalations24h: escalations,
    availability,
    upcomingAppointments: db.appointments
      .filter((a) => a.workspaceId === W && a.status === "CONFIRMED" && new Date(a.startsAt).getTime() > Date.now() && (company || a.userId === user.id))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, 5)
      .map((a) => strip(a) as Appointment),
    collectedThisMonth: collectedSum,
    paymentsThisMonthCount: collected.length,
    projectedRevenue: canValues ? openValue + pendingPay : null,
    responseTrend: trend,
  };
}

function busyFor(db: MockDB, W: string, userId: string, from: string, to: string) {
  const user = db.users.find((u) => u.id === userId && u.workspaceId === W);
  if (!user) return [];
  const slots = db.appointments
    .filter((a) => a.workspaceId === W && a.userId === userId && a.status === "CONFIRMED" && a.endsAt > from && a.startsAt < to)
    .map((a) => ({ start: a.startsAt, end: a.endsAt }));
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  while (d.toISOString() < to) {
    const seedN = (d.getUTCDate() + userId.length) % 3;
    const s = new Date(d);
    s.setUTCHours(19 + seedN, 0, 0, 0);
    slots.push({ start: s.toISOString(), end: new Date(s.getTime() + 60 * 60_000).toISOString() });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return slots.filter((s) => s.end > from && s.start < to);
}

const TG = globalThis as { __batonTicker?: ReturnType<typeof setInterval> };
function ensureTicker() {
  if (typeof window === "undefined") return;
  if (TG.__batonTicker) clearInterval(TG.__batonTicker);
  TG.__batonTicker = setInterval(() => tick(loadDB()), 1000);
}

function scheduleDelivery(workspaceId: string, msgId: string, outcome: "ok" | "fail") {
  const steps: [number, Message["status"]][] = outcome === "ok" ? [[900, "SENT"], [2400, "DELIVERED"], [6000, "READ"]] : [[1200, "FAILED"]];
  for (const [ms, status] of steps) {
    setTimeout(() => {
      const db = loadDB();
      const m = db.messages.find((x) => x.id === msgId);
      if (!m) return;
      m.status = status;
      if (status === "FAILED") {
        m.errorCode = "63016";
        m.errorMessage =
          "WhatsApp only allows free-form replies within 24 hours of the customer's last message. Ask the customer to message the sandbox again, then retry.";
      }
      db.events.push({
        id: uid("evt"),
        workspaceId,
        provider: "TWILIO",
        direction: "INBOUND",
        type: "message.status",
        status: status === "FAILED" ? "FAILED" : "OK",
        reference: m.providerSid ?? m.id,
        error: m.errorMessage,
        at: now(),
      });
      persist();
      emit(workspaceId, { type: "message:status", message: strip(m) as Message });
    }, ms);
  }
}

export function createMockApi(): Api {
  ensureTicker();
  return {
    auth: {
      async login({ email, password }) {
        await wait(400);
        const db = loadDB();
        const key = email.trim().toLowerCase();
        const recent = (failedLogins.get(key) ?? []).filter((t) => Date.now() - t < 60_000);
        if (recent.length >= 5) {
          const wait = Math.ceil((60_000 - (Date.now() - recent[0]!)) / 1000);
          fail(429, "TOO_MANY_ATTEMPTS", "Too many failed attempts for this email.", `Wait ${wait} seconds, then try again.`);
        }
        const user = db.users.find((u) => u.email.toLowerCase() === key);
        if (!user || user.password !== password) {
          failedLogins.set(key, [...recent, Date.now()]);
          fail(401, "INVALID_CREDENTIALS", "That email and password don't match.", `Check both and try again. ${4 - recent.length > 0 ? `${4 - recent.length} attempt${4 - recent.length === 1 ? "" : "s"} left before a one-minute pause.` : "Next failure pauses logins for a minute."}`);
        }
        failedLogins.delete(key);
        if (!user.active) fail(403, "DEACTIVATED", "This account has been deactivated.", "Ask your workspace Owner to reactivate it.");
        return sessionFor(db, user.id);
      },
      async signup({ workspaceName, name, email, password }) {
        await wait(500);
        const db = loadDB();
        if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
          fail(409, "EMAIL_TAKEN", "An account with this email already exists.", "Log in instead, or use a different email.");
        }
        const base = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
        let slug = base;
        let n = 2;
        while (db.workspaces.some((w) => w.slug === slug)) slug = `${base}-${n++}`;
        const ws = createEmptyWorkspace(db, { name: workspaceName, slug });
        const ownerRole = db.roles.find((r) => r.workspaceId === ws.id && r.name === "Owner")!;
        const id = uid("usr");
        db.users.push({
          id,
          workspaceId: ws.id,
          name,
          email,
          password,
          baseLevel: "OWNER",
          roleId: ownerRole.id,
          roleName: "Owner",
          availability: "AVAILABLE",
          openLeadCount: 0,
          maxOpenLeads: null,
          isManager: true,
          backupUserId: null,
          slackLinked: false, slackUserId: null,
          calendarStatus: "NOT_CONNECTED",
          timeZone: ws.timeZone,
          lastAssignedAt: null,
          active: true,
        });
        return sessionFor(db, id);
      },
      async acceptInvite(token, { name, password }) {
        await wait();
        const db = loadDB();
        const inv = db.invites.find((i) => i.token === token);
        if (!inv) fail(404, "INVITE_NOT_FOUND", "This invite link is invalid or was already used.", "Ask the person who invited you for a new link.");
        const user = db.users.find((u) => u.id === inv.userId)!;
        user.name = name;
        user.password = password;
        user.active = true;
        db.invites = db.invites.filter((i) => i.token !== token);
        return sessionFor(db, user.id);
      },
      async me() {
        await wait(60);
        ctx();
        return buildSession(loadDB(), getToken()!);
      },
      async logout() {
        const db = loadDB();
        const t = getToken();
        db.sessions = db.sessions.filter((s) => s.token !== t);
        window.localStorage.removeItem(TOKEN_KEY);
        persist();
      },
    },

    workspace: {
      async get() {
        await wait(60);
        return strip(ctx().ws as never) as never;
      },
      async update(patch) {
        await wait();
        const c = ctx();
        c.need("roles.manage", "change workspace settings");
        Object.assign(c.ws, patch);
        audit(c.db, c.W, { action: "SETTINGS_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "workspace", targetId: c.W, targetLabel: c.ws.name, before: null, after: patch });
        persist();
        return structuredClone(c.ws);
      },
      async settings() {
        await wait(80);
        const c = ctx();
        return structuredClone(c.db.settings[c.W]!);
      },
      async updateSettings(patch) {
        await wait();
        const c = ctx();
        c.need("leads.manage_rules", "change assignment rules");
        const before = structuredClone(c.db.settings[c.W]!);
        for (const [k, v] of Object.entries(patch)) {
          if (typeof v === "number" && (!Number.isFinite(v) || v < 1)) fail(422, "VALIDATION", `${k} must be a positive number.`, "Enter a whole number of 1 or more.");
        }
        Object.assign(c.db.settings[c.W]!, patch);
        audit(c.db, c.W, { action: "SETTINGS_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "settings", targetId: c.W, targetLabel: "Assignment rules", before, after: structuredClone(c.db.settings[c.W]) });
        persist();
        return structuredClone(c.db.settings[c.W]!);
      },
    },

    members: {
      async list() {
        await wait(100);
        const c = ctx();
        return c.db.users.filter((u) => u.workspaceId === c.W).map(publicUser);
      },
      async invite({ email, name, baseLevel, roleId }) {
        await wait();
        const c = ctx();
        c.need("users.manage", "invite members");
        if (baseLevel === "OWNER") fail(422, "VALIDATION", "A workspace has one Owner.", "Invite them as Admin or User.");
        if (c.db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) fail(409, "EMAIL_TAKEN", "Someone with this email already has an account.", "Use a different email.");
        const role = c.db.roles.find((r) => r.id === roleId && r.workspaceId === c.W);
        if (!role) fail(422, "VALIDATION", "Choose a role for the new member.");
        const id = uid("usr");
        c.db.users.push({
          id, workspaceId: c.W, name, email, password: uid("pw"), baseLevel, roleId, roleName: role.name, availability: "OFFLINE",
          openLeadCount: 0, maxOpenLeads: null, isManager: false, backupUserId: null, slackLinked: false, slackUserId: null,
          calendarStatus: "NOT_CONNECTED", timeZone: c.ws.timeZone, lastAssignedAt: null, active: true,
        });
        const token = uid("inv");
        c.db.invites.push({ token, userId: id, workspaceId: c.W });
        audit(c.db, c.W, { action: "MEMBER_INVITED", actorId: c.user.id, actorName: c.user.name, targetType: "user", targetId: id, targetLabel: name, before: null, after: { email, baseLevel, role: role.name } });
        persist();
        return { user: publicUser(c.db.users.find((u) => u.id === id)!), inviteUrl: `${window.location.origin}/invite/${token}` };
      },
      async update(id, patch) {
        await wait();
        const c = ctx();
        const target = c.db.users.find((u) => u.id === id && u.workspaceId === c.W);
        if (!target) fail(404, "NOT_FOUND", "This member doesn't exist in your workspace.");
        const selfServe = id === c.user.id && Object.keys(patch).every((k) => k === "maxOpenLeads");
        if (!selfServe) c.need("users.manage", "change members");
        if (target.baseLevel === "OWNER" && c.user.baseLevel !== "OWNER") fail(403, "OWNER_PROTECTED", "Only the Owner can change the Owner's account.", "Ask the Owner to make this change.");
        if (patch.baseLevel === "OWNER") fail(422, "VALIDATION", "Ownership can't be assigned here.", "The Owner can transfer ownership from their profile.");
        if (patch.baseLevel && target.id === c.user.id) fail(422, "VALIDATION", "You can't change your own level.", "Ask another Admin or the Owner.");
        const before = { baseLevel: target.baseLevel, role: target.roleName, maxOpenLeads: target.maxOpenLeads, isManager: target.isManager, backupUserId: target.backupUserId };
        if (patch.roleId) {
          const role = c.db.roles.find((r) => r.id === patch.roleId && r.workspaceId === c.W);
          if (!role) fail(422, "VALIDATION", "That role doesn't exist.");
          target.roleId = role.id;
          target.roleName = role.name;
        }
        if (patch.baseLevel) target.baseLevel = patch.baseLevel;
        if (patch.maxOpenLeads !== undefined) target.maxOpenLeads = patch.maxOpenLeads;
        if (patch.isManager !== undefined) target.isManager = patch.isManager;
        if (patch.backupUserId !== undefined) target.backupUserId = patch.backupUserId;
        audit(c.db, c.W, {
          action: patch.baseLevel || patch.roleId ? "MEMBER_LEVEL_CHANGED" : "SETTINGS_CHANGED",
          actorId: c.user.id, actorName: c.user.name, targetType: "user", targetId: id, targetLabel: target.name, before,
          after: { baseLevel: target.baseLevel, role: target.roleName, maxOpenLeads: target.maxOpenLeads, isManager: target.isManager, backupUserId: target.backupUserId },
        });
        persist();
        return publicUser(target);
      },
      async setAvailability(id, availability) {
        await wait(120);
        const c = ctx();
        const target = c.db.users.find((u) => u.id === id && u.workspaceId === c.W);
        if (!target) fail(404, "NOT_FOUND", "This member doesn't exist in your workspace.");
        if (id !== c.user.id) c.need("users.manage", "change someone else's availability");
        const before = target.availability;
        target.availability = availability;
        audit(c.db, c.W, { action: "SETTINGS_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "availability", targetId: id, targetLabel: target.name, before: { availability: before }, after: { availability } });
        if (availability === "ON_LEAVE" || availability === "OFFLINE") handleAbsence(c.db, target);
        recomputeRecovery(c.db);
        persist();
        emit(c.W, { type: "availability:changed", user: publicUser(target) });
        return publicUser(target);
      },
      async reactivate(id) {
        await wait();
        const c = ctx();
        c.need("users.manage", "reactivate members");
        const target = c.db.users.find((u) => u.id === id && u.workspaceId === c.W);
        if (!target) fail(404, "NOT_FOUND", "This member doesn't exist in your workspace.");
        target.active = true;
        persist();
        return publicUser(target);
      },
      async deactivate(id) {
        await wait();
        const c = ctx();
        c.need("users.manage", "deactivate members");
        const target = c.db.users.find((u) => u.id === id && u.workspaceId === c.W);
        if (!target) fail(404, "NOT_FOUND", "This member doesn't exist in your workspace.");
        if (target.baseLevel === "OWNER") fail(403, "OWNER_PROTECTED", "The Owner can't be deactivated.");
        target.availability = "OFFLINE";
        handleAbsence(c.db, target);
        target.active = false;
        audit(c.db, c.W, { action: "MEMBER_LEVEL_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "user", targetId: id, targetLabel: target.name, before: { active: true }, after: { active: false } });
        persist();
        return publicUser(target);
      },
    },

    roles: {
      async list() {
        await wait(80);
        const c = ctx();
        return c.db.roles
          .filter((r) => r.workspaceId === c.W)
          .map((r) => ({ ...(strip(r) as never as object), memberCount: c.db.users.filter((u) => u.roleId === r.id && u.active).length }) as never);
      },
      async create({ name, description, permissions }) {
        await wait();
        const c = ctx();
        c.need("roles.manage", "create roles");
        if (c.db.roles.some((r) => r.workspaceId === c.W && r.name.toLowerCase() === name.toLowerCase())) fail(409, "DUPLICATE", "A role with this name already exists.", "Pick another name.");
        const role = { id: uid("role"), workspaceId: c.W, name, description, permissions, isSystem: false, memberCount: 0 };
        c.db.roles.push(role);
        audit(c.db, c.W, { action: "ROLE_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "role", targetId: role.id, targetLabel: name, before: null, after: { permissions } });
        persist();
        return strip(role) as never;
      },
      async update(id, patch) {
        await wait();
        const c = ctx();
        c.need("roles.manage", "change roles");
        const role = c.db.roles.find((r) => r.id === id && r.workspaceId === c.W);
        if (!role) fail(404, "NOT_FOUND", "This role doesn't exist.");
        if (role.name === "Owner") fail(403, "OWNER_PROTECTED", "The Owner role always has every permission.");
        const before = { name: role.name, permissions: [...role.permissions] };
        if (patch.name) role.name = patch.name;
        if (patch.description !== undefined) role.description = patch.description;
        if (patch.permissions) role.permissions = patch.permissions;
        for (const u of c.db.users) if (u.roleId === role.id) u.roleName = role.name;
        audit(c.db, c.W, { action: "PERMISSION_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "role", targetId: id, targetLabel: role.name, before, after: { name: role.name, permissions: role.permissions } });
        persist();
        return strip(role) as never;
      },
      async remove(id) {
        await wait();
        const c = ctx();
        c.need("roles.manage", "delete roles");
        const role = c.db.roles.find((r) => r.id === id && r.workspaceId === c.W);
        if (!role) fail(404, "NOT_FOUND", "This role doesn't exist.");
        if (role.isSystem) fail(422, "SYSTEM_ROLE", "Owner and Admin roles can't be deleted.");
        const n = c.db.users.filter((u) => u.roleId === id && u.active).length;
        if (n) fail(409, "ROLE_IN_USE", `${n} member${n > 1 ? "s use" : " uses"} this role.`, "Move them to another role first.");
        c.db.roles = c.db.roles.filter((r) => r.id !== id);
        audit(c.db, c.W, { action: "ROLE_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "role", targetId: id, targetLabel: role.name, before: { name: role.name }, after: null });
        persist();
      },
    },

    companies: {
      async list(params = {}) {
        await wait();
        const c = ctx();
        c.need("crm.view", "view companies");
        let rows = c.db.companies.filter((x) => x.workspaceId === c.W);
        if (params.q) {
          const q = params.q.toLowerCase();
          rows = rows.filter((x) => x.name.toLowerCase().includes(q) || (x.city ?? "").toLowerCase().includes(q));
        }
        rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
        const p = paginate(rows, params);
        return { ...p, data: p.data.map((x) => strip(x) as never) };
      },
      async get(id) {
        await wait();
        const c = ctx();
        c.need("crm.view", "view companies");
        const company = c.db.companies.find((x) => x.id === id && x.workspaceId === c.W);
        if (!company) fail(404, "NOT_FOUND", "This company doesn't exist in your workspace.");
        const contacts = c.db.contacts.filter((x) => x.workspaceId === c.W && x.companyId === id);
        const ids = new Set(contacts.map((x) => x.id));
        return {
          company: strip(company) as never,
          contacts: contacts.map((x) => strip(x) as Contact),
          opportunities: c.db.opportunities.filter((o) => o.workspaceId === c.W && ids.has(o.contactId)).map((o) => maskOpp(o, c.can("crm.view_values"))),
        };
      },
      async create(input) {
        await wait();
        const c = ctx();
        c.need("crm.create", "create companies");
        const row = { id: uid("co"), workspaceId: c.W, name: input.name, domain: input.domain ?? null, industry: input.industry ?? null, city: input.city ?? null, contactCount: 0, openOpportunityCount: 0, createdAt: now() };
        c.db.companies.push(row);
        persist();
        return strip(row) as never;
      },
    },

    contacts: {
      async list(params = {}) {
        await wait();
        const c = ctx();
        c.need("crm.view", "view contacts");
        let rows = c.db.contacts.filter((x) => x.workspaceId === c.W);
        if (params.q) {
          const q = params.q.toLowerCase();
          rows = rows.filter((x) => `${contactName(x)} ${x.email ?? ""} ${x.phone ?? ""} ${x.companyName ?? ""}`.toLowerCase().includes(q));
        }
        for (const f of params.filters ?? []) rows = rows.filter((r) => matches(r as never, f));
        const [key, dir] = (params.sort ?? "createdAt:desc").split(":") as [keyof Contact, string];
        rows = [...rows].sort((a, b) => {
          const av = String(key === "firstName" ? contactName(a) : (a[key] ?? ""));
          const bv = String(key === "firstName" ? contactName(b) : (b[key] ?? ""));
          return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        });
        const p = paginate(rows, params);
        return { ...p, data: p.data.map((x) => strip(x) as Contact) };
      },
      async overview(id) {
        await wait();
        const c = ctx();
        c.need("crm.view", "view contacts");
        const contact = c.db.contacts.find((x) => x.id === id && x.workspaceId === c.W);
        if (!contact) fail(404, "NOT_FOUND", "This contact doesn't exist in your workspace.", "Check the link or search for the contact.");
        const opps = c.db.opportunities.filter((o) => o.workspaceId === c.W && o.contactId === id);
        const oppIds = new Set(opps.map((o) => o.id));
        const leads = c.db.leads.filter((l) => l.workspaceId === c.W && l.contactId === id);
        const leadIds = new Set(leads.map((l) => l.id));
        const owner = c.db.users.find((u) => u.id === contact.ownerId);
        return {
          contact: strip(contact) as Contact,
          company: contact.companyId ? (strip(c.db.companies.find((x) => x.id === contact.companyId)!) as never) : null,
          opportunities: opps.map((o) => maskOpp(o, c.can("crm.view_values"))),
          conversations: c.db.conversations.filter((x) => x.workspaceId === c.W && x.contactId === id).map((x) => strip(x) as never),
          payments: c.db.payments.filter((p) => p.workspaceId === c.W && p.contactId === id).map((p) => strip(p) as Payment),
          appointments: c.db.appointments.filter((a) => a.workspaceId === c.W && a.contactId === id).map((a) => strip(a) as Appointment),
          leads: leads.map((l) => strip(l) as Lead),
          activities: c.db.activities
            .filter((a) => a.workspaceId === c.W && ((a.entityType === "contact" && a.entityId === id) || (a.entityType === "opportunity" && oppIds.has(a.entityId)) || (a.entityType === "lead" && leadIds.has(a.entityId))))
            .sort((a, b) => b.at.localeCompare(a.at))
            .map((a) => strip(a) as never),
          owner: owner ? publicUser(owner) : null,
        };
      },
      async create(input) {
        await wait();
        const c = ctx();
        c.need("crm.create", "create contacts");
        if (input.phone && c.db.contacts.some((x) => x.workspaceId === c.W && x.phone === input.phone)) {
          fail(409, "DUPLICATE_PHONE", "A contact with this phone number already exists.", "Search for it instead of creating a duplicate.");
        }
        const company = input.companyId ? c.db.companies.find((x) => x.id === input.companyId && x.workspaceId === c.W) : null;
        const row = {
          id: uid("ct"), workspaceId: c.W, firstName: input.firstName, lastName: input.lastName, email: input.email || null, phone: input.phone || null,
          companyId: company?.id ?? null, companyName: company?.name ?? null, ownerId: c.user.id, ownerName: c.user.name, tags: input.tags ?? [],
          optedOut: false, custom: input.custom ?? {}, createdAt: now(), lastActivityAt: now(), version: 1,
        };
        c.db.contacts.push(row);
        if (company) company.contactCount += 1;
        activity(c.db, c.W, { entityType: "contact", entityId: row.id, type: "CREATED", actorId: c.user.id, actorName: c.user.name, summary: "Contact created" });
        persist();
        return strip(row) as Contact;
      },
      async update(id, version, patch) {
        await wait();
        const c = ctx();
        c.need("crm.edit", "edit contacts");
        const row = c.db.contacts.find((x) => x.id === id && x.workspaceId === c.W);
        if (!row) fail(404, "NOT_FOUND", "This contact doesn't exist in your workspace.");
        if (row.version !== version) fail(409, "VERSION_CONFLICT", "Someone else changed this contact while you were editing.", "Reload to see their changes, then edit again.");
        const changed = Object.keys(patch).filter((k) => JSON.stringify((row as never)[k]) !== JSON.stringify((patch as never)[k]));
        const before = Object.fromEntries(changed.map((k) => [k, (row as never)[k]]));
        if (patch.optedOut !== undefined) row.optedOut = patch.optedOut;
        Object.assign(row, patch, { version: row.version + 1, lastActivityAt: now() });
        for (const cv of c.db.conversations) if (cv.contactId === id) cv.optedOut = row.optedOut;
        if (changed.length) {
          activity(c.db, c.W, { entityType: "contact", entityId: id, type: "FIELD_EDIT", actorId: c.user.id, actorName: c.user.name, summary: `Edited ${changed.join(", ")}`, before, after: Object.fromEntries(changed.map((k) => [k, (row as never)[k]])) });
          touchContact(c.db, c.W, id, c.user, "edited the contact");
        }
        persist();
        return strip(row) as Contact;
      },
      async remove(id) {
        await wait();
        const c = ctx();
        c.need("crm.delete", "delete contacts");
        const row = c.db.contacts.find((x) => x.id === id && x.workspaceId === c.W);
        if (!row) fail(404, "NOT_FOUND", "This contact doesn't exist in your workspace.");
        const opps = c.db.opportunities.filter((o) => o.contactId === id).length;
        if (opps) fail(409, "HAS_RELATED", `This contact has ${opps} opportunit${opps > 1 ? "ies" : "y"}.`, "Move or delete those opportunities first, so nothing is left orphaned.");
        c.db.contacts = c.db.contacts.filter((x) => x.id !== id);
        audit(c.db, c.W, { action: "RECORD_DELETED", actorId: c.user.id, actorName: c.user.name, targetType: "contact", targetId: id, targetLabel: contactName(row), before: strip(row), after: null });
        persist();
      },
      async addNote(entity, text) {
        await wait();
        const c = ctx();
        c.need("crm.edit", "add notes");
        if (!text.trim()) fail(422, "VALIDATION", "Write something before saving the note.");
        const row = activity(c.db, c.W, { entityType: entity.type, entityId: entity.id, type: "NOTE", actorId: c.user.id, actorName: c.user.name, summary: text.trim() });
        const contactId =
          entity.type === "contact" ? entity.id : entity.type === "lead" ? c.db.leads.find((l) => l.id === entity.id)?.contactId : c.db.opportunities.find((o) => o.id === entity.id)?.contactId;
        if (contactId) touchContact(c.db, c.W, contactId, c.user, "added a note");
        if (entity.type === "lead") {
          const lead = c.db.leads.find((l) => l.id === entity.id && l.workspaceId === c.W);
          if (lead && lead.ownerId === c.user.id) acknowledge(c.db, lead, c.user, "added a note");
        }
        persist();
        return strip(row) as never;
      },
      async exportCsv(params = {}) {
        await wait(600);
        const c = ctx();
        c.need("crm.export", "export contacts");
        let rows = c.db.contacts.filter((x) => x.workspaceId === c.W);
        if (params.q) {
          const q = params.q.toLowerCase();
          rows = rows.filter((x) => `${contactName(x)} ${x.email ?? ""} ${x.phone ?? ""}`.toLowerCase().includes(q));
        }
        for (const f of params.filters ?? []) rows = rows.filter((r) => matches(r as never, f));
        const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
        const head = ["First name", "Last name", "Email", "Phone", "Company", "Owner", "Tags", "Opted out", "Created"];
        return [head.map(esc).join(","), ...rows.map((r) => [r.firstName, r.lastName, r.email, r.phone, r.companyName, r.ownerName, r.tags.join(" "), r.optedOut ? "yes" : "no", r.createdAt].map(esc).join(","))].join("\n");
      },
      async tags() {
        const c = ctx();
        return [...new Set(c.db.contacts.filter((x) => x.workspaceId === c.W).flatMap((x) => x.tags))].sort();
      },
    },

    pipelines: {
      async list() {
        await wait(80);
        const c = ctx();
        return c.db.pipelines.filter((p) => p.workspaceId === c.W).map((p) => ({ ...(strip(p) as never as object), stages: [...p.stages].sort((a, b) => a.order - b.order) }) as never);
      },
      async create(name) {
        await wait();
        const c = ctx();
        c.need("settings.manage", "create pipelines");
        const id = uid("pipe");
        const p = { id, workspaceId: c.W, name, stages: ["New", "In progress", "Won", "Lost"].map((n, i) => ({ id: uid("stage"), pipelineId: id, name: n, order: i, isWon: n === "Won", isLost: n === "Lost", requiredFieldKeys: [] as string[] })) };
        c.db.pipelines.push(p);
        audit(c.db, c.W, { action: "PIPELINE_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "pipeline", targetId: id, targetLabel: name, before: null, after: { stages: p.stages.map((s) => s.name) } });
        persist();
        return strip(p) as never;
      },
      async rename(id, name) {
        await wait();
        const c = ctx();
        c.need("settings.manage", "rename pipelines");
        const p = c.db.pipelines.find((x) => x.id === id && x.workspaceId === c.W);
        if (!p) fail(404, "NOT_FOUND", "This pipeline doesn't exist.");
        audit(c.db, c.W, { action: "PIPELINE_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "pipeline", targetId: id, targetLabel: name, before: { name: p.name }, after: { name } });
        p.name = name;
        persist();
        return strip(p) as never;
      },
      async addStage(pipelineId, name) {
        await wait();
        const c = ctx();
        c.need("settings.manage", "add stages");
        const p = c.db.pipelines.find((x) => x.id === pipelineId && x.workspaceId === c.W);
        if (!p) fail(404, "NOT_FOUND", "This pipeline doesn't exist.");
        if (p.stages.some((s) => s.name.toLowerCase() === name.toLowerCase())) fail(409, "DUPLICATE", "This pipeline already has a stage with that name.");
        const terminal = p.stages.filter((s) => s.isWon || s.isLost).map((s) => s.order);
        const order = terminal.length ? Math.min(...terminal) : p.stages.length;
        for (const s of p.stages) if (s.order >= order) s.order += 1;
        const stage = { id: uid("stage"), pipelineId, name, order, isWon: false, isLost: false, requiredFieldKeys: [] };
        p.stages.push(stage);
        audit(c.db, c.W, { action: "PIPELINE_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "stage", targetId: stage.id, targetLabel: `${p.name} → ${name}`, before: null, after: { name, order } });
        persist();
        return structuredClone(stage);
      },
      async updateStage(stageId, patch) {
        await wait();
        const c = ctx();
        c.need("settings.manage", "edit stages");
        const found = stageById(c.db, c.W, stageId);
        if (!found) fail(404, "NOT_FOUND", "This stage doesn't exist.");
        const before = structuredClone(found.stage);
        Object.assign(found.stage, patch);
        audit(c.db, c.W, { action: "PIPELINE_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "stage", targetId: stageId, targetLabel: `${found.pipeline.name} → ${found.stage.name}`, before, after: structuredClone(found.stage) });
        persist();
        return structuredClone(found.stage);
      },
      async reorderStages(pipelineId, stageIds) {
        await wait(120);
        const c = ctx();
        c.need("settings.manage", "reorder stages");
        const p = c.db.pipelines.find((x) => x.id === pipelineId && x.workspaceId === c.W);
        if (!p) fail(404, "NOT_FOUND", "This pipeline doesn't exist.");
        const before = [...p.stages].sort((a, b) => a.order - b.order).map((s) => s.name);
        stageIds.forEach((id, i) => {
          const s = p.stages.find((x) => x.id === id);
          if (s) s.order = i;
        });
        audit(c.db, c.W, { action: "PIPELINE_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "pipeline", targetId: pipelineId, targetLabel: p.name, before: { order: before }, after: { order: [...p.stages].sort((a, b) => a.order - b.order).map((s) => s.name) } });
        persist();
        return { ...(strip(p) as never as object), stages: [...p.stages].sort((a, b) => a.order - b.order) } as never;
      },
      async deleteStage(stageId, moveToStageId) {
        await wait();
        const c = ctx();
        c.need("settings.manage", "delete stages");
        const found = stageById(c.db, c.W, stageId);
        if (!found) fail(404, "NOT_FOUND", "This stage doesn't exist.");
        const inStage = c.db.opportunities.filter((o) => o.workspaceId === c.W && o.stageId === stageId);
        if (inStage.length && !moveToStageId) {
          fail(409, "STAGE_NOT_EMPTY", `${inStage.length} opportunit${inStage.length > 1 ? "ies are" : "y is"} in this stage.`, "Choose a stage to move them to before deleting.", { count: inStage.length });
        }
        if (moveToStageId) {
          const dest = stageById(c.db, c.W, moveToStageId);
          if (!dest || dest.pipeline.id !== found.pipeline.id || moveToStageId === stageId) fail(422, "VALIDATION", "Pick another stage in the same pipeline.");
          for (const o of inStage) {
            o.stageId = moveToStageId;
            o.version += 1;
            activity(c.db, c.W, { entityType: "opportunity", entityId: o.id, type: "STAGE_CHANGE", actorId: c.user.id, actorName: c.user.name, summary: `Moved to ${dest.stage.name} because "${found.stage.name}" was deleted` });
          }
        }
        found.pipeline.stages = found.pipeline.stages.filter((s) => s.id !== stageId);
        [...found.pipeline.stages].sort((a, b) => a.order - b.order).forEach((s, i) => (s.order = i));
        audit(c.db, c.W, { action: "PIPELINE_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "stage", targetId: stageId, targetLabel: `${found.pipeline.name} → ${found.stage.name}`, before: { name: found.stage.name, opportunities: inStage.length }, after: { deleted: true, movedTo: moveToStageId } });
        persist();
      },
    },

    fields: {
      async list(entity) {
        await wait(60);
        const c = ctx();
        return c.db.fields.filter((f) => f.workspaceId === c.W && !f.isArchived && (!entity || f.entity === entity)).sort((a, b) => a.order - b.order).map((f) => strip(f) as never);
      },
      async create(input) {
        await wait();
        const c = ctx();
        c.need("settings.manage", "create fields");
        const label = input.label.trim();
        if (!label) fail(422, "VALIDATION", "Give the field a name.");
        if (input.type === "SELECT" && !(input.options ?? []).filter(Boolean).length) fail(422, "VALIDATION", "A dropdown needs at least one option.", "Add the options, one per line.");
        const key = label.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, ch: string) => ch.toUpperCase()).replace(/[^a-zA-Z0-9]/g, "") || uid("f");
        if (c.db.fields.some((f) => f.workspaceId === c.W && f.entity === input.entity && f.key === key && !f.isArchived)) fail(409, "DUPLICATE", "A field with this name already exists.");
        const row = {
          id: uid("fld"), workspaceId: c.W, entity: input.entity, key, label, type: input.type, options: (input.options ?? []).map((o) => o.trim()).filter(Boolean),
          pipelineId: input.pipelineId ?? null, isArchived: false, order: c.db.fields.filter((f) => f.entity === input.entity).length,
        };
        c.db.fields.push(row);
        audit(c.db, c.W, { action: "FIELD_CONFIG_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "field", targetId: row.id, targetLabel: label, before: null, after: { entity: row.entity, type: row.type, options: row.options, pipelineId: row.pipelineId } });
        persist();
        return strip(row) as never;
      },
      async update(id, patch) {
        await wait();
        const c = ctx();
        c.need("settings.manage", "edit fields");
        const f = c.db.fields.find((x) => x.id === id && x.workspaceId === c.W);
        if (!f) fail(404, "NOT_FOUND", "This field doesn't exist.");
        const before = { label: f.label, options: [...f.options] };
        Object.assign(f, patch);
        audit(c.db, c.W, { action: "FIELD_CONFIG_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "field", targetId: id, targetLabel: f.label, before, after: { label: f.label, options: f.options } });
        persist();
        return strip(f) as never;
      },
      async archive(id) {
        await wait();
        const c = ctx();
        c.need("settings.manage", "remove fields");
        const f = c.db.fields.find((x) => x.id === id && x.workspaceId === c.W);
        if (!f) fail(404, "NOT_FOUND", "This field doesn't exist.");
        const usedBy = c.db.pipelines.flatMap((p) => p.stages).filter((s) => s.requiredFieldKeys.includes(f.key));
        if (usedBy.length) fail(409, "FIELD_REQUIRED_BY_STAGE", `"${f.label}" is required by ${usedBy.map((s) => s.name).join(", ")}.`, "Remove it from those stages' required fields first.");
        f.isArchived = true;
        audit(c.db, c.W, { action: "FIELD_CONFIG_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "field", targetId: id, targetLabel: f.label, before: { archived: false }, after: { archived: true } });
        persist();
      },
    },

    opportunities: {
      async list(params) {
        await wait();
        const c = ctx();
        c.need("crm.view", "view opportunities");
        let rows = c.db.opportunities.filter((o) => o.workspaceId === c.W && o.pipelineId === params.pipelineId);
        if (params.q) {
          const q = params.q.toLowerCase();
          rows = rows.filter((o) => `${o.name} ${o.contactName} ${o.companyName ?? ""}`.toLowerCase().includes(q));
        }
        for (const f of params.filters ?? []) rows = rows.filter((r) => matches(r as never, f));
        rows = [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        const p = paginate(rows, { ...params, pageSize: params.pageSize ?? 100 });
        return { ...p, data: p.data.map((o) => maskOpp(o, c.can("crm.view_values"))) };
      },
      async get(id) {
        await wait();
        const c = ctx();
        c.need("crm.view", "view opportunities");
        const o = c.db.opportunities.find((x) => x.id === id && x.workspaceId === c.W);
        if (!o) fail(404, "NOT_FOUND", "This opportunity doesn't exist in your workspace.");
        return {
          opportunity: maskOpp(o, c.can("crm.view_values")),
          activities: c.db.activities.filter((a) => a.workspaceId === c.W && a.entityType === "opportunity" && a.entityId === id).sort((a, b) => b.at.localeCompare(a.at)).map((a) => strip(a) as never),
          payments: c.db.payments.filter((p) => p.workspaceId === c.W && p.opportunityId === id).map((p) => strip(p) as Payment),
          appointments: c.db.appointments.filter((a) => a.workspaceId === c.W && a.opportunityId === id).map((a) => strip(a) as Appointment),
          fields: c.db.fields.filter((f) => f.workspaceId === c.W && f.entity === "opportunity" && !f.isArchived && (f.pipelineId === null || f.pipelineId === o.pipelineId)).map((f) => strip(f) as never),
        };
      },
      async create(input) {
        await wait();
        const c = ctx();
        c.need("crm.create", "create opportunities");
        const contact = c.db.contacts.find((x) => x.id === input.contactId && x.workspaceId === c.W);
        if (!contact) fail(422, "VALIDATION", "Pick a contact for this opportunity.");
        const st = stageById(c.db, c.W, input.stageId);
        if (!st || st.pipeline.id !== input.pipelineId) fail(422, "VALIDATION", "Pick a stage in this pipeline.");
        const row = {
          id: uid("op"), workspaceId: c.W, name: input.name, contactId: contact.id, contactName: contactName(contact), companyName: contact.companyName,
          pipelineId: input.pipelineId, stageId: input.stageId, ownerId: c.user.id, ownerName: c.user.name, value: c.can("crm.view_values") ? (input.value ?? 0) : 0,
          currency: input.currency ?? c.ws.currency, custom: input.custom ?? {}, paymentStatus: null, expectedCloseDate: null, createdAt: now(), updatedAt: now(), version: 1,
        };
        c.db.opportunities.push(row);
        activity(c.db, c.W, { entityType: "opportunity", entityId: row.id, type: "CREATED", actorId: c.user.id, actorName: c.user.name, summary: `Opportunity created in ${st.stage.name}` });
        activity(c.db, c.W, { entityType: "contact", entityId: contact.id, type: "CREATED", actorId: c.user.id, actorName: c.user.name, summary: `Opportunity "${row.name}" created` });
        touchContact(c.db, c.W, contact.id, c.user, "created an opportunity");
        persist();
        return maskOpp(row, c.can("crm.view_values"));
      },
      async update(id, version, patch) {
        await wait();
        const c = ctx();
        c.need("crm.edit", "edit opportunities");
        const o = c.db.opportunities.find((x) => x.id === id && x.workspaceId === c.W);
        if (!o) fail(404, "NOT_FOUND", "This opportunity doesn't exist in your workspace.");
        if (o.version !== version) fail(409, "VERSION_CONFLICT", "Someone else changed this opportunity while you were editing.", "Reload to see their changes, then edit again.");
        if (patch.value !== undefined && !c.can("crm.view_values")) fail(403, "FORBIDDEN", "You don't have permission to change opportunity values.");
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        if (patch.custom) {
          for (const [k, v] of Object.entries(patch.custom)) if (o.custom[k] !== v) { before[k] = o.custom[k] ?? null; after[k] = v; }
          o.custom = { ...o.custom, ...patch.custom };
        }
        for (const k of ["name", "value", "ownerId", "expectedCloseDate"] as const) {
          if (patch[k] !== undefined && patch[k] !== o[k]) { before[k] = o[k]; after[k] = patch[k]; (o as unknown as Record<string, unknown>)[k] = patch[k]; }
        }
        if (patch.ownerId) o.ownerName = c.db.users.find((u) => u.id === patch.ownerId)?.name ?? null;
        o.version += 1;
        o.updatedAt = now();
        if (Object.keys(after).length) {
          activity(c.db, c.W, { entityType: "opportunity", entityId: id, type: "FIELD_EDIT", actorId: c.user.id, actorName: c.user.name, summary: `Edited ${Object.keys(after).join(", ")}`, before, after });
        }
        persist();
        emit(c.W, { type: "opportunity:updated", opportunity: maskOpp(o, true) });
        return maskOpp(o, c.can("crm.view_values"));
      },
      async moveStage(id, version, stageId) {
        await wait(160);
        const c = ctx();
        c.need("crm.edit", "move opportunities");
        const o = c.db.opportunities.find((x) => x.id === id && x.workspaceId === c.W);
        if (!o) fail(404, "NOT_FOUND", "This opportunity doesn't exist in your workspace.");
        if (o.version !== version) fail(409, "VERSION_CONFLICT", "Someone else moved or edited this opportunity a moment ago.", "The board has been refreshed; try the move again.");
        const dest = stageById(c.db, c.W, stageId);
        if (!dest || dest.pipeline.id !== o.pipelineId) fail(422, "VALIDATION", "That stage belongs to another pipeline.");
        const fields = c.db.fields.filter((f) => f.workspaceId === c.W && f.entity === "opportunity" && !f.isArchived);
        const missing = dest.stage.requiredFieldKeys.filter((k) => o.custom[k] == null || o.custom[k] === "");
        if (missing.length) {
          const labels = missing.map((k) => fields.find((f) => f.key === k)?.label ?? k);
          fail(422, "REQUIRED_FIELDS_MISSING", `"${dest.stage.name}" needs ${labels.join(", ")} before an opportunity can move there.`, "Fill these fields, then move it again.", { stageId, missing, labels });
        }
        const from = stageById(c.db, c.W, o.stageId)?.stage.name;
        o.stageId = stageId;
        o.version += 1;
        o.updatedAt = now();
        activity(c.db, c.W, { entityType: "opportunity", entityId: id, type: "STAGE_CHANGE", actorId: c.user.id, actorName: c.user.name, summary: `Moved from ${from} to ${dest.stage.name}`, before: { stage: from }, after: { stage: dest.stage.name } });
        activity(c.db, c.W, { entityType: "contact", entityId: o.contactId, type: "STAGE_CHANGE", actorId: c.user.id, actorName: c.user.name, summary: `"${o.name}" moved to ${dest.stage.name}` });
        touchContact(c.db, c.W, o.contactId, c.user, "moved an opportunity");
        persist();
        emit(c.W, { type: "opportunity:updated", opportunity: maskOpp(o, true) });
        return maskOpp(o, c.can("crm.view_values"));
      },
    },

    leads: {
      async list({ scope, status, q }) {
        await wait(120);
        const c = ctx();
        let rows = visibleLeads(c);
        if (scope === "mine" || !c.can("leads.view_all")) rows = rows.filter((l) => l.ownerId === c.user.id);
        if (status === "OPEN") rows = rows.filter((l) => l.status === "ASSIGNED" || l.status === "NEW" || l.status === "ACKNOWLEDGED");
        else if (status) rows = rows.filter((l) => l.status === status);
        if (q) {
          const s = q.toLowerCase();
          rows = rows.filter((l) => `${l.contactName} ${l.contactPhone ?? ""} ${l.message}`.toLowerCase().includes(s));
        }
        const rank = (l: Lead) => (l.status === "ASSIGNED" ? 0 : l.status === "NEW" ? 1 : l.status === "ACKNOWLEDGED" ? 2 : 3);
        return [...rows]
          .sort((a, b) => rank(a) - rank(b) || (a.status === "ASSIGNED" ? (a.current?.dueAt ?? "").localeCompare(b.current?.dueAt ?? "") : b.createdAt.localeCompare(a.createdAt)))
          .map((l) => strip(l) as Lead);
      },
      async get(id) {
        await wait();
        const c = ctx();
        const lead = findLead(c, id);
        return {
          lead: strip(lead) as Lead,
          assignments: c.db.assignments.filter((a) => a.leadId === id).sort((a, b) => a.assignedAt.localeCompare(b.assignedAt)).map((a) => strip(a) as never),
          activities: c.db.activities.filter((a) => a.workspaceId === c.W && a.entityType === "lead" && a.entityId === id).sort((a, b) => b.at.localeCompare(a.at)).map((a) => strip(a) as never),
        };
      },
      async create({ name, phone, email, message }) {
        await wait();
        const c = ctx();
        c.need("crm.create", "create leads");
        return strip(intake(c.db, c.W, { name, phone, email, message }, "MANUAL", c.user)) as Lead;
      },
      async acknowledge(id) {
        await wait(150);
        const c = ctx();
        const lead = findLead(c, id);
        if (lead.ownerId !== c.user.id) fail(403, "NOT_OWNER", `Only ${lead.ownerName} can acknowledge this lead right now.`, "If they're away, reassign it instead.");
        if (lead.status !== "ASSIGNED") fail(409, "ALREADY_ACKNOWLEDGED", "This lead was already acknowledged.");
        acknowledge(c.db, lead, c.user, "clicked Acknowledge");
        persist();
        return strip(lead) as Lead;
      },
      async reassign(id, userId) {
        await wait();
        const c = ctx();
        c.need("leads.reassign", "reassign leads");
        const lead = findLead(c, id);
        const target = c.db.users.find((u) => u.id === userId && u.workspaceId === c.W && u.active);
        if (!target) fail(404, "NOT_FOUND", "That person isn't in your workspace.");
        if (target.availability === "ON_LEAVE" || target.availability === "OFFLINE") {
          fail(422, "NOT_AVAILABLE", `${target.name} is ${target.availability === "ON_LEAVE" ? "on leave" : "offline"} and can't receive leads.`, "Pick someone who is Available or Busy.");
        }
        if (lead.ownerId === userId) fail(409, "SAME_OWNER", `${target.name} already owns this lead.`);
        reassign(c.db, lead, target, c.user, "MANUAL");
        persist();
        return strip(lead) as Lead;
      },
      async close(id) {
        await wait();
        const c = ctx();
        const lead = findLead(c, id);
        if (lead.ownerId !== c.user.id && !c.can("leads.reassign")) fail(403, "FORBIDDEN", "Only the owner or a manager can close this lead.");
        if (lead.status === "ASSIGNED") acknowledge(c.db, lead, c.user, "closed the lead");
        const owner = c.db.users.find((u) => u.id === lead.ownerId);
        if (owner) owner.openLeadCount = Math.max(0, owner.openLeadCount - 1);
        lead.status = "CLOSED";
        lead.recoveryReason = "NONE";
        activity(c.db, c.W, { entityType: "lead", entityId: id, type: "NOTE", actorId: c.user.id, actorName: c.user.name, summary: "Lead closed" });
        persist();
        return strip(lead) as Lead;
      },
      async recovery() {
        await wait(120);
        const c = ctx();
        recomputeRecovery(c.db);
        return visibleLeads(c)
          .filter((l) => l.recoveryReason !== "NONE" && l.status !== "CLOSED")
          .sort((a, b) => a.lastActivityAt.localeCompare(b.lastActivityAt))
          .map((l) => strip(l) as Lead);
      },
    },

    conversations: {
      async list() {
        await wait(120);
        const c = ctx();
        return c.db.conversations
          .filter((x) => x.workspaceId === c.W && (c.can("leads.view_all") || x.assigneeId === c.user.id))
          .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
          .map((x) => strip(x) as never);
      },
      async get(id) {
        await wait(100);
        const c = ctx();
        const conv = c.db.conversations.find((x) => x.id === id && x.workspaceId === c.W && (c.can("leads.view_all") || x.assigneeId === c.user.id));
        if (!conv) fail(404, "NOT_FOUND", "This conversation doesn't exist or isn't assigned to you.");
        return {
          conversation: strip(conv) as never,
          messages: c.db.messages.filter((m) => m.conversationId === id).sort((a, b) => a.at.localeCompare(b.at)).map((m) => strip(m) as Message),
        };
      },
      async send(id, body) {
        await wait(200);
        const c = ctx();
        const conv = c.db.conversations.find((x) => x.id === id && x.workspaceId === c.W && (c.can("leads.view_all") || x.assigneeId === c.user.id));
        if (!conv) fail(404, "NOT_FOUND", "This conversation doesn't exist or isn't assigned to you.");
        if (conv.optedOut) fail(422, "OPTED_OUT", `${conv.contactName} has opted out of WhatsApp messages.`, "Contact them another way, or ask them to message you first to opt back in.");
        if (!body.trim()) fail(422, "VALIDATION", "Write a message first.");
        if (body.length > 1600) fail(422, "VALIDATION", "WhatsApp messages are limited to 1,600 characters.");
        const twilio = c.db.connections.find((x) => x.workspaceId === c.W && x.provider === "TWILIO");
        if (twilio?.status !== "CONNECTED") fail(503, "PROVIDER_NOT_CONNECTED", "WhatsApp isn't connected for this workspace.", "An Admin can connect Twilio in Settings → Integrations.");
        const lastInbound = c.db.messages.filter((m) => m.conversationId === id && m.direction === "INBOUND").sort((a, b) => b.at.localeCompare(a.at))[0];
        const outside24h = !lastInbound || Date.now() - new Date(lastInbound.at).getTime() > 24 * 3_600_000;
        const msg = {
          id: uid("msg"), workspaceId: c.W, conversationId: id, direction: "OUTBOUND" as const, body: body.trim(), status: "QUEUED" as const,
          errorCode: null, errorMessage: null, providerSid: `SM${uid("").slice(1)}`, sentById: c.user.id, sentByName: c.user.name, at: now(),
        };
        c.db.messages.push(msg);
        conv.lastMessageAt = msg.at;
        conv.lastMessagePreview = msg.body;
        c.db.events.push({ id: uid("evt"), workspaceId: c.W, provider: "TWILIO", direction: "OUTBOUND", type: "message.send", status: "OK", reference: msg.providerSid, error: null, at: now() });
        activity(c.db, c.W, { entityType: "contact", entityId: conv.contactId, type: "MESSAGE", actorId: c.user.id, actorName: c.user.name, summary: `WhatsApp sent: "${msg.body.slice(0, 80)}"` });
        touchContact(c.db, c.W, conv.contactId, c.user, "replied on WhatsApp");
        persist();
        scheduleDelivery(c.W, msg.id, outside24h ? "fail" : "ok");
        return strip(msg) as Message;
      },
      async retry(messageId) {
        await wait(200);
        const c = ctx();
        const m = c.db.messages.find((x) => x.id === messageId && x.workspaceId === c.W);
        if (!m || m.status !== "FAILED") fail(409, "NOT_RETRYABLE", "Only failed messages can be retried.");
        const conv = c.db.conversations.find((x) => x.id === m.conversationId)!;
        if (conv.optedOut) fail(422, "OPTED_OUT", `${conv.contactName} has opted out of WhatsApp messages.`);
        const lastInbound = c.db.messages.filter((x) => x.conversationId === m.conversationId && x.direction === "INBOUND").sort((a, b) => b.at.localeCompare(a.at))[0];
        const outside24h = !lastInbound || Date.now() - new Date(lastInbound.at).getTime() > 24 * 3_600_000;
        m.status = "QUEUED";
        m.errorCode = null;
        m.errorMessage = null;
        persist();
        scheduleDelivery(c.W, m.id, outside24h ? "fail" : "ok");
        return strip(m) as Message;
      },
      async markRead(id) {
        const c = ctx();
        const conv = c.db.conversations.find((x) => x.id === id && x.workspaceId === c.W);
        if (conv) conv.unreadCount = 0;
        persist();
      },
    },

    payments: {
      async list(params = {}) {
        await wait();
        const c = ctx();
        c.need("crm.view", "view payments");
        return c.db.payments
          .filter((p) => p.workspaceId === c.W && (!params.status || p.status === params.status) && (!params.opportunityId || p.opportunityId === params.opportunityId))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((p) => strip(p) as Payment);
      },
      async request({ opportunityId, amount, currency }) {
        await wait(700);
        const c = ctx();
        c.need("crm.edit", "request payments");
        const o = c.db.opportunities.find((x) => x.id === opportunityId && x.workspaceId === c.W);
        if (!o) fail(404, "NOT_FOUND", "This opportunity doesn't exist in your workspace.");
        if (!(amount > 0)) fail(422, "VALIDATION", "Enter an amount greater than zero.");
        if (amount > 999_999) fail(422, "VALIDATION", "Stripe test mode accepts up to 999,999 per payment.", "Split it into several requests.");
        const stripe = c.db.connections.find((x) => x.workspaceId === c.W && x.provider === "LEMONSQUEEZY");
        if (stripe?.status !== "CONNECTED") fail(503, "PROVIDER_NOT_CONNECTED", "Stripe isn't connected for this workspace.", "An Admin can connect Stripe in Settings → Integrations.");
        const session = `cs_test_${uid("").slice(1)}`;
        const p = {
          id: uid("pay"), workspaceId: c.W, opportunityId: o.id, opportunityName: o.name, contactId: o.contactId, contactName: o.contactName,
          requestedById: c.user.id, requestedByName: c.user.name, amount: Math.round(amount * 100) / 100, currency, status: "PENDING" as const,
          refundedAmount: 0, providerReference: session, checkoutUrl: `https://checkout.stripe.com/c/pay/${session}`, createdAt: now(), paidAt: null,
        };
        c.db.payments.push(p);
        o.paymentStatus = "PENDING";
        c.db.events.push({ id: uid("evt"), workspaceId: c.W, provider: "LEMONSQUEEZY", direction: "OUTBOUND", type: "checkout.session.create", status: "OK", reference: session, error: null, at: now() });
        activity(c.db, c.W, { entityType: "opportunity", entityId: o.id, type: "PAYMENT", actorId: c.user.id, actorName: c.user.name, summary: `Payment of ${amount} ${currency} requested` });
        activity(c.db, c.W, { entityType: "contact", entityId: o.contactId, type: "PAYMENT", actorId: c.user.id, actorName: c.user.name, summary: `Payment link created for "${o.name}"` });
        touchContact(c.db, c.W, o.contactId, c.user, "requested a payment");
        persist();
        return strip(p) as Payment;
      },
    },

    appointments: {
      async list(params = {}) {
        await wait();
        const c = ctx();
        return c.db.appointments
          .filter((a) => a.workspaceId === c.W && (!params.userId || a.userId === params.userId) && (!params.from || a.endsAt >= params.from) && (!params.to || a.startsAt <= params.to))
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
          .map((a) => strip(a) as Appointment);
      },
      async busy(userId, from, to) {
        await wait(300);
        const c = ctx();
        const u = c.db.users.find((x) => x.id === userId && x.workspaceId === c.W);
        if (!u) fail(404, "NOT_FOUND", "That person isn't in your workspace.");
        if (u.calendarStatus !== "CONNECTED") {
          fail(409, "CALENDAR_NOT_CONNECTED", u.calendarStatus === "NEEDS_RECONNECT" ? `${u.name}'s Google connection expired.` : `${u.name} hasn't connected a Google Calendar.`, `${u.name} can connect it from Settings → Profile.`);
        }
        return busyFor(c.db, c.W, userId, from, to);
      },
      async book(input) {
        await wait(600);
        const c = ctx();
        c.need("crm.edit", "book appointments");
        const u = c.db.users.find((x) => x.id === input.userId && x.workspaceId === c.W);
        if (!u) fail(404, "NOT_FOUND", "That person isn't in your workspace.");
        if (u.calendarStatus !== "CONNECTED") fail(409, "CALENDAR_NOT_CONNECTED", `${u.name} can't be booked until their Google Calendar is connected.`, `${u.name} can connect it from Settings → Profile.`);
        if (input.endsAt <= input.startsAt) fail(422, "VALIDATION", "The end time must be after the start time.");
        const clash = busyFor(c.db, c.W, u.id, input.startsAt, input.endsAt);
        if (clash.length) fail(409, "TIME_CONFLICT", `${u.name} is busy at that time.`, "Pick one of the free slots shown on the calendar.", { busy: clash });
        const contact = c.db.contacts.find((x) => x.id === input.contactId && x.workspaceId === c.W);
        if (!contact) fail(422, "VALIDATION", "Pick a contact for this appointment.");
        const row = {
          id: uid("apt"), workspaceId: c.W, title: input.title, contactId: contact.id, contactName: contactName(contact), opportunityId: input.opportunityId ?? null,
          userId: u.id, userName: u.name, startsAt: new Date(input.startsAt).toISOString(), endsAt: new Date(input.endsAt).toISOString(), timeZone: input.timeZone,
          googleEventId: `gcal_${uid("").slice(1)}`, status: "CONFIRMED" as const, notes: input.notes ?? null,
        };
        c.db.appointments.push(row);
        c.db.events.push({ id: uid("evt"), workspaceId: c.W, provider: "GOOGLE", direction: "OUTBOUND", type: "events.insert", status: "OK", reference: row.googleEventId, error: null, at: now() });
        activity(c.db, c.W, { entityType: "contact", entityId: contact.id, type: "APPOINTMENT", actorId: c.user.id, actorName: c.user.name, summary: `${row.title} booked with ${u.name}` });
        if (row.opportunityId) activity(c.db, c.W, { entityType: "opportunity", entityId: row.opportunityId, type: "APPOINTMENT", actorId: c.user.id, actorName: c.user.name, summary: `${row.title} booked with ${u.name}` });
        touchContact(c.db, c.W, contact.id, c.user, "booked an appointment");
        persist();
        return strip(row) as Appointment;
      },
      async reschedule(id, { startsAt, endsAt }) {
        await wait(500);
        const c = ctx();
        c.need("crm.edit", "reschedule appointments");
        const a = c.db.appointments.find((x) => x.id === id && x.workspaceId === c.W);
        if (!a) fail(404, "NOT_FOUND", "This appointment doesn't exist.");
        const clash = busyFor(c.db, c.W, a.userId, startsAt, endsAt).filter((s) => !(s.start === a.startsAt && s.end === a.endsAt));
        if (clash.length) fail(409, "TIME_CONFLICT", `${a.userName} is busy at that time.`, "Pick a free slot.", { busy: clash });
        const before = { startsAt: a.startsAt, endsAt: a.endsAt };
        a.startsAt = new Date(startsAt).toISOString();
        a.endsAt = new Date(endsAt).toISOString();
        c.db.events.push({ id: uid("evt"), workspaceId: c.W, provider: "GOOGLE", direction: "OUTBOUND", type: "events.patch", status: "OK", reference: a.googleEventId ?? id, error: null, at: now() });
        activity(c.db, c.W, { entityType: "contact", entityId: a.contactId, type: "APPOINTMENT", actorId: c.user.id, actorName: c.user.name, summary: `${a.title} rescheduled`, before, after: { startsAt: a.startsAt, endsAt: a.endsAt } });
        persist();
        return strip(a) as Appointment;
      },
      async cancel(id) {
        await wait(400);
        const c = ctx();
        c.need("crm.edit", "cancel appointments");
        const a = c.db.appointments.find((x) => x.id === id && x.workspaceId === c.W);
        if (!a) fail(404, "NOT_FOUND", "This appointment doesn't exist.");
        a.status = "CANCELLED";
        c.db.events.push({ id: uid("evt"), workspaceId: c.W, provider: "GOOGLE", direction: "OUTBOUND", type: "events.delete", status: "OK", reference: a.googleEventId ?? id, error: null, at: now() });
        activity(c.db, c.W, { entityType: "contact", entityId: a.contactId, type: "APPOINTMENT", actorId: c.user.id, actorName: c.user.name, summary: `${a.title} on ${new Date(a.startsAt).toLocaleDateString()} cancelled` });
        persist();
        return strip(a) as Appointment;
      },
    },

    integrations: {
      async list() {
        await wait(100);
        const c = ctx();
        return c.db.connections.filter((x) => x.workspaceId === c.W).map((x) => strip(x) as never);
      },
      async events(params = {}) {
        await wait(120);
        const c = ctx();
        c.need("integrations.manage", "view the sync history");
        return c.db.events.filter((e) => e.workspaceId === c.W && (!params.provider || e.provider === params.provider)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200).map((e) => strip(e) as never);
      },
      async alerts() {
        await wait(100);
        const c = ctx();
        c.need("integrations.manage", "view alert deliveries");
        return c.db.alerts.filter((a) => a.workspaceId === c.W).sort((a, b) => b.at.localeCompare(a.at)).map((a) => strip(a) as never);
      },
      async connect(provider, credentials) {
        await wait(900);
        const c = ctx();
        c.need("integrations.manage", "connect integrations");
        const conn = c.db.connections.find((x) => x.workspaceId === c.W && x.provider === provider)!;
        const secret = Object.values(credentials).find((v) => v.length > 6) ?? "";
        if (!secret) fail(422, "VALIDATION", "Paste the credentials from the provider's dashboard.");
        if (provider === "LEMONSQUEEZY" && !credentials.secretKey?.startsWith("sk_test_")) {
          fail(422, "LIVE_KEY_REJECTED", "Only Stripe test keys (sk_test_…) are accepted.", "Copy the secret key from Stripe's dashboard with Test mode switched on.");
        }
        const before = { status: conn.status };
        conn.status = "CONNECTED";
        conn.maskedCredential = `${secret.slice(0, 6)}••••••••${secret.slice(-4)}`;
        conn.lastOkAt = now();
        conn.lastError = null;
        Object.assign(conn, CONNECTION_COPY[provider]);
        audit(c.db, c.W, { action: "INTEGRATION_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "integration", targetId: provider, targetLabel: provider, before, after: { status: "CONNECTED" } });
        persist();
        emit(c.W, { type: "integration:updated", connection: strip(conn) as never });
        return strip(conn) as never;
      },
      async disconnect(provider) {
        await wait(500);
        const c = ctx();
        c.need("integrations.manage", "disconnect integrations");
        const conn = c.db.connections.find((x) => x.workspaceId === c.W && x.provider === provider)!;
        const before = { status: conn.status };
        conn.status = "NOT_CONNECTED";
        conn.maskedCredential = null;
        audit(c.db, c.W, { action: "INTEGRATION_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "integration", targetId: provider, targetLabel: provider, before, after: { status: "NOT_CONNECTED" } });
        persist();
        emit(c.W, { type: "integration:updated", connection: strip(conn) as never });
        return strip(conn) as never;
      },
      async test(provider) {
        await wait(1100);
        const c = ctx();
        c.need("integrations.manage", "test integrations");
        const conn = c.db.connections.find((x) => x.workspaceId === c.W && x.provider === provider)!;
        if (conn.status === "NOT_CONNECTED") fail(409, "NOT_CONNECTED", "Connect this integration before testing it.");
        conn.lastOkAt = now();
        c.db.events.push({ id: uid("evt"), workspaceId: c.W, provider, direction: "OUTBOUND", type: "health.check", status: "OK", reference: uid("chk"), error: null, at: now() });
        persist();
        return { ok: true, detail: "The provider answered." };
      },
      async googleConnectUrl() {
        await wait(600);
        const c = ctx();
        const before = c.user.calendarStatus;
        c.user.calendarStatus = "CONNECTED";
        audit(c.db, c.W, { action: "INTEGRATION_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "calendar", targetId: c.user.id, targetLabel: `${c.user.name}'s Google Calendar`, before: { status: before }, after: { status: "CONNECTED" } });
        persist();
        return { url: `/connect/google?status=connected` };
      },
      async disconnectGoogle() {
        await wait(300);
        const c = ctx();
        c.user.calendarStatus = "NOT_CONNECTED";
        audit(c.db, c.W, { action: "INTEGRATION_CHANGED", actorId: c.user.id, actorName: c.user.name, targetType: "calendar", targetId: c.user.id, targetLabel: `${c.user.name}'s Google Calendar`, before: { status: "CONNECTED" }, after: { status: "NOT_CONNECTED" } });
        persist();
        return publicUser(c.user);
      },
      async slackLink(input) {
        await wait(300);
        const c = ctx();
        c.user.slackLinked = true;
        c.user.slackUserId = input?.slackUserId ?? `U${uid("").slice(0, 8).toUpperCase()}`;
        persist();
        return { linked: true, slackUserId: c.user.slackUserId };
      },
      async slackUnlink() {
        await wait(200);
        const c = ctx();
        c.user.slackLinked = false;
        c.user.slackUserId = null;
        persist();
      },
    },

    audit: {
      async list({ action, actorId, from, to, page = 1, pageSize = 30 }) {
        await wait();
        const c = ctx();
        c.need("audit.view", "view the audit history");
        const rows = c.db.audit
          .filter((a) => a.workspaceId === c.W && (!action || a.action === action) && (!actorId || (actorId === "system" ? a.actorId === null : a.actorId === actorId)) && (!from || a.at >= from) && (!to || a.at <= to))
          .sort((a, b) => b.at.localeCompare(a.at));
        const p = paginate(rows, { page, pageSize });
        return { ...p, data: p.data.map((a) => strip(a) as AuditEvent) };
      },
    },

    dashboard: {
      async metrics() {
        await wait(180);
        return computeMetrics(ctx());
      },
      async prefs() {
        const c = ctx();
        return { hidden: c.db.prefs[c.user.id] ?? [] };
      },
      async savePrefs(hidden) {
        await wait(100);
        const c = ctx();
        c.db.prefs[c.user.id] = hidden;
        persist();
        return { hidden };
      },
    },

    savedLists: {
      async list(entity) {
        await wait(60);
        const c = ctx();
        return c.db.savedLists.filter((s) => s.workspaceId === c.W && s.entity === entity && (s.shared || s.ownerId === c.user.id)).map((s) => strip(s) as never);
      },
      async create(input) {
        await wait();
        const c = ctx();
        if (!input.name.trim()) fail(422, "VALIDATION", "Name the list so you can find it later.");
        const row = { ...input, id: uid("sl"), workspaceId: c.W, ownerId: c.user.id };
        c.db.savedLists.push(row);
        persist();
        return strip(row) as never;
      },
      async remove(id) {
        await wait();
        const c = ctx();
        const row = c.db.savedLists.find((s) => s.id === id && s.workspaceId === c.W);
        if (!row) fail(404, "NOT_FOUND", "This list doesn't exist.");
        if (row.ownerId !== c.user.id && c.user.baseLevel === "USER") fail(403, "FORBIDDEN", "Only the person who saved this list can delete it.");
        c.db.savedLists = c.db.savedLists.filter((s) => s.id !== id);
        persist();
      },
    },

    public: {
      async workspace(slug) {
        await wait(150);
        const ws = loadDB().workspaces.find((w) => w.slug === slug);
        if (!ws) fail(404, "NOT_FOUND", "We couldn't find this form.", "Check the link you were given.");
        return { name: ws.name, slug: ws.slug, timeZone: ws.timeZone };
      },
      async submitLead(slug, input) {
        await wait(700);
        const db = loadDB();
        const ws = db.workspaces.find((w) => w.slug === slug);
        if (!ws) fail(404, "NOT_FOUND", "We couldn't find this form.");
        if (input.website) return { reference: uid("ref").slice(4, 12).toUpperCase() };
        if (!input.email && !input.phone) fail(422, "VALIDATION", "Leave a phone number or an email so we can reply.");
        const lead = intake(db, ws.id, input, "WEB_FORM", null);
        return { reference: lead.id.slice(-8).toUpperCase() };
      },
      async paymentStatus(sessionId) {
        await wait(300);
        const db = loadDB();
        const p = db.payments.find((x) => x.providerReference === sessionId);
        if (!p) fail(404, "NOT_FOUND", "We couldn't find this payment.");
        return { status: p.status, amount: p.amount ?? 0, currency: p.currency, workspaceName: db.workspaces.find((w) => w.id === p.workspaceId)!.name };
      },
    },

    realtime: {
      subscribe(handler) {
        return onEngineEvent((e, workspaceId) => {
          try {
            const c = ctx();
            if (c.W === workspaceId) handler(e);
          } catch {
            // no session: nothing to deliver
          }
        });
      },
    },
  };
}

function intake(
  db: MockDB,
  W: string,
  input: { name: string; phone?: string; email?: string; message: string },
  source: Lead["source"],
  actor: User | null,
) {
  const phone = input.phone?.replace(/[^\d+]/g, "") || null;
  const email = input.email?.trim().toLowerCase() || null;
  let contact = db.contacts.find((x) => x.workspaceId === W && ((phone && x.phone === phone) || (email && x.email?.toLowerCase() === email)));
  if (!contact) {
    const [first, ...rest] = input.name.trim().split(/\s+/);
    contact = {
      id: uid("ct"), workspaceId: W, firstName: first ?? "Unknown", lastName: rest.join(" "), email, phone, companyId: null, companyName: null,
      ownerId: null, ownerName: null, tags: [], optedOut: false, custom: {}, createdAt: now(), lastActivityAt: now(), version: 1,
    };
    db.contacts.push(contact);
  }
  const lead = {
    id: uid("ld"), workspaceId: W, source, status: "NEW" as Lead["status"], contactId: contact.id, contactName: `${contact.firstName} ${contact.lastName}`.trim(),
    contactPhone: contact.phone, contactEmail: contact.email, message: input.message.trim(), ownerId: null, ownerName: null, current: null,
    escalationCount: 0, recoveryReason: "NONE" as Lead["recoveryReason"], firstAssignedAt: null, acknowledgedAt: null, timeToFirstResponseSec: null,
    lastActivityAt: now(), createdAt: now(),
  };
  db.leads.push(lead);
  activity(db, W, {
    entityType: "lead", entityId: lead.id, type: "CREATED", actorId: actor?.id ?? null, actorName: actor?.name ?? "System",
    summary: source === "WEB_FORM" ? "Lead captured from the web form" : source === "MESSAGE" ? "Lead captured from WhatsApp" : `Lead entered manually by ${actor?.name}`,
  });
  emit(W, { type: "lead:created", lead: strip(lead) as Lead });
  assignNew(db, lead);
  if (!contact.ownerId && lead.ownerId) {
    contact.ownerId = lead.ownerId;
    contact.ownerName = lead.ownerName;
  }
  persist();
  return lead;
}

/** Demo-only controls that stand in for provider webhooks while running without the backend. */
export const mockDemo = {
  reset() {
    resetDB();
  },
  webLead() {
    const db = loadDB();
    const W = db.workspaces[0]!.id;
    const names = ["Jordan Blake", "Camila Ortiz", "Wei Zhang", "Nadia Petrova", "Kofi Asante", "Ruth Adler"];
    const name = names[Math.floor(Math.random() * names.length)]!;
    return intake(db, W, { name, email: `${name.split(" ")[0]!.toLowerCase()}.${Date.now() % 10000}@mail.example`, message: "We're building a new garage and want panels on it. Can someone call me this week?" }, "WEB_FORM", null);
  },
  inboundWhatsApp(known: boolean) {
    const db = loadDB();
    const W = db.workspaces[0]!.id;
    const sid = `SM${uid("").slice(1)}`;
    db.events.push({ id: uid("evt"), workspaceId: W, provider: "TWILIO", direction: "INBOUND", type: "message.received", status: "OK", reference: sid, error: null, at: now() });
    if (!known) {
      const lead = intake(db, W, { name: "WhatsApp +1 415 555 7731", phone: `+1415555${String(Math.floor(Math.random() * 9000) + 1000)}`, message: "Hi, how much would panels cost for a 3 bedroom house?" }, "MESSAGE", null);
      const conv = { id: uid("cv"), workspaceId: W, contactId: lead.contactId, contactName: lead.contactName, contactPhone: lead.contactPhone!, channel: "WHATSAPP" as const, assigneeId: lead.ownerId, assigneeName: lead.ownerName, lastMessageAt: now(), lastMessagePreview: lead.message, unreadCount: 1, optedOut: false };
      db.conversations.push(conv);
      const m = { id: uid("msg"), workspaceId: W, conversationId: conv.id, direction: "INBOUND" as const, body: lead.message, status: "RECEIVED" as const, errorCode: null, errorMessage: null, providerSid: sid, sentById: null, sentByName: null, at: now() };
      db.messages.push(m);
      persist();
      emit(W, { type: "message:new", message: strip(m) as Message, conversationId: conv.id });
      return;
    }
    const conv = db.conversations.filter((x) => x.workspaceId === W && !x.optedOut).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))[0]!;
    const m = { id: uid("msg"), workspaceId: W, conversationId: conv.id, direction: "INBOUND" as const, body: "Thanks! Does Thursday at 10 still work?", status: "RECEIVED" as const, errorCode: null, errorMessage: null, providerSid: sid, sentById: null, sentByName: null, at: now() };
    db.messages.push(m);
    conv.lastMessageAt = m.at;
    conv.lastMessagePreview = m.body;
    conv.unreadCount += 1;
    activity(db, W, { entityType: "contact", entityId: conv.contactId, type: "MESSAGE", actorId: null, actorName: conv.contactName, summary: `WhatsApp received: "${m.body}"` });
    persist();
    emit(W, { type: "message:new", message: strip(m) as Message, conversationId: conv.id });
  },
  stripe(outcome: "PAID" | "EXPIRED" | "FAILED" | "REFUNDED") {
    const db = loadDB();
    const W = db.workspaces[0]!.id;
    const target =
      outcome === "REFUNDED"
        ? db.payments.filter((p) => p.workspaceId === W && p.status === "PAID").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        : db.payments.filter((p) => p.workspaceId === W && p.status === "PENDING").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!target) return null;
    target.status = outcome;
    if (outcome === "PAID") target.paidAt = now();
    if (outcome === "REFUNDED") target.refundedAmount = target.amount;
    const opp = db.opportunities.find((o) => o.id === target.opportunityId);
    if (opp) opp.paymentStatus = outcome;
    const type = { PAID: "checkout.session.completed", EXPIRED: "checkout.session.expired", FAILED: "checkout.session.async_payment_failed", REFUNDED: "charge.refunded" }[outcome];
    db.events.push({ id: uid("evt"), workspaceId: W, provider: "LEMONSQUEEZY", direction: "INBOUND", type, status: "OK", reference: `evt_${uid("").slice(1)}`, error: null, at: now() });
    activity(db, W, { entityType: "opportunity", entityId: target.opportunityId, type: "PAYMENT", actorId: null, actorName: "Stripe", summary: `Payment ${outcome.toLowerCase()} (${target.amount} ${target.currency})` });
    activity(db, W, { entityType: "contact", entityId: target.contactId, type: "PAYMENT", actorId: null, actorName: "Stripe", summary: `Payment ${outcome.toLowerCase()} for "${target.opportunityName}"` });
    persist();
    emit(W, { type: "payment:updated", payment: strip(target) as Payment });
    return target;
  },
  setAckWindow(sec: number) {
    const db = loadDB();
    for (const s of Object.values(db.settings)) {
      s.ackWindowSec = sec;
      s.levelWindowSec = sec;
    }
    persist();
  },
};

export type { RealtimeEvent };
