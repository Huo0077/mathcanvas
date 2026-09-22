//! **多会话持久化的测试**（Task 1 Step 1/5）。
//!
//! 计划 Task 1 点名的四件事，逐条对应这里的用例：
//!
//! 1. **schema 版本 3**：三张表与两个索引**真的**建出来了，而且 `user_version` 推到 3；
//! 2. **外键归属**：消息与事实属于它们的那条会话 —— 挂在不存在的会话上要被**拦住**，
//!    会话被删掉时它们要**一起走**（留下的孤儿行是"删了还在"的来源）；
//! 3. **每条会话内序号唯一**：`UNIQUE(conversation_id, sequence)` 是"消息顺序"这条事实的
//!    物理保证 —— 没有它，两条消息可以同时声称自己是第 1 条；
//! 4. **旧库能重开**：一个真的 schema 2 的库（不是伪造版本号）迁到 3 之后，
//!    用户原来那份文档**还在**，而新的三张表可以用。
//!
//! 这个文件用**真的临时库文件**而不是内存库：外键、级联、以及"重开之后还在"
//! 这三条性质只有碰真文件才测得出来（与 `project_repository.rs` 同一个理由）。

use mathcanvas_desktop_lib::repository::conversations::{
    self, ConversationBinding, ConversationFactInput, ConversationMessageInput, FactStatus, NewConversation,
    Workspace, MAX_CONVERSATIONS, MAX_FACTS, MAX_MESSAGES, MAX_MESSAGE_CHARS, MAX_SUMMARY_CHARS
};
use mathcanvas_desktop_lib::repository::migrations::{latest_version, migrate, migrate_with, MIGRATIONS};
use mathcanvas_desktop_lib::repository::projects::{ProjectRepository, RepositoryError};
use rusqlite::Connection;
use serde_json::json;

struct TempDir(std::path::PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let mut path = std::env::temp_dir();
        path.push(format!("mathcanvas-conv-{label}-{}", std::process::id()));
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

/// 一个迁到最新版的空库。**外键打开**：`ProjectRepository::open` 就是这么配的，
/// 而"归属"这条性质离开了它根本不存在（SQLite 默认**不**执行外键）。
fn fresh(label: &str) -> (TempDir, Connection) {
    let dir = TempDir::new(label);
    let mut connection = Connection::open(dir.db("conversations.db")).expect("open");
    connection.execute_batch("PRAGMA foreign_keys = ON;").expect("foreign keys");
    migrate(&mut connection).expect("migrate");
    (dir, connection)
}

fn names_of(connection: &Connection, kind: &str) -> Vec<String> {
    let mut statement = connection
        .prepare("SELECT name FROM sqlite_master WHERE type = ?1 ORDER BY name")
        .expect("prepare");
    let rows = statement.query_map((kind,), |row| row.get::<_, String>(0)).expect("query");
    rows.map(|row| row.expect("row")).collect()
}

fn count_of(connection: &Connection, table: &str) -> i64 {
    connection.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0)).expect("count")
}

fn insert_conversation(connection: &Connection, id: &str) {
    connection
        .execute(
            "INSERT INTO conversations (id, project_id, document_id, workspace, title, created_at, updated_at) VALUES (?1, 'p1', 'd1', 'geometry3d', '任意三角形', 1, 1)",
            (id,)
        )
        .expect("insert the conversation");
}

fn insert_message(connection: &Connection, id: &str, conversation_id: &str, sequence: i64) -> rusqlite::Result<usize> {
    connection.execute(
        "INSERT INTO conversation_messages (id, conversation_id, sequence, role, kind, content_json, token_estimate, created_at) VALUES (?1, ?2, ?3, 'user', 'text', '{\"text\":\"画一个正方体\"}', 12, 1)",
        (id, conversation_id, sequence)
    )
}

fn insert_fact(connection: &Connection, id: &str, conversation_id: &str, key: &str) -> rusqlite::Result<usize> {
    connection.execute(
        "INSERT INTO conversation_facts (id, conversation_id, key, value_json, source_message_id, status, created_at, updated_at) VALUES (?1, ?2, ?3, '3', 'm1', 'confirmed', 1, 1)",
        (id, conversation_id, key)
    )
}

