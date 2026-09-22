//! **多会话上下文**（Task 1 / Task 2 的存储那一半）。
//!
//! 设计 5.1/5.2：一条会话绑定**一个** `projectId`、`documentId` 和 `workspace`，
//! 消息与事实都属于它；桌面端 SQLite 是持久化真源，浏览器里的 `localStorage` 只是兜底。
//!
//! ## 五条设计决定
//!
//! 1. **绑定是会话身份的一部分**。`list` 按（项目、文档、工作区）三者过滤 ——
//!    只按项目过滤会让"另一份文档的历史"漏进这一份，而那正是"会话之间串消息"
//!    最容易被忽略的一种形态。
//! 2. **归属靠外键 + 级联，但删除不依赖它**。schema 上 `REFERENCES … ON DELETE CASCADE`
//!    把归属写死（测试直接查 SQL 层证明它存在）；而 `delete` 自己再删一遍消息与事实，
//!    因为 `PRAGMA foreign_keys` 是**每个连接**的设置 —— 一个忘了打开的连接会让级联
//!    静默失效，留下读不到的孤儿行。删除是用户看得见的动作，不该靠一条环境配置成立。
//! 3. **消息的幂等键是它自己的 id**。重放同一个 id 是**空操作**（返回 `false`），
//!    而且**不占序号** —— 否则每次重试都会在会话顺序里留下一个空位。
//!    这里刻意**不用** `INSERT OR IGNORE`（账本那种写法）：本表还有
//!    `UNIQUE(conversation_id, sequence)`，`OR IGNORE` 会把"序号被抢了"这条
//!    **不同**消息的冲突也悄悄吞掉，而那是一次静默的消息丢失。所以先查 id、
//!    再显式插入，撞序号如实报错。
//! 4. **事实必须有证据，而且证据要在同一条会话里**。`source_message_id` 必须是这条会话
//!    真实存在的消息：跨会话的引用是把 A 的结论写进 B 的直通车。设计 5.2 也写着
//!    只有用户明确条件、已提交文档、用户确认草稿和通过内核校验的结果能进 `confirmed`
//!    —— 本层能守的是**结构**那一半（状态只能是三值之一 + 证据真实存在），
//!    "这份草稿到底确认没有"由调用方（Task 3/5）负责。
//! 5. **读写都有界**。没有上限的列表长成一个不能被读的列表，而那与没有列表是同一种结局。
//!    读取还有**确定**的顺序：会话按最近改动（同一毫秒退到 id），消息按序号（超上限时
//!    留下的是**最近**的那些），事实按最近的证据。
//!
//! ## 不存什么
//!
//! 计划的不变量：不持久化 hidden chain-of-thought、密钥、候选文档全文与图像字节。
//! 这条靠**结构**成立：`ConversationMessageInput` / `ConversationFactInput` 里没有放它们的
//! 位置，而且带 `deny_unknown_fields` —— 多一个 `reasoning` / `imageBytes` /
//! `candidateDocument` 字段是一次**响亮的拒绝**，不是静默削掉（静默削掉比拒绝更危险：
//! 调用方会以为它存进去了）。此外消息内容里**明确的**凭据前缀（`sk-` / `sk_`）
//! 也一律拒绝 —— 但**不**用账本那套"长串一律抹掉"的规则，理由见
//! [`super::run_events::contains_credential_prefix`]。

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::projects::RepositoryError;

/// 一次 `list` 最多返回多少条会话。
pub const MAX_CONVERSATIONS: usize = 256;
/// 一次 `read_messages` 最多返回多少条消息（留下的是**最近**的那些）。
pub const MAX_MESSAGES: usize = 512;
/// 一次 `read_facts` 最多返回多少条事实。
pub const MAX_FACTS: usize = 256;
/// 单条消息 `content_json` 的字符上限。按**字符**而不是字节：按字节切会切在
/// 半个 UTF-8 字符中间（与账本的截断同一个理由）。
pub const MAX_MESSAGE_CHARS: usize = 32 * 1024;
/// 摘要的字符上限（结构化摘要，不是聊天记录本身）。
pub const MAX_SUMMARY_CHARS: usize = 16 * 1024;
/// 事实 key 的字符上限。
pub const MAX_FACT_KEY_CHARS: usize = 256;
/// 事实 value 的字符上限。
pub const MAX_FACT_VALUE_CHARS: usize = 8 * 1024;
/// 标识（会话 / 消息 / 事实 id）的字符上限。
pub const MAX_ID_CHARS: usize = 256;
/// 标题的字符上限。
pub const MAX_TITLE_CHARS: usize = 512;

