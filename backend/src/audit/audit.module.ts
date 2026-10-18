import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

/**
 * Global so any feature module can inject AuditService and write an audit row
 * inside its own transaction (§4.3). Audit has no update or delete route.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditRepository],
  exports: [AuditService],
})
export class AuditModule {}
