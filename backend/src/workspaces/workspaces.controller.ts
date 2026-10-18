import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser, RequirePermission } from '../auth/auth.decorators';
import { hasPermission, type AuthContext } from '../auth/auth.types';
import { ALL_PERMISSIONS, type Permission } from '../auth/permissions';
import { zodDto } from '../common/zod-validation.pipe';
import { WorkspacesService } from './workspaces.service';

const permissionList = z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).max(50);

class SettingsDto extends zodDto(
  z.object({
    name: z.string().trim().min(2).max(80).optional(),
    currency: z.string().length(3).toUpperCase().optional(),
    timeZone: z.string().max(60).optional(),
    ackWindowSec: z.number().int().min(5).max(86_400).optional(),
    escalationLevels: z.number().int().min(1).max(5).optional(),
    levelWindowSec: z.number().int().min(5).max(86_400).optional(),
    idleSec: z.number().int().min(10).max(30 * 86_400).optional(),
    maxOpenLeadsDefault: z.number().int().min(1).max(500).optional(),
    acknowledgedLeadsOnAbsence: z.enum(['KEEP', 'REASSIGN']).optional(),
  }),
) {}

class InviteUserDto extends zodDto(
  z.object({
    email: z.string().trim().email(),
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    baseLevel: z.enum(['ADMIN', 'USER']).optional(),
    roleId: z.string().uuid().nullable().optional(),
    timeZone: z.string().max(60).optional(),
  }),
) {}

class UpdateUserDto extends zodDto(
  z.object({
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().min(1).max(60).optional(),
    baseLevel: z.enum(['ADMIN', 'USER']).optional(),
    roleId: z.string().uuid().nullable().optional(),
    maxOpenLeads: z.number().int().min(0).max(500).nullable().optional(),
    isEscalationManager: z.boolean().optional(),
    backupUserId: z.string().uuid().nullable().optional(),
    timeZone: z.string().max(60).optional(),
    version: z.number().int().positive().optional(),
  }),
) {}

class AvailabilityDto extends zodDto(z.object({ availability: z.enum(['AVAILABLE', 'BUSY', 'ON_LEAVE', 'OFFLINE']) })) {}

class RoleDto extends zodDto(z.object({ name: z.string().trim().min(2).max(40), description: z.string().max(200).optional(), permissions: permissionList })) {}
class UpdateRoleDto extends zodDto(
  z.object({ name: z.string().trim().min(2).max(40).optional(), description: z.string().max(200).optional(), permissions: permissionList.optional(), version: z.number().int().positive().optional() }),
) {}

class ListUsersQuery extends zodDto(z.object({ includeInactive: z.coerce.boolean().default(false) })) {}

@Controller()
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get('workspace')
  async workspace(@CurrentUser() auth: AuthContext) {
    return { data: await this.workspaces.get(auth.workspaceId) };
  }

  /** Lead-engine timers are part of settings so a demo can set them to seconds (F3.3–F3.7). */
  @Patch('workspace')
  async updateWorkspace(@CurrentUser() auth: AuthContext, @Body() body: SettingsDto) {
    // Assignment timers need leads.manage_rules; name, currency and time zone need settings.manage (F1.3)
    const ruleKeys = ['ackWindowSec', 'escalationLevels', 'levelWindowSec', 'idleSec', 'maxOpenLeadsDefault', 'acknowledgedLeadsOnAbsence'];
    const keys = Object.keys(body).filter((key) => (body as Record<string, unknown>)[key] !== undefined);
    const needsRules = keys.some((key) => ruleKeys.includes(key));
    const needsSettings = keys.some((key) => !ruleKeys.includes(key));
    if ((needsRules && !hasPermission(auth, 'leads.manage_rules')) || (needsSettings && !hasPermission(auth, 'settings.manage'))) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: needsRules ? 'You do not have permission to change assignment rules (leads.manage_rules).' : 'You do not have permission to change workspace settings (settings.manage).', action: 'Ask an Owner or Admin to grant the permission.' });
    }
    return { data: await this.workspaces.updateSettings(auth, body) };
  }

  @Get('users')
  async users(@CurrentUser() auth: AuthContext, @Query() query: ListUsersQuery) {
    return { data: await this.workspaces.listUsers(auth.workspaceId, query.includeInactive) };
  }

  @Post('users')
  @RequirePermission('users.manage')
  async invite(@CurrentUser() auth: AuthContext, @Body() body: InviteUserDto) {
    return { data: await this.workspaces.inviteUser(auth, body) };
  }

  @Get('users/:id')
  async user(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return { data: await this.workspaces.view(auth.workspaceId, id === 'me' ? auth.userId : id) };
  }

  @Patch('users/:id')
  async updateUser(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: UpdateUserDto) {
    const userId = id === 'me' ? auth.userId : id;
    await this.workspaces.updateUser(auth, userId, body);
    return { data: await this.workspaces.view(auth.workspaceId, userId) };
  }

  @Patch('users/:id/availability')
  async availability(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: AvailabilityDto) {
    const userId = id === 'me' ? auth.userId : id;
    await this.workspaces.setAvailability(auth, userId, body.availability);
    return { data: await this.workspaces.view(auth.workspaceId, userId) };
  }

  @Post('users/:id/reactivate')
  @RequirePermission('users.manage')
  async reactivate(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    await this.workspaces.reactivateUser(auth, id);
    return { data: await this.workspaces.view(auth.workspaceId, id) };
  }

  @Delete('users/:id')
  @RequirePermission('users.manage')
  async deactivate(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return { data: await this.workspaces.deactivateUser(auth, id) };
  }

  @Get('roles')
  async roles(@CurrentUser() auth: AuthContext) {
    return { data: await this.workspaces.listRoles(auth.workspaceId) };
  }

  @Post('roles')
  @RequirePermission('roles.manage')
  async createRole(@CurrentUser() auth: AuthContext, @Body() body: RoleDto) {
    return { data: await this.workspaces.createRole(auth, body) };
  }

  @Patch('roles/:id')
  @RequirePermission('roles.manage')
  async updateRole(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: UpdateRoleDto) {
    return { data: await this.workspaces.updateRole(auth, id, body) };
  }

  @Delete('roles/:id')
  @RequirePermission('roles.manage')
  async deleteRole(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return { data: await this.workspaces.deleteRole(auth, id) };
  }
}