/// **Agent 工作区**。与 `@draw/agent-core` 的 `WorkspaceId` 逐字相同三个值。
///
/// 为什么是一个枚举而不是 `String`：命令入口就是边界，未知的工作区（例如已退役的
/// `calculus`）应该在**反序列化**时被拒，而不是存一个字符串进库、之后谁也认不出来。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Workspace {
    Conics,
    Geometry3d,
    Cad
}

impl Workspace {
    pub const ALL: [Workspace; 3] = [Workspace::Conics, Workspace::Geometry3d, Workspace::Cad];

    pub fn as_str(self) -> &'static str {
        match self {
            Workspace::Conics => "conics",
            Workspace::Geometry3d => "geometry3d",
            Workspace::Cad => "cad"
        }
    }

    /// 解析一个**线上**的值。`"Calculus"` / `"CONICS"` 都不认：线上只有小写那三个。
    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|candidate| candidate.as_str() == value)
    }
}

/// **事实的状态**。设计 5.2：只有 `confirmed/stale/retracted`。
///
/// `confirmed` 是"可以拿去规划"的那一档；`stale` 是"曾经成立、现在未必"；
/// `retracted` 是"用户撤回了它"。三态分开是因为界面与规划器对它们说的话完全不同 ——
/// 把 `retracted` 当 `stale` 会让一条被用户明确否掉的事实重新进入上下文。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FactStatus {
    Confirmed,
    Stale,
    Retracted
}

impl FactStatus {
    pub const ALL: [FactStatus; 3] = [FactStatus::Confirmed, FactStatus::Stale, FactStatus::Retracted];

    pub fn as_str(self) -> &'static str {
        match self {
            FactStatus::Confirmed => "confirmed",
            FactStatus::Stale => "stale",
            FactStatus::Retracted => "retracted"
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|candidate| candidate.as_str() == value)
    }
}

/// 新建一条会话。
///
/// `deny_unknown_fields`：调用方顺手多塞一个字段会被**拒绝**而不是静默削掉。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewConversation {
    pub id: String,
    pub project_id: String,
    pub document_id: String,
    pub workspace: Workspace,
    pub title: String
}

/// **一条会话绑定的三件事**：项目、文档、工作区（设计 5.1）。
///
/// 它同时是 `list` 的过滤器 —— 会话列表永远按整个绑定取，而不是按项目取。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationBinding {
    pub project_id: String,
    pub document_id: String,
    pub workspace: Workspace
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRecord {
    pub id: String,
    pub project_id: String,
    pub document_id: String,
    pub workspace: Workspace,
    pub title: String,
    /// 结构化摘要（目标 / 确认事实 / 已创建对象 / 未解决问题 / 用户偏好）。
    /// **不是**聊天记录本身，也**不是**模型的隐藏推理。
    pub summary: String,
    /// 摘要的版本号。条件更新靠它：按旧摘要压出来的新摘要不能盖掉别人刚写的那一份。
    pub summary_version: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived_at: Option<i64>
}

/// 要追加的一条消息。**序列号不在这里**：顺序是仓库的事，调用方说不了。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationMessageInput {
    /// 消息自己的 id，也是**幂等键**：同一个 id 重放是空操作。
    pub id: String,
    pub conversation_id: String,
    /// `user` / `assistant` 之类，由调用方定（这里的表只要求它是非空短串）。
    pub role: String,
    /// 消息的种类（`text` / `plan` / `receipt` …），同样由调用方定。
    pub kind: String,
    /// 消息正文（JSON）。**没有**放推理、候选文档或图像字节的位置。
    pub content_json: serde_json::Value,
    /// 这条消息属于哪一次运行（迟到的运行事件据此写回**原本**那条会话）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    /// 写下它时文档的 generation（事后能解释"当时看到的是哪一版"）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_generation: Option<i64>,
    pub token_estimate: i64,
    pub created_at: i64
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageRecord {
    pub id: String,
    pub conversation_id: String,
    /// 这条会话里的第几条（从 1 开始，由仓库分配）。
    pub sequence: i64,
    pub role: String,
    pub kind: String,
    pub content_json: serde_json::Value,
    pub run_id: Option<String>,
    pub document_generation: Option<i64>,
    pub token_estimate: i64,
    pub created_at: i64
}

