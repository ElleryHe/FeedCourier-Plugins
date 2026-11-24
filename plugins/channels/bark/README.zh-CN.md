# Bark 推送（Bark Push）

FeedCourier 官方单文件 JavaScript 通道插件（`Plugin API v1`，`runtime: "js"`），通过 **[Bark](https://bark.day.app/)**（官方 `https://api.day.app` 或自建服务端）向 iOS / macOS 设备推送 RSS 文章摘要卡片。

[English](./README.md) | **简体中文** | [Plugin API v1](../../../docs/plugin-api/v1.md)

## 摘要卡片排版（参考 Telegram 摘要模式）

通知排版专为移动端快速阅读优化：

- **主标题（`title`）**：文章标题（自动压缩为单行并安全截断）。
- **副标题（`subtitle`）**：订阅源名称（在简洁且不重复时展示为 `订阅源 · 作者`）。
- **正文（`body`）**：
  - 精炼文章摘要（优先 `summary_text`，回退 `plain_text`）；当摘要与标题重复时自动省略，避免视觉冗余。
  - 底部编排元信息行：`— 订阅源 · 作者 · YYYY-MM-DD HH:MM`（按路由时区渲染）。
  - 严格控制正文 `<= 2400` UTF-8 字节并按字符安全截断，确保整体载荷稳稳落在 APNs 4 KB 限制内。
- **点击跳转（`url`）**：点击通知直达原文链接（无缝兼容 `link-rewrite` 短链重写）。
- **通知图标（`icon`）**：可选自动附带订阅源的 HTTPS Favicon 图标。

## 配置说明

- **账号配置**：
  - `server_url`（必填，默认 `https://api.day.app`）
  - `username`、`password`（可选，供自建 Bark 服务端 HTTP Basic Auth 使用）
- **投递目标配置**：
  - `device_key`（必填，Bark App 的设备密钥，静态加密存储并在界面与日志中脱敏）
  - `group`（可选通知分组名；留空时默认按订阅源标题自动分组）
  - `level`（中断级别：`active` / `timeSensitive` / `passive` / `critical`）
  - `sound`（可选推送铃声名称，如 `minuet`、`chime`、`alarm`）
  - `send_icon`（布尔开关，默认开启，附带订阅源 HTTPS 图标）

## 声明的网络域名

- 默认声明域名：`api.day.app`
- 若使用自建 Bark 服务端，只需在通道账号的 `server_url` 中配置服务端地址即可。
