# 2026-10-20 安装 / 卸载 / 断网 验收尝试：拿到了什么、卡在哪

本文记录用户授权后（"允许进行 task20.21 和 msi 内容"）实际做出来的**安装、启动、卸载、断网**证据，以及**卡住的两件事**与卡住的**原始报错**。**没有做的事就地写"没做"**，不拿相邻环节的结果充当验收。

## 一、结论速览

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| **MSI 安装（per-machine）** | **失败：权限不足** | `Error 1925`，见 §二 |
| **MSI 载荷完整性** | **通过** | 管理安装解开后 `mathcanvas-desktop.exe` = **17,595,392 B**，与 Release 资产逐字节同尺寸 |
| **MSI 载荷启动（断网环境）** | **通过** | 真窗口 `MathCanvas`、`Responding=True`、存活 13 s，见 §三 |
| **MSI 卸载** | **没验** | 没装上，就谈不上卸载 |
| **NSIS 安装（当前用户，无需管理员）** | **通过** | 静默安装 exit 0，见 §四 |
| **NSIS 安装后启动（断网环境）** | **通过** | 真窗口 `Responding=True`、存活 13 s |
| **NSIS 卸载** | **通过** | 卸载 exit 0，目录与卸载注册项都清掉 |
| **Task 20 付费真实 provider 评测** | **没跑** | **本机没有 API key**（凭据管理器与环境变量都没有），见 §五 |
| **Task 21 干净机器 / 教师学生走查** | **没做** | 需要一台干净机器与真人，见 §六 |

## 二、MSI 安装失败：`Error 1925`（权限）

本机身份 `LAPTOP-CH622JVJ\Huo`，**非管理员**（`admin=False`，完整性级别 `S-1-16-8192` Medium），
所以 per-machine 的 MSI 装不上。这不是猜测，是 MSI 自己的日志：

```text
MSI (s) (94:18) [08:42:46:853]: Product: MathCanvas -- Error 1925.
You do not have sufficient privileges to complete this installation for all users of the machine.
Log on as administrator and then retry this installation.
```

`msiexec /i MathCanvas_4.0.0_x64_en-US.msi /qn` 的进程退出码 **1603**。
完整日志当时留在仓库外的 `D:\draw\_msi-install.log`；**该文件已在 2026-10-20 的本地清理里随其它一次性日志一起删掉**（本文件上面引的就是那份日志里的原文，结论不依赖日志文件本身）。

## 三、MSI 载荷：能解开、能启动（这一步是有意义的）

装不上不等于**装的东西本身**有问题。用管理安装（administrative image，无需管理员）把 MSI 内的文件树解出来：

```powershell
msiexec /a MathCanvas_4.0.0_x64_en-US.msi /qn TARGETDIR=D:\draw\_msi-admin-image
# exit 0
```

解开结果：

```text
D:\draw\_msi-admin-image\MathCanvas_4.0.0_x64_en-US.msi   335,872 B
D:\draw\_msi-admin-image\PFiles\MathCanvas\mathcanvas-desktop.exe   17,595,392 B
```

**17,595,392 B 与 Release 里那个免安装 exe 的字节数完全一致** —— 也就是说 MSI 里装的就是发布出去的那个二进制。

再把**这个从 MSI 里解出来的** exe 在**断网环境**（`HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` 全部指向死端口 `127.0.0.1:9`）里启动：

```text
pid=25472  responding=True  title='MathCanvas'  hwnd=3737884  alive_after_13s=True  stopped=True
```

**这证明的是**：MSI 载荷完整、启动不需要网络。**这不等于**"MSI 安装成功"。

## 四、退一步：用 NSIS 走通「装 → 启动 → 卸载」（当前用户，无需管理员）

MSI 走不通时，同一个版本还发布了 NSIS 安装包。它支持**当前用户**安装，因此不需要管理员：

```powershell
MathCanvas_4.0.0_x64-setup.exe /S /CURRENTUSER /D=D:\draw\_nsis-install
# exit 0
```

安装结果与卸载注册项：

```text
D:\draw\_nsis-install\mathcanvas-desktop.exe   17,595,392 B
D:\draw\_nsis-install\uninstall.exe                 79,315 B
HKCU\...\Uninstall\MathCanvas | MathCanvas | 4.0.0 | "D:\draw\_nsis-install"
```

断网环境启动：

```text
pid=29900  responding=True  title='MathCanvas'  hwnd=4393732  alive_after_13s=True
```

卸载：

```powershell
D:\draw\_nsis-install\uninstall.exe /S
# exit 0；目录已删除；HKCU 卸载注册项已移除
```

**一条副作用必须记着**：NSIS 的卸载注册项用的是固定产品 id `MathCanvas`，所以装 4.0.0 时**覆盖了**
10-16 那次审计安装（`audit-20261016\MathCanvas-installed`，3.3.14）的注册项；卸载 4.0.0 之后该注册项
**被移除**。那份 3.3.14 审计安装的**文件仍在原处**，只是它不再出现在"应用和功能"里。
没有动它的文件，也没有替它重建注册项（重建就等于改证据）。

## 五、Task 20（付费真实 provider 评测）：**没跑，因为本机没有 key**

查过三处，都没有：

- Windows 凭据管理器：`cmdkey /list` 里**没有** `ds.MathCanvas`（文档里写的那个目标名）；
- 环境变量：没有 `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` 之类的名字；
- 仓库内：没有 `.env` / `*.secrets.json`。

评测入口是 `npm run bench:agent -- --mode=real_provider`（`scripts/agent-benchmark/runner.mjs` 包着
`run.test.ts`）。**没有 key 就跑不了，跑不了就不写读数** —— 这一条不做任何"合成/模拟"替代。

冻结的授权额度仍然有效（**36 次真实请求 / $12 上限**）。**下一轮拿到 key 就能跑**，命令见 §七。

## 六、Task 21（干净机器 / 断网发行 / 教师学生走查）：只做到能自动化的那一半

- **能做到的**：断网环境启动（§三、§四，用死代理模拟）、NSIS 装→启动→卸载闭环（§四）、
  载荷与发布资产同尺寸（§三）。
- **做不到的**：**干净机器**（本机装过多次审计版本、注册表里还有 10-16 的痕迹）、
  **真断网**（防火墙规则需要管理员，只能靠死代理近似）、**教师/学生人评**（需要真人）。

## 七、拿到 key 之后要跑的命令（与花费上限）

```powershell
# 方式 A：存进凭据管理器（文档里一直用的那个目标名）
cmdkey /add:ds.MathCanvas /user:mathcanvas /pass:<你的 key>

# 方式 B：只在当前会话里用环境变量
$env:DEEPSEEK_API_KEY = '<你的 key>'

# 然后（先小样本，确认花费与读数都正常再放大）
npm run bench:agent -- --mode=real_provider
```

**花费口径**：授权仍是 **36 次真实请求 / $12 上限**。30 道题各跑一次（每题最多一次编译修复）会**超出**这个上限，
所以要么按授权跑冻结的 12 题子集，要么先把上限改为你要的数 —— 这一条需要你给数，我不会自己抬。
