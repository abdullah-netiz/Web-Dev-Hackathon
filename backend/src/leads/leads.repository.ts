import { Injectable } from '@nestjs/common';
import type { AssignmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { OPEN_LEAD_STATUSES } from './leads.constants';

const LEAD_LIST_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  phone: true,
  email: true,
  source: true,
  status: true,
  contactId: true,
  ownerId: true,
  escalationCount: true,
  recoveryReason: true,
  timeToFirstResponseSec: true,
  lastActivityAt: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, name: true, availability: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  assignments: {
    where: { status: 'PENDING' as AssignmentStatus },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { id: true, userId: true, level: true, dueAt: true },
  },
} satisfies Prisma.LeadSelect;

const LEAD_DETAIL_SELECT = {
  ...LEAD_LIST_SELECT,
  message: true,
  assignments: {
    orderBy: { createdAt: 'desc' as const },
    select: {
      id: true,
      userId: true,
      assignedById: true,
      status: true,
      level: true,
      dueAt: true,
      acknowledgedAt: true,
      expiredAt: true,
      createdAt: true,
      user: { select: { id: true, name: true, availability: true } },
    },
  },
} satisfies Prisma.LeadSelect;

export type LeadListRow = Prisma.LeadGetPayload<{ select: typeof LEAD_LIST_SELECT }>;
export type LeadDetailRow = Prisma.LeadGetPayload<{ select: typeof LEAD_DETAIL_SELECT }>;

const CANDIDATE_SELECT = {
  id: true,
  name: true,
  baseLevel: true,
  availability: true,
  lastAssignedAt: true,
} satisfies Prisma.UserSelect;

export type CandidateUser = Prisma.UserGetPayload<{ select: typeof CANDIDATE_SELECT }>;

export interface LeadListArgs {
  status?: LeadListRow['status'];
  ownerId?: string;
  unassigned?: boolean;
  q?: string;
  take: number;
  skip?: number;
  cursor?: { id: string };
}

