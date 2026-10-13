import React, { useEffect, useMemo, useRef, useState } from 'react';
import { initialEdges, initialNodes, sessionInfo as sampleInfo } from './data/sampleSession';
import { sampleProject } from './data/sampleProject.js';
import { normalizeDshSession } from './data/normalizeSession.js';
import { connectDshFrame, isDshFrame, requestDshSession, requestOlderEvents, showDshProject } from './data/liveBridge.js';
import ProjectDashboard from './ProjectDashboard.jsx';
import { buildTaskTree, projectTaskTree, summarizeTasks } from './data/taskGraph.js';
import './management.css';
import './responsive.css';
import './history.css';
import './canvasPan.css';

const statusText = { success: '已完成', running: '进行中', failed: '失败', waiting: '等待确认' };
const kindIcons = { question: '？', analysis: '✦', subtask: '⑂', tool: '⚙', file: '▤', test: '✓' };
const defaultSelectedId = initialNodes.find((node) => node.data.kind === 'analysis')?.id || initialNodes[0]?.id;
const emptyGraph = { nodes: [], edges: [], sessionInfo: null };

function childIdsOf(id, edges) {
  return edges.filter((edge) => edge.source === id).map((edge) => edge.target);
}

function descendantIdsOf(id, edges) {
  const descendants = new Set();
  const pending = [...childIdsOf(id, edges)];
  while (pending.length) {
    const next = pending.shift();
    if (descendants.has(next)) continue;
    descendants.add(next);
    pending.push(...childIdsOf(next, edges));
  }
  return descendants;
}

function isDescendant(id, parentId, edges) {
  return descendantIdsOf(parentId, edges).has(id);
}

function statusLabel(status, isLive = false) {
  if (isLive && status === 'success') return '已记录';
  return statusText[status] || status || '未标记';
}

function TaskCard({ node, onClick, selected, collapsed, childCount, onToggleCollapse, isLive }) {
  const { data } = node;
  const selectNode = () => onClick(node.id);
  const onKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectNode();
    }
  };
  return <div className={`task-card status-${data.status} ${selected ? 'selected' : ''}`} style={{ left: node.position.x, top: node.position.y }} onClick={selectNode} onKeyDown={onKeyDown} role="button" tabIndex={0}>
    <div className="node-topline">
      <span className="node-icon">{kindIcons[data.kind]}</span>
      <span>{data.label}</span>
      <span className="node-phase">{data.phase}</span>
      <span className="node-time">{data.time}</span>
    </div>
    <strong>{data.title}</strong>
    <p>{data.summary}</p>
    <div className="node-bottomline">
      <div className="node-status"><span className="status-dot" />{statusLabel(data.status, isLive)}</div>
      <span className={`priority-badge priority-${String(data.priority).toLowerCase()}`}>{data.priority}</span>
    </div>
    {childCount > 0 && <div className="node-fold-row">
      <button className="fold-toggle" onClick={(event) => { event.stopPropagation(); onToggleCollapse(node.id); }} aria-label={collapsed ? `展开 ${data.title}` : `折叠 ${data.title}`}>
        <span>{collapsed ? '+' : '−'}</span>{collapsed ? `已折叠 · ${childCount} 个后代任务` : `${childCount} 个后代任务`}
      </button>
    </div>}
  </div>;
}

