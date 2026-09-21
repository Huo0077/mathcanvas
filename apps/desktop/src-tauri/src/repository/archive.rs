//! **`.mcanvas` 的容器**（Task 1.6 Step 5 的底层那一半）。
//!
//! ## 为什么是 zip，而且是自己写的那一小块
//!
//! 计划要求"validate relative paths, hashes, schema versions, attachment limits" ——
//! 这些判据都要落在一个**容器**上。选 zip 的公开理由：用户拿 7-Zip / 资源管理器就能
//! 打开看一眼（一个打包格式如果只有我们自己的代码能读，遇到问题时就没法自查）。
//!
//! 自己写而不是引一个 zip 库：这里只用到 **stored（不压缩）** 一种方式，
//! 而要读的字节结构就是"本地头 + 数据 + 中央目录"。引一个库会带进压缩、加密、
//! ZIP64、时间戳策略等一大堆我们用不到、却要跟着升级与审计的东西。
//! **代价是必须自己把 CRC 与偏移校验做对** —— 所以这个文件的用例比实现长。
//!
//! ## 只读我们写出来的形状
//!
//! 这个读取器**刻意不是**通用 unzip：它只认 stored 条目、要求中央目录完整、
//! 拒绝加密、拒绝 ZIP64、拒绝任何指向容器外的名字。一个打包格式的读取器
//! 天生是"处理不可信输入"的地方，所以这里的判据是**默认拒绝**。

use std::collections::BTreeMap;

/// 容器层的错误。**每一种都能被翻译成一句给用户看的话**。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArchiveError {
    /// 不是 zip（签名不对）。
    NotAnArchive,
    /// 结构坏了（偏移越界、字段对不上）。
    Malformed { detail: String },
    /// 压缩过的条目：我们只写 stored，也只读 stored。
    Compressed { name: String },
    /// 加密过的条目。
    Encrypted { name: String },
    /// 条目名指向容器之外（`../`、绝对路径、盘符、反斜杠）。
    UnsafeName { name: String },
    /// CRC 对不上 —— 内容坏了。
    Corrupt { name: String, expected: u32, actual: u32 },
    /// 条目太多或太大。
    TooLarge { detail: String },
}

impl std::fmt::Display for ArchiveError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ArchiveError::NotAnArchive => write!(formatter, "this file is not a .mcanvas package (it is not a zip archive)"),
            ArchiveError::Malformed { detail } => write!(formatter, "the package is malformed: {detail}"),
            ArchiveError::Compressed { name } => write!(formatter, "the package entry `{name}` is compressed; only stored entries are supported"),
            ArchiveError::Encrypted { name } => write!(formatter, "the package entry `{name}` is encrypted, which a .mcanvas package never is"),
            ArchiveError::UnsafeName { name } => write!(formatter, "the package entry `{name}` points outside the package"),
            ArchiveError::Corrupt { name, expected, actual } => write!(formatter, "the package entry `{name}` is corrupt (crc {actual:08x}, expected {expected:08x})"),
            ArchiveError::TooLarge { detail } => write!(formatter, "{detail}"),
        }
    }
}

impl std::error::Error for ArchiveError {}

/// 一个条目的上限（单个文件 64 MiB）。
pub const MAX_ENTRY_BYTES: usize = 64 * 1024 * 1024;
/// 条目的数量上限。一个画布文档包不该有几千个文件。
pub const MAX_ENTRIES: usize = 4096;

// ---------------------------------------------------------------- CRC-32

/// CRC-32（IEEE 802.3，zip 用的那个）。
///
/// 逐位算而不是查表：一份 64 MiB 的附件用查表也就快几倍，而**进程启动时建那张表**
/// 本身就要分配 1 KiB —— 对一个"偶尔打一次包"的功能来说，简单比快重要。
pub fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            // 反射多项式 0xEDB88320。
            let mask = if crc & 1 == 1 { 0xEDB8_8320 } else { 0 };
            crc = (crc >> 1) ^ mask;
        }
    }
    !crc
}

// ---------------------------------------------------------------- 写

/// 一个要写进容器的条目。`name` 是**容器内的相对路径**（`/` 分隔）。
pub struct Entry {
    pub name: String,
    pub bytes: Vec<u8>,
}

