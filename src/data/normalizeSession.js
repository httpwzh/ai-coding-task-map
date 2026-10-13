const EVENT_RULES = {
  'user/message': { kind: 'question', label: '用户问题' },
  'assistant/message': { kind: 'analysis', label: 'AI 分析' },
  'assistant/attempt': { kind: 'analysis', label: 'AI 分析', status: 'running' },
  'subagent/descriptor': { kind: 'subtask', label: '子任务' },
  'subagent/catalog': { kind: 'subtask', label: '子任务' },
  'tool/call': { kind: 'tool', label: '工具调用' },
  'tool/ptc-dispatch': { kind: 'tool', label: '工具调用' },
  'tool/ptc-dispatch-start': { kind: 'tool', label: '工具调用', status: 'running' },
  'tool/result': { kind: 'tool', label: '工具结果' },
  'workspace/changes': { kind: 'file', label: '文件修改' },
  'command/run': { kind: 'tool', label: '命令执行' },
  'command/done': { kind: 'test', label: '命令结果' },
  'approval/asked': { kind: 'test', label: '等待确认', status: 'waiting' },
  'approval/decided': { kind: 'test', label: '确认结果' },
  'hook/invoked': { kind: 'tool', label: 'Hook 调用' },
  'hook/result': { kind: 'test', label: 'Hook 结果' },
  'todo/write': { kind: 'analysis', label: '任务清单' },
  'goal/change': { kind: 'analysis', label: '目标更新' },
};

const IGNORED_EVENT_TYPES = new Set([
  'turn/start',
  'turn/end',
  'step/start',
  'step/end',
  'session/title',
  'model/selection',
  'compaction/start',
  'compaction/end',
]);

const STATUS_VALUES = new Set(['success', 'running', 'failed', 'waiting', 'pending', 'in-progress']);

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function shortText(value, maximum = 120) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

function firstLine(value) {
  const text = String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return shortText(text);
}

