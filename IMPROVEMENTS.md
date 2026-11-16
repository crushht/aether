# 改进总结（100 轮 + v0.4 能力线）

## v0.4（2026-11-16）：从「工作台 + agent」到「能自证的 agent」

- **邮箱验证码体系**：零依赖 SMTP 客户端（`node:tls`）+ 六位码哈希存储 + 登录/注册/找回密码三条路径；
  QQ 邮箱真实投递与 code 登录实测通过；规则（10 分钟、5 次、60s 冷却、每小时 6 封）由 `lib/email-rules.ts` 前后端共用。
- **Agent 联网**：`web_search` 五引擎链式回退（DDG/Bing/搜狗/百度/360，两套解析器），`fetch_url` 带外链与逐跳重定向校验。
  来源后来做成设置：设置 →「网页搜索」可固定 SearXNG 端点（先 `format=json`，关掉就回退 HTML）、调整引擎优先级与开关，
  保存写 `<数据目录>/search.json`，`/api/agent/web-search` 每请求现读（`lib/search-settings.ts` 纯逻辑 + 76 条回归断言）。
- **Agent 静态逆向**：`inspect_artifact`（PE/ELF/Mach-O/ZIP-APK/熵/字符串/指示器/内嵌载荷/hexdump + sha256·sha1·md5）。
- **Agent 工具结果卡片**：`web_search` 命中列表与 `inspect_artifact` 报告在对话流里折叠展开——
  卡片由纯函数构建并裁剪（`lib/agent/tool-cards.ts`），随会话持久化但只保留最新 12 张，
  读回时用 `isToolCard` 校验（坏数据退化为原来的一行回执）；sha256/md5 一键复制。
- **自主循环**：`scripts/autopilot.mjs` — 队列 → headless agent → 门禁 → 本地提交（`--push` 才推送），锁与断点续跑。
- 新增回归 4 组、浏览器验收 1 个（`scripts/e2e-email-code.mjs`，含 API 契约与登录页 UI）。
- 对标矩阵与候选队列落在 `docs/11-产品差距清单.md`，循环说明在 `docs/12-自主改进循环.md`。

---

对照 ChatGPT 与 Linear 的差距清单已逐项落地：共 **123 条**已完成条目（明细见 `NEXT.md` 的「已完成」），**74 个**浏览器/接口验收脚本（`scripts/e2e-*.mjs`）与 **29 项**纯函数回归（`scripts/regression.mjs`）。v0.4 又加了 4 组回归与 1 个验收脚本。

## 验证命令

```bash
npm run typecheck
npm run build
node scripts/regression.mjs
# 浏览器验收（先起 dev，AUTH_DISABLED=1，独立 LAB_DATA_DIR）
$env:AUTH_DISABLED='1'; $env:LAB_DATA_DIR='E:\fork\3\.e2e-data'; npm run dev
node scripts/e2e-<name>.mjs
```

## 断点续跑

- `NEXT.md`：待办队列 + 「已完成」倒序记录，每轮只改一处
- `.improve/state.json`：会话 id、每轮备注、`lastStage`
- `scripts/improve.mjs`：`--status` / `--check` / `--once` / `--agent` / `--dry-run` / `--rounds`

## 主要交付领域

### 数据与可靠性
- 本地 JSON 快照原子写 + 进程内锁 + 乐观版本（409 冲突）
- 工作区自动备份（节流、保留 10 份、列表含议题/项目数量、恢复/手动创建/删除）
- 通知归档 30 天自动清理、按周期去重、每日摘要

### 协作与通知
- 会话管理（UA/IP、撤销其它会话、改密后吊销）
- 成员角色（保护最后一位 owner）、邀请码/邀请链接
- 收件箱：类型与归档筛选、搜索、批量操作、右键菜单（含键盘）、日期分组（吸顶）、搜索高亮

### 议题与项目
- 议题抽屉：描述/评论 Markdown、@提及、附件粘贴与批量下载、共享灯箱（多图、焦点陷阱）
- 项目更新：健康度、回应、审计、周报/摘要（Markdown + JSON）、附件（上限提示、筛选、灯箱）
- 项目模板、健康度趋势、审计导出（Markdown/JSON）

### 搜索与命令
- 全局搜索页（议题/项目/文档/知识、片段、高亮、键盘、最近查询、空态快捷入口、延迟计算）
- 命令面板：分组折叠持久化、新建项目、最近项

### 设置与偏好
- 设置页搜索、通知偏好（分类开关 + 免打扰时段）、工具审批「总是允许」
- 会话管理 UI、邀请状态刷新、数据导入导出

### 桌面端
- 窗口状态持久化与越界恢复、更新检查（版本比较 + 清单校验）

## 剩余两项（已判定为外部/架构阻塞）

1. **多工作区切换**：需要服务端数据模型与路由按 `workspaceId` 分区，属于架构决策，需产品方向确认后整体改造。
2. **自动安装与代码签名**：需要发布源（S3/GitHub Releases）与 Windows 代码签名证书，属外部资产。

## 待办建议（清单见最终答复）

- ESLint 尚未安装：`npm run lint` 会进入交互式配置；CI 也没有 lint 步骤
- CI 只跑 typecheck / regression / build / 冒烟，73 个浏览器脚本尚未进 CI
- 工作区快照全量读写 + 单锁，大工作区存在写放大
- `issue-drawer.tsx`(1632) / `agent-chat.tsx`(1574) / `data.ts`(1111) 需要拆分
- 7+ 个 store 各自实现 localStorage hydrate/persist，可抽公共工厂

