//! **`.mcanvas` 的导出与导入**（Task 1.6 Step 5）。
//!
//! 计划原文："Implement `.mcanvas` export/import. Validate relative paths, hashes, schema versions,
//! attachment limits, and source links; **retain `.mgeo` compatibility unchanged**."
//!
//! ## 一个包长什么样
//!
//! ```text
//! manifest.json          版本、时间、文档清单、附件清单、来源链接
//! documents/<id>.mgeo    文档本体（就是原来那个 `.mgeo` 格式，一个字节没改）
//! attachments/<sha256>   附件字节（名字就是内容的哈希）
//! ```
//!
//! **`.mgeo` 的格式一个字节都没改**：包里装的就是它。于是"打开一个 `.mgeo` 文件"
//! 这条老路径完全不受影响 —— 那正是"retain compatibility unchanged"的落点。
//!
//! ## 导入那一侧才是判据所在
//!
//! 导出只需要如实写；**导入要处理的是不可信输入**（别人的包、被改过的包、坏掉的包）。
//! 所以这里的每一条校验都对应一种具体的坏情况：
//!
//! | 校验 | 不校验会怎样 |
//! | --- | --- |
//! | schema 版本 | 未来版本写的包被当成本版本读，字段被静默丢掉 |
//! | 相对路径安全 | 包里一个 `../../x` 让解包写到仓库外面 |
//! | **文档哈希** | 内容被改过而清单没改 —— 打开时看到的与清单说的不是一份东西 |
//! | **附件哈希** | 附件内容坏了，而它会被当真地显示给用户 |
//! | 附件大小上限 | 一个几百兆的包把内存吃光（字节是一次读进来的） |
//! | 文档/附件清单与实际条目**一一对应** | 声明了却不存在的附件变成"神秘丢失"，存在却未声明的条目变成夹带 |
//! | 名字不重复 | 两份文档抢同一个 id 时，先写的那份静默消失 |
//!
//! ## 一件刻意不做的事：包里没有密钥
//!
//! `manifest.json` 里只有 `profileId` 与 `secretRef` 这种**引用**（而且它们是可选的）。
//! 这一条由用例守着 —— 一个"顺手把配置也打进去"的改动会让包变成一份凭据泄漏。

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::archive::{self, ArchiveError, Entry};
use super::blobs::{sha256_hex, BlobError, BlobStore};

/// 这个构建能写、也能读的包版本。
pub const PACKAGE_SCHEMA_VERSION: u32 = 1;
/// 包里文档的数量上限。一个画布项目不该有几百份文档。
pub const MAX_DOCUMENTS: usize = 256;
/// 包里附件的数量上限。
pub const MAX_ATTACHMENTS: usize = 1024;
/// 清单本身的上限（1 MiB）。清单是元数据，不该大到这个程度 ——
/// 超过了说明有人在拿它当数据传输的通道。
pub const MAX_MANIFEST_BYTES: usize = 1024 * 1024;

/// 包处理中的错误。**每一种都能被翻译成一句给用户看的话**。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PackageError {
    /// 容器层的问题（不是 zip、结构坏了、条目名不安全）。
    Archive { detail: String },
    /// 没有 `manifest.json`。
    MissingManifest,
    /// 清单不是合法 JSON，或者字段形状不对。
    Manifest { detail: String },
    /// 版本对不上。
    SchemaVersion { found: u32, understood: u32 },
    /// 某个文档的内容与清单里写的哈希不符。
    DocumentHashMismatch { document_id: String, declared: String, actual: String },
    /// 某个附件的内容与它的名字（＝哈希）不符。
    AttachmentHashMismatch { content_hash: String },
    /// 清单声明了、但包里没有的东西。
    Missing { name: String },
    /// 清单没声明、但包里有的东西（夹带）。
    Undeclared { name: String },
    /// 重复的名字 / id。
    Duplicate { detail: String },
    /// 超过某个上限。
    Limit { detail: String },
    /// 磁盘或附件仓库出错。
    Blob { detail: String },
}

