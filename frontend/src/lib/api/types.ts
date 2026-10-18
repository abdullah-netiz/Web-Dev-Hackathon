export type ID = string;
export type ISODate = string;

export type BaseLevel = "OWNER" | "ADMIN" | "USER";
export type Availability = "AVAILABLE" | "BUSY" | "ON_LEAVE" | "OFFLINE";

/** Same keys as the backend (GET /meta/permissions); Owner and Admin hold all of them (F1.2, F1.3). */
export const PERMISSIONS = [
  { key: "crm.view", group: "CRM records", label: "View records" },
  { key: "crm.create", group: "CRM records", label: "Create records" },
  { key: "crm.edit", group: "CRM records", label: "Edit records" },
  { key: "crm.delete", group: "CRM records", label: "Delete records" },
  { key: "crm.export", group: "CRM records", label: "Export records" },
  { key: "crm.view_values", group: "CRM records", label: "See opportunity values" },
  { key: "leads.view_all", group: "Leads", label: "See every lead, not only own" },
  { key: "leads.reassign", group: "Leads", label: "Reassign leads" },
  { key: "leads.manage_rules", group: "Leads", label: "Manage assignment rules" },
  { key: "dashboard.company", group: "Insight", label: "Company-wide dashboard" },
  { key: "audit.view", group: "Insight", label: "View audit history" },
  { key: "integrations.view", group: "Administration", label: "See integration status and history" },
  { key: "integrations.manage", group: "Administration", label: "Manage integrations" },
  { key: "settings.manage", group: "Administration", label: "Manage workspace, pipelines and fields" },
  { key: "users.manage", group: "Administration", label: "Invite and manage members" },
  { key: "roles.manage", group: "Administration", label: "Manage roles and permissions" },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];

export interface Workspace {
  id: ID;
  name: string;
  slug: string;
  timeZone: string;
  currency: string;
}

export interface Role {
  id: ID;
  name: string;
  description: string;
  permissions: Permission[];
  isSystem: boolean;
  memberCount: number;
}

export type CalendarStatus = "CONNECTED" | "NOT_CONNECTED" | "NEEDS_RECONNECT";

export interface User {
  id: ID;
  name: string;
  email: string;
  baseLevel: BaseLevel;
  roleId: ID;
  roleName: string;
  availability: Availability;
  openLeadCount: number;
  maxOpenLeads: number | null;
  isManager: boolean;
  backupUserId: ID | null;
  slackLinked: boolean;
  slackUserId: string | null;
  invitePending?: boolean;
  calendarStatus: CalendarStatus;
  timeZone: string;
  lastAssignedAt: ISODate | null;
  active: boolean;
}

export interface Session {
  token: string;
  user: User;
  workspace: Workspace;
  permissions: Permission[];
  expiresAt: ISODate;
}

export interface Company {
  id: ID;
  name: string;
  domain: string | null;
  industry: string | null;
  city: string | null;
  contactCount: number;
  openOpportunityCount: number;
  createdAt: ISODate;
}

export type CustomFieldType = "TEXT" | "NUMBER" | "DATE" | "SELECT" | "BOOLEAN";
export type CustomFieldEntity = "contact" | "opportunity" | "company";

export interface CustomField {
  id: ID;
  entity: CustomFieldEntity;
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  pipelineId: ID | null;
  isArchived: boolean;
  order: number;
}

export type CustomValues = Record<string, string | number | boolean | null>;

export interface Contact {
  id: ID;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  companyId: ID | null;
  companyName: string | null;
  ownerId: ID | null;
  ownerName: string | null;
  tags: string[];
  optedOut: boolean;
  custom: CustomValues;
  createdAt: ISODate;
  lastActivityAt: ISODate | null;
  version: number;
}

export interface Stage {
  id: ID;
  pipelineId: ID;
  name: string;
  order: number;
  isWon: boolean;
  isLost: boolean;
  requiredFieldKeys: string[];
}

export interface Pipeline {
  id: ID;
  name: string;
  stages: Stage[];
}

export type PaymentStatus = "PENDING" | "PAID" | "EXPIRED" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";

