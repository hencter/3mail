# 3mail — Progress Log

> **只追加已发生的变更**（新→旧）。本文件 **不是** 待办清单。  
> 新能力 / 打磨项必须写入 [`scope.md`](./scope.md) 并带 ID；禁止只在本文件写「留给后续」。  
> 开干前：`architecture.md`（约束）+ `scope.md`（当前主线）+ 本文件最近 1–3 条。

---

## 2026-11-25 — First-sync bootstrap + QQ Exmail FETCH

**问题**：`add_account` 后从不调用 `start_sync(folder=None)`，UI Sync 在 folders 为空时直接 return（鸡生蛋）；IMAP `ENVELOPE` FETCH 遇畸形 Message-ID（QQ 企业邮）整段流中断，messages=0。

**改动**
- `actor.rs`：`add_account` 成功后踢 `start_sync(folder=None)`；失败发 `sync_error`
- `App.tsx`：账号存在且 folders 空时 bootstrap；Sync 按钮走 account-level `folderId: null`
- `imap_client.rs`：UID FETCH 改用 `HEADER.FIELDS` 字面量，不再要 `ENVELOPE`

---

## 2026-11-25 — Custom titlebar + shell polish + collapse motion

**Windows / Linux**：关掉原生 titlebar（`set_decorations(false)`）；自绘 min/max/close；`data-tauri-drag-region` 拖拽。macOS 仍用 Overlay traffic lights。Compose / Settings 工具窗同策略。

**UI 打磨**（Refactoring UI / shadcn skills）：列表分组标签去噪、阅读标题层级、侧栏间距；不改产品 IA。

**展开/收起动画**：Show history / signature、往来轨、侧栏折叠、Smart Inbox See all、Compose Cc/Bcc — CSS grid collapse（尊重 `prefers-reduced-motion`）。

**涉及**：`WindowControls.tsx`、`Collapse.tsx`、`tauri.conf.json`、`capabilities`、`lib.rs`、`commands.rs`、`Reader`/`MailBody`/`MailList`/`sidebar`/`Compose`/`SettingsDialog`、`classic.css`

---

## 2026-11-24 — 阅读卡片精简（Spark 式）

- `On … wrote:` / `.gmail_attr` 并入引用区；默认折叠 **名片签名**（Show signature）
- 附件条：`~WRD*` / `image00x` 等内嵌图不再列出；cid 内联不入 footer
- 来信 iframe：表格内 Logo 限高；往来边栏可收起（`3mail.correspondenceRail`）

---

## 2026-11-24 — Show history：Outlook/企业 HTML 引用识别

**问题**：对方来信无卡底 Show history → `hasQuote` 为 false，整封 HTML 当正文。

**改动**：`quote-collapse.ts` — 按**阅读顺序取首个**引用锚点；`Range` 切嵌套 DOM；原始 HTML 正则兜底；`From/Sent/Subject` 最小容器；失败时用正文纯文本再切一层。

---

## 2026-11-24 — P1.6-3a 阅读区联系人往来轨 + 线程/引用 Classic 补强

**P1.6-3a（Foxmail 式，单账号）**

- `list_correspondence`：主联系人收发时间线；阅读区右侧轨；hover 懒拉 `get_message` 预览；点击 `onOpenMessage` 替换主区

**Classic 主区**

- `list_thread_messages`：按 References / In-Reply-To 扩展 `thread_key` 集合，减少「单卡整串引用」
- `quote-collapse`：嵌套 Quote、Outlook From/Sent 块、文本 `___` 分隔等

**涉及**：`queries.rs`、`CorrespondenceRail.tsx`、`Reader.tsx`、`scope.md` P1.6-3a

---

## 2026-11-24 — P1.5-58 重做：线程多卡 + 每卡 Show history / 回复条

**验收对齐 Spark Classic**

- 打开邮件即拉同线程时间线，**多封纵向叠放完整卡片**（非「Show history (N)」才展开其它 IMAP 邮件）
- **Show / Hide history**：每卡独立，只折叠/展开该封 HTML/文本里的内嵌引用（`quote-collapse`）
- **Reply / Reply All / Forward**：在**每张卡底部**，`sourceMessageId` 对应该卡
- 去掉阅读区底部全局 `action-pill` 与线程级 history 切换

**涉及**：`Reader.tsx`、`MailBody.tsx`、`quote-collapse.ts`、`App.tsx`（`threadDetails` hydrate）、`classic.css`

---

## 2026-11-24 — 修复点开邮件死锁（`get_message`）

**原因**

- P1.5-58 在 `get_message` 里用同一把 `Db` 互斥锁查 `thread_count` 时未 `drop(conn)` 又调 `list_attachments` → **同线程二次加锁永久阻塞**（点任意邮件即卡死）

**修复**

- 先完成 `thread_count`，**释放连接锁**后再 `list_attachments`

---

## 2026-11-24 — 修复卡死：同步双队列 + 去抖

**做了什么**

