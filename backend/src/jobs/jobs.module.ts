import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { redisConnectionFromUrl } from './redis';

/**
 * Root BullMQ wiring. Queues are registered by feature modules; this module only
 * establishes the Redis connection so delayed jobs (escalations, I5.5 retries)
 * survive restarts (Q5).
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: redisConnectionFromUrl(config.getOrThrow<string>('REDIS_URL')),
      }),
    }),
  ],
})
export class JobsModule {}
