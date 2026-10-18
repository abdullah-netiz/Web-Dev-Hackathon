import { Injectable } from '@nestjs/common';
import type { Company, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export interface CompanyListArgs {
  take: number;
  skip?: number;
  cursor?: { id: string };
  search?: string;
}

export interface CompanyWriteData {
  name?: string;
  domain?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  tags?: string[];
  custom?: Prisma.InputJsonValue;
}

@Injectable()
export class CompaniesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, args: CompanyListArgs): Promise<Company[]> {
    return this.prisma.company.findMany({
      where: {
        workspaceId,
        ...(args.search ? { name: { contains: args.search, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
      take: args.take,
      skip: args.skip,
      cursor: args.cursor,
    });
  }

  async findById(
    workspaceId: string,
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Company | null> {
    return (tx ?? this.prisma).company.findFirst({ where: { id, workspaceId } });
  }

  async create(
    workspaceId: string,
    data: CompanyWriteData & { name: string },
    tx?: Prisma.TransactionClient,
  ): Promise<Company> {
    return (tx ?? this.prisma).company.create({ data: { ...data, workspaceId } });
  }

  /** Returns the number of rows changed; 0 means someone else bumped the version (Q4). */
  async updateWithVersion(
    workspaceId: string,
    id: string,
    version: number,
    data: CompanyWriteData,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const result = await (tx ?? this.prisma).company.updateMany({
      where: { id, workspaceId, version },
      data: { ...data, version: { increment: 1 } },
    });
    return result.count;
  }

  async delete(workspaceId: string, id: string, tx?: Prisma.TransactionClient): Promise<number> {
    const result = await (tx ?? this.prisma).company.deleteMany({ where: { id, workspaceId } });
    return result.count;
  }
}
