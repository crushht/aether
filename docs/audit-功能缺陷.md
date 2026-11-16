# 功能缺陷审计清单（快照 2026-11-12 23:32）

- 对象：`E:\fork\3`（Next.js 15 / React 19 / Zustand 5 / framer-motion；Linear 复刻 + 自带模型智能体）
- 方式：只读审计，逐文件读源码。未改动 `app/`、`lib/`、`components/`、`package.json`、`.data/` 任何内容（唯一新增文件就是本文件）。
- 编译基线：`npx tsc -p tsconfig.json --noEmit --incremental false` → `EXIT=0`。**没有类型错误**，下面全部是运行期/逻辑缺陷。
- 计数：P0 × 1，P1 × 14，P2 × 25，共 40 条。

> ⚠️ **审计期间仓库正在被并发修改。** 23:23–23:32 之间 `lib/session.ts`、`lib/people.ts`、`app/api/{auth,workspace,agent/*,prefs}`、`components/shell/auth-gate.tsx`、`lib/store/{data,ui}.ts`、`components/views/*`、`components/issue/*` 等 30+ 个文件被重写（`study/_patch-*.cjs` 是驱动脚本）。本清单已按 **23:32 的当前文件**逐条复核过行号与语义。
> 以下 4 条在并发改动中**已被修掉**，因此不再列入（保留说明便于对照旧评审）：①PUT 不带 `baseVersion`（现在 `data.ts:101` 已带）；②`refresh()` 漏 `cycles/notifications`（现在 `data.ts:247-261` 已全量）；③`AuthGate` 读 `required/authed` 导致密码门永不锁（auth-gate 已整体重写为 `useSession` 账号体系）；④解锁 POST 缺少 email（`lib/session.ts:104-118` 已按 `{email,password}` 提交）。
> 修复前请再跑一次本清单的关键行号——这份文件只能保证是"某一刻"的真相。

---

## P0 —— 会持续写坏数据

### 1. 写入触发自己：每 ~500ms 一次全量 PUT，并和别的标签页形成 409 乒乓
`lib/store/data.ts:96-117`、`lib/store/data.ts:188-206`

- 现象：只要打开页面，Network 里 `/api/workspace` PUT 永不停，约每 0.5s 一次，每次整份工作区；`.data/workspace.json` 的 mtime 一直在跳。开两个标签页时，两边轮流 409 → `refresh()` → 再写 → 再 409，形成一个不会收敛的写循环（谁最后落盘取决于时序，两边都觉得自己"保存失败又重试了"）。
- 根因：`pushToServer` 成功后执行 `set({ storageMode: 'server', serverVersion: json.updatedAt ?? … })`（105 行）——服务端每次都返回新的 `updatedAt`，所以**每次**都产生新 state；而订阅回调（188 行）对任何 state 变化都排一个 500ms 的全量写，`if (!state.hydrated) return` 拦不住它。409 分支里 `await get().refresh()`（110 行）又会 `set()`（262/263 行）→ 再次排写，于是 409 与写互相喂养。
- 修法：①订阅改成"内容变了才写"：`(state, prev) => { if (state.issues === prev.issues && state.labels === prev.labels && state.projects === prev.projects && state.cycles === prev.cycles && state.notifications === prev.notifications) return; … }`；②`storageMode`/`serverVersion` 这两个"传输元数据"不要和业务数据共用同一个 store（挪到独立 store 或用 `get()` 直读、不走 `set`），否则它们本身就是触发器；③409 后的重试要合并（加一个 in-flight 标记 + 退避），不能立刻用刷新后的版本再写一次，否则两端永远互踩。

---

## P1 —— 明显功能坏

### 2. 首次 GET 回来无条件整体替换，吃掉这几百毫秒里的编辑
`lib/store/data.ts:165-174`

- 现象：弱网或工作区较大时，首屏已经可交互（`hydrate()` 在 AppShell 的 effect 里跑），用户按 C 建了议题 / 勾了勾选框 / 让智能体改了一条；GET 落地后 `serverHasData` 为真 → 整份替换，刚做的操作静默消失。
- 根因：`if (serverHasData) set({ issues: …, labels: …, … })` 不判断"本地在 GET 期间是否已经有写入"。`serverVersion` 记下来了，但没参与合并决策。
- 修法：在 `hydrate` 开头记 `hydrateStartedAt`，并维护一个 `localWriteSeq`（patch/create/delete 自增）；GET 落地时若 `localWriteSeq` 已变，就按条目的 `updatedAt` 做 merge（服务端更新的条目覆盖、本地更新的保留），或直接提示"检测到本地修改，已保留"。

### 3. 「我的议题」用的是遗留占位 id `me`，真实账号下永远是空列表
`app/(app)/my-issues/page.tsx:5`、`app/(app)/my-issues/page.tsx:11`