function ProjectOverview({ nodes, sessionInfo: info, isLive, onFocusRisk }) {
  const taskStats = summarizeTasks(nodes);
  const total = taskStats.total;
  const completed = taskStats.success;
  const active = taskStats.running;
  const waiting = taskStats.waiting;
  const failed = taskStats.failed;
  const phaseSummary = [...new Set(nodes.map((node) => node.data.phase))].map((phase) => {
    const phaseNodes = nodes.filter((node) => node.data.phase === phase);
    return { phase, count: phaseNodes.length, completed: phaseNodes.filter((node) => node.data.status === 'success').length };
  });
  const completion = taskStats.completion;
  return <section className="project-overview" aria-label="项目总览">
    <div className="overview-lead">
      <div className="section-kicker">{isLive ? 'DSH 事件窗口 · 非项目交付率' : '样例项目管理视角'}</div>
      <div className="overview-title-row"><h3>{isLive ? '会话事件概览' : '交付总览'}</h3><span className="overview-updated">只读 · {info.updatedAt} 更新</span></div>
      <div className="progress-track"><span style={{ width: `${completion}%` }} /></div>
      <div className="progress-caption"><strong>{completion}%</strong><span>{completed} / {total} 个{isLive ? '可视事件状态为成功（非任务完成率）' : '样例任务完成'}</span></div>
      <div className="phase-strip" aria-label="阶段进度">{phaseSummary.map(({ phase, count, completed: phaseCompleted }) => <span key={phase} title={`${phase}：${phaseCompleted}/${count} ${isLive ? '状态为成功' : '完成'}`}><i className={phaseCompleted === count ? 'done' : ''} />{phase}</span>)}</div>
    </div>
    <div className="overview-metric"><span>{isLive ? '可视事件' : '样例任务'}</span><strong>{total}</strong><small>{isLive ? `${info.ignoredEventCount} 条未绘制` : `${phaseSummary.length} 个阶段`}</small></div>
    <div className="overview-metric"><span>当前进行</span><strong className="metric-blue">{active}</strong><small>{active ? '需要持续跟进' : '暂无进行中任务'}</small></div>
    <button className={`overview-metric risk-metric ${failed || waiting ? 'has-risk' : ''}`} onClick={onFocusRisk}>
      <span>风险 / 阻塞</span><strong>{failed + waiting}</strong><small>{failed} 个失败 · {waiting} 个待确认</small>
    </button>
  </section>;
}

function GraphView({ nodes, edges, tree, width, height, selectedId, onSelect, collapsedIds, onToggleCollapse, onExpandAll, onCollapseAll, isLive }) {
  const positions = Object.fromEntries(nodes.map((node) => [node.id, node.position]));
  const pan = useRef(null);
  const startPan = (event) => {
    if (event.button !== 0 || event.target.closest('.task-card, .canvas-toolbar')) return;
    const viewport = event.currentTarget;
    pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('panning');
  };
  const movePan = (event) => {
    if (pan.current?.id !== event.pointerId) return;
    event.currentTarget.scrollLeft = pan.current.left + pan.current.x - event.clientX;
    event.currentTarget.scrollTop = pan.current.top + pan.current.y - event.clientY;
  };
  const endPan = (event) => {
    if (pan.current?.id !== event.pointerId) return;
    pan.current = null;
    event.currentTarget.classList.remove('panning');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className="graph-viewport" onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}><div className="custom-canvas" style={{ width: Math.max(width, 1250), minHeight: Math.max(height, 520) }}>
    <div className="canvas-toolbar">
      <span className="legend"><i className="success" />{isLive ? '已记录' : '已完成'} <i className="running" />进行中 <i className="failed" />失败 <i className="waiting" />待确认</span>
      <span className="canvas-hint">点击卡片查看 · 左上角折叠任务树</span>
      <div className="canvas-actions"><button onClick={onExpandAll}>全部展开</button><button onClick={onCollapseAll}>折叠分支</button></div>
    </div>
    <svg className="edge-layer" width="100%" height="100%">
      {edges.map((edge) => {
        const a = positions[edge.source];
        const b = positions[edge.target];
        if (!a || !b) return null;
        return <g key={edge.id}><line className={`edge-${edge.kind || 'sequence'}`} x1={a.x + 256} y1={a.y + 88} x2={b.x} y2={b.y + 88} /><text x={(a.x + b.x + 256) / 2} y={(a.y + b.y) / 2 + 84}>{edge.label}</text></g>;
      })}
    </svg>
    {nodes.map((node) => <TaskCard key={node.id} node={node} selected={selectedId === node.id} onClick={onSelect} collapsed={collapsedIds.has(node.id)} childCount={tree.descendants.get(node.id)?.size || 0} onToggleCollapse={onToggleCollapse} isLive={isLive} />)}
  </div></div>;
}