impl std::fmt::Display for PackageError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PackageError::Archive { detail } => write!(formatter, "the package could not be read: {detail}"),
            PackageError::MissingManifest => write!(formatter, "this package has no manifest.json, so it is not a .mcanvas package"),
            PackageError::Manifest { detail } => write!(formatter, "the package manifest is invalid: {detail}"),
            PackageError::SchemaVersion { found, understood } => {
                write!(formatter, "this package was written by schema {found}; this build understands {understood}")
            }
            PackageError::DocumentHashMismatch { document_id, declared, actual } => {
                write!(formatter, "the document `{document_id}` does not match the manifest (manifest {declared}, actual {actual})")
            }
            PackageError::AttachmentHashMismatch { content_hash } => {
                write!(formatter, "the attachment `{content_hash}` does not match its own name, so it is corrupt")
            }
            PackageError::Missing { name } => write!(formatter, "the package declares `{name}` but does not contain it"),
            PackageError::Undeclared { name } => write!(formatter, "the package contains `{name}` without declaring it in the manifest"),
            PackageError::Duplicate { detail } => write!(formatter, "{detail}"),
            PackageError::Limit { detail } => write!(formatter, "{detail}"),
            PackageError::Blob { detail } => write!(formatter, "{detail}"),
        }
    }
}

impl std::error::Error for PackageError {}

impl From<ArchiveError> for PackageError {
    fn from(error: ArchiveError) -> Self {
        PackageError::Archive { detail: error.to_string() }
    }
}

impl From<BlobError> for PackageError {
    fn from(error: BlobError) -> Self {
        PackageError::Blob { detail: error.to_string() }
    }
}

/// 清单里的一份文档。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestDocument {
    pub document_id: String,
    /// 容器内的路径（`documents/<id>.mgeo`）。**永远是相对的**。
    pub path: String,
    /// 内容的 SHA-256。导入时逐字核对。
    pub content_hash: String,
    /// 这次导出时的代数（供导入方参考，**不是**校验依据）。
    #[serde(default)]
    pub generation: i64,
    pub epoch: String,
}

/// 清单里的一份附件。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestAttachment {
    /// 内容的 SHA-256，同时也是容器内的文件名。
    pub content_hash: String,
    pub byte_size: u64,
    pub media_type: String,
}

/**
 * 清单里的一个**来源链接**。
 *
 * 它记的是"这份文档的来源是什么"（另一个文档 / 一次投影 / 一个事实），
 * 而**不是**把来源那份文档复制一份。导入时只校验"它指向的 id 在包里或本机存在"，
 * 不因为它缺失就拒绝整个包 —— 来源缺失是**可恢复**的（那份文档可以后补），
 * 而"因为缺一个来源就拒绝打开"会让用户彻底拿不到自己的文档。
 */
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLink {
    pub document_id: String,
    pub source_document_id: String,
    #[serde(default)]
    pub note: Option<String>,
}

/**
 * `.mcanvas` 的清单。
 *
 * ## 为什么它带 `profileId` / `secretRef`，而这两个字段又都是可选的
 *
 * 因为一份文档"是从哪个模型配置生成的"是有用的溯源信息，而**它只是引用**：
 * 密钥本体在系统的凭据库里，包里**永远**没有它。这两个字段可选是因为
 * 一份纯手画的文档根本没有模型配置。
 */
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageManifest {
    pub schema_version: u32,
    pub project_id: String,
    pub exported_at: i64,
    pub documents: Vec<ManifestDocument>,
    #[serde(default)]
    pub attachments: Vec<ManifestAttachment>,
    #[serde(default)]
    pub source_links: Vec<SourceLink>,
    /// **只有引用**（可选）。包里没有任何密钥。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_ref: Option<String>,
}

/// 一份要导出的文档。
pub struct ExportDocument {
    pub document_id: String,
    pub epoch: String,
    pub generation: i64,
    /// `.mgeo` 的原文。**一个字节都不改**。
    pub content: String,
}

/// 导出结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageReport {
    pub project_id: String,
    pub document_count: usize,
    pub attachment_count: usize,
    /// 容器内的文档路径（按名字排序），供日志与测试断言。
    pub document_paths: Vec<String>,
}

