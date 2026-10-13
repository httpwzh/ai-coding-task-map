# DSH 会话数据映射

这份文档记录本机安装版 DeepSeek Harness 的只读研究结果，以及任务图当前转换层的边界。研究对象是安装包 `resources/app.asar` 中的模块，没有修改 DSH 文件、会话或插件配置。

## 已确认的会话结构

DSH 的 Session 事件是一个带信封的记录，核心字段如下：

| DSH 字段 | 用途 | 任务图处理方式 |
| --- | --- | --- |
| `type` | 事件类型 | 决定节点类型和中文标签 |
| `seq` | 会话内递增序号 | 生成稳定的原始引用 `sessionId#seq` |
| `time` | 事件时间 | 显示在卡片和线性视图 |
| `data` | 事件正文 | 提取标题、摘要、状态和文件 |
| `ignorable` | 新事件的兼容标记 | 保留在原始记录中，当前不会把未知事件强行画成节点 |
| `surfaceOp` | 会话表面消息的操作信息 | 当前只保留事件引用，暂不折叠消息替换关系 |
| `sourceEventSeqs` | 关联的较早事件序号 | 在没有显式父事件时作为适配层的关系提示 |

History 页记录的形状是 `{ type: 'event', event }`，因此转换器会自动解包这种形式，也接受直接的事件数组。Session 的事件窗口快照包含 `entries`、`hasMore`、`revision` 和 `change`；未来接入时优先读取 `entries`，并把 `hasMore` 交给分页层处理。

Session 列表摘要可以提供这些信息：

- `sessionId`
- `parentSessionId`（列表实现中的来源字段是 `parentSession`）
- `origin`
- `cwd`
- `title`、`blank`、`lastPromptAt`

`parentSessionId` 用来建立会话之间的父子关系。它和一条会话内部的事件边是两层关系，当前 MVP 先在单会话内画图，并把 `parentSessionId` 放进 `sessionInfo` 供下一阶段使用。

## 事件到任务节点的映射

DSH 已知的事件词汇包括 `user/message`、`assistant/message`、`tool/call`、`tool/result`、`workspace/changes`、`subagent/descriptor`、`command/run`、`command/done`、`approval/asked`、`approval/decided`、`todo/write` 和 `goal/change` 等。转换层当前采用下面的规则：

| DSH 事件 | 默认节点 | 默认状态 |
| --- | --- | --- |
| `user/message` | 用户问题 | 已完成 |
| `assistant/message`、`assistant/attempt` | AI 分析 | 已完成 / 进行中 |
| `subagent/descriptor`、`subagent/catalog` | 子任务 | 已完成 |
| `tool/call`、`tool/ptc-dispatch*` | 工具调用 | 已完成 / 进行中 |
| `tool/result` | 工具调用 | 根据 `ok`、`success`、`error` 判断 |
| `workspace/changes` | 文件修改 | 已完成 |
| `command/run` | 工具调用 | 已完成 |
| `command/done`、`hook/result` | 测试结果 | 根据结果判断 |
| `approval/asked` | 测试结果 | 等待确认 |
| `approval/decided` | 测试结果 | 根据决定判断 |
| `todo/write`、`goal/change` | AI 分析 | 已完成 |

`turn/start`、`turn/end`、`step/start`、`step/end`、标题和压缩边界等事件仍然计入诊断中的原始事件数，但默认不单独生成卡片。这样可以解释“原始事件数量”和“画布节点数量”的差异，也避免把内部边界画成任务。

文件提取只读取事件正文中常见的 `path`、`file`、`filePath`、`paths`、`files`、`changes`、`added`、`modified`、`deleted` 等字段，最多显示 12 个路径。未知正文仍然保留原始类型和引用，读取失败时不会影响图形组件。

## 当前转换层

[src/data/normalizeSession.js](../src/data/normalizeSession.js) 是唯一负责 DSH 形状到画布模型的地方。它输出：

- `sessionInfo`：会话身份、标题、工作目录名、进度和诊断数量。
- `nodes`：画布现在使用的 `id`、`position`、`data.kind`、`data.status`、`data.summary`、`data.files`、`data.ref`。
- `edges`：`sequence`、`branch`、`child-task` 三类关系，并带有显示标签。
- `diagnostics`：原始事件数、渲染节点数、忽略数量和暂不支持的类型。

真实事件的正文没有统一的“任务父节点”字段，因此转换器先按事件顺序连接节点；如果正文提供 `parentEventSeq` / `parentSeq`，或事件信封带有 `sourceEventSeqs`，才会建立显式关系。固定样例中的 `parentEventSeq` 是为了演示关系的适配提示，不把它当成 DSH 核心事件协议的必选字段。

[src/data/dshSampleSession.js](../src/data/dshSampleSession.js) 使用真实的 DSH 信封字段组织一段固定样例。通过 [src/data/sampleSession.js](../src/data/sampleSession.js) 转换后，现有图形视图继续只认识自己的节点模型，因此以后替换数据来源不需要重写画布。

## 已确认的接入点

DSH 安装包包含 `@deepseek-ai/dsh-api-session-controller`，其中 `Session` 保持事件窗口、投影快照和会话状态；它对外的 `SessionFace` 设计让功能层读取一个会话切片，而不是直接操作 React 组件。文件候选由 `sessionFileReferences.list(agent, query, signal)` 提供。

DSH 也包含插件管理器和 Cordis 插件加载器。内置的插件开发模板说明了一个本地插件包的最小形状：

```json
{
  "name": "@local/my-plugin",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js", "./client": "./client.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-ui-conversation"]
    }
  }
}
```

客户端模块通过 `window.__ModuleLoader__.load()` 注册，使用 `ctx.slots.inject()` 和 `ctx.slots.register()` 把 React 组件插入 DSH 的已有槽位。插件管理页面支持安装 npm 包、GitHub 地址或本地目录，实际运行入口仍然要通过 DSH 插件包和 patch 配置加载。

因此下一阶段的安全路径是：

1. 用插件的客户端槽位提供“打开任务图”入口。
2. 在插件上下文内读取已公开的 Session Controller 快照或历史窗口。
3. 把只读事件交给 `normalizeDshSession()`。
4. 任务图自身继续只渲染统一节点模型，不调用写入、发送、取消或重命名 API。

当前原型停在第 3 步之前，使用固定样例验证转换结果；它还没有伪装成 DSH 插件，也没有尝试访问运行中的 DSH 页面。
