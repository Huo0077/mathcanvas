//! **运行事件的落盘**（Task 2.6 Step 3/5）。
//!
//! 表在迁移 1 里就建好了（`run_events(event_id PRIMARY KEY, run_id, payload, created_at)`），
//! 而在此之前**没有任何一行写进去过** —— 也就是说"运行账本"只活在内存里（代理的
//! `RunRegistry` 有界、重开就没了）。这个文件是那一半。
//!
//! ## 三条纪律，逐条有判据
//!
//! 1. **只追加、按 `event_id` 幂等**（计划原文 "append-only and idempotent by event ID"）。
//!    用 `INSERT OR IGNORE` 而不是"先查再写"：查与写之间的竞态在这里没有意义，
//!    而 `OR IGNORE` 让"重放同一条事件"变成一次空操作，代价是一行 SQL。
//! 2. **它绝不存模型推理与图像字节**（计划原文 "never stores raw model reasoning or image bytes"）。
//!    这条靠**结构**成立：`RunEventInput` 里没有放它们的位置，而且带
//!    `deny_unknown_fields` —— 多一个字段就**拒绝**，不是静默削掉。
//!    静默削掉比拒绝更危险：调用方会以为存进去了（那正是"profile 里混进 apiKey"那次的教训）。
//! 3. **有界**：`detail` 截断到 [`MAX_DETAIL`]，一次读取最多 [`MAX_EVENTS`] 条。
//!    没有上限的账本长成一个不能被读的账本，而那与"没有账本"是同一种结局。
//!
//! ## 脱敏是**默认拒绝**式的
//!
//! 判据不是"认出几种密钥前缀就抹几种"，而是**任何看起来像密钥的长串一律抹掉**：
//! 32 个字符以上的 `[A-Za-z0-9._-]` 连续串、`sk-` / `sk_` 开头、`bearer` 后面跟的东西。
//! 认前缀的做法必然会漏（每家 provider 的前缀都不一样，而泄漏只需要漏一次）。
//! 已知的密钥串（调用方手上那份）由上层额外替换 —— 这里是**兜底**，不是唯一一道。

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::projects::RepositoryError;

/// `detail` 的字符上限。与前端运行账本的 512 同一个量级 —— 账本是"发生了什么"，
/// 不是"完整响应体"，而后者本来就该留在日志里而不是数据库里。
pub const MAX_DETAIL: usize = 512;

/// 一次读取最多返回多少条。**有界**，并且截断了要能看出来（见 `list` 的返回）。
pub const MAX_EVENTS: usize = 512;

/// **一条运行事件能带的全部东西**。
///
/// 注意这里**没有** `reasoning` / `imageBytes` / `rawResponse` 之类的位置，而且
/// `deny_unknown_fields` 让"顺手多塞一个字段"变成一次**响亮的拒绝**。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunEventInput {
    /// 事件自己的 id。**幂等键**：同一条事件重放不会多出一行。
    pub event_id: String,
    pub run_id: String,
    pub conversation_id: String,
    pub phase: String,
    /// `ok` / `error` / `pending` 之类，由调用方定。
    pub status: String,
    /// 一句话说明。**落盘前会过脱敏**。
    pub detail: String,
    /// 事件发生的时间（毫秒）。
    pub at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft_version: Option<i64>,
    /// 这次运行用的是哪一版能力注册表与策略（事后解释"当时它看到的是什么"）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub versions: Option<RunEventVersions>,
    /// 用量。**只有数字** —— 计划要求事件带 usage，而它不该顺带把内容带进来。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<RunEventUsage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunEventVersions {
    pub capability_revision: String,
    pub policy_revision: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunEventUsage {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
}

/// 读回来的一条事件。`payload` 是**已脱敏**的那份 JSON。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEventRecord {
    pub event_id: String,
    pub run_id: String,
    pub payload: serde_json::Value,
    pub created_at: i64,
}

/// 这个字符算"密钥串的一部分"吗。`.` 也算：JWT 与很多令牌里都有它。
fn is_token_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '-' || character == '_' || character == '.'
}

/// 一段文本里所有"令牌字符"的**连续段**。分隔符（空格、冒号、中文……）被丢掉。
fn token_runs(text: &str) -> impl Iterator<Item = &str> {
    text.split(|character: char| !is_token_character(character))
}

/// 一段文本里有没有**明确的凭据前缀**（`sk-` / `sk_`）。
///
/// 它**不是** [`redact`] 那条"默认拒绝式"规则：账本是内部诊断，把任何长串一律抹掉
/// 只是难看；而对话内容是**要原样回显给用户**的 —— 把 64 位十六进制的提交哈希
/// （提交回执里就带着它）当成密钥拒绝掉，那是数据损坏。所以这里只认那两家都用、
/// 而且几乎不会出现在正常句子里的前缀。
pub fn contains_credential_prefix(text: &str) -> bool {
    token_runs(text).any(|run| {
        let lowered = run.to_ascii_lowercase();
        lowered.starts_with("sk-") || lowered.starts_with("sk_")
    })
}