// ---------------------------------------------------------------- 1. schema 版本 3

#[test]
fn the_schema_version_is_three_and_carries_the_conversation_tables_and_indexes() {
    let (_dir, connection) = fresh("schema");

    assert_eq!(latest_version(), 3, "the build must understand schema 3");
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0)).expect("version");
    assert_eq!(version, 3);

    let tables = names_of(&connection, "table");
    for table in ["conversations", "conversation_messages", "conversation_facts"] {
        assert!(tables.contains(&table.to_string()), "the schema must carry {table}: {tables:?}");
    }

    // 索引不是装饰：`list` 按绑定过滤、按更新时间排序；`read_messages` 按会话取尾巴。
    let indexes = names_of(&connection, "index");
    for index in ["conversations_binding_idx", "conversation_messages_run_idx"] {
        assert!(indexes.contains(&index.to_string()), "the schema must carry {index}: {indexes:?}");
    }
}

// ---------------------------------------------------------------- 2. 外键归属

#[test]
fn messages_and_facts_belong_to_their_conversation_by_foreign_key() {
    let (_dir, connection) = fresh("fk-ownership");

    // 没有这条会话时写消息：**外键必须拦住**。放过去的话，这条消息永远读不回来
    // （`read_messages` 按 conversation_id 取），而那是一次**静默的丢失**。
    let orphan_message = insert_message(&connection, "m-orphan", "nobody", 1);
    assert!(orphan_message.is_err(), "a message must not hang off a conversation that does not exist");
    let orphan_fact = insert_fact(&connection, "f-orphan", "nobody", "k");
    assert!(orphan_fact.is_err(), "a fact must not hang off a conversation that does not exist");

    insert_conversation(&connection, "c1");
    insert_message(&connection, "m1", "c1", 1).expect("message");
    insert_fact(&connection, "f1", "c1", "k1").expect("fact");
    assert_eq!(count_of(&connection, "conversation_messages"), 1);
    assert_eq!(count_of(&connection, "conversation_facts"), 1);

    // 删掉会话：消息与事实**一起走**（级联）。留下孤儿行的话，删掉的会话会以
    // "一具还有消息的尸体"的形式留在库里，而 `list` 又看不见它。
    connection.execute("DELETE FROM conversations WHERE id = 'c1'", []).expect("delete the conversation");
    assert_eq!(count_of(&connection, "conversation_messages"), 0, "messages must cascade with their conversation");
    assert_eq!(count_of(&connection, "conversation_facts"), 0, "facts must cascade with their conversation");
}

// ---------------------------------------------------------------- 3. 序号唯一

#[test]
fn a_conversation_cannot_hold_two_messages_with_the_same_sequence() {
    let (_dir, connection) = fresh("sequence");
    insert_conversation(&connection, "c1");
    insert_conversation(&connection, "c2");
    insert_message(&connection, "m1", "c1", 1).expect("the first message");

    let duplicate = insert_message(&connection, "m2", "c1", 1);
    assert!(duplicate.is_err(), "two messages must not claim the same position in one conversation");

    // 唯一性是**每条会话各自**的：另一条会话的第 1 条是它自己的第 1 条。
    insert_message(&connection, "m3", "c2", 1).expect("another conversation has its own sequence 1");
    // 同一会话里的下一条只要序号不同就没问题。
    insert_message(&connection, "m4", "c1", 2).expect("the next message");

    assert_eq!(count_of(&connection, "conversation_messages"), 3);
}

// ---------------------------------------------------------------- 4. 旧库重开