/// 要写入的一条事实。**必须带证据**（`source_message_id`）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationFactInput {
    pub id: String,
    pub conversation_id: String,
    /// 事实的键。键相同就是**同一条事实**（`UNIQUE(conversation_id, key)`）。
    pub key: String,
    pub value_json: serde_json::Value,
    /// 证据：这条会话里的一条真实消息。
    pub source_message_id: String,
    pub status: FactStatus,
    pub created_at: i64
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationFactRecord {
    pub id: String,
    pub conversation_id: String,
    pub key: String,
    pub value_json: serde_json::Value,
    pub source_message_id: String,
    pub status: FactStatus,
    pub created_at: i64,
    pub updated_at: i64
}

/// **一条会话的全部内容**（记录 + 有界的一批消息与事实）。
///
/// 界面切回一条会话时只要一次往返：分开三条命令会让"读到一半的会话"变成一个
/// 可能出现中间状态的形状。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationDetail {
    pub conversation: ConversationRecord,
    pub messages: Vec<ConversationMessageRecord>,
    pub facts: Vec<ConversationFactRecord>
}

// ---------------------------------------------------------------- 边界校验
//
// 这些函数住在**仓库**里而不是命令里，有两个理由：
// ① 它们能被直接测（命令要 `AppHandle`，起不了）；
// ② 仓库自己也调一遍 —— 校验若只活在命令那一层，任何绕过命令的写入路径都逃得掉。
//    命令入口调用它们是"尽早给出好错误"，不是"唯一的防线"。

/// 一个必填文本字段：非空（去空白之后）、不超上限。
fn require_text(field: &str, value: &str, limit: usize) -> Result<(), RepositoryError> {
    if value.trim().is_empty() {
        // 空 id 是"这个绑定不存在"的另一种写法：放进去的话，这条会话挂在一个
        // 谁都查不到的绑定上 —— 那与丢掉它没有区别。
        return Err(RepositoryError::Invalid { detail: format!("{field} must not be empty") });
    }
    if value.chars().count() > limit {
        return Err(RepositoryError::Invalid { detail: format!("{field} is longer than {limit} characters") });
    }
    Ok(())
}

pub fn validate_binding(binding: &ConversationBinding) -> Result<(), RepositoryError> {
    require_text("the project id", &binding.project_id, MAX_ID_CHARS)?;
    require_text("the document id", &binding.document_id, MAX_ID_CHARS)
}

pub fn validate_new_conversation(conversation: &NewConversation) -> Result<(), RepositoryError> {
    require_text("the conversation id", &conversation.id, MAX_ID_CHARS)?;
    require_text("the project id", &conversation.project_id, MAX_ID_CHARS)?;
    require_text("the document id", &conversation.document_id, MAX_ID_CHARS)?;
    require_text("the title", &conversation.title, MAX_TITLE_CHARS)
}

pub fn validate_conversation_id(conversation_id: &str) -> Result<(), RepositoryError> {
    require_text("the conversation id", conversation_id, MAX_ID_CHARS)
}

pub fn validate_summary(summary: &str) -> Result<(), RepositoryError> {
    if summary.chars().count() > MAX_SUMMARY_CHARS {
        return Err(RepositoryError::Invalid { detail: format!("the summary is longer than {MAX_SUMMARY_CHARS} characters") });
    }
    Ok(())
}

/// 消息的边界判据：id 与绑定非空、正文有界、**不含明文凭据**。
pub fn validate_message_input(input: &ConversationMessageInput) -> Result<(), RepositoryError> {
    require_text("the message id", &input.id, MAX_ID_CHARS)?;
    require_text("the conversation id", &input.conversation_id, MAX_ID_CHARS)?;
    require_text("the message role", &input.role, MAX_ID_CHARS)?;
    require_text("the message kind", &input.kind, MAX_ID_CHARS)?;
    if input.token_estimate < 0 {
        return Err(RepositoryError::Invalid { detail: "the token estimate must not be negative".to_string() });
    }
    if let Some(run_id) = &input.run_id {
        require_text("the run id", run_id, MAX_ID_CHARS)?;
    }
    let content = input.content_json.to_string();
    // **明确的**凭据前缀一律拒绝（`sk-` / `sk_`）。刻意不用账本那套"长串一律抹掉"：
    // 64 位十六进制的提交哈希是正常对话内容的一部分（见 `contains_credential_prefix`）。
    if super::run_events::contains_credential_prefix(&content) {
        return Err(RepositoryError::Invalid { detail: format!("the message {} carries what looks like a provider key; keys do not belong in a transcript", input.id) });
    }
    if content.chars().count() > MAX_MESSAGE_CHARS {
        return Err(RepositoryError::Invalid { detail: format!("the message {} is longer than {MAX_MESSAGE_CHARS} characters", input.id) });
    }
    Ok(())
}

