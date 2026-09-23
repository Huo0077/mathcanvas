//! **项目仓储的测试**（Task 1.6 Step 1/2）。
//!
//! 计划点名的场景：迁移（空库 / 迁移 / 重开 / 再迁移 / **注入失败迁移**）、
//! CAS（stale generation / **changed epoch** / 同内容 ABA）、幂等（**同一请求两次** /
//! **同一把键配不同候选哈希** / **DB 已提交但响应丢了**）。
//!
//! 这里用**真的临时库文件**而不是内存库：WAL、崩溃恢复、以及"重开之后还在"
//! 这三条性质只有碰真文件才测得出来。

use mathcanvas_desktop_lib::repository::migrations::{latest_version, migrate, migrate_with, Migration};
use mathcanvas_desktop_lib::repository::projects::{CommitOutcome, CommitRequest, ImportDocument, ProjectRepository, RepositoryError};
use rusqlite::Connection;

struct TempDir(std::path::PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let mut path = std::env::temp_dir();
        path.push(format!("mathcanvas-repo-{label}-{}", std::process::id()));
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

fn request(key: &str, expected_generation: i64, content: &str) -> CommitRequest {
    CommitRequest {
        idempotency_key: key.to_string(),
        project_id: "p1".to_string(),
        document_id: "d1".to_string(),
        expected_epoch: "epoch-1".to_string(),
        expected_generation,
        expected_content_hash: format!("hash-{expected_generation}"),
        content: content.to_string(),
        content_hash: format!("hash-{}", expected_generation + 1),
        actions: 2
    }
}

fn seeded(label: &str) -> (TempDir, ProjectRepository) {
    let dir = TempDir::new(label);
    let mut repository = ProjectRepository::open(dir.db("project.db")).expect("open");
    repository.create("p1", "d1", "epoch-1", "{\"v\":1}", "hash-1").expect("create");
    (dir, repository)
}

// ---------------------------------------------------------------- 最新一份 head（外部审查 X1）

/// **"本地没记住 id"与"库里一份都没有"必须能被分开**（外部审查 X1）。
///
/// 前者是记忆丢了（localStorage 被清、换机器），仓储里的文档还在；
/// 只有后者才是真正的首次启动。少了这个区分，恢复路径一探测落空就只能当用户是新来的，
/// 于是每次启动插一行新的空文档，而那份真正的内容永远读不回来。
#[test]
fn read_latest_head_reports_none_when_the_project_has_no_documents() {
    let dir = TempDir::new("latest-empty");
    let repository = ProjectRepository::open(dir.db("project.db")).expect("open");

    assert!(repository.read_latest_head("p1").expect("read").is_none());
}

#[test]
fn read_latest_head_finds_the_document_the_local_memory_forgot() {
    let dir = TempDir::new("latest-found");
    let mut repository = ProjectRepository::open(dir.db("project.db")).expect("open");
    repository.create("p1", "d1", "epoch-1", "{\"v\":1}", "hash-1").expect("create");

    let latest = repository.read_latest_head("p1").expect("read").expect("a document");

    // 内容是**整份**读回来的（与 `read_head` 同一个形状），上层才能直接用它恢复画布。
    assert_eq!(latest.document_id, "d1");
    assert_eq!(latest.content, "{\"v\":1}");
    assert_eq!(latest.generation, 1);
    assert_eq!(latest.epoch, "epoch-1");
}

#[test]
fn read_latest_head_does_not_leak_across_projects() {
    let dir = TempDir::new("latest-projects");
    let mut repository = ProjectRepository::open(dir.db("project.db")).expect("open");
    repository.create("other", "d9", "epoch-9", "{\"v\":9}", "hash-9").expect("create");

    // 别的项目里有文档，**不等于**这个项目里有。
    assert!(repository.read_latest_head("p1").expect("read").is_none());
    assert_eq!(repository.read_latest_head("other").expect("read").expect("a document").document_id, "d9");
}

#[test]
fn read_latest_head_prefers_the_most_recently_updated_document() {
    let dir = TempDir::new("latest-recent");
    let mut repository = ProjectRepository::open(dir.db("project.db")).expect("open");
    repository.create("p1", "d1", "epoch-1", "{\"v\":1}", "hash-1").expect("create");
    repository.create("p1", "d2", "epoch-2", "{\"v\":2}", "hash-2").expect("create");

    // 两次 `create` 可能落在同一毫秒，所以这里不断言"一定是哪一份"，只断言它**确定地**
    // 返回其中一份（毫秒并列时由次级键 `document_id ASC` 定序，不随 SQLite 返回顺序漂移）。
    let first = repository.read_latest_head("p1").expect("read").expect("a document");
    assert!(["d1", "d2"].contains(&first.document_id.as_str()));

    // 提交会推进 `updated_at`（`UPDATE documents SET … updated_at = ?4`），
    // 于是 d1 明确成为"最近更新的那一份"。
    let outcome = repository.commit(request("k1", 1, "{\"v\":1b}")).expect("commit");
    assert_eq!(generation_of(&outcome.outcome), 2);
    assert_eq!(repository.read_latest_head("p1").expect("read").expect("a document").document_id, "d1");
}

/**
 * **建文档失败不等于"已经存在"**（外部审查 M5）。
 *
 * 原先 `create` 把**任何** `rusqlite::Error` 都报成 `StaleHead { "document X already exists" }`。
 * 磁盘满、库被锁、权限不足于是都以"已经存在"的面目到达界面，而 TS 侧又把任何含 "generation"
 * 的文本归成 `stale_head`（那是"重新读一遍再保存"）—— 用户被指去照做一个**根本做不了**的动作。
 *
 * 这里用"另一个连接握着写锁"制造一个**非约束**的失败：它必须走 `Io`，而不是 `StaleHead`。
 * （只有主键冲突才是"已存在"，那条路径由 `refuses_a_duplicate_document` 一类既有用例钉着。）
 */
#[test]
fn a_locked_database_is_reported_as_io_not_as_already_exists() {
    let dir = TempDir::new("create-locked");
    let db = dir.db("project.db");
    let mut repository = ProjectRepository::open(&db).expect("open");

    // 第二个连接拿到写锁并一直不放：再 `create` 必然得到 SQLITE_BUSY（非约束类失败）。
    let blocker = Connection::open(&db).expect("open a second connection");
    blocker.execute_batch("BEGIN IMMEDIATE").expect("take the write lock");

    let outcome = repository.create("p1", "d1", "epoch-1", "{\"v\":1}", "hash-1");

    match outcome {
        Err(RepositoryError::Io { detail }) => assert!(detail.contains("cannot create document"), "unexpected io detail: {detail}"),
        other => panic!("a locked database must be reported as io, not as a stale head; got {other:?}")
    }

    blocker.execute_batch("ROLLBACK").ok();
}

// ---------------------------------------------------------------- 导入：一个事务（外部审查 D3）
/// **整次导入要么全成、要么全不成**（外部审查 D3）。
///
/// 原先 `import_package` 在循环里逐份调 `replace_epoch` / `create`，而那两个方法
/// **各自开一个事务** —— 一份坏文档就会留下"前 N−1 份已经进库"的**部分导入**，
/// 与 `package::import` 自己的契约直接矛盾，而且那种状态最难收拾：
/// 用户看到一半的文档，没人知道剩下那一半该不该补。
///
/// 这里在**真实 schema** 上造一个真实的失败（不写桩）：直接占掉 `d1` 的下一代快照，
/// 于是导入写到 `d1` 时那条 INSERT 会撞 `snapshots` 的主键。
#[test]
fn an_import_writes_every_document_or_none_of_them() {
    let dir = TempDir::new("import-atomic");
    let db = dir.db("project.db");
    let mut repository = ProjectRepository::open(&db).expect("open");
    repository.create("p1", "d1", "epoch-1", "{\"v\":1}", "hash-1").expect("create d1");

    {
        // 第二个连接直接占掉 (p1, d1, generation 2) —— 导入一定会推进到那一代。
        let connection = Connection::open(&db).expect("open a second connection");
        connection
            .execute(
                "INSERT INTO snapshots (project_id, document_id, generation, content_hash, content, created_at) VALUES ('p1', 'd1', 2, 'occupied', '{}', 0)",
                []
            )
            .expect("occupy the next generation");
    }

    // **d2 排在 d1 前面**：它会在失败之前被写进事务 —— 只有这样才验得到"一起回滚"。
    let outcome = repository.import_documents(
        "p1",
        "epoch-import",
        &[
            ImportDocument { document_id: "d2".to_string(), content: "{\"v\":2}".to_string() },
            ImportDocument { document_id: "d1".to_string(), content: "{\"v\":1b}".to_string() }
        ],
        &[]
    );

    assert!(outcome.is_err(), "the import must fail on the occupied generation, got {outcome:?}");
    // 关键：**先写的那一份也必须一起回滚**，否则就是"部分导入"。
    let d2 = repository.read_head("p1", "d2");
    assert!(
        matches!(d2, Err(RepositoryError::NotFound { .. })),
        "a document written before the failure must be rolled back with it, got {d2:?}"
    );
    // 而原有的那一份没有被推进到新的一世。
    assert_eq!(repository.read_head("p1", "d1").expect("d1").epoch, "epoch-1");
    assert_eq!(repository.read_head("p1", "d1").expect("d1").generation, 1);
}

/// 导入成功时：**每一份都写进去，并把新代数如实回答出来**（附件引用要按它记）。
#[test]
fn an_import_reports_the_generation_each_document_landed_on() {
    let dir = TempDir::new("import-generations");
    let mut repository = ProjectRepository::open(dir.db("project.db")).expect("open");
    repository.create("p1", "d1", "epoch-1", "{\"v\":1}", "hash-1").expect("create d1");

    let written = repository
        .import_documents(
            "p1",
            "epoch-import",
            &[
                // 已存在 → 换一世 ⇒ 代数推进到 2。
                ImportDocument { document_id: "d1".to_string(), content: "{\"v\":1b}".to_string() },
                // 不存在 → 建出来 ⇒ 代数从 1 开始。
                ImportDocument { document_id: "d2".to_string(), content: "{\"v\":2}".to_string() }
            ],
            &[]
        )
        .expect("import");

    assert_eq!(
        written,
        vec![
            mathcanvas_desktop_lib::repository::projects::ImportedDocument { document_id: "d1".to_string(), generation: 2 },
            mathcanvas_desktop_lib::repository::projects::ImportedDocument { document_id: "d2".to_string(), generation: 1 }
        ]
    );
    // epoch 换掉了：在途的旧提交会 CAS 失败（"用户刚打开的文档不会被上一次编辑覆盖"）。
    assert_eq!(repository.read_head("p1", "d1").expect("d1").epoch, "epoch-import");
    assert_eq!(repository.read_head("p1", "d2").expect("d2").epoch, "epoch-import");
}

// ---------------------------------------------------------------- 迁移

#[test]
fn migrates_an_empty_database_and_records_the_version() {
    let dir = TempDir::new("migrate");
    let mut connection = Connection::open(dir.db("fresh.db")).expect("open");
    assert_eq!(connection.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0)).expect("version"), 0);

    let applied = migrate(&mut connection).expect("migrate");

    assert_eq!(applied, (1..=latest_version()).collect::<Vec<_>>());
    assert_eq!(connection.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0)).expect("version"), latest_version());
}

