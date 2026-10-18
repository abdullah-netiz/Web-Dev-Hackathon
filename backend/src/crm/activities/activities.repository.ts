import { Injectable } from '@nestjs/common';
import type { Activity, ActivityEntity, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

const ACTIVITY_SELECT = {
  id: true,
  workspaceId: true,
  entityType: true,
  entityId: true,
  type: true,
  title: true,
  body: true,
  meta: true,
  actorId: true,
  createdAt: true,
  actor: { select: { id: true, name: true } },
} satisfies Prisma.ActivitySelect;

export type ActivityRow = Prisma.ActivityGetPayload<{ select: typeof ACTIVITY_SELECT }>;

export interface ActivityListArgs {
  entityType?: ActivityEntity;
  entityId?: string;
  take: number;
  skip?: number;
  cursor?: { id: string };
}

@Injectable()
export class ActivitiesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, args: ActivityListArgs): Promise<ActivityRow[]> {
    return this.prisma.activity.findMany({
      where: {
        workspaceId,
        ...(args.entityType ? { entityType: args.entityType } : {}),
        ...(args.entityId ? { entityId: args.entityId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: args.take,
      skip: args.skip,
      cursor: args.cursor,
      select: ACTIVITY_SELECT,
    });
  }

  async create(
    workspaceId: string,
    data: Omit<Prisma.ActivityUncheckedCreateInput, 'workspaceId'>,
    tx?: Prisma.TransactionClient,
  ): Promise<Activity> {
    return (tx ?? this.prisma).activity.create({ data: { ...data, workspaceId } });
  }

  /** Confirms the target record exists in this workspace before attaching a timeline entry (Q2). */
  async entityExists(
    workspaceId: string,
    entityType: ActivityEntity,
    entityId: string,
  ): Promise<boolean> {
    switch (entityType) {
      case 'CONTACT':
        return (await this.prisma.contact.count({ where: { id: entityId, workspaceId } })) > 0;
      case 'COMPANY':
        return (await this.prisma.company.count({ where: { id: entityId, workspaceId } })) > 0;
      case 'OPPORTUNITY':
        return (await this.prisma.opportunity.count({ where: { id: entityId, workspaceId } })) > 0;
      case 'LEAD':
        return (await this.prisma.lead.count({ where: { id: entityId, workspaceId } })) > 0;
      case 'CONVERSATION':
        return (
          (await this.prisma.conversation.count({ where: { id: entityId, workspaceId } })) > 0
        );
      default:
        return false;
    }
  }
}
