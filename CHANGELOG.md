# Changelog

本文件记录每个发布版本的对外变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [Unreleased]

### Planned
- 多工作区（按 `workspaceId` 分区数据与路由）
- 自动更新与代码签名
- 服务端搜索索引
- 数据层分片

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
