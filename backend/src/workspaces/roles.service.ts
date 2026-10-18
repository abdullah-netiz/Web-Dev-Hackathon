import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { SessionUser } from '../auth/types/session-user';
import { businessRule, notFound, versionConflict } from '../common/http-errors';
import { PrismaService } from '../common/prisma.service';
import type { CreateRoleInput, UpdateRoleInput } from './dto/role.dto';
import { RolesRepository } from './roles.repository';

@Injectable()
export class RolesService {
  constructor(
    private readonly repository: RolesRepository,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(workspaceId: string) {
    return this.repository.list(workspaceId);
  }

  async create(actor: SessionUser, input: CreateRoleInput, ip?: string) {
    const duplicate = await this.repository.findByName(actor.workspaceId, input.name);
    if (duplicate) {
      throw businessRule(
        'A role with that name already exists.',
        'Choose a different role name.',
      );
    }
    return this.prisma.runInTransaction(async (tx) => {
      const { id } = await this.repository.create(
        {
          workspaceId: actor.workspaceId,
          name: input.name,
          permissions: input.permissions,
          isSystem: false,
        },
        tx,
      );
      await this.audit.record(
        {
          workspaceId: actor.workspaceId,
          actorId: actor.id,
          actorLabel: actor.name,
          action: 'role.created',
          entityType: 'role',
          entityId: id,
          summary: `${actor.name} created the role "${input.name}".`,
          after: { name: input.name, permissions: input.permissions },
          ip,
        },
        tx,
      );
      return (await this.repository.findById(actor.workspaceId, id, tx))!;
    });
  }

  async update(actor: SessionUser, id: string, input: UpdateRoleInput, ip?: string) {
    return this.prisma.runInTransaction(async (tx) => {
      const role = await this.repository.findById(actor.workspaceId, id, tx);
      if (!role) {
        throw notFound('role');
      }
      if (role.isSystem && input.name && input.name !== role.name) {
        throw businessRule(
          'Built-in roles cannot be renamed.',
          'Create a new role with the name you need.',
        );
      }
      if (input.name && input.name !== role.name) {
        const duplicate = await this.repository.findByName(actor.workspaceId, input.name, tx);
        if (duplicate && duplicate.id !== id) {
          throw businessRule('A role with that name already exists.', 'Choose a different role name.');
        }
      }

      const data: Prisma.RoleUpdateManyMutationInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.permissions !== undefined) data.permissions = input.permissions;

      const changed = await this.repository.updateWithVersion(
        actor.workspaceId,
        id,
        input.version,
        data,
        tx,
      );
      if (changed === 0) {
        throw versionConflict();
      }
      const after = await this.repository.findById(actor.workspaceId, id, tx);
      await this.audit.record(
        {
          workspaceId: actor.workspaceId,
          actorId: actor.id,
          actorLabel: actor.name,
          action: 'role.updated',
          entityType: 'role',
          entityId: id,
          summary: `${actor.name} updated the role "${role.name}".`,
          before: { name: role.name, permissions: role.permissions },
          after: { name: after?.name, permissions: after?.permissions },
          ip,
        },
        tx,
      );
      return after!;
    });
  }

  async remove(actor: SessionUser, id: string, ip?: string) {
    return this.prisma.runInTransaction(async (tx) => {
      const role = await this.repository.findById(actor.workspaceId, id, tx);
      if (!role) {
        throw notFound('role');
      }
      if (role.isSystem) {
        throw businessRule(
          'Built-in roles cannot be deleted.',
          'Edit its permissions instead.',
        );
      }
      const assigned = await this.repository.countUsers(actor.workspaceId, id, tx);
      if (assigned > 0) {
        throw businessRule(
          'This role is still assigned to members.',
          'Reassign those members to another role first.',
        );
      }
      await this.repository.remove(actor.workspaceId, id, tx);
      await this.audit.record(
        {
          workspaceId: actor.workspaceId,
          actorId: actor.id,
          actorLabel: actor.name,
          action: 'role.deleted',
          entityType: 'role',
          entityId: id,
          summary: `${actor.name} deleted the role "${role.name}".`,
          before: { name: role.name, permissions: role.permissions },
          ip,
        },
        tx,
      );
      return { id, deleted: true };
    });
  }
}