/// 事实的边界判据：键与证据非空、值有界。状态由类型（`FactStatus`）在入口就把住。
pub fn validate_fact_input(input: &ConversationFactInput) -> Result<(), RepositoryError> {
    require_text("the fact id", &input.id, MAX_ID_CHARS)?;
    require_text("the conversation id", &input.conversation_id, MAX_ID_CHARS)?;
    require_text("the fact key", &input.key, MAX_FACT_KEY_CHARS)?;
    require_text("the source message id", &input.source_message_id, MAX_ID_CHARS)?;
    let value = input.value_json.to_string();
    if value.chars().count() > MAX_FACT_VALUE_CHARS {
        return Err(RepositoryError::Invalid { detail: format!("the value of fact {} is longer than {MAX_FACT_VALUE_CHARS} characters", input.key) });
    }
    Ok(())
}

// ---------------------------------------------------------------- 读行

fn io(detail: String) -> RepositoryError {
    RepositoryError::Io { detail }
}

fn read_conversation_row(row: &rusqlite::Row<'_>) -> Result<ConversationRecord, RepositoryError> {
    let workspace: String = row.get(3).map_err(|error| io(format!("cannot read a conversation workspace: {error}")))?;
    Ok(ConversationRecord {
        id: row.get(0).map_err(|error| io(format!("cannot read a conversation id: {error}")))?,
        project_id: row.get(1).map_err(|error| io(format!("cannot read a conversation project: {error}")))?,
        document_id: row.get(2).map_err(|error| io(format!("cannot read a conversation document: {error}")))?,
        // 存进去的一定是三个值之一（写入前校验过）。不是的话**如实报错**，
        // 而不是回一个猜出来的工作区 —— 那会让"这一行坏了"看起来像"它属于另一个工作区"。
        workspace: Workspace::parse(&workspace)
            .ok_or_else(|| io(format!("a stored conversation carries an unknown workspace `{workspace}`")))?,
        title: row.get(4).map_err(|error| io(format!("cannot read a conversation title: {error}")))?,
        summary: row.get(5).map_err(|error| io(format!("cannot read a conversation summary: {error}")))?,
        summary_version: row.get(6).map_err(|error| io(format!("cannot read a summary version: {error}")))?,
        created_at: row.get(7).map_err(|error| io(format!("cannot read a conversation timestamp: {error}")))?,
        updated_at: row.get(8).map_err(|error| io(format!("cannot read a conversation timestamp: {error}")))?,
        archived_at: row.get(9).map_err(|error| io(format!("cannot read a conversation archive timestamp: {error}")))?
    })
}

const CONVERSATION_COLUMNS: &str = "id, project_id, document_id, workspace, title, summary, summary_version, created_at, updated_at, archived_at";

fn read_message_row(row: &rusqlite::Row<'_>) -> Result<ConversationMessageRecord, RepositoryError> {
    Ok(ConversationMessageRecord {
        id: row.get(0).map_err(|error| io(format!("cannot read a message id: {error}")))?,
        conversation_id: row.get(1).map_err(|error| io(format!("cannot read a message conversation: {error}")))?,
        sequence: row.get(2).map_err(|error| io(format!("cannot read a message sequence: {error}")))?,
        role: row.get(3).map_err(|error| io(format!("cannot read a message role: {error}")))?,
        kind: row.get(4).map_err(|error| io(format!("cannot read a message kind: {error}")))?,
        content_json: parse_json(row.get::<_, String>(5).map_err(|error| io(format!("cannot read a message body: {error}")))?)?,
        run_id: row.get(6).map_err(|error| io(format!("cannot read a message run: {error}")))?,
        document_generation: row.get(7).map_err(|error| io(format!("cannot read a message generation: {error}")))?,
        token_estimate: row.get(8).map_err(|error| io(format!("cannot read a message token estimate: {error}")))?,
        created_at: row.get(9).map_err(|error| io(format!("cannot read a message timestamp: {error}")))?
    })
}

/// 我们自己写进去的 JSON。解析失败**如实报错**，而不是回一个空对象 ——
/// 那会让"这一行坏了"看起来像"这条消息没有内容"。
fn parse_json(text: String) -> Result<serde_json::Value, RepositoryError> {
    serde_json::from_str(&text).map_err(|error| io(format!("a stored conversation payload is not valid JSON: {error}")))
}