#[test]
fn migrating_again_is_a_no_op() {
    let dir = TempDir::new("migrate-again");
    let mut connection = Connection::open(dir.db("a.db")).expect("open");
    migrate(&mut connection).expect("first");

    let second = migrate(&mut connection).expect("second");

    // 已经是最新版：**一步都不跑**（而不是"再建一次表"）。
    assert!(second.is_empty());
}

#[test]
fn a_failed_migration_is_reported_and_leaves_the_database_usable() {
    // 计划 Step 1："inject a failed migration; assert the old DB remains usable"。
    //
    // 注入手法：在**真迁移之后**追加一条明确会失败的迁移（拼错的 SQL）。
    // 为什么不用"伪造一个同名表去撞"：那测到的是 SQLite 的建表语义（`IF NOT EXISTS`
    // 会**静默跳过**），不是**我们的迁移器**在失败时的行为 —— 第一版就是这么写的，
    // 结果那条"注入失败"的迁移**根本没失败**，用例在断言处才崩。
    let dir = TempDir::new("migrate-fail");
    let path = dir.db("b.db");
    let mut connection = Connection::open(&path).expect("open");
    // 先正常迁到最新版。
    migrate(&mut connection).expect("the real migrations must succeed");
    let version_before: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0)).expect("version");

    // 再注入一条坏迁移：SQL 是错的，所以**整步必须回滚**。
    let broken = [Migration { version: version_before + 1, name: "injected-failure", sql: "CREATE TABLE oops (this is not sql);" }];
    let error = migrate_with(&mut connection, &broken).expect_err("the broken migration must fail loudly");

    // ①**如实报错**（带上出错的那一步）。
    assert!(error.to_string().contains("injected-failure"), "the error must name the step that failed: {error}");
    // ②**版本号没有被推进** —— 这正是"每一步各自一个事务"的可见证据。
    let version_after: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0)).expect("version");
    assert_eq!(version_after, version_before, "a failed step must not advance the schema version");
    // ③**旧库仍然可用**：表照常能写、能查（"停在旧版本上继续可用"）。
    connection
        .execute("INSERT INTO documents (project_id, document_id, epoch, generation, content_hash, content, updated_at) VALUES ('p','d','e',1,'h','{}',0)", [])
        .expect("the old database must remain writable");
    let count: i64 = connection.query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0)).expect("count");
    assert_eq!(count, 1);
}