export interface Opportunity {
  id: ID;
  name: string;
  contactId: ID;
  contactName: string;
  companyName: string | null;
  pipelineId: ID;
  stageId: ID;
  ownerId: ID | null;
  ownerName: string | null;
  /** Absent when the caller lacks `crm.view_values` (F1.4). */
  value?: number;
  currency: string;
  custom: CustomValues;
  paymentStatus: PaymentStatus | null;
  expectedCloseDate: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  version: number;
}

export type LeadSource = "WEB_FORM" | "MESSAGE" | "MANUAL";
export type LeadStatus = "NEW" | "ASSIGNED" | "ACKNOWLEDGED" | "CLOSED";
export type RecoveryReason = "NONE" | "OVERDUE" | "ESCALATED_TWICE" | "IDLE";
export type AssignmentStatus = "PENDING" | "ACKNOWLEDGED" | "EXPIRED" | "REASSIGNED";
export type AssignmentReason = "ROUND_ROBIN" | "ESCALATION" | "ABSENCE" | "MANUAL";

export interface Assignment {
  id: ID;
  leadId: ID;
  userId: ID;
  userName: string;
  level: number;
  status: AssignmentStatus;
  reason: AssignmentReason;
  assignedAt: ISODate;
  dueAt: ISODate;
  resolvedAt: ISODate | null;
}

export interface Lead {
  id: ID;
  source: LeadSource;
  status: LeadStatus;
  contactId: ID;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  message: string;
  ownerId: ID | null;
  ownerName: string | null;
  current: Assignment | null;
  escalationCount: number;
  recoveryReason: RecoveryReason;
  firstAssignedAt: ISODate | null;
  acknowledgedAt: ISODate | null;
  timeToFirstResponseSec: number | null;
  lastActivityAt: ISODate;
  createdAt: ISODate;
}

export type ActivityType =
  | "CREATED"
  | "NOTE"
  | "STAGE_CHANGE"
  | "ASSIGNMENT"
  | "ACKNOWLEDGED"
  | "ESCALATION"
  | "REASSIGNMENT"
  | "FIELD_EDIT"
  | "MESSAGE"
  | "PAYMENT"
  | "APPOINTMENT";

export interface Activity {
  id: ID;
  entityType: "contact" | "opportunity" | "lead" | "company";
  entityId: ID;
  type: ActivityType;
  actorId: ID | null;
  actorName: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  at: ISODate;
}

export type AuditAction =
  | "LEAD_ASSIGNED"
  | "LEAD_ACKNOWLEDGED"
  | "LEAD_ESCALATED"
  | "LEAD_REASSIGNED"
  | "ROLE_CHANGED"
  | "PERMISSION_CHANGED"
  | "MEMBER_INVITED"
  | "MEMBER_LEVEL_CHANGED"
  | "FIELD_CONFIG_CHANGED"
  | "PIPELINE_CHANGED"
  | "INTEGRATION_CHANGED"
  | "RECORD_DELETED"
  | "SETTINGS_CHANGED"
  | "ALERT_SENT";

export interface AuditEvent {
  id: ID;
  action: AuditAction;
  actorId: ID | null;
  actorName: string;
  targetType: string;
  targetId: ID;
  targetLabel: string;
  before: unknown;
  after: unknown;
  at: ISODate;
}

export type MessageStatus = "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "RECEIVED";

export interface Conversation {
  id: ID;
  contactId: ID;
  contactName: string;
  contactPhone: string;
  channel: "WHATSAPP";
  assigneeId: ID | null;
  assigneeName: string | null;
  lastMessageAt: ISODate;
  lastMessagePreview: string;
  unreadCount: number;
  optedOut: boolean;
}

export interface Message {
  id: ID;
  conversationId: ID;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  status: MessageStatus;
  errorCode: string | null;
  errorMessage: string | null;
  providerSid: string | null;
  sentById: ID | null;
  sentByName: string | null;
  at: ISODate;
}

export interface Payment {
  id: ID;
  opportunityId: ID;
  opportunityName: string;
  contactId: ID;
  contactName: string;
  requestedById: ID;
  requestedByName: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  refundedAmount: number;
  /** Lemon Squeezy order id once paid, else the checkout id (I2.7). */
  providerReference: string;
  checkoutUrl: string | null;
  createdAt: ISODate;
  paidAt: ISODate | null;
}