#[test]
fn an_older_database_migrates_to_the_third_version_without_losing_its_documents() {
    let dir = TempDir::new("older-database");
    let path = dir.db("v2.db");

    // 先造一个**真的** schema 2 的库：只跑前两步迁移，而不是伪造一个版本号
    // （伪造版本号测到的是 SQLite 的 `user_version`，不是我们的迁移器）。
    {
        let mut connection = Connection::open(&path).expect("open");
        let applied = migrate_with(&mut connection, &MIGRATIONS[..2]).expect("migrate to version 2");
        assert_eq!(applied, vec![1, 2]);
        connection
            .execute(
                "INSERT INTO documents (project_id, document_id, epoch, generation, content_hash, content, updated_at) VALUES ('p1', 'd1', 'epoch-1', 1, 'hash-1', '{\"v\":1}', 1)",
                []
            )
            .expect("write a document into the older database");
    }

    let mut connection = Connection::open(&path).expect("reopen");
    let applied = migrate(&mut connection).expect("migrate to the latest");

    assert_eq!(applied, vec![3], "only the third step is left to run");
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0)).expect("version");
    assert_eq!(version, 3);

    // 用户原来那份文档**还在**（迁移不许丢东西）。
    let content: String = connection
        .query_row("SELECT content FROM documents WHERE project_id = 'p1' AND document_id = 'd1'", [], |row| row.get(0))
        .expect("the older document must survive the migration");
    assert_eq!(content, "{\"v\":1}");

    // 而且新的三张表**现在就能用**（迁移之后不是"有表但写不进去"）。
    connection.execute_batch("PRAGMA foreign_keys = ON;").expect("foreign keys");
    insert_conversation(&connection, "c1");
    insert_message(&connection, "m1", "c1", 1).expect("the new tables must be usable after the migration");
}

// ---------------------------------------------------------------- 仓库：夹具

fn binding(document_id: &str) -> ConversationBinding {
    ConversationBinding { project_id: "p1".to_string(), document_id: document_id.to_string(), workspace: Workspace::Geometry3d }
}

fn new_conversation(id: &str) -> NewConversation {
    NewConversation {
        id: id.to_string(),
        project_id: "p1".to_string(),
        document_id: "d1".to_string(),
        workspace: Workspace::Geometry3d,
        title: "任意三角形".to_string()
    }
}

fn message(id: &str, conversation_id: &str) -> ConversationMessageInput {
    ConversationMessageInput {
        id: id.to_string(),
        conversation_id: conversation_id.to_string(),
        role: "user".to_string(),
        kind: "text".to_string(),
        content_json: json!({ "text": "画一个正方体" }),
        run_id: Some("run-1".to_string()),
        document_generation: Some(1),
        token_estimate: 12,
        created_at: 1_700_000_000_000
    }
}

fn fact(id: &str, conversation_id: &str, key: &str, source_message_id: &str) -> ConversationFactInput {
    ConversationFactInput {
        id: id.to_string(),
        conversation_id: conversation_id.to_string(),
        key: key.to_string(),
        value_json: json!({ "radius": 3 }),
        source_message_id: source_message_id.to_string(),
        status: FactStatus::Confirmed,
        created_at: 1_700_000_000_000
    }
}

fn ids_of(records: &[conversations::ConversationRecord]) -> Vec<&str> {
    records.iter().map(|record| record.id.as_str()).collect()
}

/// 用**显式时间戳**写一条会话。排序用例不能靠 `now_ms()`：那会让断言依赖
/// "这两次调用不在同一毫秒里"，而这是一条偶尔翻脸的断言。
fn insert_conversation_at(connection: &Connection, id: &str, updated_at: i64) {
    connection
        .execute(
            "INSERT INTO conversations (id, project_id, document_id, workspace, title, created_at, updated_at) VALUES (?1, 'p1', 'd1', 'geometry3d', 't', ?2, ?2)",
            (id, updated_at)
        )
        .expect("insert the conversation");
}

/// 一个**会话 + 一条消息**的会话（事实必须引用同一会话里的消息）。
fn seeded_conversation(label: &str) -> (TempDir, Connection) {
    let (dir, mut connection) = fresh(label);
    conversations::create(&mut connection, &new_conversation("c1")).expect("create");
    conversations::append_message(&mut connection, &message("m1", "c1")).expect("append");
    (dir, connection)
}

// ---------------------------------------------------------------- 仓库：会话

