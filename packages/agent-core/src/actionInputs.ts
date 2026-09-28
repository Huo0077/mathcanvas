import { type ParseError } from "./contracts"
import { updatableInputFields } from "@draw/scene-graph"
import { ACTIONS, CONIC_KINDS, SOLID_TEMPLATES, declaredFieldKind, type ActionSpec, type ActionId } from "./actionRegistry"
import { boundedString, fail, finiteNumber, isPlainObject, optionalFiniteNumber, readPoint2, readScopedReference, readVector3, rejectUnknownFields } from "./schemaReaders"

/**
 * **逐个动作的 inputs 校验**（从 `schemas.ts` 拆出，评审方案 2）。
 *
 * 这是整个校验层里最大的一块：每个动作允许哪些字段、哪些必填、默认值怎么填、引用的形状对不对，
 * 全在这一个 switch 里。它读的是 `actionRegistry` 那张表、用的是 `schemaReaders` 那把尺子，
 * 自己**不定义**任何规则 —— 所以它能被单独读、单独测（`schemas.test.ts` 就是按动作逐条问它的）。
 */

const UPDATABLE_INPUT_FIELDS = updatableInputFields()
/** 平面里的一个坐标：`{x,y,z}` 与 `[x,y,z]` **两种写法都收**（模型两种都会写）。 */
function planeVector(value: unknown, path: string, errors: ParseError[]): { x: number; y: number; z: number } | null {
  if (Array.isArray(value) && value.length === 3) return readVector3({ x: value[0], y: value[1], z: value[2] }, path, errors)
  return readVector3(value, path, errors)
}

/**
 * **把截面平面收成 `{normal, constant}`**（单位法向 + 常数）。
 *
 * ## 为什么必须有这一步（2026-09-26 用户现场）
 *
 * `section.create` 的登记项把 `plane` 写成可选、默认策略是 `ask_user`，而那句默认问题**明确承诺**了
 * 两种写法："给法向与常数，**或者说明它过哪三个点**"。可这一层原先**没有 `section.create` 分支** ——
 * `plane` 原样透传，于是"过三个点"（"把正方体沿对角面剖开"最自然的写法）一路走到**文档校验器**
 * 才被拒（`section plane is invalid`），而且报的是**动作级**路径：那条"一次性修复"因此改不动它。
 *
 * 三种写法都在这里收成一种：规范形（法向 + 常数）、**过三点**、点 + 法向。
 *
 * ## 一处最容易写错的地方
 *
 * 法向归一化时，**常数必须同步缩放**：`n·x + c = 0` 两边同除 `|n|`，得到单位法向与 `c/|n|`。
 * 只把法向变成单位向量、常数不动，平面就被换掉了（在立方体上正好是"切歪"）。
 */
function normalizeSectionPlane(value: unknown, path: string, errors: ParseError[]): { normal: { x: number; y: number; z: number }; constant: number } | null {
  if (!isPlainObject(value)) {
    errors.push(fail("invalid_plane", path, "expected an object: {normal, constant} / {points:[…3]} / {point, normal}"))
    return null
  }
  const cross = (first: { x: number; y: number; z: number }, second: { x: number; y: number; z: number }) => ({
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x
  })
  const unitOf = (raw: { x: number; y: number; z: number }, where: string) => {
    const length = Math.hypot(raw.x, raw.y, raw.z)
    if (!(length > 1e-9)) {
      errors.push(fail("degenerate_plane", where, "the normal must not be zero"))
      return null
    }
    return { unit: { x: raw.x / length, y: raw.y / length, z: raw.z / length }, length }
  }

  // `points` 与 `throughPoints` 是同一种写法的两个名字，报错路径要跟着**用户写的那一个**走。
  const pointsField = Array.isArray(value.points) ? "points" : Array.isArray(value.throughPoints) ? "throughPoints" : null
  const points = pointsField === null ? null : (value[pointsField] as unknown[])
  if (points) {
    if (points.length !== 3) {
      errors.push(fail("invalid_plane", `${path}.${pointsField}`, "expected exactly three points"))
      return null
    }
    const [first, second, third] = points.map((point, index) => planeVector(point, `${path}.${pointsField}[${index}]`, errors))
    if (!first || !second || !third) return null
    const normalized = unitOf(cross({ x: second.x - first.x, y: second.y - first.y, z: second.z - first.z }, { x: third.x - first.x, y: third.y - first.y, z: third.z - first.z }), path)
    if (!normalized) return null
    const { unit } = normalized
    return { normal: unit, constant: -(unit.x * first.x + unit.y * first.y + unit.z * first.z) }
  }

  const raw = planeVector(value.normal, `${path}.normal`, errors)
  if (!raw) return null
  const normalized = unitOf(raw, `${path}.normal`)
  if (!normalized) return null
  const { unit, length } = normalized

  const anchor = value.point ?? value.origin
  if (anchor !== undefined) {
    const on = planeVector(anchor, `${path}.point`, errors)
    if (!on) return null
    return { normal: unit, constant: -(unit.x * on.x + unit.y * on.y + unit.z * on.z) }
  }

  const constant = finiteNumber(value.constant, `${path}.constant`, errors)
  if (constant === null) return null
  // 归一化法向 → 常数同步缩放（见上面那段说明）。
  return { normal: unit, constant: constant / length }
}

