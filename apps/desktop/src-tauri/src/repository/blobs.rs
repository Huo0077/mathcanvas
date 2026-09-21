//! **附件的两阶段写**（Task 1.6 Step 4）。
//!
//! 计划原文："Hash/size-check and atomically rename the blob first, then insert the DB reference;
//! **garbage-collect only unreferenced blobs**."
//!
//! ## 为什么是两阶段，而不是"先写库再写文件"
//!
//! 两次写之间一定会有一个窗口，而崩溃可能正好落在里面。两种排法留下的东西不一样：
//!
//! | 顺序 | 崩溃点 | 留下什么 |
//! | --- | --- | --- |
//! | ① 先写文件、② 再写库引用 | 在 ① 与 ② 之间 | **孤儿 blob**：文件在、没人引用它。用户看不到它，但它占着磁盘 |
//! | ① 先写库引用、② 再写文件 | 在 ① 与 ② 之间 | **悬空引用**：库说有这么个附件，文件却不在。打开文档时会报"附件丢失" |
//!
//! 悬空引用是**用户可见的损坏**，孤儿 blob 只是浪费空间。所以顺序是"先文件、后引用"，
//! 而且文件那一半是**原子**的：先写 `tmp/` 下的临时文件，`sync_all` 之后再 `rename`
//! 进 `blobs/`。rename 要么没发生、要么已生效 —— 不会出现半个文件被当成完整附件。
//!
//! ## 为什么临时文件也放进 `tmp/` 而不是系统临时目录
//!
//! 因为 `rename` 只在**同一个文件系统**内是原子的。系统临时目录在另一块盘上时，
//! `rename` 会失败（或者被悄悄降级成"复制 + 删除"，那就不是原子的了）。
//!
//! ## 名字就是哈希
//!
//! `blobs/<sha256>` —— 于是"同一份附件存两次"自然只有一份，而且**校验不需要额外记录**：
//! 读出来的字节自己就能验（`verify`）。这也是 GC 能安全工作的前提：一个 blob 有没有被引用，
//! 只看库里有没有那一行。

use std::collections::BTreeSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// 附件层的错误。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlobError {
    /// 超过单份附件的上限。
    TooLarge { size: usize, limit: usize },
    /// 哈希与内容对不上（调用方说这份是 X，实际算出来是 Y）。
    HashMismatch { declared: String, actual: String },
    /// 文件系统出问题。`detail` 里**没有附件内容**。
    Io { detail: String },
}

impl std::fmt::Display for BlobError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BlobError::TooLarge { size, limit } => write!(formatter, "the attachment is {size} bytes; the limit is {limit}"),
            BlobError::HashMismatch { declared, actual } => write!(formatter, "the attachment declares hash {declared} but its bytes hash to {actual}"),
            BlobError::Io { detail } => write!(formatter, "{detail}"),
        }
    }
}

impl std::error::Error for BlobError {}

/// 一次已经落盘、但**还没有被任何快照引用**的写入。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StagedBlob {
    pub content_hash: String,
    pub byte_size: usize,
}

/// 已经落盘的附件。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredBlob {
    pub content_hash: String,
    pub byte_size: usize,
}

/// 单份附件的上限（32 MiB）。**与容器里单条目的上限是两个数**：这一个管的是
/// "能不能存进仓库"，那一个管的是"能不能打进包里"。
pub const MAX_ATTACHMENT_BYTES: usize = 32 * 1024 * 1024;

/// GC 的**宽限期**：比这更新鲜的孤儿先不删。
///
/// 为什么需要它：正常操作里"文件已写、引用还没写"的窗口是存在的（毫秒级），
/// 而一次并发的 GC 正好落在那个窗口里就会删掉一份**正在被引用**的附件 ——
/// 那是**用户可见的损坏**，比多占一会儿磁盘糟得多。
///
/// `gc_with_grace(.., 0)` 是给测试用的：宽限期是策略，而"哪些文件该删"是逻辑，
/// 两者要能分开测。
pub const GC_GRACE_MS: u64 = 60_000;

/// **附件仓库**。它管磁盘上那一半；"哪些被引用"归数据库管（见 `ProjectRepository`）。
pub struct BlobStore {
    root: PathBuf,
}