#[test]
fn a_conversation_survives_a_restart_and_comes_back_through_list() {
    let dir = TempDir::new("restart");
    {
        let mut repository = ProjectRepository::open(dir.db("conversations.db")).expect("open");
        repository.create_conversation(&new_conversation("c1")).expect("create");
        repository.append_conversation_message(&message("m1", "c1")).expect("append");
    }

    let repository = ProjectRepository::open(dir.db("conversations.db")).expect("reopen");
    let listed = repository.list_conversations(&binding("d1")).expect("list");

    assert_eq!(listed.len(), 1, "a conversation must survive closing the application");
    assert_eq!(listed[0].id, "c1");
    assert_eq!(listed[0].workspace, Workspace::Geometry3d);
    assert_eq!(listed[0].summary, "", "a fresh conversation has no summary");
    assert_eq!(listed[0].summary_version, 1);
    assert_eq!(listed[0].archived_at, None);

    let detail = repository.read_conversation("c1").expect("read");
    assert_eq!(detail.messages.len(), 1);
    assert_eq!(detail.messages[0].sequence, 1);
    assert_eq!(detail.messages[0].content_json["text"], "画一个正方体");
    assert!(detail.facts.is_empty());
}

#[test]
fn list_is_scoped_to_the_binding_and_hides_archived_conversations() {
    let (_dir, mut connection) = fresh("list-scope");
    conversations::create(&mut connection, &new_conversation("c1")).expect("create");
    let mut elsewhere = new_conversation("c2");
    elsewhere.document_id = "d2".to_string();
    conversations::create(&mut connection, &elsewhere).expect("create");

    // 绑定（项目 + 文档 + 工作区）是**过滤器**：另一份文档的会话不会串进来。
    assert_eq!(ids_of(&conversations::list(&connection, &binding("d1")).expect("list")), vec!["c1"]);
    assert_eq!(ids_of(&conversations::list(&connection, &binding("d2")).expect("list")), vec!["c2"]);

    // 归档：**从列表里消失，但记录还在**（按 id 仍然读得到）—— 归档不是删除。
    conversations::archive(&mut connection, "c1").expect("archive");
    assert!(conversations::list(&connection, &binding("d1")).expect("list").is_empty());
    assert!(conversations::read_conversation(&connection, "c1").expect("read").conversation.archived_at.is_some());
    assert!(matches!(conversations::archive(&mut connection, "nobody"), Err(RepositoryError::NotFound { .. })));
}

#[test]
fn list_is_ordered_by_the_most_recent_change_and_is_bounded() {
    let (_dir, connection) = fresh("list-order");
    for (id, updated_at) in [("older", 10), ("newest", 30), ("middle", 20)] {
        insert_conversation_at(&connection, id, updated_at);
    }

    assert_eq!(ids_of(&conversations::list(&connection, &binding("d1")).expect("list")), vec!["newest", "middle", "older"]);

    // 同一时间戳的两条按 id 升序：顺序是**确定的**，不是"看 SQLite 的心情"。
    insert_conversation_at(&connection, "b-tie", 30);
    insert_conversation_at(&connection, "a-tie", 30);
    assert_eq!(ids_of(&conversations::list(&connection, &binding("d1")).expect("list")), vec!["a-tie", "b-tie", "newest", "middle", "older"]);

    // 有界：超过上限时只回上限那么多条，而且留下的是**最近的**那些。
    for index in 0..(MAX_CONVERSATIONS + 10) {
        insert_conversation_at(&connection, &format!("bulk-{index:04}"), 1000 + index as i64);
    }
    let bounded = conversations::list(&connection, &binding("d1")).expect("list");
    assert_eq!(bounded.len(), MAX_CONVERSATIONS, "an unbounded list grows into a list nobody can read");
    assert_eq!(bounded[0].id, format!("bulk-{:04}", MAX_CONVERSATIONS + 9), "the newest survives the cap");
}

#[test]
fn creating_the_same_conversation_twice_is_refused() {
    let (_dir, mut connection) = fresh("create-twice");

    conversations::create(&mut connection, &new_conversation("c1")).expect("first");

    let again = conversations::create(&mut connection, &new_conversation("c1"));
    assert!(matches!(&again, Err(RepositoryError::Conflict { .. })), "a duplicate id must be refused, not silently overwritten: {again:?}");
}

