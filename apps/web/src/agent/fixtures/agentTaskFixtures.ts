export type AgentTaskCategory = "create" | "dependency" | "modify" | "reject" | "recovery" | "visual"

export interface AgentAcceptanceCheck {
  type: string
  target?: string
  expected?: string | number | boolean
}

export interface AgentTaskFixture {
  id: string
  category: AgentTaskCategory
  prompt: string
  expected: {
    toolIntent: readonly string[]
    acceptance: readonly AgentAcceptanceCheck[]
  }
}

export const AGENT_TASK_FIXTURES: readonly AgentTaskFixture[] = [
  {
    id: "create-cube",
    category: "create",
    prompt: "画一个边长为 3、中心在原点的立方体",
    expected: {
      toolIntent: ["geometry.create_solid"],
      acceptance: [
        { type: "primitive_exists", target: "polyhedron3", expected: true },
        { type: "edge_length", expected: 3 },
        { type: "center", expected: "origin" }
      ]
    }
  },
  {
    id: "create-tetrahedron",
    category: "create",
    prompt: "画一个棱长为 3 的正四面体",
    expected: {
      toolIntent: ["geometry.create_tetrahedron"],
      acceptance: [{ type: "edge_length", expected: 3 }]
    }
  },
  {
    id: "section-after-solid",
    category: "dependency",
    prompt: "先创建一个立方体，再用指定平面创建它的截面",
    expected: {
      toolIntent: ["geometry.create_solid", "scene.describe_entities", "geometry.create_section"],
      acceptance: [
        { type: "dependency_order", expected: "solid-before-section" },
        { type: "section_source", expected: "solid" }
      ]
    }
  },
  {
    id: "modify-section",
    category: "modify",
    prompt: "修改刚才的截面平面，并保持原来的实体不变",
    expected: {
      toolIntent: ["scene.search_entities", "geometry.update_object", "draft.verify"],
      acceptance: [
        { type: "solid_unchanged", expected: true },
        { type: "section_updated", expected: true }
      ]
    }
  },
  {
    id: "reject-degenerate-cube",
    category: "reject",
    prompt: "画一个边长为 0 的立方体",
    expected: {
      toolIntent: ["geometry.create_solid"],
      acceptance: [{ type: "status", expected: "rejected" }]
    }
  },
  {
    id: "visual-fit",
    category: "visual",
    prompt: "生成图形后调整视角，确保实体和标签都完整显示在画布内",
    expected: {
      toolIntent: ["render.capture", "render.inspect_layout"],
      acceptance: [
        { type: "clipped_objects", expected: 0 },
        { type: "label_overlaps", expected: 0 }
      ]
    }
  },
  {
    id: "recover-invalid-reference",
    category: "recovery",
    prompt: "在引用不存在对象时停止猜测，并说明下一步需要什么信息",
    expected: {
      toolIntent: ["scene.search_entities", "run.explain_refusal"],
      acceptance: [{ type: "status", expected: "waiting" }]
    }
  }
]
