import { io, type Socket } from "socket.io-client";
import type { Api, ListParams, OpportunityDetail } from "./contract";
import { ApiError } from "./errors";
import type {
  Activity,
  ActivityType,
  AlertDelivery,
  Appointment,
  Assignment,
  AssignmentReason,
  AuditAction,
  AuditEvent,
  Availability,
  Company,
  Contact,
  Conversation,
  CustomField,
  CustomFieldEntity,
  CustomFieldType,
  DashboardMetrics,
  Filter,
  IntegrationConnection,
  IntegrationEvent,
  Lead,
  Message,
  Opportunity,
  Page,
  Payment,
  Permission,
  Pipeline,
  Provider,
  RealtimeEvent,
  Role,
  SavedList,
  Session,
  Stage,
  User,
  Workspace,
  WorkspaceSettings,
} from "./types";

/**
 * Live client for the NestJS backend (docs/api.md). Screens only know the `Api` contract; this file
 * translates between the backend's shapes and the view shapes the screens render, so either side can
 * change without touching the other.
 */

const TOKEN_KEY = "baton.token";
type Raw = Record<string, any>; // backend JSON; narrowed by the mappers below

function readToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(t: string | null) {
  try {
    if (t) window.localStorage.setItem(TOKEN_KEY, t);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable (private mode); the session lasts for this tab only
  }
}

function qs(params: Record<string, unknown> = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// ───────────── value maps between the two vocabularies ─────────────

const FIELD_TYPE_TO_API: Record<CustomFieldType, string> = { TEXT: "TEXT", NUMBER: "NUMBER", DATE: "DATE", SELECT: "DROPDOWN", BOOLEAN: "CHECKBOX" };
const FIELD_TYPE_FROM_API: Record<string, CustomFieldType> = { TEXT: "TEXT", NUMBER: "NUMBER", DATE: "DATE", DROPDOWN: "SELECT", CHECKBOX: "BOOLEAN" };
const entityToApi = (e: CustomFieldEntity | SavedList["entity"]) => e.toUpperCase();
const entityFromApi = (e: string) => e.toLowerCase() as CustomFieldEntity;

/** Backend audit actions are dotted (`lead.escalated`); the audit screen filters by these groups. */
const AUDIT_GROUPS: Record<AuditAction, string[]> = {
  LEAD_ASSIGNED: ["lead.assigned", "lead.unassignable"],
  LEAD_ACKNOWLEDGED: ["lead.acknowledged"],
  LEAD_ESCALATED: ["lead.escalated", "lead.escalation_exhausted"],
  LEAD_REASSIGNED: ["lead.reassigned", "lead.closed"],
  ROLE_CHANGED: ["role.created", "role.deleted"],
  PERMISSION_CHANGED: ["role.updated"],
  MEMBER_INVITED: ["user.invited", "user.invite_accepted"],
  MEMBER_LEVEL_CHANGED: ["user.privileges_updated", "user.deactivated", "user.reactivated", "user.availability_changed"],
  FIELD_CONFIG_CHANGED: ["field."],
  PIPELINE_CHANGED: ["pipeline.", "stage."],
  INTEGRATION_CHANGED: ["integration.", "alerts.slack_linked"],
  RECORD_DELETED: ["company.deleted", "contact.deleted", "opportunity.deleted"],
  SETTINGS_CHANGED: ["workspace.", "contact.opted_out", "contact.opted_in", "appointment.cancelled"],
  ALERT_SENT: ["payment."],
};

function auditActionFromApi(action: string): AuditAction {
  for (const [group, prefixes] of Object.entries(AUDIT_GROUPS) as [AuditAction, string[]][]) {
    if (prefixes.some((p) => action === p || (p.endsWith(".") && action.startsWith(p)))) return group;
  }
  return "SETTINGS_CHANGED";
}

const ACTIVITY_TYPES: Record<string, ActivityType> = {
  created: "CREATED",
  note: "NOTE",
  stage_change: "STAGE_CHANGE",
  assignment: "ASSIGNMENT",
  reassignment: "REASSIGNMENT",
  acknowledgement: "ACKNOWLEDGED",
  escalation: "ESCALATION",
  field_edit: "FIELD_EDIT",
  message: "MESSAGE",
  payment: "PAYMENT",
  appointment: "APPOINTMENT",
};

const EVENT_STATUS: Record<string, IntegrationEvent["status"]> = { RECEIVED: "OK", PROCESSED: "OK", FAILED: "FAILED", REJECTED: "REJECTED" };

function apiFilters(filters?: Filter[], search?: string) {
  const criteria = (filters ?? []).map((f) => {
    if (f.field === "tags" && (f.op === "contains" || f.op === "eq")) return { field: "tags", op: "hasTag", value: f.value };
    return { field: f.field, op: f.op, value: f.value };
  });
  if (!criteria.length && !search) return undefined;
  return { logic: "AND", criteria, ...(search ? { search } : {}) };
}

function filtersFromApi(raw: Raw | null | undefined): Filter[] {
  return ((raw?.criteria ?? []) as Raw[]).map((c) => ({
    field: c.field,
    op: (c.op === "hasTag" ? "contains" : c.op) as Filter["op"],
    ...(c.value !== undefined ? { value: c.value } : {}),
  }));
}

const fullName = (p?: Raw | null) => (p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() : "");
const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));

// ───────────── mappers ─────────────

function mapUser(u: Raw): User {
  return {
    id: u.id,
    name: fullName(u),
    email: u.email,
    baseLevel: u.baseLevel,
    roleId: u.roleId ?? "",
    roleName: u.roleName ?? u.role?.name ?? "",
    availability: u.availability,
    openLeadCount: u.openLeadCount ?? 0,
    maxOpenLeads: u.maxOpenLeads ?? null,
    isManager: Boolean(u.isManager),
    backupUserId: u.backupUserId ?? null,
    slackLinked: Boolean(u.slackLinked ?? u.slackUserId),
    slackUserId: u.slackUserId ?? null,
    invitePending: Boolean(u.invitePending),
    calendarStatus: u.calendarStatus ?? "NOT_CONNECTED",
    timeZone: u.timeZone ?? "UTC",
    lastAssignedAt: u.lastAssignedAt ?? null,
    active: u.isActive !== false,
  };
}