/**
 * **按登记的种类读一个字段**（Phase 1：字段形状只有登记表一份真源）。
 *
 * `default` 分支过去把字段**原样透传**，于是"登记了 `radius` 是数字"这句话在解析层没有任何约束 ——
 * 模型给 `radius: "big"` 会一路走到动作编译器才炸。这里按 `declaredFieldKind` 逐字段读一遍，
 * 形状不对就**在该字段的路径上**报错（那条一次性修复因此够得到它）。
 *
 * 三种情况返回 `undefined`（= "这里不管"）：
 * - 结构族（`plane` / `tangentAnchor` / `scopedRef` / `idList` / `updatablePatch`）由各自的分支负责；
 * - 字段没给（缺字段走审计的默认策略，是合法路径）；
 * - 种类表认不出（调用方按宽容处理；"认不出"由 `actionFieldParity.test.ts` 在测试期挡住）。
 */
function readByDeclaredKind(spec: ActionSpec, field: string, provided: unknown, path: string, errors: ParseError[]): unknown {
  switch (declaredFieldKind(spec, field)) {
    case "string": return boundedString(provided, path, errors) ?? undefined
    case "number": return finiteNumber(provided, path, errors) ?? undefined
    case "boolean": {
      if (typeof provided !== "boolean") {
        errors.push(fail("invalid_type", path, "expected a boolean"))
        return undefined
      }
      return provided
    }
    case "integer": {
      if (typeof provided !== "number" || !Number.isFinite(provided) || !Number.isInteger(provided)) {
        errors.push(fail("invalid_type", path, "expected an integer"))
        return undefined
      }
      return provided
    }
    case "point": return readPoint2(provided, path, errors) ?? undefined
    case "vector": return readVector3(provided, path, errors) ?? undefined
    case "pointList": {
      if (!Array.isArray(provided)) {
        errors.push(fail("invalid_type", path, "expected an array of points"))
        return undefined
      }
      const points = provided.map((entry, index) => readPoint2(entry, `${path}[${index}]`, errors))
      if (points.some((entry) => entry === null)) return undefined
      return points
    }
    case "vectorList": {
      if (!Array.isArray(provided)) {
        errors.push(fail("invalid_type", path, "expected an array of spatial points"))
        return undefined
      }
      const points = provided.map((entry, index) => readVector3(entry, `${path}[${index}]`, errors))
      if (points.some((entry) => entry === null)) return undefined
      return points
    }
    case "vertexList": {
      if (!Array.isArray(provided)) {
        errors.push(fail("invalid_type", path, "expected an array of spatial points"))
        return undefined
      }
      const points = provided.map((entry, index) => readVector3(entry, `${path}[${index}]`, errors))
      if (points.some((entry) => entry === null)) return undefined
      return points
    }
    case "faceRings": {
      if (!Array.isArray(provided)) {
        errors.push(fail("invalid_type", path, "expected an array of face rings"))
        return undefined
      }
      for (const [ringIndex, ring] of provided.entries()) {
        if (!Array.isArray(ring)) {
          errors.push(fail("invalid_type", `${path}[${ringIndex}]`, "expected an array of vertex indexes"))
          return undefined
        }
        for (const [cornerIndex, corner] of ring.entries()) {
          if (!Number.isInteger(corner)) {
            errors.push(fail("invalid_type", `${path}[${ringIndex}][${cornerIndex}]`, "expected an integer index"))
            return undefined
          }
        }
      }
      return provided
    }
    default: return undefined
  }
}

