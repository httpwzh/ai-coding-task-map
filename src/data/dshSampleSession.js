// This fixture follows the DSH SessionEvent envelope: type, seq, time, data.
// The payloads are intentionally small so a beginner can compare them with a
// real read-only session window while learning the adapter.
const at = (value) => Date.parse(`2026-02-21T${value}+08:00`);

export const sampleDshSession = {
  sessionId: 'demo-session-001',
  title: '实现任务图原型',
  cwd: 'D:/wzh/deepseekharness/dsh思维导图',
  events: [
    {
      type: 'user/message',
      seq: 1,
      time: at('10:02:00'),
      data: {
        source: { kind: 'user' },
        taskId: 'question-1',
        title: '实现任务图原型',
        content: '希望把线性 AI 编程对话转换成可阅读的任务图。',
      },
    },
    {
      type: 'assistant/message',
      seq: 2,
      time: at('10:03:00'),
      data: {
        taskId: 'analysis-1',
        title: '拆解 MVP 范围',
        content: '确定先使用假数据，完成图形视图、线性视图和节点详情。',
        files: ['docs/product-definition.md'],
      },
    },
    {
      type: 'subagent/descriptor',
      seq: 3,
      time: at('10:05:00'),
      data: {
        taskId: 'fork-1',
        title: '设计节点模型',
        objective: '定义问题、分析、工具、文件和测试等节点类型。',
        summary: '定义问题、分析、工具、文件和测试等节点类型。',
        parentEventSeq: 2,
      },
    },
    {
      type: 'subagent/descriptor',
      seq: 4,
      time: at('10:06:00'),
      data: {
        taskId: 'fork-2',
        title: '搭建图形画布',
        objective: '加入节点选中、折叠和图形视图。',
        summary: '加入节点选中、折叠和图形视图。',
        parentEventSeq: 2,
      },
    },
    {
      type: 'tool/call',
      seq: 5,
      time: at('10:09:00'),
      data: {
        taskId: 'tool-1',
        title: '创建原型文件',
        toolName: 'write_files',
        summary: '创建页面入口、假数据和样式文件。',
        files: ['index.html', 'src/main.jsx'],
        parentEventSeq: 3,
      },
    },
    {
      type: 'workspace/changes',
      seq: 6,
      time: at('10:12:00'),
      data: {
        taskId: 'file-1',
        title: '完成页面骨架',
        summary: '页面已经可以显示任务图和详情面板。',
        changes: [
          { path: 'src/App.jsx', kind: 'modified' },
          { path: 'src/styles.css', kind: 'modified' },
        ],
        parentEventSeq: 5,
      },
    },
    {
      type: 'approval/asked',
      seq: 7,
      time: at('10:15:00'),
      data: {
        taskId: 'test-1',
        title: '等待浏览器验证',
        question: '需要启动开发服务器，确认拖动、折叠和视图切换。',
        status: 'waiting',
        parentEventSeq: 4,
      },
    },
    {
      type: 'tool/result',
      seq: 8,
      time: at('10:14:00'),
      data: {
        taskId: 'failure-1',
        taskKind: 'test',
        title: '旧版布局尝试',
        summary: '第一版布局在窄屏上拥挤，已保留记录并准备调整。',
        ok: false,
        error: '窄屏布局拥挤',
        files: ['src/styles.css'],
        parentEventSeq: 7,
      },
    },
    {
      type: 'turn/end',
      seq: 9,
      time: at('10:16:00'),
      data: { status: 'waiting' },
    },
  ],
};
