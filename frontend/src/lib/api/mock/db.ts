import type {
  Activity,
  AlertDelivery,
  Appointment,
  Assignment,
  AuditEvent,
  Company,
  Contact,
  Conversation,
  CustomField,
  IntegrationConnection,
  IntegrationEvent,
  Lead,
  Message,
  Opportunity,
  Payment,
  Permission,
  Pipeline,
  Role,
  SavedList,
  User,
  Workspace,
  WorkspaceSettings,
} from "../types";
import { PERMISSIONS } from "../types";

type Scoped<T> = T & { workspaceId: string };

export interface MockDB {
  version: number;
  workspaces: Workspace[];
  settings: Record<string, WorkspaceSettings>;
  users: Scoped<User & { password: string }>[];
  sessions: { token: string; userId: string; workspaceId: string; expiresAt: string }[];
  roles: Scoped<Role>[];
  companies: Scoped<Company>[];
  contacts: Scoped<Contact>[];
  pipelines: Scoped<Pipeline>[];
  fields: Scoped<CustomField>[];
  opportunities: Scoped<Opportunity>[];
  leads: Scoped<Lead>[];
  assignments: Scoped<Assignment>[];
  activities: Scoped<Activity>[];
  audit: Scoped<AuditEvent>[];
  conversations: Scoped<Conversation>[];
  messages: Scoped<Message>[];
  payments: Scoped<Payment>[];
  appointments: Scoped<Appointment>[];
  connections: Scoped<IntegrationConnection>[];
  events: Scoped<IntegrationEvent>[];
  alerts: Scoped<AlertDelivery>[];
  savedLists: Scoped<SavedList>[];
  prefs: Record<string, string[]>;
  invites: { token: string; userId: string; workspaceId: string }[];
}

export const DB_VERSION = 5;
const STORAGE_KEY = "baton.mock.db";

let seq = 0;
export function uid(prefix: string) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ALL_PERMISSIONS = PERMISSIONS.map((p) => p.key) as Permission[];

export const CONNECTION_COPY: Record<IntegrationConnection["provider"], { canDo: string[]; cannotDo: string[] }> = {
  TWILIO: {
    canDo: [
      "Receive WhatsApp messages sent to the sandbox number and turn unknown numbers into contacts and leads.",
      "Send replies from a conversation and show sent, delivered, read or failed for each message.",
    ],
    cannotDo: [
      "Reach phones that have not joined the sandbox by sending the join phrase first.",
      "Start a conversation more than 24 hours after the customer's last message (WhatsApp session rule).",
      "Send faster than about one message every 3 seconds in the sandbox.",
    ],
  },
  STRIPE: {
    canDo: [
      "Create a hosted Checkout link for an opportunity in any supported currency.",
      "Mark payments paid, expired, failed or refunded from Stripe's signed webhooks.",
    ],
    cannotDo: [
      "Take real money: test mode only accepts Stripe's published test cards.",
      "See card numbers: payment details are entered only on Stripe's page.",
    ],
  },
  GOOGLE: {
    canDo: [
      "Let each employee connect their own Google Calendar and book appointments on it.",
      "Warn about overlaps using the employee's busy times before booking.",
    ],
    cannotDo: [
      "Book an employee who has not connected a calendar.",
      "Keep a connection longer than 7 days while the Google app is in testing; reconnect when asked.",
    ],
  },
  TELEGRAM: {
    canDo: [
      "Alert the new owner of an escalated lead in Telegram within seconds, with a link to the lead.",
      "Let each employee link their own chat from Settings → Notifications.",
    ],
    cannotDo: [
      "Message someone who has not pressed Start in the bot.",
      "Send more than about 30 messages per second across the workspace.",
    ],
  },
};

export function defaultSettings(): WorkspaceSettings {
  return {
    ackWindowSec: 120,
    escalationLevels: 3,
    levelWindowSec: 90,
    idleSec: 3600,
    maxOpenLeadsDefault: 8,
    acknowledgedOnAbsence: "KEEP",
  };
}

export function defaultRoles(workspaceId: string): Scoped<Role>[] {
  const all = ALL_PERMISSIONS;
  return [
    {
      id: uid("role"),
      workspaceId,
      name: "Owner",
      description: "Full control of the workspace. Cannot be changed by Admins.",
      permissions: all,
      isSystem: true,
      memberCount: 0,
    },
    {
      id: uid("role"),
      workspaceId,
      name: "Admin",
      description: "Configures pipelines, fields, assignment rules and integrations.",
      permissions: all,
      isSystem: true,
      memberCount: 0,
    },
    {
      id: uid("role"),
      workspaceId,
      name: "Manager",
      description: "Supervises the team: sees every lead, reassigns, reads the audit history.",
      permissions: [
        "crm.view",
        "crm.create",
        "crm.edit",
        "crm.export",
        "crm.view_values",
        "leads.view_all",
        "leads.reassign",
        "dashboard.company",
        "audit.view",
      ],
      isSystem: false,
      memberCount: 0,
    },
    {
      id: uid("role"),
      workspaceId,
      name: "Sales",
      description: "Works their own leads and opportunities. Opportunity values are hidden.",
      permissions: ["crm.view", "crm.create", "crm.edit"],
      isSystem: false,
      memberCount: 0,
    },
  ];
}