- 现象：用真实账号登录后进 `/my-issues`，一条都没有；侧栏"我的议题"计数也恒为 0。
- 根因：`import { meId } from '@/lib/mock-data'`（`meId = 'me'`，见 `lib/mock-data.ts:11`）→ `setFilter('assigneeId', [meId])`。而真实账号创建的议题里 `assigneeId` 是 `u_xxx`（`data.ts:364` 已改成 `currentUserId()`），`lib/people.ts` 也明确说 `me` 只是旧快照的兼容别名。同一次迁移里侧栏（`sidebar.tsx:160`）和抽屉（`issue-drawer.tsx:120`）都换成了 `usePeople()`，这个页面漏了。
- 修法：改成 `const { meId } = usePeople();` 再 `setFilter('assigneeId', [meId])`；同时把 `IssueList` 的筛选条件扩展到"assigneeId === 我 或 creatorId === 我"（Linear 的 My issues 两者都算）。

### 4. 通知已读状态完全不持久化：刷新后全部变回未读
`lib/store/ui.ts:41-44`、`lib/store/ui.ts:72-82`

- 现象：Inbox 点"全部标为已读"、徽标清零；刷新页面（或换标签页）后 N 条又全是未读，徽标回来了。
- 根因：`readNotifications` 只活在 `useUI` 的内存里。`setReadNotifications`（82 行）**全项目没有任何调用点**，`app/api/prefs/route.ts` 与 `lib/server/accounts.ts` 的 `readPrefs/writePrefs`（含 `readNotifications.slice(-500)`）也没有客户端去读写。等于"账号级偏好"这套后端写完了，客户端没接。
- 修法：在 AppShell 挂载后 `GET /api/prefs` → `setReadNotifications(list)`；`markNotificationRead` / `markAllNotificationsRead` 之后 debounce `PATCH /api/prefs {readNotifications}`（顺带把 theme/locale/sidebar/display 一起搬过去，现在它们只在 localStorage，同一台机器换个账号会串）。

### 5. 鉴权接口不可达即放行（fail-open）
`lib/session.ts:85-89`

- 现象：断网、服务 500、或 `/api/auth` 返回非 JSON 时，直接以 `user: LOCAL_FALLBACK`（role owner）进入工作区；此时 `/api/workspace` 是 401，于是读的是**本机 localStorage 里上一个账号留下的快照**。
- 根因：`catch` 里 `set({ status: 'authed', user: LOCAL_FALLBACK, users: [LOCAL_FALLBACK], offline: true })`，注释写着"open in local mode instead of showing a lock nobody can pass"——把"连不上"当成了"不需要登录"。
- 修法：只有 `payload.mode === 'local'`（`AUTH_DISABLED=1`）才允许无账号进入；其余情况停在 `status: 'error'`，给"重试/离线查看"两个明确动作，并且离线查看时不要复用上一个账号的 localStorage（`LOCAL_KEYS` 已经在 `session.ts:50-57` 里列好了，登出/匿名态应当先清）。顺手把 `offline` 判定收紧为"网络错误"，不要把 4xx 也吞成离线。

### 6. 智能体 `run()` 没有重入守卫：第二次运行会把第一次的 Promise 永久挂住
`lib/agent/store.ts:290-315`、`lib/agent/store.ts:430-437`

- 现象：评论区连发两条 `@agent`（`issue-drawer.tsx:1123-1128` 直接 `void runAgent(...)`，没有 `running/waiting` 判断），或面板 Run 与评论同时触发 → 两路 `patch` 交错写同一份 log，界面上的流式气泡互相覆盖；第一次 `await new Promise` 永远不会 resolve（`decisions` 是按 `issueId` 的单槽，第二次 `decisions.set` 把第一个 resolver 覆盖掉），`controllers` 也不会清理。
- 根因：`controllers` / `decisions` 都以 `issueId` 为键的单值 Map，`run()` 开头只校验 issue 存在，没有"这条 issue 已在运行"的判断。
- 修法：`run()` 开头 `if (controllers.has(issueId)) return;`（并在 `CommentComposer` 和 `AgentPanel` 共用同一个守卫）；`decisions` 换成 `Map<callId, resolve>`，取消/拒绝时把该 issue 的所有 resolver 一起 settle；for 循环里每步 `if (controller.signal.aborted) break;`。

### 7. 智能体刷新后失忆，但面板还挂着完整旧对话
`lib/agent/store.ts:178`、`lib/agent/store.ts:303`

- 现象：刷新页面，抽屉里智能体面板仍显示上次的对话与工具行；再发一句话，模型完全不记得前文，回答前后矛盾（"多轮"只在单页生命周期内成立）。
- 根因：`persistSessions` 里 `messages: []`（只存 log）；`hydrate` 恢复时同样 `messages: []`；而续聊判断是 `previous.status !== 'error' && previous.messages.length > 0` → 刷新后恒假，于是新开 system prompt。
- 修法：持久化 `messages` 的最后 N 条（切掉 `tool` 消息，避免 `tool_call_id` 配对断裂）；或在 hydrate 后于会话头部渲染"上下文已重置"，让 UI 与模型状态一致。

### 8. 描述编辑器：外部一改 description 就退出编辑并重灌 DOM，未保存内容直接丢
`components/issue/issue-drawer.tsx:464-465`、`components/issue/issue-drawer.tsx:470-475`

