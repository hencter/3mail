# 3mail — Architecture

> 目标：用 Rust + Tauri 做 **Spark Classic 风格**（非 Spark 3.0）的桌面邮件客户端。  
> 数据流采用 **单向桥接**；协议层 **只用成熟库**，严禁手写 IMAP/SMTP socket 命令。  
> REA（https://rea.tools/）用于还原 Classic 的产品行为与数据语义，**实现全部自写**。

本文是 **架构与硬性约束** 的唯一真相源。  
**功能分期 / 待办 / 验收** 只看 [`scope.md`](./scope.md)，本文不维护第二份清单。

---

## 0. 文档治理（后续会话对齐）

| 文件 | 真相源职责 |
|------|------------|
| **本文** | 约束、数据流、技术栈、crate、领域语义、Commands/Events、安全 |
| [`scope.md`](./scope.md) | 做什么 / 不做什么 / 验收 ID / **当前主线** |
| [`progress.md`](./progress.md) | 已发生变更的追加日志（**禁止**当 backlog） |
| [`docs/behavior-spec.md`](./docs/behavior-spec.md) | Classic 证据；映射到 scope ID，不替代 scope |
| [`README.md`](./README.md) | 启动与入口 |

**会话协议（必须）**

1. 开干前：读本文硬性约束 + `scope.md` 当前主线 + `progress.md` **最新 1–3 条**。  
2. 改架构 / 约束：先改本文，再 `progress.md` 记一笔。  
3. 改功能范围 / 验收 / 主线：只改 `scope.md`，再 `progress.md` 记一笔；**不要**在本文抄分期表。  
4. 新待办：写入 `scope.md` 带 ID；**禁止**只写在 progress「留给后续」。  
5. 与 Classic 规格冲突时：**硬性约束 > scope > behavior-spec 产品暗示**。  
6. **禁止**擅自把 `scope.md` P2 拉进当前迭代。

---

## 1. 产品边界

### 1.1 是什么

- 本地优先的桌面邮件客户端（macOS 优先，Tauri 跨平台可后续扩展）
- 体验对标 **Readdle Spark Classic**：Smart Inbox、线程、本地 Snooze/Pin、搜索、干净阅读视图
- 后端用 Rust 与邮箱服务器交互，数据落入 SQLite；前端只通过 Tauri Commands/Events 读库与提交意图

### 1.2 不是什么

- 不是 Spark 3.0 / 新版 Spark Mail 的复刻
- 不是对 Spark 二进制的代码搬运（REA 只产出行为规格，不拷实现）
- 不做依赖 Readdle 云端的能力 —— 清单见 `scope.md` **P2**

### 1.3 硬性约束

| 约束 | 说明 |
|------|------|
| 单向桥接 | 邮箱 → Rust → SQLite → 前端；前端不直连 IMAP/SMTP |
| 禁止手写协议 | IMAP/SMTP 必须用成熟库（如 `async-imap`、`lettre`） |
| 单一写入口 | 只有 Sync/Write Actor 可写 SQLite 并驱动协议 |
| 密钥不进明文库 | 凭证进 OS Keychain（如 `keyring`） |
| 品牌 | 不用 Spark / Readdle 的 logo 与字标。布局、配色、间距、控件形态、信息架构按 Spark Classic 自研复刻，不把对方二进制资源或反编译源码拷进仓库 |

---

## 2. 单向桥接（核心数据流）

```
┌─────────────┐     async-imap / lettre      ┌──────────────────┐
│ 邮箱服务器   │ ◄──────────────────────────► │  Rust mail layer  │
└─────────────┘                               └────────┬─────────┘
                                                       │ 唯一写路径
                                                       ▼
                                               ┌──────────────┐
                                               │   SQLite     │  ← 唯一真相源
                                               └──────┬───────┘
                          ┌────────────────────────────┼────────────────────────────┐
                          │                            │                            │
                   invoke(读)                    emit(事件)                  invoke(写意图)
                          │                            │                            │
                          ▼                            ▼                            ▼
                   列表 / 详情 / 搜索              mail_updated 等            mark_read / send / sync
                          │                            │                            │
                          └────────────────────────────┴────────────────────────────┘
                                             Tauri 前端（无协议、无第二真相源）
```

### 2.1 规则