#[test]
fn refuses_a_database_from_a_newer_schema_instead_of_resetting_it() {
    let dir = TempDir::new("migrate-newer");
    let path = dir.db("newer.db");
    {
        let connection = Connection::open(&path).expect("open");
        connection.pragma_update(None, "user_version", 99).expect("set version");
    }

    let error = migrate(&mut Connection::open(&path).expect("reopen")).expect_err("must refuse");

    assert!(matches!(error, RepositoryError::Io { .. }));
    assert!(error.to_string().contains("99"), "the error must name the version it cannot read: {error}");
}

#[test]
fn the_head_survives_a_restart() {
    let dir = TempDir::new("restart");
    {
        let mut repository = ProjectRepository::open(dir.db("c.db")).expect("open");
        repository.create("p1", "d1", "epoch-1", "{\"v\":1}", "hash-1").expect("create");
    }

    let reopened = ProjectRepository::open(dir.db("c.db")).expect("reopen");
    let head = reopened.read_head("p1", "d1").expect("read");

    assert_eq!(head.generation, 1);
    assert_eq!(head.content, "{\"v\":1}");
    assert_eq!(head.epoch, "epoch-1");
}

// ---------------------------------------------------------------- CAS

#[test]
fn commits_advance_the_generation_and_write_history() {
    let (_dir, mut repository) = seeded("commit");

    let receipt = repository.commit(request("k1", 1, "{\"v\":2}")).expect("commit");

    assert_eq!(receipt.outcome, CommitOutcome::Committed { generation: 2, content_hash: "hash-2".to_string() });
    assert_eq!(repository.read_head("p1", "d1").expect("head").generation, 2);
    // 历史包含 head 与上一版。
    assert_eq!(repository.history_length("p1", "d1").expect("history"), 2);
    assert_eq!(repository.read_snapshot("p1", "d1", 1).expect("v1").content, "{\"v\":1}");
}

