//! **附件两阶段写 + `.mcanvas` 打包**（Task 1.6 Step 4/5）。
//!
//! ## 这个文件盯的是"坏输入"而不是"好路径"
//!
//! 好路径（存一份附件、打一个包、解开它）是**一条**用例；剩下的全在问
//! "输入坏了会怎样"。理由：这一层要处理的是**别人的文件**（以及被改过的自己的文件），
//! 而"能打开好包"这件事一次就够，坏包的处理才是产品里真正会被撞到的部分。
//!
//! ## 三组，各自的判据不同
//!
//! 1. **SHA-256**：用标准测试向量（空串、`abc`、两段长消息）。自己实现哈希就必须
//!    自己证明它对 —— 否则后面所有"哈希对不上"的判据都建立在一个错的函数上。
//! 2. **附件**：原子写、哈希门、重复写不重写、GC 只删没引用的、**宽限期**。
//! 3. **包**：版本、路径安全、文档哈希、附件哈希、清单与条目一一对应（两个方向）、
//!    上限、以及**包里没有密钥**。

use std::collections::BTreeSet;

use mathcanvas_desktop_lib::repository::archive::{self, Entry};
use mathcanvas_desktop_lib::repository::blobs::{is_content_hash, sha256_hex, BlobStore, MAX_ATTACHMENT_BYTES};
use mathcanvas_desktop_lib::repository::projects::{ImportAttachment, ImportDocument, ProjectRepository};
use mathcanvas_desktop_lib::repository::package::{self, ExportDocument, PackageError, SourceLink, PACKAGE_SCHEMA_VERSION};

