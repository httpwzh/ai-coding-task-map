const VERSION = 1;
const TASK_STATES = new Set(['pending', 'in_progress', 'completed', 'blocked']);
const clipped = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const validPosition = (value) => value && Number.isFinite(value.x) && Number.isFinite(value.y)
  && Math.abs(value.x) < 100000 && Math.abs(value.y) < 100000;

export function emptyProjectDraft() {
  return { tasks: [], notes: {}, positions: {} };
}

export function projectDraftKey(projectKey) {
  return `local-task-map:draft:v${VERSION}:${encodeURIComponent(projectKey)}`;
}

export function readProjectDraft(projectKey, storage) {
  try {
    const raw = JSON.parse((storage ?? globalThis.localStorage).getItem(projectDraftKey(projectKey)));
    if (raw?.version !== VERSION) return emptyProjectDraft();
    const tasks = [];
    const ids = new Set();
    for (const task of Array.isArray(raw.tasks) ? raw.tasks.slice(0, 400) : []) {
      const id = clipped(task?.id, 100);
      const title = clipped(task?.title, 160) || '未命名任务';
      if (!id.startsWith('local:') || ids.has(id)) continue;
      ids.add(id);
      tasks.push({ id, parentId: clipped(task.parentId, 160), title,
        note: clipped(task.note, 2000), status: TASK_STATES.has(task.status) ? task.status : 'pending' });
    }
    const notes = {};
    for (const [id, value] of Object.entries(raw.notes && typeof raw.notes === 'object' ? raw.notes : {})) {
      if (id.length <= 160 && typeof value === 'string' && value.trim()) notes[id] = clipped(value, 2000);
    }
    const positions = {};
    for (const [id, value] of Object.entries(raw.positions && typeof raw.positions === 'object' ? raw.positions : {})) {
      if (id.length <= 160 && validPosition(value)) positions[id] = { x: value.x, y: value.y };
    }
    return { tasks, notes, positions };
  } catch {
    return emptyProjectDraft();
  }
}

export function saveProjectDraft(projectKey, draft, storage) {
  (storage ?? globalThis.localStorage).setItem(projectDraftKey(projectKey), JSON.stringify({ version: VERSION, ...draft }));
}

export function mergeProjectDraft(model, draft) {
  const nodes = [...model.nodes];
  const edges = [...model.edges];
  const known = new Set(nodes.map((node) => node.id));
  const rootId = nodes[0]?.id;
  let done = 0;
  for (const task of draft.tasks) {
    if (known.has(task.id)) continue;
    const parentId = known.has(task.parentId) ? task.parentId : rootId;
    nodes.push({ id: task.id, position: { x: 0, y: 0 }, data: {
      kind: 'local', label: '本地任务', title: task.title, status: task.status,
      detail: task.note, summary: task.note || '浏览器本地草稿', source: '浏览器本地草稿', workItem: false,
    } });
    if (parentId) edges.push({ id: `${parentId}->${task.id}`, source: parentId, target: task.id, kind: 'hierarchy' });
    known.add(task.id);
    if (task.status === 'completed') done += 1;
  }
  return { ...model, nodes, edges, localStats: { total: nodes.length - model.nodes.length, done } };
}

export function removeLocalTask(draft, taskId) {
  const removed = new Set([taskId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of draft.tasks) if (removed.has(task.parentId) && !removed.has(task.id)) {
      removed.add(task.id);
      changed = true;
    }
  }
  return { ...draft, tasks: draft.tasks.filter((task) => !removed.has(task.id)),
    positions: Object.fromEntries(Object.entries(draft.positions).filter(([id]) => !removed.has(id))) };
}