- 现象：正在描述框里打字，只要 `issue.description` 变了（另一个标签页 focus 刷新合入、智能体 `update_issue` 写了描述、500ms 自动写回流），编辑态立刻关闭、输入内容消失；`useLayoutEffect` 还会把 `el.innerHTML` 重灌一遍，光标也一起没。
- 根因：`React.useEffect(() => setEditing(false), [issue.id, issue.description])` 把描述内容当成"切换议题"的信号；`useLayoutEffect(… el.innerHTML = markdownToEditableHtml(issue.description), [editing, issue.id, issue.description])` 依赖同样过宽。
- 修法：两个 effect 的依赖都收窄到 `[issue.id]`；编辑中若 `issue.description` 与编辑器当前 markdown 不一致，弹一条非阻塞提示（"服务器上的描述已更新：采用 / 保留我的"），绝不静默重灌。

### 9. 项目进度恒为 0%
`lib/store/data.ts:574`、`app/(app)/projects/page.tsx:179`、`app/(app)/projects/[id]/page.tsx:101`

- 现象：项目里议题全做完了，列表与详情页进度条还是 0%，永远 0%。
- 根因：`Project.progress` 是存储字段，`createProject` 写 `progress: 0` 之后没有任何地方再写它（`setProjectStatus` 只改 status，`patchIssue`/`deleteIssues` 完全不碰 projects），两个页面直接读这个死字段。
- 修法：不要存，派生。`lib/selectors.ts` 加 `projectProgress(issues, projectId)`（`done / max(1, total - canceled - duplicate)`），两处改为调用；路线图（`roadmap/page.tsx:96`）读的也是同一个字段，一起换掉。

### 10. 结转出来的周期窗口可能整段落在过去，且可以反复结转
`lib/store/data.ts:486-491`

- 现象：对一个一个月前结束的周期点"结转未完成" → 新周期 `[旧结束日, +14 天]` 全在过去，`cyclePhase` 判成 `completed`，标签写"已完成"；按钮还在（条件是 `phase !== 'upcoming'`），可以继续点、继续凭空生成历史周期。同一时间段还能被 `ensureCycleRollover`（`data.ts:513-554`，加载时自动跑）再建一个。
- 根因：`const startsAt = new Date(source.endsAt)`，没有 `Math.max(now, endsAt)`；手动结转与自动结转互不加锁、互不幂等。
- 修法：`const start = Math.max(Date.now(), +new Date(source.endsAt))`；`rolloverCycle` 里若已存在"以该周期结尾为起点"的后续周期就直接返回它（幂等）；把 `ensureCycleRollover` 与手动结转收敛到同一个函数（带 lock）。

### 11. 看板视图看不到 `duplicate` 状态的议题
`components/views/board.tsx:145`

- 现象：列表视图有"重复"分组，切到看板这些卡片整张消失，也拖不出来（唯一办法是切回列表改状态）。
- 根因：`const columns = STATUSES.filter((s) => s.key !== 'duplicate')`，而 `visible` 里包含 duplicate；卡片只按 `columns` 渲染，没有任何"未分列"兜底。
- 修法：把 duplicate 也作为列渲染（可默认折叠），或在渲染前把 duplicate 并入 canceled 列并在卡片上标注；不要让数据既不在列里也不在任何容器里。

### 12. 删除议题不清理通知，Inbox 留下点了没反应的死条目
`lib/store/data.ts:380-391`、`app/(app)/inbox/page.tsx:60-70`

- 现象：删掉一条被智能体改过的议题，Inbox 里那条通知还在（显示 `—` /"（议题已删除）"），点它只标已读、抽屉不开（`if (issue) openIssue(...)`），计数也不降。
- 根因：`deleteIssues` 处理了子议题（`parentId → null`）和双向关系，唯独没过滤 `notifications`（通知存 `issueId`）。
- 修法：同一个 `set` 里 `notifications: state.notifications.filter(n => !ids.includes(n.issueId))`；Inbox 点击时若 `!issue`，给"该议题已删除"提示并允许单条清理（补一个 `dismissNotification`）。

### 13. `createIssue` 的 id 就是 key，删掉最大号再建会复用旧 id
`lib/store/data.ts:352-358`

- 现象：删掉 `ENG-12` 再新建 → 新议题拿到 `ENG-12`。它头顶会挂上原来那条议题的通知；外部复制出去的 `?issue=ENG-12` 链接、收藏也一起"认领"到新议题。`id === key` 让这种复用无法区分。
- 根因：`const maxN = reduce(max(Number(i.key.split('-')[1]) || 0)); const key = 'ENG-' + (maxN + 1); const issue = { id: key, key, teamKey: 'ENG', … }`——序号只看当前最大号，不看历史；团队还硬编码 `ENG`。
- 修法：`id: uid('iss')`（内部 id 与人类可读 key 解耦）；序号用单调计数器（存进工作区，只增不减），teamKey 由当前上下文（路由/团队）传入；迁移时保持 `id === key` 的老数据不动即可。