fn read_fact_row(row: &rusqlite::Row<'_>) -> Result<ConversationFactRecord, RepositoryError> {
    let status: String = row.get(5).map_err(|error| io(format!("cannot read a fact status: {error}")))?;
    Ok(ConversationFactRecord {
        id: row.get(0).map_err(|error| io(format!("cannot read a fact id: {error}")))?,
        conversation_id: row.get(1).map_err(|error| io(format!("cannot read a fact conversation: {error}")))?,
        key: row.get(2).map_err(|error| io(format!("cannot read a fact key: {error}")))?,
        value_json: parse_json(row.get::<_, String>(3).map_err(|error| io(format!("cannot read a fact value: {error}")))?)?,
        source_message_id: row.get(4).map_err(|error| io(format!("cannot read a fact source: {error}")))?,
        status: FactStatus::parse(&status).ok_or_else(|| io(format!("a stored fact carries an unknown status `{status}`")))?,
        created_at: row.get(6).map_err(|error| io(format!("cannot read a fact timestamp: {error}")))?,
        updated_at: row.get(7).map_err(|error| io(format!("cannot read a fact timestamp: {error}")))?
    })
}

// ---------------------------------------------------------------- 会话

/// **建一条会话**。id 已经存在时**如实报冲突**，不覆盖（覆盖会把那条会话的历史一起吞掉）。
pub fn create(connection: &mut Connection, conversation: &NewConversation) -> Result<ConversationRecord, RepositoryError> {
    validate_new_conversation(conversation)?;
    let now = super::projects::now_ms();
    connection
        .execute(
            "INSERT INTO conversations (id, project_id, document_id, workspace, title, summary, summary_version, created_at, updated_at, archived_at) VALUES (?1, ?2, ?3, ?4, ?5, '', 1, ?6, ?6, NULL)",
            (
                conversation.id.as_str(),
                conversation.project_id.as_str(),
                conversation.document_id.as_str(),
                conversation.workspace.as_str(),
                conversation.title.as_str(),
                now
            )
        )
        .map_err(|error| conflict_or_io(error, format!("a conversation with id {} already exists", conversation.id)))?;

    Ok(ConversationRecord {
        id: conversation.id.clone(),
        project_id: conversation.project_id.clone(),
        document_id: conversation.document_id.clone(),
        workspace: conversation.workspace,
        title: conversation.title.clone(),
        summary: String::new(),
        summary_version: 1,
        created_at: now,
        updated_at: now,
        archived_at: None
    })
}

/// 约束冲突 → `Conflict`（"这件事已经有了"），其余 → `Io`。
///
/// 区分开是有意义的：把"磁盘满了"报成"这条会话已经存在"，会让人去查一个不存在的问题。
fn conflict_or_io(error: rusqlite::Error, detail: String) -> RepositoryError {
    match error {
        rusqlite::Error::SqliteFailure(failure, _) if failure.code == rusqlite::ErrorCode::ConstraintViolation => {
            RepositoryError::Conflict { detail: format!("{detail}: {failure}") }
        }
        other => io(format!("{detail}: {other}"))
    }
}

/// **列出这个绑定下还没归档的会话**（最近改动的在前，同一毫秒退到 id）。
pub fn list(connection: &Connection, binding: &ConversationBinding) -> Result<Vec<ConversationRecord>, RepositoryError> {
    validate_binding(binding)?;
    let sql = format!(
        "SELECT {CONVERSATION_COLUMNS} FROM conversations WHERE project_id = ?1 AND document_id = ?2 AND workspace = ?3 AND archived_at IS NULL ORDER BY updated_at DESC, id ASC LIMIT ?4"
    );
    let mut statement = connection.prepare(&sql).map_err(|error| io(format!("cannot prepare the conversation list: {error}")))?;
    let mut rows = statement
        .query((binding.project_id.as_str(), binding.document_id.as_str(), binding.workspace.as_str(), MAX_CONVERSATIONS as i64))
        .map_err(|error| io(format!("cannot read the conversations: {error}")))?;

    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|error| io(format!("cannot read a conversation row: {error}")))? {
        out.push(read_conversation_row(row)?);
    }
    Ok(out)
}

