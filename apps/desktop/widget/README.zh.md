# 桌面任务挂件

中文 | [English](README.md)

一只无边框、置顶的鲸鱼，报告当前会话的进度：回合阶段、正在运行的工具、待办进度、目标轮次，以及 token 与耗时统计。

挂件是 `apps/desktop` 里一个自成一体的功能。它不改动 `packages/` 下的任何 harness 代码：它消费的是主窗口本就在用的同一个回环后端，而它贡献的那个插件安装进用户自己的 profile，而不是仓库。

## 文件构成

| 文件 | 职责 |
|---|---|
| `window.mjs` | Electron 宿主：开窗，负责位置持久化与点击穿透，并统一停止一切。 |
| `host.mjs` | 数据面：把会话流折叠成每会话的进度记录，并提供挂件自己的 HTTP 接口。 |
| `view.mjs` | 展示逻辑：立绘选择、文案标签、音效提示、气泡收起。不含 DOM，因此可直接测试。 |
| `renderer.js` | 把最新快照画进 DOM，并驱动指针命中判定。 |
| `preload.cjs` | 把渲染层的指针命中判定与音效指令桥接到宿主。 |
| `index.html`、`widget.css` | 渲染界面的结构与样式。 |
| `install.mjs` | 把设置面板接进 profile：插件包与它的 loader 行。 |
| `home.mjs` | 用与所生成后端相同的方式解析 harness home。 |
| `plugin/` | 设置面板：node 半身注册 `desktop-widget` 命名空间，浏览器半身渲染开关。 |
| `assets/` | 上游立绘与音效；授权与逐文件职责见 `PROVENANCE.md`。 |

工作态立绘本身画着一个思路气泡，气泡内容就定位在它里面，是透明的居中文字而非独立面板——独立面板等于在画好的气泡上再摞一个气泡。只有这张立绘带气泡，所以结束态（庆祝与失败）改为让文字自带一块深色底。几何因此写在 `.bubble[data-art="…"]` 规则里而不进基础规则——后者只可能满足其中一张立绘。这给 `widget.css` 带来两条别处无人保证的约束：气泡的 `z-index` 必须高于立绘（立绘在 DOM 中位于其后），以及 `[hidden]` 需要 `!important` 才能压过各元素自身 class 设定的 `display`。两条都由 `widget.test.mjs` 断言。

`assets/DSH2.png` 与 `assets/rua.gif` 目前未被引用：前者是早先深色面板的水印横幅，后者与正在使用的 `bubble-petpet.gif` 是同一个揉头动作。它们仍随包发布，以便日后新增状态时无需再次回上游取用。

逻辑放在 `view.mjs`，是为了让那些容易出错的判断无需开窗即可断言：某个阶段对应哪张立绘、一次状态迁移该播哪个音效、气泡何时收起、该显示哪个会话。`renderer.js` 只负责 DOM；`apps/desktop/tests/widget-view.test.mjs` 覆盖逻辑。

## 数据流

宿主在订阅后端源上的 `/api/events.mux`，并把两类帧折叠成每会话一条记录：

- `session/event` —— `turn/start`、`step/start`、`tool/call`、`tool/result`、`assistant/message`、`turn/end`。它们驱动阶段、运行中的工具行与耗时。
- `session/projection` —— `todos`、`goal`、`sessionStats`、`title`、`tokenUsage`。

投影帧携带的是当前完整取值且后写覆盖，所以折叠它们是赋值而非累加。token 总数只来自 `tokenUsage` 投影：若同时把逐步的 `assistant/message` 用量也折叠进去，会把同一批 token 重复计一次。

数据流只推变化，因此任务进行中才打开的挂件会是空的。`seedBaseline` 会读一次 `session.list`，把每个会话的投影块回放进记录里。

渲染层轮询 `GET /widget/state`；宿主提供该路由以及挂件自身的静态资源，窗口从绑定在系统分配端口上的回环套接字加载二者。该路由是只读的：它只暴露从会话日志推导出的进度，不提供任何写入路径。widget 目录之外的路径以 403 拒绝。

## 交互