### 14. 亮色主题下 12 个 CSS 变量没有定义，状态色/健康度色全部失效
`app/globals.css:39-70`（`[data-theme='dark']`）与 `app/globals.css:73`（`[data-theme='light']`）

- 现象：切到浅色后，列表/看板的状态图标、项目健康度圆点、优先级色全部退化成继承色（看起来像"彩色图钉丢了"）。
- 根因：`--status-done / --status-progress / --status-review / --status-canceled / --green / --red / --orange / --yellow / --teal / --pink / --accent-fg / --font-mono` 只在 dark 块声明；light 块只有 29 个变量（dark 41）。`color: var(--status-done)` 在浅色下是无效值 → 属性回退成继承。
- 修法：把这 12 个提到 `:root`（品牌色两套主题可共用），light 块只覆盖 `--bg-* / --text-* / --line-*`；或在 light 块补齐。建议加一条注释规则："新增 token 必须两套都写"。

### 15. 周期/项目/动态三页仍读 mock 的 `userById`，真实账号下负责人显示为空
`app/(app)/cycles/page.tsx:4`、`app/(app)/projects/page.tsx:9`、`app/(app)/projects/[id]/page.tsx:10`、`app/(app)/projects/[id]/page.tsx:110`、`app/(app)/pulse/page.tsx:10`、`app/(app)/pulse/page.tsx:150`

- 现象：真实账号建的项目，详情页"负责人"一栏空白（`{lead?.name}` → undefined）；周期页与动态页的头像是种子用户或 `Unknown`，actor 名字缺失；项目列表里 lead 名字也空。
- 根因：`import { userById } from '@/lib/mock-data'`——那是一张只有 1 个种子用户的表（`mock-data.ts:13-17`）。同一次迁移里 `sidebar`、`issue-drawer`、`issue-properties`、`bulk-bar`、`quick-edit`、`view-menus` 都换成了 `usePeople()`，这四个页面漏了。
- 修法：统一换成 `const { userById } = usePeople();`（页内 hook）或 `resolvePerson(id)`（非 hook 场景，`lib/people.ts:51`）。建议把 `mock-data` 里的 `users/userById/meId` 标记为 `@deprecated` 并只在 seed 用，避免继续误引。

---

## P2 —— 体验 / 一致性 / 无障碍 / 性能

### 16. `IssueRow` 的 memo 完全失效（每次渲染都新建回调）
`components/views/issue-list.tsx:212-214`

- 现象：J/K 每动一次光标，整个列表所有行重渲染；几百条议题时明显掉帧。
- 根因：`React.memo` 收到的是 `onOpen={() => openIssue(issue.id)}`、`onClickRow={(e) => onClickRow(issue, e)}`、`onToggleSelect={() => select(issue.id, 'toggle', orderedIds)}`——父组件每渲染就换引用，memo 比较恒失败。
- 修法：签名改成 `(id: string) => void` / `(id, e) => void`，父层用 `useCallback` 建一次再透传 `issue.id`；`onOpen` 可以直接传 `openIssue`（zustand action 引用稳定）。

### 17. 整仓库订阅 + 未 memo 的筛选排序
`components/views/issue-list.tsx:107`、`components/topbar/topbar.tsx:65`、`components/topbar/topbar.tsx:93`、`components/views/board.tsx:135`

- 现象：移动光标（`cursorId` 变化）时，顶栏、列表、看板都重算一遍 `selectVisibleIssues`（内部排序），与光标无关的 UI 全部重渲染。
- 根因：`const { tab, filters, sort, display, selectedIds, cursorId, … } = useView()` 订阅了整个 view store；Topbar 的 `visible` 没有 `useMemo`。
- 修法：逐个字段取 selector；`visible` 包 `useMemo([issues, tab, filters, sort])`。

### 18. 看板每张卡两个 selector 各自全量 `reduce`
`components/views/board.tsx:50-53`

- 现象：50 张卡 × 500 条议题 = 每次 store 变更 2.5 万次迭代；拖拽时每次 `pointermove` 都触发一次 → 拖影/掉帧。
- 根因：为了"保持 memo 不被无关编辑打穿"，把子议题统计写成两个返回标量的 selector，每个 selector 在每次 store 变更时都对全部 issues 做 `reduce`。
- 修法：在 `BoardView` 里 `useMemo` 建一次 `Map<parentId,{done,total}>`（`issue-list.tsx:127-137` 已有同款写法），把两个数字作为 props 传给 `BoardCard`（标量，memo 依然有效）。

### 19. 看板拖拽的 listener / rAF / body class 没有卸载清理
`components/views/board.tsx:161-318`（`183`、`191-201`、`308-310`）

- 现象：拖到一半切路由/切视图，或指针在窗口外松开 → 边缘自动滚动的 `requestAnimationFrame` 永久自转，`document.body` 一直带着 `dragging-cursor`（全应用变成抓手光标，直到刷新）。
- 根因：`cleanup()` 只在 `pointerup`/`pointercancel` 里调用，全部注册在 `onCardPointerDown` 的事件闭包里；组件卸载无兜底，指针移出窗口也没有后备。
- 修法：把 `cleanup` 存进 ref，`useEffect(() => () => cleanupRef.current?.(), [])`；`startDrag` 里加 `window.addEventListener('blur', cancel)` 与 Esc 取消；rAF 回调里 `if (!active) return`。

