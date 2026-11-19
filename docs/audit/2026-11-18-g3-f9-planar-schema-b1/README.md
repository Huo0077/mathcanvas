# G3-F9 Block B1：真实 DS 参数失败驱动的平面工具契约修正（非付费）

- **真实证据**：[36题审计](../2026-11-18-g3-f9-native-36-10x/README.md)中12题首次 `missing_required_parameter`，部分曲线/点/线后又遇到 `undeclared_entity_ref`；由于原始动作参数未保存，不得倒填这些题具体错误字段，也不能以本次修复宣称12题成功。
- **原缺口**：`apps/web/src/agent/dsActionTools.ts` 只为三项立体工具公开封闭字段，其余包括 `construct_conic`、`construct_point`、`construct_line`、`query_measurement`、`query_constraint_status` 都是 `additionalProperties:true` 的宽松对象；曲线/直线说明还暗示支持方程形式，而当前执行分支并未实现通用方程。曲线 `conicType` 省略或未知时曾默认椭圆，容易悄悄产生错误图像。
- **B1 修正**：上述五项提供 `additionalProperties:false` 的模型可见字段；明确 `construct_conic` 的 ellipse/hyperbola 使用正的 `radiusX/radiusY`，parabola 使用非零 `focalParameter`；`construct_line` 仅从现有点 `from/to` 构造，不再宣传不支持的方程参数；点与测量显式列出合法字段。未知/缺失曲线类型现在返回 `unsupported_conic_kind` / `missing_required_parameter`，不再默认椭圆。
- **RED/GREEN**：模型可见参数测试先发现 `additionalProperties:true`；内核反例先发现 `conicType:circle` 被悄然当成椭圆。完成修改后合法椭圆/双曲线/抛物线、命名点、线与真实距离读数正例以及缺参数/错误引用反例通过。定向 Vitest **128/128**、TypeScript 类型检查通过、lint **0 errors / 34 既有 warnings**。文档检查 22/22、现有 GK-S09 同候选浏览器防回归 1/1；没有发送新的 DS 请求。
- **尚未完成**：非 strict 供应商工具 schema 的真实接受度未在新源码上验证；仍有16项工具维持自由对象；`construct_point` 的坐标/比例替代字段、所有曲线解析别名、实体目录、同批与跨分支引用、终止策略、13题原图和原生受控交付是后续 B2/C/D。严格 schema 属 DeepSeek Beta，未擅自开启；没有新一轮真实 DS 成功率。
