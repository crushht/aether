# Aether · 产品架构与实现计划

> 本文是 Linear Lab → Aether 的产品架构基线。它先于代码存在：信息架构、数据模型、
> Provider 抽象层，以及 P0 阶段的实现顺序。实现细节见后续章节与源码注释。

Aether 是一台「以 Agent 为中心」的工作台：左边是会话与执行，右边是结构化的议题、项目与周期。
它不内置任何模型——每一次推理都走使用者自己配置的 OpenAI 兼容端点。

---

## 1. 产品信息架构

### 1.1 一级区域

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 侧栏（可折叠）                    │ 主区（路由）                            │
│                                  │                                         │
│ 工作区                            │  /                    收件箱 Pulse     │
│  · Inbox                         │  /my-issues           我的议题          │
│  · My issues                     │  /team/ENG            团队列表 / 看板   │
│  · Pulse                         │  /projects[/:id]      项目              │
│                                  │  /roadmap             路线图            │
│ 工作                              │  /cycles              周期              │
│  · Initiatives / Projects        │  /knowledge           知识库            │
│  · Roadmap / Cycles              │  /workflows           工作流            │
│  · Knowledge / Workflows   ← 新  │  /search              搜索              │
│                                  │  /settings[/tab]      设置              │
│ 团队                              │                                         │
│  · ENG / Design / Product        │ 覆盖层                                  │
│                                  │  · ⌘K 命令面板                          │
│ Agent                             │  · ⌘J Agent 工作台（会话）              │
│  · 模型状态（provider · model）   │  · 议题抽屉（Issue detail）             │
│  · 记忆条数 / 上下文占用          │  · 快速属性菜单 S/P/A/L                 │
└───────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Agent 的三层入口

| 入口 | 作用域 | 场景路由 | 典型用途 |
|---|---|---|---|
| 议题抽屉里的 Agent 段 | 单个议题 | `issue` | 改状态、拆子任务、写评论 |
| `⌘J` Agent 工作台 | 整个工作区 | `chat` | 汇总、规划、批量修改、把结论沉淀成议题 |
| Workflow 运行器 | 一条可复用指令 | `workflow` | 定时晨报、周报、体检 |

三个入口共用同一套工具、同一套审批语义、同一个 Provider 抽象层；
区别只在**场景绑定**（`chat / issue / workflow / knowledge` 各自可以指定不同的模型）与上下文装载量。

### 1.3 场景路由（核心差异点）

```
场景键            用途                        默认
chat             ⌘J 会话                     routes.chat
issue            议题内 Agent                 routes.issue
workflow         自动化执行                    routes.workflow
knowledge        知识库编目/摘要（预留）        routes.knowledge
```

未绑定场景 → 回落到第一个有 Key 的 Provider。UI 永远显示「当前用的是哪个 provider 的哪个模型」，
并给出上下文占用（tokens / contextWindow）。

---

## 2. 核心数据模型

### 2.1 服务端（`.data/aether/<accountId>.json`，按账号）

```ts
interface AetherStore {
  version: 2;
  providers: Provider[];              // 多个端点，各自有 key / 默认模型 / 参数
  routes: Record<RouteKey, Route>;    // 场景 → provider + model
  persona: string;                    // Agent 人设（顶在系统提示最前）
  instructions: string;               // 工作区级补充规则（原 systemPrompt）
  memoryEnabled: boolean;
  memory: MemoryEntry[];              // 长期记忆（事实 / 偏好 / 决定）
  knowledge: KnowledgeItem[];         // 知识条目（笔记 / 网页 / 文件）
  workflows: Workflow[];              // 可复用 Agent 工作流 + 运行历史
  updatedAt: string;
}

interface Provider {
  id: string; name: string; baseUrl: string;
  apiKeyEnc?: string; keyHint?: string;   // AES-256-GCM，永不回传
  models: string[]; defaultModel: string;
  temperature: number; maxSteps: number;
  contextWindow: number;                   // 用于占用条
  presetId?: string;
}

interface MemoryEntry { id; text; kind: 'fact'|'preference'|'decision'|'note';
                        scope: 'global'|'chat'|'issue'; ref?: string; at: number }

interface KnowledgeItem { id; title; kind: 'note'|'web'|'file';
                          url?; content; tags: string[]; at; updatedAt; chars }

interface Workflow { id; name; description; prompt;
                     providerId: string|null; model: string;
                     trigger: {kind:'manual'|'daily'|'weekly'|'interval'; ...};
                     enabled; allowWrites; createIssue; projectId;
                     maxSteps; lastRunAt; runs: WorkflowRun[] }

interface WorkflowRun { id; at; status: 'running'|'ok'|'error';
                        summary; steps; tools; issueKey?; error? }
```

### 2.2 客户端

