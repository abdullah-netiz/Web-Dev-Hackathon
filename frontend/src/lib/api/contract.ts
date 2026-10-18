import type {
  Activity,
  AlertDelivery,
  Appointment,
  Assignment,
  Availability,
  AuditAction,
  AuditEvent,
  BaseLevel,
  BusySlot,
  Company,
  Contact,
  ContactOverview,
  Conversation,
  CustomField,
  CustomFieldEntity,
  CustomFieldType,
  CustomValues,
  DashboardMetrics,
  Filter,
  ID,
  IntegrationConnection,
  IntegrationEvent,
  Lead,
  Message,
  Opportunity,
  Page,
  Payment,
  PaymentStatus,
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

export interface ListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  filters?: Filter[];
  sort?: string;
}

export interface OpportunityDetail {
  opportunity: Opportunity;
  activities: Activity[];
  payments: Payment[];
  appointments: Appointment[];
  fields: CustomField[];
}

export interface LeadDetail {
  lead: Lead;
  assignments: Assignment[];
  activities: Activity[];
}

export interface PublicWorkspace {
  name: string;
  slug: string;
  timeZone: string;
}

export interface Api {
  auth: {
    login(input: { email: string; password: string }): Promise<Session>;
    signup(input: { workspaceName: string; name: string; email: string; password: string }): Promise<Session>;
    acceptInvite(token: string, input: { name: string; password: string }): Promise<Session>;
    me(): Promise<Session>;
    logout(): Promise<void>;
  };
  workspace: {
    get(): Promise<Workspace>;
    update(patch: Partial<Pick<Workspace, "name" | "timeZone" | "currency">>): Promise<Workspace>;
    settings(): Promise<WorkspaceSettings>;
    updateSettings(patch: Partial<WorkspaceSettings>): Promise<WorkspaceSettings>;
  };
  members: {
    list(): Promise<User[]>;
    invite(input: { email: string; name: string; baseLevel: BaseLevel; roleId: ID }): Promise<{ user: User; inviteUrl: string }>;
    reactivate(id: ID): Promise<User>;
    update(
      id: ID,
      patch: Partial<Pick<User, "baseLevel" | "roleId" | "maxOpenLeads" | "isManager" | "backupUserId">>,
    ): Promise<User>;
    setAvailability(id: ID, availability: Availability): Promise<User>;
    deactivate(id: ID): Promise<User>;
  };
  roles: {
    list(): Promise<Role[]>;
    create(input: { name: string; description: string; permissions: Permission[] }): Promise<Role>;
    update(id: ID, patch: { name?: string; description?: string; permissions?: Permission[] }): Promise<Role>;
    remove(id: ID): Promise<void>;
  };
  companies: {
    list(params?: ListParams): Promise<Page<Company>>;
    get(id: ID): Promise<{ company: Company; contacts: Contact[]; opportunities: Opportunity[] }>;
    create(input: { name: string; domain?: string; industry?: string; city?: string }): Promise<Company>;
  };
  contacts: {
    list(params?: ListParams): Promise<Page<Contact>>;
    overview(id: ID): Promise<ContactOverview>;
    create(input: {
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
      companyId?: ID | null;
      tags?: string[];
      custom?: CustomValues;
    }): Promise<Contact>;
    update(id: ID, version: number, patch: Partial<Omit<Contact, "id" | "version">>): Promise<Contact>;
    remove(id: ID): Promise<void>;
    addNote(entity: { type: "contact" | "opportunity" | "lead"; id: ID }, text: string): Promise<Activity>;
    exportCsv(params?: ListParams): Promise<string>;
    tags(): Promise<string[]>;
  };
  pipelines: {
    list(): Promise<Pipeline[]>;
    create(name: string): Promise<Pipeline>;
    rename(id: ID, name: string): Promise<Pipeline>;
    addStage(pipelineId: ID, name: string): Promise<Stage>;
    updateStage(
      stageId: ID,
      patch: Partial<Pick<Stage, "name" | "requiredFieldKeys" | "isWon" | "isLost">>,
    ): Promise<Stage>;
    reorderStages(pipelineId: ID, stageIds: ID[]): Promise<Pipeline>;
    deleteStage(stageId: ID, moveToStageId: ID | null): Promise<void>;
  };
  fields: {
    list(entity?: CustomFieldEntity): Promise<CustomField[]>;
    create(input: {
      entity: CustomFieldEntity;
      label: string;
      type: CustomFieldType;
      options?: string[];
      pipelineId?: ID | null;
    }): Promise<CustomField>;
    update(id: ID, patch: Partial<Pick<CustomField, "label" | "options">>): Promise<CustomField>;
    archive(id: ID): Promise<void>;
  };
  opportunities: {
    list(params: ListParams & { pipelineId: ID }): Promise<Page<Opportunity>>;
    get(id: ID): Promise<OpportunityDetail>;
    create(input: {
      name: string;
      contactId: ID;
      pipelineId: ID;
      stageId: ID;
      value?: number;
      currency?: string;
      custom?: CustomValues;
    }): Promise<Opportunity>;
    update(id: ID, version: number, patch: Partial<Pick<Opportunity, "name" | "value" | "custom" | "ownerId" | "expectedCloseDate">>): Promise<Opportunity>;
    moveStage(id: ID, version: number, stageId: ID): Promise<Opportunity>;
  };
  leads: {
    list(params: { scope: "mine" | "all"; status?: Lead["status"] | "OPEN"; q?: string }): Promise<Lead[]>;
    get(id: ID): Promise<LeadDetail>;
    create(input: { name: string; phone?: string; email?: string; message: string }): Promise<Lead>;
    acknowledge(id: ID): Promise<Lead>;
    reassign(id: ID, userId: ID): Promise<Lead>;
    close(id: ID): Promise<Lead>;
    recovery(): Promise<Lead[]>;
  };
  conversations: {
    list(): Promise<Conversation[]>;
    get(id: ID): Promise<{ conversation: Conversation; messages: Message[] }>;
    send(id: ID, body: string): Promise<Message>;
    retry(messageId: ID): Promise<Message>;
    markRead(id: ID): Promise<void>;
  };
  payments: {
    list(params?: { status?: PaymentStatus; opportunityId?: ID }): Promise<Payment[]>;
    request(input: { opportunityId: ID; amount: number; currency: string; description?: string }): Promise<Payment>;
  };
  appointments: {
    list(params?: { from?: string; to?: string; userId?: ID }): Promise<Appointment[]>;
    busy(userId: ID, from: string, to: string): Promise<BusySlot[]>;
    book(input: {
      title: string;
      contactId: ID;
      opportunityId?: ID | null;
      userId: ID;
      startsAt: string;
      endsAt: string;
      timeZone: string;
      notes?: string;
    }): Promise<Appointment>;
    reschedule(id: ID, input: { startsAt: string; endsAt: string }): Promise<Appointment>;
    cancel(id: ID): Promise<Appointment>;
  };
  integrations: {
    list(): Promise<IntegrationConnection[]>;
    events(params?: { provider?: Provider }): Promise<IntegrationEvent[]>;
    alerts(): Promise<AlertDelivery[]>;
    connect(provider: Provider, credentials: Record<string, string>, config?: Record<string, string>): Promise<IntegrationConnection>;
    disconnect(provider: Provider): Promise<IntegrationConnection>;
    test(provider: Provider): Promise<{ ok: boolean; detail: string }>;
    googleConnectUrl(): Promise<{ url: string }>;
    disconnectGoogle(): Promise<User>;
    /** Empty input links by the user's email; otherwise uses the given Slack member ID (I4.3). */
    slackLink(input?: { slackUserId?: string }): Promise<{ linked: boolean; slackUserId: string | null }>;
    slackUnlink(): Promise<void>;
  };
  audit: {
    list(params: { action?: AuditAction; actorId?: ID; from?: string; to?: string; page?: number; pageSize?: number }): Promise<Page<AuditEvent>>;
  };
  dashboard: {
    metrics(): Promise<DashboardMetrics>;
    prefs(): Promise<{ hidden: string[] }>;
    savePrefs(hidden: string[]): Promise<{ hidden: string[] }>;
  };
  savedLists: {
    list(entity: SavedList["entity"]): Promise<SavedList[]>;
    create(input: Omit<SavedList, "id" | "ownerId">): Promise<SavedList>;
    remove(id: ID): Promise<void>;
  };
  public: {
    workspace(slug: string): Promise<PublicWorkspace>;
    submitLead(
      slug: string,
      input: { name: string; email?: string; phone?: string; message: string; company?: string; website?: string },
    ): Promise<{ reference: string }>;
    paymentStatus(sessionId: string): Promise<{ status: PaymentStatus; amount: number; currency: string; workspaceName: string }>;
  };
  realtime: {
    subscribe(handler: (event: RealtimeEvent) => void): () => void;
  };
}
