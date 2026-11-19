# G3-F9 B7：实体声明不冒充点的实际构造

日期：2026-11-19；工作区块 B7；0 新增 DeepSeek 请求。

## 触发与根因

旧 36 题原生实测出现模型声明实体后仍未完成构图、参数缺失及引用失败等问题；原始失败回执**未保存具体参数**，所以本区块不能声称旧某道题正是此缺陷。代码可独立复现的接口矛盾是：`declare_entity` 的模型可见参数为 `{type:object, additionalProperties:true}`，执行器只读取 `id/kind/scopeId/stateId/branchId`，`{id:"P",kind:"point",x:2,y:3}` 会回报 accepted，却不物化坐标点。合法声明与真实作图是不同动作；静默吞掉坐标会误导下一轮工具规划。

## 修正范围与反例

- 仅该工具公开封闭参数形状：必填 `id`，可选 `kind/scopeId/stateId/branchId`，其它字段不宣称可用；说明明确“声明不画图，点须用 construct_point”。
- 同样的额外字段输入改为 `repairable/invalid_schema` 并提示使用构造工具；无引用目录污染和主画布写入。有效分支声明依旧 accepted，目录仅列为 `declaredOnly`；真正的 `construct_point` 之后才进入 `materializedPoints`。未给经验证的模型输入偷补默认坐标。
- RED：新测试先因公开参数仍为 `additionalProperties:true` 失败；GREEN：定向测试与模型规划/冻结运行器回归3文件151用例通过。完整验证：`npm.cmd run typecheck` 通过；`npm.cmd run test:docs -- --maxWorkers=1` 8文件/22用例通过；新旧动作/规划/来源定向5文件/157用例通过；`npm.cmd run lint` 0错误、34条既有警告；`git diff --check` 通过。首次全仓类型检查曾发现旧 solid-kind 测试对新 schema 联合类型取 `kind.enum` 的静态假设，已加属性收窄后重跑通过。

## 尚未解决/退出门槛

其它通用自由对象工具和具体缺字段码仍待逐族审查，旧实测合同 1通过/26失败/9未测不变；原生 DS 对新 schema 的接受率、候选截图和确认交付仍未实测。用户已将本轮题集改为无图 23+13，新来源清单 `runnable=false`；任何付费 DS 请求需新的整轮美元上限及每题请求上限批准。目标追求稳定真实作图，不以 schema 单测代替最终成功率。
