import type { ConnectionOptions } from 'bullmq';

/**
 * BullMQ wants discrete connection options rather than a URL string.
 * `maxRetriesPerRequest: null` is required so blocking commands survive (Q5).
 */
export function redisConnectionFromUrl(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  const database = url.pathname.replace(/^\//, '');

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    db: database ? Number(database) : 0,
    maxRetriesPerRequest: null,
  };
}
