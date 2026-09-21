//! **运行账本**（Task 2.6 Step 1/2/5）。
//!
//! 这个文件钉住四件事，每一件都对应计划里的一句原文：
//!
//! 1. **只追加、按 `event_id` 幂等**（"append-only and idempotent by event ID"）——
//!    重放同一条事件不会让账本多出一行，而且**重放不是错误**。
//! 2. **绝不存模型推理与图像字节**（"never stores raw model reasoning or image bytes"）——
//!    靠结构 + 入口拒绝成立，而**测试要证明的是"拒绝"，不是"没存"**：
//!    前者是调用方能看见的行为，后者只是一次运气。
//! 3. **脱敏在落盘之前**——默认拒绝式：任何像密钥的长串一律抹掉。
//! 4. **真文件里没有禁物**（Step 5："inspect a real run database for prohibited fields"）——
//!    这是这一组里最要紧的一条：它不是查内存里的对象，而是**把库文件当字节读一遍**。
//!    也正因为如此它必须同时扫 `-wal`：WAL 模式下新写入的行**可能还没进主库文件**，
//!    只扫主库会得到一个"干净"的假结论。

use mathcanvas_desktop_lib::repository::projects::ProjectRepository;
use mathcanvas_desktop_lib::repository::run_events::{RunEventInput, RunEventUsage, RunEventVersions, MAX_DETAIL};

