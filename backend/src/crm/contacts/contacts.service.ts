import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import type { SessionUser } from '../../auth/types/session-user';
import { businessRule, notFound, versionConflict } from '../../common/http-errors';
import { keysetArgs, paginatedResponse, type ListQuery } from '../../common/pagination';
import { PrismaService } from '../../common/prisma.service';
import {
  ContactsRepository,
  type ContactRow,
  type ContactWriteData,
} from './contacts.repository';
import type { CreateContactInput, UpdateContactInput } from './dto/contact.dto';

@Injectable()
export class ContactsService {
  constructor(
    private readonly repository: ContactsRepository,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async list(workspaceId: string, query: ListQuery, companyId?: string) {
    const rows = await this.repository.list(workspaceId, {
      ...keysetArgs(query),
      search: query.q,
      companyId,
    });
    return paginatedResponse(rows, query.limit);
  }

  async get(workspaceId: string, id: string): Promise<ContactRow> {
    const contact = await this.repository.findById(workspaceId, id);
    if (!contact) {
      throw notFound('contact');
    }
    return contact;
  }

  async create(user: SessionUser, input: CreateContactInput, ip?: string): Promise<ContactRow> {
    return this.prisma.runInTransaction(async (tx) => {
      await this.assertReferences(user.workspaceId, input, tx);
      const contact = await this.repository.create(
        user.workspaceId,
        { ...toWriteData(input), firstName: input.firstName },
        tx,
      );
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorLabel: user.name,
          action: 'contact.created',
          entityType: 'contact',
          entityId: contact.id,
          summary: `Created contact ${displayName(contact)}.`,
          after: contact,
          ip,
        },
        tx,
      );
      return contact;
    });
  }

  async update(
    user: SessionUser,
    id: string,
    input: UpdateContactInput,
    ip?: string,
  ): Promise<ContactRow> {
    const { version, ...changes } = input;
    return this.prisma.runInTransaction(async (tx) => {
      const before = await this.repository.findById(user.workspaceId, id, tx);
      if (!before) {
        throw notFound('contact');
      }
      await this.assertReferences(user.workspaceId, changes, tx);
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
          action: 'contact.updated',
          entityType: 'contact',
          entityId: id,
          summary: `Updated contact ${displayName(after)}.`,
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
        throw notFound('contact');
      }
      await this.repository.delete(user.workspaceId, id, tx);
      await this.audit.record(
        {
          workspaceId: user.workspaceId,
          actorId: user.id,
          actorLabel: user.name,
          action: 'contact.deleted',
          entityType: 'contact',
          entityId: id,
          summary: `Deleted contact ${displayName(before)}.`,
          before,
          ip,
        },
        tx,
      );
    });
  }

  /** Referenced company/owner must belong to the same workspace, or a tenant could link across workspaces (Q2). */
  private async assertReferences(
    workspaceId: string,
    input: Partial<CreateContactInput>,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    if (input.companyId) {
      const company = await client.company.findFirst({
        where: { id: input.companyId, workspaceId },
        select: { id: true },
      });
      if (!company) {
        throw businessRule('That company does not exist in this workspace.', 'Pick a company from this workspace.');
      }
    }
    if (input.ownerId) {
      const owner = await client.user.findFirst({
        where: { id: input.ownerId, workspaceId },
        select: { id: true },
      });
      if (!owner) {
        throw businessRule('That owner does not exist in this workspace.', 'Pick an owner from this workspace.');
      }
    }
  }
}

function displayName(contact: ContactRow): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ');
}

function toWriteData(input: Partial<CreateContactInput>): ContactWriteData {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    companyId: input.companyId,
    ownerId: input.ownerId,
    optedOut: input.optedOut,
    tags: input.tags,
    custom: input.custom as Prisma.InputJsonValue | undefined,
  };
}