fn read_record(connection: &Connection, conversation_id: &str) -> Result<ConversationRecord, RepositoryError> {
    let sql = format!("SELECT {CONVERSATION_COLUMNS} FROM conversations WHERE id = ?1");
    let mut statement = connection.prepare(&sql).map_err(|error| io(format!("cannot prepare the conversation query: {error}")))?;
    let mut rows = statement.query((conversation_id,)).map_err(|error| io(format!("cannot read the conversation: {error}")))?;
    match rows.next().map_err(|error| io(format!("cannot read the conversation: {error}")))? {
        Some(row) => read_conversation_row(row),
        None => Err(RepositoryError::NotFound { detail: format!("no conversation {conversation_id}") })
    }
}

/// 会话必须存在（消息与事实都挂在一个真实存在的会话上）。
fn ensure_conversation(connection: &Connection, conversation_id: &str) -> Result<(), RepositoryError> {
    let found: Option<i64> = connection
        .query_row("SELECT 1 FROM conversations WHERE id = ?1", (conversation_id,), |row| row.get(0))
        .optional()
        .map_err(|error| io(format!("cannot look up the conversation: {error}")))?;
    found.map(|_| ()).ok_or_else(|| RepositoryError::NotFound { detail: format!("no conversation {conversation_id}") })
}

/// **读一条会话的全部内容**（记录 + 有界的一批消息与事实）。
pub fn read_conversation(connection: &Connection, conversation_id: &str) -> Result<ConversationDetail, RepositoryError> {
    validate_conversation_id(conversation_id)?;
    let conversation = read_record(connection, conversation_id)?;
    let messages = read_messages(connection, conversation_id)?;
    let facts = read_facts(connection, conversation_id)?;
    Ok(ConversationDetail { conversation, messages, facts })
}

/// **归档一条会话**：从列表里消失，但记录与历史都还在（归档不是删除）。
///
/// 重复归档**不是错误**（按钮可能被点两次），而且它**不推进** `updated_at` ——
/// 归档这件事本身不该把一条旧会话顶到列表最前面（它已经不在列表里了，但取消归档之后
/// 顺序仍然该反映"用户最后一次跟它说话"是什么时候）。
pub fn archive(connection: &mut Connection, conversation_id: &str) -> Result<ConversationRecord, RepositoryError> {
    validate_conversation_id(conversation_id)?;
    let now = super::projects::now_ms();
    connection
        .execute(
            "UPDATE conversations SET archived_at = ?1, updated_at = ?1 WHERE id = ?2 AND archived_at IS NULL",
            (now, conversation_id)
        )
        .map_err(|error| io(format!("cannot archive the conversation: {error}")))?;
    read_record(connection, conversation_id)
}

/// **删掉一条会话**（连同它的消息与事实）。
///
/// 返回"这次真的删掉了吗"：第二次删**不是错误**（按钮可能被点两次、重试可能重复到达），
/// 但它如实回 `false` —— 调用方据此知道"这条会话本来就不在了"。
///
/// ## 为什么级联不交给 `PRAGMA foreign_keys`
///
/// schema 上的 `ON DELETE CASCADE` 是**归属**的声明（迁移测试直接查 SQL 层证明它在），
/// 但 `foreign_keys` 是**每个连接**的设置，而 SQLite 的默认值是**关**。
/// 一个忘了打开它的连接会让级联静默失效：会话没了、消息还在库里，谁也读不到它们。
/// 删除是用户看得见的动作，所以这里显式删三张表，让它在任何连接配置下都成立。
pub fn delete(connection: &mut Connection, conversation_id: &str) -> Result<bool, RepositoryError> {
    validate_conversation_id(conversation_id)?;
    let transaction = connection.transaction().map_err(|error| io(format!("cannot start a transaction: {error}")))?;
    transaction
        .execute("DELETE FROM conversation_facts WHERE conversation_id = ?1", (conversation_id,))
        .map_err(|error| io(format!("cannot delete the conversation facts: {error}")))?;
    transaction
        .execute("DELETE FROM conversation_messages WHERE conversation_id = ?1", (conversation_id,))
        .map_err(|error| io(format!("cannot delete the conversation messages: {error}")))?;
    let removed = transaction
        .execute("DELETE FROM conversations WHERE id = ?1", (conversation_id,))
        .map_err(|error| io(format!("cannot delete the conversation: {error}")))?;
    transaction.commit().map_err(|error| io(format!("cannot commit the deletion: {error}")))?;
    Ok(removed == 1)
}

// ---------------------------------------------------------------- 消息

