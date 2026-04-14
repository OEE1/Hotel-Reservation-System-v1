/**
 * Upstash REST Redis 适配 RateLimitRedis；适合 Serverless / 边缘无长连接场景。
 */
import { Redis } from "@upstash/redis";
import type { RateLimitRedis } from "@/lib/redis/rateLimitRedis";

export function createUpstashRateLimit(
  restUrl: string,
  restToken: string,
): RateLimitRedis {
  const client = new Redis({ url: restUrl, token: restToken });

  return {
    async eval(script, keys, args) {
      const argv = args.map((a) => String(a));
      return client.eval(script, keys, argv);
    },
  };
}
