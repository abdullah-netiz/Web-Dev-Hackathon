import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { CurrentUser, RequirePermission } from '../auth/auth.decorators';
import type { AuthContext } from '../auth/auth.types';
import { ALL_PERMISSIONS, type Permission } from '../auth/permissions';
import { zodDto } from '../common/zod-validation.pipe';
import { WorkspacesService } from './workspaces.service';

const permissionList = z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).max(50);

const SettingsDto = zodDto(
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
);

const InviteUserDto = zodDto(
  z.object({
    email: z.string().trim().email(),
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    baseLevel: z.enum(['ADMIN', 'USER']).optional(),
    roleId: z.string().uuid().nullable().optional(),
    timeZone: z.string().max(60).optional(),
  }),
);

const UpdateUserDto = zodDto(
  z.object({
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().min(1).max(60).optional(),
    baseLevel: z.enum(['ADMIN', 'USER']).optional(),
    roleId: z.string().uuid().nullable().optional(),
    maxOpenLeads: z.number().int().min(0).max(500).nullable().optional(),
    backupUserId: z.string().uuid().nullable().optional(),
    timeZone: z.string().max(60).optional(),
    version: z.number().int().positive().optional(),
  }),
);

const AvailabilityDto = zodDto(z.object({ availability: z.enum(['AVAILABLE', 'BUSY', 'ON_LEAVE', 'OFFLINE']) }));

const RoleDto = zodDto(z.object({ name: z.string().trim().min(2).max(40), description: z.string().max(200).optional(), permissions: permissionList }));
const UpdateRoleDto = zodDto(
  z.object({ name: z.string().trim().min(2).max(40).optional(), description: z.string().max(200).optional(), permissions: permissionList.optional(), version: z.number().int().positive().optional() }),
);

const ListUsersQuery = zodDto(z.object({ includeInactive: z.coerce.boolean().default(false) }));

@Controller()
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get('workspace')
  async workspace(@CurrentUser() auth: AuthContext) {
    return { data: await this.workspaces.get(auth.workspaceId) };
  }

  /** Lead-engine timers are part of settings so a demo can set them to seconds (F3.3–F3.7). */
  @Patch('workspace')
  @RequirePermission('settings.manage')
  async updateWorkspace(@CurrentUser() auth: AuthContext, @Body() body: InstanceType<typeof SettingsDto>) {
    return { data: await this.workspaces.updateSettings(auth, body) };
  }

  @Get('users')
  async users(@CurrentUser() auth: AuthContext, @Query() query: InstanceType<typeof ListUsersQuery>) {
    return { data: await this.workspaces.listUsers(auth.workspaceId, query.includeInactive) };
  }

  @Post('users')
  @RequirePermission('users.manage')
  async invite(@CurrentUser() auth: AuthContext, @Body() body: InstanceType<typeof InviteUserDto>) {
    return { data: await this.workspaces.inviteUser(auth, body) };
  }

  @Get('users/:id')
  async user(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return { data: await this.workspaces.getUser(auth.workspaceId, id) };
  }

  @Patch('users/:id')
  async updateUser(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: InstanceType<typeof UpdateUserDto>) {
    return { data: await this.workspaces.updateUser(auth, id === 'me' ? auth.userId : id, body) };
  }

  @Patch('users/:id/availability')
  async availability(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: InstanceType<typeof AvailabilityDto>) {
    return { data: await this.workspaces.setAvailability(auth, id === 'me' ? auth.userId : id, body.availability) };
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
  async createRole(@CurrentUser() auth: AuthContext, @Body() body: InstanceType<typeof RoleDto>) {
    return { data: await this.workspaces.createRole(auth, body) };
  }

  @Patch('roles/:id')
  @RequirePermission('roles.manage')
  async updateRole(@CurrentUser() auth: AuthContext, @Param('id') id: string, @Body() body: InstanceType<typeof UpdateRoleDto>) {
    return { data: await this.workspaces.updateRole(auth, id, body) };
  }

  @Delete('roles/:id')
  @RequirePermission('roles.manage')
  async deleteRole(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return { data: await this.workspaces.deleteRole(auth, id) };
  }
}
