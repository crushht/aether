# 发版清单

给维护者自己看的流程，避免每次发版靠回忆。

## 1. 版本与变更

```bash
# 1) 改版本号（三处保持一致）
#    package.json / package-lock.json（顶层与 packages[""] 的 version）
node -e "const fs=require('fs');for(const p of ['package.json','package-lock.json']){const j=JSON.parse(fs.readFileSync(p,'utf8'));j.version='0.3.x';if(j.packages&&j.packages[''])j.packages[''].version='0.3.x';fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')}"

# 2) 在 CHANGELOG.md 顶部加一节（Added / Changed / Fixed / Security）
```

## 2. 本地门禁

```bash
npm run typecheck && npm run lint && npm test && npm run i18n && npm run build
```

## 3. 打包

```bash
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'   # 无证书时跳过签名
npm run dist                                # dist/Aether-<version>-x64.exe + portable
```

Windows 上如果卡在 `winCodeSign` 解压（符号链接权限），见 [CONTRIBUTING.md](../../CONTRIBUTING.md) 的「打包桌面版」。

打包后核对：

```powershell
(Get-Item 'dist/win-unpacked/Aether.exe').VersionInfo | Select ProductName,FileVersion,CompanyName
# 图标：ExtractAssociatedIcon 应返回 32x32 且不是默认 Electron 图标
```

## 4. 提交与推送

```bash
git add -A
git commit -m "release: v0.3.x"
git push origin main
```

`git push` 不通时（常见于网络受限环境），用 GitHub 的 Git Data API 提交同一棵树：
取远端 `ref/heads/main` → 建 blob → 建 tree（`base_tree`）→ 建 commit → PATCH ref。
本地随后 `git fetch && git reset --hard origin/main` 对齐。

## 5. 发布

```bash
gh release create v0.3.x "dist/Aether-0.3.x-x64.exe" "dist/Aether-0.3.x-portable.exe" \
  --title "Aether v0.3.x" --notes-file docs/releases/v0.3.x.md --latest
```

写 notes 时固定包含：下载表、是否有签名、这一版的关键变化、数据位置、已知限制。

## 6. 收尾检查

- [ ] CI 绿：`gh run list --limit 3`
- [ ] `gh release view v0.3.x` 两个资产都在，大小合理（约 124MB）
- [ ] GitHub 识别 License 为 MIT：`gh api repos/crushht/aether/license --jq .license.spdx_id`
- [ ] 首页 README（含英文版）渲染正常，截图可访问
- [ ] 社交预览图：Settings → Social preview 上传 `docs/social-preview.png`

## 7. 社交预览图重生成

```bash
node scripts/make-social-preview.mjs   # 输出 docs/social-preview.png (1280x640)
```
