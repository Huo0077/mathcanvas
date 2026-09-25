use tauri::Manager;

use crate::repository;
use crate::repository::projects::{CommitReceipt, CommitRequest, DocumentSnapshot};
use crate::{BlobState, RepositoryState};

/**
 * **项目仓储 / 附件 / 运行账本三组命令**（从 `lib.rs` 拆出，评审方案 2）。
 *
 * 这三组碰的是**同一份托管状态**（`RepositoryState` 的 SQLite 与 `BlobState` 的附件目录），
 * 所以放在一起：GC 与导入导出要**同时**问两边（"哪些被引用"来自库、"磁盘上有什么"来自目录），
 * 分开文件只会让那条跨状态的判据难读。
 *
 * 两阶段写与"默认拒绝"这两条口径随代码一起搬过来（见各命令自己的说明）。
 */

// ---------------------------------------------------------------- 项目仓储（Task 1.6）

/// **读一份文档的 head**。找不到时**如实报错**，不回一份空文档 ——
/// 空文档会让前端以为"这份文档是空的"，而不是"它还不存在"。
#[tauri::command]
pub fn read_document_head(app: tauri::AppHandle, project_id: String, document_id: String) -> Result<DocumentSnapshot, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.read_head(&project_id, &document_id).map_err(|error| error.to_string())
}

/// **读这个项目里最新的那一份文档 head**；项目里一份都没有时回 `None`。
///
/// 恢复路径的兜底（外部审查 X1）：前端按 `document_id` 精确探测落空时，用它区分
/// "本地没记住 id"（仓储里有内容 → 读回来）与"真正的首次启动"（项目里空无一物 → 建一份）。
/// 没有它，记忆一丢就把已存的文档当成不存在。
#[tauri::command]
pub fn read_latest_document_head(app: tauri::AppHandle, project_id: String) -> Result<Option<DocumentSnapshot>, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.read_latest_head(&project_id).map_err(|error| error.to_string())
}

/// **建一份文档**（首次写入）。
///
/// 内容哈希**由前端算好传进来**：规则在 `scene-graph` 的 `contentFingerprint` 里
///（要剔掉 `revision` / `updatedAt`、把 `visible: true` 视同缺省）。
/// 在 Rust 里再实现一遍必然分叉，而分叉的后果是**同一份文档有两个哈希** ——
/// CAS 会永远失败，且看起来像"并发冲突"。
#[tauri::command]
pub fn create_document(app: tauri::AppHandle, project_id: String, document_id: String, epoch: String, content: String, content_hash: String) -> Result<DocumentSnapshot, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let mut repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.create(&project_id, &document_id, &epoch, &content, &content_hash).map_err(|error| error.to_string())
}

/// **提交一次改动**（CAS + 幂等 + 原子写三张表）。
///
/// `idempotency_key` 由调用方给：这样"网络重试"与"用户点了两次"都会落到同一条记录上，
/// 而不会推进两次 generation。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn commit_document(
    app: tauri::AppHandle,
    idempotency_key: String,
    project_id: String,
    document_id: String,
    expected_epoch: String,
    expected_generation: i64,
    expected_content_hash: String,
    content: String,
    content_hash: String,
    actions: usize
) -> Result<CommitReceipt, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let mut repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository
        .commit(CommitRequest {
            idempotency_key,
            project_id,
            document_id,
            expected_epoch,
            expected_generation,
            expected_content_hash,
            content,
            content_hash,
            actions
        })
        .map_err(|error| error.to_string())
}

/// **按幂等键查提交状态**（"DB 已提交、响应丢了"那条路径）。
#[tauri::command]
pub fn lookup_commit(app: tauri::AppHandle, idempotency_key: String) -> Result<Option<CommitReceipt>, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.lookup_commit(&idempotency_key).map_err(|error| error.to_string())
}

/// 读历史里某一版的内容（撤销 / 重做靠它）。
#[tauri::command]
pub fn read_document_snapshot(app: tauri::AppHandle, project_id: String, document_id: String, generation: i64) -> Result<DocumentSnapshot, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.read_snapshot(&project_id, &document_id, generation).map_err(|error| error.to_string())
}