function DetailSidebar({ selected, nodes, edges, tree, collapsedIds, onToggleCollapse, isLive }) {
  const childCount = tree.descendants.get(selected.id)?.size || 0;
  const dependencies = edges.filter((edge) => edge.target === selected.id).map((edge) => nodes.find((node) => node.id === edge.source)).filter(Boolean);
  const dependents = edges.filter((edge) => edge.source === selected.id).map((edge) => nodes.find((node) => node.id === edge.target)).filter(Boolean);
  const isCollapsed = collapsedIds.has(selected.id);
  return <aside className="detail-sidebar">
    <div className="detail-header"><span>{isLive ? '事件详情' : '任务详情'}</span><span className="detail-counter">{selected.data.seq} / {nodes.length}</span></div>
    <div className={`detail-icon status-${selected.data.status}`}>{kindIcons[selected.data.kind]}</div>
    <div className="detail-type">{selected.data.label} · {selected.data.time}</div>
    <h3>{selected.data.title}</h3>
    <div className={`detail-status status-${selected.data.status}`}><span className="status-dot" />{statusLabel(selected.data.status, isLive)}</div>
    <p className="detail-summary">{selected.data.summary}</p>
    {isLive && <p className="empty">以下阶段、优先级、负责人和风险由事件推断，仅供定位。</p>}
    <div className="detail-meta-grid">
      <div><span>阶段</span><strong>{selected.data.phase}</strong></div>
      <div><span>优先级</span><strong>{selected.data.priority}</strong></div>
      <div><span>负责人</span><strong>{selected.data.owner}</strong></div>
      <div><span>风险</span><strong className={`risk-${selected.data.risk === '高' ? 'high' : selected.data.risk === '中' ? 'medium' : 'low'}`}>{selected.data.risk}</strong></div>
    </div>
    <div className="detail-section"><h4>{isLive ? '事件关系（按顺序推断）' : '项目关系'}</h4><div className="relation-row"><span>{isLive ? '前序' : '依赖'}</span><strong>{dependencies.length ? dependencies.map((node) => node.data.title).join('、') : '无'}</strong></div><div className="relation-row"><span>后续</span><strong>{dependents.length ? `${dependents.length} 个后续记录` : '无'}</strong></div></div>
    <div className="detail-section"><h4>关联文件</h4>{selected.data.files?.length ? selected.data.files.map((file) => <div className="file-row" key={file}><span>▤</span>{file}</div>) : <p className="empty">这个任务没有关联文件</p>}</div>
    <div className="detail-section"><h4>原始对话定位</h4><p className="empty">{selected.data.conversationRef}（请在 DSH 中查看原始记录）</p></div>
    {childCount > 0 && <button className="collapse-button" onClick={() => onToggleCollapse(selected.id)}>{isCollapsed ? `展开 ${childCount} 个后代任务` : `折叠 ${childCount} 个后代任务`}</button>}
  </aside>;
}

function HistoryControls({ source }) {
  return <div className="history-controls" aria-live="polite">
    <span>已读取 {source.shownCount} 条持久事件 · 展示上限 {source.maxEvents} 条</span>
    {source.hasMore && <button type="button" onClick={requestOlderEvents} disabled={source.historyStatus === 'loading'}>{source.historyStatus === 'loading' ? '正在加载…' : source.historyStatus === 'error' ? '重试加载更早事件' : '加载更早事件'}</button>}
    {source.historyStatus === 'loading' && !source.hasMore && <span>正在加载更早事件…</span>}
    {source.limitReached && <span>已达展示上限，更早事件未显示</span>}
    {!source.hasMore && !source.limitReached && source.historyStatus === 'idle' && <span>已到当前可读历史起点</span>}
    {source.historyStatus === 'error' && <p role="alert">{source.historyError}</p>}
  </div>;
}