### 20. 从搜索/Inbox/命令面板打开不在当前筛选里的议题：头部显示 `0 / N`，"下一条"可点但无效
`components/issue/issue-drawer.tsx:176`、`components/issue/issue-drawer.tsx:352-357`

- 现象：在搜索页点开一条议题，抽屉顶部出现 `0 / 5`；"下一条"不是禁用态，点它没反应（`if (index >= 0 && …)` 恒假）。
- 根因：`index` 来自 `ordered`（经 `selectVisibleIssues` 过滤），目标可能不在其中；模板直接拿 `index + 1`、`index >= total - 1` 判断。
- 修法：`index < 0` 时隐藏计数器并禁用前后按钮（`disabled={index < 0 || …}`）；或用未过滤的 `issues` 顺序兜底。

### 21. 内联新建里 Tab 被劫持成"创建并打开"
`components/views/issue-list.tsx:82-86`

- 现象：在内联输入框里按 Tab 想移开焦点，结果直接建了一条议题并打开抽屉。
- 根因：`if (e.key === 'Tab') { e.preventDefault(); commit(true); }`。
- 修法：去掉 Tab 提交（Enter 建、⌘/Ctrl+Enter 建并打开、Esc 取消）。

### 22. 抽屉内任何输入框聚焦时 Esc 失效
`components/shell/shortcuts.tsx:74`、`components/issue/issue-drawer.tsx:631-650`

- 现象：在评论框/标题/描述里按 Esc 关不掉抽屉；描述编辑器里的 Esc 也没有"放弃编辑"语义，只能去点 × 或 Cancel。
- 根因：快捷键层先处理 `commandOpen`/`helpOpen` 的 Esc，然后 `if (editable || commandOpen || helpOpen) return;`——处理 `composing / activeIssueId / selectedIds` 的 Esc 分支（`shortcuts.tsx:205`）在输入框里永远到不了；描述编辑器的 `onKeyDown` 只接了 ⌘ 组合。
- 修法：把"关抽屉/清选择"的 Esc 判断提到 `editable` 早退之前（仅当输入框没有可撤销内容时），或在输入框自身的 `onKeyDown` 里实现两段式 Esc（先失焦，再按才关）。

### 23. 按 `g` 之后的下一个按键会被吞掉
`components/shell/shortcuts.tsx:86-89`

- 现象：手误按了 `g`，紧接着按 `x`/`j`/`c` 全部没反应（chord 提示条闪一下即消失）。
- 根因：进入 `if (pending.current && …)` 分支后，无论第二位能否匹配都 `setChordTimed(null); … return;`，事件既没被匹配也没下传。
- 修法：只有 `first` 命中已知前缀且第二位命中有效组合时才 `return`；否则清掉 chord 并继续按普通按键处理。

### 24. 抽屉没有 dialog 语义与焦点管理；侧栏未纳入 inert
`components/issue/issue-drawer.tsx:141-157`、`components/shell/app-shell.tsx:102-105`

- 现象：键盘/读屏用户打开议题后焦点仍在原来的列表行上；Tab 会跑到抽屉背后的顶栏与侧栏（`inert` 只挂在 `<main>` 上，侧栏是兄弟节点）；关闭后焦点丢失。
- 根因：抽屉是 `motion.div fixed inset-0 z-[700]`，没有 `role="dialog"`/`aria-modal`/`aria-labelledby`，没有初始 focus、没有焦点陷阱、没有关闭后 `focus()` 还原。
- 修法：外层加 `role="dialog" aria-modal="true" aria-labelledby={titleId}`；打开时 focus 标题，把 `Sidebar` 一起 inert，关闭时把焦点还给 `[data-issue-row="<id>"]`。

### 25. 桌面端折叠侧栏只有 `aria-hidden`，没有 `inert`
`components/shell/sidebar.tsx:231-232`

- 现象：折叠侧栏后按 Tab，焦点掉进"看不见的侧栏"（`lg:w-0` + `opacity-0`，链接仍可聚焦），焦点环不可见。
- 根因：`aria-hidden={isMobile ? !mobileNavOpen : collapsed}` 只对读屏隐藏；`inert={isMobile && !mobileNavOpen}` 只覆盖移动端。
- 修法：`inert={isMobile ? !mobileNavOpen : collapsed}`，与 `aria-hidden` 同源。

### 26. 复选框/开关没有可访问名
`components/ui/primitives.tsx:233-236`、`app/(app)/settings/[[...tab]]/page.tsx` 的 `Toggle`

- 现象：读屏念"复选框，未选中"，不知道是哪条议题；设置页每个开关念"开关"，不知道是"显示标签"还是"显示优先级"。
- 根因：`Checkbox` 的 children 只有 `<CheckMark/>`，无 `aria-label`/`aria-labelledby`；`Toggle` 的标题在兄弟节点里，不是 `<label>`；`indeterminate` 也没反映到 `aria-checked`。
- 修法：`Checkbox` 增加必填 `label`（`issue-row.tsx` 传 `t('Select issue') + ' ' + issue.key`）；`Toggle` 补 `aria-label={title}`，`indeterminate` 用 `aria-checked="mixed"`。