#[test]
fn refuses_a_commit_built_on_a_stale_generation() {
    let (_dir, mut repository) = seeded("stale-generation");
    repository.commit(request("k1", 1, "{\"v\":2}")).expect("first");

    let stale = repository.commit(request("k2", 1, "{\"v\":3}"));

    assert!(matches!(stale, Err(RepositoryError::StaleHead { .. })));
    // 第一个写入者的改动必须活着。
    assert_eq!(repository.read_head("p1", "d1").expect("head").content, "{\"v\":2}");
}

#[test]
fn refuses_a_commit_built_on_a_stale_epoch_even_when_the_generation_matches() {
    // 换过文档之后，在途的请求不该还能写进来。
    let (_dir, mut repository) = seeded("stale-epoch");
    repository.replace_epoch("p1", "d1", "epoch-2", "{\"v\":9}", "hash-9").expect("replace");

    let mut stale = request("k1", 2, "{\"v\":10}");
    // 生成号对得上（replace_epoch 也推进了），但 epoch 是旧的。
    stale.expected_epoch = "epoch-1".to_string();
    stale.expected_content_hash = "hash-9".to_string();

    let outcome = repository.commit(stale);

    assert!(matches!(outcome, Err(RepositoryError::StaleHead { .. })));
    assert_eq!(repository.read_head("p1", "d1").expect("head").content, "{\"v\":9}");
}

#[test]
fn refuses_a_commit_whose_expected_hash_does_not_match_the_stored_content() {
    // 同一版号、不同内容：**这正是"只判 generation 会漏掉"的那一类**。
    let (_dir, mut repository) = seeded("stale-hash");
    let mut wrong = request("k1", 1, "{\"v\":2}");
    wrong.expected_content_hash = "hash-something-else".to_string();

    let outcome = repository.commit(wrong);

    assert!(matches!(outcome, Err(RepositoryError::StaleHead { .. })));
}

