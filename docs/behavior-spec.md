# Spark Classic — Behavior Spec (from REA reconnaissance)

> **用途**：指导 3mail 产品行为与本地数据模型；**不是**可复制源码。  
> **原则**：实现全部自研；协议只用成熟库；云端协作属 P2，默认不做。  
> **证据等级**：`confirmed`（本机产物核对）/ `inferred`（强相关但未反编译确认）/ `unknown`（待 Hopper/Ghidra）。  
> **排期**：本文只提供证据与映射；**是否做、验收 ID 以 [`scope.md`](../scope.md) 为准**。新建议必须先挂到 scope ID，再进实现。

---

## 0. 侦察目标钉死

| 项 | 值 | 证据 |
|----|-----|------|
| 应用 | `/Applications/Spark.app` | 本机安装 |
| 显示名 | Spark | Info.plist |
| Bundle ID | `com.readdle.smartemail-Mac` | Info.plist |
| 版本 | **2.11.70** | CFBundleShortVersionString |
| 架构 | Mach-O universal `x86_64` + `arm64` | `file` |
| **排除** | `/Applications/Spark Desktop.app` **3.30.12**（`com.readdle.SparkDesktop`） | 此为 Spark 3.x，非 Classic |

**confirmed**

---

## 1. 模块地图（产品语义，非抄代码）

Classic 是 **原生 Swift/ObjC** 应用，核心逻辑在 frameworks，而非 Electron。

| Framework | 体量（约） | 推断职责 |
|-----------|------------|----------|
| `SmartMailCore` | ~24MB | 业务核心：Smart Inbox、Snooze、同步事件、分类 |
| `MailCore` | ~1.9MB | 邮件协议栈（IMAP 等） |
| `SparkDatabase` | ~376KB | DB 访问封装 |
| `SmartMailMessageParser` | — | 正文/引用解析 |
| `SparkComposer` | — | 撰写 |
| `FMDB` / `RDSQLite3` | — | SQLite |
| `GTMOAuth2` / `RDOAuthSwift` | — | OAuth |

UI 线索（类名 / nib）：`RSMXSmartInboxViewController`、`RSMXSnoozeSettingsViewController`、`RSMXThreadViewerController`、签名相关 `RSMXSignature*`。

**confirmed**（bundle 清单 + 符号/字符串）；内部算法 **unknown**（Hopper 安装失败，见 progress）。

---

## 2. 本地数据布局

### 2.1 路径

| 位置 | 路径 |
|------|------|
| App 沙盒 | `~/Library/Containers/com.readdle.smartemail-Mac/` |
| **主数据 Group Container** | `~/Library/Group Containers/3L68KQB4HG.group.com.readdle.smartemail/` |
| 邮件库目录 | `…/databases/` |

### 2.2 数据库拆分（对 3mail 很有启发）

| 文件 | 职责 | 3mail 映射建议 |
|------|------|----------------|
| `messages.sqlite` | 账号、文件夹、消息信封、会话、IMAP 线程、Snooze 远端状态等 | 主库核心表 |
| `cache.sqlite` | `messageBodyHtml`、`messageBodyParsedData`、`messageImapData`(BLOB) | 正文/原始 RFC822 懒加载缓存 |
| `search_fts5.sqlite` | FTS5 虚拟表 `messagesfts` | P1 搜索索引（可同库或分库） |
| `smart.sqlite` | `importantContacts`、文件夹使用统计等 | 本地启发式辅助表 |
| `settings.sqlite` | 键值设置 | 应用设置 |
| `sharedDrafts.sqlite` 等 | 团队/共享相关 | **P2，忽略** |

**confirmed**（schema / 表名；未导出任何邮件正文到仓库）。

---

## 3. 核心实体（schema 级）

### 3.1 `accounts`

关键列：`pk`, `accountType`, `accountTitle`, `ownerFullName`, `orderNumber`, `additionalInfo`  
本机样本：`accountType = 5`（3 个账号）——具体枚举含义 **inferred/unknown**，需后续对照添加账号流程。

