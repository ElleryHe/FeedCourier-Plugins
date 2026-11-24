# ntfy 推送（ntfy Push）

FeedCourier 官方单文件 JavaScript 通道插件（`Plugin API v1`，`runtime: "js"`），可将 RSS 文章直接推送至 **[ntfy.sh](https://ntfy.sh)** 或自建 ntfy 服务器。

[English](./README.md) | **简体中文** | [Plugin API v1](../../../docs/plugin-api/v1.md)

## 功能特性

- 无需额外部署 Docker sidecar 容器——在 FeedCourier 插件市场一键安装，直接运行于内置安全沙箱中。
- **账号配置**：`server_url`（必填，默认 `https://ntfy.sh`）、`access_token`（可选 `Bearer` 访问令牌，用于受保护主题）。
- **投递目标配置**：`topic`（必填主题名）、`priority`（`min` / `low` / `default` / `high` / `urgent`）、`tags`（逗号分隔的标签或 Emoji 短码）。
- **安全与排版强化**：
  - 严格校验 `server_url`（拒绝内嵌凭据、自动清理查询串与锚点）。
  - 非 ASCII 标题自动使用 RFC 2047 UTF-8 Base64 编码，避免中文标题乱码。
  - 按 UTF-8 字节数安全截断至 `<= 4096` 字节，绝不截断中文字符或 Emoji 代理对。
  - 自动携带 `Click` 跳转链接（无缝兼容 `link-rewrite` 短链重写）。
  - 智能重试映射：`429`（遵循 `Retry-After`）与 `5xx` 自动重试，`4xx` 标记为永久失败。

## 声明的网络域名

- 默认声明域名：`ntfy.sh`
- 若使用自建 ntfy 服务端，只需在通道账号的 `server_url` 中填写服务端地址即可（仍受 FeedCourier 全局 SSRF 防护策略约束）。

## 安装与使用

1. 打开 FeedCourier WebUI → **插件中心 → 插件市场**。
2. 找到 **ntfy Push** 并点击**安装**。
3. 前往 **推送通道** 创建 ntfy 账号与主题目标，并在路由中绑定即可开始推送。