function contentText(value, depth = 0) {
  if (depth > 3 || value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((item) => contentText(item, depth + 1)).filter(Boolean).join(' ');
  if (!isObject(value)) return '';

  for (const key of ['text', 'content', 'summary', 'message', 'question', 'description', 'output', 'result', 'reason']) {
    const candidate = contentText(value[key], depth + 1);
    if (candidate) return candidate;
  }
  return '';
}

function payloadOf(event) {
  return isObject(event?.data) ? event.data : {};
}

function valueFrom(payload, keys) {
  for (const key of keys) {
    const value = payload?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function pathLike(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return text.length > 0 && !text.includes('\n') && text.length < 500;
}

function collectPaths(value, output = [], key = '', depth = 0) {
  if (depth > 4 || value == null) return output;
  const pathKeys = new Set(['path', 'file', 'filePath', 'pathname', 'paths', 'files', 'changed', 'changes', 'added', 'modified', 'deleted', 'created', 'removed']);
  if (typeof value === 'string') {
    if (pathKeys.has(key) && pathLike(value)) output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectPaths(item, output, key, depth + 1));
    return output;
  }
  if (!isObject(value)) return output;
  Object.entries(value).forEach(([childKey, childValue]) => collectPaths(childValue, output, childKey, depth + 1));
  return output;
}

function filesFor(event) {
  const files = collectPaths(payloadOf(event));
  return [...new Set(files)].slice(0, 12);
}

function formatTime(value) {
  if (value === undefined || value === null || value === '') return '—';
  const numeric = typeof value === 'number' ? value : Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function displayName(value) {
  if (!value) return '';
  const normalized = String(value).replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).filter(Boolean).pop() || normalized;
}

function statusFor(event, rule) {
  const payload = payloadOf(event);
  const explicit = valueFrom(payload, ['status', 'state']);
  if (explicit === 'pending') return 'waiting';
  if (explicit === 'in-progress') return 'running';
  if (STATUS_VALUES.has(explicit)) return explicit;
  if (rule.status) return rule.status;
  if (payload.ok === false || payload.success === false || payload.error || payload.errorMessage) return 'failed';
  if (event.type === 'approval/decided' && ['rejected', 'denied', 'cancelled'].includes(payload.decision)) return 'failed';
  return 'success';
}

function projectFields(event, kind, status) {
  const payload = payloadOf(event);
  const phaseDefaults = {
    question: '范围定义',
    analysis: '规划拆解',
    subtask: '任务分解',
    tool: '实现执行',
    file: '交付产物',
    test: '验证收尾',
  };
  return {
    phase: shortText(valueFrom(payload, ['phase', 'stage', 'milestone']) || phaseDefaults[kind] || '未分组', 24),
    priority: shortText(valueFrom(payload, ['priority', 'level']) || (kind === 'question' || status === 'failed' ? 'P0' : 'P1'), 12),
    owner: shortText(valueFrom(payload, ['owner', 'assignee', 'agentName']) || (kind === 'question' ? '用户' : 'AI'), 24),
    risk: shortText(valueFrom(payload, ['risk', 'riskLevel']) || (status === 'failed' ? '高' : status === 'waiting' ? '中' : '低'), 12),
    workItem: true,
  };
}

function titleFor(event, rule, summary, files) {
  const payload = payloadOf(event);
  const explicit = valueFrom(payload, ['title', 'label', 'name']);
  if (explicit) return shortText(explicit, 72);

  if (event.type === 'user/message') return firstLine(summary) || '用户问题';
  if (event.type === 'assistant/message') return firstLine(summary) || 'AI 分析';
  if (event.type === 'subagent/descriptor') return `子任务：${shortText(valueFrom(payload, ['task', 'objective', 'description']) || '未命名', 52)}`;
  if (event.type === 'tool/call' || event.type.startsWith('tool/ptc')) return `调用 ${shortText(valueFrom(payload, ['toolName', 'tool', 'command']) || '工具', 52)}`;
  if (event.type === 'workspace/changes') return files.length ? `修改 ${files.length} 个文件` : '工作区发生变更';
  if (event.type === 'command/run') return `运行 ${shortText(valueFrom(payload, ['command', 'name']) || '命令', 52)}`;
  if (event.type === 'command/done') return '命令执行完成';
  if (event.type === 'approval/asked') return '等待确认';
  if (event.type === 'approval/decided') return '确认结果';
  if (event.type === 'tool/result') return statusFor(event, rule) === 'failed' ? '工具执行失败' : '工具执行完成';
  return rule.label;
}

function summaryFor(event, files) {
  const payload = payloadOf(event);
  const explicit = valueFrom(payload, ['summary', 'description', 'objective', 'message', 'question', 'reason', 'command']);
  if (explicit) return shortText(contentText(explicit));
  if (event.type === 'workspace/changes' && files.length) return `DSH 记录了 ${files.length} 个文件或路径的工作区变化。`;
  return shortText(contentText(payload)) || `DSH 事件：${event.type}`;
}

function unwrapEvent(record) {
  if (isObject(record?.event) && typeof record.event.type === 'string') return record.event;
  if (record?.type === 'event' && isObject(record.event)) return record.event;
  return record;
}

function sequenceOf(event, fallback) {
  return Number.isSafeInteger(event?.seq) ? event.seq : fallback;
}

function parentSequenceOf(event) {
  const payload = payloadOf(event);
  const explicit = valueFrom(payload, ['parentEventSeq', 'parentSeq', 'sourceEventSeq']);
  if (Number.isSafeInteger(explicit)) return explicit;
  if (Array.isArray(event?.sourceEventSeqs) && Number.isSafeInteger(event.sourceEventSeqs[0])) return event.sourceEventSeqs[0];
  return undefined;
}

function edgeLabel(node) {
  if (node.data.kind === 'analysis') return '分析';
  if (node.data.kind === 'subtask') return '分支';
  if (node.data.kind === 'tool') return '执行';
  if (node.data.kind === 'file') return '产生';
  if (node.data.kind === 'test') return '验证';
  return '继续';
}

function layout(nodes, edges) {
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  edges.forEach((edge) => incoming.get(edge.target)?.push(edge.source));
  const depth = new Map();
  const calculateDepth = (id, stack = new Set()) => {
    if (depth.has(id)) return depth.get(id);
    if (stack.has(id)) return 0;
    const nextStack = new Set(stack).add(id);
    const parents = incoming.get(id) || [];
    const value = parents.length ? Math.max(...parents.map((parent) => calculateDepth(parent, nextStack))) + 1 : 0;
    depth.set(id, value);
    return value;
  };
  nodes.forEach((node) => calculateDepth(node.id));

  const columns = new Map();
  nodes.forEach((node) => {
    const column = depth.get(node.id) || 0;
    const list = columns.get(column) || [];
    list.push(node);
    columns.set(column, list);
  });
  columns.forEach((columnNodes) => {
    const start = 180 - ((columnNodes.length - 1) * 200) / 2;
    columnNodes.forEach((node, index) => {
      node.position = { x: 40 + (depth.get(node.id) || 0) * 270, y: start + index * 200 };
    });
  });
  return nodes;
}

export function normalizeDshSession(input) {
  const source = isObject(input?.session) ? { ...input.session, ...input } : input || {};
  const metadata = isObject(source.header) ? { ...source.header, ...source } : source;
  const records = source.events || source.records || source.history?.records || (Array.isArray(source.history) ? source.history : null) || source.eventWindow?.entries || [];
  const rawEvents = records.map(unwrapEvent).filter((event) => event && typeof event.type === 'string');
  const nodes = [];
  const eventBySeq = new Map();
  const usedIds = new Set();
  let ignoredEventCount = 0;

  rawEvents.forEach((event, index) => {
    const rule = EVENT_RULES[event.type];
    if (!rule || IGNORED_EVENT_TYPES.has(event.type)) {
      ignoredEventCount += 1;
      return;
    }
    const sequence = sequenceOf(event, index + 1);
    const payload = payloadOf(event);
    const files = filesFor(event);
    const summary = summaryFor(event, files);
    const status = statusFor(event, rule);
    const requestedKind = valueFrom(payload, ['taskKind', 'kind']);
    const kind = ['question', 'analysis', 'subtask', 'tool', 'file', 'test'].includes(requestedKind) ? requestedKind : rule.kind;
    const kindLabels = { question: '用户问题', analysis: 'AI 分析', subtask: '子任务', tool: '工具调用', file: '文件修改', test: '测试结果' };
    const label = kindLabels[kind] || rule.label;
    const project = projectFields(event, kind, status);
    const requestedId = String(valueFrom(payload, ['taskId', 'nodeId']) || `event-${sequence}`);
    const id = usedIds.has(requestedId) ? `${requestedId}-${sequence}` : requestedId;
    usedIds.add(id);
    const node = {
      id,
      type: 'task',
      position: { x: 0, y: 0 },
      data: {
        kind,
        label,
        title: titleFor(event, rule, summary, files),
        status,
        time: formatTime(event.time),
        summary,
        files,
        ref: `${metadata.sessionId || metadata.id || 'session'}#${sequence}`,
        conversationRef: `${metadata.sessionId || metadata.id || 'session'}#${sequence}`,
        rawType: event.type,
        seq: sequence,
        rawEvent: event,
        ...project,
      },
      _event: event,
      _parentSequence: parentSequenceOf(event),
    };
    nodes.push(node);
    eventBySeq.set(sequence, node);
  });

  const edges = [];
  nodes.forEach((node, index) => {
    const parent = node._parentSequence === undefined ? undefined : eventBySeq.get(node._parentSequence);
    const previous = nodes[index - 1];
    const sourceNode = parent || previous;
    if (!sourceNode || sourceNode.id === node.id) return;
    const relation = parent ? (node.data.kind === 'subtask' ? 'child-task' : 'branch') : 'sequence';
    edges.push({ id: `edge-${sourceNode.id}-${node.id}`, source: sourceNode.id, target: node.id, label: edgeLabel(node), kind: relation });
  });

  const visibleNodes = nodes.map(({ _event, _parentSequence, ...node }) => node);
  layout(visibleNodes, edges);
  const successCount = visibleNodes.filter((node) => node.data.status === 'success').length;
  const firstQuestion = visibleNodes.find((node) => node.data.kind === 'question');
  const title = metadata.title || metadata.name || firstQuestion?.data.title || '未命名会话';
  const eventCount = rawEvents.length;
  const updatedEvent = rawEvents.at(-1);

  return {
    sessionInfo: {
      sessionId: metadata.sessionId || metadata.id || 'local-session',
      parentSessionId: metadata.parentSessionId || metadata.parentSession,
      title: shortText(title, 80),
      repo: displayName(metadata.cwd || metadata.repo || '本地工作区'),
      updatedAt: updatedEvent ? formatTime(updatedEvent.time) : '刚刚更新',
      progress: `${successCount} / ${visibleNodes.length} 个节点已完成`,
      eventCount,
      ignoredEventCount,
    },
    nodes: visibleNodes,
    edges,
    diagnostics: {
      rawEventCount: eventCount,
      renderedNodeCount: visibleNodes.length,
      ignoredEventCount,
      unsupportedTypes: [...new Set(rawEvents.map((event) => event.type).filter((type) => !EVENT_RULES[type] && !IGNORED_EVENT_TYPES.has(type)))],
    },
  };
}