function mapWorkspace(w: Raw): Workspace {
  return { id: w.id, name: w.name, slug: w.slug, timeZone: w.timeZone, currency: w.currency };
}

function mapSettings(w: Raw): WorkspaceSettings {
  return {
    ackWindowSec: w.ackWindowSec,
    escalationLevels: w.escalationLevels,
    levelWindowSec: w.levelWindowSec,
    idleSec: w.idleSec,
    maxOpenLeadsDefault: w.maxOpenLeadsDefault,
    acknowledgedOnAbsence: w.acknowledgedLeadsOnAbsence,
  };
}

function mapRole(r: Raw): Role {
  return { id: r.id, name: r.name, description: r.description ?? "", permissions: r.permissions as Permission[], isSystem: Boolean(r.isSystem), memberCount: r.userCount ?? 0 };
}

function mapCompany(c: Raw): Company {
  return {
    id: c.id,
    name: c.name,
    domain: c.domain ?? null,
    industry: c.industry ?? null,
    city: c.city ?? null,
    contactCount: c._count?.contacts ?? c.contacts?.length ?? 0,
    openOpportunityCount: c._count?.opportunities ?? 0,
    createdAt: c.createdAt,
  };
}

function mapContact(c: Raw, companyName?: string | null): Contact {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName ?? "",
    email: c.email ?? null,
    phone: c.phone ?? null,
    companyId: c.companyId ?? null,
    companyName: c.company?.name ?? companyName ?? null,
    ownerId: c.ownerId ?? null,
    ownerName: c.owner ? fullName(c.owner) : null,
    tags: c.tags ?? [],
    optedOut: Boolean(c.optedOut),
    custom: c.custom ?? {},
    createdAt: c.createdAt,
    lastActivityAt: c.updatedAt ?? null,
    version: c.version,
  };
}

function mapField(f: Raw): CustomField {
  return { id: f.id, entity: entityFromApi(f.entity), key: f.key, label: f.label, type: FIELD_TYPE_FROM_API[f.type] ?? "TEXT", options: f.options ?? [], pipelineId: f.pipelineId ?? null, isArchived: Boolean(f.isArchived), order: f.order ?? 0 };
}

function mapStage(s: Raw): Stage {
  return { id: s.id, pipelineId: s.pipelineId, name: s.name, order: s.order, isWon: Boolean(s.isWon), isLost: Boolean(s.isLost), requiredFieldKeys: s.requiredFieldKeys ?? [] };
}

function mapPipeline(p: Raw): Pipeline {
  return { id: p.id, name: p.name, stages: ((p.stages ?? []) as Raw[]).map(mapStage).sort((a, b) => a.order - b.order) };
}

function mapOpportunity(o: Raw): Opportunity {
  const out: Opportunity = {
    id: o.id,
    name: o.name,
    contactId: o.contactId,
    contactName: fullName(o.contact),
    companyName: o.company?.name ?? null,
    pipelineId: o.pipelineId,
    stageId: o.stageId,
    ownerId: o.ownerId ?? null,
    ownerName: o.owner ? fullName(o.owner) : null,
    currency: o.currency,
    custom: o.custom ?? {},
    paymentStatus: !o.paymentStatus || o.paymentStatus === "NONE" ? null : o.paymentStatus,
    expectedCloseDate: o.closeDate ?? null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    version: o.version,
  };
  // F1.4: the key is absent when the caller may not see values
  if (!o.valueHidden && o.value !== null && o.value !== undefined) out.value = Number(o.value);
  return out;
}

function assignmentReason(a: Raw): AssignmentReason {
  const reason = String(a.reason ?? "").toLowerCase();
  if (a.level > 0 || reason.includes("escalat") || reason.includes("window expired")) return "ESCALATION";
  if (reason.includes("absent") || reason.includes("on_leave") || reason.includes("offline") || reason.includes("deactivated")) return "ABSENCE";
  if (reason.includes("manual")) return "MANUAL";
  return "ROUND_ROBIN";
}

function mapAssignment(a: Raw, leadId: string): Assignment {
  return {
    id: a.id,
    leadId,
    userId: a.assigneeId,
    userName: fullName(a.assignee),
    level: a.level ?? 0,
    status: a.status === "CANCELLED" ? "REASSIGNED" : a.status,
    reason: assignmentReason(a),
    assignedAt: a.assignedAt,
    dueAt: a.dueAt,
    resolvedAt: a.resolvedAt ?? null,
  };
}

function mapLead(l: Raw): Lead {
  const ownerName = l.currentAssignee ? fullName(l.currentAssignee) : null;
  const current: Assignment | null =
    l.currentAssignmentId && l.status !== "CLOSED"
      ? {
          id: l.currentAssignmentId,
          leadId: l.id,
          userId: l.currentAssigneeId,
          userName: ownerName ?? "",
          level: l.escalationLevel ?? 0,
          status: l.status === "ASSIGNED" ? "PENDING" : "ACKNOWLEDGED",
          reason: (l.escalationLevel ?? 0) > 0 ? "ESCALATION" : "ROUND_ROBIN",
          assignedAt: l.lastAssignedAt ?? l.createdAt,
          dueAt: l.dueAt ?? l.lastAssignedAt ?? l.createdAt,
          resolvedAt: null,
        }
      : null;
  return {
    id: l.id,
    source: l.source,
    status: l.status,
    contactId: l.contactId,
    contactName: fullName(l.contact) || l.title,
    contactPhone: l.contact?.phone ?? null,
    contactEmail: l.contact?.email ?? null,
    message: l.notes ?? l.title ?? "",
    ownerId: l.currentAssigneeId ?? null,
    ownerName,
    current,
    escalationCount: l.escalationCount ?? 0,
    recoveryReason: l.recoveryReason ?? "NONE",
    firstAssignedAt: l.firstAssignedAt ?? null,
    acknowledgedAt: l.firstAckedAt ?? null,
    timeToFirstResponseSec: l.timeToFirstResponseSec ?? null,
    lastActivityAt: l.lastActivityAt ?? l.updatedAt ?? l.createdAt,
    createdAt: l.createdAt,
  };
}