/// 历史里有多少版（含 head）。
#[tauri::command]
pub fn document_history_length(app: tauri::AppHandle, project_id: String, document_id: String) -> Result<i64, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.history_length(&project_id, &document_id).map_err(|error| error.to_string())
}

/// **换一世**：导入 / 打开文件之后，把 head 的 epoch 换掉并写入新内容。
///
/// 为什么这是一个**独立**的原语，而不是"删掉再建"或"当成一次普通提交"：
/// - 删掉再建会**丢掉历史** —— 而"打开文件之后还能撤销回上一次"是这条路径的应有之义；
/// - 当成普通提交则该不了 epoch，于是**在途的旧保存仍然能写进来**
///   （它携带的期望与新 head 匹配）—— 用户刚打开的文档会被上一次编辑覆盖。
///
/// epoch 一变，所有在途请求的 CAS 立刻失败。这正是它存在的意义。
#[tauri::command]
pub fn replace_document_epoch(app: tauri::AppHandle, project_id: String, document_id: String, epoch: String, content: String, content_hash: String) -> Result<DocumentSnapshot, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let mut repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.replace_epoch(&project_id, &document_id, &epoch, &content, &content_hash).map_err(|error| error.to_string())
}

// ---------------------------------------------------------------- 附件与 .mcanvas（Task 1.6 Step 4/5）

/**
 * **存一份附件**（两阶段写的第一阶段 + 引用）。
 *
 * ## 两阶段的顺序**必须由这一条命令保证**，不能交给调用方
 *
 * 计划原文："Hash/size-check and atomically rename the blob first, then insert the DB reference."
 * 所以这里的顺序写死成：①按声明的哈希校验并原子落盘（`blobs.write`）→
 * ②记附件元数据 → ③记"这一版快照引用了它"。
 *
 * 崩溃可能落在任何两步之间，而两阶段的取舍是**故意的**：
 * - 落在 ① 与 ② 之间 → 磁盘上多一个没人引用的 blob（**孤儿**，GC 会收掉它）；
 * - 反过来先写库 → 库里说有这么个附件、文件却不在，用户打开文档会看到"附件丢失"。
 *
 * 前者只是浪费空间，后者是用户可见的损坏。
 */
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn put_attachment(
    app: tauri::AppHandle,
    project_id: String,
    document_id: String,
    generation: i64,
    content_hash: String,
    media_type: String,
    base64_bytes: String
) -> Result<serde_json::Value, String> {
    let bytes = decode_base64(&base64_bytes).ok_or("the attachment is not valid base64")?;
    let blobs = app.try_state::<BlobState>().ok_or("the attachment store is not initialised")?;
    // **① 落盘**（哈希门在里面：对不上就一字节都不写）。
    let staged = blobs.blobs.write(&bytes, &content_hash).map_err(|error| error.to_string())?;

    // **② + ③ 记引用**。
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let mut repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository
        .record_attachment(&staged.content_hash, staged.byte_size as i64, &media_type)
        .map_err(|error| error.to_string())?;
    repository
        .reference_attachments(&project_id, &document_id, generation, std::slice::from_ref(&staged.content_hash))
        .map_err(|error| error.to_string())?;

    Ok(serde_json::json!({ "contentHash": staged.content_hash, "byteSize": staged.byte_size }))
}

/// **读一份附件**（base64）。找不到时回 `null` —— 与"出错了"分开。
#[tauri::command]
pub fn read_attachment(app: tauri::AppHandle, content_hash: String) -> Result<Option<String>, String> {
    let blobs = app.try_state::<BlobState>().ok_or("the attachment store is not initialised")?;
    let bytes = blobs.blobs.read(&content_hash).map_err(|error| error.to_string())?;
    Ok(bytes.map(|bytes| encode_base64(&bytes)))
}

/**
 * **回收孤儿附件**（两阶段的清理那一半）。
 *
 * 判据只有一个：**数据库里没有被任何快照引用**。宽限期由 `blobs::GC_GRACE_MS` 定，
 * 因为正常操作里"文件已写、引用还没写"的窗口是存在的（毫秒级），
 * 而一次并发的 GC 落在那个窗口里就会删掉一份**正在被引用**的附件。
 */