### 27. 弹出菜单键盘不可达：不接管焦点、无方向键、关闭不回焦
`components/ui/popover.tsx:79-99`

- 现象：键盘打开状态选择器后焦点还在触发按钮上；Tab 会跳到页面后方（面板被 portal 到 `body` 末尾），菜单项只能靠 Tab 绕全页到达。
- 根因：没有 `role="menu"`/`menuitem`，打开时不 focus 第一项，没有 ↑↓/Home/End 的项间移动，关闭时也不 `anchorRef.current.focus()`（只有 document 捕获 Esc 关闭）。
- 修法：打开时 focus 首个 `MenuItem`，面板上处理 ↑↓/Home/End，关闭时回焦 anchor。

### 28. i18n 漏翻：缺键 + 键名对不上
`lib/locales/zh.ts`、`components/topbar/view-menus.tsx:92`、`components/topbar/view-menus.tsx:271`、`components/command/command-menu.tsx:426`、`components/agent/agent-panel.tsx:223`、`components/issue/issue-drawer.tsx:1005`、`components/issue/issue-drawer.tsx:1010`

- 现象：中文界面里仍出现 `Clear`、`changed priority`、`set an estimate`。
- 根因：`zh.ts` 没有 `'Clear'`（只有 `Clear filters` / `Clear selection`）；活动流的键是 `'changed priority'`、`'set an estimate'`，字典里却是 `'changed the priority'`、`'updated the estimate'`——`translate` 找不到就回退英文 key。
- 修法：补 `'Clear'`；统一键名（建议改代码迁就短键），并在开发环境给 `translate` 加"未命中键"`console.warn`（一次性），以后漏翻当场暴露。

### 29. 硬编码中英文与 aria-label 绕过 `t()`
`components/issue/issue-drawer.tsx:217`、`309`、`1051`、`1095`、`app/(app)/projects/[id]/page.tsx:62`、`146`、`172`

- 现象：英文界面出现"我"、"Unknown"；中文界面里项目详情的 `Projects`、`In Progress`、`No issues in this project yet.` 是英文；读屏在中文界面念 `Star issue` / `Close issue`（而 `zh.ts` 里其实有这些键）。
- 根因：`'我'`、`'Unknown'`、`status.label` 直接进 JSX；`aria-label="Star issue"` 等用字面量。
- 修法：`'我'` 换成当前用户名字（`usePeople()`），`'Unknown'` 补键；`status.label` 走 `t()`；所有 `aria-label` 走 `t()`。

### 30. 阅读视图把段内单换行合并成空格
`components/issue/markdown.tsx:98`

- 现象：描述里写了三行（无空行分隔），阅读视图连成一行；点进去编辑又变回三行，观感来回跳。
- 根因：`blocks.push({ type: 'p', text: buf.join(' ') })`。
- 修法：段落内保留 `\n`，`.prose-linear p` 加 `white-space: pre-wrap`；或渲染成 `<br/>`。

### 31. markdown 往返被"规整"：多空行被折叠、乘法被当斜体
`lib/markdown-editable.ts:106-109`、`lib/markdown-editable.ts:41-48`

- 现象：作者故意留的两三个空行，保存一次就压成一个；`2 * 3 * 4` 在阅读视图变成斜体。
- 根因：保存时 `md.replace(/\n{3,}/g, '\n\n')` 与首尾 `\n` 裁剪是无条件规整；`inline()` 只按"配对单星号"判斜体，不要求星号内侧非空白。
- 修法：只做 `\u00a0 → 空格` 与尾部收尾，不折叠内部空行；斜体规则改成要求星号内侧紧贴非空白（如 `/(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)/`）。

### 32. 批量删除没有确认也没有撤销
`components/views/bulk-bar.tsx:110-121`、`components/views/row-actions.tsx:156-166`、`components/issue/issue-drawer.tsx:176-180`

- 现象：批量栏垃圾桶紧挨着"清除选择"，误点一下 N 条议题连同评论/活动一起消失，刷新也回不来（服务端快照已被覆盖）。
- 根因：直接 `data.deleteIssues(ids)` + toast；`pushToast` 已支持 `actionLabel`/`onAction`，但没人用。
- 修法：删除前把待删 issues 存进闭包，toast 给"撤销"（4s 内回填）；超过 5 条时再加一次 confirm。

### 33. 批量菜单写"切换标签"，实现只加不删
`components/views/bulk-bar.tsx:195`、`components/views/bulk-bar.tsx:202-205`

- 现象：已带该标签的议题再点一次毫无变化，提示语永远是"已为 N 个议题添加"。
- 根因：`if (issue && !issue.labelIds.includes(l.id)) data.toggleLabel(id, l.id);` —— 有则跳过，等于只加。
- 修法：照 `components/shell/quick-edit.tsx:65-80` 的正确写法：先 `allHave`，再"全有则全删、否则全加"，提示语跟随实际动作。