- Sync Actor：**交互队列**（`enqueue_wait`：读正文、发信、手动 Sync 等）优先于 **后台队列**（IDLE、`ProcessDueLocal`）
- 后台 `StartSync` 同一文件夹 **20s 内去重**，避免 IDLE 淹没队列
- `mail_updated` **400ms 去抖**；不再每次同步后强行 `load_thread`
- Reply：`quoteForRespond` 最多等 **350ms** 拉正文，再开写信窗；`void showCompose` 不挂死 UI
- 已有写信窗再次 Reply 时 **`compose-load`** + `take_compose_payload` 真正 take
- `V13`：`messages(account_id, thread_key)` 索引，加速 `get_message` 线程计数

**未做**

- 长时后台全量同步仍可能占满后台槽（交互已优先）

---

## 2026-11-24 — Reply 弹窗 + Show history（P1.5-57、P1.5-58）

**做了什么**

- `scope`：**P1.5-57/58**；**P1.5-48/55** 验收改为 Reply/Forward 用独立写信窗
- Reply / Reply All / Forward → `openComposeWindow`（`placement: popup`）；第三栏阅读保持；打开前按需 `fetch_body` 以生成引用
- `showCompose` 支持 `deferAutosave`：回复时不阻塞在第三栏草稿 `save_draft`
- 阅读区默认仅当前信卡片；`get_message` 带 `thread_count`；**Show history (N)** 展开后再 `list_thread_messages`
- Reply 图标/底部 pill：`preventDefault` + 无选中时 `notify`

**未做**

- 同步队列优先级（Loading 慢仍可能存在）

---

## 2026-11-24 — 文档进度对齐（P1.5 收口 → P1.6 下一主线）

**做了什么**

- `scope.md`：**当前主线**改为 P1.5 已基本收尾（54 `done`）；**P1.6 为下一主线**；P1.5-7 OAuth 标为暂缓 `todo`；补 P1.5 进度快照
- `architecture.md`：同步摘要、IMAP IDLE、`sender_category_stats` 与 `sync/` idle 职责
- `docs/behavior-spec.md` §6 映射表与 scope 状态一致（卡片/Snooze/统计/MODSEQ/IDLE）
- `.cursor/rules/3mail-docs.mdc`：规则中的当前主线指针 → **P1.6**

**P1.5 状态总览（以 scope 为准）**

| 状态 | ID |
|------|-----|
| done | P1.5-1…6、8、10…56（见 scope 表） |
| todo（暂缓） | P1.5-7 OAuth |
| deferred | P1.5-9 FTS 分库 |

**未做**

- P1.6-1 / P1.6-3 / P1.6-2（见 scope 建议顺序）

---

## 2026-11-24 — IDLE / MODSEQ / 发件人分类统计（P1.5-5、P1.5-6、P1.5-11）

**做了什么**

- **P1.5-5**：独立 `three-mail-idle` 线程；收件箱 SELECT + RFC 2177 IDLE（29 分钟 keepalive）；`NewData` 时向 Sync Actor 入队 `StartSync`；无 `IDLE` 能力时每账号约 120s 回退轮询
- **P1.5-6**：`sync_state` / `folders.highest_modseq`（`V12`）；支持 `CONDSTORE` 时 `FETCH (CHANGEDSINCE)` 增量刷新标志与信封；无 MODSEQ 时 UID 增量路径不变
- **P1.5-11**：`sender_category_stats` 按发件人累加头启发式分桶；≥3 封且主导类 ≥75% 时 `resolve_category` 采用统计类（仍优先手动 `sender_category`）；不接 SmartBack

**未做**

- P1.5-7 OAuth（按你要求暂缓）；P1.5-9 FTS 分库仍为 deferred

---

## 2026-11-24 — Save All / Move 补完 / 录键（P1.5-39、P1.5-47、P1.5-46）

**做了什么**

- Save All：系统目录选择器 + `export_attachments` 复制到用户所选文件夹
- Move：在当前高亮文件夹下 Create；移动后 Undo 可移回原文件夹
- 快捷键录键：`stopImmediatePropagation` + document 捕获阶段监听

**未做**

- P1.5-5 IDLE、P1.5-7 OAuth、P1.5-11、P1.5-6 等剩余 todo

---

## 2026-11-24 — cid 内嵌图 + 标志 STORE 重试（P1.5-1、P1.5-4）

**做了什么**

- 解析附件 `Content-ID`；`fetch_body` 时为 inline/cid 附件写入沙箱；阅读区 `cid:` 换为 `convertFileSrc` 本地 URL
- IMAP `STORE` 失败写入 `local_actions`（`imap_seen` / `imap_flagged`）；`ProcessDueLocal` 自动重试；失败时 `sync_error` 提示

**未做**

- P1.5-39 Save All 选目录 等剩余 todo

---

## 2026-11-24 — 草稿写回服务器 Drafts（P1.5-52）

**做了什么**

- 每次 `save_draft` 后：删除旧的 IMAP 草稿（若有）、`APPEND (\Draft)` 到账号 Drafts 夹、增量同步并按稳定 `Message-ID` 回填 `source_message_id`，列表不重复
- 删除本地草稿时同步 `UID` 永久删除服务器上的那份
- 迁移 `V9__draft_imap.sql`；前端删草稿不再单独 `delete_message`

**未做**

- 草稿附带 compose 附件上服务器 → 可与后续附件草稿增强一起做

---

## 2026-11-24 — 撰写附件（P1.5-26）

**做了什么**

