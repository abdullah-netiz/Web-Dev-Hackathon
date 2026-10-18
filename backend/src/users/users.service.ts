import { Injectable } from '@nestjs/common';
import type { Availability } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { SessionUser } from '../auth/types/session-user';
import { forbidden, notFound } from '../common/http-errors';
import { keysetArgs, type ListQuery } from '../common/pagination';
import { PrismaService } from '../common/prisma.service';
import { LeadsService } from '../leads/leads.service';
import { UsersRepository, type UserRow } from './users.repository';

@Injectable()
export class UsersService {
  constructor(
    private readonly repository: UsersRepository,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
  ) {}

  async list(
    workspaceId: string,
    query: ListQuery & { availability?: Availability; roleId?: string },
  ) {
    const rows = await this.repository.list(workspaceId, {
      ...keysetArgs(query),
      availability: query.availability,
      roleId: query.roleId,
      q: query.q,
    });
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      data,
      meta: { hasMore, nextCursor: hasMore ? (data[data.length - 1]?.id ?? null) : null },
    };
  }

  async setAvailability(
    actor: SessionUser,
    id: string,
    availability: Availability,
    ip?: string,
  ): Promise<UserRow> {
    const isSelf = actor.id === id;
    if (!isSelf && !actor.permissions.includes('users.manage')) {
      throw forbidden(
        'You can only change your own availability.',
        'Ask a workspace admin to change another member’s status.',
      );
    }

    const updated = await this.prisma.runInTransaction(async (tx) => {
      const before = await this.repository.findById(actor.workspaceId, id, tx);
      if (!before) {
        throw notFound('user');
      }
      const changed = await this.repository.updateAvailability(
        actor.workspaceId,
        id,
        availability,
        tx,
      );
      if (changed === 0) {
        throw notFound('user');
      }
      await this.audit.record(
        {
          workspaceId: actor.workspaceId,
          actorId: actor.id,
          actorLabel: actor.name,
          action: 'user.availability_changed',
          entityType: 'user',
          entityId: id,
          summary: `${actor.name !== before.name ? actor.name : 'The member'} set ${before.name} to ${availability}.`,
          before: { availability: before.availability },
          after: { availability },
          ip,
        },
        tx,
      );
      return (await this.repository.findById(actor.workspaceId, id, tx))!;
    });

    if (availability === 'ON_LEAVE' || availability === 'OFFLINE') {
      await this.leads.reassignPendingForUser(actor.workspaceId, id, ip);
    }
    return updated;
  }
}