function App() {
  const [source, setSource] = useState(() => isDshFrame()
    ? { mode: 'loading', model: null }
    : new URLSearchParams(window.location.search).get('sample') === '1'
      ? { mode: 'sample', model: { nodes: initialNodes, edges: initialEdges, sessionInfo: sampleInfo } }
      : { mode: 'project', model: sampleProject });
  const [selectedId, setSelectedId] = useState(defaultSelectedId);
  const [view, setView] = useState(() => window.matchMedia('(max-width: 700px)').matches ? 'linear' : 'graph');
  const [collapsed, setCollapsed] = useState([]);
  const liveSessionId = useRef(null);
  useEffect(() => {
    const timeout = setTimeout(() => setSource((current) => current.mode === 'loading'
      ? { mode: 'error', model: null, error: '等待 DSH 会话超时，请重试或查看样例。' }
      : current), 15000);
    const disconnect = connectDshFrame((message) => {
    if (message.type === 'loading') {
      setSource({ mode: 'loading', model: null });
      return;
    }
    if (message.type === 'error') {
      setSource({ mode: 'error', model: null, error: message.error || '会话读取失败' });
      return;
    }
    try {
      if (message.type === 'project') {
        if (!message.project || !Array.isArray(message.project.sessions) || typeof message.project.key !== 'string') throw new Error('项目数据格式不正确');
        setSource({ mode: 'project', model: message.project });
        return;
      }
      if (!Array.isArray(message.events) || !message.session || typeof message.session.sessionId !== 'string') throw new Error('会话数据格式不正确');
      const model = normalizeDshSession({ ...message.session, events: message.events });
      const changedSession = liveSessionId.current !== message.session.sessionId;
      liveSessionId.current = message.session.sessionId;
      setSource({ mode: 'live', model, hasMore: Boolean(message.hasMore), limitReached: Boolean(message.limitReached), maxEvents: message.maxEvents || 500, historyStatus: message.historyStatus || 'idle', historyError: message.historyError || '', shownCount: message.events.length });
      setSelectedId((current) => changedSession || !model.nodes.some((node) => node.id === current) ? model.nodes[0]?.id : current);
      if (changedSession) {
        setCollapsed([]);
        setView('linear');
      }
    } catch (error) {
      setSource({ mode: 'error', model: null, error: error.message });
    }
    });
    return () => { clearTimeout(timeout); disconnect(); };
  }, []);
  const { nodes, edges, sessionInfo } = source.mode === 'project' ? emptyGraph : (source.model || emptyGraph);
  const selected = nodes.find((node) => node.id === selectedId) || nodes[0];
  const taskTree = useMemo(() => buildTaskTree(nodes, edges), [nodes, edges]);
  const collapsedIds = useMemo(() => new Set(collapsed), [collapsed]);
  const projection = useMemo(() => projectTaskTree(nodes, taskTree, collapsedIds), [nodes, taskTree, collapsedIds]);
  const visibleNodes = projection.nodes;
  const edgeLabels = useMemo(() => new Map(edges.map((edge) => [`${edge.source}->${edge.target}`, edge.label])), [edges]);
  const visibleEdges = projection.edges.map((edge) => ({ ...edge, label: edgeLabels.get(`${edge.source}->${edge.target}`) || '层级' }));
  const toggleCollapse = (id) => {
    setCollapsed((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    if (id !== selectedId && isDescendant(selectedId, id, edges)) setSelectedId(id);
  };
  const expandAll = () => setCollapsed([]);
  const collapseAll = () => setCollapsed(taskTree.roots.filter((id) => taskTree.descendants.get(id)?.size > 0));
  const focusRisk = () => {
    const riskNode = nodes.find((node) => node.data.status === 'failed' || node.data.status === 'waiting');
    if (riskNode) setSelectedId(riskNode.id);
  };
  const exportMarkdown = () => {
    const content = source.mode === 'live'
      ? `# ${sessionInfo.title}\n\n> DSH 只读事件窗口${source.hasMore || source.limitReached ? '（不含更早事件）' : ''}，不代表项目交付进度。\n\n## 事件记录\n\n${nodes.map((node) => `- **${node.data.title}**（${node.data.label}，${statusLabel(node.data.status, true)}）\n  - ${node.data.summary}`).join('\n')}`
      : `# ${sessionInfo.title}\n\n> 样例项目进度：${sessionInfo.progress}\n\n## 任务清单\n\n${nodes.map((node) => `- **${node.data.title}**（${statusLabel(node.data.status)}，${node.data.phase}，${node.data.priority}）\n  - ${node.data.summary}`).join('\n')}`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ai-task-map.md';
    link.click();
    URL.revokeObjectURL(url);
  };
  if (source.mode === 'project') return <ProjectDashboard project={source.model} />;
  if (!source.model) return <main className="app-shell">
    <header className="topbar"><div className="brand-mark">◆</div><div><div className="eyebrow">LOCAL AI WORKSPACE</div><h1>AI 编程任务图</h1></div><span className="readonly">DSH · 只读</span></header>
    <section className="source-state" role="status"><h2>{source.mode === 'loading' ? '正在读取项目会话' : '无法读取 DSH 项目'}</h2><p>{source.mode === 'loading' ? '请保持 DSH 页面打开。' : source.error}</p><div className="source-actions"><button onClick={requestDshSession}>重试</button><button onClick={() => setSource({ mode: 'sample', model: { nodes: initialNodes, edges: initialEdges, sessionInfo: sampleInfo } })}>查看样例</button></div></section>
  </main>;
  return <main className="app-shell">
    <header className="topbar"><div className="brand-mark">◆</div><div><div className="eyebrow">LOCAL AI WORKSPACE</div><h1>AI 编程任务图</h1></div><div className="top-actions"><span className="readonly"><span className="live-dot" />{source.mode === 'live' ? 'DSH 会话事件 · 只读' : '固定样例 · 只读'}</span>{source.mode === 'live' && <button className="export-button" onClick={showDshProject}>返回项目</button>}{source.mode === 'sample' && !isDshFrame() && <button className="export-button" onClick={() => { window.location.href = window.location.pathname; }}>返回项目</button>}{isDshFrame() && <button className="export-button" onClick={requestDshSession}>同步</button>}<button className="export-button" onClick={exportMarkdown}>导出 Markdown</button></div></header>
    <section className="workspace">
      <aside className="session-sidebar"><div className="sidebar-heading"><span>会话</span></div><div className="session-card active"><div className="session-status success" /><div><strong>{sessionInfo.title}</strong><small>{sessionInfo.repo} · {sessionInfo.updatedAt}</small></div></div><div className="sidebar-project"><span>{source.mode === 'live' ? '事件视图' : '样例视图'}</span><strong>{source.mode === 'live' ? '当前会话' : '交付总览'}</strong><small>{source.mode === 'live' ? `只读事件窗口${source.hasMore || source.limitReached ? ' · 更早事件未显示' : ''}` : '阶段、状态和分支'}</small></div></aside>
      <section className="main-panel"><div className="content-heading"><div><div className="breadcrumb">我的会话 <span>›</span> {sessionInfo.title}</div><h2>{sessionInfo.title}</h2><p>{source.mode === 'live' ? `已读取 ${source.shownCount} 条事件 · ${nodes.length} 个可视节点${source.hasMore || source.limitReached ? ' · 更早事件未显示' : ''}` : sessionInfo.progress} · 最后活动于 {sessionInfo.updatedAt}</p></div><div className="view-tabs"><button className={view === 'graph' ? 'selected' : ''} onClick={() => setView('graph')}>⌘ 图形视图</button><button className={view === 'linear' ? 'selected' : ''} onClick={() => setView('linear')}>☷ 线性视图</button></div></div><ProjectOverview nodes={nodes} sessionInfo={sessionInfo} isLive={source.mode === 'live'} onFocusRisk={focusRisk} />{source.mode === 'live' && <HistoryControls source={source} />}{!nodes.length ? <section className="source-state" role="status">当前事件窗口没有可绘制的记录。</section> : view === 'graph' ? <GraphView nodes={visibleNodes} edges={visibleEdges} tree={taskTree} width={projection.width} height={projection.height} selectedId={selectedId} onSelect={setSelectedId} collapsedIds={collapsedIds} onToggleCollapse={toggleCollapse} onExpandAll={expandAll} onCollapseAll={collapseAll} isLive={source.mode === 'live'} /> : <LinearView nodes={visibleNodes} edges={edges} tree={taskTree} onSelect={setSelectedId} selectedId={selectedId} collapsedIds={collapsedIds} onToggleCollapse={toggleCollapse} isLive={source.mode === 'live'} />}</section>
      {selected && <DetailSidebar selected={selected} nodes={nodes} edges={edges} tree={taskTree} collapsedIds={collapsedIds} onToggleCollapse={toggleCollapse} isLive={source.mode === 'live'} />}
    </section>
  </main>;
}

function LinearView({ nodes, edges, tree, onSelect, selectedId, collapsedIds, onToggleCollapse, isLive }) {
  return <div className="linear-view">{nodes.map((node) => {
    const childCount = tree.descendants.get(node.id)?.size || 0;
    return <div className={`linear-item ${selectedId === node.id ? 'active' : ''}`} key={node.id} onClick={() => onSelect(node.id)} role="button" tabIndex={0}>
      <span className={`timeline-dot ${node.data.status}`} />
      <span className="linear-time">{node.data.time}</span>
      <span className="linear-content"><strong>{node.data.title}</strong><small><b>{node.data.phase}</b> · {node.data.label} · {node.data.summary}</small></span>
      {childCount > 0 && <button className="linear-fold" onClick={(event) => { event.stopPropagation(); onToggleCollapse(node.id); }}>{collapsedIds.has(node.id) ? '+' : '−'}</button>}
      <span className="linear-arrow">›</span>
    </div>;
  })}</div>;
}

export default App;