function money(amount: unknown, currency?: string) {
  const n = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(n);
  } catch {
    return `${currency ?? ""} ${n.toFixed(2)}`;
  }
}

function activitySummary(a: Raw, userName: (id?: string | null) => string): string {
  const p = (a.payload ?? {}) as Raw;
  switch (a.type) {
    case "created":
      return p.source ? `Created (${String(p.source).toLowerCase().replace("_", " ")})` : "Created";
    case "note":
      return String(p.body ?? "Note added");
    case "stage_change":
      return p.from && p.to ? `Moved from ${p.from} to ${p.to}` : p.reason ? `Stage changed (${p.reason})` : "Stage changed";
    case "assignment":
      return `Assigned to ${userName(p.toUserId)}${p.reason ? ` · ${p.reason}` : ""}`;
    case "reassignment":
      return `Reassigned from ${userName(p.fromUserId)} to ${userName(p.toUserId)}${p.reason ? ` · ${p.reason}` : ""}`;
    case "acknowledgement":
      return `Acknowledged${p.via && p.via !== "acknowledge" ? ` by ${String(p.via).replace("_", " ")}` : ""}${p.timeToFirstResponseSec != null ? ` after ${p.timeToFirstResponseSec}s` : ""}`;
    case "escalation":
      return `Escalated from ${userName(p.fromUserId)} to ${userName(p.toUserId)} (level ${p.level}) · ${p.reason ?? ""}`.trim();
    case "field_edit": {
      const keys = Object.keys((p.changes as Raw) ?? {});
      return keys.length ? `Edited ${keys.join(", ")}` : "Edited";
    }
    case "message":
      return `${p.direction === "INBOUND" ? "WhatsApp received" : "WhatsApp sent"}: ${p.preview ?? ""}`;
    case "payment":
      return `Payment ${String(p.status ?? "").toLowerCase().replace("_", " ")} · ${money(p.amount, p.currency)}`;
    case "appointment":
      return `Appointment ${p.action ?? "updated"}${p.startsAt ? ` for ${new Date(p.startsAt).toLocaleString()}` : ""}`;
    case "opt_out":
      return "Opted out of messages";
    case "closed":
      return `Closed${p.reason ? `: ${p.reason}` : ""}`;
    case "conversation_assigned":
      return `Conversation assigned to ${userName(p.toUserId)}`;
    default:
      return String(a.type).replace(/_/g, " ");
  }
}

function mapActivity(a: Raw, userName: (id?: string | null) => string): Activity {
  const changes = (a.payload?.changes ?? null) as Raw | null;
  return {
    id: a.id,
    entityType: String(a.entityType).toLowerCase() as Activity["entityType"],
    entityId: a.entityId,
    type: ACTIVITY_TYPES[a.type] ?? (a.type === "closed" || a.type === "opt_out" ? "FIELD_EDIT" : "NOTE"),
    actorId: a.actorId ?? null,
    actorName: a.actor ? fullName(a.actor) : "System",
    summary: activitySummary(a, userName),
    ...(changes ? { before: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, (v as Raw).from])), after: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, (v as Raw).to])) } : {}),
    at: a.createdAt,
  };
}

function mapMessage(m: Raw): Message {
  return {
    id: m.id,
    conversationId: m.conversationId,
    direction: m.direction,
    body: m.body ?? "",
    status: m.direction === "INBOUND" ? "RECEIVED" : m.status === "UNDELIVERED" ? "FAILED" : m.status,
    errorCode: m.errorCode ?? null,
    errorMessage: m.errorMessage ?? null,
    providerSid: m.providerSid ?? null,
    sentById: m.sentById ?? null,
    sentByName: m.sentBy ? fullName(m.sentBy) : null,
    at: m.createdAt,
  };
}

function mapConversation(c: Raw): Conversation {
  return {
    id: c.id,
    contactId: c.contactId,
    contactName: fullName(c.contact),
    contactPhone: c.contact?.phone ?? String(c.externalAddress ?? "").replace(/^whatsapp:/, ""),
    channel: "WHATSAPP",
    assigneeId: c.assigneeId ?? null,
    assigneeName: c.assignee ? fullName(c.assignee) : null,
    lastMessageAt: c.lastMessageAt ?? c.createdAt,
    lastMessagePreview: c.lastMessage?.body ?? "",
    unreadCount: c.unreadCount ?? 0,
    optedOut: Boolean(c.contact?.optedOut),
  };
}

function mapPayment(p: Raw): Payment {
  return {
    id: p.id,
    opportunityId: p.opportunityId,
    opportunityName: p.opportunity?.name ?? "",
    contactId: p.contactId,
    contactName: fullName(p.contact),
    requestedById: p.requestedById ?? "",
    requestedByName: p.requestedBy ? fullName(p.requestedBy) : "",
    amount: p.amount === null || p.valueHidden ? null : num(p.amount),
    currency: p.currency,
    status: p.status,
    refundedAmount: p.refundedAmount === null || p.valueHidden ? null : num(p.refundedAmount),
    providerReference: p.providerOrderId ?? p.checkoutId ?? "",
    checkoutUrl: p.status === "PENDING" ? p.checkoutUrl ?? null : null,
    createdAt: p.createdAt,
    paidAt: p.paidAt ?? null,
  };
}

function mapAppointment(a: Raw): Appointment {
  return {
    id: a.id,
    title: a.title,
    contactId: a.contactId,
    contactName: fullName(a.contact),
    opportunityId: a.opportunityId ?? null,
    userId: a.userId,
    userName: fullName(a.user),
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    timeZone: a.timeZone,
    googleEventId: a.googleEventId ?? null,
    status: a.status === "CANCELLED" ? "CANCELLED" : "CONFIRMED",
    notes: a.description ?? null,
  };
}

