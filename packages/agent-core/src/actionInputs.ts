import { type ParseError } from "./contracts"
import { updatableInputFields } from "@draw/scene-graph"
import { ACTIONS, CONIC_KINDS, SOLID_TEMPLATES, type ActionSpec, type ActionId } from "./actionRegistry"
import { boundedString, fail, finiteNumber, isPlainObject, optionalFiniteNumber, readPoint2, readScopedReference, readVector3, rejectUnknownFields } from "./schemaReaders"

/**
 * **逐个动作的 inputs 校验**（从 `schemas.ts` 拆出，评审方案 2）。
 *
 * 这是整个校验层里最大的一块：每个动作允许哪些字段、哪些必填、默认值怎么填、引用的形状对不对，
 * 全在这一个 switch 里。它读的是 `actionRegistry` 那张表、用的是 `schemaReaders` 那把尺子，
 * 自己**不定义**任何规则 —— 所以它能被单独读、单独测（`schemas.test.ts` 就是按动作逐条问它的）。
 */

const UPDATABLE_INPUT_FIELDS = updatableInputFields()
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
    case "solid.create_template": {
      const template = value.template
      if (typeof template !== "string" || !(SOLID_TEMPLATES as readonly string[]).includes(template)) {
        errors.push(fail("invalid_template", `${path}.template`, `expected one of ${SOLID_TEMPLATES.join(", ")}`))
        return null
      }
      const origin = readVector3(value.origin, `${path}.origin`, errors)
      const out: Record<string, unknown> = withAlias({ template, origin })
      if (value.size !== undefined) out.size = readVector3(value.size, `${path}.size`, errors)
      if (value.radius !== undefined) out.radius = finiteNumber(value.radius, `${path}.radius`, errors)
      if (value.height !== undefined) out.height = finiteNumber(value.height, `${path}.height`, errors)
      if (typeof value.label === "string") out.label = value.label
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
      if (typeof value.label === "string") out.label = value.label
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
      if (typeof value.label === "string") out.label = value.label
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
      if (typeof value.label === "string") out.label = value.label
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
      if (typeof value.label === "string") out.label = value.label
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
      if (typeof value.label === "string") out.label = value.label
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

      return withAlias(out)
    }
  }
}

/** 解析单个动作；`unknown` 一律走校验，不做任何类型断言。 */
