import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';

import { ENV, type Env } from '../common/env';
import { DEFAULT_JOB_OPTIONS, QUEUES } from './queues';

// Each registerQueue() is a dynamic module carrying the `BullQueue_<name>` provider; exporting those
// modules (not the BullModule class) is what makes @InjectQueue work in other modules.
const queueModules = Object.values(QUEUES).map((name) => BullModule.registerQueue({ name }));

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        // maxRetriesPerRequest: null is required by BullMQ workers (docs.bullmq.io/guide/connections)
        connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
    ...queueModules,
  ],
  exports: queueModules,
})
export class JobsModule {}