/// **导出**一个 `.mcanvas` 包。
///
/// `blob_root` 是附件仓库的根（同一个 `BlobStore`）；要打进包里的附件由
/// `documents` 里那些内容的哈希推出 —— 也就是**调用方说打哪些就打哪些**，
/// 而不是"把整个仓库都打进去"（那会把不相干的附件也带走）。
pub fn export(
    project_id: &str,
    documents: &[ExportDocument],
    attachments: &[(String, String)],
    source_links: &[SourceLink],
    blobs: &BlobStore,
    exported_at: i64,
    profile: Option<(String, String)>,
) -> Result<(Vec<u8>, PackageReport), PackageError> {
    if documents.len() > MAX_DOCUMENTS {
        return Err(PackageError::Limit { detail: format!("a package may hold at most {MAX_DOCUMENTS} documents") });
    }
    if attachments.len() > MAX_ATTACHMENTS {
        return Err(PackageError::Limit { detail: format!("a package may hold at most {MAX_ATTACHMENTS} attachments") });
    }

    let mut entries: Vec<Entry> = Vec::new();
    let mut manifest_documents: Vec<ManifestDocument> = Vec::new();
    let mut seen_ids: BTreeSet<String> = BTreeSet::new();

    for document in documents {
        if !seen_ids.insert(document.document_id.clone()) {
            return Err(PackageError::Duplicate { detail: format!("two documents share the id `{}`", document.document_id) });
        }
        if !archive::is_safe_name(&document.document_id) {
            return Err(PackageError::Duplicate { detail: format!("`{}` is not usable as a document id", document.document_id) });
        }
        let path = format!("documents/{}.mgeo", document.document_id);
        let bytes = document.content.as_bytes().to_vec();
        manifest_documents.push(ManifestDocument {
            document_id: document.document_id.clone(),
            path: path.clone(),
            content_hash: sha256_hex(&bytes),
            generation: document.generation,
            epoch: document.epoch.clone(),
        });
        entries.push(Entry { name: path, bytes });
    }

    let mut manifest_attachments: Vec<ManifestAttachment> = Vec::new();
    for (content_hash, media_type) in attachments {
        let bytes = blobs.read(content_hash)?.ok_or_else(|| PackageError::Missing { name: content_hash.clone() })?;
        // 名字就是哈希：内容与名字对不上说明磁盘上那份已经坏了。
        // **导出时就拒**，而不是把一个坏附件打进去让下一个人的导入失败。
        if !sha256_hex(&bytes).eq_ignore_ascii_case(content_hash) {
            return Err(PackageError::AttachmentHashMismatch { content_hash: content_hash.clone() });
        }
        manifest_attachments.push(ManifestAttachment { content_hash: content_hash.clone(), byte_size: bytes.len() as u64, media_type: media_type.clone() });
        entries.push(Entry { name: format!("attachments/{content_hash}"), bytes });
    }

    let manifest = PackageManifest {
        schema_version: PACKAGE_SCHEMA_VERSION,
        project_id: project_id.to_string(),
        exported_at,
        documents: manifest_documents,
        attachments: manifest_attachments,
        source_links: source_links.to_vec(),
        profile_id: profile.as_ref().map(|(id, _)| id.clone()),
        secret_ref: profile.as_ref().map(|(_, reference)| reference.clone())
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(|error| PackageError::Manifest { detail: error.to_string() })?;
    if manifest_bytes.len() > MAX_MANIFEST_BYTES {
        return Err(PackageError::Limit { detail: format!("the manifest would be {} bytes; the limit is {MAX_MANIFEST_BYTES}", manifest_bytes.len()) });
    }
    entries.push(Entry { name: "manifest.json".to_string(), bytes: manifest_bytes });

    let report = PackageReport {
        project_id: project_id.to_string(),
        document_count: documents.len(),
        attachment_count: attachments.len(),
        document_paths: manifest.documents.iter().map(|document| document.path.clone()).collect()
    };
    Ok((archive::write(&entries)?, report))
}

/// 导入结果。
///
/// ## 为什么它如实带回"有哪些文档"和"哪些来源是缺的"
///
/// 因为导入之后要做的事（把文档写进仓库、把附件落盘）需要这些信息，
/// 而**缺来源不是失败**：来源缺失是可恢复的，用户该拿到他的文档，
/// 同时看到一句"有 2 个来源不在这个包里"。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportOutcome {
    pub manifest: PackageManifest,
    /// `document_id -> .mgeo 原文`（哈希已经逐份核对过）。
    pub documents: Vec<(String, String)>,
    /// 来源链接里指向的、**这个包里没有**的文档 id（去重、排序）。
    pub missing_sources: Vec<String>,
    /// 落盘成功的附件哈希（按名字排序）。
    pub stored_attachments: Vec<String>,
}