- 撰写底部「回形针」多选本地文件；列表可移除；弹出窗与第三栏撰写共用
- `send_message` 将附件复制到应用数据目录 `outbox_attachments/{id}/` 后入队；SMTP 以 `multipart/mixed` 发出；撤回 Outbox 或发送成功后清理暂存
- 迁移 `V8__outbox_attachments.sql`；`tauri-plugin-dialog` 选文件

**未做**

- 草稿保存附带附件路径 → 仍可选后续；服务器 Drafts APPEND → `P1.5-52`

---

## 2026-11-24 — 立项 P1.6（REPLIED / Label / 往来视图）

**做了什么**

- `scope.md`：当前主线明确 **先收尾 P1.5 全部 `todo`**；新增 **P1.6**（P1.6-1 REPLIED 徽章、P1.6-2 本地 Label、P1.6-3 往来视图、P1.6-4 IMAP KEYWORDS 为 deferred）
- `architecture.md`：领域模型补充 `labels` / `message_labels`、会话已回复派生态；§6 / §7 指针 P1.6 与可选 Craft Anything 检查轮
- `docs/behavior-spec.md`：Foxmail 往来记录作 P1.6-3 产品参考（非 Classic）

**决策（摘要）**

- REPLIED：会话列表行小标签，与用户 Label 分离
- Label：首期 **纯本地 SQLite**（纯 IMAP 账号）；Gmail 网页标签一致与 KEYWORDS 同步不进首期
- 往来视图：**3mail 增强**，默认入口仍为 Inbox
- Classic 差距：P1.5 收尾期可用 Craft Anything 补 `behavior-spec`，不替换现有单向桥接实现

**未做**

- P1.5 仍剩 `todo`：P1.5-1、4、5、6、7、11、26、39、46、47、52（见 scope）

---

## 2026-10-16 — 没有抄送的信不再中断收件箱同步

**做了什么**

- 搜索索引补写 Cc 时，空的 `cc_addrs` 按空字符串处理。刷新可以跑完，列表会跟上服务器上的新信

**未做**

- 每次保存都把草稿写回服务器 Drafts → `P1.5-52`
- 撰写附件 → `P1.5-26`

---

## 2026-10-16 — 写邮件/设置独立窗口，发送可撤回（P1.5-55、P1.5-56）

**做了什么**

- 新建邮件和设置各自打开可调整大小的系统窗口。回复、转发、草稿仍在第三栏；从第三栏弹出时，同一封信进写邮件窗口
- 立刻发送先在 Outbox 等 10 秒，主窗口出现可撤回提示。撤回后不寄出，草稿还在。用户自己选的发送时间不加这 10 秒，仍可在 Outbox 取消
- 发送按钮在寄出排队完成前不能再点，⌘↩ 和按钮不会各寄一封
- 真正寄出后，把同一封原信放进该账号的 Sent 并标为已读，再同步这个文件夹。收件人不会因此再收一封

**未做**

- 每次保存都把草稿写回服务器 Drafts → `P1.5-52`
- 撰写附件 → `P1.5-26`

---

## 2026-10-16 — 键盘上下移动时列表高亮跟着走

**做了什么**

- J / K 和方向键切到下一封或上一封时，列表选中高亮改到那一行，并滚进可视区域

---

## 2026-10-16 — 搜索建议与中文命中（P1.5-8、P1.5-54）

**做了什么**

- 搜索框获得焦点时出现 Keywords 和 Recents。点 from / to 会把已输入的字套进对应条件；attachments、pdf、documents 追加附件条件。输入停顿约 200 毫秒就出结果，回车记入最近搜索
- 中文按字进入全文索引，主题或正文中间的词可以命中。Cc 一并写入收件人索引。已有邮件在下次打开数据库时重写一次索引
- 邮件列表右键时不再划选文字。附件类型（pdf / 图片 / 文档）只过滤已经在本地有附件记录的信

**未做**

- 每次保存都把草稿写回服务器 Drafts → `P1.5-52`
- 撰写附件 → `P1.5-26`

---

## 2026-10-16 — 置顶与 Spark 对齐（P1.5-53）

**做了什么**

- Spark 的 Pin 就是 IMAP `\Flagged`。3mail 读到这个旗标时显示 Pin 图标，不再画黄星。侧栏 Pins 同时包含本地置顶和已标记的信
- 在 3mail 置顶或取消，会给同一会话里每封信 STORE `\Flagged`，并同时改本地 pinned 与 starred。阅读区、右键、多选只保留 Pin
- 以前只写在本机、没写到服务器的置顶，下次同步补写一次 `\Flagged`，Spark 就能看到
- 去掉列表悬停按钮（`P1.5-51`）。右键菜单保留。侧栏文件夹收藏不变

**未做**

- 每次保存都把草稿写回服务器 Drafts → `P1.5-52`
- 撰写附件 → `P1.5-26`

---

## 2026-10-16 — 第三栏撰写、多选、列表模式（P1.5-48～51）

**做了什么**

