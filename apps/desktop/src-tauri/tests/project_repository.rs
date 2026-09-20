//! **项目仓储的测试**（Task 1.6 Step 1/2）。
//!
//! 计划点名的场景：迁移（空库 / 迁移 / 重开 / 再迁移 / **注入失败迁移**）、
//! CAS（stale generation / **changed epoch** / 同内容 ABA）、幂等（**同一请求两次** /
//! **同一把键配不同候选哈希** / **DB 已提交但响应丢了**）。
//!
//! 这里用**真的临时库文件**而不是内存库：WAL、崩溃恢复、以及"重开之后还在"
//! 这三条性质只有碰真文件才测得出来。

use mathcanvas_desktop_lib::repository::migrations::{latest_version, migrate, migrate_with, Migration};
use mathcanvas_desktop_lib::repository::projects::{CommitOutcome, CommitRequest, ProjectRepository, RepositoryError};
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