### 3.2 `folders`（同步游标几乎齐活）

关键列：

- 路径：`folderName`, `folderPath`, `imapPath`, `parentPk`
- IMAP 增量：`imapLastSyncUidNext`, `imapLastSyncUidValidity`, `imapLastSyncModSequenceValue`, `imapMessageCount`, `imapMessageUnseenCount`
- 另有 Gmail/EWS/Graph 字段（`gmailHistoryId`, `ews*`, `graphDeltaLink`…）→ Classic 多后端；**3mail P0 只做 IMAP(+SMTP)**，这些列不必 1:1 复刻

样本系统文件夹名：`INBOX`, `Archive`/`Archives`, `Drafts`, `Snoozed`（imapPath 如 `LAWRENCE/Snoozed`）。

**对 3mail**：`sync_state` 至少要有 `uidvalidity` + `uidnext`（+ 可选 MODSEQ）。

### 3.3 `messages`（信封 + 本地标志）

关键列（节选）：

| 列 | 含义（推断） |
|----|----------------|
| `messageId`, `inReplyTo`, `messageReferences` | 线程键 |
| `flags` / `extendedFlags` / `originalFlags` | IMAP/本地标志 |
| `unseen`, `starred`, `inInbox`, `inSent`, `inDrafts`, `inTrash`, `snoozed` | 冗余布尔，加速列表过滤 |
| `category` | Smart Inbox 分类（见 §4） |
| `conversationPk`, `imapThreadId` | 会话聚合 |
| `subject`, `shortBody`, `messageFrom`… | 列表展示 |
| `snoozeDate` | 本地/同步延后时刻 |
| `listUnsubscribeURL` | 退订线索（newsletter 启发） |
| `numberOfFileAttachments` | 附件计数 |

正文不在此表：在 `cache.sqlite`。

### 3.4 `conversations`

会话级聚合：各文件夹计数（`totalInbox`, `totalSnoozed`…）、`pinDate`, `snoozeDate`, `category`, 以及大量 **team/delegation/shared** 字段 → **3mail 忽略 P2 字段**，保留 pin/snooze/计数即可。

### 3.5 线程

- `messageIdThreads(messageId, subject, accountPk, threadId)`
- `messagesIMAPThreads(accountPk, threadId, needsInitialSync)`

**inferred**：同时支持 Message-ID 线程与 IMAP THREAD/thread-id。

### 3.6 文件夹归属

`messageFoldersInfo(messagePk, folderPk, messageImapUID, syncStatus)` —— 一封信可映射多文件夹/标签（Gmail 友好）。

### 3.7 Snooze

- 消息/会话上的 `snoozed` + `snoozeDate`
- `remoteSnoozeDates`（含 `syncStatus`, `alertEnabled`）→ 存在 **远端同步 snooze**（Spark 云）  
  **3mail P1**：只做本地 snooze 调度；不实现 `remoteSnoozeDates` 云协议。

### 3.8 搜索

```sql
CREATE VIRTUAL TABLE messagesfts USING fts5(
  messagePk, messageFrom, messageTo, subject, searchBody, additionalText
);
```

**confirmed** → 3mail P1 可直接对齐字段集合。

---

## 4. Smart Inbox

### 4.1 产品文案与类型（confirmed）

- 三类主卡片：**Personal**、**Notifications**、**Newsletters**
- 排序语义：*Personal → Notifications → Newsletters*
- Swift 枚举：`SmartMailCore.RSMMessageCategory`（`Int` rawValue，有 `description`）
- 会话与可变消息均挂 `category: RSMMessageCategory`
- UI / 数据源：`RSMSmartInbox*`, `SmartInboxNotificationsCardDataSource`, `SmartInboxNewslettersCardDataSource`
- 列表查询索引（内嵌 SQL 字符串，confirmed）：

