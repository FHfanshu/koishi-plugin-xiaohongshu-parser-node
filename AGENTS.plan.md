# Xhs_parser 改动计划（执行中）

更新时间：2025-11-12 16:50 (UTC+08)

## 总体计划

- 批次A（行为正确性与安全）：completed
  - 在 `index.ts` 接入域名校验、关键词过滤、最小长度校验（指令与中间件）：completed
  - 在 `utils.ts` 严格化 `validateUrl`，`formatContent` 遵循 `includeMetadata`，并使用 `import type` 避免潜在循环依赖：completed
  - 自动解析多链接时发送全部结果（合并为多条 forward），而非只取第一条：completed
  - 调整 `package.json` 的 koishi 服务声明：将 `puppeteer` 从 required 移至 optional：completed
  - **安全修复批次**：completed
    - SSRF防护：增加内网IP地址过滤，禁止访问内网资源：completed
    - 输入验证强化：URL长度限制、危险字符过滤、协议验证：completed
    - 依赖安全：Puppeteer安全配置优化，禁用不必要功能：completed
    - 信息泄露防护：改进错误处理，避免暴露系统信息：completed
    - HTML内容清理：移除潜在危险脚本和属性：completed

- 批次B（解析稳健性）：pending
  - 重构 `extractScriptData()`：放弃脆弱的正则抽取，优先 JSON-LD 并规范化为 `XHSMedia[]`
  - 去重媒体链接并统一 URL 与类型规范

- 批次C（体验与性能）：in_progress
  - 引入并发限制（多链接解析）：in_progress（中间件顺序处理，避免 Promise.all 并发）
  - 本地化数字格式与可配置化展示：pending

## 执行记录

- 2025-11-12 15:31 创建计划，进入批次A。
- 2025-11-12 15:38 完成批次A：
  - 修改 `src/utils.ts`：`import type { Config }`，严格化 `validateUrl`（host 等于/子域判断），`formatContent` 仅在 `includeMetadata` 为真时输出统计；
  - 修改 `src/client.ts`：增加 `cleanupTimer`、`startCacheCleanup()` 与 `dispose()`，构造时启动定时清理，并支持卸载清理；将 `Config` 改为类型导入；
  - 修改 `src/index.ts`：指令与中间件接入 `validateUrl`、`filterContent`、`minContentLength`，自动解析多链接逐条发送（forward/普通均可），并在 `ctx.dispose` 时调用 `client.dispose()`；
  - 修改 `package.json`：将 `koishi.service.required` 的 `puppeteer` 移至 `optional`。

- 2025-11-12 16:50 完成安全修复批次：
  - 修改 `src/utils.ts`：增强 `validateUrl` 添加SSRF防护（内网IP过滤）、协议验证；`parseXHSUrl` 增加URL长度限制和危险字符过滤；
  - 修改 `src/client.ts`：增加 `sanitizeHtml` 函数清理危险脚本；axios请求添加重定向安全检查；Puppeteer增加安全配置；改进错误处理避免信息泄露；
  - 修改 `src/index.ts`：改进错误消息，避免暴露系统详细信息。

## 备注

- 轻微变更也将记录于本文件，并同步步骤状态。
- 安全修复主要针对插件市场检测的安全问题，包括SSRF、输入验证、依赖安全和信息泄露。