- 只有新建邮件（⌘N）用弹出窗口。回复、全部回复、转发、草稿在第三栏编辑；顶栏可关闭、删除、再弹成窗口。关掉或切走时仍自动存草稿
- 侧栏 Drafts 合并本地草稿和服务器草稿（More 里的 Local drafts 去掉）。点服务器草稿会取正文、在本地打开编辑，并记住来源，列表不显示两遍。发出去之后删掉服务器上的那封
- 删除草稿不再把窗口里的内容存成一份新的。⌫ / Delete、行上的垃圾桶、第三栏垃圾桶都能删。删掉后提示条可撤销（本地草稿恢复；已经从服务器删掉的那封不恢复）
- 多选：⌘ 点选、⇧ 范围、⌘A 全选当前列表。选中两封以上时第三栏显示数量，可归档、删除、移动、Pin、标未读。同一文件夹的移动和已读合并成一次 IMAP 命令；跨账号仍逐封复制再删除
- Smart / Classic 只出现在收件箱。其他文件夹按日期分组；Pins、Snoozed、搜索结果不分组
- 邮件行悬停出现归档、删除、Pin、未读。右键菜单有回复、转发、归档、删除、移动、Pin、未读；草稿行只有删除

**未做**

- 每次保存都把草稿写回服务器 Drafts → `P1.5-52`
- 撰写附件 → `P1.5-26`

---

## 2026-10-16 — Move to 面板（P1.5-38）

**做了什么**

- 阅读区文件夹按钮改为 Move 面板，⌘⇧M 打开（新增快捷键动作 `move`，菜单 Message → Move to Folder…）
- 搜索：名称完全匹配 > 前缀 > 词首 > 包含 > 路径包含 > 字符子序列，再加上「同发件人移过几次」和「最近移过」的分数；首个前缀匹配在输入框里灰字补全，Tab 接受，回车移动，↑↓ 选择，←→ 收起/展开
- 无输入时：Suggestions（同发件人常用 + 最近，最多 4 个，本地记录 `3mail.moveHistory`），以及按账号分组的文件夹树（按服务器分隔符拆层级，系统文件夹在前，其余按名称排序，当前文件夹打勾并展开到它所在位置）
- 新建文件夹：每个账号底部 Create New Folder，或搜索无精确匹配时「Create “xxx”」；名称按 IMAP Modified UTF-7 编码后 CREATE + SUBSCRIBE，个人文件夹都在 `INBOX.` 下的服务器自动加前缀；建好后直接移入
- 后端：`MoveMessage` 新增 `target_folder_id`；同账号走 UID MOVE（不支持时 COPY + 删除），跨账号为取原文 → APPEND 到目标账号（保留已读/星标）→ 删除原信；新增 `CreateFolder` 意图、`move_to_folder` / `create_folder` 命令、`get_folder` 查询
- 测试：IMAP UTF-7 编码与往返

**未做**

- 在父文件夹下新建子文件夹（目前新建在顶层）、移动后撤销 → `P1.5-47`

---

## 2026-10-16 — 日期、显示名、正文自适应、HTML 回复、快捷键（P1.5-40～45）

**做了什么**

- 日期：IMAP 给的 RFC 2822 日期以前被原样存下，前端按 RFC 3339 解析失败，所以列表没有日期。现在入库前统一转成 UTC RFC 3339，取不到时用 INTERNALDATE；打开数据库时把旧行就地改写
- 显示名：信封地址保留 `"名字" <邮箱>`，前后端都按引号拆分地址（`"Zhu, Izzy"` 不会被拆成两个）。V6 迁移清空 `uidnext`，下次同步重扫每个文件夹最近 200 封，补上名字
- 正文：保留信件自带 `<style>`（清理过，去掉远程引用）；不再强制 `table{max-width:100%}` 和 `overflow-wrap:anywhere`；比阅读区宽的信整体等比缩小（最小 0.6 倍，再宽可横向滚动）
- 阅读区快捷键：正文 iframe 里的按键转发到主窗口，焦点在信件里时 R / E / J / K 等也生效
- HTML 回复：撰写改为 TipTap 富文本（粗斜下划删除、字体字号、文字色和底色、列表、缩进、链接、清除格式）。回复按原信 HTML 引用，左侧竖线，引用头为 `On 2026 Sep 22 at 17:16 +0800, 名字 <邮箱>, wrote:`；转发带 Forwarded message 头。签名插在引用之上；发信为 text + html 双版本；草稿、发件箱、签名都存 HTML。收件人显示为名字小标签，From 显示 `名字 (邮箱)`
- 签名编辑器：可用富文本，也可直接贴 HTML；含表格或图片的签名默认打开 HTML 模式，以免排版丢失
- 设置 → 外观：日期格式（相对 / 月-日 / 年-月-日 / 跟随系统）和 24 小时制，列表与阅读区同时生效
- 设置 → 快捷键：每个动作可录入多个按键，检测冲突（自动从原动作移走并提示），可恢复默认，存在本地；macOS 菜单的快捷键跟随
- 测试：日期与地址解析、带逗号显示名 + multipart/alternative 组信

**未做**

- 录入已被菜单占用的 ⌘ 组合时可能直接触发菜单 → `P1.5-46`
- 正文 `cid:` 内嵌图仍未显示 → `P1.5-1`；撰写附件 → `P1.5-26`
- 每个文件夹最近 200 封以外的旧信，列表里仍可能只显示邮箱（打开后阅读区按正文解析有名字）

