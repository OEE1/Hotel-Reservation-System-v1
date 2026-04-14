# Hotel-Reservation-System

基于 **Next.js** 构建的酒店展示与预订系统，面向酒店客户，提供完整的房源展示、房间详情、日期选择与在线预订、订单管理及用户认证等核心功能。系统集成酒店 **AI 智能助手**，支持流式对话交互，用户可通过自然语言完成查房、预订及订单管理操作。AI 助手配套可视化工具卡片，展示思考过程，具备会话管理与中断恢复能力，保障对话体验连续可靠。

## 功能特性

- **小屋浏览与详情：**
  支持多条件列表筛选与排序，详情页展示完整房型信息。
- **预订管理：**
  支持日历式日期选择，提供预订创建、查看、编辑与取消等完整操作流程。
- **账户系统：**
  基于 GitHub OAuth 实现一键登录，用户可管理个人资料与历史预订记录。
- **AI 智能助手**
  - 支持自然语言对话，可完成查房、预订及订单管理等多种操作
  - 流式对话响应，交互更流畅自然
  - 配套工具卡片，实时展示助手的思考过程
  - 具备会话管理与中断恢复能力，对话可随时继续



## 技术栈

| 类别 | 技术 |
|------|------|
| 运行时 | Node.js（建议 ≥ 18） |
| 框架 | Next.js 14、React 18 |
| 语言 | JavaScript / TypeScript |
| 样式 | Tailwind CSS |
| 数据 | Supabase（PostgreSQL + 客户端 SDK） |
| 认证 | NextAuth.js v5（GitHub Provider） |
| AI | DeepSeek API（通过 `DEEPSEEK_API_KEY`） |
| 缓存 / 限流 / 会话 | Redis（`ioredis` 或 Upstash REST）、内存回退 |
| 状态与工具 | Zustand、Immer、date-fns、react-markdown 等 |

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) ≥ 18
- npm、pnpm 或 yarn
- Supabase 项目与 GitHub OAuth 应用（用于登录）
- （可选）Redis 或 Upstash，用于聊天限流与会话存储的生产级部署
- （可选）DeepSeek API 密钥，用于 AI 聊天

### 安装依赖

```bash
npm install
```

### 配置环境变量

在项目根目录创建 `.env.local`，至少配置「认证 + 数据库」；聊天与 Redis 相关项按部署需要添加。变量说明见下文 [环境变量](#环境变量)。

### 运行开发服务器

```bash
npm run dev
```

在浏览器中打开 [http://localhost:3000](http://localhost:3000)。

### 生产构建与启动

```bash
npm run build
npm start
```

## 项目结构

```
├── app/                    # App Router：页面与路由
│   ├── api/                # Route Handlers（auth、chat、cabins 等）
│   ├── account/            # 账户、预订、资料
│   ├── cabins/             # 小屋列表、详情、感谢页
│   ├── login/              # 登录页
│   └── ...
├── components/             # UI 与业务组件（含 chat/、reservations/ 等）
├── lib/                    # 数据服务、认证、聊天、SSE、Redis、AI 等
├── types/                  # TypeScript 类型（如聊天请求体）
├── scripts/                # 验收/辅助脚本
├── docs/                   # 功能设计与流程说明（聊天、SSE、限流等）
├── public/                 # 静态资源
├── next.config.mjs
├── tailwind.config.js
├── vitest.config.ts
└── package.json
```

## API / 主要模块

| 路径或模块 | 说明 |
|------------|------|
| `app/api/auth/[...nextauth]/route.js` | NextAuth 会话与 OAuth 回调 |
| `app/api/chat/route.ts` | 聊天 SSE：`handleChatStream`、限流、预算、会话存储 |
| `app/api/cabins/[cabinId]/route.js` | 小屋相关 API |
| `lib/data-service.js` | Supabase 查询：小屋、客人、预订等 |
| `lib/sseServer/` | 服务端 SSE：会话存储、LLM 消费、工具调用等 |
| `lib/sseClient/` | 客户端 SSE：解析、重试、`useChatStream` |
| `lib/chat/` | 校验、限流、预算等 |
| `lib/actions.js` | Server Actions（预订等） |

## 环境变量

以下为代码与配置中会出现的变量。**生产环境请使用强随机密钥，且勿将真实密钥写入仓库。**

### 必填（核心站点运行）

| 变量名 | 说明 |
|--------|------|
| `NEXTAUTH_URL` | 站点根 URL（开发示例：`http://localhost:3000`） |
| `NEXTAUTH_SECRET` | NextAuth 加密会话用密钥 |
| `AUTH_GITHUB_ID` | GitHub OAuth App Client ID |
| `AUTH_GITHUB_SECRET` | GitHub OAuth App Client Secret |
| `SUPABASE_URL` | Supabase 项目 URL |
| `SUPABASE_KEY` | Supabase anon/service 密钥 |

### 可选

| 变量名 | 说明 |
|--------|------|
| `AUTH_GITHUB_ISSUER` | GitHub OAuth issuer，默认 `https://github.com/login/oauth` |
| `DEEPSEEK_API_KEY` | DeepSeek API，用于 AI 聊天 |
| `REDIS_DRIVER` | Redis 驱动选择，如与 `ioredis` / Upstash 配合使用 |
| `REDIS_URL` | 标准 Redis 连接串 |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash REST 方式 |
| `CHAT_SESSION_REDIS_URL` | 仅会话存储使用独立 Redis 时配置 |
| `CHAT_SESSION_STORE` | `memory` 或 `redis` |
| `CHAT_SESSION_TTL_MS` | 会话 TTL（毫秒） |
| `CHAT_MAX_MESSAGES` 等 | 消息条数、字符上限、上下文预算等（见 `lib/chat/limits.ts`） |
| `CHAT_RATE_LIMIT_*` / `TRUST_PROXY` | 聊天限流窗口与严格模式等（见同上文件） |
| `CHAT_BUFFER_*` | SSE 续传缓冲上限 |

完整键名以 `lib/chat/limits.ts` 中 `CHAT_ENV_KEYS`、`RATE_LIMIT_ENV_KEYS`、`SESSION_STORE_ENV_KEYS` 为准。

## 可用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式 |
| `npm run build` | 生产构建 |
| `npm start` | 启动生产服务器 |
| `npm run lint` | ESLint |
| `npm run test:integration` | Vitest 集成测试 |
| `npm run test:m1-m4` / `test:m5` / `test:m6-m9` | 课程/模块验收脚本 |

## 部署说明（简述）

- 可部署至 **Vercel** 或任意支持 Node.js 的托管环境。
- 生产环境请配置上述环境变量；若使用聊天限流与会话的 Redis，需保证网络可达。
- SSE 若在反向代理后，需关闭缓冲（文档中已有 `X-Accel-Buffering` 等说明），详见 `docs/sse-resume-deployment.md`。

## 相关文档

- 项目内 `docs/`：聊天、SSE、认证与失败处理等设计与验收说明。