function mapConnection(c: Raw): IntegrationConnection {
  const masked = Object.entries((c.maskedCredentials ?? {}) as Record<string, string>)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
  return {
    provider: c.provider,
    status: c.status === "NEEDS_RECONNECT" ? "ERROR" : c.status,
    maskedCredential: masked || null,
    lastOkAt: c.lastOkAt ?? null,
    lastError: c.lastError ?? null,
    lastErrorAt: c.lastError ? c.updatedAt ?? new Date().toISOString() : null,
    canDo: [c.purpose].filter(Boolean),
    cannotDo: c.limits ?? [],
    webhookUrl: c.webhookUrl ?? null,
    statusCallbackUrl: c.statusCallbackUrl ?? null,
    details: c.details ?? {},
  };
}

function mapEvent(e: Raw): IntegrationEvent {
  return {
    id: e.id,
    provider: e.provider,
    direction: e.direction === "IN" ? "INBOUND" : "OUTBOUND",
    type: e.type,
    status: EVENT_STATUS[e.status] ?? "OK",
    reference: String(e.externalEventId ?? e.relatedId ?? e.id).replace(/^out:/, ""),
    error: e.error ?? null,
    at: e.createdAt,
  };
}

function mapAlert(a: Raw): AlertDelivery {
  return {
    id: a.id,
    leadId: a.leadId,
    leadLabel: a.lead?.title ?? "Lead",
    userId: a.userId,
    userName: fullName(a.user),
    channel: "SLACK",
    status: a.status === "PENDING" ? "RETRYING" : a.status,
    attempts: a.attempts ?? 0,
    lastError: a.lastError ?? null,
    at: a.sentAt ?? a.createdAt,
  };
}

function mapAudit(e: Raw): AuditEvent {
  const after = (e.after ?? {}) as Raw;
  const before = (e.before ?? {}) as Raw;
  const label = after.name ?? before.name ?? after.email ?? before.email ?? after.provider ?? before.provider ?? `${e.targetType} ${String(e.targetId).slice(0, 8)}`;
  return {
    id: e.id,
    action: auditActionFromApi(e.action),
    actorId: e.actorId ?? null,
    actorName: e.actorId ? String(e.actorLabel).replace(/\s*<.*>$/, "") : e.actorLabel === "system" ? "System" : e.actorLabel,
    targetType: e.targetType,
    targetId: e.targetId,
    targetLabel: `${e.action} · ${label}`,
    before: e.before ?? null,
    after: e.after ?? null,
    at: e.createdAt,
  };
}

function mapSavedList(l: Raw): SavedList {
  return { id: l.id, entity: entityFromApi(l.entity) as SavedList["entity"], name: l.name, filters: filtersFromApi(l.filters), shared: Boolean(l.isShared), ownerId: l.ownerId };
}

function pageFrom<T>(json: Raw, map: (r: Raw) => T, page: number, pageSize: number): Page<T> {
  return { data: ((json.data ?? []) as Raw[]).map(map), meta: { total: json.meta?.total ?? json.data?.length ?? 0, page, pageSize } };
}

// ───────────── client ─────────────