export interface Appointment {
  id: ID;
  title: string;
  contactId: ID;
  contactName: string;
  opportunityId: ID | null;
  userId: ID;
  userName: string;
  startsAt: ISODate;
  endsAt: ISODate;
  timeZone: string;
  googleEventId: string | null;
  status: "CONFIRMED" | "CANCELLED";
  notes: string | null;
}

export interface BusySlot {
  start: ISODate;
  end: ISODate;
}

export type Provider = "TWILIO" | "LEMONSQUEEZY" | "GOOGLE" | "SLACK";
export type ConnectionStatus = "NOT_CONNECTED" | "CONNECTED" | "ERROR";

export interface IntegrationConnection {
  provider: Provider;
  status: ConnectionStatus;
  maskedCredential: string | null;
  lastOkAt: ISODate | null;
  lastError: string | null;
  lastErrorAt: ISODate | null;
  canDo: string[];
  cannotDo: string[];
  /** Where to paste this workspace's webhook in the provider dashboard. */
  webhookUrl?: string | null;
  statusCallbackUrl?: string | null;
  details?: Record<string, unknown>;
}

export interface IntegrationEvent {
  id: ID;
  provider: Provider;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  status: "OK" | "FAILED" | "REJECTED" | "DUPLICATE" | "RETRYING";
  reference: string;
  error: string | null;
  at: ISODate;
}

export interface AlertDelivery {
  id: ID;
  leadId: ID;
  leadLabel: string;
  userId: ID;
  userName: string;
  channel: "SLACK";
  status: "SENT" | "FAILED" | "RETRYING";
  attempts: number;
  lastError: string | null;
  at: ISODate;
}

export interface WorkspaceSettings {
  ackWindowSec: number;
  escalationLevels: number;
  levelWindowSec: number;
  idleSec: number;
  maxOpenLeadsDefault: number;
  acknowledgedOnAbsence: "KEEP" | "REASSIGN";
}

export type FilterOp = "eq" | "neq" | "contains" | "in" | "gte" | "lte" | "isTrue" | "isFalse";

export interface Filter {
  field: string;
  op: FilterOp;
  value?: string | number | string[];
}

export interface SavedList {
  id: ID;
  entity: "contact" | "opportunity" | "lead";
  name: string;
  filters: Filter[];
  shared: boolean;
  ownerId: ID;
}

export interface StageValue {
  pipelineName: string;
  stageId: ID;
  stageName: string;
  count: number;
  value: number;
}

export interface DashboardMetrics {
  scope: "COMPANY" | "PERSONAL";
  currency: string;
  newLeadsToday: number;
  openPipelineByStage: StageValue[] | null;
  avgTimeToFirstResponseSec: number | null;
  recoveryCount: number;
  escalations24h: number;
  availability: Record<Availability, number>;
  upcomingAppointments: Appointment[];
  collectedThisMonth: number;
  paymentsThisMonthCount: number;
  projectedRevenue: number | null;
  responseTrend: { day: string; avgSec: number | null; leads: number }[];
}

export interface Page<T> {
  data: T[];
  meta: { total: number; page: number; pageSize: number };
}

export interface ApiErrorBody {
  code: string;
  message: string;
  action?: string;
  details?: unknown;
}

export interface ContactOverview {
  contact: Contact;
  company: Company | null;
  opportunities: Opportunity[];
  conversations: Conversation[];
  payments: Payment[];
  appointments: Appointment[];
  leads: Lead[];
  activities: Activity[];
  owner: User | null;
}

export type RealtimeEvent =
  | { type: "lead:created"; lead: Lead }
  | { type: "lead:assigned"; lead: Lead }
  | { type: "lead:acknowledged"; lead: Lead }
  | { type: "lead:escalated"; lead: Lead; fromUserName: string | null }
  | { type: "message:new"; message: Message; conversationId: ID }
  | { type: "message:status"; message: Message }
  | { type: "payment:updated"; payment: Payment }
  | { type: "availability:changed"; user: User }
  | { type: "opportunity:updated"; opportunity: Opportunity }
  | { type: "integration:updated"; connection: IntegrationConnection }
  /** Something changed that has no single object to show; the listed query keys are refetched. */
  | { type: "refresh"; keys: string[] };
