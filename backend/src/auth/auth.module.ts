import { Global, Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { MetaController } from './meta.controller';

@Global()
@Module({
  imports: [AuditModule],
  controllers: [AuthController, MetaController],
  providers: [AuthService, AuthGuard],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
