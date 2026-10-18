import { z } from 'zod';
import { listQuerySchema } from '../../common/pagination';
import { optionalString } from '../../common/zod';
import { availabilitySchema, updateAvailabilitySchema } from '../../leads/dto/lead.dto';

export const listUsersSchema = listQuerySchema.extend({
  availability: availabilitySchema.optional(),
  roleId: optionalString(40),
});

export { updateAvailabilitySchema };
export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;
