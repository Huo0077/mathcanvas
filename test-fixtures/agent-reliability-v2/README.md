# Agent 可靠性评测 v2（开发集与保留集分离）

> **本目录只有哈希与题号元信息，不含参考答案。** 题面正文按授权规则另存；参考解与关键步骤只对评分进程可见（不进 `manifest.json`，也不进任何提示词）。

## 两层数据

- `manifest.json`：**冻结契约**。包含 `corpusHash`、`scorerVersion`、`buildId`、`binarySha256`、`revision`、`profileRevision`、`flagSnapshot`、`budgetSnapshot`、`entryTrack`、`frozenMaterialHashes` 与逐题 `{ id, split, family, materialHash }`。
- 题目内容（`question`）只写题干；**任何** `参考答案` / `关键步骤` / `reference` 字样都会让校验器拒绝（`reference_in_prompt`）。

## 校验器拒绝的六种情况（`scripts/agent-reliability-eval/manifest.cjs`）

1. 同一 `materialHash` 同时出现在 dev 与 holdout（`cross_split material`）；
2. 同一材料在同一 split 里出现两次（`duplicate material`）；
3. 题号重复（`duplicate question number`）；
4. 冻结后材料被改（`material_changed_after_freeze`）或冻结题号缺失；
5. 需要配图的题没有附件（`image_without_attachment`）；
6. 未知 `entryTrack`、缺少 `corpusHash` / `buildId` 等身份字段。

## 阶梯运行（`production.eval.mjs`）

默认**只做离线规划**：`MATHCANVAS_REAL_EXAM_LIVE` 未设为 `1` 时，所有阶梯 `runs = 0`。
真实运行还必须 `MATHCANVAS_EXPECTED_BUILD` 与 manifest 的 `buildId` 完全一致；不一致直接拒绝（`build_identity_mismatch`）。

| 阶段 | 题量 | 说明 |
|---|---:|---|
| offline-regression | 0 | 不花 API，跑离线/单元回归 |
| approved-smoke | 10 | 需单独批准模型与总预算 |
| three-rounds | 50 | 三轮分别报告，不取最好值 |
| validation | 100 | 与盲测不重叠 |
| blind | 500 | 正式主结果；重复两轮仍是 500 道不同题 |

`blind-*` 在仓库内只保留哈希（`blind: false` 语义与 `dataset.cjs` 一致）：**发布在仓库里的题不算盲测**。

## 边界

- 本目录不包含真实 500 题语料，也没有运行过任何付费批次；上面的校验与阶梯规划只证明**闸门存在**，不证明准确率。
- 原始题图按授权处理，不默认入库；`attachments` 只写引用与哈希。