fn temp_dir(name: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("mathcanvas-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&path);
    std::fs::create_dir_all(&path).expect("create the temp directory");
    path
}

fn store(name: &str) -> BlobStore {
    BlobStore::open(temp_dir(name).join("attachments")).expect("open the blob store")
}

fn document(id: &str, content: &str) -> ExportDocument {
    ExportDocument { document_id: id.to_string(), epoch: "e1".to_string(), generation: 3, content: content.to_string() }
}

fn export_png(blobs: &BlobStore) -> (String, String) {
    // 一张 1×1 的 PNG（与能力探针用的同一张）。
    let bytes = base64_png();
    let staged = blobs.write(&bytes, &sha256_hex(&bytes)).expect("stage the png");
    (staged.content_hash, "image/png".to_string())
}

fn base64_png() -> Vec<u8> {
    const BASE64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
    let table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for byte in BASE64.bytes().filter(|byte| *byte != b'=') {
        let value = table.find(byte as char).expect("a base64 digit") as u32;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    out
}

// ---------------------------------------------------------------- SHA-256

#[test]
fn sha256_matches_the_standard_test_vectors() {
    // 自己实现哈希就必须自己证明它对 —— 否则"哈希对不上"这一整套判据都建立在沙上。
    assert_eq!(sha256_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert_eq!(
        sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
    // 跨过 64 字节的填充边界：55 / 56 / 64 / 65 字节各测一个长度（填充规则最容易在这里写错）。
    for length in [55usize, 56, 63, 64, 65, 128] {
        let bytes = vec![b'a'; length];
        assert_eq!(sha256_hex(&bytes).len(), 64, "length {length} must still hash");
    }
}

#[test]
fn hashing_a_million_a_s_matches_the_published_digest() {
    // 官方向量：一百万个 `a`。这一条覆盖"很多块"的累积路径。
    let bytes = vec![b'a'; 1_000_000];
    assert_eq!(sha256_hex(&bytes), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
}

// ---------------------------------------------------------------- 容器

#[test]
fn the_archive_round_trips_and_is_byte_identical_for_the_same_input() {
    let entries = vec![
        Entry { name: "manifest.json".to_string(), bytes: b"{}".to_vec() },
        Entry { name: "documents/a.mgeo".to_string(), bytes: "画一个圆".as_bytes().to_vec() },
        // 空条目：0 字节的内容在 CRC 与大小两处都容易写错。
        Entry { name: "attachments/empty".to_string(), bytes: Vec::new() }
    ];

    let first = archive::write(&entries).expect("write");
    let second = archive::write(&entries).expect("write again");
    // 同样的输入给同样的字节 —— 于是"同一份文档两次导出"可以被逐字节比较。
    assert_eq!(first, second, "the same entries must produce the same bytes");

    let read = archive::read(&first).expect("read");
    assert_eq!(read.len(), 3);
    assert_eq!(read["manifest.json"], b"{}");
    assert_eq!(String::from_utf8(read["documents/a.mgeo"].clone()).expect("utf8"), "画一个圆");
    assert!(read["attachments/empty"].is_empty());
}

#[test]
fn the_archive_refuses_a_name_that_points_outside_it() {
    // 四种都对应真实的攻击/事故形状，而**默认拒绝**是这里唯一可接受的策略。
    for name in ["../escape", "documents/../../escape", "/etc/passwd", "C:\\windows\\x", "documents\\a.mgeo", "", "documents/"] {
        let result = archive::write(&[Entry { name: name.to_string(), bytes: b"x".to_vec() }]);
        assert!(matches!(result, Err(archive::ArchiveError::UnsafeName { .. })), "`{name}` must be refused, got {result:?}");
    }
}

#[test]
fn the_archive_reads_a_flipped_byte_as_corruption_instead_of_returning_bad_content() {
    let bytes = archive::write(&[Entry { name: "manifest.json".to_string(), bytes: b"{\"a\":1}".to_vec() }]).expect("write");
    let mut broken = bytes.clone();
    // 改一个**内容字节**（本地头的长度是 30 + 名字，所以 30 + 13 = 43）。
    let at = 30 + "manifest.json".len() + 3;
    broken[at] ^= 0xff;

    let result = archive::read(&broken);

    assert!(matches!(result, Err(archive::ArchiveError::Corrupt { .. })), "got {result:?}");
}

#[test]
fn the_archive_refuses_something_that_is_not_a_zip_at_all() {
    assert_eq!(archive::read(b"this is not a package").unwrap_err(), archive::ArchiveError::NotAnArchive);
    assert_eq!(archive::read(b"").unwrap_err(), archive::ArchiveError::NotAnArchive);
}

#[test]
fn the_archive_refuses_a_compressed_entry_because_we_only_write_stored_ones() {
    let mut bytes = archive::write(&[Entry { name: "manifest.json".to_string(), bytes: b"{}".to_vec() }]).expect("write");
    // 中央目录里那个"压缩方式"字段改成 8（deflate）。
    let end = bytes.len() - 22;
    let directory = u32::from_le_bytes([bytes[end + 16], bytes[end + 17], bytes[end + 18], bytes[end + 19]]) as usize;
    bytes[directory + 10] = 8;

    let result = archive::read(&bytes);

    assert!(matches!(result, Err(archive::ArchiveError::Compressed { .. })), "got {result:?}");
}

// ---------------------------------------------------------------- 附件

#[test]
fn staging_an_attachment_checks_the_declared_hash_before_writing_anything() {
    let blobs = store("stage-hash");
    let bytes = b"hello attachment";

    let wrong = blobs.write(bytes, &"0".repeat(64));

    assert!(matches!(wrong, Err(mathcanvas_desktop_lib::repository::BlobError::HashMismatch { .. })), "got {wrong:?}");
    // **一字节都没落盘**：一份哈希对不上的附件存下来只会变成没人认得的垃圾。
    assert!(!blobs.root().join("blobs").join("0".repeat(64)).exists());
    assert_eq!(std::fs::read_dir(blobs.root().join("tmp")).expect("tmp").count(), 0, "a refused write must leave no temp file");
}

#[test]
fn staging_an_attachment_names_the_blob_after_its_content() {
    let blobs = store("stage-name");
    let bytes = b"hello attachment";

    let staged = blobs.write(bytes, &sha256_hex(bytes)).expect("stage");

    assert_eq!(staged.content_hash, sha256_hex(bytes));
    assert_eq!(staged.byte_size, bytes.len());
    assert!(blobs.root().join("blobs").join(&staged.content_hash).is_file());
    // 临时目录必须是干净的：临时文件的唯一目的是"别让半个文件出现在 blobs/ 里"。
    assert_eq!(std::fs::read_dir(blobs.root().join("tmp")).expect("tmp").count(), 0);
}

#[test]
fn staging_the_same_attachment_twice_leaves_one_blob() {
    let blobs = store("stage-twice");
    let bytes = b"same bytes";

    let first = blobs.write(bytes, &sha256_hex(bytes)).expect("first");
    let second = blobs.write(bytes, &sha256_hex(bytes)).expect("second");

    assert_eq!(first, second);
    assert_eq!(std::fs::read_dir(blobs.root().join("blobs")).expect("blobs").count(), 1, "the same content must not be written twice");
}

#[test]
fn an_oversized_attachment_is_refused_before_it_is_allocated() {
    let blobs = store("stage-big");
    // 不真的分配 32 MiB：用一个刚好过界的长度，判据在**写之前**就该拒。
    let bytes = vec![0u8; MAX_ATTACHMENT_BYTES + 1];

    let result = blobs.write(&bytes, &sha256_hex(&bytes));

    assert!(matches!(result, Err(mathcanvas_desktop_lib::repository::BlobError::TooLarge { .. })), "got {result:?}");
}

#[test]
fn verifying_an_attachment_notices_content_that_no_longer_matches_its_name() {
    let blobs = store("verify");
    let bytes = b"original";
    let staged = blobs.write(bytes, &sha256_hex(bytes)).expect("stage");

    assert!(blobs.verify(&staged.content_hash).expect("verify"));
    // 磁盘上的字节**会**变坏（坏扇区、被别的程序改）。名字就是哈希，所以随时可以验。
    std::fs::write(blobs.root().join("blobs").join(&staged.content_hash), b"tampered").expect("tamper");
    assert!(!blobs.verify(&staged.content_hash).expect("verify again"));
    // 而"读不到"与"读坏了"是两件事。
    assert!(blobs.read(&"f".repeat(64)).expect("read a missing blob").is_none());
}

/// **哈希是文件名，所以形状就是安全边界**（外部审查 D2）。
///
/// 原先 `blob_path` 直接把调用方给的字符串 `join` 进来：`read_attachment` 用一个
/// `..\..\…` 或绝对路径就能读到附件目录之外的**任意**文件，再以 base64 回给 WebView
/// （`verify` 走的是同一条路）。今天没有界面传文档哈希，所以它只是潜在洞 ——
/// 但一条已注册命令的安全边界不能建立在"调用方现在恰好不会那么传"之上。
#[test]
fn a_traversal_shaped_hash_cannot_read_outside_the_attachment_directory() {
    let blobs = store("traversal");
    // 附件目录的**外面**放一份"秘密"（真实布局里这里正是 projects.db / providers.json）。
    let secret = blobs.root().parent().expect("a parent").join("projects.db");
    std::fs::write(&secret, b"the database").expect("write the secret");

    // 先确认这份秘密**真的**能被这种路径走到 —— 否则下面的断言可能因为别的原因通过。
    let escaped = blobs.root().join("blobs").join("..").join("..").join("projects.db");
    assert!(escaped.is_file(), "the fixture must actually be reachable by traversal, else this test proves nothing");

    let short = "a".repeat(63);
    let long = "a".repeat(65);
    let non_hex = "z".repeat(64);
    for shaped in ["../../projects.db", r"..\..\projects.db", "..", "", short.as_str(), long.as_str(), non_hex.as_str(), "/etc/passwd"] {
        // 读：**拒**，而不是把外面的字节当成附件交出去。
        let read = blobs.read(shaped);
        assert!(
            matches!(read, Err(mathcanvas_desktop_lib::repository::BlobError::InvalidHash { .. })),
            "read({shaped:?}) must be refused, got {read:?}"
        );
        // 校验走同一条路，因此也必须拒。
        let verified = blobs.verify(shaped);
        assert!(
            matches!(verified, Err(mathcanvas_desktop_lib::repository::BlobError::InvalidHash { .. })),
            "verify({shaped:?}) must be refused, got {verified:?}"
        );
        assert!(!is_content_hash(shaped), "{shaped:?} must not count as a content hash");
    }

    // 反向守卫：形状合法的哈希照常工作（这条闸不该把正常路径一起挡掉）。
    let staged = blobs.write(b"legit", &sha256_hex(b"legit")).expect("stage");
    assert!(is_content_hash(&staged.content_hash));
    assert!(blobs.read(&staged.content_hash).expect("read the legit blob").is_some());
    assert!(blobs.verify(&staged.content_hash).expect("verify the legit blob"));
}

/// **导入的附件必须被登记引用，否则孤儿回收会把刚导入的字节删掉**（外部审查 D1）。
///
/// 原先 `import_package` 只写文档、**从不登记附件引用**，于是两件事同时坏掉：
/// ①"这一版快照引用了哪些附件"永远报空；②紧接着的孤儿回收（60 秒宽限）判据只有
/// "有没有被引用"，于是**刚导入的附件被当成孤儿删掉** —— 导入显示成功、附件却没了。
#[test]
fn an_imported_attachment_is_referenced_so_garbage_collection_cannot_delete_it() {
    let dir = temp_dir("import-attachments");
    let mut repository = ProjectRepository::open(dir.join("project.db")).expect("open");
    let blobs = BlobStore::open(dir.join("attachments")).expect("open the blob store");

    let bytes = b"a picture";
    let hash = sha256_hex(bytes);
    blobs.write(bytes, &hash).expect("store the attachment");

    repository
        .import_documents(
            "p1",
            "epoch-import",
            &[ImportDocument { document_id: "d1".to_string(), content: "{\"v\":1}".to_string() }],
            &[ImportAttachment { content_hash: hash.clone(), byte_size: bytes.len() as i64, media_type: "image/png".to_string() }]
        )
        .expect("import");

    // ① 列举必须答得出来（原先永远报空）。
    assert_eq!(repository.attachments_of("p1", "d1", 1).expect("attachments"), vec![hash.clone()]);

    // ② GC 的判据只有"有没有被引用"：刚导入的字节必须活下来。
    let known = repository.referenced_blobs().expect("referenced");
    let removed = blobs.collect_garbage(&known, 0).expect("collect");
    assert!(removed.is_empty(), "an imported attachment must not be collected, removed {removed:?}");
    assert!(blobs.read(&hash).expect("read").is_some(), "the imported bytes must still be there");
}

#[test]
fn garbage_collection_only_removes_blobs_nobody_references() {
    let blobs = store("gc");
    let kept = blobs.write(b"kept", &sha256_hex(b"kept")).expect("kept");
    let orphan = blobs.write(b"orphan", &sha256_hex(b"orphan")).expect("orphan");

    let mut referenced = BTreeSet::new();
    referenced.insert(kept.content_hash.clone());
    let removed = blobs.collect_garbage(&referenced, 0).expect("collect");

    assert_eq!(removed, vec![orphan.content_hash.clone()], "only the unreferenced blob may go");
    assert!(blobs.read(&kept.content_hash).expect("read").is_some(), "a referenced blob must survive");
    assert!(blobs.read(&orphan.content_hash).expect("read").is_none());
}

#[test]
fn garbage_collection_leaves_fresh_orphans_alone_because_they_may_be_mid_write() {
    // 正常操作里"文件已写、引用还没写"的窗口是存在的（毫秒级）。一次并发的 GC
    // 落在那个窗口里就会删掉一份**正在被引用**的附件 —— 那是用户可见的损坏。
    let blobs = store("gc-grace");
    let fresh = blobs.write(b"just written", &sha256_hex(b"just written")).expect("write");

    let removed = blobs.collect_garbage(&BTreeSet::new(), 60_000).expect("collect");

    assert!(removed.is_empty(), "a freshly written blob must be left alone: {removed:?}");
    assert!(blobs.read(&fresh.content_hash).expect("read").is_some());
}

#[test]
fn garbage_collection_clears_half_written_temporary_files_but_keeps_the_blobs() {
    let blobs = store("gc-tmp");
    let staged = blobs.write(b"real", &sha256_hex(b"real")).expect("write");
    // 模拟一次崩溃留下的半成品。
    std::fs::write(blobs.root().join("tmp").join("half.part"), b"half").expect("write a temp file");

    blobs.collect_garbage(&BTreeSet::from([staged.content_hash.clone()]), 0).expect("collect");

    assert_eq!(std::fs::read_dir(blobs.root().join("tmp")).expect("tmp").count(), 0, "a half-written temp file has no value");
    assert!(blobs.read(&staged.content_hash).expect("read").is_some());
}

// ---------------------------------------------------------------- 打包

#[test]
fn a_package_round_trips_documents_and_attachments() {
    let blobs = store("pack-round");
    let (hash, media_type) = export_png(&blobs);

    let (bytes, report) = package::export(
        "project-1",
        &[document("doc-a", "{\"kind\":\"mgeo\"}")],
        &[(hash.clone(), media_type)],
        &[],
        &blobs,
        1_700_000_000_000,
        Some(("openai".to_string(), "openai".to_string()))
    )
    .expect("export");

    assert_eq!(report.document_count, 1);
    assert_eq!(report.attachment_count, 1);
    assert_eq!(report.document_paths, vec!["documents/doc-a.mgeo"]);

    let outcome = package::import(&bytes, &blobs).expect("import");

    assert_eq!(outcome.manifest.project_id, "project-1");
    assert_eq!(outcome.manifest.schema_version, PACKAGE_SCHEMA_VERSION);
    assert_eq!(outcome.documents, vec![("doc-a".to_string(), "{\"kind\":\"mgeo\"}".to_string())]);
    assert_eq!(outcome.stored_attachments, vec![hash.clone()]);
    assert_eq!(outcome.missing_sources, Vec::<String>::new());
    // 附件真的在仓库里，而且内容没变。
    assert!(blobs.verify(&hash).expect("verify"));
}

#[test]
fn a_package_never_carries_a_secret() {
    // 一个"顺手把配置也打进去"的改动会让包变成一份凭据泄漏。
    let blobs = store("pack-secret");
    let (bytes, _) = package::export("p", &[document("d", "{}")], &[], &[], &blobs, 1, Some(("openai".to_string(), "openai".to_string()))).expect("export");

    let entries = archive::read(&bytes).expect("read");
    let manifest = String::from_utf8(entries["manifest.json"].clone()).expect("utf8");

    // 只有**引用**（条目名），没有密钥本体。
    assert!(manifest.contains("secretRef"), "the reference is useful provenance and is kept: {manifest}");
    for forbidden in ["apiKey", "api_key", "sk-", "Bearer "] {
        assert!(!manifest.contains(forbidden), "`{forbidden}` must never be in a package manifest");
    }
    // 而且包里只有这两类条目 —— 没有顺手带出去的配置文件。
    let mut names: Vec<&str> = entries.keys().map(String::as_str).collect();
    names.sort();
    assert_eq!(names, vec!["documents/d.mgeo", "manifest.json"]);
}

#[test]
fn a_package_from_a_newer_schema_is_refused_with_both_versions_in_the_message() {
    let blobs = store("pack-schema");
    let (bytes, _) = package::export("p", &[document("d", "{}")], &[], &[], &blobs, 1, None).expect("export");
    let rewritten = rewrite_manifest(&bytes, |manifest| manifest["schemaVersion"] = serde_json::json!(99));

    let error = package::import(&rewritten, &blobs).expect_err("a newer schema must be refused");

    match error {
        PackageError::SchemaVersion { found, understood } => {
            assert_eq!(found, 99);
            assert_eq!(understood, PACKAGE_SCHEMA_VERSION);
        }
        other => panic!("expected a schema error, got {other:?}"),
    }
    // 而报错那句话要**两个版本都说到** —— 否则用户不知道该怎么办。
    assert!(package::import(&rewritten, &blobs).unwrap_err().to_string().contains("99"));
}

#[test]
fn a_package_whose_document_was_edited_after_export_is_refused() {
    let blobs = store("pack-doc-hash");
    let (bytes, _) = package::export("p", &[document("d", "original")], &[], &[], &blobs, 1, None).expect("export");
    let tampered = rewrite_entry(&bytes, "documents/d.mgeo", b"tampered content");

    let error = package::import(&tampered, &blobs).expect_err("an edited document must be refused");

    match error {
        PackageError::DocumentHashMismatch { document_id, .. } => assert_eq!(document_id, "d"),
        other => panic!("expected a document hash mismatch, got {other:?}"),
    }
}

#[test]
fn a_package_whose_attachment_was_swapped_is_refused() {
    let blobs = store("pack-att-hash");
    let (hash, media_type) = export_png(&blobs);
    let (bytes, _) = package::export("p", &[], &[(hash.clone(), media_type)], &[], &blobs, 1, None).expect("export");
    let tampered = rewrite_entry(&bytes, &format!("attachments/{hash}"), b"not a png");

    let error = package::import(&tampered, &blobs).expect_err("a swapped attachment must be refused");

    // 附件的内容与**它自己的名字**对不上 —— 这一条在落盘之前就要拦住。
    assert!(matches!(error, PackageError::AttachmentHashMismatch { .. } | PackageError::Manifest { .. }), "got {error:?}");
}

#[test]
fn a_package_that_declares_a_document_it_does_not_contain_is_refused() {
    let blobs = store("pack-missing");
    let (bytes, _) = package::export("p", &[document("d", "{}")], &[], &[], &blobs, 1, None).expect("export");
    let stripped = drop_entry(&bytes, "documents/d.mgeo");

    let error = package::import(&stripped, &blobs).expect_err("a declared-but-absent document must be refused");

    assert!(matches!(error, PackageError::Missing { .. }), "got {error:?}");
}

#[test]
fn a_package_that_carries_an_undeclared_entry_is_refused() {
    // 有却没声明 = 夹带。用户不知道它从哪来，而我们没有理由替它保密。
    let blobs = store("pack-extra");
    let (bytes, _) = package::export("p", &[document("d", "{}")], &[], &[], &blobs, 1, None).expect("export");
    let smuggled = add_entry(&bytes, "documents/extra.mgeo", b"{}");

    let error = package::import(&smuggled, &blobs).expect_err("an undeclared entry must be refused");

    assert!(matches!(error, PackageError::Undeclared { .. }), "got {error:?}");
}

#[test]
fn a_package_without_a_manifest_says_so_instead_of_failing_obscurely() {
    let bytes = archive::write(&[Entry { name: "documents/d.mgeo".to_string(), bytes: b"{}".to_vec() }]).expect("write");

    assert_eq!(package::import(&bytes, &store("pack-nomanifest")).unwrap_err(), PackageError::MissingManifest);
}

#[test]
fn a_manifest_that_is_not_json_is_refused_without_panicking() {
    let bytes = archive::write(&[Entry { name: "manifest.json".to_string(), bytes: b"not json at all".to_vec() }]).expect("write");

    let error = package::import(&bytes, &store("pack-badmanifest")).unwrap_err();

    assert!(matches!(error, PackageError::Manifest { .. }), "got {error:?}");
}

#[test]
fn a_missing_source_link_is_reported_but_does_not_refuse_the_package() {
    // 来源缺失是**可恢复**的（那份文档可以后补），而"因为缺一个来源就拒绝打开"
    // 会让用户彻底拿不到自己的文档。
    let blobs = store("pack-sources");
    let links = vec![
        SourceLink { document_id: "d".to_string(), source_document_id: "elsewhere".to_string(), note: Some("the original view".to_string()) },
        SourceLink { document_id: "d".to_string(), source_document_id: "d".to_string(), note: None }
    ];
    let (bytes, _) = package::export("p", &[document("d", "{}")], &[], &links, &blobs, 1, None).expect("export");

    let outcome = package::import(&bytes, &blobs).expect("import must succeed");

    assert_eq!(outcome.missing_sources, vec!["elsewhere".to_string()], "the missing source is reported once");
    assert_eq!(outcome.manifest.source_links.len(), 2, "and the links themselves are kept as they were");
}

#[test]
fn a_package_with_two_documents_sharing_an_id_is_refused() {
    let blobs = store("pack-dup");
    let result = package::export("p", &[document("d", "one"), document("d", "two")], &[], &[], &blobs, 1, None);

    assert!(matches!(result, Err(PackageError::Duplicate { .. })), "got {result:?}");
}

#[test]
fn exporting_an_attachment_that_is_not_in_the_store_is_refused_instead_of_writing_a_hole() {
    let blobs = store("pack-gone");

    let result = package::export("p", &[], &[("a".repeat(64), "image/png".to_string())], &[], &blobs, 1, None);

    assert!(matches!(result, Err(PackageError::Missing { .. })), "got {result:?}");
}

#[test]
fn a_package_file_is_written_atomically_and_read_back_with_a_size_guard() {
    let blobs = store("pack-file");
    let (bytes, _) = package::export("p", &[document("d", "{}")], &[], &[], &blobs, 1, None).expect("export");
    let path = blobs.root().join("out.mcanvas");

    package::write_to_file(&path, &bytes).expect("write the package");
    let read = package::read_from_file(&path).expect("read the package");

    assert_eq!(read, bytes, "the file must be byte-identical to what export produced");
    // 临时文件不能在原地留下。
    assert!(!path.with_extension("mcanvas.tmp").exists());
    // 读一个不存在的包要给出一句有内容的错误（而不是 `None` 或者空串）。
    assert!(!package::read_from_file(blobs.root().join("missing.mcanvas")).unwrap_err().to_string().is_empty());
}

#[test]
fn importing_the_same_package_twice_is_harmless() {
    // 用户点了两次"导入"。附件是内容寻址的，所以第二次只是"已经有了"。
    let blobs = store("pack-twice");
    let (hash, media_type) = export_png(&blobs);
    let (bytes, _) = package::export("p", &[document("d", "{}")], &[(hash.clone(), media_type)], &[], &blobs, 1, None).expect("export");

    let first = package::import(&bytes, &blobs).expect("first import");
    let second = package::import(&bytes, &blobs).expect("second import");

    assert_eq!(first.stored_attachments, second.stored_attachments);
    assert_eq!(std::fs::read_dir(blobs.root().join("blobs")).expect("blobs").count(), 1);
}

// ---------------------------------------------------------------- 改包的助手

/// 重写清单（其余条目原样保留）。用来造出"被改过的包"。
fn rewrite_manifest(bytes: &[u8], change: impl FnOnce(&mut serde_json::Value)) -> Vec<u8> {
    let entries = archive::read(bytes).expect("read");
    let mut manifest: serde_json::Value = serde_json::from_slice(&entries["manifest.json"]).expect("parse the manifest");
    change(&mut manifest);
    let mut rebuilt: Vec<Entry> = entries
        .into_iter()
        .map(|(name, data)| {
            let bytes = if name == "manifest.json" { serde_json::to_vec_pretty(&manifest).expect("serialize") } else { data };
            Entry { name, bytes }
        })
        .collect();
    rebuilt.sort_by(|left, right| left.name.cmp(&right.name));
    archive::write(&rebuilt).expect("rewrite")
}

/// 换掉某个条目的字节（**不更新清单** —— 这正是要测的"内容与清单不符"）。
fn rewrite_entry(bytes: &[u8], target: &str, replacement: &[u8]) -> Vec<u8> {
    let entries = archive::read(bytes).expect("read");
    let rebuilt: Vec<Entry> = entries
        .into_iter()
        .map(|(name, data)| Entry { name: name.clone(), bytes: if name == target { replacement.to_vec() } else { data } })
        .collect();
    archive::write(&rebuilt).expect("rewrite")
}

fn drop_entry(bytes: &[u8], target: &str) -> Vec<u8> {
    let entries = archive::read(bytes).expect("read");
    let rebuilt: Vec<Entry> = entries.into_iter().filter(|(name, _)| name != target).map(|(name, bytes)| Entry { name, bytes }).collect();
    archive::write(&rebuilt).expect("rewrite")
}

fn add_entry(bytes: &[u8], name: &str, data: &[u8]) -> Vec<u8> {
    let entries = archive::read(bytes).expect("read");
    let mut rebuilt: Vec<Entry> = entries.into_iter().map(|(name, bytes)| Entry { name, bytes }).collect();
    rebuilt.push(Entry { name: name.to_string(), bytes: data.to_vec() });
    archive::write(&rebuilt).expect("rewrite")
}
