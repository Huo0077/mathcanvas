//! **迁移**（Task 1.6 Step 1）。
//!
//! ## 一条纪律：迁移是**只向前**的，而且**每一步各自是一个事务**
//!
//! "失败就停在旧版本上继续可用"比"自动回滚到更早的版本"务实得多：
//! 回滚要写双份 schema（向前 + 向后），而两份里只要有一份写错，用户的库就处于
//! 一个**没人测过**的状态。只向前 + 每步一个事务的代价是"旧版本应用打不开新库"
//!（那条路径会给出可执行的错误，见下），换来的是"任何一次失败都不会留下半个 schema"。
//!
//! ## 为什么不用迁移库（`refinery` / `sqlx::migrate`）
//!
//! 这里一共三条迁移。引一个库意味着多一份要跟着升级、要审的东西，
//! 而它们的价值（多后端、宏、CLI）在这里都用不上。
//! `user_version` 是 SQLite 自带的整数字段，用它记版本号就够了。

use rusqlite::Connection;

use super::projects::RepositoryError;

/// 一条迁移：一个版本号 + 一段 SQL。
pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: [Migration; 3] = [
    Migration {
        version: 1,
        name: "documents-and-commits",
        sql: "
            CREATE TABLE IF NOT EXISTS documents (
                project_id   TEXT NOT NULL,
                document_id  TEXT NOT NULL,
                epoch        TEXT NOT NULL,
                generation   INTEGER NOT NULL,
                content_hash TEXT NOT NULL,
                content      TEXT NOT NULL,
                updated_at   INTEGER NOT NULL,
                PRIMARY KEY (project_id, document_id)
            );
            -- 历史：每次提交一份快照。当前 head 之外的历史靠这张表。
            CREATE TABLE IF NOT EXISTS snapshots (
                project_id   TEXT NOT NULL,
                document_id  TEXT NOT NULL,
                generation   INTEGER NOT NULL,
                content_hash TEXT NOT NULL,
                content      TEXT NOT NULL,
                created_at   INTEGER NOT NULL,
                PRIMARY KEY (project_id, document_id, generation)
            );
            -- 提交记录：幂等键是主键 —— 同一把键写第二次会撞主键，而不是再写一份。
            CREATE TABLE IF NOT EXISTS commits (
                idempotency_key TEXT PRIMARY KEY,
                project_id      TEXT NOT NULL,
                document_id     TEXT NOT NULL,
                epoch           TEXT NOT NULL,
                generation      INTEGER NOT NULL,
                content_hash    TEXT NOT NULL,
                actions         INTEGER NOT NULL,
                created_at      INTEGER NOT NULL
            );
            -- 运行事件：只追加，按 event_id 幂等（Task 2.6 的账本落点）。
            CREATE TABLE IF NOT EXISTS run_events (
                event_id   TEXT PRIMARY KEY,
                run_id     TEXT NOT NULL,
                payload    TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
        ",
    },
    Migration {
        version: 2,
        name: "attachments",
        sql: "
            -- 附件：**只有引用与哈希**，字节在磁盘上的 blob 目录里（两阶段写，见 Task 1.6 Step 4）。
            CREATE TABLE IF NOT EXISTS attachments (
                content_hash TEXT PRIMARY KEY,
                byte_size    INTEGER NOT NULL,
                media_type   TEXT NOT NULL,
                created_at   INTEGER NOT NULL
            );
            -- 快照引用了哪些附件。删除快照时可以据此判断有没有孤儿 blob。
            CREATE TABLE IF NOT EXISTS snapshot_attachments (
                project_id   TEXT NOT NULL,
                document_id  TEXT NOT NULL,
                generation   INTEGER NOT NULL,
                content_hash TEXT NOT NULL,
                PRIMARY KEY (project_id, document_id, generation, content_hash)
            );
        ",
    },
    Migration {
        version: 3,
        name: "conversations",
        sql: "
            -- 会话：**绑定一个** project / document / workspace（设计 5.1）。
            -- 这里**没有**指向 documents 的外键：会话先于文档存在（用户开新对话时文档还没有
            -- 第一次提交），加一条（文档必须已经在）的约束会把那条正常路径堵死。
            CREATE TABLE IF NOT EXISTS conversations (
                id              TEXT PRIMARY KEY,
                project_id      TEXT NOT NULL,
                document_id     TEXT NOT NULL,
                workspace       TEXT NOT NULL,
                title           TEXT NOT NULL,
                summary         TEXT NOT NULL DEFAULT '',
                summary_version INTEGER NOT NULL DEFAULT 1,
                created_at      INTEGER NOT NULL,
                updated_at      INTEGER NOT NULL,
                archived_at     INTEGER
            );
            -- 消息：属于**一条**会话（外键 + 级联）。`UNIQUE(conversation_id, sequence)`
            -- 是（顺序）这条事实的物理保证 —— 没有它，两条消息可以同时声称自己是第 1 条。
            -- 注意这里**没有**放模型推理、候选文档或图像字节的位置：不存它们靠的是**结构**。
            CREATE TABLE IF NOT EXISTS conversation_messages (
                id                  TEXT PRIMARY KEY,
                conversation_id     TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                sequence            INTEGER NOT NULL,
                role                TEXT NOT NULL,
                kind                TEXT NOT NULL,
                content_json        TEXT NOT NULL,
                run_id              TEXT,
                document_generation INTEGER,
                token_estimate      INTEGER NOT NULL,
                created_at          INTEGER NOT NULL,
                UNIQUE(conversation_id, sequence)
            );
            -- 事实：每条会话里 key 唯一。`source_message_id` 指向**同一条会话**里的消息
            -- （存在性由外键保证，同会话由仓库方法再查一次）——
            -- 没有证据的事实不许进 confirmed，而证据在别的会话里等于没有证据。
            CREATE TABLE IF NOT EXISTS conversation_facts (
                id                TEXT PRIMARY KEY,
                conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                key               TEXT NOT NULL,
                value_json        TEXT NOT NULL,
                source_message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
                status            TEXT NOT NULL,
                created_at        INTEGER NOT NULL,
                updated_at        INTEGER NOT NULL,
                UNIQUE(conversation_id, key)
            );
            -- `list` 按绑定过滤、按最近改动排序；归档的会话不进这张索引的结果集。
            CREATE INDEX IF NOT EXISTS conversations_binding_idx ON conversations(project_id, document_id, workspace, archived_at);
            -- 迟到的运行事件要写回**它原本那条**会话：按 run_id 找得到那些消息。
            CREATE INDEX IF NOT EXISTS conversation_messages_run_idx ON conversation_messages(run_id);
        ",
    }
];

/// 这个构建理解的**最新** schema 版本。
pub fn latest_version() -> i64 {
    MIGRATIONS.iter().map(|migration| migration.version).max().unwrap_or(0)
}

/// 把库迁到最新版本。返回**实际执行了哪几步**（空表示本来就在最新版）。
///
/// 每一步各自 `BEGIN` / `COMMIT`：中途失败时，**已经成功的那几步留在库里**，
/// 失败的那一步整个回滚 —— 于是库永远处于"某个完整的版本"上。
pub fn migrate(connection: &mut Connection) -> Result<Vec<i64>, RepositoryError> {
    migrate_with(connection, &MIGRATIONS)
}

/**
 * 用**给定的迁移列表**迁到最新版本。
 *
 * 为什么把列表做成参数：计划 Step 1 要求"**inject a failed migration**; assert the old DB
 * remains usable"，而"注入一条会失败的迁移"如果只能靠伪造表名去撞，
 * 测到的其实是 SQLite 的建表语义，不是**我们的迁移器**在失败时的行为。
 * 注入一条明确的坏迁移，才能确定性地证明三件事：**如实报错 / 版本号不推进 / 旧库仍可用**。
 */
pub fn migrate_with(connection: &mut Connection, migrations: &[Migration]) -> Result<Vec<i64>, RepositoryError> {
    let current: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| RepositoryError::Io { detail: format!("cannot read the schema version: {error}") })?;
    let latest = migrations.iter().map(|migration| migration.version).max().unwrap_or(0);
    if current > latest {
        // 未来版本写的库：**认出来并说清楚**，而不是当作空库（那会静默丢掉用户的文档）。
        return Err(RepositoryError::Io {
            detail: format!("this database was written by a newer version (schema {current}); this build understands {latest}")
        });
    }

    let mut applied = Vec::new();
    for migration in migrations.iter().filter(|migration| migration.version > current) {
        let transaction = connection
            .transaction()
            .map_err(|error| RepositoryError::Io { detail: format!("cannot start the migration transaction: {error}") })?;
        transaction
            .execute_batch(migration.sql)
            .map_err(|error| RepositoryError::Io { detail: format!("migration {} ({}) failed: {error}", migration.version, migration.name) })?;
        // `user_version` **在同一个事务里**推进：否则会留下"schema 变了、版本号没变"的库。
        transaction
            .pragma_update(None, "user_version", migration.version)
            .map_err(|error| RepositoryError::Io { detail: format!("cannot record the schema version: {error}") })?;
        transaction.commit().map_err(|error| RepositoryError::Io { detail: format!("cannot commit migration {}: {error}", migration.version) })?;
        applied.push(migration.version);
    }
    Ok(applied)
}