impl BlobStore {
    /// 打开（或新建）一个附件目录。`root` 下会有 `blobs/` 与 `tmp/`。
    pub fn open(root: impl AsRef<Path>) -> Result<Self, BlobError> {
        let root = root.as_ref().to_path_buf();
        for directory in [root.join("blobs"), root.join("tmp")] {
            fs::create_dir_all(&directory).map_err(|error| BlobError::Io { detail: format!("cannot create {}: {error}", directory.display()) })?;
        }
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn blob_path(&self, content_hash: &str) -> PathBuf {
        self.root.join("blobs").join(content_hash)
    }

    /// **第一阶段**：把字节原子地放进 `blobs/`，并回答它的哈希与大小。
    ///
    /// `declared_hash` 是调用方（前端）算好的那一个。它**必须**一起给：
    /// 只信我们算出来的值，就无法发现"界面显示的那份内容与实际存下来的不是同一份"；
    /// 只信调用方给的值，就等于把一个可以被伪造的校验和落进库。
    /// 两个都对上才算通过。
    pub fn write(&self, bytes: &[u8], declared_hash: &str) -> Result<StagedBlob, BlobError> {
        if bytes.len() > MAX_ATTACHMENT_BYTES {
            return Err(BlobError::TooLarge { size: bytes.len(), limit: MAX_ATTACHMENT_BYTES });
        }
        let actual = sha256_hex(bytes);
        if !declared_hash.eq_ignore_ascii_case(&actual) {
            // **一字节都不落盘**：一份哈希对不上的附件存下来只会变成一份没人认得的垃圾。
            return Err(BlobError::HashMismatch { declared: declared_hash.to_string(), actual });
        }
        if self.blob_path(&actual).is_file() {
            // 已经有了（同一份附件存两次是常态）。**不重写**：重写会多一次没有必要的
            // 写盘与一个可以让另一个读者看到半个文件的窗口。
            return Ok(StagedBlob { content_hash: actual, byte_size: bytes.len() });
        }

        let temp = self.root.join("tmp").join(format!("{actual}.part"));
        {
            let mut handle = fs::File::create(&temp).map_err(|error| BlobError::Io { detail: format!("cannot create {}: {error}", temp.display()) })?;
            handle.write_all(bytes).map_err(|error| BlobError::Io { detail: format!("cannot write {}: {error}", temp.display()) })?;
            // 落盘再改名：断电时"改名"这一步要么没发生、要么已生效。
            handle.sync_all().map_err(|error| BlobError::Io { detail: format!("cannot flush {}: {error}", temp.display()) })?;
        }
        fs::rename(&temp, self.blob_path(&actual)).map_err(|error| BlobError::Io { detail: format!("cannot move the attachment into place: {error}") })?;

        Ok(StagedBlob { content_hash: actual, byte_size: bytes.len() })
    }

    /// 读一份附件。**找不到就是 `None`**（`BlobError` 只表示"出错了"）。
    pub fn read(&self, content_hash: &str) -> Result<Option<Vec<u8>>, BlobError> {
        let path = self.blob_path(content_hash);
        if !path.is_file() {
            return Ok(None);
        }
        fs::read(&path).map(Some).map_err(|error| BlobError::Io { detail: format!("cannot read {}: {error}", path.display()) })
    }

    /// 校验一份附件的内容**与它的名字一致**。
    ///
    /// 这一条比它看起来重要：blob 的名字就是哈希，所以"内容与名字是否一致"这件事
    /// 随时可以验，不需要任何额外记录 —— 而磁盘上的字节**会**因为各种原因变坏
    ///（坏扇区、被别的程序改、上一次拷贝没拷完）。
    pub fn verify(&self, content_hash: &str) -> Result<bool, BlobError> {
        match self.read(content_hash)? {
            None => Ok(false),
            Some(bytes) => Ok(sha256_hex(&bytes).eq_ignore_ascii_case(content_hash)),
        }
    }

    /// **第二阶段**（清理）：删掉 `< grace` 之外、且不被 `referenced` 引用的 blob。
    ///
    /// `referenced` 由数据库给出（`ProjectRepository::referenced_blobs`）——
    /// 这一层**不认识数据库**，所以 GC 的判据只有一个输入：哪些哈希是被引用的。
    /// 返回被删掉的哈希（按名字排序，便于断言与日志）。
    pub fn collect_garbage(&self, referenced: &BTreeSet<String>, grace_ms: u64) -> Result<Vec<String>, BlobError> {
        let now = now_ms();
        let blobs = self.root.join("blobs");
        let mut removed = Vec::new();
        let entries = match fs::read_dir(&blobs) {
            Ok(entries) => entries,
            // 目录不在＝没有 blob 可清。这不是错误。
            Err(_) => return Ok(removed),
        };

        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if referenced.contains(&name) {
                continue;
            }
            // 宽限期：太新鲜的不动（见 `GC_GRACE_MS` 的说明）。
            let age = entry
                .metadata()
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|since| now.saturating_sub(since.as_millis() as u64))
                .unwrap_or(u64::MAX);
            if age < grace_ms {
                continue;
            }
            fs::remove_file(entry.path()).map_err(|error| BlobError::Io { detail: format!("cannot remove the unreferenced attachment {name}: {error}") })?;
            removed.push(name);
        }