/// **追加一条消息**。同一个 id 重放是空操作（返回 `false`，**不是错误**）。
///
/// 序号由这里分配（`MAX(sequence) + 1`），而且在**同一个事务里**读与写：
/// 分开做的话两个写入者会算出同一个序号，而本表的唯一约束会把其中一个拒掉 ——
/// 拒掉是**对的**（静默丢消息才是灾难），但能让它不发生就不该让它发生。
pub fn append_message(connection: &mut Connection, input: &ConversationMessageInput) -> Result<bool, RepositoryError> {
    validate_message_input(input)?;
    let transaction = connection.transaction().map_err(|error| io(format!("cannot start a transaction: {error}")))?;
    ensure_conversation(&transaction, &input.conversation_id)?;

    let existing: Option<i64> = transaction
        .query_row("SELECT 1 FROM conversation_messages WHERE id = ?1", (input.id.as_str(),), |row| row.get(0))
        .optional()
        .map_err(|error| io(format!("cannot look up the message: {error}")))?;
    if existing.is_some() {
        // 重放：什么都不写、**不占序号**，如实回 `false`。
        return Ok(false);
    }

    let sequence: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM conversation_messages WHERE conversation_id = ?1",
            (input.conversation_id.as_str(),),
            |row| row.get(0)
        )
        .map_err(|error| io(format!("cannot read the next message sequence: {error}")))?;

    transaction
        .execute(
            "INSERT INTO conversation_messages (id, conversation_id, sequence, role, kind, content_json, run_id, document_generation, token_estimate, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            (
                input.id.as_str(),
                input.conversation_id.as_str(),
                sequence,
                input.role.as_str(),
                input.kind.as_str(),
                input.content_json.to_string(),
                input.run_id.as_deref(),
                input.document_generation,
                input.token_estimate,
                input.created_at
            )
        )
        .map_err(|error| conflict_or_io(error, format!("cannot append the message {} (sequence {sequence})", input.id)))?;
    transaction.commit().map_err(|error| io(format!("cannot commit the message: {error}")))?;
    Ok(true)
}

/// **读一条会话的消息**（按序号升序，最多 [`MAX_MESSAGES`] 条）。
///
/// 超上限时留下的是**最近**的那些：砍掉最新的一头会让规划器看不到用户刚说的话，
/// 而那正是这一批消息唯一的用处。实现上先按序号倒序取一批，再正序排回来。
pub fn read_messages(connection: &Connection, conversation_id: &str) -> Result<Vec<ConversationMessageRecord>, RepositoryError> {
    validate_conversation_id(conversation_id)?;
    let mut statement = connection
        .prepare(
            "SELECT id, conversation_id, sequence, role, kind, content_json, run_id, document_generation, token_estimate, created_at FROM (SELECT id, conversation_id, sequence, role, kind, content_json, run_id, document_generation, token_estimate, created_at FROM conversation_messages WHERE conversation_id = ?1 ORDER BY sequence DESC LIMIT ?2) ORDER BY sequence ASC"
        )
        .map_err(|error| io(format!("cannot prepare the message query: {error}")))?;
    let mut rows = statement
        .query((conversation_id, MAX_MESSAGES as i64))
        .map_err(|error| io(format!("cannot read the messages: {error}")))?;

    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|error| io(format!("cannot read a message row: {error}")))? {
        out.push(read_message_row(row)?);
    }
    Ok(out)
}

// ---------------------------------------------------------------- 摘要

/// **写一份新的摘要**（版本号 +1）。
///
/// `expected_version` 是条件更新：`Some(v)` 时只有库里的版本**正好是 v** 才写。
/// 那是"按旧摘要压出来的新摘要"与"别人刚写的那一份"之间唯一的分界线。
pub fn update_summary(
    connection: &mut Connection,
    conversation_id: &str,
    summary: &str,
    expected_version: Option<i64>
) -> Result<ConversationRecord, RepositoryError> {
    validate_conversation_id(conversation_id)?;
    validate_summary(summary)?;
    let transaction = connection.transaction().map_err(|error| io(format!("cannot start a transaction: {error}")))?;
    let version: Option<i64> = transaction
        .query_row("SELECT summary_version FROM conversations WHERE id = ?1", (conversation_id,), |row| row.get(0))
        .optional()
        .map_err(|error| io(format!("cannot read the summary version: {error}")))?;
    let version = version.ok_or_else(|| RepositoryError::NotFound { detail: format!("no conversation {conversation_id}") })?;

    if let Some(expected) = expected_version {
        if expected != version {
            return Err(RepositoryError::Conflict {
                detail: format!("the summary of {conversation_id} is at version {version}, not {expected}; rebuild it from the current summary")
            });
        }
    }

    transaction
        .execute(
            "UPDATE conversations SET summary = ?1, summary_version = ?2, updated_at = ?3 WHERE id = ?4",
            (summary, version + 1, super::projects::now_ms(), conversation_id)
        )
        .map_err(|error| io(format!("cannot write the summary: {error}")))?;
    let record = read_record(&transaction, conversation_id)?;
    transaction.commit().map_err(|error| io(format!("cannot commit the summary: {error}")))?;
    Ok(record)
}

