# G3-F9 C0：图题缺图时的原生请求前置闸（零新增 DS 请求）

- **实测依据**：[冻结36题原生审计](../2026-11-18-g3-f9-native-36-10x/README.md)记录13题标为 `text_with_figure_reference`，却只传了文字；其中12题请求澄清。旧版把这些调用计为模型已调用，但不能称完整图文真题实测。这些历史数据保持原值。
- **根因核对**：`runFrozenDsCaseTraced` 的输入保留了 `confirmedFigureRefs`，而 `buildPlanRequestForPublicInput` 实际仅把 `prompt` 放到 `userMessage`，图像字节没有进入请求；`ModelChatMessage.images`/原生 Rust image_url 通道存在，但此路径并未接入。
- **本区块行为**：在这个带独立题目合同的原生 DS 冻结题入口，若 `inputMode=text_with_figure_reference`，**在解析 profile 和发起网络之前**标记 `firstFailure: contract/input_figure_missing`，返回 `modelInvoked=false`、`contractStatus=incomplete`、空候选与渲染/提交 pending；不消耗请求。单传 `confirmedFigureRefs` 不能绕过，因为它不是图像内容。纯文字题（如 GK-S09）保持原有路径。
- **RED/GREEN**：测试首先看到 GK-S01、GK-S02、JT-S07 仍会走到原生 profile 解析；修复后整套13/13图题零请求返回缺图状态，伪确认引用也不能误放行。定向 Vitest 116/116，TypeScript 类型检查通过，文档检查 22/22；没有将零费测试计作真题成绩。未接入题图/图像 tokens 预算/vision 能力核验；不可称“图题能力已修好”。
- **下一步**：逐题获得可追溯原题图 SHA-256、人工确认区域和版权/使用许可，再将有内容的图像以现有 message.images → Rust image_url 通道传到当前修订已验证 vision 的 profile，并做请求体/图像成本门禁。真实图文 DS 复测仍须新的付费授权；本次不追加付费。