struct TempDir(std::path::PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let mut path = std::env::temp_dir();
        path.push(format!("mathcanvas-events-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("create the temp directory");
        Self(path)
    }

    fn db(&self, name: &str) -> std::path::PathBuf {
        self.0.join(name)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn event(event_id: &str, detail: &str) -> RunEventInput {
    RunEventInput {
        event_id: event_id.to_string(),
        run_id: "run-1".to_string(),
        conversation_id: "conv-1".to_string(),
        phase: "planning".to_string(),
        status: "ok".to_string(),
        detail: detail.to_string(),
        at: 1_700_000_000_000,
        prompt_message_id: Some("msg-1".to_string()),
        request_id: Some("req-1".to_string()),
        attempt_id: Some("att-1".to_string()),
        draft_version: Some(1),
        versions: Some(RunEventVersions { capability_revision: "2026-09-19.1".to_string(), policy_revision: "local".to_string() }),
        usage: Some(RunEventUsage { input_tokens: Some(120), output_tokens: Some(40) })
    }
}

#[test]
fn the_same_event_written_twice_leaves_one_row() {
    let dir = TempDir::new("idempotent");
    let repository = ProjectRepository::open(dir.db("project.db")).expect("open");

    assert!(repository.append_run_event(&event("e1", "context ready")).expect("append"), "the first write must report a row");
    // 重放不是错误：网络重试、界面重复提交、应用重启后的补写都会走到这里。
    assert!(!repository.append_run_event(&event("e1", "context ready")).expect("append"), "a replay must not add a row");

    assert_eq!(repository.run_event_count().expect("count"), 1);
    let stored = repository.run_events("run-1").expect("read");
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].event_id, "e1");
}

#[test]
fn an_event_carrying_a_reasoning_field_is_refused_rather_than_trimmed() {
    // 这一条是"拒绝"与"静默削掉"的分界。静默削掉会让调用方以为推理存进去了 ——
    // 而计划逐字要求它**不进库**。所以入口必须是**响亮的拒绝**。
    let with_reasoning = serde_json::json!({
        "eventId": "e1", "runId": "run-1", "conversationId": "conv-1",
        "phase": "planning", "status": "ok", "detail": "ok", "at": 1,
        "reasoning": "the model thought about it for a while"
    });
    let refused = serde_json::from_value::<RunEventInput>(with_reasoning);
    assert!(refused.is_err(), "an unknown field must be refused, not trimmed");

    // 图片字节同理（同一个机制，但值得单独提一句：这是计划点名的另一样东西）。
    let with_image_bytes = serde_json::json!({
        "eventId": "e1", "runId": "run-1", "conversationId": "conv-1",
        "phase": "planning", "status": "ok", "detail": "ok", "at": 1,
        "imageBytes": "iVBORw0KGgo="
    });
    assert!(serde_json::from_value::<RunEventInput>(with_image_bytes).is_err(), "image bytes must be refused too");
}

#[test]
fn a_secret_in_the_detail_is_redacted_before_it_touches_the_disk() {
    let dir = TempDir::new("redaction");
    let repository = ProjectRepository::open(dir.db("project.db")).expect("open");

    let secret = "sk-live-9f3ab8c7d6e5f4a3b2c1d0e9f8a7b6c5";
    repository
        .append_run_event(&event("e1", &format!("transport failed: Authorization: Bearer {secret} (retryable)")))
        .expect("append");

    let stored = repository.run_events("run-1").expect("read");
    let detail = stored[0].payload["detail"].as_str().expect("the detail must be a string");
    assert!(!detail.contains(secret), "the secret must not survive in the ledger: {detail}");
    assert!(detail.contains("[redacted]"), "and it must be visibly redacted, not silently dropped: {detail}");
    // 与安全无关的部分原样保留 —— 脱敏过度会让账本没用。
    assert!(detail.contains("transport failed"), "the useful part must stay: {detail}");
    assert!(detail.contains("retryable"), "the useful part must stay: {detail}");
}

#[test]
fn a_long_key_shaped_run_is_redacted_even_without_a_known_prefix() {
    // 默认拒绝式：认前缀必然会漏（每家 provider 的前缀都不一样，而泄漏只需要漏一次）。
    let dir = TempDir::new("unknown-prefix");
    let repository = ProjectRepository::open(dir.db("project.db")).expect("open");
    let opaque = "9f3ab8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7";
    assert!(opaque.len() > 32);

    repository.append_run_event(&event("e1", &format!("token {opaque} was used"))).expect("append");

    let stored = repository.run_events("run-1").expect("read");
    let detail = stored[0].payload["detail"].as_str().expect("detail");
    assert!(!detail.contains(opaque), "an unrecognised but key-shaped run must be redacted too: {detail}");
}

#[test]
fn the_detail_is_truncated_so_the_ledger_stays_readable() {
    let dir = TempDir::new("truncation");
    let repository = ProjectRepository::open(dir.db("project.db")).expect("open");

    repository.append_run_event(&event("e1", &"细".repeat(2000))).expect("append");

    let stored = repository.run_events("run-1").expect("read");
    let detail = stored[0].payload["detail"].as_str().expect("detail");
    // 按**字符**截断（按字节切会切在半个 UTF-8 字符中间）。
    assert_eq!(detail.chars().count(), MAX_DETAIL);
}

#[test]
fn events_come_back_in_the_order_they_were_written() {
    let dir = TempDir::new("order");
    let repository = ProjectRepository::open(dir.db("project.db")).expect("open");

    // 同一毫秒里写入：顺序只能靠插入顺序（`rowid`）定，否则每次读出来都可能不一样。
    for index in 0..8 {
        repository.append_run_event(&event(&format!("e{index}"), &format!("step {index}"))).expect("append");
    }
    // 另一条运行的事件不该混进来。
    let mut other = event("other-1", "another run");
    other.run_id = "run-2".to_string();
    repository.append_run_event(&other).expect("append");

    let stored = repository.run_events("run-1").expect("read");
    let ids: Vec<&str> = stored.iter().map(|record| record.event_id.as_str()).collect();
    assert_eq!(ids, vec!["e0", "e1", "e2", "e3", "e4", "e5", "e6", "e7"]);
    assert_eq!(repository.run_events("run-2").expect("read").len(), 1);
}

#[test]
fn the_database_file_itself_contains_no_prohibited_marker() {
    // 计划 Task 2.6 Step 5 原文："inspect a real run database for prohibited fields"。
    // 这一条**不是**查内存里的对象，而是把库文件当字节读一遍 —— 前者只能证明"我以为我写了什么"。
    let dir = TempDir::new("real-file");
    let path = dir.db("project.db");
    let repository = ProjectRepository::open(&path).expect("open");

    let secret = "sk-live-9f3ab8c7d6e5f4a3b2c1d0e9f8a7b6c5";
    repository.append_run_event(&event("e1", &format!("Authorization: Bearer {secret}"))).expect("append");
    repository.append_run_event(&event("e2", "context ready: 3 fact(s), 9 tool(s)")).expect("append");
    drop(repository);

    // **同时扫 `-wal`**：WAL 模式下新行可能还没进主库文件，只扫主库会得到一个
    // "干净"的假结论 —— 那正是这一条最容易骗过自己的地方。
    let mut scanned = 0;
    for suffix in ["", "-wal"] {
        let candidate = std::path::PathBuf::from(format!("{}{suffix}", path.display()));
        let Ok(bytes) = std::fs::read(&candidate) else { continue };
        scanned += 1;
        let text = String::from_utf8_lossy(&bytes);
        assert!(!text.contains(secret), "the credential must not be in {}", candidate.display());
        assert!(!text.contains("reasoning"), "no reasoning may be stored in {}", candidate.display());
        assert!(!text.contains("imageBytes"), "no image bytes may be stored in {}", candidate.display());
    }
    assert!(scanned >= 1, "at least the main database file must have been read");
}