function defaultPipeline(workspaceId: string): Scoped<Pipeline> {
  const id = uid("pipe");
  const names = ["New inquiry", "Qualified", "Proposal sent", "Negotiation", "Won", "Lost"];
  return {
    id,
    workspaceId,
    name: "Sales",
    stages: names.map((name, i) => ({
      id: uid("stage"),
      pipelineId: id,
      name,
      order: i,
      isWon: name === "Won",
      isLost: name === "Lost",
      requiredFieldKeys: [],
    })),
  };
}

function connectionsFor(workspaceId: string, connected: boolean): Scoped<IntegrationConnection>[] {
  return (["TWILIO", "STRIPE", "GOOGLE", "TELEGRAM"] as const).map((provider) => ({
    workspaceId,
    provider,
    status: connected ? "CONNECTED" : "NOT_CONNECTED",
    maskedCredential: null,
    lastOkAt: null,
    lastError: null,
    lastErrorAt: null,
    ...CONNECTION_COPY[provider],
  }));
}

export function createEmptyWorkspace(db: MockDB, input: { name: string; slug: string }) {
  const ws: Workspace = {
    id: uid("ws"),
    name: input.name,
    slug: input.slug,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    currency: "USD",
  };
  db.workspaces.push(ws);
  db.settings[ws.id] = defaultSettings();
  db.roles.push(...defaultRoles(ws.id));
  db.pipelines.push(defaultPipeline(ws.id));
  db.connections.push(...connectionsFor(ws.id, false));
  return ws;
}

const FIRST = [
  "Olivia", "Liam", "Emma", "Noah", "Ava", "Mateo", "Sophia", "Elijah", "Isabella", "Lucas", "Mia", "Ethan",
  "Amelia", "Yusuf", "Harper", "Omar", "Evelyn", "Arjun", "Chloe", "Kenji", "Zara", "Diego", "Leila", "Samuel",
  "Fatima", "Jonah", "Grace", "Rafael", "Nora", "Ibrahim", "Maya", "Felix", "Aisha", "Hugo", "Ines", "Kwame",
  "Rosa", "Theo", "Mei", "Andre",
];
const LAST = [
  "Carter", "Nguyen", "Patel", "Garcia", "Kim", "Silva", "Novak", "Haddad", "Okoro", "Jensen", "Moreau", "Rossi",
  "Brennan", "Tanaka", "Alvarez", "Schmidt", "Mensah", "Kowalski", "Farouk", "Lindgren", "Costa", "Reyes", "Duarte",
  "Ahmed", "Walsh", "Ivanova", "Becker", "Sato", "Quinn", "Abara",
];
const COMPANY_A = ["Harbor", "Cedar", "Summit", "Brightline", "Oakridge", "Bluewater", "Granite", "Meadow", "Ironwood", "Northgate", "Riverside", "Copperleaf", "Sunfield", "Westbrook", "Highpoint", "Larkspur", "Redstone", "Fairview", "Pinecrest", "Silverton"];
const COMPANY_B = ["Logistics", "Dental", "Farms", "Storage", "Bakery", "Hotels", "Fitness", "Motors", "Brewing", "Clinic", "Academy", "Printing"];
const CITIES = ["Oakland", "San Jose", "Fresno", "Sacramento", "Berkeley", "Palo Alto", "Modesto", "Santa Rosa"];
const TAGS = ["referral", "battery-interest", "ev-owner", "high-bill", "repeat", "spanish-speaking", "commercial", "callback"];
const INQUIRIES = [
  "Hi, our electricity bill went over $300 last month. Can someone tell me if solar makes sense for a 2-storey house?",
  "Looking for a quote on panels plus a battery. We have an EV so we use a lot at night.",
  "Saw your van in our street. Do you install on tile roofs?",
  "We run a small warehouse and want to know about commercial solar and the tax credit.",
  "Can I get a site survey this week? Mornings work best.",
  "My neighbour had you install last spring and recommended you. Interested in a similar system.",
  "Do you offer financing? We'd like to pay monthly.",
  "Our roof is being replaced in March. Should we plan panels at the same time?",
];

