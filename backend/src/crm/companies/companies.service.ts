import { Injectable } from '@nestjs/common';
import type { Company, Prisma } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { notFound, versionConflict } from '../../common/http-errors';
import { keysetArgs, paginatedResponse, type ListQuery } from '../../common/pagination';
import { PrismaService } from '../../common/prisma.service';
import type { SessionUser } from '../../auth/types/session-user';
import { CompaniesRepository, type CompanyWriteData } from './companies.repository';
import type { CreateCompanyInput, UpdateCompanyInput } from './dto/company.dto';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly repository: CompaniesRepository,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async list(workspaceId: string, query: ListQuery) {
    const rows = await this.repository.list(workspaceId, {
      ...keysetArgs(query),
      search: query.q,
    });
    return paginatedResponse(rows, query.limit);
  }

  async get(workspaceId: string, id: string): Promise<Company> {
    const company = await this.repository.findById(workspaceId, id);
    if (!company) {
      throw notFound('company');
    }
    return company;
  }

  async create(user: SessionUser, input: CreateCompanyInput, ip?: string): Promise<Company> {
    return this.prisma.runInTransaction(async (tx) => {
      const company = await this.repository.create(
        user.workspaceId,
        { ...toWriteData(input), name: input.name },
        tx,
      );
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorLabel: user.name,
          action: 'company.created',
          entityType: 'company',
          entityId: company.id,
          summary: `Created company "${company.name}".`,
          after: company,
          ip,
        },
        tx,
      );
      return company;
    });
  }

  async update(
    user: SessionUser,
    id: string,
    input: UpdateCompanyInput,
    ip?: string,
  ): Promise<Company> {
    const { version, ...changes } = input;
    return this.prisma.runInTransaction(async (tx) => {
      const before = await this.repository.findById(user.workspaceId, id, tx);
      if (!before) {
        throw notFound('company');
      }
      const changed = await this.repository.updateWithVersion(
        user.workspaceId,
        id,
        version,
        toWriteData(changes),
        tx,
      );
      if (changed === 0) {
        throw versionConflict();
      }
      const after = (await this.repository.findById(user.workspaceId, id, tx))!;
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorLabel: user.name,
          action: 'company.updated',
          entityType: 'company',
          entityId: id,
          summary: `Updated company "${after.name}".`,
          before,
          after,
          ip,
        },
        tx,
      );
      return after;
    });
  }

  async remove(user: SessionUser, id: string, ip?: string): Promise<void> {
    await this.prisma.runInTransaction(async (tx) => {
      const before = await this.repository.findById(user.workspaceId, id, tx);
      if (!before) {
        throw notFound('company');
      }
      await this.repository.delete(user.workspaceId, id, tx);
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorLabel: user.name,
          action: 'company.deleted',
          entityType: 'company',
          entityId: id,
          summary: `Deleted company "${before.name}".`,
          before,
          ip,
        },
        tx,
      );
    });
  }
}

function toWriteData(input: Partial<CreateCompanyInput>): CompanyWriteData {
  return {
    name: input.name,
    domain: input.domain,
    phone: input.phone,
    address: input.address,
    notes: input.notes,
    tags: input.tags,
    custom: input.custom as Prisma.InputJsonValue | undefined,
  };
}