#[test]
fn a_commit_that_changes_nothing_does_not_advance_the_generation() {
    let (_dir, mut repository) = seeded("unchanged");
    // 候选内容与 head 完全一样：不推进生成号（否则撤销栈里会多一个空步）。
    let mut noop = request("k1", 1, "{\"v\":1}");
    noop.content_hash = "hash-1".to_string();

    let receipt = repository.commit(noop).expect("commit");

    assert_eq!(receipt.outcome, CommitOutcome::Unchanged { generation: 1 });
    assert_eq!(repository.read_head("p1", "d1").expect("head").generation, 1);
    assert_eq!(repository.history_length("p1", "d1").expect("history"), 1, "no new snapshot for a no-op");
}

// ---------------------------------------------------------------- 幂等

#[test]
fn the_same_request_twice_returns_the_same_receipt_instead_of_writing_twice() {
    let (_dir, mut repository) = seeded("idempotent");
    let first = repository.commit(request("k1", 1, "{\"v\":2}")).expect("first");

    // 第二次是**同一份请求**（同键、同期望、同候选）—— 也就是"网络重试"的真实形状。
    //
    // 它必须拿到**与第一次相同的回执**，而不是 `StaleHead`。理由：第一次提交把 head
    // 推进到了 generation 2，重试携带的期望仍是 generation 1 —— 如果幂等检查排在 CAS 之后，
    // 真正的重试就永远拿不到它本该拿到的那张回执。**那条路径正是幂等键存在的理由。**
    //
    // （第一版就是这个顺序，被这条用例抓出来了。安全性没变松：只有内容哈希逐字相同
    // 才走重放，不同候选一律 `IdempotencyConflict`，见下一条用例。）
    let second = repository.commit(request("k1", 1, "{\"v\":2}")).expect("the retry must get the same receipt");

    // 两次的**结果**必须一致（同一版、同一内容哈希），但 `outcome` 的**类型**不同是有意的：
    // 第一次是 `Committed`（真的写进去了），第二次是 `Replayed`（**没有**再写，回放当时的回执）。
    //
    // 界面按这两种类型说不同的话："已保存" vs "这件事之前已经做过了"。
    // 把它们合并成一种，会让"重试"在界面上看起来像"又保存了一次"。
    assert_eq!(generation_of(&first.outcome), generation_of(&second.outcome));
    assert!(matches!(first.outcome, CommitOutcome::Committed { generation: 2, .. }));
    assert!(matches!(second.outcome, CommitOutcome::Replayed { generation: 2, .. }));
    assert_eq!(first.committed_at, second.committed_at, "a replay returns the original receipt, not a new one");
    // 而且**确实只写了一次**：head 与历史都没被第二次影响。
    assert_eq!(repository.read_head("p1", "d1").expect("head").generation, 2);
    assert_eq!(repository.history_length("p1", "d1").expect("history"), 2);
}

fn generation_of(outcome: &CommitOutcome) -> i64 {
    match outcome {
        CommitOutcome::Committed { generation, .. } => *generation,
        CommitOutcome::Unchanged { generation } => *generation,
        CommitOutcome::Replayed { generation, .. } => *generation
    }
}

#[test]
fn refuses_the_same_idempotency_key_carrying_a_different_candidate() {
    // 静默按幂等处理会让第二次改动**悄无声息地丢掉** —— 而调用方以为它成功了。
    let (_dir, mut repository) = seeded("idempotency-conflict");
    repository.commit(request("k1", 1, "{\"v\":2}")).expect("first");

    let conflicting = repository.commit(request("k1", 2, "{\"v\":3}"));

    assert!(matches!(conflicting, Err(RepositoryError::IdempotencyConflict { .. })));
    assert_eq!(repository.read_head("p1", "d1").expect("head").content, "{\"v\":2}");
}

