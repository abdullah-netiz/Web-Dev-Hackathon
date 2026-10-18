import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LeadsModule } from '../leads/leads.module';
import { MembersController } from './members.controller';
import { MembersRepository } from './members.repository';
import { MembersService } from './members.service';
import { RolesController } from './roles.controller';
import { RolesRepository } from './roles.repository';
import { RolesService } from './roles.service';
import { SignupController } from './signup.controller';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceRepository } from './workspace.repository';
import { WorkspaceService } from './workspace.service';

@Module({
  imports: [AuthModule, LeadsModule],
  controllers: [SignupController, WorkspaceController, MembersController, RolesController],
  providers: [
    WorkspaceService,
    WorkspaceRepository,
    MembersService,
    MembersRepository,
    RolesService,
    RolesRepository,
  ],
  exports: [WorkspaceService],
})
export class WorkspacesModule {}
