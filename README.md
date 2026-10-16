# 3mail

Spark Classic 风格的本地优先桌面邮件客户端（非 Spark 3.0）。

- **后端**：Rust — IMAP/SMTP（`async-imap` / `lettre`）、Sync Actor、SQLite  
- **前端**：Tauri 2 + React + shadcn/ui — 只读库、只提交写意图（单向桥接）  
- **辅助**：REA 还原 Classic 产品行为，实现全部自研  

## 文档阅读顺序（后续会话对齐）

1. [`architecture.md`](./architecture.md) — 硬性约束与数据流（**先读**）  
2. [`scope.md`](./scope.md) — 当前主线、待办 ID、验收（**唯一功能真相源**）  
3. [`progress.md`](./progress.md) — 最近变更（只追加，不是 backlog）  
4. [`docs/behavior-spec.md`](./docs/behavior-spec.md) — Classic 证据（需要时再读）  

| 要查… | 去… |
|--------|-----|
| 能不能手写 IMAP / 前端能不能直连 | architecture |
| 下一步做什么、验收是什么 | **scope** |
| 上次改了什么 | progress |
| Classic 原来怎么做的 | behavior-spec |

改范围只改 `scope.md`；改约束只改 `architecture.md`；两者都要在 `progress.md` 顶部记一笔。

## 环境

- Rust **1.90+**（见 `rust-toolchain.toml`）
- Node **24**（推荐 nvm）
- macOS：系统 Keychain（凭证）、Xcode CLT

## 启动

```bash
# Node 24
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24

cd apps/desktop
npm install
npm run tauri dev
```

首次启动会进入账号配置：填 IMAP/SMTP 主机、端口、SSL/STARTTLS，**Test connection** 通过后再保存。  
常用预填：QQ / 腾讯企业邮 / 163 / Gmail / Outlook。凭证进 Keychain。  
保存后点 **Sync** 拉信封；打开邮件会按需 FETCH 正文与附件元数据。

## Workspace

```
crates/core   领域类型 / 意图 / 事件
crates/db     SQLite + 迁移
crates/mail   async-imap + lettre
crates/sync   Sync/Write Actor + keyring
apps/desktop  Tauri 壳 + React UI
```

## 硬性约束（摘要）

1. 邮箱 → Rust → SQLite → 前端  
2. 禁止手写 IMAP/SMTP socket 命令  
3. 待办与分期只认 `scope.md`；P2 云端协作默认不做  