窗口比它的立绘更大，且初始为点击穿透：渲染层对鲸鱼与气泡的矩形做命中判定，并通过 preload 桥上报指针进出，因此只有绘制出来的部分会接收点击。拖动窗口任意位置即可移动，位置在移动时保存，并在关闭时再存一次。

双击气泡切换音效，头部以静音标记指示。不使用单击，是因为那会在普通拖动过程中把挂件静音。

在任意绘制区域上右键会打开菜单：隐藏、静音、退出。窗口无边框且不进任务栏，没有这个菜单就没有办法收起或关闭它。拖动由 preload 桥按指针位移驱动，而不是用 `-webkit-app-region: drag`——Windows 会把拖动区域当作标题栏，并在页面看到之前就吃掉其中的右键。

## 设置

开关在主窗口的设置面板里，位于「桌面挂件」。切换后挂件会在一两秒内启停，既不用重启应用，也不用重启后端。

那个面板是一个 client 插件，这正是 `install.mjs` 与 `plugin/` 存在的原因。client 插件的浏览器半身由 `/plugins/<包名>/client.js` 提供，而 client-modules 扫描器只通过一个 loader 行来发现它，该行的 `name` 必须是从 `profiles/node_modules` 可解析的包名。所以面板需要把包复制进用户 profile，再加一行指向它，这两件事都由桌面宿主在后端启动之前完成——后端只在启动过程中才会看到这个插件。

`plugin/` 里有三处细节是承重的，且都不显然：

- bundle 以**包名**注册自己，而不是 loader 行的 `id`。用别的名字注册会让整个插件树以 "loaded without registering" 失败。
- 设置 schema 是 **schemastery**，不是 zod，且它没有 `.shape`——字段名来自 `.dict`。
- 面板走 `/desktop-widget/config` 而不是通用设置 RPC，因为 `dsh-host-apiproxy` 把那个 RPC 挡在一个插件无法扩展的命名空间白名单后面。

启动时以存储的设置为准，本地 `widget.enabled` 配置只在面板完全没装上时作为回退。从托盘或右键菜单手动退出后会保持退出：监视器只对存储值的**变化**作出反应，因此它不会覆盖一次刻意的关闭。

## 新增一个指标

在 `applyProjection` 里加一个分支（若是日志形态的值则加到 `applyEvent`），把它纳入 `snapshotOf`，然后渲染出来。未知的投影键会被忽略而不是近似处理，因此缺少相应插件的部署只会让气泡的那部分保持为空。

唯一不显然的约束：投影键是会话投影接缝自己的词汇。要核对拥有该键的插件声明的名字，而不是猜一个——这个挂件最初找的是 `sessionTitle`，而该接缝发布的是 `title`，于是安静地什么都不显示。

## 移除挂件

该功能限定在这个目录加上外部几处触点。全部删除即可完整摘除：

1. 删除 `apps/desktop/widget/`。
2. 删除 `apps/desktop/tests/widget.test.mjs`、`apps/desktop/tests/widget-view.test.mjs` 与 `apps/desktop/tests/widget-settings.test.mjs`。
3. 从 `apps/desktop/main.mjs` 移除 `./widget/window.mjs`、`./widget/install.mjs`、`./widget/home.mjs` 三行 `import`，以及 `widgetOptions`、`readWidgetSettings`、`watchWidgetSettings`、`startWidget` 调用块、`widget` 变量和 `will-quit` 处理器里的 `widget?.close()` 一行。
4. 从 `apps/desktop/config.mjs` 的 `defaultConfig` 与 `normalizeConfig` 中移除 `widget` 分组。
5. 从 `apps/desktop/package.json` 的 `files` 中移除 `"widget"`，并还原 `apps/desktop/tests/package-staging.test.mjs` 中期望的目录列表。

如果应用已经运行过，插件包与它的 loader 行也已经落在用户 profile 里。`install.mjs` 导出的 `uninstall` 会精确移除它加进去的东西，并把 patch 文件逐字节还原；跑一次即可，或直接删除 `<DSH_HOME>/profiles/node_modules/dsh-plugin-desktop-widget` 与 `<DSH_HOME>/profiles/web/cordis.patch.yml` 里那段 `desktop widget` 围栏块。

由于立绘不是 MIT 授权，第 1 步同时也是让它不进入开源发布的手段——发布前先读 `PROVENANCE.md`。
