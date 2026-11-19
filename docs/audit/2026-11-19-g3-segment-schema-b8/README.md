# G3-F9 B8：线段两端点参数与真实构图对齐

日期：2026-11-19；0 新增 DeepSeek 请求。本区块接 B7 的模型工具参数收敛；历史36题的原始工具参数未保存，因此不能断言某道旧题的线段失败由本缺口造成。

## 可复现根因

模型可见 `construct_segment` 之前是任意对象，执行器实际仅消费命名端点 `from/to` 与 `id/output/label/scopeId/stateId/branchId`。缺 `to` 时旧回执笼统为 `undeclared_entity_ref`，而给两个合法端点夹带 `radius` 等字段旧逻辑仍会悄悄构图，让模型误以为多余几何约束已生效。

## 最小修复

工具公开 schema 指定 `from/to` 必填且封闭字段，只使用已物化点；执行时先拒绝无法执行的额外字段 `repairable/invalid_schema`，缺端点明确 `repairable/missing_required_parameter`。2D/3D 两端点构图仍按原内核执行，不把声明点冒充物化点，不自动推测端点坐标。B8 新测试先因公开 schema 仍是 `additionalProperties:true` RED；改后 GREEN，并核验缺端点、附加字段零写入、2D/3D 正例。最终 `npm.cmd run typecheck` 通过；`npm.cmd run test:docs -- --maxWorkers=1` 8文件/22用例通过；动作/规划/来源定向5文件/158用例通过；`npm.cmd run lint` 0错误/34条既有警告；`git diff --check` 通过。

## 仍未达标

其它自由对象工具、不同线段合法退化条件、模型可见缺字段回执和真实同版 DS 调用仍待验证。旧36合同1通过/26失败/9未测、原生确认交付未测不变；新版无图36计划仍 `runnable=false`，不得发起付费 DS 实测。下一次实测须修复/准入完成后另获新费用和每题请求上限。