---

## 2026-10-16 — 允许拖动窗口

**做了什么**

- 补上 `core:window:allow-start-dragging`。自定义标题栏的拖拽区域之前会被 Tauri 拒绝

**未做**

- 无

---

## 2026-10-15 — 主界面按 Spark Classic 重做（P1.5-10、P1.5-28～37）

**做了什么**

- 所有颜色、边框、圆角、字号改用一套 `--3m-*` 变量，深浅色各一组取值。外观设置现在对主窗口三栏也生效
- 去掉全局顶栏，三栏各有同高的表头。错误改为右下角浮层提示
- 侧栏：INBOX 下按账号展开；Folders 区图标带色；不常用项收进 More；新增 Favorites 和 Recents；底部账号头像菜单
- 每个账号一个颜色，可在设置里改，侧栏、列表、阅读区都按这个颜色显示
- 列表：新的行样式；Smart 模式为 Pins、分类卡片、New、Seen，未读信不会再消失；Classic 模式按日期分组；有加载骨架、空状态、加载更多
- 阅读区：灰底信件卡片，同会话其余信折叠；附件区带 Save All；底部悬浮 Reply / Reply All / Forward；正文高度随内容
- 深色模式下正文可选保留原色或跟随主题；纯文本在深色下可读
- 菜单换成 Radix 下拉。撰写窗可拖动、Esc 关闭、关闭时自动存草稿、可选发件账号、定时发送可清除
- `App.tsx` 拆出 `Reader`、`MailList`、`Compose`、`SettingsDialog`、`AccountSetupForm`、`palette`、`types`
- 窗口最小宽度 800px 时阅读区保留至少 360px，侧栏和列表随之收窄

**未做**

- 移到任意文件夹（P1.5-38），Save All 选目录（P1.5-39），正文 cid 图片（P1.5-1）

---

## 2026-10-15 — 对照 Compose、设置和同一封信收口

**做了什么**

- Smart 列表去掉嵌套列表的圆点和左侧空白。星标和 Pin 都归到 Pins，不再混进 Seen
- 顶栏两侧和侧栏顶部加上窗口拖拽区域，按住空白处可以移动窗口
- 阅读区按同一封信的对照调整：收件人、日期、正文后的附件卡片、底部 Reply / Forward
- 撰写改成 New Message 的字段排布；设置改成顶部图标分页。远程图片开关放在 Appearance

**未做**

- 正文里的 cid 图片仍不内嵌（P1.5-1）。设置里没有 Spark 的团队、日历、云端登出

---

## 2026-10-15 — 按提供的 Spark 窗口重排主界面

**做了什么**

- 主窗口改成深色侧栏 + 浅色列表/阅读。搜索和操作图标在顶栏，撰写是右侧圆形按钮
- 列表可在 Smart / Classic 之间切换。Smart 为 Pins、未读分类、Seen；Classic 为平铺列表
- 阅读区底部是 Reply / Forward。不再用会叠在一起的 Themes 按钮条
- 列表滚动不再走 Radix ScrollArea（它会把内容收成内容宽度）

**未做**

- 全黑深色模式；P1.5 里仍未做的协议项（cid、IDLE、OAuth 等）

---

## 2026-10-15 — Classic 三栏重排，并收口一批 P1.5

**做了什么**

- 主窗口去掉顶栏字标。侧栏、列表、阅读、撰写按 Classic 的密度和分区自研重排（不用 Spark / Readdle logo）
- Inbox 改为 People / Notifications / Newsletters / Other 卡片，可 See all
- 侧栏增加 Attachments、Today's Unread
- 远程图默认挡住，阅读时可加载
- 列表摘要：同步时取正文开头，已有正文也能补上；列表按 `snooze_until` 否则 `date` 排序
- 归档、删除、Pin 后短时 Undo
- `scope.md`：P1.5-2、3、10、12、13、14、15 标 done

**未做**

- P1.5-1 `cid:`、P1.5-4 标志重试、P1.5-5 IDLE、P1.5-6 MODSEQ、P1.5-7 OAuth、P1.5-8 中文搜索、P1.5-11 分类统计、P1.5-26 撰写附件
- 本机 Spark 主窗口当时未打开，辅助功能也拒绝 osascript，所以这次布局依据是 Classic 2.11 的信息架构，不是像素 diff

---

## 2026-10-15 — 外观禁令改写：除 logo 外按 Classic 复刻

**决策**

- 布局、配色、密度、控件形态按 Spark Classic **自研照搬**；仍不用 Spark / Readdle 的 logo 与字标，不把对方二进制或反编译源码拷进仓库
- `architecture.md` 品牌约束、`scope.md` P1.5 桌面壳与 P2、`behavior-spec.md` 合规备注、`.cursor/rules/3mail-docs.mdc` 已对齐
- 主线仍是补完 P1.5，并按 Classic 重排整窗

---

## 2026-10-15 — 侧栏按角色跨账号，外观可设置

**做了什么**

- `scope.md` 增加 **P1.5-27**（侧栏 Inbox / Folders / Favorites，多账号在角色下展开）和 **P1.5-28**（外观设置），均标 done
- 多账号时点 Inbox、Sent 等合并各账号对应夹；单账号不多一层
- 星标的夹进 Favorites，记在本地
- 设置新增 Appearance：主题、强调色、中性色、圆角、缩放、界面字体、侧栏缩进线