@Injectable()
export class LeadsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, args: LeadListArgs): Promise<LeadListRow[]> {
    return this.prisma.lead.findMany({
      where: {
        workspaceId,
        ...(args.status ? { status: args.status } : {}),
        ...(args.unassigned ? { ownerId: null } : args.ownerId ? { ownerId: args.ownerId } : {}),
        ...(args.q
          ? {
              OR: [
                { name: { contains: args.q, mode: 'insensitive' } },
                { phone: { contains: args.q } },
                { email: { contains: args.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: args.take,
      skip: args.skip,
      cursor: args.cursor,
      select: LEAD_LIST_SELECT,
    });
  }

  async findById(
    workspaceId: string,
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<LeadDetailRow | null> {
    return (tx ?? this.prisma).lead.findFirst({
      where: { id, workspaceId },
      select: LEAD_DETAIL_SELECT,
    });
  }

  async create(
    workspaceId: string,
    data: Omit<Prisma.LeadUncheckedCreateInput, 'workspaceId'>,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    return (tx ?? this.prisma).lead.create({
      data: { ...data, workspaceId },
      select: { id: true },
    });
  }

  async updateWithVersion(
    workspaceId: string,
    id: string,
    version: number,
    data: Prisma.LeadUpdateManyMutationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await (tx ?? this.prisma).lead.updateMany({
      where: { id, workspaceId, version },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count;
  }

  async findPendingAssignment(
    leadId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; userId: string; level: number; dueAt: Date; createdAt: Date } | null> {
    return (tx ?? this.prisma).leadAssignment.findFirst({
      where: { leadId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userId: true, level: true, dueAt: true, createdAt: true },
    });
  }

  async findAssignmentWithLead(assignmentId: string, tx?: Prisma.TransactionClient) {
    return (tx ?? this.prisma).leadAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        workspaceId: true,
        leadId: true,
        userId: true,
        status: true,
        level: true,
        dueAt: true,
        createdAt: true,
        lead: {
          select: { id: true, workspaceId: true, name: true, ownerId: true, escalationCount: true, status: true },
        },
      },
    });
  }

  async expireAssignmentById(assignmentId: string, tx?: Prisma.TransactionClient): Promise<number> {
    const result = await (tx ?? this.prisma).leadAssignment.updateMany({
      where: { id: assignmentId, status: 'PENDING' },
      data: { status: 'EXPIRED', expiredAt: new Date() },
    });
    return result.count;
  }

  async acknowledgeAssignmentById(
    assignmentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await (tx ?? this.prisma).leadAssignment.updateMany({
      where: { id: assignmentId, status: 'PENDING' },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
    });
    return result.count;
  }

  async expirePendingForUser(
    workspaceId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Array<{ id: string; leadId: string }>> {
    const pending = await (tx ?? this.prisma).leadAssignment.findMany({
      where: { workspaceId, userId, status: 'PENDING' },
      select: { id: true, leadId: true },
    });
    if (pending.length > 0) {
      await (tx ?? this.prisma).leadAssignment.updateMany({
        where: { workspaceId, userId, status: 'PENDING' },
        data: { status: 'REASSIGNED', expiredAt: new Date() },
      });
    }
    return pending;
  }

  async createAssignment(
    workspaceId: string,
    data: Omit<Prisma.LeadAssignmentUncheckedCreateInput, 'workspaceId'>,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    return (tx ?? this.prisma).leadAssignment.create({
      data: { ...data, workspaceId },
      select: { id: true },
    });
  }

  async assignmentUserIds(leadId: string, tx?: Prisma.TransactionClient): Promise<string[]> {
    const rows = await (tx ?? this.prisma).leadAssignment.findMany({
      where: { leadId },
      select: { userId: true },
      distinct: ['userId'],
    });
    return rows.map((row) => row.userId);
  }

  async pendingAssignmentsForUser(
    workspaceId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Array<{ id: string; leadId: string }>> {
    return (tx ?? this.prisma).leadAssignment.findMany({
      where: { workspaceId, userId, status: 'PENDING' },
      select: { id: true, leadId: true },
    });
  }

  async allPendingAssignments(): Promise<
    Array<{ id: string; leadId: string; dueAt: Date }>
  > {
    return this.prisma.leadAssignment.findMany({
      where: { status: 'PENDING' },
      select: { id: true, leadId: true, dueAt: true },
    });
  }

  async candidateUsers(
    workspaceId: string,
    args: { managerOnly: boolean },
    tx?: Prisma.TransactionClient,
  ): Promise<CandidateUser[]> {
    return (tx ?? this.prisma).user.findMany({
      where: {
        workspaceId,
        isActive: true,
        availability: 'AVAILABLE',
        ...(args.managerOnly ? { baseLevel: { in: ['OWNER', 'ADMIN'] } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: CANDIDATE_SELECT,
    });
  }

  async openLeadCounts(
    workspaceId: string,
    userIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, number>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await (tx ?? this.prisma).lead.groupBy({
      by: ['ownerId'],
      where: { workspaceId, ownerId: { in: userIds }, status: { in: [...OPEN_LEAD_STATUSES] } },
      _count: { _all: true },
    });
    return new Map(
      rows.filter((row) => row.ownerId !== null).map((row) => [row.ownerId as string, row._count._all]),
    );
  }

  async workspaceBySlug(slug: string): Promise<{ id: string; name: string } | null> {
    return this.prisma.workspace.findUnique({ where: { slug }, select: { id: true, name: true } });
  }

  async ensureSettings(workspaceId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const existing = await client.workspaceSettings.findUnique({ where: { workspaceId } });
    return existing ?? client.workspaceSettings.create({ data: { workspaceId } });
  }

  async advanceRoundRobinCursor(workspaceId: string, tx?: Prisma.TransactionClient): Promise<number> {
    const updated = await (tx ?? this.prisma).workspaceSettings.update({
      where: { workspaceId },
      data: { roundRobinCursor: { increment: 1 } },
      select: { roundRobinCursor: true },
    });
    return updated.roundRobinCursor;
  }

  async userInWorkspace(
    workspaceId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; name: string; isActive: boolean; availability: string } | null> {
    return (tx ?? this.prisma).user.findFirst({
      where: { id: userId, workspaceId },
      select: { id: true, name: true, isActive: true, availability: true },
    });
  }

  async recoveryCandidates(
    workspaceId: string,
    bounds: { now: Date; idleBefore: Date },
  ): Promise<LeadListRow[]> {
    return this.prisma.lead.findMany({
      where: {
        workspaceId,
        status: { not: 'CLOSED' },
        OR: [
          { assignments: { some: { status: 'PENDING', dueAt: { lte: bounds.now } } } },
          { escalationCount: { gte: 2 } },
          { lastActivityAt: { lt: bounds.idleBefore } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: LEAD_LIST_SELECT,
    });
  }
}