#[test]
fn an_empty_id_or_binding_is_refused_before_it_reaches_the_database() {
    // 空 id / 空项目名是"这个绑定不存在"的另一种写法。放进去的话，会话会挂在一个
    // 谁都查不到的绑定上 —— 而那与丢掉它没有区别。
    let (_dir, mut connection) = fresh("binding-validation");

    for bad in [
        NewConversation { id: String::new(), ..new_conversation("c1") },
        NewConversation { project_id: "   ".to_string(), ..new_conversation("c1") },
        NewConversation { document_id: String::new(), ..new_conversation("c1") },
        NewConversation { title: "  ".to_string(), ..new_conversation("c1") }
    ] {
        let refused = conversations::create(&mut connection, &bad);
        assert!(matches!(&refused, Err(RepositoryError::Invalid { .. })), "an empty binding field must be refused: {refused:?}");
    }
    assert!(conversations::list(&connection, &ConversationBinding { project_id: String::new(), ..binding("d1") }).is_err());
    assert!(conversations::list(&connection, &ConversationBinding { document_id: "  ".to_string(), ..binding("d1") }).is_err());
    assert_eq!(count_of(&connection, "conversations"), 0, "nothing may be written by a refused binding");
}

#[test]
fn an_unknown_workspace_is_refused_at_the_boundary() {
    for workspace in ["conics", "geometry3d", "cad"] {
        assert_eq!(Workspace::parse(workspace).expect("a real workspace").as_str(), workspace);
    }
    // `calculus` 是**退役**的工作区（`apps/web` 的 draftStorage 也拒绝把它带回来）。
    assert!(Workspace::parse("calculus").is_none(), "the retired workspace must not come back");

    // 命令入口就是边界：Tauri 反序列化时把非法值拒掉（而不是存一个字符串进库）。
    let mut payload = serde_json::to_value(new_conversation("c1")).expect("serialize");
    payload["workspace"] = json!("calculus");
    assert!(serde_json::from_value::<NewConversation>(payload).is_err(), "an unknown workspace must be refused at the boundary");
}

// ---------------------------------------------------------------- 仓库：消息

#[test]
fn appending_the_same_message_id_twice_leaves_one_row() {
    let (_dir, mut connection) = seeded_conversation("append-idempotent");

    // 重放**不是错误**（网络重试、界面重复提交、重启后的补写都会走到这里），
    // 而且它**不占序号** —— 否则每次重试都会在会话里留下一个空位。
    assert!(!conversations::append_message(&mut connection, &message("m1", "c1")).expect("replay"));
    assert!(conversations::append_message(&mut connection, &message("m2", "c1")).expect("append"));

    let stored = conversations::read_messages(&connection, "c1").expect("read");
    assert_eq!(stored.len(), 2);
    assert_eq!(stored.iter().map(|record| record.sequence).collect::<Vec<_>>(), vec![1, 2]);
    assert_eq!(stored.iter().map(|record| record.id.as_str()).collect::<Vec<_>>(), vec!["m1", "m2"]);
}

#[test]
fn read_messages_keeps_the_newest_when_the_conversation_is_longer_than_the_cap() {
    let (_dir, mut connection) = fresh("messages-bounded");
    conversations::create(&mut connection, &new_conversation("c1")).expect("create");
    for index in 0..(MAX_MESSAGES + 3) {
        conversations::append_message(&mut connection, &message(&format!("m{index}"), "c1")).expect("append");
    }

    let stored = conversations::read_messages(&connection, "c1").expect("read");

    assert_eq!(stored.len(), MAX_MESSAGES);
    // 砍掉的必须是最旧的一头：砍掉最新的会让 Agent 看不到用户**刚说**的那句话。
    assert_eq!(stored[0].sequence, 4);
    assert_eq!(stored[stored.len() - 1].sequence, MAX_MESSAGES as i64 + 3);
    assert!(stored.windows(2).all(|pair| pair[0].sequence < pair[1].sequence), "the order must be ascending (and stable)");
}

#[test]
fn a_message_cannot_be_appended_to_a_conversation_that_does_not_exist() {
    let (_dir, mut connection) = fresh("append-missing");

    let outcome = conversations::append_message(&mut connection, &message("m1", "nobody"));

    assert!(matches!(outcome, Err(RepositoryError::NotFound { .. })), "a message must belong to a real conversation");
}