```sql
-- 未读 Smart Inbox：按 category 分桶
CREATE INDEX … conversation_index_smart_inbox_new
  ON conversations (type, inInbox, unseen, category, inboxOrSnoozeDate DESC, pk, accountPk);

-- 普通收件 / 延后
… (type, inInbox, inboxOrSnoozeDate DESC, …)
… (type, snoozed, inboxOrSnoozeDate DESC, …)
```

### 4.2 `category` 整型（本机分布 + 退订相关，inferred）

| category | 本机消息数 | 含 `listUnsubscribeURL` | 推断 |
|----------|------------|-------------------------|------|
| 0 | 1 | 0 | 未知/未分类 |
| 1 | 3722 | 14 | **Personal** |
| 2 | 783 | 29 | **Notifications** |
| 3 | 339 | 306 | **Newsletters**（强相关） |

### 4.3 分类管线（inferred，符号/字符串）

本地至少两条路径（ObjC 选择子）：

1. `messageCategoryByHeaderData:extraHeaders:` — 邮件头启发式  
2. `messageCategoryByStatisticsWithMessage:parsedCategory:` — 统计/学习型修正  

另有：

- `RSMMessageCategoryStats`：字段线索含 `manualCategory`、`mutableAutoStats` → **支持手动覆盖 + 自动统计**
- 设置组 `msg_class_v3`：按发件人记忆分类（本机约 1796 条；**勿导出具体地址到仓库**）
- Spark 后端：`RSMBackendMessageCategory` / `postMessageCategoryInfos` / SmartBack 错误计数键  

**3mail P1**：只实现本地头启发式 + 可选发件人覆盖表；**不**接 Readdle SmartBack。

### 4.4 Smart Inbox 列表配置（settings，confirmed 结构）

`settings.sqlite` → `General/smartInboxListConfiguration`（JSON）：

- `mode`：本机为 `0`
- 全局开关：`newEmailsOnly`, `includesDone`, `excludesNewSender`, `taglinesEnabled`, `showCategoryGroupsInToday`
- `cards[]`：每项含 `cardType`（Int）、`enabled`、`itemsLimit`、`grouping`、`dismissAction`
- 本机启用的 `cardType` 样本：`15, 7, 1, 2, 3, 11, 4, …`（**具体枚举名待反编译**；1/2/3 很可能对应三类主卡片）

相关设置键：`RSMASettingsInboxMode`（按账号 inbox 模式）、`useFocusedInbox*`、`unreadCardsSmartInboxConfig`、`smartFolders`（如 Attachments / Today’s Unread）。

---

## 5. Snooze / Pin / Archive

### 5.1 Snooze（confirmed + inferred）

| 证据 | 含义 |
|------|------|
| `messages.snoozed` / `snoozeDate`；`conversations` 同名字段 | 本地延后状态 |
| `remoteSnoozeDates` + `pushSnoozeDatesChanges(forAccount:)` | **云端同步 snooze**（未登录时日志：ignored） |
| `RSMMailFlowManager.distantFutureSnoozeDate()` / `snoozedToSomeday` | 「Someday」= 远端未来日期哨兵 |
| `SnoozeType`（Int raw）、`snoozeConfiguration` JSON | UI 预设：`enabledSnoozeDateKinds`、`snoozeWeekdays`、`defaultAlertEnabled` |
| `RSMAutoMoveFromSnoozedIMAPOperation` 等 | **到期后自动搬回**（IMAP/Gmail/EWS/Graph/Team 各有变体） |
| 文件夹名 `Snoozed` | 部分账号有专用 IMAP 文件夹 |

**3mail P1**：本地 `snooze_until` + 本机调度器到期清标志/回 Inbox；不实现 remote push/pull。

### 5.2 Pin（confirmed）

- 会话级：`conversations.pinDate`（本机样本约 11 个 pinned）
- 侧栏系统列表配置名含 `pins`；设置 onboarding 键 `tooltipPin` / `undoPin`
- Pin 不是独立 IMAP 文件夹。用户邮箱对照：Spark 的 Pin 写的是 IMAP `\Flagged`（3mail 读入 `starred`）。置顶按会话，会话里每封信都带这个旗标。见 `P1.5-53`

