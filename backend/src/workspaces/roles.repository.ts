import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

const ROLE_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  permissions: true,
  isSystem: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { users: true } },
} satisfies Prisma.RoleSelect;

export type RoleRow = Prisma.RoleGetPayload<{ select: typeof ROLE_SELECT }>;

@Injectable()
export class RolesRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(workspaceId: string, tx?: Prisma.TransactionClient): Promise<RoleRow[]> {
    return (tx ?? this.prisma).role.findMany({
      where: { workspaceId },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: ROLE_SELECT,
    });
  }

  findById(
    workspaceId: string,
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<RoleRow | null> {
    return (tx ?? this.prisma).role.findFirst({ where: { id, workspaceId }, select: ROLE_SELECT });
  }

  findByName(
    workspaceId: string,
    name: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string } | null> {
    return (tx ?? this.prisma).role.findFirst({
      where: { workspaceId, name },
      select: { id: true },
    });
  }

  create(
    data: Prisma.RoleUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    return (tx ?? this.prisma).role.create({ data, select: { id: true } });
  }

  async updateWithVersion(
    workspaceId: string,
    id: string,
    version: number,
    data: Prisma.RoleUpdateManyMutationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await (tx ?? this.prisma).role.updateMany({
      where: { id, workspaceId, version },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count;
  }

  async countUsers(
    workspaceId: string,
    roleId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    return (tx ?? this.prisma).user.count({ where: { workspaceId, roleId } });
  }

  async remove(workspaceId: string, id: string, tx?: Prisma.TransactionClient): Promise<number> {
    const result = await (tx ?? this.prisma).role.deleteMany({ where: { id, workspaceId } });
    return result.count;
  }
}
