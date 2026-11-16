#!/usr/bin/env node
/**
 * Renders `docs/social-preview.png` (1280x640) for GitHub's Social preview.
 * Uses the same headless Chrome + CDP helper as the e2e suites, so there is no
 * image tooling to install. Upload the result under
 * Settings → Social preview once it looks right.
 */
import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, viewport, goto, shot } from '../study/cdp.mjs';

const root = process.cwd();
const screenshot = path.join(root, 'docs', 'checks', '206-aether-login.png');
const output = path.join(root, 'docs', 'social-preview.png');

const image = fs.readFileSync(screenshot).toString('base64');

const html = `<!doctype html>
<html lang="zh-CN">
<body style="margin:0;width:1280px;height:640px;overflow:hidden;background:#0b0c0f;color:#e8e9ec;
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;display:flex">
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:22px;padding:0 0 0 76px">
    <div style="display:flex;align-items:center;gap:16px">
      <div style="width:56px;height:56px;border-radius:16px;background:#5E6AD2;display:grid;place-items:center;
        box-shadow:0 10px 30px rgba(94,106,210,.45)">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">
          <circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" stroke-linecap="round"/>
        </svg>
      </div>
      <span style="font-size:46px;font-weight:650;letter-spacing:-.02em">Aether</span>
      <span style="margin-left:6px;padding:4px 10px;border-radius:999px;background:#17181c;color:#9a9ca3;
        font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">v0.3.0</span>
    </div>

    <div style="font-size:34px;line-height:1.22;font-weight:600;letter-spacing:-.01em;max-width:560px">
      以 Agent 为中心的工作台
    </div>
    <div style="font-size:18px;line-height:1.65;color:#9a9ca3;max-width:540px">
      议题、项目、周期、路线图与收件箱，<br />
      外加一个真能读写你工作区的智能体。<br />
      不内置模型 —— 填入任意 OpenAI 兼容端点即可。
    </div>

    <div style="display:flex;gap:8px;font-size:13px;color:#b9bbc2;margin-top:2px">
      <span style="padding:6px 11px;border-radius:999px;background:#17181c;border:1px solid #24262c">Next.js 15</span>
      <span style="padding:6px 11px;border-radius:999px;background:#17181c;border:1px solid #24262c">React 19</span>
      <span style="padding:6px 11px;border-radius:999px;background:#17181c;border:1px solid #24262c">Electron 45</span>
      <span style="padding:6px 11px;border-radius:999px;background:#17181c;border:1px solid #24262c">MIT</span>
    </div>

    <div style="font-size:14px;color:#6b6d75;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">
      github.com/crushht/aether
    </div>
  </div>

  <div style="width:560px;display:flex;align-items:center;justify-content:center;padding-right:64px">
    <img src="data:image/png;base64,${image}" alt=""
      style="width:530px;height:400px;object-fit:cover;object-position:top left;border-radius:14px;
      border:1px solid rgba(255,255,255,.09);box-shadow:0 34px 90px rgba(0,0,0,.62);transform:rotate(-1.5deg)" />
  </div>
</body>
</html>`;

const chrome = await launch({
  port: 9526,
  profile: path.join(process.env.TEMP || '.', `aether-social-${process.pid}`),
});
let page;
try {
  page = await newPage(9526);
  await viewport(page, 1280, 640, 1);
  await goto(page, `data:text/html;charset=utf-8,${encodeURIComponent(html)}`, 1200);
  await new Promise((resolve) => setTimeout(resolve, 600));
  await shot(page, output, { width: 1280, height: 640 });
  console.log(`wrote ${output}`);
} finally {
  page?.ws?.close();
  chrome.proc.kill();
}