        // 顺手清掉 `tmp/` 里那些从来没被改名的半成品：它们要么是崩溃留下的，
        // 要么是一次失败的写 —— 两种都没有保留价值。
        if let Ok(entries) = fs::read_dir(self.root.join("tmp")) {
            for entry in entries.flatten() {
                let _ = fs::remove_file(entry.path());
            }
        }

        removed.sort();
        Ok(removed)
    }
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_millis() as u64).unwrap_or(0)
}

// ---------------------------------------------------------------- SHA-256

/// **SHA-256**（FIPS 180-4）。
///
/// ## 为什么自己写而不是引 `sha2`
///
/// 与 `keyring` 那次的选择不同：那一次是"自己写要碰 `unsafe`、要处理 `GetLastError`
/// 的每一条"，所以引库是对的。这一次只有一张常量表与 64 轮整数运算 ——
/// 而它有一个 `sha2` 给不了的好处：**判据就在仓库里**，配着标准测试向量
///（空串、`"abc"`、两段长消息）逐条验。引库的话，"哈希对不对"只能靠相信它。
///
/// 代价是性能（没有 SIMD/查表优化）。这里只对**附件**用，而附件是用户手动挑的，
/// 一次几兆；32 MiB 大约 0.3 秒，可以接受。
pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = sha256(bytes);
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    // 前 8 个素数的平方根小数部分的前 32 位（FIPS 180-4 §4.2.2）。
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    // 前 8 个素数的平方根小数部分的前 32 位（初始哈希值）。
    let mut state: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

    // 填充：`1` 位、若干 `0`、最后 8 字节的大端比特长度。
    let mut message = bytes.to_vec();
    let bit_length = (bytes.len() as u64).wrapping_mul(8);
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_length.to_be_bytes());

    for block in message.chunks_exact(64) {
        let mut schedule = [0u32; 64];
        for (index, chunk) in block.chunks_exact(4).enumerate() {
            schedule[index] = u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }
        for index in 16..64 {
            let s0 = schedule[index - 15].rotate_right(7) ^ schedule[index - 15].rotate_right(18) ^ (schedule[index - 15] >> 3);
            let s1 = schedule[index - 2].rotate_right(17) ^ schedule[index - 2].rotate_right(19) ^ (schedule[index - 2] >> 10);
            schedule[index] = schedule[index - 16]
                .wrapping_add(s0)
                .wrapping_add(schedule[index - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;
        for index in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let choose = (e & f) ^ ((!e) & g);
            let temp1 = h
                .wrapping_add(s1)
                .wrapping_add(choose)
                .wrapping_add(K[index])
                .wrapping_add(schedule[index]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(majority);

            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        for (slot, value) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *slot = slot.wrapping_add(value);
        }
    }

    let mut out = [0u8; 32];
    for (index, word) in state.iter().enumerate() {
        out[index * 4..index * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}