/// 这一个"令牌段"像不像密钥（**默认拒绝式**的判据，[`redact`] 用的就是它）。
fn is_key_shaped(run: &str) -> bool {
    run.chars().count() >= 32 || run.to_ascii_lowercase().starts_with("bearer") || contains_credential_prefix(run)
}

/// **默认拒绝式脱敏**。
///
/// 规则只有一条主线：**连续 32 个以上的"令牌字符"一律抹掉**，外加三个明确的前缀
/// （`sk-` / `sk_` / `bearer`）。与其去认每一家的前缀，不如反过来：不像密钥的都放过，
/// 像密钥的一律不留 —— 漏一次就够难受了，而误抹一句普通说明只是难看。
pub fn redact(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut run = String::new();

    fn flush(run: &mut String, out: &mut String) {
        if run.is_empty() {
            return;
        }
        out.push_str(if is_key_shaped(run) { "[redacted]" } else { run.as_str() });
        run.clear();
    }

    for character in text.chars() {
        if is_token_character(character) {
            run.push(character);
        } else {
            flush(&mut run, &mut out);
            out.push(character);
        }
    }
    flush(&mut run, &mut out);

    // 截断按**字符**而不是字节：切在半个 UTF-8 字符中间会 panic。
    out.chars().take(MAX_DETAIL).collect()
}

/// 把输入收成要落盘的那一行（`detail` 已经脱敏、`at` 原样）。
fn payload_of(event: &RunEventInput) -> serde_json::Value {
    serde_json::json!({
        "eventId": event.event_id,
        "runId": event.run_id,
        "conversationId": event.conversation_id,
        "promptMessageId": event.prompt_message_id,
        "requestId": event.request_id,
        "attemptId": event.attempt_id,
        "draftVersion": event.draft_version,
        "phase": event.phase,
        "status": event.status,
        "detail": redact(&event.detail),
        "at": event.at,
        "versions": event.versions,
        "usage": event.usage
    })
}

/// **追加一条事件**。返回"这次真的写了一行吗"（同一个 `event_id` 第二次返回 `false`）。
pub fn append(connection: &Connection, event: &RunEventInput) -> Result<bool, RepositoryError> {
    let payload = payload_of(event).to_string();
    let written = connection
        .execute(
            "INSERT OR IGNORE INTO run_events (event_id, run_id, payload, created_at) VALUES (?1, ?2, ?3, ?4)",
            (&event.event_id, &event.run_id, &payload, event.at)
        )
        .map_err(|error| RepositoryError::Io { detail: format!("cannot append the run event: {error}") })?;
    Ok(written == 1)
}

/// **读一条运行的事件**（按写入顺序，有界）。
///
/// 排序用 `created_at` 再退到 `rowid`：同一毫秒里写入的事件靠 `rowid`（插入顺序）定序 ——
/// 只按 `created_at` 排会让同毫秒的事件每次读出来顺序都可能不一样，而账本的顺序是它的意义所在。
pub fn list(connection: &Connection, run_id: &str) -> Result<Vec<RunEventRecord>, RepositoryError> {
    let mut statement = connection
        .prepare("SELECT event_id, run_id, payload, created_at FROM run_events WHERE run_id = ?1 ORDER BY created_at ASC, rowid ASC LIMIT ?2")
        .map_err(|error| RepositoryError::Io { detail: format!("cannot prepare the run event query: {error}") })?;
    let rows = statement
        .query_map((run_id, MAX_EVENTS as i64), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, i64>(3)?))
        })
        .map_err(|error| RepositoryError::Io { detail: format!("cannot read the run events: {error}") })?;

    let mut events = Vec::new();
    for row in rows {
        let (event_id, run_id, payload, created_at) = row.map_err(|error| RepositoryError::Io { detail: format!("cannot read a run event row: {error}") })?;
        // payload 是我们自己写的 JSON。**解析失败如实报错**，而不是回一个空对象 ——
        // 那会让"这一行坏了"看起来像"这条事件没有内容"。
        let parsed: serde_json::Value = serde_json::from_str(&payload)
            .map_err(|error| RepositoryError::Io { detail: format!("a stored run event is not valid JSON: {error}") })?;
        events.push(RunEventRecord { event_id, run_id, payload: parsed, created_at });
    }
    Ok(events)
}

/// 一共存了多少条（供界面与测试看"账本真的在长"）。
pub fn count(connection: &Connection) -> Result<i64, RepositoryError> {
    connection
        .query_row("SELECT COUNT(*) FROM run_events", [], |row| row.get(0))
        .map_err(|error| RepositoryError::Io { detail: format!("cannot count the run events: {error}") })
}
