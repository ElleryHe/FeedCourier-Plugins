# 链接替换（YOURLS）

FeedCourier 官方内置处理插件（`runtime: "builtin"`，`kind: "builtin"`），随主程序二进制一同编译提供（`v0.3.0+`）。

[English](./README.md) | **简体中文** | [插件文档](https://feedcourier.ellery.me/zh/plugins/link-rewrite)

## 功能特性

- 在 `on_render` 渲染阶段通过一个或多个自建 **YOURLS** 短链服务重写文章主链接与正文链接。
- 内置 SQLite 短链缓存，避免同一文章重复请求短链接口。
- 支持按域名排除重写，并提供可选的**严格模式**（短链接口故障时进入重试队列，而非降级回退原链接）。
- 自动兼容 Telegram、Email、Notion 等内置通道以及 `ntfy`、`bark` 等 JS 通道插件。

## 使用方法

在 FeedCourier WebUI → **插件中心** 中启用 **Link Rewrite (YOURLS)**，添加一个或多个 YOURLS 服务实例后，在对应路由中启用即可。
