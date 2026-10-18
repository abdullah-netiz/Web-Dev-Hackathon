import { io, type Socket } from "socket.io-client";
import type { Api, ListParams } from "./contract";
import { ApiError } from "./errors";
import type { ApiErrorBody, RealtimeEvent } from "./types";

const TOKEN_KEY = "baton.token";

function token() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(t: string | null) {
  if (t) window.localStorage.setItem(TOKEN_KEY, t);
  else window.localStorage.removeItem(TOKEN_KEY);
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

function listQs(p: ListParams = {}) {
  return qs({ page: p.page, pageSize: p.pageSize, q: p.q, sort: p.sort, filters: p.filters?.length ? p.filters : undefined });
}

export function createHttpApi(baseUrl: string): Api {
  const base = baseUrl.replace(/\/$/, "");

  async function req<T>(method: string, path: string, body?: unknown, opts: { raw?: boolean; envelope?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: opts.raw ? "text/csv" : "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;
    const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) {
      let err: ApiErrorBody = { code: `HTTP_${res.status}`, message: res.statusText || "Request failed." };
      try {
        err = (await res.json()) as ApiErrorBody;
      } catch {
        // non-JSON error body
      }
      if (res.status === 401) setToken(null);
      throw new ApiError(res.status, err);
    }
    if (res.status === 204) return undefined as T;
    if (opts.raw) return (await res.text()) as T;
    const json = (await res.json()) as { data: unknown; meta?: unknown };
    return (opts.envelope ? json : json.data) as T;
  }

  const get = <T,>(p: string) => req<T>("GET", p);
  const page = <T,>(p: string) => req<T>("GET", p, undefined, { envelope: true });
  const post = <T,>(p: string, b?: unknown) => req<T>("POST", p, b ?? {});
  const patch = <T,>(p: string, b: unknown) => req<T>("PATCH", p, b);
  const del = <T,>(p: string, b?: unknown) => req<T>("DELETE", p, b);

  let socket: Socket | null = null;
  const handlers = new Set<(e: RealtimeEvent) => void>();
  const EVENTS: RealtimeEvent["type"][] = [
    "lead:created", "lead:assigned", "lead:acknowledged", "lead:escalated", "message:new", "message:status",
    "payment:updated", "availability:changed", "opportunity:updated", "integration:updated",
  ];

  async function connectSocket() {
    if (socket || !token()) return;
    const { token: wsToken } = await post<{ token: string }>("/realtime/token");
    socket = io(base, { transports: ["websocket"], auth: { token: wsToken } });
    for (const type of EVENTS) {
      socket.on(type, (payload: Record<string, unknown>) => {
        for (const h of handlers) h({ type, ...payload } as RealtimeEvent);
      });
    }
  }

  return {
    auth: {
      async login(input) {
        const s = await post<Awaited<ReturnType<Api["auth"]["login"]>>>("/auth/login", input);
        setToken(s.token);
        return s;
      },
      async signup(input) {
        const s = await post<Awaited<ReturnType<Api["auth"]["signup"]>>>("/auth/signup", input);
        setToken(s.token);
        return s;
      },
      async acceptInvite(t, input) {
        const s = await post<Awaited<ReturnType<Api["auth"]["acceptInvite"]>>>(`/auth/invites/${encodeURIComponent(t)}/accept`, input);
        setToken(s.token);
        return s;
      },
      me: () => get("/auth/me"),
      async logout() {
        try {
          await post("/auth/logout");
        } finally {
          setToken(null);
          socket?.disconnect();
          socket = null;
        }
      },
    },
    workspace: {
      get: () => get("/workspace"),
      update: (b) => patch("/workspace", b),
      settings: () => get("/workspace/settings"),
      updateSettings: (b) => patch("/workspace/settings", b),
    },
    members: {
      list: () => get("/users"),
      invite: (b) => post("/users/invite", b),
      update: (id, b) => patch(`/users/${id}`, b),
      setAvailability: (id, availability) => patch(`/users/${id}/availability`, { availability }),
      deactivate: (id) => post(`/users/${id}/deactivate`),
    },
    roles: {
      list: () => get("/roles"),
      create: (b) => post("/roles", b),
      update: (id, b) => patch(`/roles/${id}`, b),
      remove: (id) => del(`/roles/${id}`),
    },
    companies: {
      list: (p) => page(`/companies${listQs(p)}`),
      get: (id) => get(`/companies/${id}`),
      create: (b) => post("/companies", b),
    },
    contacts: {
      list: (p) => page(`/contacts${listQs(p)}`),
      overview: (id) => get(`/contacts/${id}/overview`),
      create: (b) => post("/contacts", b),
      update: (id, version, b) => patch(`/contacts/${id}`, { ...b, version }),
      remove: (id) => del(`/contacts/${id}`),
      addNote: (entity, text) => post(`/activities/notes`, { entityType: entity.type, entityId: entity.id, text }),
      exportCsv: (p) => req("GET", `/contacts/export${listQs(p)}`, undefined, { raw: true }),
      tags: () => get("/contacts/tags"),
    },
    pipelines: {
      list: () => get("/pipelines"),
      create: (name) => post("/pipelines", { name }),
      rename: (id, name) => patch(`/pipelines/${id}`, { name }),
      addStage: (pipelineId, name) => post(`/pipelines/${pipelineId}/stages`, { name }),
      updateStage: (stageId, b) => patch(`/stages/${stageId}`, b),
      reorderStages: (pipelineId, stageIds) => post(`/pipelines/${pipelineId}/stages/reorder`, { stageIds }),
      deleteStage: (stageId, moveToStageId) => del(`/stages/${stageId}`, { moveToStageId }),
    },
    fields: {
      list: (entity) => get(`/custom-fields${qs({ entity })}`),
      create: (b) => post("/custom-fields", b),
      update: (id, b) => patch(`/custom-fields/${id}`, b),
      archive: (id) => del(`/custom-fields/${id}`),
    },
    opportunities: {
      list: (p) =>
        page(`/opportunities${qs({ pipelineId: p.pipelineId, page: p.page, pageSize: p.pageSize, q: p.q, filters: p.filters?.length ? p.filters : undefined })}`),
      get: (id) => get(`/opportunities/${id}`),
      create: (b) => post("/opportunities", b),
      update: (id, version, b) => patch(`/opportunities/${id}`, { ...b, version }),
      moveStage: (id, version, stageId) => post(`/opportunities/${id}/move`, { stageId, version }),
    },
    leads: {
      list: (p) => get(`/leads${qs(p)}`),
      get: (id) => get(`/leads/${id}`),
      create: (b) => post("/leads", b),
      acknowledge: (id) => post(`/leads/${id}/acknowledge`),
      reassign: (id, userId) => post(`/leads/${id}/reassign`, { userId }),
      close: (id) => post(`/leads/${id}/close`),
      recovery: () => get("/leads/recovery"),
    },
    conversations: {
      list: () => get("/conversations"),
      get: (id) => get(`/conversations/${id}`),
      send: (id, body) => post(`/conversations/${id}/messages`, { body }),
      retry: (messageId) => post(`/messages/${messageId}/retry`),
      markRead: (id) => post(`/conversations/${id}/read`),
    },
    payments: {
      list: (p) => get(`/payments${qs(p)}`),
      request: (b) => post("/payments", b),
    },
    appointments: {
      list: (p) => get(`/appointments${qs(p)}`),
      busy: (userId, from, to) => get(`/calendar/busy${qs({ userId, from, to })}`),
      book: (b) => post("/appointments", b),
      reschedule: (id, b) => patch(`/appointments/${id}`, b),
      cancel: (id) => post(`/appointments/${id}/cancel`),
    },
    integrations: {
      list: () => get("/integrations"),
      events: (p) => get(`/integrations/events${qs(p)}`),
      alerts: () => get("/alerts"),
      connect: (provider, credentials) => post(`/integrations/${provider.toLowerCase()}/connect`, credentials),
      disconnect: (provider) => post(`/integrations/${provider.toLowerCase()}/disconnect`),
      test: (provider) => post(`/integrations/${provider.toLowerCase()}/test`),
      googleConnectUrl: () => get("/calendar/google/connect"),
      disconnectGoogle: () => post("/calendar/google/disconnect"),
      telegramLink: () => post("/alerts/telegram/link"),
    },
    audit: {
      list: (p) => page(`/audit${qs(p)}`),
    },
    dashboard: {
      metrics: () => get("/dashboard"),
      prefs: () => get("/dashboard/prefs"),
      savePrefs: (hidden) => req("PUT", "/dashboard/prefs", { hidden }),
    },
    savedLists: {
      list: (entity) => get(`/saved-lists${qs({ entity })}`),
      create: (b) => post("/saved-lists", b),
      remove: (id) => del(`/saved-lists/${id}`),
    },
    public: {
      workspace: (slug) => get(`/public/workspaces/${encodeURIComponent(slug)}`),
      submitLead: (slug, b) => post(`/intake/${encodeURIComponent(slug)}`, b),
      paymentStatus: (sessionId) => get(`/public/payments/${encodeURIComponent(sessionId)}`),
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