### 34. 未知的设置 tab 让右侧整块空白
`app/(app)/settings/[[...tab]]/page.tsx:333-334`、`app/(app)/settings/[[...tab]]/page.tsx:385-519`

- 现象：访问 `/settings/foo`（或旧链接 `/settings/workspace`）时左导航在、右侧空白，不报 404。
- 根因：`const requested = params?.tab?.[0] ?? 'preferences'; const active = requested === 'account' ? 'account' : requested;`——没有白名单校验，六个 `active === '…'` 分支也没有 `else`。
- 修法：`const active = TABS.some(x => x.key === requested) ? requested : 'preferences'`（或 `router.replace('/settings')`），并给渲染区加兜底。

### 35. 命令面板"创建议题"在非列表页静默失效；侧栏几个入口把动作名当搜索词
`components/command/command-menu.tsx:140-149`、`app/(app)/search/page.tsx:113`、`components/shell/sidebar.tsx:506`、`516`、`532`

- 现象：在 `/inbox`、`/search`、`/projects`、看板、设置页点"创建议题"，面板关闭但什么都没发生；侧栏"邀请成员"/"新动态"/设置齿轮打开的面板永远"没有结果"（中文界面尤其明显）。
- 根因：创建动作只执行 `setComposing('todo')` + `document.querySelector('[data-inline-composer]')?.focus()`，这些页面没有内联新建框，`composing` 挂着没人渲染。侧栏是 `openCommand('invite')` / `openCommand("what's new")` / `openCommand('settings')`，把动作名当成了搜索词（`fuzzyScore('invite', …)` 无匹配；中文界面里 'settings' 也匹配不到"打开设置"）。
- 修法：创建动作改成"先 `router.push('/team/ENG')` 再 `setComposing('todo')`"，focus 交给 effect 而不是 60ms 定时器；侧栏改成 `openCommand()` 空查询，或给面板加 `intent: 'create' | 'invite'`，不要复用 query。

### 36. My issues / Reviews 覆写全局筛选，离开时把旧值写回
`app/(app)/my-issues/page.tsx:9-15`、`app/(app)/reviews/page.tsx:8-13`

- 现象：在 My issues 里点了行上的标签芯片（`issue-row.tsx:120-123` 会 `toggleFilterValue('labelIds', id)`），跳走时这个筛选被还原；首帧还会先闪一下"全部议题"。
- 根因：挂载时存 `prev = filters` 并覆写，卸载时 `useView.setState({ filters: prev })` —— 把停留期间用户对 filters 的改动一起抹掉；而且这两个页面复用了 `/team` 的列表，却没有任何"当前 scope"的可视提示。
- 修法：不要改全局 `filters`：给 `selectVisibleIssues` 传页面级 `scope`（`{assigneeId: meId}` / `{status: ['in_review']}`）在 selector 内合并；或至少只在 `filters` 仍等于本页写入值时还原。

### 37. 标题清空后失焦会静默回退，界面与数据不一致
`components/issue/issue-drawer.tsx:427-434`

- 现象：把标题全删再点别处，输入框保持空白（顶部标题栏仍是旧标题），重开该议题旧标题又回来，全程无提示。
- 根因：`save()` 里 `if (value.trim() && value !== issue.title)`，空值直接不写库；而 `useEffect(() => setValue(issue.title), [issue.id, issue.title])` 依赖没变，本地 `value=''` 不复位。
- 修法：空值时复位 `setValue(issue.title)` 并给"标题不能为空"的轻提示，别让输入框停在无效状态。

### 38. 状态值不合法时抽屉直接崩（导入备份即可触发）
`components/issue/issue-properties.tsx:111`、`components/issue/issue-properties.tsx:137`

- 现象：恢复一份来自别的版本/别的工具的备份（`status: 'in-progress'` 或字段缺失），点开该议题 → `Cannot read properties of undefined (reading 'label')`，抽屉白屏。
- 根因：`const status = STATUSES.find((s) => s.key === issue.status)!` 用非空断言，随后 `t(status.label)` 直接解引用；`workspace-transfer.tsx` 的导入只校验"是不是数组"，不校验条目形状。
- 修法：`const status = STATUSES.find(...) ?? STATUSES[0]`；导入时加一层 `sanitizeIssue`（status/priority 白名单、`comments`/`activities` 补空数组、`parentId` 指向不存在的 id 时置空），把脏数据挡在 store 之外。

### 39. 看板拖拽改状态不写活动记录
`lib/store/data.ts:432-447`

- 现象：把卡片从 Todo 拖到 Done，议题状态变了，但抽屉的"活动"里没有这条变更，Pulse 也看不到；同样的事用 `setStatus` 做就会留痕。
- 根因：`moveIssue` 只 `{ ...moving, status, updatedAt: stamp() }`，没有像 `setStatus`（`data.ts:290-294`）那样 append `activity(actorId,'status',from,to)`。
- 修法：`moveIssue` 内部复用 `setStatus` 的活动逻辑（或在 `set` 里补一条 activity），并注意 `setStatus` 已有"同状态直接 return"的短路，别重复写。

