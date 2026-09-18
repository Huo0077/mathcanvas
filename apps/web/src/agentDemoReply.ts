/**
 * Agent 区的**演示回复**。
 *
 * 这一轮只做界面骨架，没有接入任何模型服务；但一个"点发送什么都没发生"的输入框
 * 既验不了布局也验不了对话流的滚动行为，所以给一条明确的占位回复：
 * 它自己说清楚"尚未接入模型"，同时带一个代码块，让展示区的代码样式有真实内容可看。
 * 接入真实服务时，替换这一个函数即可（`agentStore.sendPrompt` 的流程不用动）。
 */
export function composeDemoReply(prompt: string): string {
  const request = prompt.trim().split("\n")[0] ?? ""
  return [
    `已收到你的指令：**${request}**`,
    "",
    "当前 Agent 工作区只有交互骨架，还没有接入模型服务，所以这条回复是本地占位内容。",
    "接入之后，这里会流式显示推理过程、绘图结果与可复制的代码：",
    "",
    "```ts",
    "// 示例：把一句自然语言变成画布上的图元",
    "const step = plan(\"作一条过点 A 的切线\")",
    "applyGeometry({ op: \"addPrimitive\", primitive: step.primitive })",
    "```",
    "",
    "左侧可以新建或切换对话，右上角随时回到传统工作区继续用画布操作。"
  ].join("\n")
}