1. **读**：前端 `invoke` → Rust 查 SQLite → 返回 DTO；前端可做 UI 缓存，但权威状态以再读库为准。
2. **写意图**：前端只传意图（如 `MarkRead { id }`），不传 IMAP 细节；Rust 改库 + 调协议，再 `emit`。
3. **长任务**：同步不阻塞 UI；进度/完成用 Events（如 `sync_progress`、`mail_updated`）。
4. **禁止**：前端维护「权威邮件列表」并与库双向 merge；禁止在前端拼 IMAP 命令。

### 2.2 防死锁纪律

- 每账号一条写通道（或全局单一 Sync Actor + 按 account_id 串行）
- Command handler 只投递任务到 Actor，自身快速返回 `JobId` / `Ok`
- 读路径尽量纯 SQL；不在持有 DB 写锁时做网络 IO

---

## 3. 技术栈

| 层 | 选型 | 职责 |
|----|------|------|
| 壳 | Tauri 2 | 窗口、Commands、Events、权限 |
| 语言 | Rust (edition 2021+) | 同步、协议、DB、业务 |
| 异步 | Tokio | 运行时 |
| IMAP | `async-imap`（或同等成熟异步库） | 收信、文件夹、FETCH、CONDSTORE 增量、IDLE（`three-mail-idle` 线程，P1.5-5） |
| SMTP | `lettre` | 发信 |
| DB | SQLite + `rusqlite` + 迁移 | 持久化（信封与 FTS 默认同库；分库见 P1.5-9） |
| 密钥 | `keyring`（apple-native / windows-native） | OAuth token / 应用专用密码 |
| 前端 | React + TypeScript + shadcn/ui + Tailwind | 展示与意图提交 |
| 逆向辅助 | REA | Classic 行为规格，非实现来源 |

### 3.1 Workspace（已落地）

```
3mail/
├── architecture.md          ← 本文（约束）
├── scope.md                 ← 分期 / 待办 / 验收
├── progress.md              ← 变更日志（只追加）
├── apps/
│   └── desktop/             ← Tauri 应用（React 前端 + tauri Rust 胶水）
├── crates/
│   ├── core/                ← 领域类型、错误、意图 API
│   ├── db/                  ← schema、迁移、查询
│   ├── mail/                ← IMAP/SMTP 适配（仅成熟库）
│   └── sync/                ← Sync/Write Actor、IMAP IDLE 监听、任务队列
└── docs/
    ├── behavior-spec.md     ← REA 产出的 Classic 行为规格
    └── decisions/           ← ADR（可选）
```

**crate 职责边界不要混**：`mail` 不碰 UI；`db` 不做网络；前端不进 `crates/`。

---

## 4. 领域模型（SQLite 语义）

以迁移为准；此处定义语义，避免后期会话乱加表。

| 实体 | 用途 |
|------|------|
| `accounts` | 邮箱账号元数据（无明文密码） |
| `folders` | IMAP 文件夹与本地映射 |
| `messages` | 信封、标志、文件夹、`thread_key`、本地 `category`、pin/snooze |
| `bodies` | 正文（懒加载） |
| `attachments` | 附件元数据与本地路径 |
| `messages_fts` | FTS5（主题/发件人/正文等） |
| `sync_state` | UIDVALIDITY、UIDNEXT、游标、失败信息（含可选 `highest_modseq`） |
| `signatures` / `drafts` | 签名与本地草稿 |
| `sender_category` | 发件人分类覆盖（本地） |
| `sender_category_stats` | 发件人头启发式分桶计数（P1.5-11；非 SmartBack） |
| `outbox` | 待发送 / 本机稍后发送 |
| `local_actions` | 其它纯本地动作（若仍使用） |
| `labels` / `message_labels` | 用户自定义 Label（本地真相；与 Smart `category` 分离；见 scope **P1.6-2**） |
| 会话「已回复」派生态 | 列表 DTO 或聚合字段（如 `thread_has_replied`）；**非** Label；见 scope **P1.6-1** |

线程选型：**用 `messages.thread_key` 聚合**（References / In-Reply-To），不强制单独 `conversations` 表；列表会话语义增强见 scope **P1.5-12**；往来视图见 **P1.6-3**。

索引：`(account_id, folder_id, uid)` 唯一。  
本地分类桶：`person` / `notification` / `newsletter` / `other` —— 规则自研，不依赖云端 ML（**≠** 用户 Label）。

---

## 5. Tauri 接口约定

新增 Command/Event 时：更新本节 + 实现；范围仍由 `scope.md` 约束。

### 5.1 Commands（当前）

**读**

- `list_accounts` / `list_folders` / `list_messages` / `list_threads` / `list_thread_messages` / `list_pinned`
- `get_message` / `search_messages`
- `list_signatures` / `list_drafts` / `list_outbox`

