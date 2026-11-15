# R03 URL/DNS/连接一致与有界响应证据（2026-11-15）

| 严重度 | 原审查归并发现 | 本区块复核 |
| --- | ---: | --- |
| CRITICAL | 0 | 0 |
| HIGH | 0 | 0 |
| MEDIUM | 2（M6 SSRF 绕过、M7 错误响应完整缓冲） | 已增加生产阻断与本地回归 |
| LOW | 0 | 0 |

## URL 与地址策略

- 使用 `reqwest::Url` 取代手写host切分，覆盖IPv6回环、未指定地址、ULA、链路本地、文档地址和IPv4映射地址。
- IPv4分类覆盖私网、回环、链路本地、未指定、广播、组播、CGNAT、基准测试和文档网段；所有DNS候选复用同一判据。
- cloud要求HTTPS且禁止非公共地址；local仅允许回环候选；LAN允许私网但禁止链路本地元数据地址。local域名只有在解析结果为回环时才可使用。
- 重定向凭据比较使用完整origin，包含有效端口；实际HTTP client仍禁止redirect和系统/环境代理。

## DNS 解析与连接固定

`ProviderRequest` 携带原生 `networkPolicy`。`HttpTransport` 按以下顺序执行：

1. 重验URL与策略，解析有效端口。
2. 直接IP不重复做DNS；域名通过可注入resolver解析全部候选。
3. 任一候选违反策略即整体拒绝，空候选也拒绝；候选端口统一为URL有效端口并去重。
4. 使用 `resolve_to_addrs` 固定已验证候选，原URL hostname不变，因此HTTP Host与TLS hostname/SNI仍由原域名决定。
5. resolver与HTTP阶段都可取消；成功响应仍限1MiB，不跟随重定向。

生产使用系统resolver，测试使用内存resolver，未进行真实DNS rebinding或外部网络请求。

## 有界错误响应

非2xx响应固定最多4096字节：先检查 `Content-Length`，再按 `bytes_stream` 分块读取，在每次 `extend` 前检查累计长度。取消优先于下一块；只有完成有界读取后才进行UTF-8损失转换和最多200字符诊断，不再调用 `response.text()` 完整缓冲。

## RED → GREEN

- URL/地址三项RED：IPv6回环被接受、local可越界到LAN、跨端口重定向被视为同源；修复后proxy全套19项通过。
- 错误体两项RED：chunked与声明长度超限均先完整读取再返回普通HTTP错误；修复后超限在读取/扩展前拒绝。取消与短UTF-8正例同时通过。
- resolver三项RED：注入接口不存在；实现后混合公共/私有候选整体拒绝，local公共候选拒绝，合法域名只解析一次并连接已验证回环地址，Host保持原域名。
- 测试夹具的括号与取消等待顺序曾修正；没有为通过测试放宽生产判据或增加网络重试。

## 验证

- R03定向：provider_adapter 7/7通过。
- 受影响provider/proxy：155项通过、1 ignored。
- `npm run test:rust -- -- --test-threads=1`：307项通过、0失败、4 ignored。
- `npm run typecheck`：通过。
- `npm run lint`：0错误、32条既有unused警告。
- `npm test -- --testTimeout=30000`：522文件、5560项通过、1 todo、0失败。
- `npm run test:docs -- --testTimeout=30000`：8文件、22项通过。
- `npm run build --workspace @draw/web`：通过；保留既有动态导入和大chunk警告。

## 边界与回滚

所有网络验证使用回环服务器、内存resolver和小型合成流；没有真实凭据、外部DNS、恶意TLS或真实provider调用。真实provider和真实Windows凭据库测试保持ignored。未实测公网TLS，但实现不改变URL hostname，并使用reqwest/rustls原有证书校验。

本轮为同会话自审，不替代独立人工发布签收。feature分支推送不触发仅main/PR运行的远端CI。出现兼容性问题时保持网络发送关闭，不恢复手写host解析、校验后二次DNS或未限长错误体读取。