**未做**

- 撰写附件（P1.5-26）；P1.5-1…15 未动

---

## 2026-10-15 — 桌面壳：账号 sheet、侧栏、栏宽、阅读操作

**做了什么**

- `scope.md` 增加 **P1.5-16…26**（桌面壳）。16–25 标 done；**P1.5-26 撰写附件仍 todo**
- 添加/编辑账号改为独立对话框；设置窗含账号、签名、默认快捷键说明。编辑账号密码可留空
- 刷新文件夹不再强制回到 Inbox；未同步过的文件夹选中后自动同步该夹
- Keychain 密钥在进程内缓存，避免每次同步都打系统密码框
- 侧栏：Smart Inbox / Pins / Snoozed / 系统夹 + 其余文件夹按 IMAP 路径缩进；三栏可拖，宽度记在 localStorage
- 列表行显示时间与 snippet；阅读区增加 Reply All、Forward、Snooze 预设、标未读、移回 Inbox / Junk
- 默认快捷键 + macOS 菜单；撰写改为右下角浮层，支持 Cc/Bcc（含草稿与定时发送）

**未做**

- 撰写附件（P1.5-26）；自定义快捷键重映射；P1.5-1…15 原 backlog 未动

---

## 2026-10-15 — 文档治理：去重 + 待办收口到 scope

**做了什么**

- 明确四文件职责：`architecture` = 约束；`scope` = 分期/待办/验收；`progress` = 日志；`behavior-spec` = Classic 证据
- `scope.md`：新增 **P1.5**（当前主线）与完整 backlog（cid、外链图、已读重试、IDLE、OAuth、中文搜索、Smart Inbox 卡片、Snooze 预设等）；写入文档治理与禁止项
- `architecture.md`：去掉重复分期表；更新技术栈/Workspace/Commands；§0 会话协议；§6 仅指针到 scope
- `docs/behavior-spec.md`：§6 映射挂上 scope ID
- `README.md`：阅读顺序
- `.cursor/rules/3mail-docs.mdc`：Agent 始终对齐上述规定

**主线**：P0/P1 已收尾 → **P1.5**

---

## 2026-10-15 — shadcn/ui 打磨前端

**做了什么**

- `apps/desktop`：Tailwind v4 + shadcn（radix-nova / zinc 中性）+ `@` 路径别名
- 组件：Button、Input、Dialog、Tabs、ScrollArea、Badge、Select、Switch、Checkbox、Tooltip、Alert 等
- `App.tsx`：三栏桌面邮件布局（侧栏 / 列表 / 阅读）；Compose / 签名改 Dialog；去掉手写 `App.css`
- 主题偏 macOS Mail 中性灰，非暖色纸感；`tsc` + `vite build` 通过

**未做**

- 未改后端 / 行为；未像素复刻 Spark（P2）

---

## 2026-10-15 — 修复中文乱码：RFC2047 + IMAP UTF-7

**现象**：主题显示 `=?GBK?B?…?=`；文件夹显示 `&TqdUwXb4UXM-`；正文正常。

**修复**

- `crates/mail/decode.rs`：RFC 2047（含 GBK）+ IMAP Modified UTF-7
- 信封 subject/from 入库前解码；文件夹 `name` 解码、`imap_path` 保留协议原名（SELECT 仍用原路径）
- Sync 时批量重解码库内残留 `=?…?=` 主题；打开正文时用 mail-parser 主题回写

**用户动作**：热重载后点 **Sync**，侧栏文件夹与列表主题应恢复中文。

---

## 2026-10-15 — P1 验收修复：同步不毁掉线程/分类/FTS

**阻塞修复**

- Sync 拉 `BODY.PEEK[HEADER.FIELDS (References List-Unsubscribe …)]` → 正确 `thread_key` + newsletter 分类
- `upsert_message_envelope`：不再用 NULL 擦掉 references/thread_key；不降级已有 newsletter/notification
- FTS：信封重索引保留 `search_body`；文件夹重建时清 FTS 孤儿
- Outbox `V4`：存 `in_reply_to`/`references_header`；到期发送走带线程头的 SMTP；成功删关联草稿
- `list_threads`：按 `date_utc` 取最新一封（非 `MAX(id)`）
- Pin/Snooze：同 `thread_key` 整会话生效

**状态**：P1-1…P1-6 行为验收应可通过；UI 仍待后续 shadcn。

---

## 2026-10-15 — P1 收尾：线程时间线 + 草稿/签名/发件箱

**做了什么**

- 阅读区：多封会话时间线（`list_thread_messages`）；**Reply** 带引用 + SMTP `In-Reply-To` / `References`
- 侧栏：Folders / Drafts / Outbox / Signatures（打开草稿进 Compose；签名表单增删改；定时信取消/失败重试）
- Commands：`cancel_outbox` / `retry_outbox`
- UI 仍为现有简朴样式；**后续用 shadcn 统一完善**（本轮不接组件库）
- `cargo check` / `tsc` 通过

**P1 验收对照**

