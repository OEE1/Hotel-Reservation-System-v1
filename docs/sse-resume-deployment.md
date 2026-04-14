# SSE 断点续传与部署说明

## 当前实现（进程内 `Map`）

- 流会话与事件缓冲保存在**单 Node 进程内存**中（见 `lib/sseServer/streamSession.ts`）。
- **适用**：单机长时间运行的 Node 服务、本地开发。
- **不适用**：多副本负载均衡、Serverless 冷启动、滚动发布——续传请求可能落到**无该会话**的实例上，表现为 `Session expired`（404）或无法续传。

## 若需多实例 / Serverless 可靠续传

1. **共享缓冲**：将 `streamId` 对应的元数据（`guestId`、`status`、`seq`）与按序事件（或预渲染 SSE 字符串）写入 **Redis**（或兼容的 KV / 队列）。
2. **跟随新事件**：`replayAndFollow` 从「轮询内存」改为 **Redis Streams / List + pub/sub** 或短轮询 Redis，避免依赖本机 `session.events`。
3. **TTL**：与产品一致（例如流结束后 10–30 分钟删除 key），控制成本与隐私。

## 产品层降级（不引入 Redis 时）

- 在 README 或界面说明：**续传仅在单实例、会话未过期时可用**。
- 对 404 / 会话过期给出明确文案，引导用户**重新发送**。

## 与「消息持久化」的关系

- 续传缓冲解决的是**传输层**同一次生成未传完的问题。
- **整段聊天记录**跨刷新仍存在需 **DB 或浏览器 localStorage**，不在本缓冲范围内。