export function createHttpApi(baseUrl: string): Api {
  const base = baseUrl.replace(/\/$/, "");

  async function req<T = any>(method: string, path: string, body?: unknown, opts: { raw?: boolean; envelope?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: opts.raw ? "text/csv" : "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const t = readToken();
    if (t) headers.Authorization = `Bearer ${t}`;
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, { code: "NETWORK", message: "Couldn't reach the server.", action: "Check your connection and try again." });
    }
    if (!res.ok) {
      let err: Raw = { code: `HTTP_${res.status}`, message: res.statusText || "Request failed." };
      try {
        err = (await res.json()) as Raw;
      } catch {
        // non-JSON error body
      }
      if (res.status === 401 && path !== "/auth/login") writeToken(null);
      if (res.status === 429 && !err.message) err.message = "Too many attempts. Wait a minute and try again.";
      const details = Array.isArray(err.details) ? (err.details as Raw[]) : null;
      const message = details?.length ? `${err.message} ${details.map((d) => `${d.path || "input"}: ${d.message}`).join("; ")}` : err.message;
      throw new ApiError(res.status, { code: err.code ?? `HTTP_${res.status}`, message: message ?? "Request failed.", action: err.action, details: err.details });
    }
    if (res.status === 204) return undefined as T;
    if (opts.raw) return (await res.text()) as T;
    const json = (await res.json()) as Raw;
    return (opts.envelope ? json : json.data) as T;
  }

  const get = <T = any,>(p: string) => req<T>("GET", p);
  const envelope = (p: string) => req<Raw>("GET", p, undefined, { envelope: true });
  const post = <T = any,>(p: string, b?: unknown) => req<T>("POST", p, b ?? {});
  const patch = <T = any,>(p: string, b: unknown) => req<T>("PATCH", p, b);
  const put = <T = any,>(p: string, b: unknown) => req<T>("PUT", p, b);
  const del = <T = any,>(p: string) => req<T>("DELETE", p);

  // Member names for activity summaries; refreshed at most once a minute
  let usersCache: { at: number; byId: Map<string, string> } | null = null;
  async function userNames() {
    if (!usersCache || Date.now() - usersCache.at > 60_000) {
      const list = (await get<Raw[]>("/users?includeInactive=true").catch(() => [])) ?? [];
      usersCache = { at: Date.now(), byId: new Map(list.map((u) => [u.id as string, fullName(u)])) };
    }
    const byId = usersCache.byId;
    return (id?: string | null) => (id ? byId.get(id) ?? "someone" : "nobody");
  }

  async function session(): Promise<Session> {
    const s = await get<Raw>("/auth/me");
    return { token: readToken() ?? "", user: mapUser(s.user), workspace: mapWorkspace(s.workspace), permissions: s.permissions as Permission[], expiresAt: s.expiresAt };
  }

  async function signedIn(r: Raw): Promise<Session> {
    writeToken(r.token);
    return session();
  }

  async function leadDetail(id: string) {
    const [lead, acts, names] = await Promise.all([get<Raw>(`/leads/${id}`), envelope(`/leads/${id}/activities?limit=100`), userNames()]);
    return {
      lead: mapLead(lead),
      assignments: ((lead.assignments ?? []) as Raw[]).map((a) => mapAssignment(a, id)),
      activities: ((acts.data ?? []) as Raw[]).map((a) => mapActivity(a, names)),
    };
  }

  // ── realtime: backend events carry ids; fetch the object so toasts can name it ──
  let socket: Socket | null = null;
  const handlers = new Set<(e: RealtimeEvent) => void>();
  const emit = (e: RealtimeEvent) => handlers.forEach((h) => h(e));

  async function connectSocket() {
    if (socket || !readToken()) return;
    const { token: wsToken } = await get<{ token: string }>("/auth/ws-token");
    socket = io(base, { transports: ["websocket"], auth: async (cb) => {
      // A fresh 60-second token on every (re)connect
      try {
        const fresh = await get<{ token: string }>("/auth/ws-token");
        cb({ token: fresh.token });
      } catch {
        cb({ token: wsToken });
      }
    } });
    let connectedOnce = false;
    socket.on("connect", () => {
      // Delivery is at-most-once: after a reconnect, refetch everything that may have changed
      if (connectedOnce) emit({ type: "refresh", keys: ["leads", "lead", "recovery", "dashboard", "conversations", "conversation", "payments", "members", "integrations"] });
      connectedOnce = true;
    });
    const leadEvent = (type: "lead:created" | "lead:assigned" | "lead:acknowledged" | "lead:escalated") => async (payload: Raw) => {
      try {
        const lead = mapLead(await get<Raw>(`/leads/${payload.leadId}`));
        if (type === "lead:escalated") {
          const names = await userNames();
          emit({ type, lead, fromUserName: payload.fromUserId ? names(payload.fromUserId) : null });
        } else emit({ type, lead } as RealtimeEvent);
      } catch {
        emit({ type: "refresh", keys: ["leads", "lead", "recovery", "dashboard", "members"] });
      }
    };
    socket.on("lead:created", leadEvent("lead:created"));
    socket.on("lead:assigned", leadEvent("lead:assigned"));
    socket.on("lead:reassigned", leadEvent("lead:assigned"));
    socket.on("lead:acknowledged", leadEvent("lead:acknowledged"));
    socket.on("lead:escalated", leadEvent("lead:escalated"));
    socket.on("lead:updated", () => emit({ type: "refresh", keys: ["leads", "lead", "recovery", "dashboard", "opportunities", "opportunity"] }));
    socket.on("lead:recovery", () => emit({ type: "refresh", keys: ["recovery", "leads", "lead", "dashboard"] }));
    socket.on("message:new", (p: Raw) => {
      emit({
        type: "message:new",
        conversationId: p.conversationId,
        message: { id: p.messageId, conversationId: p.conversationId, direction: p.direction ?? "INBOUND", body: p.preview ?? "", status: p.direction === "OUTBOUND" ? "QUEUED" : "RECEIVED", errorCode: null, errorMessage: null, providerSid: null, sentById: null, sentByName: null, at: new Date().toISOString() },
      });
      if (p.leadId) emit({ type: "refresh", keys: ["leads", "lead", "recovery", "dashboard"] });
    });
    socket.on("message:status", (p: Raw) => {
      emit({
        type: "message:status",
        message: { id: p.messageId, conversationId: p.conversationId, direction: "OUTBOUND", body: "", status: p.status === "UNDELIVERED" ? "FAILED" : p.status, errorCode: p.errorCode ?? null, errorMessage: p.errorMessage ?? null, providerSid: null, sentById: null, sentByName: null, at: new Date().toISOString() },
      });
    });
    socket.on("payment:updated", async (p: Raw) => {
      try {
        emit({ type: "payment:updated", payment: mapPayment(await get<Raw>(`/payments/${p.paymentId}`)) });
      } catch {
        emit({ type: "refresh", keys: ["payments", "dashboard", "opportunity", "opportunities", "contact"] });
      }
    });
    socket.on("availability:changed", async (p: Raw) => {
      try {
        emit({ type: "availability:changed", user: mapUser(await get<Raw>(`/users/${p.userId}`)) });
      } catch {
        emit({ type: "refresh", keys: ["members", "dashboard"] });
      }
    });
    socket.on("appointment:updated", () => emit({ type: "refresh", keys: ["appointments", "dashboard", "contact", "opportunity"] }));
    socket.on("integration:status", () => emit({ type: "refresh", keys: ["integrations", "session", "members"] }));
    socket.on("notification", () => emit({ type: "refresh", keys: ["session"] }));
  }

  return {
    auth: {
      async login(input) {
        return signedIn(await post<Raw>("/auth/login", input));
      },
      async signup({ workspaceName, name, email, password }) {
        const [firstName, ...rest] = name.trim().split(/\s+/);
        return signedIn(await post<Raw>("/auth/signup", { workspaceName, firstName, lastName: rest.join(" ") || firstName, email, password, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
      },
      async acceptInvite(token, input) {
        return signedIn(await post<Raw>(`/auth/invites/${encodeURIComponent(token)}/accept`, input));
      },
      me: () => session(),
      async logout() {
        try {
          await post("/auth/logout");
        } finally {
          writeToken(null);
          socket?.disconnect();
          socket = null;
        }
      },
    },
    workspace: {
      get: async () => mapWorkspace(await get("/workspace")),
      update: async (b) => mapWorkspace(await patch("/workspace", b)),
      settings: async () => mapSettings(await get("/workspace")),
      updateSettings: async ({ acknowledgedOnAbsence, ...rest }) =>
        mapSettings(await patch("/workspace", { ...rest, ...(acknowledgedOnAbsence ? { acknowledgedLeadsOnAbsence: acknowledgedOnAbsence } : {}) })),
    },
    members: {
      // Includes deactivated members so they can be reactivated; pickers filter on `active`
      list: async () => ((await get<Raw[]>("/users?includeInactive=true")) ?? []).map(mapUser),
      async invite({ email, name, baseLevel, roleId }) {
        const [firstName, ...rest] = name.trim().split(/\s+/);
        const r = await post<Raw>("/users", { email, firstName, lastName: rest.join(" ") || firstName, ...(baseLevel === "ADMIN" ? { baseLevel } : {}), roleId: roleId || null });
        usersCache = null;
        return { user: mapUser(r.user), inviteUrl: r.inviteUrl };
      },
      async update(id, p) {
        const body: Raw = {};
        if (p.baseLevel !== undefined) body.baseLevel = p.baseLevel;
        if (p.roleId !== undefined) body.roleId = p.roleId || null;
        if (p.maxOpenLeads !== undefined) body.maxOpenLeads = p.maxOpenLeads;
        if (p.backupUserId !== undefined) body.backupUserId = p.backupUserId || null;
        if (p.isManager !== undefined) body.isEscalationManager = p.isManager;
        return mapUser(await patch(`/users/${id}`, body));
      },
      setAvailability: async (id, availability) => mapUser(await patch(`/users/${id}/availability`, { availability })),
      async deactivate(id) {
        await del(`/users/${id}`);
        return mapUser(await get(`/users/${id}`));
      },
      reactivate: async (id) => mapUser(await post(`/users/${id}/reactivate`)),
    },
    roles: {
      list: async () => ((await get<Raw[]>("/roles")) ?? []).map(mapRole),
      create: async (b) => mapRole({ ...(await post<Raw>("/roles", b)), userCount: 0 }),
      update: async (id, b) => {
        await patch(`/roles/${id}`, b);
        const all = ((await get<Raw[]>("/roles")) ?? []).map(mapRole);
        return all.find((r) => r.id === id)!;
      },
      remove: async (id) => {
        await del(`/roles/${id}`);
      },
    },
    companies: {
      async list(p: ListParams = {}) {
        const page = p.page ?? 1;
        const pageSize = p.pageSize ?? 25;
        return pageFrom(await envelope(`/companies${qs({ page, limit: pageSize, search: p.q, filters: apiFilters(p.filters) })}`), mapCompany, page, pageSize);
      },
      async get(id) {
        const c = await get<Raw>(`/companies/${id}`);
        return { company: mapCompany(c), contacts: ((c.contacts ?? []) as Raw[]).map((x) => mapContact(x, c.name)), opportunities: ((c.opportunities ?? []) as Raw[]).map(mapOpportunity) };
      },
      create: async (b) => mapCompany(await post("/companies", b)),
    },
    contacts: {
      async list(p: ListParams = {}) {
        const page = p.page ?? 1;
        const pageSize = p.pageSize ?? 25;
        return pageFrom(await envelope(`/contacts${qs({ page, limit: pageSize, search: p.q, filters: apiFilters(p.filters) })}`), (c) => mapContact(c), page, pageSize);
      },
      async overview(id) {
        const [o, names] = await Promise.all([get<Raw>(`/contacts/${id}/overview`), userNames()]);
        const contact = mapContact(o.contact);
        const [company, owner] = await Promise.all([
          o.contact.companyId ? get<Raw>(`/companies/${o.contact.companyId}`).then(mapCompany).catch(() => null) : Promise.resolve(null),
          o.contact.ownerId ? get<Raw>(`/users/${o.contact.ownerId}`).then(mapUser).catch(() => null) : Promise.resolve(null),
        ]);
        return {
          contact,
          company,
          owner,
          opportunities: ((o.opportunities ?? []) as Raw[]).map(mapOpportunity),
          conversations: ((o.conversations ?? []) as Raw[]).map((c) => mapConversation({ ...c, contact: o.contact, lastMessage: c.messages?.[0] })),
          payments: ((o.payments ?? []) as Raw[]).map((p) => mapPayment({ ...p, contact: o.contact, opportunity: (o.opportunities as Raw[]).find((x) => x.id === p.opportunityId) })),
          appointments: ((o.appointments ?? []) as Raw[]).map((a) => mapAppointment({ ...a, contact: o.contact })),
          leads: ((o.leads ?? []) as Raw[]).map((l) => mapLead({ ...l, contact: o.contact })),
          activities: ((o.timeline ?? []) as Raw[]).map((a) => mapActivity(a, names)),
        };
      },
      create: async ({ lastName, ...b }) => mapContact(await post("/contacts", { ...b, ...(lastName ? { lastName } : {}) })),
      async update(id, version, p) {
        const body: Raw = { version };
        for (const k of ["firstName", "lastName", "email", "phone", "companyId", "ownerId", "tags", "optedOut", "custom"] as const) {
          if (p[k] !== undefined) body[k] = p[k];
        }
        return mapContact(await patch(`/contacts/${id}`, body));
      },
      remove: async (id) => {
        await del(`/contacts/${id}`);
      },
      async addNote(entity, text) {
        const plural = { contact: "contacts", opportunity: "opportunities", lead: "leads" }[entity.type];
        const [a, names] = await Promise.all([post<Raw>(`/${plural}/${entity.id}/notes`, { body: text }), userNames()]);
        return mapActivity(a, names);
      },
      exportCsv: (p: ListParams = {}) => req<string>("GET", `/contacts/export.csv${qs({ filters: apiFilters(p.filters, p.q) })}`, undefined, { raw: true }),
      tags: async () => (await get<string[]>("/contacts/tags")) ?? [],
    },
    pipelines: {
      list: async () => ((await get<Raw[]>("/pipelines")) ?? []).map(mapPipeline),
      create: async (name) => mapPipeline(await post("/pipelines", { name })),
      rename: async (id, name) => mapPipeline(await patch(`/pipelines/${id}`, { name })),
      addStage: async (pipelineId, name) => mapStage(await post(`/pipelines/${pipelineId}/stages`, { name })),
      updateStage: async (stageId, b) => mapStage(await patch(`/stages/${stageId}`, b)),
      async reorderStages(pipelineId, stageIds) {
        await put(`/pipelines/${pipelineId}/stages/order`, { stageIds });
        const all = ((await get<Raw[]>("/pipelines")) ?? []).map(mapPipeline);
        return all.find((p) => p.id === pipelineId)!;
      },
      deleteStage: async (stageId, moveToStageId) => {
        await del(`/stages/${stageId}${qs({ moveToStageId })}`);
      },
    },
    fields: {
      list: async (entity) => ((await get<Raw[]>(`/custom-fields${qs({ entity: entity ? entityToApi(entity) : undefined })}`)) ?? []).map(mapField),
      create: async ({ entity, type, ...b }) => mapField(await post("/custom-fields", { ...b, entity: entityToApi(entity), type: FIELD_TYPE_TO_API[type] })),
      update: async (id, b) => mapField(await patch(`/custom-fields/${id}`, b)),
      archive: async (id) => {
        await del(`/custom-fields/${id}`);
      },
    },
    opportunities: {
      async list(p) {
        const page = p.page ?? 1;
        const pageSize = p.pageSize ?? 100;
        return pageFrom(await envelope(`/opportunities${qs({ pipelineId: p.pipelineId, page, limit: pageSize, search: p.q, filters: apiFilters(p.filters) })}`), mapOpportunity, page, pageSize);
      },
      async get(id): Promise<OpportunityDetail> {
        const [o, acts, names] = await Promise.all([get<Raw>(`/opportunities/${id}`), envelope(`/opportunities/${id}/activities?limit=100`), userNames()]);
        return {
          opportunity: mapOpportunity(o),
          activities: ((acts.data ?? []) as Raw[]).map((a) => mapActivity(a, names)),
          payments: ((o.payments ?? []) as Raw[]).map((p) => mapPayment({ ...p, contact: o.contact, opportunity: { name: o.name } })),
          appointments: ((o.appointments ?? []) as Raw[]).map((a) => mapAppointment({ ...a, contact: o.contact })),
          fields: ((o.customFieldDefinitions ?? []) as Raw[]).map(mapField),
        };
      },
      create: async (b) => mapOpportunity(await post("/opportunities", b)),
      async update(id, version, p) {
        const body: Raw = { version };
        if (p.name !== undefined) body.name = p.name;
        if (p.value !== undefined) body.value = p.value;
        if (p.custom !== undefined) body.custom = p.custom;
        if (p.ownerId !== undefined) body.ownerId = p.ownerId;
        if (p.expectedCloseDate !== undefined) body.closeDate = p.expectedCloseDate ? new Date(p.expectedCloseDate).toISOString() : null;
        return mapOpportunity(await patch(`/opportunities/${id}`, body));
      },
      moveStage: async (id, version, stageId) => mapOpportunity(await post(`/opportunities/${id}/move`, { stageId, version })),
    },
    leads: {
      async list({ scope, status, q }) {
        const filters = status === "OPEN" ? { logic: "AND", criteria: [{ field: "status", op: "in", value: ["NEW", "ASSIGNED", "ACKNOWLEDGED"] }], ...(q ? { search: q } : {}) } : q ? { logic: "AND", criteria: [], search: q } : undefined;
        const json = await envelope(`/leads${qs({ mine: scope === "mine" ? "true" : undefined, status: status && status !== "OPEN" ? status : undefined, filters, limit: 100 })}`);
        return ((json.data ?? []) as Raw[]).map(mapLead);
      },
      get: (id) => leadDetail(id),
      async create({ name, phone, email, message }) {
        const [firstName, ...rest] = name.trim().split(/\s+/);
        const title = message.length > 60 ? `${message.slice(0, 57)}…` : message;
        return mapLead(await post("/leads", { title, notes: message, contact: { firstName, lastName: rest.join(" ") || undefined, phone: phone || undefined, email: email || undefined } }));
      },
      acknowledge: async (id) => mapLead(await post(`/leads/${id}/acknowledge`)),
      reassign: async (id, userId) => mapLead(await post(`/leads/${id}/reassign`, { toUserId: userId })),
      close: async (id) => mapLead(await post(`/leads/${id}/close`, { reason: "Closed by the owner" })),
      recovery: async () => (((await envelope("/leads/recovery?limit=100")).data ?? []) as Raw[]).map(mapLead),
    },
    conversations: {
      list: async () => (((await envelope("/conversations?limit=100")).data ?? []) as Raw[]).map(mapConversation),
      async get(id) {
        const [c, msgs] = await Promise.all([get<Raw>(`/conversations/${id}`), envelope(`/conversations/${id}/messages?limit=100`)]);
        return { conversation: mapConversation(c), messages: ((msgs.data ?? []) as Raw[]).map(mapMessage).reverse() };
      },
      send: async (id, body) => mapMessage(await post(`/conversations/${id}/messages`, { body })),
      retry: async (messageId) => mapMessage(await post(`/messages/${messageId}/retry`)),
      // Opening the thread (GET messages) already marks it read on the server
      markRead: async () => undefined,
    },
    payments: {
      list: async (p = {}) => (((await envelope(`/payments${qs({ status: p.status, opportunityId: p.opportunityId, limit: 100 })}`)).data ?? []) as Raw[]).map(mapPayment),
      async request({ opportunityId, amount, currency, description }) {
        return mapPayment(await post(`/opportunities/${opportunityId}/payment-requests`, { amount, currency, description: description || undefined }));
      },
    },
    appointments: {
      list: async (p = {}) => (((await envelope(`/appointments${qs({ from: p.from, to: p.to, userId: p.userId, limit: 100 })}`)).data ?? []) as Raw[]).map(mapAppointment),
      busy: async (userId, from, to) => (((await get<Raw>(`/calendar/busy${qs({ userId, from, to })}`)).busy ?? []) as Raw[]).map((b) => ({ start: b.start, end: b.end })),
      book: async ({ notes, ...b }) => mapAppointment(await post("/appointments", { ...b, ...(notes ? { description: notes } : {}) })),
      reschedule: async (id, b) => mapAppointment(await patch(`/appointments/${id}`, b)),
      cancel: async (id) => mapAppointment(await del(`/appointments/${id}`)),
    },
    integrations: {
      list: async () => ((await get<Raw[]>("/integrations")) ?? []).map(mapConnection),
      events: async (p = {}) => (((await envelope(`/integrations/events${qs({ provider: p.provider, limit: 100 })}`)).data ?? []) as Raw[]).map(mapEvent),
      alerts: async () => (((await envelope("/alerts?limit=50")).data ?? []) as Raw[]).map(mapAlert),
      async connect(provider: Provider, credentials, config) {
        await put(`/integrations/${provider.toLowerCase()}`, { credentials, config: config ?? {} });
        const all = ((await get<Raw[]>("/integrations")) ?? []).map(mapConnection);
        return all.find((c) => c.provider === provider)!;
      },
      async disconnect(provider) {
        await del(`/integrations/${provider.toLowerCase()}`);
        const all = ((await get<Raw[]>("/integrations")) ?? []).map(mapConnection);
        return all.find((c) => c.provider === provider)!;
      },
      test: (provider) => post<{ ok: boolean; detail: string }>(`/integrations/${provider.toLowerCase()}/test`),
      googleConnectUrl: () => get<{ url: string }>("/calendar/google/connect"),
      async disconnectGoogle() {
        await del("/calendar/google");
        return (await session()).user;
      },
      slackLink: async (input = {}) => put<{ linked: boolean; slackUserId: string | null }>("/alerts/slack/link", input),
      slackUnlink: async () => {
        await del("/alerts/slack/link");
      },
    },
    audit: {
      async list({ action, actorId, from, to, page = 1, pageSize = 30 }) {
        const actions = action ? AUDIT_GROUPS[action].join(",") : undefined;
        return pageFrom(
          await envelope(`/audit${qs({ action: actions, actorId, from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(to).toISOString() : undefined, page, limit: pageSize })}`),
          mapAudit,
          page,
          pageSize,
        );
      },
    },
    dashboard: {
      async metrics(): Promise<DashboardMetrics> {
        const [d, pipelines] = await Promise.all([get<Raw>("/dashboard"), get<Raw[]>("/pipelines").catch(() => [] as Raw[])]);
        const w = d.widgets as Raw;
        const pipelineOf = new Map<string, string>();
        for (const p of pipelines ?? []) for (const s of (p.stages ?? []) as Raw[]) pipelineOf.set(s.id, p.name);
        const counts = (w.employeeAvailability?.value ?? {}) as Partial<Record<Availability, number>>;
        const availability: Record<Availability, number> = { AVAILABLE: counts.AVAILABLE ?? 0, BUSY: counts.BUSY ?? 0, ON_LEAVE: counts.ON_LEAVE ?? 0, OFFLINE: counts.OFFLINE ?? 0 };
        return {
          scope: d.scope === "company" ? "COMPANY" : "PERSONAL",
          currency: w.paymentsReceivedThisMonth?.currency ?? "USD",
          newLeadsToday: w.newLeadsToday?.value ?? 0,
          openPipelineByStage: w.openPipelineValueByStage?.valueHidden
            ? null
            : ((w.openPipelineValueByStage?.byStage ?? []) as Raw[]).map((s) => ({ pipelineName: pipelineOf.get(s.stageId) ?? "Pipeline", stageId: s.stageId, stageName: s.stage, count: s.count, value: num(s.value) })),
          avgTimeToFirstResponseSec: w.avgTimeToFirstResponseSec?.value ?? null,
          recoveryCount: w.recoveryQueueCount?.value ?? 0,
          escalations24h: w.escalationsLast24h?.value ?? 0,
          availability,
          upcomingAppointments: ((w.upcomingAppointments?.items ?? []) as Raw[]).map(mapAppointment),
          collectedThisMonth: num(w.paymentsReceivedThisMonth?.value),
          paymentsThisMonthCount: w.paymentsReceivedThisMonth?.count ?? 0,
          projectedRevenue: w.projectedRevenue?.valueHidden ? null : num(w.projectedRevenue?.value),
          responseTrend: ((d.responseTrend ?? []) as Raw[]).map((t) => ({ day: t.day, avgSec: t.avgSec ?? null, leads: t.leads ?? 0 })),
        };
      },
      prefs: async () => ({ hidden: ((await get<Raw>("/dashboard")).hiddenWidgets ?? []) as string[] }),
      savePrefs: async (hidden) => ({ hidden: ((await put<Raw>("/dashboard/prefs", { hiddenWidgets: hidden })).hiddenWidgets ?? hidden) as string[] }),
    },
    savedLists: {
      list: async (entity) => ((await get<Raw[]>(`/saved-lists${qs({ entity: entityToApi(entity) })}`)) ?? []).map(mapSavedList),
      create: async ({ entity, name, filters, shared }) => mapSavedList(await post("/saved-lists", { entity: entityToApi(entity), name, filters: apiFilters(filters) ?? { logic: "AND", criteria: [] }, isShared: shared })),
      remove: async (id) => {
        await del(`/saved-lists/${id}`);
      },
    },
    public: {
      workspace: (slug) => get(`/public/workspaces/${encodeURIComponent(slug)}`),
      async submitLead(slug, { name, email, phone, message, company, website }) {
        const [firstName, ...rest] = name.trim().split(/\s+/);
        return post(`/intake/${encodeURIComponent(slug)}`, { firstName, lastName: rest.join(" ") || undefined, email: email || undefined, phone: phone || undefined, message, company: company || undefined, website: website || undefined });
      },
      paymentStatus: (paymentId) => get(`/public/payments/${encodeURIComponent(paymentId)}`),
    },
    realtime: {
      subscribe(handler) {
        handlers.add(handler);
        void connectSocket().catch(() => undefined);
        return () => {
          handlers.delete(handler);
        };
      },
    },
  };
}
