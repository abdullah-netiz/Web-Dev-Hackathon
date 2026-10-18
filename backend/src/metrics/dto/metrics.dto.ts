import { z } from 'zod';
import { optionalString } from '../../common/zod';
import { WIDGET_KEYS } from '../definitions';

export const dashboardQuerySchema = z.object({ widgets: optionalString(1000) });

export const saveDashboardPrefsSchema = z.object({
  widgets: z
    .array(z.string().min(1).max(40))
    .max(50)
    .transform((keys) => keys.filter((key) => WIDGET_KEYS.includes(key))),
});

export type SaveDashboardPrefsInput = z.infer<typeof saveDashboardPrefsSchema>;