### 40. 列表的"手动排序"是空功能：`reorder` 从未被调用，且忽略 `status` 参数
`lib/store/data.ts:86`、`lib/store/data.ts:449-457`

- 现象：`sort` 选"手动"时，行的顺序只是数组顺序，用户无法拖拽/上下移动；store 里那个 `reorder` 全项目零调用点（`grep reorder` 只有声明与实现）。
- 根因：列表没有实现拖动排序的交互，`reorder` 是半成品；即使接上，函数体也完全没用 `status` 参数，把跨组拖拽的 id 直接拼进同一个块会打乱其它状态的位置（`insertAt` 用的是过滤前的下标，移除元素后还会偏一格）。
- 修法：要么实现"列表行 Alt+↑↓ / 拖拽"并接上 `reorder`（同时按 `status` 分组插入、用 rest 过滤后的下标重算 `insertAt`），要么把 `sort === 'manual'` 从菜单里去掉，别给用户一个假选项。

---

## 建议本轮立即修的 8 条

排序依据：**会持续写坏数据 > 功能直接坏 > 一行能修**。第 1–2 条同一个文件，建议一次改完做回归。

| # | 条目 | 一句话理由 |
|---|------|-----------|
| 1 | **#1** 断开"写入触发自己"（内容变了才写 + 元数据别走 `set` + 409 退避） | 在线时永不停止的全量 PUT，还会让两个标签页 409 乒乓、互不落盘；这是所有"保存丢失"投诉的总闸。 |
| 2 | **#2** hydrate 的 GET 改成合并而不是整体替换 | 和 #1 是同一段生命周期：一个是写放大，一个是首屏覆盖，一起改才敢说"保存可靠"。 |
| 3 | **#3** My issues 换 `usePeople().meId` | 一行改动，修掉"我的议题永远是空"这种一眼可见的功能坏；顺手把 creatorId 也算进去。 |
| 4 | **#4** 接上 `/api/prefs`（已读状态持久化） | 后端接口和 `setReadNotifications` 都写好了，只差调用；否则"标为已读"每次刷新都白点。 |
| 5 | **#5** 鉴权失败不要放行（fail-open → error 态） | 现在是断网就等于没有登录，且会读到上一个账号的本地快照；风险与成本完全不成比例。 |
| 6 | **#6** `run()` 加重入守卫 + decisions 按 callId | `@agent` 连点两次就能让第一次的 Promise 永久挂起、日志互相覆盖，用户会以为"智能体卡死"。 |
| 7 | **#8** 描述编辑器只在切议题时重置 | 交叉同步（focus 刷新、智能体写描述）会清空正在写的描述，属于会当场被骂的丢稿。 |
| 8 | **#9** 项目进度改派生 | 一个核心数字永远 0%，改动小、收益直观（列表/详情/路线图三处同一数据源）。 |

紧随其后：**#10**（结转起点落在过去 + 可反复结转）、**#11**（看板丢 duplicate）、**#14**（亮色主题 12 个变量，纯 CSS、十分钟能改完）。

---

## 覆盖情况

已逐文件读过并纳入判断：`lib/store/{data,view,ui}.ts`、`lib/{types,mock-data,utils,selectors,cycles,i18n,use-t,use-media,recent,markdown-editable,server-auth,session,people}.ts`、`lib/server/{store,accounts}.ts`、`lib/agent/{store,tools,provider,guard,types}.ts`、`lib/locales/zh.ts`、`app/api/{workspace,auth,auth/register,prefs,members,agent/chat,agent/models,agent/config}/route.ts`、`app/{login/page.tsx,layout.tsx,globals.css}`、`app/(app)` 全部页面（team 列表/看板、inbox、projects、projects/[id]、cycles、roadmap、initiatives、pulse、reviews、search、my-issues、settings）、`components/{issue,views,shell,topbar,command,ui,agent,settings,overlays}` 全部组件。

本轮确认没问题的点（避免下轮重复审）：`lib/use-media.ts`（matchMedia 有 cleanup）、`lib/recent.ts`（storage 监听有 cleanup）、`components/ui/popover.tsx` 的 ResizeObserver（已 disconnect）、`lib/server/store.ts` 的原子写与 `withLock`、`lib/cycles.ts` 纯函数、`/api/workspace` 的入参校验与 409 语义（服务端是对的，问题在客户端触发频率）、`lib/agent/guard.ts` 的 host 白名单、`lib/people.ts` 的 `me` 兼容别名、抽屉内子议题/关系/评论的渲染与计数、`shortcuts.tsx` 的 j/k 与 shift+↑↓ 选择逻辑本身。

已知未覆盖：没有做浏览器/真机运行（纯静态阅读）；`study/`（设计取样数据）与 `.next/` 未纳入；i18n 只核对了上面点名的漏翻，没有全量键对账；未审计 Tailwind/PostCSS 层面的响应式细节；`app/(app)/initiatives`、`reviews` 这类"有意留空"的页面按设计意图处理，不记为缺陷。
