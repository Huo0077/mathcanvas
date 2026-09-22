# MathCanvas 增量几何内核与多会话 Agent 设计

日期：2026-09-21。

状态：**待用户审阅的设计提案，未开始实现**。

本方案采用用户确认的**增量演进**路线：保留现有 `dsl`、`scene-graph`、`geometry-kernel`、`agent-core` 和桌面代理边界，在其上补齐统一 Solid、拉伸式 Prism、Reactive DAG、多会话上下文、参数审计和欠定图形特值化。

## 1. 目标与原则

### 1.1 目标

1. 立体图元成为一等公民，斜棱柱由底面多边形和拉伸向量构造。
2. 三角形五心、内切圆、外接圆、球体和截面成为可重算的派生对象。
3. 动点通过参数绑定驱动所有下游对象，并支持轨迹与实时预览。
4. Agent 能输出覆盖平面、立体、圆锥曲线、动点、球体和派生对象的统一计划。
5. Agent 对参数遗漏进行审计和受控回填，对欠定题给出最简相容特值或澄清问题。
6. 多个独立对话拥有独立历史、摘要、事实和文档绑定，跨重启可恢复。

### 1.2 不变量

- 模型只能提出声明式计划，不能直接修改真实文档。
- 所有写入先进入隔离草稿，并经过校验与一次性用户确认。
- Solid 构造描述是真源，顶点、棱、面是确定性派生拓扑。
- 派生 evaluator 是纯函数，不写全局状态，不伪造缺失坐标。
- 当前文档事实优先于旧对话和模型旧输出。
- 未确认草稿不得进入长期会话记忆。
- 不输出或持久化 hidden chain-of-thought、密钥、候选文档全文和图像字节。

## 2. 当前代码接入边界

| 能力 | 现有入口 | 增量接入 |
| --- | --- | --- |
| DSL 类型与解析 | `packages/dsl/src/types.ts`、`schema.ts` | 扩展 Solid、派生和动态动作，不破坏旧类型 |
| 拓扑与动作 | `packages/scene-graph` | 增加 Solid 真源、ID 占用集、DAG 调度 |
| 几何算法 | `packages/geometry-kernel` | 增加 Prism、球体、五心、纯 evaluator |
| Agent 计划 | `packages/agent-core` | 扩展计划信封、参数审计、上下文构建 |
| Agent 运行 | `apps/web/src/agent/agentRunner.ts` | 固定 conversation/document/generation 绑定 |
| 对话 UI | `apps/web/src/agentStore.ts` | 保留 UI 投影，桌面端 SQLite 成为真源 |
| 桌面持久化 | `apps/desktop/src-tauri/src/repository` | 增加 conversations/messages/facts 迁移和 IPC |

## 3. 统一 Solid 与拉伸式 Prism

### 3.1 Solid 内核接口

```ts
interface SolidPolyhedron {
  id: string
  kind: "prism" | "tetrahedron" | "box" | "polyhedron"
  vertices: readonly Vector3[]
  edges: readonly SolidEdge[]
  faces: readonly SolidFace[]
  source: SolidConstruction
}
```

`SolidPolyhedron` 只表达几何事实，不承载 UI 样式、选中态、授权或 Agent 状态。

派生算法统一返回：

```ts
type DerivedSolidResult<T> =
  | { status: "exact"; value: T }
  | { status: "undefined"; reason: string }
  | { status: "degenerate"; reason: string }
  | { status: "approximate"; value: T; residual: number }
```

### 3.2 Prism DSL

```json
{
  "type": "solid",
  "kind": "prism",
  "base": {
    "plane": {
      "origin": { "x": 0, "y": 0, "z": 0 },
      "normal": { "x": 0, "y": 0, "z": 1 }
    },
    "polygon": [
      { "x": 0, "y": 0 },
      { "x": 4, "y": 0 },
      { "x": 5, "y": 2 },
      { "x": 1, "y": 2 }
    ]
  },
  "vector": { "x": 1, "y": 0.5, "z": 3 }
}
```

语义约束：多边形至少三个点、无自交、底面点共面、向量有限且非零。直棱柱是向量平行底面法向的特例，斜棱柱直接使用水平偏移向量。

### 3.3 拓扑构造

给定有序底面顶点 `B0...Bn-1` 和向量 `v`：