#[test]
fn the_message_boundary_refuses_an_unknown_field_instead_of_trimming_it() {
    // 计划的不变量：不持久化 hidden chain-of-thought、候选文档全文与图像字节。
    // 这条靠**结构**成立 —— `ConversationMessageInput` 里没有放它们的位置，
    // 而 `deny_unknown_fields` 把"顺手多塞一个字段"变成一次**响亮的拒绝**。
    // 静默削掉那个字段比拒绝更危险：调用方会以为它存进去了。
    let cases = [
        ("reasoning", json!("the model thought about it for a while")),
        ("candidateDocument", json!({ "primitives": [] })),
        ("imageBytes", json!("iVBORw0KGgo="))
    ];
    for (field, value) in cases {
        let mut payload = serde_json::to_value(message("m1", "c1")).expect("serialize");
        payload[field] = value;
        let refused = serde_json::from_value::<ConversationMessageInput>(payload);
        assert!(refused.is_err(), "{field} must be refused, not trimmed");
    }
}

#[test]
fn a_message_carrying_a_credential_prefix_is_refused_while_a_content_hash_is_not() {
    let (_dir, mut connection) = seeded_conversation("credentials");

    let mut secret = message("m2", "c1");
    secret.content_json = json!({ "text": "用 sk-live-9f3ab8c7d6e5f4a3b2c1d0e9f8a7b6c5 这个 key 试一下" });
    let refused = conversations::append_message(&mut connection, &secret);
    assert!(matches!(&refused, Err(RepositoryError::Invalid { .. })), "a provider key must not reach the transcript: {refused:?}");
    assert_eq!(conversations::read_messages(&connection, "c1").expect("read").len(), 1, "the refused message must not be stored");

    // **反过来这一条同样重要**：64 位十六进制的内容哈希是正常对话内容的一部分
    // （提交回执里就带着它）。账本那套"任何 32 字符以上的长串一律抹掉"的默认拒绝式
    // 规则**不能**用在对话内容上 —— 误抹用户看得见的文字是数据损坏。
    let mut receipt = message("m3", "c1");
    receipt.content_json = json!({
        "text": "已提交。",
        "contentHash": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    });
    assert!(conversations::append_message(&mut connection, &receipt).expect("a content hash is not a credential"));

    /**
     * **普通连字符词不是凭据**（Fix round 2 / N1）。
     *
     * 判据只看**令牌段的开头**，所以 `task-1` / `risk-free` 这类词里虽然含有 `sk-`，
     * 它只是一段普通的文本。前端那份 localStorage 兜底一度按"任意位置匹配"把它们拒了 ——
     * 这条用例把后端的答案钉住，两边就不会再各说各话。
     */
    for text in ["task-1", "risk-free", "disk-space", "desk-job", "risk_free"] {
        let mut benign = message(&format!("benign-{text}"), "c1");
        benign.content_json = json!({ "text": text });
        let appended = conversations::append_message(&mut connection, &benign);
        assert!(appended.is_ok(), "{text} is an ordinary hyphenated word, not a credential: {appended:?}");
    }
}

#[test]
fn an_oversized_message_is_refused_before_it_is_stored() {
    let (_dir, mut connection) = seeded_conversation("message-size");

    let mut huge = message("m2", "c1");
    huge.content_json = json!({ "text": "细".repeat(MAX_MESSAGE_CHARS) });
    let refused = conversations::append_message(&mut connection, &huge);

    assert!(matches!(&refused, Err(RepositoryError::Invalid { .. })), "a message over the cap must be refused: {refused:?}");
    assert_eq!(conversations::read_messages(&connection, "c1").expect("read").len(), 1, "nothing oversized may be stored");
}

// ---------------------------------------------------------------- 仓库：摘要

