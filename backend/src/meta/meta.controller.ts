import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { PERMISSIONS } from '../common/permissions';

/** Serves the permission catalogue so the frontend renders the same keys the API enforces (F1.2). */
@Public()
@Controller('meta')
export class MetaController {
  @Get('permissions')
  permissions(): { data: typeof PERMISSIONS } {
    return { data: PERMISSIONS };
  }
}
