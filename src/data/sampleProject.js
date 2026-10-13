import { sampleDshSession } from './dshSampleSession.js';

const goal = (seq, objective, phase) => ({ type: 'goal/change', seq, time: Date.parse('2026-02-21T10:20:00+08:00'),
  data: { goal: { id: `demo-${seq}`, revision: 1, objective, phase } } });
const checklist = (seq, todos) => ({ type: 'todo/write', seq, time: Date.parse('2026-02-21T10:30:00+08:00'), data: { todos } });
const firstEvents = [goal(20, '完成项目级任务图', 'active'), checklist(21, [
  { content: '汇总跨会话记录', status: 'completed' }, { content: '核对项目交付', status: 'in_progress' },
])];
const secondEvents = [goal(30, '完善交互和本地任务', 'active'), checklist(31, [
  { content: '拖动画布与节点', status: 'in_progress' }, { content: '验证移动端交互', status: 'pending' },
])];

export const sampleProject = {
  key: 'offline:sample-project', title: '任务图示例项目', cwd: '本地示例（非 DSH）', scope: 'sample',
  currentSessionId: sampleDshSession.sessionId, catalogPending: false, loading: false, maxEventsPerSession: 1600,
  sessions: [
    { sessionId: sampleDshSession.sessionId, title: sampleDshSession.title, status: 'ready',
      eventCount: firstEvents.length, events: firstEvents },
    { sessionId: 'demo-session-002', title: '项目级交互', status: 'ready', parentSessionId: sampleDshSession.sessionId,
      eventCount: secondEvents.length, events: secondEvents },
  ],
};
