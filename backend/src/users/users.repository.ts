import { Injectable } from '@nestjs/common';
import type { Availability, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

const USER_SELECT = {
  id: true,
  workspaceId: true,
  email: true,
  name: true,
  baseLevel: true,
  availability: true,
  isActive: true,
  telegramChatId: true,
  lastAssignedAt: true,
  version: true,
  role: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

export type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

export interface UserListArgs {
  availability?: Availability;
  roleId?: string;
  q?: string;
  take: number;
  skip?: number;
  cursor?: { id: string };
}

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, args: UserListArgs): Promise<UserRow[]> {
    return this.prisma.user.findMany({
      where: {
        workspaceId,
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
      select: USER_SELECT,
    });
  }

  async findById(
    workspaceId: string,
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<UserRow | null> {
    return (tx ?? this.prisma).user.findFirst({ where: { id, workspaceId }, select: USER_SELECT });
  }

  async updateAvailability(
    workspaceId: string,
    id: string,
    availability: Availability,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await (tx ?? this.prisma).user.updateMany({
      where: { id, workspaceId },
      data: { availability, version: { increment: 1 } },
    });
    return result.count;
  }
}