#[tauri::command]
pub fn collect_attachments(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let referenced = {
        let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
        let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
        repository.referenced_blobs().map_err(|error| error.to_string())?
    };
    let blobs = app.try_state::<BlobState>().ok_or("the attachment store is not initialised")?;
    blobs.blobs.collect_garbage(&referenced, repository::blobs::GC_GRACE_MS).map_err(|error| error.to_string())
}

/// **导出 `.mcanvas`**，写到给定的路径。
///
/// 文档由调用方给（`documentId` / `epoch` / `content`），附件按哈希列出。
/// **导出是只读的**：它不改仓库里的任何东西 —— 于是"导出失败"永远不会损坏文档。
#[tauri::command]
pub fn export_package(app: tauri::AppHandle, project_id: String, documents: Vec<serde_json::Value>, attachments: Vec<String>, destination: String) -> Result<serde_json::Value, String> {
    let exported: Vec<repository::package::ExportDocument> = documents
        .iter()
        .map(|document| {
            Ok(repository::package::ExportDocument {
                document_id: document["documentId"].as_str().ok_or("a document needs a documentId")?.to_string(),
                epoch: document["epoch"].as_str().unwrap_or_default().to_string(),
                generation: document["generation"].as_i64().unwrap_or(0),
                content: document["content"].as_str().ok_or("a document needs its content")?.to_string()
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let media: Vec<(String, String)> = attachments.iter().map(|hash| (hash.clone(), "application/octet-stream".to_string())).collect();

    let blobs = app.try_state::<BlobState>().ok_or("the attachment store is not initialised")?;
    let (bytes, report) = repository::package::export(&project_id, &exported, &media, &[], &blobs.blobs, repository::provider_profiles::timestamp_ms(), None)
        .map_err(|error| error.to_string())?;
    repository::package::write_to_file(&destination, &bytes).map_err(|error| error.to_string())?;

    Ok(serde_json::json!({
        "destination": destination,
        "byteSize": bytes.len(),
        "documentCount": report.document_count,
        "attachmentCount": report.attachment_count
    }))
}

/**
 * **导入 `.mcanvas`**。
 *
 * ## 顺序：先把整包验完，再落下任何东西
 *
 * `package::import` 自己保证"验到一半失败**不会**留下半份写进仓库的文档"，
 * 而**落库那一半也必须是一个事务**（外部审查 D3）：逐份写会在一份坏文档上留下
 * "前 N−1 份已经进库"的部分导入，那与上面那句契约直接矛盾。
 * 现在整次导入走 `ProjectRepository::import_documents` 一个事务。
 *
 * "换一世"用的是 epoch 替换 —— 于是**在途的旧保存会自动 CAS 失败**
 *（用户刚打开的文档不会被上一次编辑覆盖）。
 *
 * ## 附件也要一并登记（外部审查 D1）
 *
 * 原先这条路径只写文档、**从不登记附件引用**，于是紧接着的孤儿回收（60 秒宽限）
 * 会把**刚导入的字节删掉**：导入显示成功、附件却没了。归属只能取保守的过近似
 *（包里的附件是项目级平铺列表，不记属于哪份文档），细节见 `import_documents`。
 */
#[tauri::command]
pub fn import_package(app: tauri::AppHandle, path: String, project_id: String, epoch: String) -> Result<serde_json::Value, String> {
    let bytes = repository::package::read_from_file(&path).map_err(|error| error.to_string())?;
    let blobs = app.try_state::<BlobState>().ok_or("the attachment store is not initialised")?;
    let outcome = repository::package::import(&bytes, &blobs.blobs).map_err(|error| error.to_string())?;

    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let mut repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;

    let documents: Vec<repository::projects::ImportDocument> = outcome
        .documents
        .iter()
        .map(|(document_id, content)| repository::projects::ImportDocument { document_id: document_id.clone(), content: content.clone() })
        .collect();
    // `manifest.attachments` 里的每一份都已经在上一步验过哈希并**落盘成功**
    //（`package::import` 先全验后全写），所以这里直接按清单登记即可。
    let attachments: Vec<repository::projects::ImportAttachment> = outcome
        .manifest
        .attachments
        .iter()
        .map(|attachment| repository::projects::ImportAttachment { content_hash: attachment.content_hash.clone(), byte_size: attachment.byte_size as i64, media_type: attachment.media_type.clone() })
        .collect();

    let written = repository
        .import_documents(&project_id, &epoch, &documents, &attachments)
        .map_err(|error| error.to_string())?;

    Ok(serde_json::json!({
        "projectId": outcome.manifest.project_id,
        "schemaVersion": outcome.manifest.schema_version,
        "documents": written.iter().map(|document| document.document_id.clone()).collect::<Vec<String>>(),
        "attachmentCount": outcome.stored_attachments.len(),
        "missingSources": outcome.missing_sources
    }))
}

/// **这一版快照引用了哪些附件**（列举那一半）。
///
/// 引用记在**快照**上而不是 head 上（撤销回旧版本时那一版的图必须还在），所以这里要
/// `generation`：问的是"这一版引用了什么"，而不是"这份文档一共有什么"。
/// 没有这条命令时，界面只能列出**本次会话里附加过的那几个** —— 重开应用就数不出来了。
#[tauri::command]
pub fn read_document_attachments(app: tauri::AppHandle, project_id: String, document_id: String, generation: i64) -> Result<Vec<String>, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.attachments_of(&project_id, &document_id, generation).map_err(|error| error.to_string())
}

// ---------------------------------------------------------------- 运行账本（Task 2.6）

/// **追加一条运行事件**。
///
/// 收**原始 JSON** 再自己转换，而不是让 Tauri 直接反序列化成 `RunEventInput`：
/// 后者在遇到未知字段时的行为取决于类型定义，而这里要的是**明确的拒绝** ——
/// `RunEventInput` 带 `deny_unknown_fields`，所以一个带着 `reasoning` 或 `imageBytes`
/// 的事件会在**入口**被拒（计划 Task 2.6："never stores raw model reasoning or image bytes"）。
/// 静默削掉那个字段比拒绝更危险：调用方会以为它存进去了。
///
/// 返回"这次真的写了一行吗"：同一个 `event_id` 第二次返回 `false`（幂等，重放不是错误）。
#[tauri::command]
pub fn append_run_event(app: tauri::AppHandle, event: serde_json::Value) -> Result<bool, String> {
    let parsed: repository::run_events::RunEventInput = serde_json::from_value(event).map_err(|error| format!("the run event was refused: {error}"))?;
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.append_run_event(&parsed).map_err(|error| error.to_string())
}

/// **读一条运行的事件**（有界、按写入顺序，供界面的开发者详细视图）。
#[tauri::command]
pub fn read_run_events(app: tauri::AppHandle, run_id: String) -> Result<Vec<repository::run_events::RunEventRecord>, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.run_events(&run_id).map_err(|error| error.to_string())
}

/// 账本里一共多少条（自述与诊断用）。
#[tauri::command]
pub fn run_event_count(app: tauri::AppHandle) -> Result<i64, String> {
    let state = app.try_state::<RepositoryState>().ok_or("the project repository is not initialised")?;
    let repository = state.repository.lock().map_err(|_| "the project repository is poisoned".to_string())?;
    repository.run_event_count().map_err(|error| error.to_string())
}

/// 把 base64 解成字节。**不用 crate**：这里只有解码与编码两个方向，而它们的形状是固定的。
fn decode_base64(text: &str) -> Option<Vec<u8>> {
    const TABLE: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for byte in text.bytes() {
        if byte == b'\n' || byte == b'\r' || byte == b'=' {
            continue;
        }
        let value = TABLE.find(byte as char)? as u32;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Some(out)
}

/// 把字节编成 base64。
fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let mut buffer = 0u32;
        for (index, byte) in chunk.iter().enumerate() {
            buffer |= u32::from(*byte) << (16 - index * 8);
        }
        for slot in 0..4 {
            if slot <= chunk.len() {
                out.push(TABLE[((buffer >> (18 - slot * 6)) & 0x3f) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}
