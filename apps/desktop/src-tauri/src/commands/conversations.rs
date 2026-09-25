use tauri::Manager;

use crate::repository;
use crate::RepositoryState;

/**
 * **多会话命令**（从 `lib.rs` 拆出，评审方案 2）：八条具名命令，逐条对应前端
 * `conversationClient.ts` 的一个方法。
 *
 * 它们给前端的是"会话"这一层语义，而不是一把能执行任意 SQL 的钥匙 —— 消息与事实的边界判据
 * （id、工作区、消息长度、事实状态）在 Rust 侧先跑。
 */

// ---------------------------------------------------------------- 多会话（Task 1 / Task 2）
//
// 八条具名命令，逐条对应前端 `conversationClient.ts` 的一个方法。
//
// ## 校验在**命令这一层**先跑一遍，然后仓库自己再跑一遍
//
// 计划 Task 2 原文："Add named Rust commands that validate IDs, workspace values,
// message size, and fact status **before repository calls**." 所以每条命令的第一件事
// 就是调用 `conversations::validate_*` —— 于是一个不合法的请求**不会**先被拿去开事务、
// 也不会在"库没打开"时被报成一个存储错误。仓库里那一遍是第二道（任何绕过命令的写入
// 路径也要被挡住），判据只有一份（那些函数），所以两道防线不会分叉。
//
// ## 工作区与事实状态由**类型**把守
//
// `Workspace` / `FactStatus` 是带 serde 枚举的：`"calculus"` 或 `"maybe"` 在
// **反序列化**时就被拒（带着"expected one of …"的清单），连函数体都进不来。
// 把它们写成 `String` 再手写一遍解析，只会多一份会忘记更新的判据。
//
// ## 错误一律是 `String`
//
// 与文档 / 附件那几条命令同一口径：前端要的是**能读懂的一句话**（"这条会话的摘要是
// 第 3 版，不是第 2 版"），而不是重新从错误码里猜。分类靠命令本身（哪条命令失败）
// 与消息里的措辞。

/// **建一条会话**（绑定一个项目 / 文档 / 工作区）。
#[tauri::command]
pub fn create_conversation(app: tauri::AppHandle, conversation: repository::conversations::NewConversation) -> Result<repository::conversations::ConversationRecord, String> {
    repository::conversations::validate_new_conversation(&conversation).map_err(|error| error.to_string())?;
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let mut repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.create_conversation(&conversation).map_err(|error| error.to_string())
}

/// **列出这个绑定下还没归档的会话**（最近改动的在前）。
#[tauri::command]
pub fn list_conversations(app: tauri::AppHandle, binding: repository::conversations::ConversationBinding) -> Result<Vec<repository::conversations::ConversationRecord>, String> {
    repository::conversations::validate_binding(&binding).map_err(|error| error.to_string())?;
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.list_conversations(&binding).map_err(|error| error.to_string())
}

/// **读一条会话的全部内容**（记录 + 有界的一批消息与事实）—— 切回一条会话只要一次往返。
#[tauri::command]
pub fn read_conversation(app: tauri::AppHandle, conversation_id: String) -> Result<repository::conversations::ConversationDetail, String> {
    repository::conversations::validate_conversation_id(&conversation_id).map_err(|error| error.to_string())?;
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.read_conversation(&conversation_id).map_err(|error| error.to_string())
}

/// **追加一条消息**。同一个 `id` 第二次回 `false`（幂等，**不是错误**）。
///
/// 收**结构化**的消息而不是原始 JSON：`ConversationMessageInput` 带
/// `deny_unknown_fields`，所以一个带着 `reasoning` / `candidateDocument` / `imageBytes`
/// 的消息会在**入口**被拒（计划的不变量："不持久化 hidden chain-of-thought、密钥、
/// 候选文档全文与图像字节"）。静默削掉那个字段比拒绝更危险：调用方会以为它存进去了。
#[tauri::command]
pub fn append_conversation_message(app: tauri::AppHandle, message: repository::conversations::ConversationMessageInput) -> Result<bool, String> {
    repository::conversations::validate_message_input(&message).map_err(|error| error.to_string())?;
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let mut repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.append_conversation_message(&message).map_err(|error| error.to_string())
}

/// **写一份新的摘要**（版本号 +1）。`expected_version` 是条件更新：按旧摘要压出来的
/// 新摘要不能盖掉别人刚写的那一份。
#[tauri::command]
pub fn update_conversation_summary(app: tauri::AppHandle, conversation_id: String, summary: String, expected_version: Option<i64>) -> Result<repository::conversations::ConversationRecord, String> {
    repository::conversations::validate_conversation_id(&conversation_id).map_err(|error| error.to_string())?;
    repository::conversations::validate_summary(&summary).map_err(|error| error.to_string())?;
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let mut repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.update_conversation_summary(&conversation_id, &summary, expected_version).map_err(|error| error.to_string())
}

/// **写一条事实**（按 `(conversationId, key)` upsert）。
///
/// 证据（`sourceMessageId`）必须属于**同一条会话**，仓库会在写之前查一次：
/// 跨会话的引用是把 A 的结论写进 B 的直通车，而那正是"会话之间不串事实"要挡的。
#[tauri::command]
pub fn update_conversation_fact(app: tauri::AppHandle, fact: repository::conversations::ConversationFactInput) -> Result<repository::conversations::ConversationFactRecord, String> {
    repository::conversations::validate_fact_input(&fact).map_err(|error| error.to_string())?;
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let mut repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.upsert_conversation_fact(&fact).map_err(|error| error.to_string())
}

/// **归档一条会话**（从列表里消失，记录与历史都还在）。重复归档不是错误。
#[tauri::command]
pub fn archive_conversation(app: tauri::AppHandle, conversation_id: String) -> Result<repository::conversations::ConversationRecord, String> {
    repository::conversations::validate_conversation_id(&conversation_id).map_err(|error| error.to_string())?;
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let mut repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.archive_conversation(&conversation_id).map_err(|error| error.to_string())
}

/// **删掉一条会话**（连同它的消息与事实）。
///
/// 回"这次真的删掉了吗"：重复删**不是错误**，但它如实回 `false`。
#[tauri::command]
pub fn delete_conversation(app: tauri::AppHandle, conversation_id: String) -> Result<bool, String> {
    repository::conversations::validate_conversation_id(&conversation_id).map_err(|error| error.to_string())?;
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let mut repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.delete_conversation(&conversation_id).map_err(|error| error.to_string())
}