### 5.3 Archive（inferred）

- `RSMMessage.inArchive`；会话 `inArchive` / `totalArchive`
- 文件夹 `Archive` / `Archives`；另有 SharedInbox「WithEmailArchive」数据源（P2）
- **3mail P0**：归档 = 移到账号 Archive 文件夹（或 Gmail 等价标签），维护本地 `in_archive` 冗余标志即可

---

## 6. 对 3mail 的含义 → scope 映射

规格暗示 ≠ 已承诺实现。下表把线索挂到 [`scope.md`](../scope.md) ID；**状态以 scope 为准**。

| Classic 线索 | 3mail 含义 | scope |
|--------------|------------|-------|
| 信封 / 正文缓存 / FTS 分库 | 对齐懒加载；默认同库可接受 | P1.5-9（deferred） |
| 会话一等公民 + `inbox_or_snooze_date` | 列表会话语义排序 | P1.5-12 |
| 冗余标志由同步层维护 | Sync Actor；失败可重试 | P0-4、P1.5-4 |
| IMAP 游标 UIDVALIDITY/UIDNEXT/MODSEQ | sync_state；MODSEQ 可选 | P0-2、P1.5-6 |
| Smart Inbox `category` + 可配置卡片 | 已有分桶；卡片 IA 待做 | P1-2、**P1.5-10** |
| 分类：头启发式 + 统计 + 发件人记忆；SmartBack | 本地启发式+覆盖已有；增强/不接云 | P1-2、P1.5-11；SmartBack→**P2** |
| Snooze 预设 / Someday / 远端同步 | 本地预设待做；远端不做 | P1-4、P1.5-13；remote→**P2** |
| Pin 会话级 | 同 thread_key | P1-4 |
| `shortBody` 列表预览 | snippet 展示 | P1.5-3 |
| smartFolders（附件/今日未读） | 轻量智能列表 | P1.5-14 |
| 阅读 cid: / 远程图 | 内嵌图 + 外链开关 | P1.5-1、P1.5-2 |
| OAuth | Keychain token | P1.5-7 |
| FTS5 字段集 | 已对齐；中文增强 | P1-3、P1.5-8 |
| team / sharedInbox / sharedDrafts / Read Receipt / 云端定时 | **忽略** | **P2** |
| 协议栈 MailCore | `async-imap` + `lettre` | architecture 硬性约束 |

硬性约束与单向桥接见 [`architecture.md`](../architecture.md)；冲突时约束优先。

---

## 7. 引擎状态与待深挖

| 能力 | 状态 |
|------|------|
| REA MCP（Cursor） | 已注册；`binary_session` 可用 |
| Hopper | **缺失**（官网 DMG `download_failed`；路径 `/Applications/Hopper Disassembler.app` 不存在） |
| Ghidra | **未配置**（需 `GHIDRA_INSTALL_DIR` → Ghidra 12.1.x） |
| 无 Hopper 可用 | `inspect_macho`、`inspect_sqlite_database`、符号/settings 侦察 |

Hopper/Ghidra 就绪后优先：

1. `RSMMessageCategory` / `RSMCardType` / `SnoozeType` 枚举 case ↔ rawValue  
2. `messageCategoryByHeaderData:` 规则表  
3. `RSMAutoMoveFromSnoozedIMAPOperation` 到期动作  
4. Archive 在纯 IMAP 账号上的具体 STORE/MOVE

当前规格已支撑 P0/P1；后续保真项按 **scope P1.5** 排期。反编译补全枚举后，先更新本文再改 scope 验收，勿直接改业务硬编码。

---

## 8. 合规备注

- 本文件只含结构、计数与**已脱敏**的配置键；不含邮件正文、完整地址簿或凭证。  
- 不用 Spark / Readdle 的 logo 或字标；不把二进制资源或大块伪代码拷入仓库。  
- 布局、配色、信息架构可以按 Classic 描述，供 P1.5 自研复刻。