```text
Ti = Bi + v
底面 = [B0 ... Bn-1]
顶面 = [Tn-1 ... T0]
侧面 i = [Bi, B(i+1), T(i+1), Ti]
```

每个侧面天然共面且为平行四边形。拓扑由纯函数 `buildPrismTopology(basePolygon, vector)` 生成，并按输入签名缓存。

Solid ID 使用全局占用集；子对象采用 `solidId:v0`、`solidId:e0`、`solidId:f0` 的确定性命名。用户级引用指向 Solid，不依赖临时子对象 ID。

### 3.4 球体与截面

- 四面体外接球：解等距方程组。
- 长方体外接球：包围盒中心和体对角线半径。
- 一般多面体外接球：校验所有顶点残差，不满足时返回 `undefined`。
- 四面体内切球：解到四个面的等距方程。
- 一般凸多面体内切球：求解最大内接球约束，不满足时返回 `undefined`。
- 截面：遍历 Solid 棱与平面求交、容差去重、投影到截面基底、沿拓扑邻接串联边界；返回 `none/point/segment/polygon`。

## 4. Reactive DAG

### 4.1 节点类型

```ts
type ReactiveNode =
  | SourceNode
  | ParameterNode
  | ConstraintNode
  | DerivedNode
  | MeasurementNode
  | LocusNode
```

参数是独立真源。点坐标由 `parameter -> constraint evaluator -> position` 得到，不直接作为动点唯一状态。

支持的约束包括：线段/直线/棱上的一维参数、圆周角度、面上的 `u,v`、实体内部的 `u,v,w`。

### 4.2 增量求值

```text
参数变化
  -> 反向依赖闭包
  -> 拓扑排序
  -> 纯 evaluator
  -> 临时场景预览
  -> 抬手后一次性提交
```

每个 evaluator 必须拒绝 NaN、无穷、缺失来源和退化输入。检测到环时返回 `dependency_cycle`，不得使用旧缓存伪装正常结果。

### 4.3 三角形中心与圆

支持 `centroid`、`incenter`、`circumcenter`、`orthocenter`、`excenter`。

```text
G = (A+B+C)/3
I = (aA+bB+cC)/(a+b+c)
r_in = 2*area/(a+b+c)
H = A+B+C-2O
```

外心在三角形自身二维基底中解垂直平分线。所有中心、半径和圆均作为 DAG 下游节点。

### 4.4 轨迹

区分持久化 `Locus` 和交互临时 `Trace`。Locus 使用自适应采样，Trace 不产生历史节点；用户抬手后可选择将 Trace 保留为 Locus。

## 5. 多会话上下文

### 5.1 绑定规则

一个会话绑定一个 `projectId`、`documentId` 和 `workspace`。当前前端已有 `localStorage` 对话 UI，但桌面端 SQLite 才是持久化真源；浏览器 fallback 只用于预览和测试。

### 5.2 SQLite 表

新增迁移版本 3：

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  workspace TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  summary_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  content_json TEXT NOT NULL,
  run_id TEXT,
  document_generation INTEGER,
  token_estimate INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(conversation_id, sequence)
);

CREATE TABLE conversation_facts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(conversation_id, key)
);
```

`conversation_facts.status` 为 `confirmed/stale/retracted`。只有用户明确条件、已提交文档、用户确认草稿和通过内核校验的结果能进入 `confirmed`。

### 5.3 上下文预算

每次规划按以下顺序组装：系统规则、文档绑定、已确认事实、摘要、最近消息、当前场景观察、待确认草稿、技能和动作、当前用户请求。

当前场景优先于旧消息；未确认草稿不能进入长期摘要。初始预算建议为：场景 20%、确认事实 15%、摘要 20%、最近消息 35%、当前请求和安全余量 10%。

长对话摘要使用结构化 JSON，记录目标、确认事实、已创建对象、未解决问题和用户偏好，不保存 hidden chain-of-thought。

### 5.4 并发与切换

每个运行固定 `runId/conversationId/documentId/documentGeneration`。切换会话不取消旧运行；旧事件仍写回原会话，不能写入新会话。确认提交时检查会话、文档、generation 和 preview hash，任意不匹配返回 stale 错误。

## 6. DSL 与 Agent 编译

### 6.1 计划信封

```json
{
  "schemaVersion": 2,
  "kind": "plan",
  "goal": "...",
  "factIds": [],
  "assumptions": [],
  "actions": []
}
```

动作分为平面、立体、派生、动态和圆锥曲线五组。新对象使用 `{scope:"draft",alias}`，既有对象使用 `{scope:"scene",ref:{documentId,entityId}}`。禁止裸 ID。

### 6.2 六层编译

```text
传输解析
  -> 字段审计
  -> 引用解析
  -> 参数补全
  -> 几何语义校验
  -> Scene Graph 动作编译
