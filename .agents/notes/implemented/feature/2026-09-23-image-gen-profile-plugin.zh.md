# Agent Note: 图片生成保持为 profile 可选安装

Status: implemented

[English](2026-09-23-image-gen-profile-plugin.md) | 中文

## Problem

图片生成会调用单独配置的图片 API，并接受可能携带用户提供字节的图片引用。把这种网络行为挂载到每个 profile，等于在没有明确部署决定的情况下把它变成随附默认项。

## Decision

图片生成工具是独立的 workspace package，不随 `dsh-base` 或 `dsh-web-app` 挂载。Profile 所有者安装该包并在该 profile 的 patch 中添加它的 Cordis row。包内同时包含 host 与浏览器插件入口，因此安装了它的 Web profile 可以渲染生成附件并管理其设置。

仓库把上游运行时作为受版本管理的 JavaScript 保存在 `src/` 下，因为所给源码树没有 TypeScript 实现：`src/runtime.js` 是 host 插件，`src/client.js` 是浏览器 classic script，运行时旁有手工维护的类型声明。Workspace 构建会编译这些声明并打包三个发布产物（`lib/index.js`、`lib/invariant.js`、`lib/client.js`）；从仓库检出即可复现打包。

## Alternatives considered

- **在每个 Web profile 中挂载图片生成。** 不采用，因为这会未经 opt-in 就把图片提供方请求路径和带凭据的 endpoint 加入默认项。
- **只把源码保存在用户安装目录。** 不采用，因为这样 Harness 检出中就没有可审查、可提交的源码或包产物。
- **从编译后的 JavaScript 重建 TypeScript 源码。** 不采用，因为原始源码不可得；重建会把未经验证的改写纳入迁移。

## Consequences

Profile 所有者必须自行选择安装并组合该插件。在拿到上游 TypeScript 源码前，受版本管理的 JavaScript 就是其行为的事实源码。Workspace 检查覆盖包元数据与 invariant 注册；聚焦的运行时测试覆盖设置路由与图片请求行为。