#[test]
fn the_summary_carries_a_version_so_a_stale_compaction_cannot_overwrite_a_newer_one() {
    let (_dir, mut connection) = seeded_conversation("summary");

    let first = conversations::update_summary(&mut connection, "c1", "目标是画一个正方体", None).expect("summary");
    assert_eq!(first.summary_version, 2, "the first update moves the version from 1 to 2");
    assert_eq!(first.summary, "目标是画一个正方体");

    // 条件更新：带**当前**版本号成立；带旧版本号被拒 —— 那是"按旧摘要压出来的新摘要"
    // 正要盖掉别人刚写的那一份，而两份都自称是最新的。
    let second = conversations::update_summary(&mut connection, "c1", "目标是画一个正四棱柱", Some(2)).expect("summary");
    assert_eq!(second.summary_version, 3);
    let stale = conversations::update_summary(&mut connection, "c1", "另一份摘要", Some(2));
    assert!(matches!(&stale, Err(RepositoryError::Conflict { .. })), "a summary built on an older version must be refused: {stale:?}");

    let stored = conversations::read_conversation(&connection, "c1").expect("read");
    assert_eq!(stored.conversation.summary, "目标是画一个正四棱柱");
    assert_eq!(stored.conversation.summary_version, 3);

    // 未知会话：如实报找不到（而不是"摘要写进了一条不存在的会话"）。
    assert!(matches!(conversations::update_summary(&mut connection, "nobody", "x", None), Err(RepositoryError::NotFound { .. })));
}

#[test]
fn an_oversized_summary_is_refused() {
    let (_dir, mut connection) = seeded_conversation("summary-size");

    let refused = conversations::update_summary(&mut connection, "c1", &"细".repeat(MAX_SUMMARY_CHARS + 1), None);

    assert!(matches!(&refused, Err(RepositoryError::Invalid { .. })), "a summary over the cap must be refused: {refused:?}");
    assert_eq!(conversations::read_conversation(&connection, "c1").expect("read").conversation.summary, "");
}

// ---------------------------------------------------------------- 仓库：事实

#[test]
fn a_fact_must_cite_a_message_of_its_own_conversation() {
    let (_dir, mut connection) = fresh("fact-grounding");
    conversations::create(&mut connection, &new_conversation("c1")).expect("create c1");
    conversations::create(&mut connection, &new_conversation("c2")).expect("create c2");
    conversations::append_message(&mut connection, &message("m1", "c1")).expect("append");
    conversations::append_message(&mut connection, &message("m2", "c2")).expect("append");

    // 引用**另一条会话**的消息：拒绝。这就是"会话之间不串事实"的落点。
    let cross = conversations::upsert_fact(&mut connection, &fact("f1", "c1", "radius", "m2"));
    assert!(matches!(&cross, Err(RepositoryError::NotFound { .. })), "a fact must not be evidenced by another conversation: {cross:?}");

    // 引用**不存在**的消息：拒绝 —— 没有证据的事实不许进 `confirmed`。
    let ungrounded = conversations::upsert_fact(&mut connection, &fact("f2", "c1", "radius", "nope"));
    assert!(matches!(ungrounded, Err(RepositoryError::NotFound { .. })));

    conversations::upsert_fact(&mut connection, &fact("f3", "c1", "radius", "m1")).expect("a grounded fact");
    assert_eq!(conversations::read_facts(&connection, "c1").expect("read").len(), 1);
}

#[test]
fn upserting_a_fact_by_key_updates_it_in_place() {
    let (_dir, mut connection) = seeded_conversation("fact-upsert");
    conversations::append_message(&mut connection, &message("m2", "c1")).expect("append");

    let first = conversations::upsert_fact(&mut connection, &fact("f1", "c1", "radius", "m1")).expect("first");
    assert_eq!(first.id, "f1");
    assert_eq!(first.status, FactStatus::Confirmed);
    assert_eq!(first.value_json["radius"], 3);

    // 同一个 key 再写一次：**更新那一行**，不是插第二条（`UNIQUE(conversation_id, key)`）。
    let mut update = fact("f-ignored", "c1", "radius", "m2");
    update.value_json = json!({ "radius": 6 });
    let second = conversations::upsert_fact(&mut connection, &update).expect("update");

    assert_eq!(second.id, "f1", "the key is the identity: the id of the first write wins");
    assert_eq!(second.value_json["radius"], 6);
    assert_eq!(second.source_message_id, "m2", "the evidence moves with the value");
    assert_eq!(second.created_at, first.created_at, "the first write keeps its timestamp");
    assert!(second.updated_at >= second.created_at);
    assert_eq!(conversations::read_facts(&connection, "c1").expect("read").len(), 1);
}