**写意图 / 账号**

- `test_account` / `add_account` / `remove_account`
- `start_sync`
- `fetch_body` / `mark_read` / `set_starred` / `archive_message` / `delete_message` / `move_message`
- `download_attachment` / `open_attachment`
- `send_message` / `save_draft` / `delete_draft`
- `open_compose_window` / `open_settings_window` / `stage_compose_payload` / `take_compose_payload`
- `upsert_signature` / `delete_signature`
- `snooze_message` / `pin_message` / `set_category`
- `cancel_outbox` / `retry_outbox`

### 5.2 Events

- `mail_updated` — 某 account/folder 数据变更，前端按范围再读库
- `sync_progress` — `{ account_id, phase, n, total? }`
- `sync_error` — 可展示、可重试的错误
- `outbox_updated` — 发送队列变化

载荷保持小而结构化；大数据始终走读 Command。

---

## 6. 功能分期（指针）

**完整清单、验收、当前主线、P1.5 backlog → 只看 [`scope.md`](./scope.md)。**

摘要（防迷路，细节以 scope 为准）：

- **P0** 日常邮箱 — 已收尾  
- **P1** Classic 味道骨架 — 已落地  
- **P1.5** Classic 保真与工程打磨 — **已基本收尾**（剩 P1.5-7 OAuth 暂缓、P1.5-9 deferred）  
- **P1.6** 自研增强（REPLIED / Label / 往来视图）— **下一主线**，见 scope  
- **P2** 云端/团队 — 默认不做。Classic 外观（除 logo）在 P1.5，见 scope  

砍范围时优先保 P0/P1 不回归；P2 不得渗进当前主线架构（例如不要为「云端定时」先上服务端）。

---

## 7. REA 使用方式

1. 目标应用：**Spark Classic**（确认版本，排除 Spark 3.0 / Spark Mail 新版）
2. 产出写入 `docs/behavior-spec.md`：信息架构、卡片含义、本地动作语义、搜索体验
3. 实现对照规格自研。外观与交互按 Classic 复刻，**除外是 logo / 字标**；不把反编译源码或对方二进制资源合并进仓库
4. 规格中「建议实现」必须挂到 `scope.md` ID 后才进排期
5. 与规格冲突时：**本文硬性约束为准**，规格只提供产品行为线索

建议侦察顺序：主界面 IA → 本地状态（已读/Pin/Snooze）→ 归档/删除结果 → Smart Inbox 线索 → 搜索体验。

可选补侦察：**Craft Anything**（[craft-anything](https://github.com/storytold/craft-anything)）深度模式 + Ghidra，做 Classic **检查轮**（证据写入 `behavior-spec.md`，映射 scope ID）；不替代 REA MCP 日常工具，也不触发「重建整个客户端」流程。P1.6 能力不以 Classic 规格为准。

---

## 8. 同步与并发模型

```
Tauri Command ──enqueue──► Sync Actor ──┬── mail (IMAP/SMTP)
                                        └── db (SQLite writes)
UI thread / 读 Commands ──────────────► db (reads only)
```

- 网络失败：可重试，状态留在 `sync_state`（标志类失败见 scope P1.5-4）
- 鉴权失败：标 account 需重新登录，不死循环刷协议
- UIDVALIDITY 变化：该文件夹索引失效重建（策略在 sync crate 内集中处理）

---

## 9. 安全

- TLS 由库/系统栈完成；不自造 TLS
- 密钥仅 Keychain；DB 中只存 `keyring` 引用或 account id。进程内可缓存已解锁的密钥，避免重复弹出系统密码；退出进程即丢，不写入 SQLite 或日志
- 附件路径在应用沙箱目录；不执行邮件内可执行内容
- HTML 正文：消毒 + iframe 沙箱；`cid:` / 外链图策略见 scope P1.5-1 / P1.5-2

---

## 10. 文档地图

| 文件 | 用途 |
|------|------|
| `architecture.md` | 架构与硬性约束（本文） |
| `scope.md` | 分期、待办 ID、验收、当前主线 |
| `progress.md` | 变更日志；有实质更新就追加 |
| `docs/behavior-spec.md` | Classic 行为规格（2.11.70） |
| `README.md` | 启动与阅读顺序 |
| `.cursor/rules/` | Agent 会话对齐规则 |

开干顺序：`architecture`（约束）→ `scope`（主线 ID）→ `progress`（最近条目）→ 必要时 `behavior-spec`。
