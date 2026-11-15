# R02 原生凭据归属、endpoint 绑定与恢复证据（2026-11-15）

| 严重度 | 原审查归并发现 | 本区块静态复核 |
| --- | ---: | --- |
| CRITICAL | 0 | 0 |
| HIGH | 1（H1 凭据跨归属/跨端点转发） | 已增加生产阻断与回归 |
| MEDIUM | 1（M4 更新失败破坏旧凭据） | 已增加原生事务与故障恢复 |
| LOW | 0 | 0 |

## 实现合同

- `secretRef` 只能属于当前 profile。版本化槽由 Rust 以 `native-v1:<字节长度>:<profileId>:<revision>` 生成，renderer不能选择任意槽；长度前缀和保留槽形状避免ID拼接碰撞。
- `credentialEndpoint` 绑定规范化后的 HTTP(S) origin 和基础路径。比较覆盖 scheme、host、有效端口和path；大小写、默认端口和尾斜杠不会误判，userinfo/query/fragment被拒绝。
- 没有可信 endpoint 绑定的旧凭据在借钥和联网前拒绝。**旧用户必须重新输入密钥完成原生授权**，不自动把旧密钥绑定到手改后的host。
- 新密钥先写入属于本profile的新版本槽，profile提交成功后才清理旧槽。恢复记录只含profile、槽和阶段，不含明文。
- profile写盘失败同时恢复磁盘和内存旧版本；新槽清理失败、旧槽清理失败和提交前/后崩溃均按当前实际引用恢复。
- 旧 `upsert_provider_profile` 也经过同一原生更新；`save_secret` 只能补齐legacy缺失密钥，不能覆盖已有/版本化凭据；`remove_secret` 不能删除仍被引用的槽。
- 前端仅调用一次 `update_provider_credentials`，不再执行 `save_secret → upsert → remove_secret` 补偿。应用启动时自动执行恢复。

## RED → GREEN 与故障矩阵

- 跨profile RED：存储接受外部 `secretRef`，发送也继续完成；增加归属检查后两项精确测试转GREEN。
- endpoint RED：保留密钥换服务仍发送；增加绑定后转GREEN。旧存档无可信绑定的独立负例同样先失败后转GREEN。
- 前端 RED：4项测试实际观察到旧三段写入/删除序列；改为单原生命令后16/16通过，受影响TS三套件共56/56通过。
- 原生事务与恢复 RED：新接口不存在，测试无法编译；实现后按下列矩阵逐项验证。
- 合法夹具更新：切换Anthropic/Ollama URL时必须同步测试绑定，生产没有为让旧测试通过而放宽断言。

| 场景 | 结果 |
| --- | --- |
| 成功轮换/新建 | 新版本槽提交，旧槽随后清理，revision与endpoint绑定正确 |
| 普通编辑 | 不输入新密钥时保留原槽和绑定；规范化后同endpoint可编辑 |
| 未重新授权换endpoint | `needs_reauthorization`，profile与旧密钥不变 |
| CAS冲突 | 在任何新密钥写入前拒绝 |
| secret store写入失败 | 旧profile/旧密钥保留，无未登记孤儿 |
| 新槽暂存后profile写失败 | 旧profile/旧密钥保留，新槽清理，失败清理保持登记 |
| 提交前崩溃 | 未引用新槽被清理，旧槽保留 |
| 提交后崩溃 | 实际引用的新槽保留，未引用旧槽清理 |
| 旧槽清理失败 | 返回 `recoveryRequired`，之后可重试清理 |
| 旧IPC直接写/删 | 已有/版本化覆盖和当前引用删除均拒绝 |

## 验证

- `npm exec -- vitest run apps/web/src/services/providerProfileClient.test.ts apps/web/src/components/settings/ProviderSettings.test.tsx apps/web/src/services/secretClient.test.ts --testTimeout=30000`：3文件、56项通过。
- `node scripts/toolchain.mjs cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test provider_adapter --test provider_profiles --test secrets --test provider_capability -- --test-threads=1`：104项通过、1项真实Windows后端测试ignored。
- `npm run test:rust -- -- --test-threads=1`：297项通过、0失败、4 ignored；忽略项为真实provider、真实Windows凭据库和显式Lean环境测试。
- `npm run typecheck`：通过。
- `npm test -- --testTimeout=30000`：522文件、5560项通过、1 todo、0失败。
- `npm run lint`：0错误、32条既有unused警告，新增代码没有新增警告。
- `npm run test:docs -- --testTimeout=30000`：8文件、22项通过。
- `npm run build --workspace @draw/web`：构建通过；保留既有动态导入与大chunk警告。

## 边界与回滚

全部故障注入使用内存fake secret store、临时目录和本地测试transport；没有读取或写入真实系统凭据，没有调用真实provider或外部网络。真实Windows后端和付费provider测试保持ignored。

本轮为同会话自审，不替代独立人工发布签收。feature分支推送不触发仅main/PR运行的远端CI，不宣称远端CI全绿。出现问题时保持凭据发送关闭并切换到已核验补丁，不恢复任意 `secretRef`、无绑定发送或renderer删除旧密钥的补偿路径。
