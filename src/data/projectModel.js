const GOAL_STATES = { active: '进行中', paused: '已暂停', blocked: '受阻', complete: '声明完成' };
const TODO_STATES = { pending: '待处理', in_progress: '进行中', completed: '声明完成' };

function text(value, max = 150) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function humanPrompt(event) {
  if (event.data?.source?.kind !== 'user') return '';
  const content = event.data?.content;
  if (Array.isArray(content)) return text(content.filter((block) => block?.type === 'text').map((block) => block.text).join(' '));
  return text(content);
}

function uniqueEvents(sessions) {
  const bySession = new Map();
  for (const session of sessions) {
    const bySeq = new Map();
    for (const event of session.events || []) {
      if (Number.isSafeInteger(event.seq) && event.seq >= 0) bySeq.set(event.seq, event);
    }
    bySession.set(session.sessionId, bySeq);
  }
  const duplicate = (session, event) => {
    const visited = new Set([session.sessionId]);
    let ancestor = session.parentSessionId;
    while (ancestor && !visited.has(ancestor)) {
      visited.add(ancestor);
      const earlier = bySession.get(ancestor)?.get(event.seq);
      if (earlier && earlier.type === event.type && earlier.time === event.time && JSON.stringify(earlier.data) === JSON.stringify(event.data)) return true;
      ancestor = sessions.find((item) => item.sessionId === ancestor)?.parentSessionId;
    }
    return false;
  };
  return sessions.map((session) => ({ ...session,
    events: [...(bySession.get(session.sessionId)?.values() || [])].filter((event) => !duplicate(session, event)).sort((a, b) => a.seq - b.seq),
  }));
}

export function normalizeProject(project) {
  if (!project) return null;
  const sessions = uniqueEvents(project.sessions || []);
  const nodes = [];
  const edges = [];
  const stats = { sessions: sessions.length, read: 0, pending: 0, failed: 0, incomplete: 0,
    goals: 0, claimedGoals: 0, todos: 0, claimedTodos: 0 };
  const rootId = `project:${project.key}`;
  const add = (id, parent, data) => {
    nodes.push({ id, position: { x: 0, y: 0 }, data: { ...data, workItem: false } });
    if (parent) edges.push({ id: `${parent}->${id}`, source: parent, target: id, kind: 'hierarchy' });
  };
  add(rootId, null, { kind: 'project', title: project.title || '当前项目', label: '项目',
    status: 'unknown', summary: project.cwd || '工作区', source: project.scope === 'workspace' ? 'DSH 工作区成员列表' : project.scope === 'directory' ? '目录范围（推断）' : '会话归属未确定' });
  const sessionIds = new Set(sessions.map((item) => item.sessionId));
  for (const session of sessions) {
    const id = `session:${session.sessionId}`;
    let parent = session.parentSessionId;
    const seen = new Set([session.sessionId]);
    while (parent && sessionIds.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      parent = sessions.find((item) => item.sessionId === parent)?.parentSessionId;
    }
    const safeParent = session.parentSessionId && sessionIds.has(session.parentSessionId) && !seen.has(parent) ? session.parentSessionId : null;
    // Missing or cyclic lineage stays at the project root.
    add(id, safeParent ? `session:${safeParent}` : rootId, {
      kind: 'session', title: text(session.title || '未命名会话', 85), label: '会话',
      status: session.status, summary: session.status === 'error' ? session.error : `${session.eventCount || 0} 条历史事件已读取`,
      source: session.sessionId, sessionId: session.sessionId, updatedAt: session.updatedAt,
      incomplete: session.incomplete, error: session.error,
    });
    if (session.status === 'ready') stats.read += 1;
    else if (session.status === 'error') stats.failed += 1;
    else stats.pending += 1;
    if (session.incomplete) stats.incomplete += 1;

    const goals = new Map();
    let todo = null;
    let prompt = null;
    for (const event of session.events) {
      if (event.type === 'goal/change') {
        const goalId = event.data?.goal?.id || event.data?.cleared?.id;
        if (goalId) goals.set(goalId, event);
      } else if (event.type === 'todo/write') todo = event;
      else if (event.type === 'user/message' && event.data?.source?.kind === 'user' && !prompt) prompt = event;
    }
    for (const [goalId, event] of goals) {
      const goal = event.data?.goal;
      if (!goal || event.data.operation === 'clear') continue;
      stats.goals += 1;
      if (goal.phase === 'complete') stats.claimedGoals += 1;
      add(`goal:${session.sessionId}:${goalId}`, id, { kind: 'goal', label: '记录目标',
        title: text(goal.objective, 85), summary: `${GOAL_STATES[goal.phase] || '状态未知'} · 修订 ${goal.revision || '?'}`,
        status: goal.phase, source: `${session.sessionId}#${event.seq}`, time: event.time,
        detail: text(goal.objective, 700), error: goal.blockedReason?.message });
    }
    if (Array.isArray(todo?.data?.todos)) {
      const items = todo.data.todos;
      const groupId = `checklist:${session.sessionId}`;
      add(groupId, id, { kind: 'checklist', label: '最近清单快照', title: '任务清单',
        status: 'unknown', summary: `${items.length} 项 · 会话最后一次记录，不等于当前项目清单`,
        source: `${session.sessionId}#${todo.seq}`, time: todo.time });
      items.forEach((item, index) => {
        if (!text(item.content) || !Object.hasOwn(TODO_STATES, item.status)) return;
        stats.todos += 1;
        if (item.status === 'completed') stats.claimedTodos += 1;
        add(`todo:${session.sessionId}:${todo.seq}:${index}`, groupId, { kind: 'todo', label: '记录任务',
          title: text(item.content, 85), detail: text(item.content, 700), status: item.status,
          summary: TODO_STATES[item.status], source: `${session.sessionId}#${todo.seq}`,
          time: todo.time, sessionId: session.sessionId });
      });
    }
    const request = prompt && humanPrompt(prompt);
    if (request && goals.size === 0 && !todo) {
      add(`request:${session.sessionId}:${prompt.seq}`, id, { kind: 'request', label: '用户需求线索',
        title: text(request, 85), detail: request, summary: '未记录结构化目标或清单',
        status: 'unknown', source: `${session.sessionId}#${prompt.seq}`, time: prompt.time });
    }
  }
  return { nodes, edges, stats, sessions };
}
