//! **仓储**（Task 1.3 / 1.6）。
//!
//! 两个子模块，用**不同的存储形态**，理由写在各自的开头：
//! - `provider_profiles`：**文件**。配置是"重启后必须能读到"的东西，
//!   它不该被一个还在长的数据库拖住（Task 1.3 时数据库还不存在）。
//! - `projects`：**SQLite**。文档、历史、提交记录、幂等键需要**事务** ——
//!   断电时不能留下半个文档。

pub mod migrations;
pub mod projects;
pub mod provider_profiles;

pub use projects::{CommitOutcome, CommitReceipt, CommitRequest, DocumentSnapshot, ProjectRepository, RepositoryError};
