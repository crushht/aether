<div align="center">

<img src="docs/checks/206-aether-login.png" width="760" alt="Aether 登录页" />

# Aether

**以 Agent 为中心的工作台** —— 议题、项目、周期、路线图与收件箱，
外加一个真能读写你工作区的智能体。

不内置任何模型：填入任意 OpenAI 兼容端点，就能用。

[![CI](https://github.com/crushht/aether/actions/workflows/ci.yml/badge.svg)](https://github.com/crushht/aether/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-2ea44f.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15-000?logo=nextdotjs)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-087ea4?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![Electron](https://img.shields.io/badge/Electron-45-47848f?logo=electron)](https://www.electronjs.org)

[快速开始](#快速开始) · [功能](#功能) · [Agent](#agent-能做什么) · [架构](#架构) · [路线图](#路线图)

</div>

---

## 为什么又做一个工作台

大多数「AI 工作台」是聊天框旁边贴一块看板：模型看不见你的数据，看见了也改不动。
Aether 反过来——**Agent 是主线**，它和工作区共用同一套工具、权限和审计：

- 你让它「把 ENG-42 挪到本周，顺手补一句阻塞说明」，它真的会改，改动进历史、可撤销、可审计；
- 写操作先经过审批，你可以逐个确认，也可以「总是允许」某个工具；
- 密钥加密存在服务端，浏览器永远拿不到明文；
- 所有内容默认落在本机（一个 JSON 快照），不上传、不需要账号体系也能跑。

> 一句话：**Linear 的手感 + ChatGPT 的 Agent，但不替你选模型。**

<table>
  <tr>
    <td width="50%"><img src="docs/checks/201-aether-list.png" alt="议题列表" /></td>
    <td width="50%"><img src="docs/checks/204-aether-chat.png" alt="Agent 会话" /></td>
  </tr>
  <tr>
    <td align="center">议题 / 看板 / 分组 / 批量操作</td>
    <td align="center">Agent 会话：工具调用、步骤折叠、审批</td>
  </tr>
</table>

## 功能

### 工作区
| | |
|---|---|
| **议题** | 列表与看板、子议题、关联、清单、标签、优先级、估点、评论（富文本 + 附件）、活动流与撤销/重做 |
| **项目** | 健康度、目标日期、负责人、项目更新（含附件与回应）、审计记录、摘要导出（Markdown / JSON）、项目模板 |
| **周期** | 创建、自动延续未完成议题、开始/结束提示、历史 |
| **路线图 / Pulse / 评审** | 按项目与时间聚合，一屏看完进度与风险 |
| **收件箱** | 提及、Agent、周期、项目更新、每日摘要；分类与归档筛选、批量已读/归档、右键菜单、日期分组 |
| **知识库与文档** | 标签、置顶、导入、导出、条目复制；文档可被 Agent 直接引用 |
| **搜索** | 议题 / 项目 / 文档 / 知识一站搜，命中高亮、片段、键盘选择、最近查询 |
| **命令面板** | `⌘K` 全局动作：跳转、新建、切换视图、运行工作流、应用到模板 |

### Agent
- **多 Provider**：OpenAI、DeepSeek、OpenRouter、Moonshot、智谱 GLM、Ollama / LM Studio、任意自建端点
- **按场景路由**：工作区聊天、议题面板、项目、工作流各自选 Provider 与模型
- **工具调用**：读写议题 / 项目 / 知识 / 记忆 / 工作流，一步一句可读的说明
- **审批**：写工具逐次确认，或「总是允许」（按账号保存在本浏览器）
- **记忆与知识**：作用域记忆 + 关键词检索，配了向量模型就自动混合重排
- **工作流**：定时或手动运行，运行记录可回溯、可取消、可导出
- **用量**：今日 / 近 7 天的 token、步骤、工具调用与失败数（仅本浏览器统计）

<p align="center"><img src="docs/checks/202-aether-agents.png" width="720" alt="Agent 设置" /></p>

### 协作与可靠性
- 账号、邀请码、成员角色（最后一位 owner 受保护）、会话列表（UA / IP / 撤销其它设备）
- 通知偏好（分类开关 + 免打扰时段）、桌面通知、每日摘要
- **本地优先**：原子写 + 进程内锁 + 乐观并发（409 冲突可对比合并）
- **自动备份**：写前快照、保留 10 份、恢复前可预览差异（会带回什么、会丢掉什么）
- 中英双语、深浅色、移动端适配（375px 起）、CSP 观察期与违规落盘

<table>
  <tr>
    <td width="33%"><img src="docs/checks/203-aether-workflows.png" alt="工作流" /></td>
    <td width="33%"><img src="docs/checks/231-project-space.png" alt="项目空间" /></td>
    <td width="33%"><img src="docs/checks/224-mobile-list.png" alt="移动端" /></td>
  </tr>
  <tr>
    <td align="center">工作流与运行历史</td>
    <td align="center">项目空间（Agent + 知识 + 指令）</td>
    <td align="center">手机（375px）</td>
  </tr>
</table>

## 快速开始

需要 **Node 20+**（推荐 22）。

```bash
git clone https://github.com/crushht/aether.git
cd aether
npm ci

# 浏览器模式：前后端同一个 Next 进程
npm run dev          # http://127.0.0.1:4321
```

首次打开会让你创建账号（本地保存，密码哈希 + 会话表）。

**Windows 可以更省事**：项目根目录双击 `start.cmd`（浏览器）或 `打开软件.cmd`（桌面版）；
命令行则用 `start.ps1 -Desktop` / `-Prod` / `-Port 4400` / `-AuthDisabled` / `-Fresh`。

### 桌面版

```bash
npm run desktop:dev   # 开发模式：Next + Electron 一起起
npm run dist          # 打包安装包与便携版到 dist/
# 或只打包可运行目录（最快）
npm run dist:dir
```

桌面版额外提供：窗口状态记忆、托盘（显示 / 最小化到托盘 / 退出）、
`aether://issue/<id>` 深链唤起，以及静态更新清单检查（`AETHER_UPDATE_URL`）。

## 接入模型

设置 → Agents → 添加 Provider：

| 字段 | 说明 |
|---|---|
| Base URL | 任意 OpenAI 兼容端点，如 `https://api.deepseek.com/v1`、`http://127.0.0.1:11434/v1` |
| API Key | 服务端加密保存，浏览器不再收到明文 |
| 默认模型 | 点「测试连接」会从上游拉取模型列表，点一下即可设为默认 |
| 温度 / 最大步数 / 上下文 | 温度 0.2–0.4 适合工具调用；上下文用于用量提示 |

然后到「按场景路由」把聊天、议题、项目、工作流分别指到某个 Provider。

> 没有内置模型、没有代理密钥池、没有共享额度。用哪个模型、花谁的钱，由你决定。

## 架构

```
app/            Next.js App Router：页面 + /api 路由（同一个进程）
components/     UI（工作台 / Agent / 领域组件）
lib/
  agent/        Provider 调用、工具、工作流、检索、记忆、用量
  store/        客户端状态（zustand）+ 本地持久化
  server/       JSON 快照、锁、备份、限流、向量
desktop/        Electron 主进程（托盘、深链、窗口状态、更新检查）
scripts/        回归、e2e（CDP）、打包、图标生成、i18n 与 CSP 检查
```

数据默认落在 `.data/`（可用 `LAB_DATA_DIR` 改）：一个 JSON 快照 + 账号文件 + 备份目录。
写入路径是「读 → 校验版本 → 原子替换 → 广播 SSE」，因此多标签页不会互相覆盖。

## 开发与验证

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint，0 problems
npm test             # 32 项纯函数回归
npm run i18n         # 缺键 + 硬编码中文扫描（0 missing / 0 hardcoded）
npm run build        # 生产构建
npm run csp:check    # CSP 违规汇总（AETHER_CSP_ENFORCE=1 可切强制）
```

浏览器验收（Node 内置 WebSocket + CDP，无第三方依赖）：

```bash
$env:AUTH_DISABLED='1'; $env:LAB_DATA_DIR='.e2e-data'; npm run dev
node scripts/e2e.mjs            # 另有 70+ 个 e2e-*.mjs 覆盖各功能
```

## 键盘

| 键 | 作用 |
|---|---|
| `⌘K` / `Ctrl+K` | 命令面板 |
| `C` | 新建议题 |
| `⌘J` | 唤出 Agent |
| `⌘\` | 收起侧栏（窄屏为抽屉） |
| `G` 然后 `I/M/P/R/C/K/W/S` | 跳到收件箱 / 我的议题 / 项目 / 路线图 / 周期 / 知识 / 工作流 / 设置 |
| `J` / `K` | 列表内上下移动 |
| `Esc` | 关闭浮层、清空选择 |

## 路线图

- [ ] 多工作区（按 `workspaceId` 分区数据与路由）
- [ ] 自动更新与代码签名（发布源 + 证书）
- [ ] 服务端搜索索引（知识库目前是内存检索）
- [ ] 数据层分片（大工作区写入放大）

已经落地的改动记在 [IMPROVEMENTS.md](IMPROVEMENTS.md)。

## 贡献

欢迎 issue 与 PR。提交前请保证：

```bash
npm run typecheck && npm run lint && npm test && npm run i18n && npm run build
```

界面文案统一走 `t('English key')`，中文写在 `lib/locales/zh.ts`（缺键会被 `npm run i18n` 拦下）。

## 许可

[MIT](LICENSE)
