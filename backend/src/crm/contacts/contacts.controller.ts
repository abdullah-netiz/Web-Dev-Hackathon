import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import type { AuthenticatedRequest, SessionUser } from '../../auth/types/session-user';
import { listQuerySchema, type ListQuery } from '../../common/pagination';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { idParamSchema, optionalString } from '../../common/zod';
import { ContactsService } from './contacts.service';
import {
  createContactSchema,
  updateContactSchema,
  type CreateContactInput,
  type UpdateContactInput,
} from './dto/contact.dto';

const listContactsSchema = listQuerySchema.extend({ companyId: optionalString(40) });

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequirePermission('crm.view')
  list(
    @CurrentUser() user: SessionUser,
    @Query(new ZodValidationPipe(listContactsSchema))
    query: ListQuery & { companyId?: string },
  ) {
    return this.contacts.list(user.workspaceId, query, query.companyId);
  }

  @Get(':id')
  @RequirePermission('crm.view')
  async get(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
  ) {
    return { data: await this.contacts.get(user.workspaceId, params.id) };
  }

  @Post()
  @RequirePermission('crm.create')
  async create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(createContactSchema)) body: CreateContactInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.contacts.create(user, body, request.ip) };
  }

  @Patch(':id')
  @RequirePermission('crm.edit')
  async update(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updateContactSchema)) body: UpdateContactInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return { data: await this.contacts.update(user, params.id, body, request.ip) };
  }

  @Delete(':id')
  @RequirePermission('crm.delete')
  @HttpCode(200)
  async remove(
    @CurrentUser() user: SessionUser,
    @Param(new ZodValidationPipe(idParamSchema)) params: { id: string },
    @Req() request: AuthenticatedRequest,
  ) {
    await this.contacts.remove(user, params.id, request.ip);
    return { data: { ok: true } };
  }
}
