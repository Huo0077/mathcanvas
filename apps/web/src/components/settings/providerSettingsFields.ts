/**
 * Provider 设置的**纯函数**（与组件分开的文件）。
 *
 * 为什么单独一个文件：`react-refresh` 要求"只导出组件的文件才能热更新"，
 * 而组件文件里导出 `slug` 会让那个文件**整块**失去快速刷新 ——
 * 改一行样式就要刷新整页，而设置表单是有输入状态的（刷新会丢掉用户刚填的东西）。
 * 把纯函数挪出来，组件文件就只剩组件。
 */

/** 显示名称 → 稳定标识。中文名字也要能用，所以非 ASCII 一律回退为 `profile`。 */
export function slug(name: string): string {
  const ascii = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return ascii.length > 0 ? ascii : name.trim().length > 0 ? "profile" : ""
}

/** 把失败原因码翻成一句用户能照做的话。 */
export function reasonFor(code: string, detail: string): string {
  switch (code) {
    case "no_desktop_shell":
      return "密钥与配置需要桌面版（Windows 应用）；当前在浏览器里运行。"
    case "secret_not_allowed":
      return "配置里不能带密钥字段，请把它填在「密钥」这一栏。"
    case "ipc_failed":
      return `保存失败：${detail}`
    default:
      return detail
  }
}
