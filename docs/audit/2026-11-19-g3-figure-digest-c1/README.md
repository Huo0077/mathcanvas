# G3-F9 C1：题图阅读确认绑定实际 PNG 字节

日期：2026-11-19。范围：非付费修复；不是36题真实 DeepSeek 新实验。

## 可重现缺口与因果

产品会将用户输入统一转码为 PNG 后交给独立视觉阅读器；旧 `computeReadingRevision` 仅依据识别文本与观察、题面计算。如果两份不同图恰好得到相同文本，旧审核确认可以复用，甚至在文本载荷中无法追溯实际阅读图像。`apps/desktop/src-tauri/src/commands/providers.rs` 还明确拒绝图片和工具同请求；原规划所写的同请求图文动作路线不可直接实施。

## 本区块动作与核验

- 组件对已编码 PNG 的**真实字节**计算有序 SHA-256；阅读 revision 纳入该数组，审阅 evidence 脱敏附带 digest，不存 base64。
- 服务层对 1–2 个小写 64 位 SHA-256 做格式限制；同 OCR/题面仅换 PNG 哈希，旧确认观察被剥离。旧未携带哈希的调用仍保持兼容，但不构成图像来源证明。
- RED：组件测试在修改实现前收到 `imageHashes: undefined`，与真实编码 PNG 的 digest 不符；服务层换图 revision 测试在改实现前失败。GREEN：组件 + 审核门禁定向测试 2 文件 / 5 用例通过；进一步定向测试 3 文件 / 11 用例通过（不存在的可选文件名不计入）。`npm.cmd run typecheck` 通过；`npm.cmd run test:docs -- --maxWorkers=1` 8 文件 / 22 用例通过；`npm.cmd run lint` 退出码 0，仍有 34 条已有 unused-vars 警告（包含其他 worktree），不能称零警告；`git diff --check` 通过。
- 原始上传源文件 SHA、合法来源、逐区域人工核对、vision profile 与真实图题请求均**未完成**。哈希仅证明在当前 UI 路径中审阅元信息对应某组编码字节，不证明图像是真题，也不能阻止恶意构造文本字段。不能提升旧36题合同 1/26/9，也不能提升原生交付未测状态。

## 后续硬门槛

C2 收集逐题原图及来源/原始 SHA；C3 做独立 Vision 阅读→人工区域核对→文本动作，两阶段均计费；C4 原生 runner 逐题接线。任何联合 vision+tools 请求须另获供应商与原生探针证据、预算授权、适配器 RED，不能简单删除 Rust 安全闸。
