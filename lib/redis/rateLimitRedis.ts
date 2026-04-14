/**
 * 限流专用 Redis 抽象：仅暴露 EVAL，便于 ioredis / Upstash 双实现。
 */
export interface RateLimitRedis {
  eval(
    script: string,
    keys: string[],
    args: (string | number)[],
  ): Promise<unknown>;
}