/**
 * **导入**一个 `.mcanvas` 包。
 *
 * ## 顺序：先把整包验完，再落下任何东西
 *
 * "验一条存一条"会在第 N 条失败时留下前 N−1 条已经写进仓库 —— 那种**部分导入**
 * 是最难收拾的状态（用户看到一半的文档，而我们不知道剩下那一半该不该补）。
 * 所以这里先把所有判据跑完，通过了才写附件；文档本体交给调用方去写
 *（它要开事务，见 `ProjectRepository::replace_epoch`）。
 */
pub fn import(bytes: &[u8], blobs: &BlobStore) -> Result<ImportOutcome, PackageError> {
    let entries = archive::read(bytes)?;
    let manifest_bytes = entries.get("manifest.json").ok_or(PackageError::MissingManifest)?;
    if manifest_bytes.len() > MAX_MANIFEST_BYTES {
        return Err(PackageError::Limit { detail: format!("the manifest is {} bytes; the limit is {MAX_MANIFEST_BYTES}", manifest_bytes.len()) });
    }
    let manifest: PackageManifest = serde_json::from_slice(manifest_bytes).map_err(|error| PackageError::Manifest { detail: error.to_string() })?;

    if manifest.schema_version != PACKAGE_SCHEMA_VERSION {
        return Err(PackageError::SchemaVersion { found: manifest.schema_version, understood: PACKAGE_SCHEMA_VERSION });
    }
    if manifest.documents.len() > MAX_DOCUMENTS {
        return Err(PackageError::Limit { detail: format!("the package declares {} documents; the limit is {MAX_DOCUMENTS}", manifest.documents.len()) });
    }
    if manifest.attachments.len() > MAX_ATTACHMENTS {
        return Err(PackageError::Limit { detail: format!("the package declares {} attachments; the limit is {MAX_ATTACHMENTS}", manifest.attachments.len()) });
    }

    // **声明的东西与包里的东西必须一一对应**。两个方向都要查：
    // 声明了却没有 → "神秘丢失"；有却没声明 → 夹带（用户不知道它从哪来）。
    let mut declared: BTreeSet<String> = BTreeSet::new();
    declared.insert("manifest.json".to_string());
    for document in &manifest.documents {
        if !archive::is_safe_name(&document.path) {
            return Err(PackageError::Missing { name: document.path.clone() });
        }
        if !declared.insert(document.path.clone()) {
            return Err(PackageError::Duplicate { detail: format!("two entries claim `{}`", document.path) });
        }
    }
    let mut declared_attachments: BTreeSet<String> = BTreeSet::new();
    for attachment in &manifest.attachments {
        let path = format!("attachments/{}", attachment.content_hash);
        if !declared.insert(path.clone()) {
            return Err(PackageError::Duplicate { detail: format!("two entries claim `{path}`") });
        }
        if !declared_attachments.insert(attachment.content_hash.clone()) {
            return Err(PackageError::Duplicate { detail: format!("two attachments share the hash `{}`", attachment.content_hash) });
        }
    }
    for name in entries.keys() {
        if !declared.contains(name) {
            return Err(PackageError::Undeclared { name: name.clone() });
        }
    }

    // 文档：逐份核对哈希。
    let mut seen_ids: BTreeSet<String> = BTreeSet::new();
    let mut documents: Vec<(String, String)> = Vec::new();
    for document in &manifest.documents {
        if !seen_ids.insert(document.document_id.clone()) {
            return Err(PackageError::Duplicate { detail: format!("two documents share the id `{}`", document.document_id) });
        }
        let raw = entries.get(&document.path).ok_or_else(|| PackageError::Missing { name: document.path.clone() })?;
        let actual = sha256_hex(raw);
        if !actual.eq_ignore_ascii_case(&document.content_hash) {
            return Err(PackageError::DocumentHashMismatch { document_id: document.document_id.clone(), declared: document.content_hash.clone(), actual });
        }
        let content = String::from_utf8(raw.clone()).map_err(|_| PackageError::Manifest { detail: format!("the document `{}` is not valid UTF-8", document.document_id) })?;
        documents.push((document.document_id.clone(), content));
    }

    // 附件：先验完**每一份**，再落盘。
    let mut verified: Vec<(String, Vec<u8>)> = Vec::new();
    for attachment in &manifest.attachments {
        let name = format!("attachments/{}", attachment.content_hash);
        let raw = entries.get(&name).ok_or_else(|| PackageError::Missing { name: name.clone() })?;
        if raw.len() as u64 != attachment.byte_size {
            return Err(PackageError::Manifest {
                detail: format!("the attachment `{}` is {} bytes; the manifest says {}", attachment.content_hash, raw.len(), attachment.byte_size)
            });
        }
        if !sha256_hex(raw).eq_ignore_ascii_case(&attachment.content_hash) {
            return Err(PackageError::AttachmentHashMismatch { content_hash: attachment.content_hash.clone() });
        }
        verified.push((attachment.content_hash.clone(), raw.clone()));
    }

    // 到这一步整包已经验完 —— 才开始落盘。
    let mut stored_attachments = Vec::new();
    for (content_hash, raw) in &verified {
        // `write` 会再算一次哈希（那是它自己的判据），这里给的就是刚验过的值。
        blobs.write(raw, content_hash)?;
        stored_attachments.push(content_hash.clone());
    }
    stored_attachments.sort();

    // 来源链接：**缺来源不失败**（见 `SourceLink` 的说明），如实列出来。
    let present: BTreeSet<&str> = manifest.documents.iter().map(|document| document.document_id.as_str()).collect();
    let mut missing_sources: Vec<String> = manifest
        .source_links
        .iter()
        .map(|link| link.source_document_id.clone())
        .filter(|source| !present.contains(source.as_str()))
        .collect();
    missing_sources.sort();
    missing_sources.dedup();

    Ok(ImportOutcome { manifest, documents, missing_sources, stored_attachments })
}

