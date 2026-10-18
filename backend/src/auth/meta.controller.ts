import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from './auth.decorators';
import { PERMISSIONS } from './permissions';

/** Static vocabularies the frontend renders (permission matrix, enums). */
@Controller('meta')
@SkipThrottle()
export class MetaController {
  @Public()
  @Get('permissions')
  permissions() {
    return { data: Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description, group: key.split('.')[0] })) };
  }

  @Public()
  @Get('enums')
  enums() {
    return {
      data: {
        baseLevels: ['OWNER', 'ADMIN', 'USER'],
        availability: ['AVAILABLE', 'BUSY', 'ON_LEAVE', 'OFFLINE'],
        leadSources: ['WEB_FORM', 'MESSAGE', 'MANUAL'],
        leadStatuses: ['NEW', 'ASSIGNED', 'ACKNOWLEDGED', 'CLOSED'],
        recoveryReasons: ['NONE', 'OVERDUE', 'ESCALATED_TWICE', 'IDLE'],
        customFieldTypes: ['TEXT', 'NUMBER', 'DATE', 'DROPDOWN', 'CHECKBOX'],
        customFieldEntities: ['CONTACT', 'COMPANY', 'OPPORTUNITY'],
        paymentStatuses: ['PENDING', 'PAID', 'EXPIRED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'],
        messageStatuses: ['QUEUED', 'SENT', 'DELIVERED', 'READ', 'UNDELIVERED', 'FAILED'],
        providers: ['TWILIO', 'LEMONSQUEEZY', 'GOOGLE', 'SLACK'],
      },
    };
  }
}
