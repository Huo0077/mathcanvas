import type { Download, Locator, Page } from "@playwright/test"

import { commandButton } from "../command-menu"

export type AppModuleName = "传统工作区" | "Agent 工作区" | "模型服务"
export type CanvasWorkspaceName = "平面几何" | "立体几何" | "工程制图"

/**
 * Shared Playwright Page Object encapsulating the current accessible UI chrome
 * (`ModuleRail` `"全局模块"`, `WorkspaceHeader` `"保存 .mgeo"`, workspace mode tabs,
 * command menu, and Agent prompt / confirmation panel).
 *
 * All locators target real user-accessible roles and labels without test-only backdoors.
 */
export class MathCanvasPage {
  constructor(readonly page: Page) {}

  get moduleNav(): Locator {
    return this.page.getByRole("navigation", { name: "全局模块" })
  }

  async openModule(name: AppModuleName): Promise<void> {
    await this.moduleNav.getByRole("button", { name }).click()
  }

  async openTraditionalWorkspace(): Promise<void> {
    await this.openModule("传统工作区")
  }

  async openAgentWorkspace(): Promise<void> {
    await this.openModule("Agent 工作区")
  }

  async openModelSettings(): Promise<void> {
    await this.openModule("模型服务")
  }

  async openExperimentalSettings(): Promise<void> {
    await this.openModelSettings()
    await this.page.getByRole("group", { name: "设置分类" }).getByRole("button", { name: "偏好设置" }).click()
    await this.page.getByRole("region", { name: "实验性功能" }).waitFor({ state: "visible" })
  }

  async switchWorkspace(name: CanvasWorkspaceName): Promise<void> {
    await this.page.getByRole("button", { name }).click()
  }

  saveMgeoButton(): Locator {
    return this.page.getByRole("banner").getByRole("button", { name: "保存 .mgeo" })
  }

  async downloadMgeo(): Promise<Download> {
    const downloadPromise = this.page.waitForEvent("download")
    await this.saveMgeoButton().click()
    return await downloadPromise
  }

  async runCommand(name: string): Promise<void> {
    await (await commandButton(this.page, name)).click()
  }

  async sendAgentPrompt(prompt: string): Promise<void> {
    await this.page.getByRole("textbox", { name: "对话输入" }).fill(prompt)
    await this.page.getByRole("button", { name: "发送", exact: true }).click()
  }

  latestConfirmationPanel(): Locator {
    return this.page.getByRole("region", { name: "确认改动" }).last()
  }
}