| 存储 | 内容 | 说明 |
|---|---|---|
| `lib/store/data.ts` | 议题 / 项目 / 周期 / 标签 / 通知 | 工作区快照，版本校验写回 |
| `lib/agent/chats.ts` | 会话元数据（标题、置顶、时间） | localStorage + 服务端元数据同步 |
| `lib/agent/store.ts` | 会话 transcript（messages + log + usage） | 多轮上下文是**模型消息**，log 只是给人看的 |
| `lib/agent/workspace.ts` | providers / routes / memory / knowledge / workflows | 服务端唯一来源，乐观更新 |

会话与知识库都按**账号**隔离；议题数据按**工作区**共享（现有 `WORKSPACE_MODE` 语义不变）。

### 2.3 消息与附件

```ts
interface AgentMessage { role: 'system'|'user'|'assistant'|'tool';
                         content: string; images?: string[];   // data URL，多模态
                         toolCallId?: string; toolCalls?: AgentToolCall[] }

interface AgentAttachment { id; name; kind: 'file'|'web'|'image';
                            mime?; size?; text?; dataUrl?; url? }
```

- 文本文件：客户端读成文本，随消息拼进 `content`（每条 ≤12k 字符，总量 ≤40k）。
- 图片：data URL 走 `image_url` part（OpenAI 兼容多模态）。
- 网页：服务端 `/api/agent/fetch-page` 抓取 → 去标签取正文 → 同样拼进上下文；同时可存为知识条目。

---

## 3. 模型 Provider 抽象层

### 3.1 分层

```
组件 / store
   │  useModelTarget(route)                ← 解析出 ModelTarget
   ▼
lib/agent/provider.ts   chat({ target, messages, tools })
   │  POST /api/agent/chat { route|providerId, model, body }
   ▼
app/api/agent/chat/route.ts
   │  resolveProvider(account, route) → { baseUrl, apiKey, model }
   │  fetch(`${baseUrl}/chat/completions`)
   ▼
用户自己的端点（OpenAI / DeepSeek / OpenRouter / Moonshot / 智谱 / Ollama / 任意兼容实现）
```

- **密钥只存在于服务端**（账号文件，AES-256-GCM），浏览器拿到的只有 `hasKey` + `keyHint`。
- **模型 id 与参数由场景路由决定**，组件不写死任何模型名；预设只是输入便利。
- **协议只有一套**：OpenAI Chat Completions（`stream: true` + `tools`）。
  非流式兜底、`tool_calls` 增量拼接、`reasoning_content` 忽略、usage 缺失时估算，都在 provider 层收敛。
- 错误分类：401（Key 无效）/ 403（无权限）/ 404（模型或路径不存在）/ 429（限流）/ 5xx / 网络超时，
  统一成「一句话 + 可操作建议」。

### 3.2 兼容与迁移

旧版本只有单一 `agent/<id>.json`（baseUrl/model/key）。首次读取时自动迁移成
`providers[0]`（id=`primary`），并把四个场景全部指向它；迁移是幂等的，不改动原文件。

---

## 4. 阶段计划

### P0（本轮完成）

1. **多 Provider 与场景路由**：服务端模型 + `/api/agent/config` + 设置页「Providers」；
   Key 加密、`Test connection`、错误分类、旧配置迁移。
2. **对话工作台**：`⌘J` 会话支持附件（文件 / 图片 / 网页）、流式、停止、重试、
   模型与上下文占用指示、一键复制 / 存为议题 / 存为知识。
3. **全局布局与命令面板**：新增 Knowledge / Workflows 入口与命令；暗色/浅色两套 token 不变。
4. **Issue List 与联动**：Agent 工具保持 14 个，写入仍走审批；会话结论一键建 Issue。

### P1（本轮完成）

5. **Agent 工具体系扩展**：`remember` / `recall` / `search_knowledge` / `read_knowledge` /
   `list_workflows`，只读工具自动执行，写入工具等审批。
6. **长期记忆**：服务端存储、系统提示注入、设置页管理；`scope` 支持 global/chat/issue。
7. **会话管理**：重命名、置顶、搜索、删除；服务端会话快照（跨设备续聊）。
8. **Board / List**：沿用现有实现，不进本轮改动面。

### P2（本轮完成基础版）

9. **知识库**：`/knowledge` 页面（笔记 + 网页收录 + 搜索 + 标签），Agent 可检索。
10. **Workflow**：`/workflows` 页面（定义、手动运行、运行历史、每日/每周/间隔触发），
    本地调度器（应用打开时执行），结果可自动建成议题。
11. **设置与错误处理**：Provider 错误面、空状态、Key 缺失时的引导。
12. **团队协作**：沿用现有账号 / 成员模型，不扩权限系统。

### 验收

- `pnpm typecheck` / `npm run build` 通过。
- 无任何硬编码模型 Key；`grep -r "sk-"` 只应命中文档/占位。
- 未配置模型时应用照常可用，Agent 入口给出可操作引导。
- 三处 Agent 入口（issue / chat / workflow）共享工具与审批语义。