// ---------------------------------------------------------------- 事实

/// **写一条事实**（按 `(conversation_id, key)` upsert）。
///
/// 返回**库里那一行**（而不是调用方给的那份）：键相同就是同一行，于是 `id` 与
/// `created_at` 都是**第一次写入**留下的 —— 一条事实的身份不该在每次更新时漂移。
pub fn upsert_fact(connection: &mut Connection, input: &ConversationFactInput) -> Result<ConversationFactRecord, RepositoryError> {
    validate_fact_input(input)?;
    let transaction = connection.transaction().map_err(|error| io(format!("cannot start a transaction: {error}")))?;
    ensure_conversation(&transaction, &input.conversation_id)?;

    // 证据必须是**这条会话里真的存在**的消息。跨会话的引用是把 A 的结论写进 B 的直通车。
    let evidence: Option<i64> = transaction
        .query_row(
            "SELECT 1 FROM conversation_messages WHERE id = ?1 AND conversation_id = ?2",
            (input.source_message_id.as_str(), input.conversation_id.as_str()),
            |row| row.get(0)
        )
        .optional()
        .map_err(|error| io(format!("cannot look up the evidence: {error}")))?;
    if evidence.is_none() {
        return Err(RepositoryError::NotFound {
            detail: format!("no message {} in conversation {}; a fact must be evidenced by its own conversation", input.source_message_id, input.conversation_id)
        });
    }

    let now = super::projects::now_ms();
    transaction
        .execute(
            "INSERT INTO conversation_facts (id, conversation_id, key, value_json, source_message_id, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7) ON CONFLICT(conversation_id, key) DO UPDATE SET value_json = excluded.value_json, source_message_id = excluded.source_message_id, status = excluded.status, updated_at = excluded.updated_at",
            (
                input.id.as_str(),
                input.conversation_id.as_str(),
                input.key.as_str(),
                input.value_json.to_string(),
                input.source_message_id.as_str(),
                input.status.as_str(),
                now
            )
        )
        .map_err(|error| conflict_or_io(error, format!("cannot write the fact {}", input.key)))?;

    let record = read_fact(&transaction, &input.conversation_id, &input.key)?;
    transaction.commit().map_err(|error| io(format!("cannot commit the fact: {error}")))?;
    Ok(record)
}

fn read_fact(connection: &Connection, conversation_id: &str, key: &str) -> Result<ConversationFactRecord, RepositoryError> {
    let mut statement = connection
        .prepare("SELECT id, conversation_id, key, value_json, source_message_id, status, created_at, updated_at FROM conversation_facts WHERE conversation_id = ?1 AND key = ?2")
        .map_err(|error| io(format!("cannot prepare the fact query: {error}")))?;
    let mut rows = statement
        .query((conversation_id, key))
        .map_err(|error| io(format!("cannot read the fact: {error}")))?;
    match rows.next().map_err(|error| io(format!("cannot read the fact: {error}")))? {
        Some(row) => read_fact_row(row),
        None => Err(RepositoryError::NotFound { detail: format!("no fact {key} in conversation {conversation_id}") })
    }
}

/// **读一条会话的事实**（最近的证据在前，同一时间戳退到 key）。
pub fn read_facts(connection: &Connection, conversation_id: &str) -> Result<Vec<ConversationFactRecord>, RepositoryError> {
    validate_conversation_id(conversation_id)?;
    let mut statement = connection
        .prepare(
            "SELECT id, conversation_id, key, value_json, source_message_id, status, created_at, updated_at FROM conversation_facts WHERE conversation_id = ?1 ORDER BY updated_at DESC, key ASC LIMIT ?2"
        )
        .map_err(|error| io(format!("cannot prepare the fact list: {error}")))?;
    let mut rows = statement
        .query((conversation_id, MAX_FACTS as i64))
        .map_err(|error| io(format!("cannot read the facts: {error}")))?;

    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|error| io(format!("cannot read a fact row: {error}")))? {
        out.push(read_fact_row(row)?);
    }
    Ok(out)
}
