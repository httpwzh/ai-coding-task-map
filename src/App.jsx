import { useCallback, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { initialEdges, initialNodes, sessionInfo } from './data/sampleSession';

const statusText = { success: '已完成', running: '进行中', failed: '失败', waiting: '等待确认' };
const kindIcons = { question: '？', analysis: '✦', subtask: '⑂', tool: '⚙', file: '▤', test: '✓' };

function TaskNode({ data }) {
  return (
    <div className={`task-node status-${data.status}`}>
      <Handle type="target" position={Position.Left} />
      <div className="node-topline"><span className="node-icon">{kindIcons[data.kind]}</span><span>{data.label}</span><span className="node-time">{data.time}</span></div>
      <strong>{data.title}</strong>
      <p>{data.summary}</p>
      <div className="node-status"><span className="status-dot" />{statusText[data.status]}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function FitButton() {
  const { fitView } = useReactFlow();
  return <button className="ghost-button" onClick={() => fitView({ padding: 0.2, duration: 350 })}>适应画布</button>;
}

function App() {
  const [nodes, setNodes] = useState(initialNodes);
  const [edges] = useState(initialEdges);
  const [selectedId, setSelectedId] = useState('analysis-1');
  const [view, setView] = useState('graph');
  const [collapsed, setCollapsed] = useState([]);

  const visibleNodes = useMemo(() => nodes.filter((node) => !collapsed.some((parentId) => node.id !== parentId && isDescendant(node.id, parentId, edges))), [nodes, collapsed, edges]);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const selected = nodes.find((node) => node.id === selectedId) || nodes[0];

  const onNodeClick = useCallback((_, node) => setSelectedId(node.id), []);
  const toggleCollapse = () => setCollapsed((current) => current.includes(selected.id) ? current.filter((id) => id !== selected.id) : [...current, selected.id]);

  const exportMarkdown = () => {
    const content = `# ${sessionInfo.title}\n\n${nodes.map((node) => `- **${node.data.title}**（${statusText[node.data.status]}）\n  - ${node.data.summary}`).join('\n')}`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'ai-task-map.md'; link.click(); URL.revokeObjectURL(url);
  };

  return (
    <main className="app-shell">
      <header className="topbar"><div className="brand-mark">◆</div><div><div className="eyebrow">LOCAL AI WORKSPACE</div><h1>AI 编程任务图</h1></div><div className="top-actions"><span className="readonly"><span className="live-dot" />只读原型</span><button className="export-button" onClick={exportMarkdown}>导出 Markdown</button></div></header>
      <section className="workspace">
        <aside className="session-sidebar"><div className="sidebar-heading"><span>会话</span><button className="icon-button">＋</button></div><div className="session-card active"><div className="session-status success" /><div><strong>{sessionInfo.title}</strong><small>{sessionInfo.repo} · {sessionInfo.updatedAt}</small></div><span className="more">•••</span></div><div className="session-card muted"><div className="session-status waiting" /><div><strong>重构设置页面</strong><small>昨天 · 4 个事件</small></div></div><div className="sidebar-note"><span>⌘</span><div><strong>这是一个假数据原型</strong><p>下一步会把 DSH 的真实会话转换成相同的节点模型。</p></div></div></aside>
        <section className="main-panel"><div className="content-heading"><div><div className="breadcrumb">我的会话 <span>›</span> {sessionInfo.title}</div><h2>{sessionInfo.title}</h2><p>{sessionInfo.progress} · 最后活动于 {sessionInfo.updatedAt}</p></div><div className="view-tabs"><button className={view === 'graph' ? 'selected' : ''} onClick={() => setView('graph')}>⌘ 图形视图</button><button className={view === 'linear' ? 'selected' : ''} onClick={() => setView('linear')}>☷ 线性视图</button></div></div>
          {view === 'graph' ? <div className="canvas-wrap"><div className="canvas-toolbar"><span className="legend"><i className="success" />已完成 <i className="failed" />失败 <i className="waiting" />等待确认</span><FitButton /></div><ReactFlowProvider><ReactFlow nodes={visibleNodes} edges={visibleEdges} nodeTypes={{ task: TaskNode }} onNodeClick={onNodeClick} onNodesChange={(changes) => setNodes((current) => current.map((node) => { const change = changes.find((item) => item.id === node.id); return change?.type === 'position' && change.position ? { ...node, position: change.position } : node; }))} fitView proOptions={{ hideAttribution: true }}><Background color="#d9dfeb" gap={24} size={1} /><Controls /><MiniMap nodeColor={(node) => ({ success: '#2eb67d', failed: '#e45b65', waiting: '#e6a932', running: '#5b7cfa' }[node.data?.status] || '#a0aec0')} /></ReactFlow></ReactFlowProvider></div> : <LinearView nodes={nodes} onSelect={setSelectedId} selectedId={selectedId} />}
        </section>
        <aside className="detail-sidebar"><div className="detail-header"><span>节点详情</span><button className="icon-button">×</button></div><div className={`detail-icon status-${selected.data.status}`}>{kindIcons[selected.data.kind]}</div><div className="detail-type">{selected.data.label} · {selected.data.time}</div><h3>{selected.data.title}</h3><div className={`detail-status status-${selected.data.status}`}><span className="status-dot" />{statusText[selected.data.status]}</div><p className="detail-summary">{selected.data.summary}</p><div className="detail-section"><h4>关联文件</h4>{selected.data.files.length ? selected.data.files.map((file) => <div className="file-row" key={file}><span>▤</span>{file}</div>) : <p className="empty">这个节点没有关联文件</p>}</div><div className="detail-section"><h4>原始对话</h4><button className="conversation-link">跳转到 {selected.data.ref} <span>↗</span></button></div><button className="collapse-button" onClick={toggleCollapse}>{collapsed.includes(selected.id) ? '展开此分支' : '折叠此分支'}</button></aside>
      </section>
    </main>
  );
}

function isDescendant(id, parentId, edges) {
  const children = edges.filter((edge) => edge.source === parentId).map((edge) => edge.target);
  if (children.includes(id)) return true;
  return children.some((child) => isDescendant(id, child, edges));
}

function LinearView({ nodes, onSelect, selectedId }) {
  return <div className="linear-view">{nodes.map((node) => <button className={`linear-item ${selectedId === node.id ? 'active' : ''}`} key={node.id} onClick={() => onSelect(node.id)}><span className={`timeline-dot ${node.data.status}`} /><span className="linear-time">{node.data.time}</span><span className="linear-content"><strong>{node.data.title}</strong><small>{node.data.label} · {node.data.summary}</small></span><span className="linear-arrow">›</span></button>)}</div>;
}

export default App;