export function seed(): MockDB {
  const r = rng(20261018);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)]!;
  const between = (a: number, b: number) => Math.floor(a + r() * (b - a + 1));
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const minutesAgo = (m: number) => iso(now - m * 60_000);
  const daysAgo = (d: number) => iso(now - d * 86_400_000);

  const db: MockDB = {
    version: DB_VERSION,
    workspaces: [],
    settings: {},
    users: [],
    sessions: [],
    roles: [],
    companies: [],
    contacts: [],
    pipelines: [],
    fields: [],
    opportunities: [],
    leads: [],
    assignments: [],
    activities: [],
    audit: [],
    conversations: [],
    messages: [],
    payments: [],
    appointments: [],
    connections: [],
    events: [],
    alerts: [],
    savedLists: [],
    prefs: {},
    invites: [],
  };

  const ws: Workspace = {
    id: "ws_northwind",
    name: "Northwind Solar",
    slug: "northwind",
    timeZone: "America/Los_Angeles",
    currency: "USD",
  };
  db.workspaces.push(ws);
  const W = ws.id;
  db.settings[W] = { ...defaultSettings(), ackWindowSec: 90, levelWindowSec: 60 };

  const roles = defaultRoles(W);
  db.roles.push(...roles);
  const [ownerRole, adminRole, managerRole, salesRole] = roles as unknown as [Role, Role, Role, Role];

  const team: [string, string, User["baseLevel"], Role, User["availability"], boolean, string][] = [
    ["Amina Rahman", "amina", "OWNER", ownerRole, "AVAILABLE", true, "America/Los_Angeles"],
    ["Daniel Okafor", "daniel", "ADMIN", adminRole, "BUSY", false, "America/Los_Angeles"],
    ["Sara Lindqvist", "sara", "USER", managerRole, "AVAILABLE", true, "America/Los_Angeles"],
    ["Bilal Hussain", "bilal", "USER", salesRole, "AVAILABLE", false, "America/Los_Angeles"],
    ["Priya Nair", "priya", "USER", salesRole, "AVAILABLE", false, "America/Denver"],
    ["Tomás Ferreira", "tomas", "USER", salesRole, "AVAILABLE", false, "America/Los_Angeles"],
    ["Hana Kobayashi", "hana", "USER", salesRole, "ON_LEAVE", false, "America/Los_Angeles"],
    ["Lucas Meyer", "lucas", "USER", salesRole, "OFFLINE", false, "Europe/Berlin"],
  ];
  for (const [name, handle, baseLevel, role, availability, isManager, tz] of team) {
    db.users.push({
      id: `usr_${handle}`,
      workspaceId: W,
      name,
      email: `${handle}@northwind.test`,
      password: "demo1234",
      baseLevel,
      roleId: role.id,
      roleName: role.name,
      availability,
      openLeadCount: 0,
      maxOpenLeads: null,
      isManager,
      backupUserId: null,
      telegramLinked: handle !== "tomas" && handle !== "lucas",
      calendarStatus: handle === "priya" ? "NEEDS_RECONNECT" : handle === "lucas" ? "NOT_CONNECTED" : "CONNECTED",
      timeZone: tz,
      lastAssignedAt: minutesAgo(between(30, 600)),
      active: true,
    });
  }
  const byHandle = (h: string) => db.users.find((u) => u.id === `usr_${h}`)!;
  byHandle("bilal").backupUserId = "usr_priya";
  byHandle("priya").backupUserId = "usr_tomas";
  byHandle("tomas").backupUserId = "usr_bilal";
  byHandle("hana").backupUserId = "usr_bilal";
  byHandle("lucas").backupUserId = "usr_priya";
  const sellers = ["bilal", "priya", "tomas", "hana", "sara"].map(byHandle);

  const resId = "pipe_residential";
  const comId = "pipe_commercial";
  const mkStages = (pid: string, defs: [string, string[]][]) =>
    defs.map(([name, req], i) => ({
      id: `${pid}_s${i}`,
      pipelineId: pid,
      name,
      order: i,
      isWon: name === "Won",
      isLost: name === "Lost",
      requiredFieldKeys: req,
    }));
  db.pipelines.push(
    {
      id: resId,
      workspaceId: W,
      name: "Residential",
      stages: mkStages(resId, [
        ["New inquiry", []],
        ["Site survey", ["roofType", "monthlyBill"]],
        ["Proposal sent", ["systemSizeKw"]],
        ["Financing", []],
        ["Won", []],
        ["Lost", []],
      ]),
    },
    {
      id: comId,
      workspaceId: W,
      name: "Commercial",
      stages: mkStages(comId, [
        ["Discovery", []],
        ["Energy audit", ["annualKwh", "buildingType"]],
        ["Proposal", ["commercialSizeKw"]],
        ["Contract", ["siteVisitDate"]],
        ["Won", []],
        ["Lost", []],
      ]),
    },
  );

  const field = (
    entity: CustomField["entity"],
    key: string,
    label: string,
    type: CustomField["type"],
    order: number,
    options: string[] = [],
    pipelineId: string | null = null,
  ): Scoped<CustomField> => ({ id: `fld_${key}`, workspaceId: W, entity, key, label, type, options, pipelineId, isArchived: false, order });
  db.fields.push(
    field("contact", "preferredChannel", "Preferred channel", "SELECT", 0, ["WhatsApp", "Phone", "Email"]),
    field("contact", "homeowner", "Homeowner", "BOOLEAN", 1),
    field("contact", "referralSource", "Referred by", "TEXT", 2),
    field("opportunity", "roofType", "Roof type", "SELECT", 0, ["Asphalt shingle", "Metal", "Clay tile", "Flat"], resId),
    field("opportunity", "monthlyBill", "Monthly bill ($)", "NUMBER", 1, [], resId),
    field("opportunity", "systemSizeKw", "System size (kW)", "NUMBER", 2, [], resId),
    field("opportunity", "battery", "Battery storage", "BOOLEAN", 3, [], resId),
    field("opportunity", "annualKwh", "Annual usage (kWh)", "NUMBER", 0, [], comId),
    field("opportunity", "buildingType", "Building type", "SELECT", 1, ["Warehouse", "Office", "Retail", "Factory"], comId),
    field("opportunity", "commercialSizeKw", "Array size (kW)", "NUMBER", 2, [], comId),
    field("opportunity", "siteVisitDate", "Site visit", "DATE", 3, [], comId),
  );

  for (let i = 0; i < 40; i++) {
    const name = `${COMPANY_A[i % COMPANY_A.length]} ${COMPANY_B[(i * 7) % COMPANY_B.length]}`;
    db.companies.push({
      id: `co_${i}`,
      workspaceId: W,
      name,
      domain: `${name.toLowerCase().replace(/[^a-z]+/g, "")}.example`,
      industry: COMPANY_B[(i * 7) % COMPANY_B.length]!,
      city: pick(CITIES),
      contactCount: 0,
      openOpportunityCount: 0,
      createdAt: daysAgo(between(30, 400)),
    });
  }

  for (let i = 0; i < 320; i++) {
    const first = FIRST[i % FIRST.length]!;
    const last = LAST[(i * 11 + Math.floor(i / FIRST.length)) % LAST.length]!;
    const company = r() < 0.35 ? db.companies[between(0, db.companies.length - 1)]! : null;
    const owner = pick(sellers);
    const tags = TAGS.filter(() => r() < 0.14);
    const created = between(1, 300);
    db.contacts.push({
      id: `ct_${i}`,
      workspaceId: W,
      firstName: first,
      lastName: last,
      email: `${first}.${last}${i}`.toLowerCase().normalize("NFD").replace(/[^a-z0-9.]/g, "") + "@mail.example",
      phone: `+1415555${String(1000 + i).padStart(4, "0")}`,
      companyId: company?.id ?? null,
      companyName: company?.name ?? null,
      ownerId: owner.id,
      ownerName: owner.name,
      tags,
      optedOut: i === 7,
      custom: {
        preferredChannel: pick(["WhatsApp", "Phone", "Email"]),
        homeowner: !company,
        referralSource: r() < 0.2 ? `${pick(FIRST)} ${pick(LAST)}` : null,
      },
      createdAt: daysAgo(created),
      lastActivityAt: daysAgo(between(0, Math.min(created, 60))),
      version: 1,
    });
    if (company) company.contactCount += 1;
  }

  const resStages = db.pipelines[0]!.stages;
  const comStages = db.pipelines[1]!.stages;
  for (let i = 0; i < 72; i++) {
    const commercial = i % 4 === 0;
    const stages = commercial ? comStages : resStages;
    const weights = [0.2, 0.2, 0.2, 0.15, 0.15, 0.1];
    let x = r();
    let si = 0;
    while (si < weights.length - 1 && x > weights[si]!) {
      x -= weights[si]!;
      si++;
    }
    const stage = stages[si]!;
    const contact = db.contacts[(i * 4 + 3) % db.contacts.length]!;
    const owner = db.users.find((u) => u.id === contact.ownerId)!;
    const value = commercial ? between(60, 260) * 1000 : between(14, 48) * 1000 + between(0, 9) * 100;
    const custom: Opportunity["custom"] = commercial
      ? {
          annualKwh: si >= 1 ? between(80, 600) * 1000 : null,
          buildingType: si >= 1 ? pick(["Warehouse", "Office", "Retail", "Factory"]) : null,
          commercialSizeKw: si >= 2 ? between(60, 400) : null,
          siteVisitDate: si >= 3 ? daysAgo(-between(1, 20)).slice(0, 10) : null,
        }
      : {
          roofType: si >= 1 ? pick(["Asphalt shingle", "Metal", "Clay tile", "Flat"]) : null,
          monthlyBill: si >= 1 ? between(140, 520) : null,
          systemSizeKw: si >= 2 ? between(5, 16) : null,
          battery: r() < 0.4,
        };
    const created = between(2, 120);
    db.opportunities.push({
      id: `op_${i}`,
      workspaceId: W,
      name: commercial ? `${contact.companyName ?? contact.lastName} rooftop array` : `${contact.lastName} residence`,
      contactId: contact.id,
      contactName: `${contact.firstName} ${contact.lastName}`,
      companyName: contact.companyName,
      pipelineId: commercial ? comId : resId,
      stageId: stage.id,
      ownerId: owner.id,
      ownerName: owner.name,
      value,
      currency: "USD",
      custom,
      paymentStatus: null,
      expectedCloseDate: daysAgo(-between(5, 90)).slice(0, 10),
      createdAt: daysAgo(created),
      updatedAt: daysAgo(between(0, created)),
      version: 1,
    });
    if (contact.companyId && !stage.isWon && !stage.isLost) {
      const co = db.companies.find((c) => c.id === contact.companyId);
      if (co) co.openOpportunityCount += 1;
    }
  }

  const sources: Lead["source"][] = ["WEB_FORM", "MESSAGE", "MANUAL"];
  const leadOwners = ["bilal", "priya", "tomas", "sara"].map(byHandle);
  for (let i = 0; i < 46; i++) {
    const contact = db.contacts[(i * 6 + 1) % db.contacts.length]!;
    const stuck = i >= 4 && i < 10;
    const createdMin = i < 4 ? between(1, 2) : stuck ? between(8, 240) : between(30, 60 * 24 * 21);
    const created = now - createdMin * 60_000;
    const owner = leadOwners[i % leadOwners.length]!;
    const ttfr = between(25, 900);
    const acknowledged = i >= 10;
    const escalationCount = i >= 4 ? (stuck && i % 3 === 0 ? 2 : r() < 0.22 ? 1 : 0) : 0;
    const leadId = `ld_${i}`;
    const assignedAt = iso(created + 4000);
    const lead: Scoped<Lead> = {
      id: leadId,
      workspaceId: W,
      source: sources[i % 3]!,
      status: acknowledged ? (createdMin > 60 * 24 * 5 && r() < 0.6 ? "CLOSED" : "ACKNOWLEDGED") : "ASSIGNED",
      contactId: contact.id,
      contactName: `${contact.firstName} ${contact.lastName}`,
      contactPhone: contact.phone,
      contactEmail: contact.email,
      message: INQUIRIES[i % INQUIRIES.length]!,
      ownerId: owner.id,
      ownerName: owner.name,
      current: null,
      escalationCount,
      recoveryReason: "NONE",
      firstAssignedAt: assignedAt,
      acknowledgedAt: acknowledged ? iso(created + ttfr * 1000) : null,
      timeToFirstResponseSec: acknowledged ? ttfr : null,
      lastActivityAt: acknowledged ? iso(created + ttfr * 1000) : assignedAt,
      createdAt: iso(created),
    };
    const settings = db.settings[W]!;
    const asg: Scoped<Assignment> = {
      id: `asg_${i}`,
      workspaceId: W,
      leadId,
      userId: owner.id,
      userName: owner.name,
      level: escalationCount,
      status: acknowledged ? "ACKNOWLEDGED" : "PENDING",
      reason: escalationCount ? "ESCALATION" : "ROUND_ROBIN",
      assignedAt,
      dueAt: i < 4 ? iso(now + (20 + i * 25) * 1000) : iso(created + settings.ackWindowSec * 1000),
      resolvedAt: acknowledged ? lead.acknowledgedAt : null,
    };
    if (!acknowledged && i >= 4) {
      asg.status = "EXPIRED";
      lead.recoveryReason = escalationCount >= 2 ? "ESCALATED_TWICE" : "OVERDUE";
    }
    lead.current = { ...asg };
    if (lead.status === "ACKNOWLEDGED" && createdMin > 60 * 24 * 2 && r() < 0.2) {
      lead.recoveryReason = "IDLE";
    } else if (lead.status === "ACKNOWLEDGED") {
      lead.lastActivityAt = iso(now - between(5, 50) * 60_000);
    }
    db.assignments.push(asg);
    db.leads.push(lead);
    if (lead.status === "ASSIGNED" || lead.status === "ACKNOWLEDGED") owner.openLeadCount += 1;
    db.activities.push({
      id: uid("act"),
      workspaceId: W,
      entityType: "lead",
      entityId: leadId,
      type: "CREATED",
      actorId: null,
      actorName: "System",
      summary: `Lead captured from ${lead.source === "WEB_FORM" ? "the web form" : lead.source === "MESSAGE" ? "WhatsApp" : "manual entry"}`,
      at: lead.createdAt,
    });
    db.activities.push({
      id: uid("act"),
      workspaceId: W,
      entityType: "contact",
      entityId: contact.id,
      type: "ASSIGNMENT",
      actorId: null,
      actorName: "System",
      summary: `Lead assigned to ${owner.name}`,
      at: assignedAt,
    });
    db.audit.push({
      id: uid("aud"),
      workspaceId: W,
      action: "LEAD_ASSIGNED",
      actorId: null,
      actorName: "System",
      targetType: "lead",
      targetId: leadId,
      targetLabel: lead.contactName,
      before: null,
      after: { owner: owner.name, reason: "ROUND_ROBIN" },
      at: assignedAt,
    });
    if (escalationCount) {
      db.audit.push({
        id: uid("aud"),
        workspaceId: W,
        action: "LEAD_ESCALATED",
        actorId: null,
        actorName: "System",
        targetType: "lead",
        targetId: leadId,
        targetLabel: lead.contactName,
        before: { owner: pick(leadOwners).name },
        after: { owner: owner.name, level: escalationCount },
        at: iso(created + settings.ackWindowSec * 1000),
      });
    }
    if (acknowledged) {
      db.audit.push({
        id: uid("aud"),
        workspaceId: W,
        action: "LEAD_ACKNOWLEDGED",
        actorId: owner.id,
        actorName: owner.name,
        targetType: "lead",
        targetId: leadId,
        targetLabel: lead.contactName,
        before: { status: "ASSIGNED" },
        after: { status: "ACKNOWLEDGED", timeToFirstResponseSec: ttfr },
        at: lead.acknowledgedAt!,
      });
    }
  }

  const convoLines: [("INBOUND" | "OUTBOUND"), string][][] = [
    [["INBOUND", "Hi, is anyone available to talk about panels for my house?"], ["OUTBOUND", "Hi! This is Bilal from Northwind. Happy to help. Roughly what is your monthly electricity bill?"], ["INBOUND", "Around $280 in summer"], ["OUTBOUND", "That's a good fit. Could we book a free site survey Thursday morning?"]],
    [["INBOUND", "Do you install batteries without panels?"], ["OUTBOUND", "We do. Most people pair it with panels, but a standalone battery works with time-of-use rates."], ["INBOUND", "Great, send me a price please"]],
    [["INBOUND", "Can you come Saturday?"], ["OUTBOUND", "Saturday at 10:00 works. I'll send a calendar invite."], ["INBOUND", "👍"]],
    [["OUTBOUND", "Hi Ava, following up on the proposal we sent. Any questions?"]],
  ];
  for (let i = 0; i < 14; i++) {
    const contact = db.contacts[(i * 9 + 2) % db.contacts.length]!;
    const assignee = db.users.find((u) => u.id === contact.ownerId)!;
    const lines = convoLines[i % convoLines.length]!;
    const convId = `cv_${i}`;
    const start = now - between(10, 60 * 24 * 4) * 60_000;
    lines.forEach(([direction, body], j) => {
      const failed = i === 3 && j === lines.length - 1;
      db.messages.push({
        id: `msg_${i}_${j}`,
        workspaceId: W,
        conversationId: convId,
        direction,
        body,
        status: direction === "INBOUND" ? "RECEIVED" : failed ? "FAILED" : j === lines.length - 1 ? "DELIVERED" : "READ",
        errorCode: failed ? "63016" : null,
        errorMessage: failed
          ? "WhatsApp only allows free-form replies within 24 hours of the customer's last message. Ask the customer to message the sandbox again, then retry."
          : null,
        providerSid: `SM${(i * 31 + j).toString(16).padStart(32, "0")}`,
        sentById: direction === "OUTBOUND" ? assignee.id : null,
        sentByName: direction === "OUTBOUND" ? assignee.name : null,
        at: iso(start + j * 4 * 60_000),
      });
    });
    const last = lines[lines.length - 1]!;
    db.conversations.push({
      id: convId,
      workspaceId: W,
      contactId: contact.id,
      contactName: `${contact.firstName} ${contact.lastName}`,
      contactPhone: contact.phone!,
      channel: "WHATSAPP",
      assigneeId: assignee.id,
      assigneeName: assignee.name,
      lastMessageAt: iso(start + (lines.length - 1) * 4 * 60_000),
      lastMessagePreview: last[1],
      unreadCount: last[0] === "INBOUND" && i % 2 === 0 ? 1 : 0,
      optedOut: contact.optedOut,
    });
  }
  const opted = db.contacts[7]!;
  db.conversations.push({
    id: "cv_optout",
    workspaceId: W,
    contactId: opted.id,
    contactName: `${opted.firstName} ${opted.lastName}`,
    contactPhone: opted.phone!,
    channel: "WHATSAPP",
    assigneeId: opted.ownerId,
    assigneeName: opted.ownerName,
    lastMessageAt: daysAgo(2),
    lastMessagePreview: "STOP",
    unreadCount: 0,
    optedOut: true,
  });
  db.messages.push({
    id: "msg_optout",
    workspaceId: W,
    conversationId: "cv_optout",
    direction: "INBOUND",
    body: "STOP",
    status: "RECEIVED",
    errorCode: null,
    errorMessage: null,
    providerSid: "SMoptout",
    sentById: null,
    sentByName: null,
    at: daysAgo(2),
  });

  const payStatuses: Payment["status"][] = ["PAID", "PAID", "PAID", "PENDING", "PAID", "EXPIRED", "PAID", "FAILED", "REFUNDED", "PENDING", "PAID", "PARTIALLY_REFUNDED", "PAID", "PENDING", "PAID", "EXPIRED", "PAID", "PAID"];
  payStatuses.forEach((status, i) => {
    const opp = db.opportunities[(i * 3 + 1) % db.opportunities.length]!;
    const requester = db.users.find((u) => u.id === opp.ownerId)!;
    const amount = Math.round(((opp.value ?? 20000) * (i % 3 === 0 ? 0.3 : 0.1)) / 50) * 50;
    const created = now - between(1, 40) * 86_400_000;
    db.payments.push({
      id: `pay_${i}`,
      workspaceId: W,
      opportunityId: opp.id,
      opportunityName: opp.name,
      contactId: opp.contactId,
      contactName: opp.contactName,
      requestedById: requester.id,
      requestedByName: requester.name,
      amount,
      currency: "USD",
      status,
      refundedAmount: status === "REFUNDED" ? amount : status === "PARTIALLY_REFUNDED" ? Math.round(amount / 4) : 0,
      stripeSessionId: `cs_test_${(i * 7919).toString(36).padStart(10, "a")}`,
      checkoutUrl: status === "PENDING" ? `https://checkout.stripe.com/c/pay/cs_test_${i}` : null,
      createdAt: iso(created),
      paidAt: ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"].includes(status) ? iso(created + 3_600_000) : null,
    });
    opp.paymentStatus = status;
  });

  for (let i = 0; i < 16; i++) {
    const contact = db.contacts[(i * 13 + 5) % db.contacts.length]!;
    const member = pick(["bilal", "sara", "tomas", "amina"].map(byHandle));
    const dayOffset = i < 3 ? -between(1, 6) : between(0, 9);
    const start = new Date(now + dayOffset * 86_400_000);
    start.setUTCHours(16 + (i % 6), i % 2 ? 30 : 0, 0, 0);
    db.appointments.push({
      id: `apt_${i}`,
      workspaceId: W,
      title: i % 3 === 0 ? "Site survey" : i % 3 === 1 ? "Proposal walkthrough" : "Installation planning",
      contactId: contact.id,
      contactName: `${contact.firstName} ${contact.lastName}`,
      opportunityId: null,
      userId: member.id,
      userName: member.name,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 45 * 60_000).toISOString(),
      timeZone: member.timeZone,
      googleEventId: `gcal_${i}x${(i * 104729).toString(36)}`,
      status: i === 5 ? "CANCELLED" : "CONFIRMED",
      notes: null,
    });
  }

  const conns = connectionsFor(W, true);
  const mask: Record<string, string> = {
    TWILIO: "AC••••••••••••••••••••••••••7f2c",
    STRIPE: "sk_test_••••••••••••••••4Qe1",
    GOOGLE: "OAuth client ••••••.apps.googleusercontent.com",
    TELEGRAM: "@northwind_baton_bot · token ••••••:AAH•••••••x9",
  };
  for (const c of conns) {
    c.maskedCredential = mask[c.provider]!;
    c.lastOkAt = minutesAgo(between(1, 40));
  }
  const tg = conns.find((c) => c.provider === "TELEGRAM")!;
  tg.lastError = "Forbidden: bot was blocked by the user (Tomás Ferreira). Ask them to press Start in the bot again.";
  tg.lastErrorAt = minutesAgo(95);
  db.connections.push(...conns);

  const evTypes: [IntegrationEvent["provider"], IntegrationEvent["direction"], string][] = [
    ["TWILIO", "INBOUND", "message.received"],
    ["TWILIO", "OUTBOUND", "message.send"],
    ["TWILIO", "INBOUND", "message.status"],
    ["STRIPE", "OUTBOUND", "checkout.session.create"],
    ["STRIPE", "INBOUND", "checkout.session.completed"],
    ["GOOGLE", "OUTBOUND", "events.insert"],
    ["GOOGLE", "OUTBOUND", "freebusy.query"],
    ["TELEGRAM", "OUTBOUND", "sendMessage"],
  ];
  for (let i = 0; i < 60; i++) {
    const [provider, direction, type] = evTypes[i % evTypes.length]!;
    const special = i === 9 ? "REJECTED" : i === 17 ? "DUPLICATE" : i === 23 ? "FAILED" : i === 31 ? "RETRYING" : "OK";
    db.events.push({
      id: uid("evt"),
      workspaceId: W,
      provider,
      direction,
      type,
      status: special,
      reference: provider === "STRIPE" ? `evt_1Q${i}x${(i * 9973).toString(36)}` : provider === "TWILIO" ? `SM${(i * 7177).toString(16).padStart(32, "0")}` : provider === "GOOGLE" ? `gcal_${i}` : `tg_${1000 + i}`,
      error:
        special === "REJECTED"
          ? "Signature check failed (X-Twilio-Signature did not match). Request ignored."
          : special === "DUPLICATE"
            ? "Already processed this event id; no changes made."
            : special === "FAILED"
              ? "403 Forbidden: bot was blocked by the user."
              : special === "RETRYING"
                ? "503 from Google; retrying in 30 s (attempt 2 of 5)."
                : null,
      at: minutesAgo(i * 23 + between(0, 10)),
    });
  }

  db.alerts.push(
    { id: uid("alr"), workspaceId: W, leadId: "ld_5", leadLabel: db.leads[5]!.contactName, userId: "usr_sara", userName: "Sara Lindqvist", channel: "TELEGRAM", status: "SENT", attempts: 1, lastError: null, at: minutesAgo(50) },
    { id: uid("alr"), workspaceId: W, leadId: "ld_9", leadLabel: db.leads[9]!.contactName, userId: "usr_tomas", userName: "Tomás Ferreira", channel: "TELEGRAM", status: "FAILED", attempts: 3, lastError: "403 Forbidden: bot was blocked by the user", at: minutesAgo(95) },
    { id: uid("alr"), workspaceId: W, leadId: "ld_12", leadLabel: db.leads[12]!.contactName, userId: "usr_priya", userName: "Priya Nair", channel: "TELEGRAM", status: "SENT", attempts: 1, lastError: null, at: minutesAgo(180) },
  );

  const admin = byHandle("amina");
  const configAudit: [AuditEvent["action"], string, string, unknown, unknown, number][] = [
    ["PIPELINE_CHANGED", "pipeline", "Residential", { stage: "Survey" }, { stage: "Site survey" }, 6000],
    ["FIELD_CONFIG_CHANGED", "field", "Monthly bill ($)", null, { type: "NUMBER", pipeline: "Residential" }, 5800],
    ["PERMISSION_CHANGED", "role", "Sales", { "crm.view_values": true }, { "crm.view_values": false }, 5400],
    ["MEMBER_INVITED", "user", "Tomás Ferreira", null, { baseLevel: "USER", role: "Sales" }, 5000],
    ["INTEGRATION_CHANGED", "integration", "Stripe", { status: "NOT_CONNECTED" }, { status: "CONNECTED" }, 4600],
    ["INTEGRATION_CHANGED", "integration", "Twilio", { status: "NOT_CONNECTED" }, { status: "CONNECTED" }, 4500],
    ["SETTINGS_CHANGED", "settings", "Assignment rules", { ackWindowSec: 300 }, { ackWindowSec: 90 }, 300],
    ["RECORD_DELETED", "contact", "Test Contact", { name: "Test Contact" }, null, 200],
  ];
  for (const [action, targetType, label, before, after, minAgo] of configAudit) {
    db.audit.push({ id: uid("aud"), workspaceId: W, action, actorId: admin.id, actorName: admin.name, targetType, targetId: uid("t"), targetLabel: label, before, after, at: minutesAgo(minAgo) });
  }

  for (const c of db.contacts.slice(0, 60)) {
    db.activities.push({
      id: uid("act"),
      workspaceId: W,
      entityType: "contact",
      entityId: c.id,
      type: "NOTE",
      actorId: c.ownerId,
      actorName: c.ownerName ?? "System",
      summary: pick([
        "Called, left a voicemail. Will try again tomorrow morning.",
        "Sent the brochure and the financing sheet.",
        "Customer wants to wait until the roof is replaced in spring.",
        "Interested in battery backup after last winter's outages.",
      ]),
      at: c.lastActivityAt ?? c.createdAt,
    });
  }
  for (const o of db.opportunities) {
    db.activities.push({
      id: uid("act"),
      workspaceId: W,
      entityType: "opportunity",
      entityId: o.id,
      type: "STAGE_CHANGE",
      actorId: o.ownerId,
      actorName: o.ownerName ?? "System",
      summary: `Moved to ${[...resStages, ...comStages].find((s) => s.id === o.stageId)?.name}`,
      at: o.updatedAt,
    });
  }

  db.savedLists.push(
    { id: "sl_1", workspaceId: W, entity: "contact", name: "Battery prospects in Oakland", filters: [{ field: "tags", op: "contains", value: "battery-interest" }, { field: "companyName", op: "eq", value: "" }, { field: "ownerId", op: "eq", value: "usr_bilal" }], shared: true, ownerId: "usr_amina" },
  );

  return db;
}

let cache: MockDB | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function loadDB(): MockDB {
  if (cache) return cache;
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MockDB;
        if (parsed.version === DB_VERSION) {
          cache = parsed;
          return cache;
        }
      }
    } catch {
      // fall through to a fresh seed
    }
  }
  cache = seed();
  persist();
  return cache;
}

export function persist() {
  if (typeof window === "undefined" || !cache) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch {
      // storage full or blocked: the demo keeps working in memory
    }
  }, 250);
}

export function resetDB() {
  cache = seed();
  persist();
  return cache;
}