/// **把一个包写成文件**（`.mcanvas`）。写盘是原子的：先 `*.tmp` 再改名。
pub fn write_to_file(path: impl AsRef<Path>, bytes: &[u8]) -> Result<(), PackageError> {
    let path = path.as_ref();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| PackageError::Blob { detail: format!("cannot create {}: {error}", parent.display()) })?;
    }
    let temp = path.with_extension("mcanvas.tmp");
    {
        use std::io::Write;
        let mut handle = std::fs::File::create(&temp).map_err(|error| PackageError::Blob { detail: format!("cannot write {}: {error}", temp.display()) })?;
        handle.write_all(bytes).map_err(|error| PackageError::Blob { detail: format!("cannot write {}: {error}", temp.display()) })?;
        handle.sync_all().map_err(|error| PackageError::Blob { detail: format!("cannot flush {}: {error}", temp.display()) })?;
    }
    std::fs::rename(&temp, path).map_err(|error| PackageError::Blob { detail: format!("cannot replace {}: {error}", path.display()) })
}

/// 读一个包文件。**大小也要先看**：一个几百兆的包不该被整个读进内存再判。
pub fn read_from_file(path: impl AsRef<Path>) -> Result<Vec<u8>, PackageError> {
    let path = path.as_ref();
    let metadata = std::fs::metadata(path).map_err(|error| PackageError::Blob { detail: format!("cannot open {}: {error}", path.display()) })?;
    let limit = (archive::MAX_ENTRY_BYTES * 4) as u64;
    if metadata.len() > limit {
        return Err(PackageError::Limit { detail: format!("the package is {} bytes; the limit is {limit}", metadata.len()) });
    }
    std::fs::read(path).map_err(|error| PackageError::Blob { detail: format!("cannot read {}: {error}", path.display()) })
}

/// `BTreeMap` 的别名，让 `import` 的签名读起来短一点。
pub type Entries = BTreeMap<String, Vec<u8>>;
