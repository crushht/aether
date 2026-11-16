# 贡献指南

感谢愿意花时间改进 Aether。这个仓库的默认假设是：**先跑起来，再改，改完用同一套门禁验证**。

## 环境

- Node 20+（推荐 22）
- Windows / macOS / Linux 均可；桌面端打包在 Windows 上最完整

```bash
git clone https://github.com/crushht/aether.git
cd aether
npm ci
npm run dev            # http://127.0.0.1:4321
```

## 提交之前

每一项都必须通过（CI 也跑这些）：

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint，0 problems
npm test               # 纯函数回归
npm run i18n           # 缺键 + 硬编码中文扫描
npm run build          # 生产构建
```

改动涉及交互时，再补一个浏览器验收：

```bash
$env:AUTH_DISABLED='1'; $env:LAB_DATA_DIR='.e2e-data'; npm run dev
node scripts/e2e.mjs            # 或你新加的 scripts/e2e-*.mjs
```

## 代码约定

- **文案**：一律 `t('English key')`，中文写进 `lib/locales/zh.ts`。直接写中文会被 `npm run i18n` 拦下。
- **状态**：客户端状态用 `lib/store/*`（zustand），持久化走 `lib/store/storage.ts` 的 helper，不要各自写 `localStorage` 样板。
- **服务端**：读写工作区走 `lib/server/store.ts`（锁 + 原子写），不要在路由里直接 `fs.writeFile`。
- **样式**：只使用设计令牌（`var(--bg-hover)`、`text-t3` 等）与既有间距，别引入新的色值。
- **纯函数优先**：能抽成纯函数的逻辑（导出、分组、diff、格式化）尽量抽出来，并补 `scripts/regression.mjs` 断言。

## 提交信息

用 Conventional Commits 前缀：`feat:` / `fix:` / `docs:` / `ci:` / `refactor:` / `test:` / `chore:`。
正文写「为什么」，不要只写「改了什么文件」。

## Pull Request

- 一个 PR 只做一件事；顺带的重构请单独开。
- 描述里写清：问题、做法、验证方式（贴命令与结果）。
- 涉及 UI 的改动附一张截图（`docs/checks/` 下的命名约定是 `NNN-slug.png`）。

## 打包桌面版

```bash
npm run dist:dir   # 只出可运行目录（快）
npm run dist       # 安装包 + 便携版
```

Windows 上如果 `electron-builder` 卡在 `winCodeSign` 解压（报 `Cannot create symbolic link`），
那是因为该归档里含 macOS 符号链接，普通权限的 shell 建不了。只解压需要的 Windows 子集即可：

```powershell
$cache  = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
$archive = Get-ChildItem $cache -Filter *.7z | Select-Object -First 1
$target  = Join-Path $cache 'winCodeSign-2.6.0'
node_modules\7zip-bin\win\x64\7za.exe x $archive.FullName 'windows-10\*' "-o$target" -y
node_modules\7zip-bin\win\x64\7za.exe x $archive.FullName 'rcedit*.exe'   "-o$target" -y
```

之后 `npm run dist` 就能写入图标与版本资源。没有证书时用 `CSC_IDENTITY_AUTO_DISCOVERY=false`
跳过签名（安装包会未签名，SmartScreen 会提示一次）。

## 报告问题

- 功能缺陷用 [Bug report](.github/ISSUE_TEMPLATE/bug_report.yml)
- 新想法用 [Feature request](.github/ISSUE_TEMPLATE/feature_request.yml)
- 安全问题**不要**开公开 issue，见 [SECURITY.md](SECURITY.md)
