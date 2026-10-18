import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import type { SessionUser } from '../../auth/types/session-user';
import { businessRule } from '../../common/http-errors';
import { paginatedResponse } from '../../common/pagination';
import { PrismaService } from '../../common/prisma.service';
import {
  ActivitiesRepository,
  type ActivityRow,
} from './activities.repository';
import type { CreateActivityInput } from './dto/activity.dto';

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly repository: ActivitiesRepository,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async list(
    workspaceId: string,
    args: {
      entityType?: ActivityRow['entityType'];
      entityId?: string;
      limit: number;
      cursor?: string;
    },
  ) {
    const rows = await this.repository.list(workspaceId, {
      entityType: args.entityType,
      entityId: args.entityId,
      take: args.limit + 1,
      ...(args.cursor ? { skip: 1, cursor: { id: args.cursor } } : {}),
    });
    return paginatedResponse(rows, args.limit);
  }

  async create(user: SessionUser, input: CreateActivityInput, ip?: string): Promise<ActivityRow> {
    const exists = await this.repository.entityExists(
      user.workspaceId,
      input.entityType,
      input.entityId,
    );
    if (!exists) {
      throw businessRule(
        `That ${input.entityType.toLowerCase()} does not exist in this workspace.`,
        'Open the record from a list and add the note from there.',
      );
    }
    return this.prisma.runInTransaction(async (tx) => {
      const activity = await this.repository.create(
        user.workspaceId,
        {
          entityType: input.entityType,
          entityId: input.entityId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          meta: input.meta as Prisma.InputJsonValue | undefined,
          actorId: user.id,
        },
        tx,
      );
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorLabel: user.name,
          action: 'activity.logged',
          entityType: input.entityType.toLowerCase(),
          entityId: input.entityId,
          summary: `Logged ${input.type.toLowerCase()}: ${input.title}.`,
          ip,
        },
        tx,
      );
      return { ...activity, actor: { id: user.id, name: user.name } };
    });
  }
}