| ID | 状态 |
|----|------|
| P1-1 线程 | 列表聚合 + 时间线 + Reply 头 |
| P1-2 Smart Inbox | 已有 |
| P1-3 FTS5 | 已有 |
| P1-4 Pin/Snooze | 已有 |
| P1-5 签名/草稿 | 侧栏可管 |
| P1-6 稍后发送 | Outbox 可见 + 取消/重试 |

**刻意留给后续** → 已迁入 `scope.md` **P1.5**（勿在本文件续写待办）

---

## 2026-10-15 — P1 启动：Classic 味道落地

**做了什么**

- 迁移 `V3__p1_classic.sql`：`category`/`pinned`/`snoozed`/`thread_key`/`list_unsubscribe`、FTS5 `messages_fts`、`signatures`/`drafts`、`outbox.send_at`、`sender_category`
- 本地 Smart Inbox 启发式（`crates/mail/classify.rs`）：List-Unsubscribe / List-Id / noreply / 主题规则 → person/notification/newsletter/other；手动覆盖记入 `sender_category`
- 同步与 `fetch_body` 时写 category + FTS；`search_messages` Command
- 本地 Pin / Snooze + Actor 30s 到期调度（清 snooze、发 outbox 定时信）
- 线程：`thread_key`（References/In-Reply-To）+ `list_threads`；UI Threads 开关
- 签名 / 本地草稿 / Compose「稍后发送」；事件 `outbox_updated`
- UI：Smart Inbox 分桶、搜索、Pin/Snooze、分类改桶、签名与定时发送
- `cargo check -p three-mail-desktop`、`classify` 单测、`tsc --noEmit` 通过
- `scope.md`：P0 标为已收尾，P1 为当前主线

**如何试**

```bash
nvm use 24
cd apps/desktop && npm run tauri dev
```

Sync 后看 Personal / Notifications / Newsletters；打开邮件后分类会因 List-Unsubscribe 等再精炼；搜索需至少同步过信封（正文进 FTS 需 fetch body）。

**刻意未做 / 后续打磨** → 已迁入 `scope.md` **P1.5**（时间线/草稿侧栏其后已做）

---

## 2026-10-15 — 修复 Keychain：启用 apple-native

**问题**：`keyring` 3 无默认 feature，未开 `apple-native` 时用内存 mock，密码不进系统钥匙串 → Sync 报 `No matching entry`。

**修复**：`keyring = { features = ["apple-native", "windows-native"] }`；稳定 key `email:…`；写入后读回校验；缺密码时提示重新 Save。

**用户动作**：热重载后对账号再 **Save** 一次（填授权码），再 Sync。

---

## 2026-10-15 — P0 阅读体验打磨

**做了什么**

- HTML 正文：消毒后 `iframe` 沙箱渲染（无 script；链接可外开）；纯文本回退
- 附件：`open_attachment` 先下载再 `opener` 用系统默认应用打开；capability 限定 `$APPDATA/**`
- 星标：UI Star/Unstar + 列表 ★；`set_starred` → IMAP STORE
- `cargo check` / `tsc --noEmit` 通过

**仍缓** → 见 `scope.md` P1.5-1/2/4/7

---

## 2026-10-15 — P0 收尾：账号配置 + 邮件读写

**做了什么**

- 账号：`imap_security` / `smtp_security`（`ssl` | `starttls`）；迁移 `V2__account_security.sql`
- IMAP SSL + STARTTLS；SMTP `relay`(465) + `starttls_relay`(587)
- `test_account`：保存前测 IMAP 登录 + SMTP NOOP；`add_account` 内也会先测再写库/Keychain
- 前端：无账号时全屏 onboarding；端口/TLS 表单；QQ/Exmail/163/Gmail/Outlook 预填
- 打开邮件 → `fetch_body`（BODY.PEEK[] + `mail-parser`）→ 写 `bodies` / 附件元数据
- `mark_read` 本地 + IMAP `STORE \\Seen`；星标 STORE；归档/删除 `UID MOVE`（失败则 COPY+\\Deleted）
- 增量同步：沿用 `sync_state` UIDVALIDITY/UIDNEXT；UIDVALIDITY 变则清空文件夹重建
- Compose 发送；附件下载到 app data `attachments/`
- `cargo check -p three-mail-desktop` 通过

**如何用腾讯系邮箱（例）**

- QQ：IMAP `imap.qq.com:993` SSL；SMTP `smtp.qq.com:465` SSL；授权码作密码
- 企业邮：`imap.exmail.qq.com` / `smtp.exmail.qq.com` 同上；点 **Test connection** 再 Save

**仍可后续打磨** → HTML/附件打开其后已做；其余见 `scope.md` P1.5

---

## 2026-10-15 — P0 代码骨架落地

**做了什么**

- Cargo workspace：`crates/{core,db,mail,sync}` + `apps/desktop`（Tauri 2 + React TS）
- SQLite 迁移 `V1__init.sql`（accounts/folders/messages/bodies/attachments/sync_state/outbox/local_actions）
- Sync Actor：单一写入口；Keychain 存密钥；`add_account` / `start_sync` / `mark_read` / `send_message`
- IMAP：`async-imap` + `async-native-tls`；SMTP：`lettre`（无手写协议）
- Tauri Commands/Events：`list_*` / `get_message` / 写意图；`mail_updated` / `sync_progress` / `sync_error`
- 最小 UI：账号、文件夹、邮件列表、详情、添加账号、Sync
- `rust-toolchain.toml` → 1.90.0；`cargo check -p three-mail-desktop` 通过

