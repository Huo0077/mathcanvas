//! **仓储**（Task 1.3 / 1.6）。
//!
//! 四个子模块，用**不同的存储形态**，理由写在各自的开头：
//! - `provider_profiles`：**文件**。配置是"重启后必须能读到"的东西，
//!   它不该被一个还在长的数据库拖住（Task 1.3 时数据库还不存在）。
//! - `projects`：**SQLite**。文档、历史、提交记录、幂等键需要**事务** ——
//!   断电时不能留下半个文档。
//! - `blobs`：**磁盘上的文件**，名字就是内容的 SHA-256。附件是几十兆的字节，
//!   塞进 SQLite 会让每次备份与每次读 head 都变贵。两阶段写的理由见那个文件的开头。
//! - `package`：**`.mcanvas` 包**（manifest + `.mgeo` + 附件）。它把上面三者
//!   打成一个可以递给别人的文件，而**校验在导入那一侧**。
//! - `run_events`：**SQLite 里只追加的账本**（Task 2.6）。它回答的是"这次运行到底
//!   发生了什么"，而且**绝不存模型推理与图像字节** —— 那条靠结构（没有那些字段）
//!   与入口（多一个字段就拒）成立，理由见那个文件的开头。

pub mod archive;
pub mod blobs;
pub mod migrations;
pub mod projects;
pub mod provider_profiles;
pub mod package;
pub mod run_events;

pub use blobs::{BlobError, BlobStore, StagedBlob, StoredBlob};
pub use package::{ImportOutcome, PackageError, PackageManifest, PackageReport};
pub use projects::{CommitOutcome, CommitReceipt, CommitRequest, DocumentSnapshot, ProjectRepository, RepositoryError};
pub use run_events::{RunEventInput, RunEventRecord};
