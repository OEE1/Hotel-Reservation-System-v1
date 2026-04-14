/**
 * ioredis（TCP）适配 RateLimitRedis；无原生模块，适用于自建 Redis。
 */
import Redis from "ioredis";
import type { RateLimitRedis } from "@/lib/redis/rateLimitRedis";

export function createIoredisRateLimit(redisUrl: string): RateLimitRedis {
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
  });

  return {
    async eval(script, keys, args) {
      const argv = args.map((a) => String(a));
      return client.eval(script, keys.length, ...keys, ...argv);
    },
  };
}