/**
 * **可选的 `label`**：给了就必须是字符串。
 *
 * 这条改了原来的行为 —— 过去六个显式分支写的是 `if (typeof value.label === "string")`，
 * 也就是**形状不对时静默丢掉**。同一个模型错误（`label: 42`）在显式分支上被吞掉、
 * 在 `default` 分支上却被拒，属于最不该有的那种不一致：模型从"标签没生效"学不到任何东西。
 * 现在两处都走这一个函数，拒绝时报到 `inputs.label` 上。
 */
function boundLabel(value: unknown, path: string, errors: ParseError[]): string | undefined {
  if (value === undefined) return undefined
  return boundedString(value, path, errors) ?? undefined
}

export function parseActionInputs(actionId: ActionId, value: unknown, path: string, errors: ParseError[]): Record<string, unknown> | null {
  if (!isPlainObject(value)) {
    errors.push(fail("invalid_type", path, "expected an object"))
    return null
  }
  const spec: ActionSpec = ACTIONS[actionId]
  rejectUnknownFields(value, spec.inputFields, path, errors)

  // 新对象由 `inputs.alias` 定义（设计规格 L932）。**要把 alias 带进解析结果**，
  // 否则下游拿到的是一个"看起来合法但没有别名"的 inputs。
  const alias = spec.requiresAlias ? boundedString(value.alias, `${path}.alias`, errors) : null
  const withAlias = (fields: Record<string, unknown>) => (alias === null ? fields : { alias, ...fields })

  switch (actionId) {
    /**
     * **截面**：`sourceId` 原样带过，`plane` 收成一种写法（见 `normalizeSectionPlane`）。
     *
     * `plane` 缺省是**合法**的：它登记了 `ask_user` 默认策略，由审计去问用户 ——
     * 在这里补一个默认平面，等于替用户决定"剖哪儿"。
     */
    case "section.create": {
      const out: Record<string, unknown> = withAlias({})
      /**
       * `sourceId` 只收**裸 id 字符串**（登记表里是 `{field:"sourceId", kind:"id"}`），
       * 这一点与默认分支同一个判据：给对象形状（场景引用那种）在这里就报 `invalid_type`，
       * 而不是拖到引用解析时变成一句 `target_not_found`（症状完全两样）。
       * 缺字段仍旧放行 —— 它登记在 `required` 里，由审计去问。
       */
      if (value.sourceId !== undefined) {
        const sourceId = boundedString(value.sourceId, `${path}.sourceId`, errors)
        if (sourceId === null) return null
        out.sourceId = sourceId
      }
      if (value.plane !== undefined) {
        const plane = normalizeSectionPlane(value.plane, `${path}.plane`, errors)
        if (!plane) return null
        out.plane = plane
      }
      return out
    }

    case "solid.create_template": {
      const template = value.template
      if (typeof template !== "string" || !(SOLID_TEMPLATES as readonly string[]).includes(template)) {
        errors.push(fail("invalid_template", `${path}.template`, `expected one of ${SOLID_TEMPLATES.join(", ")}`))
        return null
      }
      // Absent origin is completed by the registered safe_default and recorded as an assumption.
      const origin = value.origin === undefined ? undefined : readVector3(value.origin, `${path}.origin`, errors)
      const out: Record<string, unknown> = withAlias({ template, ...(origin === undefined ? {} : { origin }) })
      if (value.size !== undefined) out.size = readVector3(value.size, `${path}.size`, errors)
      if (value.radius !== undefined) out.radius = finiteNumber(value.radius, `${path}.radius`, errors)
      if (value.height !== undefined) out.height = finiteNumber(value.height, `${path}.height`, errors)
      const label = boundLabel(value.label, `${path}.label`, errors)
      if (label !== undefined) out.label = label
      /**
       * 不同模板的要求不同，不能把 size 通用于所有实体（设计规格 L968）。
       *
       * 这里只挡**自相矛盾**的那一种：圆柱/圆锥给了 `size`（它没有"棱长"这回事）。
       * 缺 `radius` / 缺 `size` 由**默认策略**处理（`ask_user` 会去问用户，`infer_from_facts`
       * 会从原话里读）—— 在传输层提前拒掉，用户看到的就是一句 `missing_field`，
       * 而不是"请问底面半径是多少？"。
       */
      if ((template === "cube" || template === "pyramid") && out.size === null && value.radius !== undefined) {
        errors.push(fail("unexpected_field", `${path}.radius`, `${template} takes size, not radius`))
      }
      return out
    }

    case "solid.create_prism": {
      /**
       * 载荷形状**逐字段**读出来（不做类型断言）：底面是一串空间点、向量是一个空间向量。
       *
       * 这里只挡"明显畸形"（点数不足、缺分量、非有限数），**语义**（是否共面、是否自交、向量是否为零）
       * 全部留给动作编译器的 `validatePrismInput` —— 传输层再抄一遍必然分叉（见本文件头注释）。
       *
       * 底面与向量**缺字段是合法的**：它们登记了默认策略（规格 §6.3 的底跨 4 / 高度 3），
       * 由审计在编译前回填并写进 `assumptions`。在这里要求它们，会把"我替你取了默认值"
       * 变成一句硬邦邦的 `missing_field` —— 而用户本来是可以看到那条假设的。
       */
      const out: Record<string, unknown> = withAlias({})
      if (value.basePolygon !== undefined) {
        if (!Array.isArray(value.basePolygon)) {
          errors.push(fail("invalid_type", `${path}.basePolygon`, "expected an array of spatial points"))
          return null
        }
        if (value.basePolygon.length < 3) {
          errors.push(fail("invalid_type", `${path}.basePolygon`, "a prism base needs at least three points"))
          return null
        }
        const basePolygon: { x: number; y: number; z: number }[] = []
        for (const [index, point] of value.basePolygon.entries()) {
          const read = readVector3(point, `${path}.basePolygon[${index}]`, errors)
          if (read === null) return null
          basePolygon.push(read)
        }
        out.basePolygon = basePolygon
      }
      if (value.vector !== undefined) {
        const vector = readVector3(value.vector, `${path}.vector`, errors)
        if (vector === null) return null
        out.vector = vector
      }
      const label = boundLabel(value.label, `${path}.label`, errors)
      if (label !== undefined) out.label = label
      return out
    }

    case "planar.create_conic": {
      /**
       * 圆锥曲线：`kind` 是闭集（不认识的名字要指到那个字段），三种曲线各自需要的字段不同，
       * 所以只做**有限性**这一层，语义（半径为正、焦准距非零）留给动作编译器（规格 §6.2）。
       */
      const kind = value.kind
      if (typeof kind !== "string" || !(CONIC_KINDS as readonly string[]).includes(kind)) {
        errors.push(fail("invalid_conic_kind", `${path}.kind`, `expected one of ${CONIC_KINDS.join(", ")}`))
        return null
      }
      const out: Record<string, unknown> = withAlias({ kind })
      if (value.center !== undefined) out.center = readPoint2(value.center, `${path}.center`, errors)
      if (value.vertex !== undefined) out.vertex = readPoint2(value.vertex, `${path}.vertex`, errors)
      if (value.radiusX !== undefined) out.radiusX = finiteNumber(value.radiusX, `${path}.radiusX`, errors)
      if (value.radiusY !== undefined) out.radiusY = finiteNumber(value.radiusY, `${path}.radiusY`, errors)
      if (value.focalParameter !== undefined) out.focalParameter = finiteNumber(value.focalParameter, `${path}.focalParameter`, errors)
      if (value.rotation !== undefined) out.rotation = finiteNumber(value.rotation, `${path}.rotation`, errors)
      if (value.axis !== undefined) {
        if (value.axis !== "x" && value.axis !== "y") errors.push(fail("invalid_axis", `${path}.axis`, "expected 'x' or 'y'"))
        else out.axis = value.axis
      }
      const label = boundLabel(value.label, `${path}.label`, errors)
      if (label !== undefined) out.label = label
      return out
    }

    case "dynamic.create_bound_point": {
      const host = readScopedReference(value.host, `${path}.host`, errors)
      const out: Record<string, unknown> = withAlias({ host })
      if (value.hostSub !== undefined) {
        if (typeof value.hostSub !== "number" || !Number.isInteger(value.hostSub) || value.hostSub < 0) {
          errors.push(fail("invalid_host_sub", `${path}.hostSub`, "hostSub must be a non-negative integer"))
        } else out.hostSub = value.hostSub
      }
      // `parameter` 有安全默认（0.4），所以**缺省是合法的**：回填发生在审计那一层，并写进 assumptions。
      const parameter = optionalFiniteNumber(value.parameter, `${path}.parameter`, errors)
      if (parameter !== undefined && parameter !== null) out.parameter = parameter
      if (value.parameterId !== undefined) out.parameterId = boundedString(value.parameterId, `${path}.parameterId`, errors)
      const label = boundLabel(value.label, `${path}.label`, errors)
      if (label !== undefined) out.label = label
      return out
    }

    case "parameter.create": {
      // 这是**新名字**而不是引用：所以只要求它是一个有界的非空字符串，不去文档里找它。
      const id = boundedString(value.id, `${path}.id`, errors)
      const out: Record<string, unknown> = { id }
      const initial = optionalFiniteNumber(value.value, `${path}.value`, errors)
      if (initial !== undefined && initial !== null) out.value = initial
      for (const key of ["min", "max", "step"] as const) {
        const read = optionalFiniteNumber(value[key], `${path}.${key}`, errors)
        if (read !== undefined && read !== null) out[key] = read
      }
      const label = boundLabel(value.label, `${path}.label`, errors)
      if (label !== undefined) out.label = label
      return out
    }

    case "object.update_inputs": {
      const target = readScopedReference(value.target, `${path}.target`, errors)
      const patch = isPlainObject(value.patch)
        // 白名单**只有一份**：直接读动作层的 `UPDATABLE_INPUT_FIELDS`（Fix round 1 / I14）。
        // 手抄一份更窄的列表会把"把点挪到 (1,2)"判成 `unknown_field` 并浪费唯一一次修复。
        ? (rejectUnknownFields(value.patch, UPDATABLE_INPUT_FIELDS, `${path}.patch`, errors), value.patch)
        : (errors.push(fail("invalid_type", `${path}.patch`, "expected an object")), null)
      return withAlias({ target, patch })
    }

    case "solid.create_polyhedron": {
      /**
       * 任意多面体：`vertices` 是一串空间点、`faces` 是**二层整数数组**（顶点下标，0 起）。
       *
       * 这里只挡**形状**：点少于 4 个、面少于 4 个、环里不是整数 / 越界 / 重复。
       * **几何语义**留给内核（见登记表那条注释）—— 那条边界是刻意的，不要往这里搬。
       */
      const out: Record<string, unknown> = withAlias({})
      if (!Array.isArray(value.vertices)) {
        errors.push(fail("invalid_type", `${path}.vertices`, "expected an array of spatial points"))
        return null
      }
      if (value.vertices.length < 4) {
        errors.push(fail("invalid_type", `${path}.vertices`, "a polyhedron needs at least four vertices"))
        return null
      }
      const vertices: { x: number; y: number; z: number }[] = []
      for (const [index, point] of value.vertices.entries()) {
        const read = readVector3(point, `${path}.vertices[${index}]`, errors)
        if (read === null) return null
        vertices.push(read)
      }
      out.vertices = vertices

      if (!Array.isArray(value.faces)) {
        errors.push(fail("invalid_type", `${path}.faces`, "expected an array of face rings"))
        return null
      }
      if (value.faces.length < 4) {
        errors.push(fail("invalid_type", `${path}.faces`, "a polyhedron needs at least four faces"))
        return null
      }
      const faces: number[][] = []
      for (const [faceIndex, ring] of value.faces.entries()) {
        if (!Array.isArray(ring) || ring.length < 3) {
          errors.push(fail("invalid_type", `${path}.faces[${faceIndex}]`, "a face ring needs at least three vertex indexes"))
          return null
        }
        const indexes: number[] = []
        for (const [cornerIndex, corner] of ring.entries()) {
          if (!Number.isInteger(corner) || corner < 0 || corner >= vertices.length) {
            errors.push(fail("invalid_type", `${path}.faces[${faceIndex}][${cornerIndex}]`, `a face ring index must be an integer in 0..${vertices.length - 1}`))
            return null
          }
          if (indexes.includes(corner)) {
            errors.push(fail("duplicate_index", `${path}.faces[${faceIndex}][${cornerIndex}]`, "a face ring must not repeat a vertex"))
            return null
          }
          indexes.push(corner)
        }
        faces.push(indexes)
      }
      out.faces = faces
      const label = boundLabel(value.label, `${path}.label`, errors)
      if (label !== undefined) out.label = label
      return out
    }

    case "object.delete_many": {
      // 整批删除：目标是一个裸 id 数组（动作层会把它编成**一个** `deleteObjects` 操作）。
      if (!Array.isArray(value.targets)) {
        errors.push(fail("invalid_type", `${path}.targets`, "expected an array of object ids"))
        return null
      }
      const targets = value.targets.map((entry, index) => boundedString(entry, `${path}.targets[${index}]`, errors))
      if (targets.some((entry) => entry === null)) return null
      return withAlias({ targets })
    }

    default: {
      /**
       * 其余动作的载荷按登记表的字段白名单**原样透传**。
       *
       * 这不是"不校验"：字段白名单已经在上面 `rejectUnknownFields` 里执行过，
       * 而**语义**校验（半径为正、坐标有限、工作区是否允许）在动作编译器里，且只有那一份。
       * 在这里再抄一遍必然分叉，症状是"schema 放行、编译器拒绝"。
       */
      const out: Record<string, unknown> = { ...value }

      // 闭集字段（Fix round 1 / I15）：不校验的话，编译器的兜底分支会把任何取值编成别的东西。
      for (const [field, allowed] of Object.entries(spec.enumValues ?? {})) {
        const provided = out[field]
        if (provided === undefined) continue
        if (typeof provided !== "string" || !allowed.includes(provided)) {
          errors.push(fail(spec.enumCodes?.[field] ?? `invalid_${field}`, `${path}.${field}`, `expected one of ${allowed.join(", ")}`))
          return null
        }
      }

      /**
       * **每一个**引用字段都要过作用域校验并摊平（Fix round 1 / I12、I16）。
       *
       * scoped 引用摊平成动作层读的 `{documentId, entityId}`；`id` / `parameter` 引用是
       * 字符串（同文档内的 id 或参数名），这里只挡明显畸形（非字符串、超长），
       * 存在性由编译器的引用解析负责。
       */
      for (const reference of spec.references ?? []) {
        const provided = out[reference.field]
        if (reference.list) {
          if (provided === undefined) continue
          if (!Array.isArray(provided)) {
            errors.push(fail("invalid_type", `${path}.${reference.field}`, "expected an array of ids"))
            return null
          }
          const ids = provided.map((entry, index) => boundedString(entry, `${path}.${reference.field}[${index}]`, errors))
          if (ids.some((entry) => entry === null)) return null
          out[reference.field] = ids
          continue
        }
        if (provided === undefined) {
          /**
           * 缺字段在这里**放行**（Fix round 1 / I17）：审计会按默认策略处理 ——
           * 有安全默认就回填并写进 assumptions，标着 `ask_user` 的就去问用户
           *（"这个动点绑在哪个对象上？"）。在传输层提前拒掉，用户看到的只会是一句
           * `invalid_type`，而登记表里那条 `ask_user` 就成了**永远走不到的死策略**。
           */
          continue
        }
        if (reference.kind === "scoped") {
          const resolved = readScopedReference(provided, `${path}.${reference.field}`, errors)
          if (resolved === null) return null
          out[reference.field] = resolved
          continue
        }
        const id = boundedString(provided, `${path}.${reference.field}`, errors)
        if (id === null) return null
        out[reference.field] = id
      }

      // 嵌套引用（切线的 `anchor.pointId`）：形状与作用域都按同一个判据走。
      for (const reference of spec.references ?? []) {
        if (!reference.nested) continue
        const outer = out[reference.nested.outer]
        if (!isPlainObject(outer) || outer[reference.nested.when.field] !== reference.nested.when.equals) continue
        const inner = outer[reference.nested.inner]
        if (inner === undefined) continue
        if (typeof inner !== "string") {
          errors.push(fail("invalid_type", `${path}.${reference.nested.outer}.${reference.nested.inner}`, "expected an id"))
          return null
        }
        out[reference.nested.outer] = { ...outer, [reference.nested.inner]: boundedString(inner, `${path}.${reference.nested.outer}.${reference.nested.inner}`, errors) }
      }

      /**
       * **按登记的种类逐字段校验**（Phase 1）。
       *
       * 枚举与引用字段已在上面各自处理过 —— 这里只补上"剩下的普通字段"的形状判据：
       * `radius` 必须是有限数、`label` 必须是字符串、`points` 必须是点数组。
       * 缺字段一律跳过（默认策略在审计那层）。
       */
      for (const field of spec.inputFields) {
        if (field === "alias") continue
        if (spec.enumValues?.[field] !== undefined) continue
        if ((spec.references ?? []).some((entry) => entry.field === field)) continue
        const provided = out[field]
        if (provided === undefined) continue
        const read = readByDeclaredKind(spec, field, provided, `${path}.${field}`, errors)
        if (read !== undefined) out[field] = read
      }
      if (errors.length > 0) return null

      return withAlias(out)
    }
  }
}

/** 解析单个动作；`unknown` 一律走校验，不做任何类型断言。 */
