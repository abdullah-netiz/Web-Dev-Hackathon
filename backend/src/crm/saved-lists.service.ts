import { Injectable, NotFoundException } from '@nestjs/common';
import type { CustomFieldEntity, Prisma } from '@prisma/client';

import type { AuthContext } from '../auth/auth.types';
import { DomainError } from '../common/http-exception.filter';
import { PrismaService } from '../common/prisma.service';
import type { Filters } from './list-filters';

/** Saved lists store criteria, never results, so they stay current automatically (F2.6). */
@Injectable()
export class SavedListsService {
  constructor(private readonly prisma: PrismaService) {}

  list(auth: AuthContext, entity?: CustomFieldEntity) {
    return this.prisma.savedList.findMany({
      where: { workspaceId: auth.workspaceId, ...(entity ? { entity } : {}), OR: [{ isShared: true }, { ownerId: auth.userId }] },
      include: { owner: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(auth: AuthContext, id: string) {
    const list = await this.prisma.savedList.findFirst({ where: { id, workspaceId: auth.workspaceId, OR: [{ isShared: true }, { ownerId: auth.userId }] } });
    if (!list) throw new NotFoundException({ code: 'LIST_NOT_FOUND', message: 'Saved list not found.' });
    return { ...list, filters: list.filters as Filters };
  }

  create(auth: AuthContext, input: { entity: CustomFieldEntity; name: string; filters: Filters; isShared?: boolean }) {
    if (input.filters.criteria.length === 0 && !input.filters.search) throw new DomainError('EMPTY_FILTERS', 'Add at least one criterion before saving a list.', 422);
    return this.prisma.savedList.create({ data: { workspaceId: auth.workspaceId, ownerId: auth.userId, entity: input.entity, name: input.name, filters: input.filters as Prisma.InputJsonValue, isShared: input.isShared ?? true } });
  }

  async update(auth: AuthContext, id: string, input: Partial<{ name: string; filters: Filters; isShared: boolean; version: number }>) {
    const existing = await this.get(auth, id);
    if (existing.ownerId !== auth.userId && auth.baseLevel === 'USER') throw new DomainError('PERMISSION_DENIED', 'Only the list owner can edit it.', 403);
    const { version, filters, ...data } = input;
    const result = await this.prisma.savedList.updateMany({ where: { id, workspaceId: auth.workspaceId, ...(version ? { version } : {}) }, data: { ...data, ...(filters ? { filters: filters as Prisma.InputJsonValue } : {}), version: { increment: 1 } } });
    if (result.count === 0) throw new DomainError('VERSION_CONFLICT', 'This list was changed by someone else. Reload and try again.', 409);
    return this.get(auth, id);
  }

  async delete(auth: AuthContext, id: string) {
    const existing = await this.get(auth, id);
    if (existing.ownerId !== auth.userId && auth.baseLevel === 'USER') throw new DomainError('PERMISSION_DENIED', 'Only the list owner can delete it.', 403);
    await this.prisma.savedList.delete({ where: { id } });
    return { deleted: true };
  }
}