#[test]
fn a_fact_status_must_be_one_of_the_three() {
    // 设计 5.2：`conversation_facts.status` 为 `confirmed/stale/retracted`。
    // 解析器与命令入口的 serde 反序列化是同一条判据。
    for status in ["confirmed", "stale", "retracted"] {
        assert!(FactStatus::parse(status).is_some(), "{status} must be a status");
    }
    assert!(FactStatus::parse("maybe").is_none());
    assert!(FactStatus::parse("Confirmed").is_none(), "the wire values are lowercase");

    let mut payload = serde_json::to_value(fact("f1", "c1", "radius", "m1")).expect("serialize");
    payload["status"] = json!("maybe");
    assert!(serde_json::from_value::<ConversationFactInput>(payload).is_err(), "an unknown status must be refused at the boundary");

    // 而 `stale` / `retracted` 是**合法**的：事实会被标旧、被撤回。
    let mut retracted = serde_json::to_value(fact("f1", "c1", "radius", "m1")).expect("serialize");
    retracted["status"] = json!("retracted");
    assert_eq!(serde_json::from_value::<ConversationFactInput>(retracted).expect("retracted").status, FactStatus::Retracted);
}

#[test]
fn facts_are_bounded_and_ordered_by_the_most_recent_evidence() {
    let (_dir, connection) = fresh("facts-bounded");
    insert_conversation(&connection, "c1");
    insert_message(&connection, "m1", "c1", 1).expect("message");
    for index in 0..(MAX_FACTS + 3) {
        connection
            .execute(
                "INSERT INTO conversation_facts (id, conversation_id, key, value_json, source_message_id, status, created_at, updated_at) VALUES (?1, 'c1', ?2, '3', 'm1', 'confirmed', ?3, ?3)",
                (format!("f{index}"), format!("k{index:04}"), 1000 + index as i64)
            )
            .expect("insert the fact");
    }

    let facts = conversations::read_facts(&connection, "c1").expect("read");

    assert_eq!(facts.len(), MAX_FACTS);
    assert_eq!(facts[0].key, format!("k{:04}", MAX_FACTS + 2), "the newest evidence comes first");
    assert!(facts.windows(2).all(|pair| pair[0].updated_at >= pair[1].updated_at));
}

// ---------------------------------------------------------------- 仓库：归档与删除

#[test]
fn deleting_a_conversation_takes_its_messages_and_facts_with_it() {
    let (_dir, mut connection) = seeded_conversation("delete");
    conversations::upsert_fact(&mut connection, &fact("f1", "c1", "radius", "m1")).expect("fact");

    assert!(conversations::delete(&mut connection, "c1").expect("delete"));
    // 第二次删**不是错误**（按钮可能被点两次、重试可能重复到达），但它如实回 `false`。
    assert!(!conversations::delete(&mut connection, "c1").expect("delete again"));

    assert!(matches!(conversations::read_conversation(&connection, "c1"), Err(RepositoryError::NotFound { .. })));
    assert_eq!(count_of(&connection, "conversation_messages"), 0, "no orphan messages may survive the deletion");
    assert_eq!(count_of(&connection, "conversation_facts"), 0, "no orphan facts may survive the deletion");
}

#[test]
fn the_project_repository_exposes_every_conversation_operation() {
    // 前端只跟这些委托打交道（IPC 命令住在 `lib.rs`，它们调的就是这些）。
    let dir = TempDir::new("delegates");
    let mut repository = ProjectRepository::open(dir.db("conversations.db")).expect("open");

    repository.create_conversation(&new_conversation("c1")).expect("create");
    assert!(repository.append_conversation_message(&message("m1", "c1")).expect("append"));
    repository.update_conversation_summary("c1", "目标是画一个正方体", None).expect("summary");
    repository.upsert_conversation_fact(&fact("f1", "c1", "radius", "m1")).expect("fact");

    let detail = repository.read_conversation("c1").expect("read");
    assert_eq!(detail.conversation.summary, "目标是画一个正方体");
    assert_eq!(detail.messages.len(), 1);
    assert_eq!(detail.facts.len(), 1);
    assert_eq!(repository.list_conversations(&binding("d1")).expect("list").len(), 1);

    repository.archive_conversation("c1").expect("archive");
    assert!(repository.list_conversations(&binding("d1")).expect("list").is_empty());
    assert!(repository.delete_conversation("c1").expect("delete"));
    assert!(!repository.delete_conversation("c1").expect("delete again"));
}
