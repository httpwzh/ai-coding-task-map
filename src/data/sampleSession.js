export const sessionInfo = {
  title: '实现任务图原型',
  repo: 'dsh思维导图',
  updatedAt: '刚刚更新',
  progress: '6 / 8 个事件已完成',
};

export const initialNodes = [
  {
    id: 'question-1',
    type: 'task',
    position: { x: 40, y: 180 },
    data: { kind: 'question', label: '用户问题', title: '实现任务图原型', status: 'success', time: '10:02', summary: '希望把线性 AI 编程对话转换成可阅读的任务图。', files: [], ref: 'message-001' },
  },
  {
    id: 'analysis-1',
    type: 'task',
    position: { x: 310, y: 180 },
    data: { kind: 'analysis', label: 'AI 分析', title: '拆解 MVP 范围', status: 'success', time: '10:03', summary: '确定先使用假数据，完成图形视图、线性视图和节点详情。', files: ['docs/product-definition.md'], ref: 'message-002' },
  },
  {
    id: 'fork-1',
    type: 'task',
    position: { x: 580, y: 80 },
    data: { kind: 'subtask', label: '子任务', title: '设计节点模型', status: 'success', time: '10:05', summary: '定义问题、分析、工具、文件和测试等节点类型。', files: ['src/data/sampleSession.js'], ref: 'fork-001' },
  },
  {
    id: 'fork-2',
    type: 'task',
    position: { x: 580, y: 280 },
    data: { kind: 'subtask', label: '子任务', title: '搭建 React Flow 画布', status: 'success', time: '10:06', summary: '加入节点拖动、缩放、选中和画布控制。', files: ['src/App.jsx', 'src/styles.css'], ref: 'fork-002' },
  },
  {
    id: 'tool-1',
    type: 'task',
    position: { x: 860, y: 80 },
    data: { kind: 'tool', label: '工具调用', title: '创建原型文件', status: 'success', time: '10:09', summary: '创建页面入口、假数据和样式文件。', files: ['index.html', 'src/main.jsx'], ref: 'tool-001' },
  },
  {
    id: 'file-1',
    type: 'task',
    position: { x: 1140, y: 80 },
    data: { kind: 'file', label: '文件修改', title: '完成页面骨架', status: 'success', time: '10:12', summary: '页面已经可以显示任务图和详情面板。', files: ['src/App.jsx'], ref: 'tool-002' },
  },
  {
    id: 'test-1',
    type: 'task',
    position: { x: 860, y: 280 },
    data: { kind: 'test', label: '测试结果', title: '等待浏览器验证', status: 'waiting', time: '10:15', summary: '需要启动开发服务器，确认拖动、折叠和视图切换。', files: [], ref: 'test-001' },
  },
  {
    id: 'failure-1',
    type: 'task',
    position: { x: 1140, y: 280 },
    data: { kind: 'test', label: '测试结果', title: '旧版布局尝试', status: 'failed', time: '10:14', summary: '第一版布局在窄屏上拥挤，已保留记录并准备调整。', files: ['src/styles.css'], ref: 'test-000' },
  },
];

export const initialEdges = [
  { id: 'e1', source: 'question-1', target: 'analysis-1', label: '分析' },
  { id: 'e2', source: 'analysis-1', target: 'fork-1', label: '分支 A' },
  { id: 'e3', source: 'analysis-1', target: 'fork-2', label: '分支 B' },
  { id: 'e4', source: 'fork-1', target: 'tool-1', label: '执行' },
  { id: 'e5', source: 'tool-1', target: 'file-1', label: '产生' },
  { id: 'e6', source: 'fork-2', target: 'test-1', label: '验证' },
  { id: 'e7', source: 'test-1', target: 'failure-1', label: '发现问题' },
];