#[test]
fn a_lost_response_can_be_recovered_by_looking_up_the_key() {
    // 计划 Step 2 的 "crash between DB commit and UI response"：
    // 客户端重试前先查这里，查到就说明上次其实成功了。
    let (_dir, mut repository) = seeded("lookup");
    repository.commit(request("k1", 1, "{\"v\":2}")).expect("commit");

    let found = repository.lookup_commit("k1").expect("lookup");

    assert!(found.is_some());
    assert_eq!(found.expect("receipt").outcome, CommitOutcome::Replayed { generation: 2, content_hash: "hash-2".to_string() });
    assert!(repository.lookup_commit("never-used").expect("lookup").is_none());
}

// ---------------------------------------------------------------- 其它

#[test]
fn reports_a_missing_document_instead_of_returning_an_empty_one() {
    let (_dir, repository) = seeded("missing");

    let outcome = repository.read_head("p1", "nope");

    assert!(matches!(outcome, Err(RepositoryError::NotFound { .. })));
}

#[test]
fn creating_the_same_document_twice_is_refused() {
    let (_dir, mut repository) = seeded("create-twice");

    let again = repository.create("p1", "d1", "epoch-1", "{}", "hash");

    assert!(matches!(again, Err(RepositoryError::StaleHead { .. })));
}

#[test]
fn replacing_the_epoch_keeps_the_history() {
    // 导入 / 切换项目之后，**旧历史仍然要能读**（撤销要能一路退回去）。
    let (_dir, mut repository) = seeded("epoch-history");
    repository.commit(request("k1", 1, "{\"v\":2}")).expect("commit");

    repository.replace_epoch("p1", "d1", "epoch-2", "{\"v\":9}", "hash-9").expect("replace");

    assert_eq!(repository.read_head("p1", "d1").expect("head").epoch, "epoch-2");
    // 换 epoch 也是一次写入，所以它自己占一版。
    assert_eq!(repository.history_length("p1", "d1").expect("history"), 3);
    assert_eq!(repository.read_snapshot("p1", "d1", 1).expect("v1").content, "{\"v\":1}");
}

// ---------------------------------------------------------------- 附件引用（Task 1.6 Step 4）

#[test]
fn an_attachment_is_only_orphaned_once_no_snapshot_references_it() {
    // 这就是 GC 的**唯一**判据。它必须落在快照上而不是 head 上：撤销回上一版之后
    // 附件立刻变成孤儿的话，那一版里显示的图会在下次 GC 时消失。
    let (_dir, mut repository) = seeded("attach-refs");
    repository.record_attachment("hash-a", 12, "image/png").expect("record");
    repository.reference_attachments("p1", "d1", 1, &["hash-a".to_string()]).expect("reference");

    assert!(repository.referenced_blobs().expect("referenced").contains("hash-a"));
    assert_eq!(repository.attachments_of("p1", "d1", 1).expect("attachments"), vec!["hash-a".to_string()]);

    // 同一份内容被多版引用：幂等，引用集合不变。
    repository.reference_attachments("p1", "d1", 1, &["hash-a".to_string()]).expect("reference again");
    repository.reference_attachments("p1", "d1", 2, &["hash-a".to_string()]).expect("reference on v2");
    assert_eq!(repository.referenced_blobs().expect("referenced").len(), 1);

    // 删掉这份文档的引用 → 它才是孤儿。
    repository.drop_references("p1", "d1").expect("drop");
    assert!(repository.referenced_blobs().expect("referenced").is_empty());
}

#[test]
fn recording_an_attachment_does_not_by_itself_make_it_referenced() {
    // "记下这份内容的元数据"与"某一版引用了它"是两件事。混起来的话，
    // 一次被放弃的写入会让那份附件永远删不掉。
    let (_dir, mut repository) = seeded("attach-meta-only");

    repository.record_attachment("hash-a", 12, "image/png").expect("record");

    assert!(repository.referenced_blobs().expect("referenced").is_empty());
    assert_eq!(repository.attachments_of("p1", "d1", 1).expect("attachments"), Vec::<String>::new());
}

#[test]
fn a_blob_referenced_by_an_older_snapshot_survives_a_newer_one_dropping_it() {
    // 撤销会回到旧版本，而那一版里的图必须还在。
    let (_dir, mut repository) = seeded("attach-old-version");
    repository.record_attachment("hash-a", 3, "image/png").expect("record");
    repository.reference_attachments("p1", "d1", 1, &["hash-a".to_string()]).expect("v1");
    repository.reference_attachments("p1", "d1", 2, &[]).expect("v2 has no attachments");

    assert!(repository.referenced_blobs().expect("referenced").contains("hash-a"), "the older snapshot still references it");
}

