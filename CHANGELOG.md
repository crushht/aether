# Changelog

本文件记录每个发布版本的对外变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [Unreleased]

### Added
- **设置 → 网页搜索**：SearXNG / 自定义端点与内置引擎优先级在界面里配置，存到 `<数据目录>/search.json`；`/api/agent/web-search` 每次请求现读，**保存即生效**。SearXNG 先请求 `format=json`，实例关掉 JSON 时自动回退 HTML 解析；端点可用「试跑一次」当场验证命中
- `GET/PUT/POST/DELETE /api/settings/search`：读取（任何成员）/ 保存（仅 owner）/ 试跑一次 / 清除并回退 `AETHER_SEARCH_URL`，试跑限流
- `lib/search-settings.ts`：端点校验（本机与内网允许 http，公网必须 https，URL 不许带凭据，粘进来的 `q=` 丢弃）、SearXNG JSON 解析（去重 / 截断 / 只放行 http(s)）、引擎优先级与 `AETHER_SEARCH_ENGINES`
- **设置 → 邮件**：SMTP 主机 / 端口 / 账号 / 授权码 / 发件人在界面里配置，授权码用 AES-256-GCM（`encryptSecret`）存到 `<数据目录>/mail.json`，接口只回「有没有密码」与末两位；保存后 `/api/auth` 的 `emailCode.available` 立即变化，无需重启
- `GET/PUT/POST/DELETE /api/settings/mail`：读取（任何成员）/ 保存（仅 owner）/ 测试连接 / 发送测试邮件 / 清除并回退 `.env.local`，写路径限流
- `verifyMail()`：只做 TCP → TLS → EHLO → AUTH 的连通性探测，测试邮件也走同一份草稿
- 明文 SMTP 只允许本机与内网地址（与连接器同一套规则）；公网中继必须隐式 TLS 或 STARTTLS

### Changed
- `lib/server/web-search.ts`：引擎链顺序改为设置驱动（默认仍是 DuckDuckGo → Bing → 搜狗 → 百度 → 360），固定端点优先于整条链；`AETHER_SEARCH_URL` 不再是唯一入口
- `mailer` 的配置改为异步：先读设置页保存的中继，再回退 `AETHER_SMTP_*`；`emailVerificationRequired()` 随之异步
- `docs/05-部署.md`：SMTP 一节改为「首选设置页，`.env.local` 作为只读回退」

### Planned
- 多工作区（按 `workspaceId` 分区数据与路由）
- 自动更新与代码签名
- 服务端搜索索引
- 数据层分片

## [0.4.0] — 2026-11-16

### Added
- **邮箱验证码登录 / 注册 / 找回密码**：零依赖 SMTP 客户端（`node:tls`，AUTH LOGIN / PLAIN、隐式 TLS 与 STARTTLS），六位码以加盐 SHA-256 存储，10 分钟有效、5 次尝试、60 秒重发冷却、每地址每小时 6 封；`/api/auth/email-code`、`/api/auth/password`、`POST /api/auth` 支持 `{ email, code }`
- **SMTP 配置**：`AETHER_SMTP_*`（任意中继；QQ 邮箱用授权码，默认 smtp.qq.com:465），`.env.example` 说明全部变量；未配置时退回纯本地密码模式
- **登录页**：密码 / 邮箱验证码切换、发送倒计时、本地模式开发码提示、找回密码入口、中英双语文案
- **Agent 联网**：`web_search`（DuckDuckGo → Bing → 搜狗 → 百度 → 360 链式回退，两套解析器，`AETHER_SEARCH_URL` 可指向 SearXNG）与 `fetch_url`（正文 + 外链 + 逐跳校验重定向，私网拒绝）；新增 `/api/agent/web-search`
- **Agent 静态逆向**：`inspect_artifact` + `/api/agent/inspect`（格式 / PE / ELF / Mach-O / ZIP-APK 目录 / 熵 / 字符串 / 指示器 / 内嵌 base64-hex 载荷 / hexdump，附 sha256·sha1·md5）
- **自主改进循环**：`scripts/autopilot.mjs`（待办队列 + 缺口清单 seeding + 门禁 + 本地提交 + 可选 push + 进程锁 + 断点续跑），`npm run autopilot*` 五个别名
- `docs/11-产品差距清单.md`（对标 Linear / ChatGPT 的差距矩阵与候选队列）、`docs/12-自主改进循环.md`
- 回归新增 4 组：邮件规则、SMTP 组帧、搜索解析、静态逆向

### Changed
- `lib/server/secrets.ts`：对称密钥与 AES-GCM 加解密从 `accounts.ts` 抽出，供 SMTP 凭据复用（`accounts.ts` 继续导出，调用方无需改）
- `lib/server/fetch-page.ts`：返回 `links`，重定向改为逐跳校验
- 版本号 0.3.1 → 0.4.0

## [0.3.1] — 2026-11-16

### Fixed
- Windows 安装包恢复 exe 图标与版本资源（`FileDescription` / `ProductName` / `FileVersion` / `CompanyName` / `LegalCopyright`），此前为绕开符号链接权限而关闭了资源编辑
- `LICENSE` 只保留标准 MIT 文本，GitHub 现在正确识别为 MIT；独立实现与字体声明移到 `NOTICE.md`

### Added
- 英文 README（`README.en.md`），中英文顶部互相链接
- `CONTRIBUTING.md`、`SECURITY.md`、`CODE_OF_CONDUCT.md`、`CHANGELOG.md`
- Issue 表单（bug / feature）、PR 模板、Dependabot 配置
- `docs/social-preview.png`（1280×640，社交预览图）

## [0.3.0] — 2026-11-16

首个公开发布。

### Added
- **工作区**：议题（列表 / 看板 / 子议题 / 关联 / 清单 / 标签 / 估点）、项目（健康度 / 更新 / 审计 / 摘要导出 / 模板）、周期与自动延续、路线图、Pulse、评审、收件箱、知识库、文档、全局搜索、命令面板
- **Agent**：多 Provider 与按场景路由、工具调用、写操作审批与「总是允许」、记忆、关键词/混合检索、工作流、用量汇总
- **协作**：账号与邀请码、成员角色（最后一位 owner 受保护）、会话列表（UA / IP / 撤销其它设备）、通知偏好与免打扰
- **可靠性**：本地 JSON 快照、原子写 + 进程内锁、乐观并发（409 可对比合并）、自动备份（保留 10 份、恢复前 diff 预览）
- **桌面端**：窗口状态记忆、托盘、`aether://` 深链、静态更新清单检查
- **工程门禁**：ESLint、32 项纯函数回归、i18n 缺键与硬编码扫描、CSP 报告落盘、70+ 浏览器验收、CI 四道门

### Changed
- 英文界面收口：`relativeTime`、`Me` 兜底、成员页状态文案全部走 `t()`
- 图片附件在入快照前缩放并转 WebP（实测 6.4MB → 873KB）
- `issue-drawer` 1752 → 1114 行，`agent-chat` 1574 → 1123 行，`data.ts` 接口抽出

### Fixed
- 测试连接拉到上游模型后未回填默认模型（本地网关没有预设的 `gpt-4o`）
- 收件箱日期标题在滚动时不吸顶
- 备份恢复缺少差异预览
- 登录无频率限制、缺少基础安全响应头
- 桌面版启动失败时没有日志可查

### Security
- 登录滑动窗口限流（10 次/分钟/IP）
- `nosniff` / `X-Frame-Options: DENY` / `Referrer-Policy` / `Permissions-Policy`
- CSP Report-Only + 违规落盘
