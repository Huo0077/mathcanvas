//! **项目仓储**（Task 1.6）。
//!
//! ## 四条设计决定
//!
//! 1. **CAS 用三个字段一起判**：`epoch` / `generation` / `content_hash`。
//!    只判 `generation` 会漏掉"同一版号被换成另一份内容"；只判 `content_hash`
//!    会漏掉 **ABA**（内容回到原样、但中间被人动过）—— 那时按"没变"处理会让
//!    撤销栈与用户看到的东西对不上。
//! 2. **幂等键是提交的一部分**：同一把键再来一次返回**同一张回执**，
//!    而不是再写一次。这正是"DB 已提交、响应丢了、客户端重试"那条路径要的语义。
//! 3. **同一把键配不同的候选哈希要拒绝**。那是"两次不同的提交用了同一把键"，
//!    静默按幂等处理会让第二次改动**悄无声息地丢掉**。
//! 4. **事务包住三张表的写入**：head / snapshot / commit 记录。
//!    只写 head 会让历史缺一环，而"历史缺一环"在界面上表现为撤销跳步。

use std::path::Path;

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::migrations::migrate;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RepositoryError {
    /// 库打不开 / SQL 失败 / 迁移失败。
    Io { detail: String },
    /// 调用方给的文档 / 项目找不到。
    NotFound { detail: String },
    /// CAS 失败：库里的 head 与调用方期望的不一致。
    StaleHead { detail: String },
    /// 幂等键被另一份**不同**的提交用过。
    IdempotencyConflict { detail: String },
}

impl std::fmt::Display for RepositoryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RepositoryError::Io { detail } => write!(formatter, "{detail}"),
            RepositoryError::NotFound { detail } => write!(formatter, "{detail}"),
            RepositoryError::StaleHead { detail } => write!(formatter, "{detail}"),
            RepositoryError::IdempotencyConflict { detail } => write!(formatter, "{detail}"),
        }
    }
}

impl std::error::Error for RepositoryError {}

/// 一份文档快照。**内容与它的身份一起读出来**，这样调用方不需要"再查一次"。
///
/// Serialize 是给 IPC 用的（Tauri 命令的返回类型必须能序列化）；camelCase 与前端一致。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshot {
    pub project_id: String,
    pub document_id: String,
    pub epoch: String,
    pub generation: i64,
    pub content_hash: String,
    pub content: String,
    pub updated_at: i64,
}

/// 一次提交请求。
///
/// `expected_*` 三个字段就是 CAS 的那三个判据 —— 调用方要**显式**说出它以为的 head 是什么。
/// `idempotency_key` 由调用方给（通常是运行 id + 动作哈希），
/// 这样"网络重试"与"用户点了两次"都会落到同一条记录上。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitRequest {
    pub idempotency_key: String,
    pub project_id: String,
    pub document_id: String,
    pub expected_epoch: String,
    pub expected_generation: i64,
    pub expected_content_hash: String,
    pub content: String,
    pub content_hash: String,
    pub actions: usize,
}

/// 提交结果。
///
/// `changed: false` 的两种情形（内容没变 / 幂等重放）**必须分开报**：
/// 前者是"这次没什么要做的"，后者是"这件事之前已经做过了"——
/// 界面上这两句话完全不同。
///
/// `tag = "kind"` 让 IPC 上的形状是 `{ "kind": "committed", "generation": 2, … }` ——
/// **判别字段必须在**，否则前端拿到的是一个没有形状的对象，只能靠"有没有那个字段"去猜。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum CommitOutcome {
    /// 真的写进去了。
    Committed { generation: i64, content_hash: String },
    /// 候选内容与当前 head 相同：不推进 generation、不写历史。
    Unchanged { generation: i64 },
    /// 幂等重放：**同一把键**之前已经提交过，回执与当时一模一样。
    Replayed { generation: i64, content_hash: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitReceipt {
    pub idempotency_key: String,
    pub outcome: CommitOutcome,
    pub committed_at: i64,
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_millis() as i64).unwrap_or(0)
}

pub struct ProjectRepository {
    connection: Connection,
}