/// 名字是否安全（**默认拒绝**）。
///
/// 这四条各自对应一种真实的攻击/事故形状：
/// - `..`：打包一个指向容器外的条目，解包时就会写到别处；
/// - 绝对路径与盘符（`/etc/x`、`C:\x`）：同上，而且更难看出来；
/// - 反斜杠：Windows 上它也是分隔符，而 zip 规范要求 `/` —— 允许它会让
///   同一个名字在两种平台上解析成不同路径；
/// - 空名字 / 结尾是 `/`：那是目录条目，这个包里没有目录。
pub fn is_safe_name(name: &str) -> bool {
    if name.is_empty() || name.ends_with('/') || name.contains('\\') {
        return false;
    }
    if name.starts_with('/') {
        return false;
    }
    // 盘符（`C:`）与任何协议前缀（`http:`）都拒。
    if name.len() >= 2 && name.as_bytes()[1] == b':' {
        return false;
    }
    name.split('/').all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

/// **写出一个容器**。条目按名字排序（同样的输入给同样的字节 —— 让"同一份文档两次导出"
/// 可以被逐字节比较）。
pub fn write(entries: &[Entry]) -> Result<Vec<u8>, ArchiveError> {
    if entries.len() > MAX_ENTRIES {
        return Err(ArchiveError::TooLarge { detail: format!("a package may hold at most {MAX_ENTRIES} entries") });
    }
    let mut sorted: Vec<&Entry> = entries.iter().collect();
    sorted.sort_by(|left, right| left.name.cmp(&right.name));

    let mut out: Vec<u8> = Vec::new();
    // (名字, crc, 大小, 本地头偏移)
    let mut directory: Vec<(String, u32, u32, u32)> = Vec::new();

    for entry in sorted {
        if !is_safe_name(&entry.name) {
            return Err(ArchiveError::UnsafeName { name: entry.name.clone() });
        }
        if entry.bytes.len() > MAX_ENTRY_BYTES {
            return Err(ArchiveError::TooLarge { detail: format!("`{}` is {} bytes; the limit is {MAX_ENTRY_BYTES}", entry.name, entry.bytes.len()) });
        }
        let crc = crc32(&entry.bytes);
        let size = entry.bytes.len() as u32;
        let offset = out.len() as u32;
        let name = entry.name.as_bytes();

        // 本地文件头（签名 0x04034b50）。
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes()); // 需要的版本 2.0
        out.extend_from_slice(&0u16.to_le_bytes()); // 标志位：无（不加密、不流式）
        out.extend_from_slice(&0u16.to_le_bytes()); // 方式 0 = stored
        out.extend_from_slice(&0u16.to_le_bytes()); // 时间
        out.extend_from_slice(&0u16.to_le_bytes()); // 日期
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&size.to_le_bytes()); // 压缩后大小
        out.extend_from_slice(&size.to_le_bytes()); // 原始大小
        out.extend_from_slice(&(name.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // 扩展字段长度
        out.extend_from_slice(name);
        out.extend_from_slice(&entry.bytes);
        directory.push((entry.name.clone(), crc, size, offset));
    }

    // 中央目录（签名 0x02014b50）。
    let directory_offset = out.len() as u32;
    for (name, crc, size, offset) in &directory {
        let bytes = name.as_bytes();
        out.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes()); // 写它的版本
        out.extend_from_slice(&20u16.to_le_bytes()); // 读它需要的版本
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&size.to_le_bytes());
        out.extend_from_slice(&size.to_le_bytes());
        out.extend_from_slice(&(bytes.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // 扩展字段
        out.extend_from_slice(&0u16.to_le_bytes()); // 注释
        out.extend_from_slice(&0u16.to_le_bytes()); // 磁盘号
        out.extend_from_slice(&0u16.to_le_bytes()); // 内部属性
        out.extend_from_slice(&0u32.to_le_bytes()); // 外部属性
        out.extend_from_slice(&offset.to_le_bytes());
        out.extend_from_slice(bytes);
    }
    let directory_size = out.len() as u32 - directory_offset;

    // 中央目录结尾（签名 0x06054b50）。
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // 本磁盘
    out.extend_from_slice(&0u16.to_le_bytes()); // 中央目录所在磁盘
    out.extend_from_slice(&(directory.len() as u16).to_le_bytes());
    out.extend_from_slice(&(directory.len() as u16).to_le_bytes());
    out.extend_from_slice(&directory_size.to_le_bytes());
    out.extend_from_slice(&directory_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // 注释长度
    Ok(out)
}

// ---------------------------------------------------------------- 读

fn read_u16(bytes: &[u8], at: usize) -> Result<u16, ArchiveError> {
    let slice = bytes.get(at..at + 2).ok_or(ArchiveError::Malformed { detail: format!("a 16-bit field at {at} runs past the end") })?;
    Ok(u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_u32(bytes: &[u8], at: usize) -> Result<u32, ArchiveError> {
    let slice = bytes.get(at..at + 4).ok_or(ArchiveError::Malformed { detail: format!("a 32-bit field at {at} runs past the end") })?;
    Ok(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

/// **读一个容器**。返回 `名字 -> 字节`，按名字排序。
///
/// 从头往后走**中央目录**（不是从头扫本地头）：中央目录是权威的那一份，
/// 而"本地头说 A、中央目录说 B"这种包必须以中央目录为准 —— 否则同一个包在
/// 我们这里与在别的工具里能解出不同的内容。
pub fn read(bytes: &[u8]) -> Result<BTreeMap<String, Vec<u8>>, ArchiveError> {
    // 结尾记录在最后，但它前面可能有注释（我们不写注释，但别人写的包可能有）。
    let end = find_end_record(bytes).ok_or(ArchiveError::NotAnArchive)?;
    let count = read_u16(bytes, end + 10)? as usize;
    let directory_offset = read_u32(bytes, end + 16)? as usize;
    if count > MAX_ENTRIES {
        return Err(ArchiveError::TooLarge { detail: format!("a package may hold at most {MAX_ENTRIES} entries") });
    }

    let mut out = BTreeMap::new();
    let mut cursor = directory_offset;
    for _ in 0..count {
        if read_u32(bytes, cursor)? != 0x0201_4b50 {
            return Err(ArchiveError::Malformed { detail: format!("the central directory entry at {cursor} has the wrong signature") });
        }
        let flags = read_u16(bytes, cursor + 8)?;
        let method = read_u16(bytes, cursor + 10)?;
        let crc = read_u32(bytes, cursor + 16)?;
        let size = read_u32(bytes, cursor + 24)? as usize;
        let name_length = read_u16(bytes, cursor + 28)? as usize;
        let extra_length = read_u16(bytes, cursor + 30)? as usize;
        let comment_length = read_u16(bytes, cursor + 32)? as usize;
        let local_offset = read_u32(bytes, cursor + 42)? as usize;
        let name_bytes = bytes
            .get(cursor + 46..cursor + 46 + name_length)
            .ok_or(ArchiveError::Malformed { detail: "an entry name runs past the end".to_string() })?;
        let name = String::from_utf8_lossy(name_bytes).into_owned();

        if !is_safe_name(&name) {
            return Err(ArchiveError::UnsafeName { name });
        }
        if flags & 0x0001 != 0 {
            return Err(ArchiveError::Encrypted { name });
        }
        if method != 0 {
            return Err(ArchiveError::Compressed { name });
        }
        if size > MAX_ENTRY_BYTES {
            return Err(ArchiveError::TooLarge { detail: format!("`{name}` is {size} bytes; the limit is {MAX_ENTRY_BYTES}") });
        }

        // 本地头：名字与扩展字段的长度可能与中央目录不同，所以必须**按本地头**算数据起点。
        if read_u32(bytes, local_offset)? != 0x0403_4b50 {
            return Err(ArchiveError::Malformed { detail: format!("the local header for `{name}` has the wrong signature") });
        }
        let local_name_length = read_u16(bytes, local_offset + 26)? as usize;
        let local_extra_length = read_u16(bytes, local_offset + 28)? as usize;
        let data_start = local_offset + 30 + local_name_length + local_extra_length;
        let data = bytes
            .get(data_start..data_start + size)
            .ok_or(ArchiveError::Malformed { detail: format!("the data of `{name}` runs past the end") })?;
        let actual = crc32(data);
        if actual != crc {
            return Err(ArchiveError::Corrupt { name, expected: crc, actual });
        }
        out.insert(name, data.to_vec());
        cursor += 46 + name_length + extra_length + comment_length;
    }
    Ok(out)
}

/// 找中央目录结尾记录。**从后往前扫**，因为注释在最末尾（最长 65535 字节）。
fn find_end_record(bytes: &[u8]) -> Option<usize> {
    if bytes.len() < 22 {
        return None;
    }
    let earliest = bytes.len().saturating_sub(22 + 0xffff);
    let mut at = bytes.len() - 22;
    loop {
        if read_u32(bytes, at).ok() == Some(0x0605_4b50) {
            return Some(at);
        }
        if at == earliest {
            return None;
        }
        at -= 1;
    }
}
