import { Injectable } from '@nestjs/common';
import type { Availability, BaseLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

const MEMBER_SELECT = {
  id: true,
  workspaceId: true,
  email: true,
  name: true,
  baseLevel: true,
  roleId: true,
  availability: true,
  telegramChatId: true,
  isActive: true,
  lastAssignedAt: true,
  version: true,
  createdAt: true,
  role: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

export type MemberRow = Prisma.UserGetPayload<{ select: typeof MEMBER_SELECT }>;

export interface MemberListArgs {
  take: number;
  skip?: number;
  cursor?: { id: string };
  q?: string;
  baseLevel?: BaseLevel;
  availability?: Availability;
  roleId?: string;
  includeInactive: boolean;
}

@Injectable()
export class MembersRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(workspaceId: string, args: MemberListArgs): Promise<MemberRow[]> {
    return this.prisma.user.findMany({
      where: {
        workspaceId,
        ...(args.includeInactive ? {} : { isActive: true }),
        ...(args.baseLevel ? { baseLevel: args.baseLevel } : {}),
        ...(args.availability ? { availability: args.availability } : {}),
        ...(args.roleId ? { roleId: args.roleId } : {}),
        ...(args.q
          ? {
              OR: [
                { name: { contains: args.q, mode: 'insensitive' } },
                { email: { contains: args.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: args.take,
      skip: args.skip,
      cursor: args.cursor,
      select: MEMBER_SELECT,
    });
  }

  findById(
    workspaceId: string,
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<MemberRow | null> {
    return (tx ?? this.prisma).user.findFirst({
      where: { id, workspaceId },
      select: MEMBER_SELECT,
    });
  }

  findByEmail(email: string): Promise<{ id: string; workspaceId: string } | null> {
    return this.prisma.user.findUnique({ where: { email }, select: { id: true, workspaceId: true } });
  }

  create(data: Prisma.UserUncheckedCreateInput, tx?: Prisma.TransactionClient): Promise<MemberRow> {
    return (tx ?? this.prisma).user.create({ data, select: MEMBER_SELECT });
  }

  async updateWithVersion(
    workspaceId: string,
    id: string,
    version: number,
    data: Prisma.UserUncheckedUpdateManyInput,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await (tx ?? this.prisma).user.updateMany({
      where: { id, workspaceId, version },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count;
  }

  countActiveOwners(
    workspaceId: string,
    excludeId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    return (tx ?? this.prisma).user.count({
      where: {
        workspaceId,
        baseLevel: 'OWNER',
        isActive: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }
}