impl ProjectRepository {
    /// 打开（或新建）库并迁到最新 schema。
    pub fn open(path: impl AsRef<Path>) -> Result<Self, RepositoryError> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| RepositoryError::Io { detail: format!("cannot create {}: {error}", parent.display()) })?;
        }
        let mut connection = Connection::open(path).map_err(|error| RepositoryError::Io { detail: format!("cannot open {}: {error}", path.display()) })?;
        // 外键与 WAL：WAL 让"写的时候还能读"，而崩溃恢复靠它。
        connection
            .execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
            .map_err(|error| RepositoryError::Io { detail: format!("cannot configure the database: {error}") })?;
        migrate(&mut connection)?;
        Ok(Self { connection })
    }

    /// 读一份文档的 head。**找不到时如实报 `NotFound`**，而不是回一份空文档。
    pub fn read_head(&self, project_id: &str, document_id: &str) -> Result<DocumentSnapshot, RepositoryError> {
        self.connection
            .query_row(
                "SELECT project_id, document_id, epoch, generation, content_hash, content, updated_at FROM documents WHERE project_id = ?1 AND document_id = ?2",
                (project_id, document_id),
                |row| {
                    Ok(DocumentSnapshot {
                        project_id: row.get(0)?,
                        document_id: row.get(1)?,
                        epoch: row.get(2)?,
                        generation: row.get(3)?,
                        content_hash: row.get(4)?,
                        content: row.get(5)?,
                        updated_at: row.get(6)?
                    })
                }
            )
            .optional()
            .map_err(|error| RepositoryError::Io { detail: format!("cannot read the head: {error}") })?
            .ok_or_else(|| RepositoryError::NotFound { detail: format!("no document {document_id} in project {project_id}") })
    }

    /// **创建一个文档**（首次写入）。已存在则报 `StaleHead`（调用方该走 `commit`）。
    pub fn create(&mut self, project_id: &str, document_id: &str, epoch: &str, content: &str, content_hash: &str) -> Result<DocumentSnapshot, RepositoryError> {
        let transaction = self.connection.transaction().map_err(|error| RepositoryError::Io { detail: format!("cannot start a transaction: {error}") })?;
        let now = now_ms();
        transaction
            .execute(
                "INSERT INTO documents (project_id, document_id, epoch, generation, content_hash, content, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6)",
                (project_id, document_id, epoch, content_hash, content, now)
            )
            .map_err(|error| {
                // 撞主键 = 已经存在。这是**如实**的错误，不是"再写一次"。
                RepositoryError::StaleHead { detail: format!("document {document_id} already exists: {error}") }
            })?;
        transaction
            .execute(
                "INSERT INTO snapshots (project_id, document_id, generation, content_hash, content, created_at) VALUES (?1, ?2, 1, ?3, ?4, ?5)",
                (project_id, document_id, content_hash, content, now)
            )
            .map_err(|error| RepositoryError::Io { detail: format!("cannot write the first snapshot: {error}") })?;
        transaction.commit().map_err(|error| RepositoryError::Io { detail: format!("cannot commit the creation: {error}") })?;

        Ok(DocumentSnapshot {
            project_id: project_id.to_string(),
            document_id: document_id.to_string(),
            epoch: epoch.to_string(),
            generation: 1,
            content_hash: content_hash.to_string(),
            content: content.to_string(),
            updated_at: now
        })
    }

    /// **提交一次改动**（CAS + 幂等 + 原子写三张表）。
    pub fn commit(&mut self, request: CommitRequest) -> Result<CommitReceipt, RepositoryError> {
        // ---- 幂等：同一把键之前提交过吗 ----
        let existing: Option<(String, i64, String, i64)> = self
            .connection
            .query_row(
                "SELECT document_id, generation, content_hash, created_at FROM commits WHERE idempotency_key = ?1",
                (request.idempotency_key.as_str(),),
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            )
            .optional()
            .map_err(|error| RepositoryError::Io { detail: format!("cannot look up the idempotency key: {error}") })?;

        if let Some((document_id, generation, content_hash, committed_at)) = existing {
            // **同一把键 + 不同的候选 = 冲突**；同一把键 + 同一份候选 = 重放。
            //
            // 判据是**幂等键本来的契约**：客户端把重试标成"还是那件事"。于是两种情况要分开：
            //
            // - **不同候选**：这是"两次不同的提交用了同一把键"。静默按幂等处理会让第二次改动
            //   **悄无声息地丢掉**（调用方拿到的是一张"成功"的回执）。
            // - **同一候选**：**直接回放当时的回执，不再查 CAS**。
            //
            // ## 为什么这一支要在 CAS **之前**（第一版放在后面，被测试抓出来）
            //
            // 第一版把幂等检查放在 CAS 之后，理由听起来也对（"不能因为键见过就跳过并发检查"）。
            // 但那样做的话，**真正的网络重试会失败**：第一次提交把 head 推进到 generation 2，
            // 而重试携带的期望仍是 generation 1 —— CAS 判它过期，于是"重试"永远拿不到
            // 它本该拿到的那张回执。**那条路径正是幂等键存在的理由，却被顺序挡掉了。**
            //
            // 安全性没有因此变松：只有**内容哈希逐字相同**才走到这一支，
            // 所以回放的是**同一件事**的回执。
            if content_hash != request.content_hash || document_id != request.document_id {
                return Err(RepositoryError::IdempotencyConflict {
                    detail: format!(
                        "idempotency key {} was already used for {document_id}@{generation} ({content_hash}), but this request carries {}",
                        request.idempotency_key, request.content_hash
                    )
                });
            }
            return Ok(CommitReceipt { idempotency_key: request.idempotency_key, outcome: CommitOutcome::Replayed { generation, content_hash }, committed_at });
        }

        // ---- CAS：三个判据一起比 ----
        let head = self.read_head(&request.project_id, &request.document_id)?;
        if head.epoch != request.expected_epoch {
            return Err(RepositoryError::StaleHead {
                detail: format!("the document was replaced (epoch {} → {}); reload before saving", request.expected_epoch, head.epoch)
            });
        }
        if head.generation != request.expected_generation {
            return Err(RepositoryError::StaleHead {
                detail: format!("the document is at generation {}, not {}; reload before saving", head.generation, request.expected_generation)
            });
        }
        if head.content_hash != request.expected_content_hash {
            // 同一版号、不同内容：**这正是"只判 generation 会漏掉"的那一类**。
            return Err(RepositoryError::StaleHead {
                detail: format!("the document content changed underneath (expected {expected}, found {found})", expected = request.expected_content_hash, found = head.content_hash)
            });
        }

        // ---- 内容没变：不推进 generation、不写历史 ----
        if head.content_hash == request.content_hash && head.content == request.content {
            let now = now_ms();
            self.record_commit(&request, head.generation, now)?;
            return Ok(CommitReceipt { idempotency_key: request.idempotency_key, outcome: CommitOutcome::Unchanged { generation: head.generation }, committed_at: now });
        }

        // ---- 原子写：head + snapshot + commit 记录 ----
        let generation = head.generation + 1;
        let now = now_ms();
        let transaction = self.connection.transaction().map_err(|error| RepositoryError::Io { detail: format!("cannot start a transaction: {error}") })?;
        transaction
            .execute(
                "UPDATE documents SET generation = ?1, content_hash = ?2, content = ?3, updated_at = ?4 WHERE project_id = ?5 AND document_id = ?6",
                (generation, request.content_hash.as_str(), request.content.as_str(), now, request.project_id.as_str(), request.document_id.as_str())
            )
            .map_err(|error| RepositoryError::Io { detail: format!("cannot update the head: {error}") })?;
        transaction
            .execute(
                "INSERT INTO snapshots (project_id, document_id, generation, content_hash, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                (request.project_id.as_str(), request.document_id.as_str(), generation, request.content_hash.as_str(), request.content.as_str(), now)
            )
            .map_err(|error| RepositoryError::Io { detail: format!("cannot write the snapshot: {error}") })?;
        transaction
            .execute(
                "INSERT INTO commits (idempotency_key, project_id, document_id, epoch, generation, content_hash, actions, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                (
                    request.idempotency_key.as_str(),
                    request.project_id.as_str(),
                    request.document_id.as_str(),
                    head.epoch.as_str(),
                    generation,
                    request.content_hash.as_str(),
                    request.actions as i64,
                    now
                )
            )
            .map_err(|error| RepositoryError::Io { detail: format!("cannot record the commit: {error}") })?;
        transaction.commit().map_err(|error| RepositoryError::Io { detail: format!("cannot commit: {error}") })?;

        Ok(CommitReceipt {
            idempotency_key: request.idempotency_key,
            outcome: CommitOutcome::Committed { generation, content_hash: request.content_hash.clone() },
            committed_at: now
        })
    }

    /// 只记一条提交记录（用于"内容没变"那次）。**不推进 generation、不写快照。**
    fn record_commit(&self, request: &CommitRequest, generation: i64, now: i64) -> Result<(), RepositoryError> {
        self.connection
            .execute(
                "INSERT INTO commits (idempotency_key, project_id, document_id, epoch, generation, content_hash, actions, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                (
                    request.idempotency_key.as_str(),
                    request.project_id.as_str(),
                    request.document_id.as_str(),
                    request.expected_epoch.as_str(),
                    generation,
                    request.content_hash.as_str(),
                    request.actions as i64,
                    now
                )
            )
            .map_err(|error| RepositoryError::Io { detail: format!("cannot record the commit: {error}") })?;
        Ok(())
    }

    /// **按幂等键查提交状态**（计划 Step 2 的 "crash between DB commit and UI response"）。
    ///
    /// 客户端重试时先查这里：查到就说明上次其实成功了，直接按重放处理，
    /// 而不是再提交一次（那会推进两次 generation）。
    pub fn lookup_commit(&self, idempotency_key: &str) -> Result<Option<CommitReceipt>, RepositoryError> {
        self.connection
            .query_row(
                "SELECT generation, content_hash, created_at FROM commits WHERE idempotency_key = ?1",
                (idempotency_key,),
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?))
            )
            .optional()
            .map_err(|error| RepositoryError::Io { detail: format!("cannot look up the idempotency key: {error}") })
            .map(|found| {
                found.map(|(generation, content_hash, committed_at)| CommitReceipt {
                    idempotency_key: idempotency_key.to_string(),
                    outcome: CommitOutcome::Replayed { generation, content_hash },
                    committed_at
                })
            })
    }

    /// 历史里第 `generation` 版的内容。**撤销/重做靠它**。
    pub fn read_snapshot(&self, project_id: &str, document_id: &str, generation: i64) -> Result<DocumentSnapshot, RepositoryError> {
        self.connection
            .query_row(
                "SELECT s.content_hash, s.content, s.created_at, d.epoch FROM snapshots s JOIN documents d ON d.project_id = s.project_id AND d.document_id = s.document_id WHERE s.project_id = ?1 AND s.document_id = ?2 AND s.generation = ?3",
                (project_id, document_id, generation),
                |row| {
                    Ok(DocumentSnapshot {
                        project_id: project_id.to_string(),
                        document_id: document_id.to_string(),
                        epoch: row.get(3)?,
                        generation,
                        content_hash: row.get(0)?,
                        content: row.get(1)?,
                        updated_at: row.get(2)?
                    })
                }
            )
            .optional()
            .map_err(|error| RepositoryError::Io { detail: format!("cannot read the snapshot: {error}") })?
            .ok_or_else(|| RepositoryError::NotFound { detail: format!("no snapshot {generation} for {document_id}") })
    }

    /// 历史里有多少版（**包含 head**）。
    pub fn history_length(&self, project_id: &str, document_id: &str) -> Result<i64, RepositoryError> {
        self.connection
            .query_row(
                "SELECT COUNT(*) FROM snapshots WHERE project_id = ?1 AND document_id = ?2",
                (project_id, document_id),
                |row| row.get(0)
            )
            .map_err(|error| RepositoryError::Io { detail: format!("cannot count the snapshots: {error}") })
    }

    /// **把 head 换成一个新的 epoch**（导入 / 新建 / 切换项目）。
    ///
    /// epoch 一变，**所有在途的提交都会 CAS 失败** —— 那正是它存在的意义：
    /// 换了文档之后，旧的在途请求不该还能写进来。
    pub fn replace_epoch(&mut self, project_id: &str, document_id: &str, epoch: &str, content: &str, content_hash: &str) -> Result<DocumentSnapshot, RepositoryError> {
        let transaction = self.connection.transaction().map_err(|error| RepositoryError::Io { detail: format!("cannot start a transaction: {error}") })?;
        let now = now_ms();
        let generation: i64 = transaction
            .query_row(
                "SELECT generation FROM documents WHERE project_id = ?1 AND document_id = ?2",
                (project_id, document_id),
                |row| row.get(0)
            )
            .optional()
            .map_err(|error| RepositoryError::Io { detail: format!("cannot read the head: {error}") })?
            .ok_or_else(|| RepositoryError::NotFound { detail: format!("no document {document_id}") })?;
        let next = generation + 1;
        transaction
            .execute(
                "UPDATE documents SET epoch = ?1, generation = ?2, content_hash = ?3, content = ?4, updated_at = ?5 WHERE project_id = ?6 AND document_id = ?7",
                (epoch, next, content_hash, content, now, project_id, document_id)
            )
            .map_err(|error| RepositoryError::Io { detail: format!("cannot replace the epoch: {error}") })?;
        transaction
            .execute(
                "INSERT INTO snapshots (project_id, document_id, generation, content_hash, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                (project_id, document_id, next, content_hash, content, now)
            )
            .map_err(|error| RepositoryError::Io { detail: format!("cannot write the snapshot: {error}") })?;
        transaction.commit().map_err(|error| RepositoryError::Io { detail: format!("cannot commit the epoch change: {error}") })?;

        Ok(DocumentSnapshot {
            project_id: project_id.to_string(),
            document_id: document_id.to_string(),
            epoch: epoch.to_string(),
            generation: next,
            content_hash: content_hash.to_string(),
            content: content.to_string(),
            updated_at: now
        })
    }

    // ------------------------------------------------------------ 附件引用（Task 1.6 Step 4）

    /**
     * **记下一份附件的元数据**（第二阶段的前半步）。
     *
     * 幂等：同一份内容记两次不报错（内容寻址意味着"同一份附件"只有一行）。
     */
    pub fn record_attachment(&mut self, content_hash: &str, byte_size: i64, media_type: &str) -> Result<(), RepositoryError> {
        self.connection
            .execute(
                // `ON CONFLICT DO NOTHING`：同一份内容被两份文档引用是常态，
                // 而"第二份引它"不该报错、也不该改第一份记下的大小。
                "INSERT INTO attachments (content_hash, byte_size, media_type, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(content_hash) DO NOTHING",
                (content_hash, byte_size, media_type, now_ms())
            )
            .map_err(|error| RepositoryError::Io { detail: format!("cannot record the attachment: {error}") })?;
        Ok(())
    }

    /**
     * **记下"这一版快照引用了哪些附件"**（第二阶段的后半步）。
     *
     * ## 为什么引用是记在**快照**上的
     *
     * 因为"这份附件还有用吗"的答案是"还有没有一版历史引用它"。记在 head 上会让
     * 撤销回上一版之后附件立刻变成孤儿 —— 而那一版明明还在历史里、还能被打开。
     */
    pub fn reference_attachments(&mut self, project_id: &str, document_id: &str, generation: i64, content_hashes: &[String]) -> Result<(), RepositoryError> {
        let transaction = self.connection.transaction().map_err(|error| RepositoryError::Io { detail: format!("cannot start a transaction: {error}") })?;
        for content_hash in content_hashes {
            transaction
                .execute(
                    "INSERT INTO snapshot_attachments (project_id, document_id, generation, content_hash) VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING",
                    (project_id, document_id, generation, content_hash)
                )
                .map_err(|error| RepositoryError::Io { detail: format!("cannot reference the attachment: {error}") })?;
        }
        transaction.commit().map_err(|error| RepositoryError::Io { detail: format!("cannot commit the attachment references: {error}") })
    }

    /// **所有被引用过的附件哈希**。GC 的输入就是它 —— 删除的判据只有这一个。
    pub fn referenced_blobs(&self) -> Result<std::collections::BTreeSet<String>, RepositoryError> {
        let mut statement = self
            .connection
            .prepare("SELECT DISTINCT content_hash FROM snapshot_attachments")
            .map_err(|error| RepositoryError::Io { detail: format!("cannot prepare the reference query: {error}") })?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| RepositoryError::Io { detail: format!("cannot read the attachment references: {error}") })?;
        let mut out = std::collections::BTreeSet::new();
        for row in rows {
            out.insert(row.map_err(|error| RepositoryError::Io { detail: format!("cannot read an attachment reference: {error}") })?);
        }
        Ok(out)
    }

    /// 这一版快照引用了哪些附件（按名字排序）。
    pub fn attachments_of(&self, project_id: &str, document_id: &str, generation: i64) -> Result<Vec<String>, RepositoryError> {
        let mut statement = self
            .connection
            .prepare("SELECT content_hash FROM snapshot_attachments WHERE project_id = ?1 AND document_id = ?2 AND generation = ?3 ORDER BY content_hash")
            .map_err(|error| RepositoryError::Io { detail: format!("cannot prepare the attachment query: {error}") })?;
        let rows = statement
            .query_map((project_id, document_id, generation), |row| row.get::<_, String>(0))
            .map_err(|error| RepositoryError::Io { detail: format!("cannot read the attachments: {error}") })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|error| RepositoryError::Io { detail: format!("cannot read an attachment: {error}") })?);
        }
        Ok(out)
    }

    /// **删掉某一版快照的引用**（连同它的历史快照）。
    ///
    /// 存在的理由与 GC 配套：用户删掉一份文档之后，它引用的附件才会变成孤儿。
    /// 没有这个动作，GC 就永远删不掉任何东西 —— 而那等于没有 GC。
    pub fn drop_references(&mut self, project_id: &str, document_id: &str) -> Result<(), RepositoryError> {
        self.connection
            .execute("DELETE FROM snapshot_attachments WHERE project_id = ?1 AND document_id = ?2", (project_id, document_id))
            .map_err(|error| RepositoryError::Io { detail: format!("cannot drop the attachment references: {error}") })?;
        Ok(())
    }
}