```

动作注册表同时提供动作名、字段类型、必填性、默认策略和枚举值。Schema 不重复实现几何语义；语义校验只保留在确定性编译器中。

### 6.3 默认策略

缺失字段按 `safe_default/infer_from_facts/ask_user/reject` 分类。安全回填必须进入 `assumptions`，不能静默发生。

欠定选择优先级：满足显式约束、保持非退化、避免特殊对称、使用小整数、最小化复杂度。

默认特值：任意三角形 `A(1,3),B(0,0),C(4,0)`；未定斜率 `k=0`；普通动点 `t=0.4`；未定立体底跨 `4`、高度 `3`。若问题要求“任意”“恒定”“定值”，必须保留符号参数，不能特值化成单点。

## 7. 生产级 Agent 规则

Agent 必须：

- 只输出 PlanEnvelope JSON；
- 不输出 hidden chain-of-thought；
- 不伪造未提交成功；
- 不跨 conversation/document 引用对象；
- 不把散面拼成 Prism；
- 不把派生结果降级为自由对象；
- 对参数遗漏执行一次受控修复；
- 无安全默认时返回 clarification；
- 在 `assumptions` 中列出所有特值化选择；
- 将模型失败、语义失败、几何退化和用户取消区分开。

## 8. 代表性题目验收

### 8.1 斜四棱柱截面

输入：底面为边长 2、角 60° 的菱形，侧棱向量 `(1,0,4)`，E/M/N 为指定中点，过 E/M/N 作截面，P 在截面边界运动。

必须生成：`solid.create_prism`、三个中点约束、`derived.create_section`、面界动点和可选 Locus。中点参数为 `0.5`，P 未指定位置时才使用 `0.4`。

验收：四个侧面共面平行四边形；截面闭合；P 始终在边界；Solid 平移时所有对象跟随；一次拖动只产生一个撤销记录。

### 8.2 椭圆切线定值

输入：椭圆 `x²/9+y²/4=1`，任意点 P 处切线与轴交于 A/B，验证 `9/OA²+4/OB²=1`。

必须保留符号参数 `theta`，生成椭圆、动态点、切线、轴交点和不变量表达式。可用采样验证，但不能把数值采样说成形式证明。

验收：P 变化时切线和 A/B 实时更新；表达式保持 1；无法符号证明时明确标记为数值验证。

## 9. 实施切片与门禁

1. 会话持久化：SQLite、IPC、上下文注入、跨重启和会话隔离。
2. Solid/Prism：构造、拓扑、ID、截面和球体状态。
3. Reactive DAG：参数、约束、五心、圆、轨迹和环检测。
4. DSL 编译：动作注册表、参数审计、默认策略和修复循环。
5. 真实题目：两道代表题和多轮对话回归。

每个切片必须同时提供：纯内核单测、DSL 往返测试、Agent 编译测试、浏览器端回归和必要的真实窗口验证。

最低门禁：

- 非空文档中同类对象 ID 不重复；
- `undefined` 与 JSON 语义一致；
- 动点变化只重算下游闭包；
- 删除源对象不产生伪坐标；
- 会话之间不串消息、事实或对象引用；
- Agent 确认前真实文档不变；
- 失败时不伪造 completed；
- 真实 provider 请求与本地计划使用同一 PlanEnvelope 校验。

## 10. 非目标与风险

- 首阶段不实现通用自动证明器。
- 不将所有欠定问题强行“证明”为定值；无法证明时必须标记数值验证。
- 不允许模型直接执行任意工具、脚本、SQL 或网络请求。
- 一般多面体的外接球/内切球不存在时返回明确状态，不生成近似冒充精确结果。
- 摘要模型不能直接升级确认事实，事实必须经过用户或内核证据确认。

该文档是实现前规格，不代表上述能力已经落地。