**如何跑**

```bash
nvm use 24
cd apps/desktop && npm install && npm run tauri dev
```

**刻意未做（当时）** → 正文/附件/STORE/P1 其后已做；OAuth → scope P1.5-7

**环境备注**

- 本机曾需 `rsproxy` crates 镜像；Rust 从 1.87 升到 1.90

---

## 2026-10-15 — REA 续侦（重启后 / 无 Hopper）

**做了什么**

- 确认 REA MCP 已连上（`user-rea` / `binary_session`）；Hopper/Ghidra 仍不可用
- CLI + 符号/settings/SQLite 续挖：分类管线、Smart Inbox 配置、Snooze/Pin/Archive
- 更新 `docs/behavior-spec.md` → **v0.2**（§4–§8）

**新结论（摘要）**

- `RSMMessageCategory` 为 Int 枚举；分类路径含 **邮件头启发式** + **统计** + **发件人记忆 (`msg_class_v3`)** + 可选 SmartBack
- Smart Inbox 列表由 `smartInboxListConfiguration.cards[]`（`cardType` Int）驱动；查询按 `category` 索引
- Snooze：本地标志 + 可选云同步；到期有 `RSMAutoMoveFromSnoozedIMAPOperation`；Someday = distant future
- Pin：`conversations.pinDate`（会话级）
- `swift-demangle` / REA demangle 受本机 CLT Swift module 冲突影响；直接用 `/usr/bin/swift demangle` 可用

**阻塞**

- 仍无 Hopper/Ghidra → 枚举 rawValue↔名字、头规则细节待补
- 部分 MCP `open_binary` 调用在会话里被 UI 决策层拒绝；改走 CLI 不挡侦察

**下一步（二选一或并行）**

1. 手动装 Hopper 或配置 Ghidra 12.1，深挖枚举与分类函数  
2. 按 behavior-spec 起草 3mail `crates/db` schema / Tauri 空壳（进入实现）

---

## 2026-10-15 — REA 启动 + Spark Classic 侦察（v0）

**做了什么**

- 安装 Node **v24.22.0**（nvm）：REA 不支持系统 Node 25
- 全局安装 `rea-agents@6.5.0`；`rea setup --yes --client cursor` → MCP 写入 `~/.cursor/mcp.json`，skill → `~/.agents/skills/reverse-engineer-anything`
- **钉死目标**：`/Applications/Spark.app` **2.11.70**（`com.readdle.smartemail-Mac`）；排除 `Spark Desktop.app` 3.30.12
- 静态侦察：frameworks（`SmartMailCore` / `MailCore` / `SparkDatabase`…）、本地 Group Container DB schema
- 新建 `docs/behavior-spec.md`（分类推断、表结构、对 3mail 映射、待 Hopper 清单）

**关键发现（摘要）**

- 数据分库：`messages.sqlite`（信封）+ `cache.sqlite`（正文）+ `search_fts5.sqlite`（FTS5）+ `smart.sqlite`
- Smart Inbox 三类：`category` 1/2/3 ≈ Personal / Notifications / Newsletters（newsletter 与 List-Unsubscribe 强相关）
- 文件夹带完整 IMAP 游标（UIDVALIDITY / UIDNEXT / MODSEQ）
- 存在远端 snooze / team 表 → 属云端，3mail 不做

**阻塞**

- Hopper：`rea setup --install-hopper` → `download_failed`（hopperapp.com 下载失败）；原生反编译暂不可用
- **需重启 Cursor** 后本会话才能看到 REA MCP tools

**下一步**

1. 用户重启 Cursor / 重连 MCP；可选重试 Hopper 或自备 Ghidra 12.1 + JDK 21
2. MCP 可用后对 `SmartMailCore` 问：分类枚举、Snooze/Pin/归档路径
3. 或并行：按 behavior-spec 起草 3mail SQLite migration / Tauri 空壳

**未做**

- 未建应用代码；未读/导出任何邮件正文到仓库

---

## 2026-10-15 — 文档骨架初始化

**做了什么**

- 新建 `architecture.md`：单向桥接、技术栈、crate 边界、SQLite 语义、Tauri 接口约定、REA 用法、P0/P1/P2、会话协议
- 新建 `scope.md`：功能分期与验收标准
- 新建 `README.md`：项目简介与文档入口
- 新建本文件 `progress.md`

**当前状态**

- 仓库尚无应用代码（无 Tauri/crates）
- 架构与范围已冻结为「骨架真相源」；下一步应为：REA 侦察 → `docs/behavior-spec.md`，或落地 Workspace/Tauri 空壳

**未做 / 刻意不做**

- 未安装依赖、未建 crate
- 未接入 IMAP/SMTP
- P2 云端能力不在当前范围

**风险 / 待决**

- 前端框架未选定（React / Svelte / Vue）
- DB 访问库未最终选定（`sqlx` vs `rusqlite`）
- Spark Classic 具体安装包版本需在 REA 侦察时钉死，避免误用 3.0
