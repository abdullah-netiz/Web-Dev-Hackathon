import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

const CONTACT_SELECT = {
  id: true,
  workspaceId: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  companyId: true,
  ownerId: true,
  optedOut: true,
  tags: true,
  custom: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  company: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
} satisfies Prisma.ContactSelect;

export type ContactRow = Prisma.ContactGetPayload<{ select: typeof CONTACT_SELECT }>;

export interface ContactListArgs {
  take: number;
  skip?: number;
  cursor?: { id: string };
  search?: string;
  companyId?: string;
}

export interface ContactWriteData {
  firstName?: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyId?: string | null;
  ownerId?: string | null;
  optedOut?: boolean;
  tags?: string[];
  custom?: Prisma.InputJsonValue;
}

@Injectable()
export class ContactsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, args: ContactListArgs): Promise<ContactRow[]> {
    return this.prisma.contact.findMany({
      where: {
        workspaceId,
        ...(args.companyId ? { companyId: args.companyId } : {}),
        ...(args.search
          ? {
              OR: [
                { firstName: { contains: args.search, mode: 'insensitive' } },
                { lastName: { contains: args.search, mode: 'insensitive' } },
                { email: { contains: args.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: args.take,
      skip: args.skip,
      cursor: args.cursor,
      select: CONTACT_SELECT,
    });
  }

  async findById(
    workspaceId: string,
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ContactRow | null> {
    return (tx ?? this.prisma).contact.findFirst({
      where: { id, workspaceId },
      select: CONTACT_SELECT,
    });
  }

  async create(
    workspaceId: string,
    data: ContactWriteData & { firstName: string },
    tx?: Prisma.TransactionClient,
  ): Promise<ContactRow> {
    const { id } = await (tx ?? this.prisma).contact.create({
      data: { ...data, workspaceId },
      select: { id: true },
    });
    return (await this.findById(workspaceId, id, tx))!;
  }

  async updateWithVersion(
    workspaceId: string,
    id: string,
    version: number,
    data: ContactWriteData,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await (tx ?? this.prisma).contact.updateMany({
      where: { id, workspaceId, version },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count;
  }

  async delete(workspaceId: string, id: string, tx?: Prisma.TransactionClient): Promise<number> {
    const result = await (tx ?? this.prisma).contact.deleteMany({ where: { id, workspaceId } });
    return result.count;
  }
}
