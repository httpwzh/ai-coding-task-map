import React, { useEffect, useMemo, useState } from 'react';
import ProjectCanvas from './ProjectCanvas.jsx';
import { normalizeProject } from './data/projectModel.js';
import { emptyProjectDraft, mergeProjectDraft, readProjectDraft, removeLocalTask, saveProjectDraft } from './data/projectDraft.js';
import { buildTaskTree, projectTaskTree } from './data/taskGraph.js';
import { openDshSession, requestMoreProjectSessions, requestDshSession, selectDshProject } from './data/liveBridge.js';
import './project.css';
import './projectEditor.css';

const STATE = { active: '进行中', paused: '已暂停', blocked: '受阻', complete: '声明完成',
  pending: '待处理', in_progress: '进行中', completed: '已完成', ready: '已读取', loading: '读取中',
  error: '读取失败', unknown: '未知' };
const LOCAL_STATES = [['pending', '待处理'], ['in_progress', '进行中'], ['blocked', '受阻'], ['completed', '已完成']];

function useProjectDraft(key) {
  const [stored, setStored] = useState(() => ({ key, value: readProjectDraft(key), modified: false }));
  const [storageError, setStorageError] = useState('');
  const draft = stored.key === key ? stored.value : readProjectDraft(key);
  useEffect(() => {
    if (stored.key !== key) {
      setStored({ key, value: readProjectDraft(key), modified: false });
      setStorageError('');
    }
  }, [key, stored.key]);
  useEffect(() => {
    if (stored.key !== key || !stored.modified) return;
    try { saveProjectDraft(key, stored.value); setStorageError(''); }
    catch { setStorageError('本地存储不可用：当前编辑仅在此页面有效。'); }
  }, [key, stored]);
  const edit = (change) => setStored((current) => ({ key,
    value: change(current.key === key ? current.value : readProjectDraft(key)), modified: true,
  }));
  return { draft, edit, storageError, setStorageError };
}

export default function ProjectDashboard({ project }) {
  const { draft, edit, storageError, setStorageError } = useProjectDraft(project.key);
  const sourceModel = useMemo(() => normalizeProject(project), [project]);
  const model = useMemo(() => mergeProjectDraft(sourceModel, draft), [sourceModel, draft]);
  const tree = useMemo(() => buildTaskTree(model.nodes, model.edges), [model]);
  const [selectedId, setSelectedId] = useState(null);
  const [collapsed, setCollapsed] = useState([]);
  const [focusRequest, setFocusRequest] = useState(null);
  const [view, setView] = useState(() => window.matchMedia('(max-width: 700px)').matches ? 'outline' : 'graph');
  useEffect(() => {
    setSelectedId(`project:${project.key}`);
    setFocusRequest(null);
    const visible = new Set();
    let current = project.currentSessionId;
    while (current && !visible.has(current)) {
      visible.add(current);
      current = project.sessions.find((session) => session.sessionId === current)?.parentSessionId;
    }
    setCollapsed(project.sessions.filter((session) => !visible.has(session.sessionId)).map((session) => `session:${session.sessionId}`));
  }, [project.key]);
  const selected = model.nodes.find((node) => node.id === selectedId) || model.nodes[0];
  const folded = useMemo(() => new Set(collapsed), [collapsed]);
  const projection = useMemo(() => projectTaskTree(model.nodes, tree, folded), [model, tree, folded]);
  const remaining = project.sessions.filter((session) => session.status === 'pending').length;
  const choose = (id, focus = false) => {
    setSelectedId(id);
    const ancestors = new Set();
    let cursor = tree.parent.get(id);
    while (cursor) { ancestors.add(cursor); cursor = tree.parent.get(cursor); }
    setCollapsed((current) => current.filter((key) => !ancestors.has(key)));
    if (focus) setFocusRequest({ id, nonce: Date.now() + Math.random() });
  };
  const toggle = (id) => setCollapsed((current) => current.includes(id) ? current.filter((key) => key !== id) : [...current, id]);
  const addTask = (parentId = selected?.id) => {
    if (draft.tasks.length >= 400) { setStorageError('本地任务最多保存 400 项。'); return; }
    const id = `local:${crypto.randomUUID()}`;
    edit((current) => ({ ...current, tasks: [...current.tasks, { id, parentId: parentId || `project:${project.key}`, title: '新任务', note: '', status: 'pending' }] }));
    choose(parentId || `project:${project.key}`);
    setSelectedId(id);
    setFocusRequest({ id, nonce: Date.now() + Math.random() });
  };
  const updateTask = (id, field, value) => edit((current) => ({ ...current,
    tasks: current.tasks.map((task) => task.id === id ? { ...task, [field]: value } : task),
  }));
  const deleteTask = (id) => {
    if (!window.confirm('删除这个本地任务及其子任务？')) return;
    const parentId = tree.parent.get(id) || `project:${project.key}`;
    edit((current) => removeLocalTask(current, id));
    choose(parentId, true);
  };
  const sessionId = selected?.data.sessionId || (selected?.data.kind === 'session' ? selected.data.source : null);
  const isPartial = Boolean(model.stats.pending || model.stats.failed || model.stats.incomplete || project.catalogPending);
  const localTask = selected?.data.kind === 'local' ? draft.tasks.find((task) => task.id === selected.id) : null;
  return <main className="project-shell">
    <header className="project-header">
      <div className="project-title"><span className="project-eyebrow">{project.scope === 'sample' ? '固定示例 · 本地计划可编辑' : 'DSH 来源只读 · 本地计划可编辑'}</span><h1>{project.title || '项目任务图'}</h1><small title={project.cwd}>{project.cwd || '未记录工作目录'}</small></div>
      <div className="project-commands">
        {project.projects?.length > 1 && <label className="project-picker">项目 <select value={project.key} onChange={(event) => selectDshProject(event.target.value)}>{project.projects.map((item) => <option key={item.key} value={item.key}>{item.title} ({item.count})</option>)}</select></label>}
        <button type="button" onClick={() => addTask()} title="在当前节点下新建本地任务">＋ 新建任务</button>
        {project.scope === 'sample' ? <button type="button" onClick={() => { window.location.href = `${window.location.pathname}?sample=1`; }}>会话样例</button> : <button type="button" onClick={requestDshSession} title="刷新项目会话目录和历史">同步</button>}
      </div>
    </header>
    <section className="project-overview-band" aria-label="项目进展记录">
      <div className="project-stat main"><small>项目交付进度</small><strong>未知</strong><span>缺少完整且可验证的项目任务清单</span></div>
      <div className="project-stat"><small>项目会话</small><strong>{model.stats.read} / {model.stats.sessions}</strong><span>{project.loading ? '正在读取历史' : isPartial ? '覆盖尚不完整' : '已读取目录中的会话'}</span></div>
      <div className="project-stat"><small>记录目标</small><strong>{model.stats.claimedGoals} / {model.stats.goals}</strong><span>声明完成 / 已记录</span></div>
      <div className="project-stat"><small>最近清单项</small><strong>{model.stats.claimedTodos} / {model.stats.todos}</strong><span>声明完成 / 已记录</span></div>
      <div className="project-stat"><small>本地任务</small><strong>{model.localStats.done} / {model.localStats.total}</strong><span>已完成 / 自行规划</span></div>
    </section>
    <div className="project-notice" role="status">
      <span>{project.scope === 'workspace' ? '范围来自 DSH 工作区成员列表' : project.scope === 'directory' ? '未注册工作区：按完全相同的目录筛选' : project.scope === 'sample' ? '当前显示固定示例项目' : '项目成员关系未确定：仅展示当前会话'}。目标与清单的完成状态仅是会话声明；本地编辑保存在此浏览器，不修改 DSH 记录。</span>
      {storageError && <b>{storageError}</b>}
      {project.catalogError && <b>工作区目录：{project.catalogError}</b>}
      {(model.stats.failed > 0 || model.stats.incomplete > 0) && <b>{model.stats.failed} 个读取失败 · {model.stats.incomplete} 个历史超过每会话 {project.maxEventsPerSession} 条上限</b>}
      {remaining > 0 && <button type="button" disabled={project.loading} onClick={requestMoreProjectSessions}>{project.loading ? `读取中 · 剩余 ${remaining}` : `读取剩余 ${remaining} 个会话`}</button>}
    </div>
    <div className="project-body">
      <nav className="project-sessions" aria-label="项目会话"><div className="project-panel-head">会话来源 <span>{model.stats.sessions}</span></div>
        {model.sessions.map((session) => <button type="button" key={session.sessionId} className={selectedId === `session:${session.sessionId}` ? 'active' : ''} onClick={() => choose(`session:${session.sessionId}`, true)}><span className={`project-status ${session.status}`} /><span className="project-session-label"><strong>{session.title}</strong><small>{session.status === 'error' ? session.error : session.status === 'pending' ? '尚未读取' : session.status === 'loading' ? '正在读取' : `${session.eventCount} 条事件${session.incomplete ? ' · 历史不完整' : ''}`}</small></span></button>)}
      </nav>
      <section className="project-main"><div className="project-panel-head"><span>项目思维导图</span><div className="project-tabs">{view === 'graph' && Object.keys(draft.positions).length > 0 && <button type="button" title="清除本地节点位置并重新排布" onClick={() => { edit((current) => ({ ...current, positions: {} })); setFocusRequest({ id: selected?.id, nonce: Date.now() + Math.random() }); }}>重排</button>}<button type="button" aria-pressed={view === 'graph'} onClick={() => setView('graph')}>图形</button><button type="button" aria-pressed={view === 'outline'} onClick={() => setView('outline')}>大纲</button></div></div>
        {view === 'graph' ? <ProjectCanvas key={project.key} projectKey={project.key} projection={projection} tree={tree} folded={folded} selectedId={selected?.id} positions={draft.positions} onChoose={choose} onToggle={toggle} onMoveNode={(id, position) => edit((current) => ({ ...current, positions: { ...current.positions, [id]: position } }))} focusRequest={focusRequest} />
          : <div className="project-outline">{model.nodes.map((node) => { const depth = tree.depth.get(node.id) || 0; const ancestors = []; let cursor = tree.parent.get(node.id); while (cursor) { ancestors.push(cursor); cursor = tree.parent.get(cursor); } if (ancestors.some((id) => folded.has(id))) return null; const children = tree.children.get(node.id)?.length || 0; return <div key={node.id} className={`project-outline-row ${selected?.id === node.id ? 'active' : ''}`} style={{ paddingLeft: `${16 + Math.min(depth, 8) * 21}px` }}><button type="button" className="project-outline-main" onClick={() => choose(node.id)}><span>{node.data.label}</span><strong>{node.data.title}</strong><small>{STATE[node.data.status] || ''}</small></button>{children > 0 && <button className="project-outline-fold" onClick={() => toggle(node.id)} aria-label={folded.has(node.id) ? '展开分支' : '折叠分支'}>{folded.has(node.id) ? '+' : '−'}</button>}</div>; })}</div>}
      </section>
      <aside className="project-detail" aria-label="节点详情"><div className="project-panel-head">详情</div>{selected && <div className="project-detail-inner">
        <small>{selected.data.label} · {STATE[selected.data.status] || '未标记'}</small>
        {localTask ? <div className="project-editor">
          <label>任务名称<input maxLength={160} value={localTask.title} onChange={(event) => updateTask(localTask.id, 'title', event.target.value)} /></label>
          <label>状态<select value={localTask.status} onChange={(event) => updateTask(localTask.id, 'status', event.target.value)}>{LOCAL_STATES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>备注<textarea rows={5} maxLength={2000} value={localTask.note} onChange={(event) => updateTask(localTask.id, 'note', event.target.value)} /></label>
          <button type="button" className="project-delete" onClick={() => deleteTask(localTask.id)}>删除本地任务</button>
        </div> : <><h2>{selected.data.title}</h2><p>{selected.data.detail || selected.data.summary}</p><dl><dt>来源</dt><dd>{selected.data.source || 'DSH 工作区'}</dd>{selected.data.time && <><dt>记录时间</dt><dd>{new Date(selected.data.time).toLocaleString('zh-CN')}</dd></>}</dl><label className="project-note">本地备注<textarea rows={4} maxLength={2000} value={draft.notes[selected.id] || ''} onChange={(event) => edit((current) => ({ ...current, notes: { ...current.notes, [selected.id]: event.target.value } }))} /></label>{selected.data.error && <p role="alert">{selected.data.error}</p>}</>}
        <div className="project-detail-actions"><button type="button" onClick={() => addTask(selected.id)}>＋ 添加子任务</button>{sessionId && project.scope !== 'sample' && <button type="button" className="project-drill" onClick={() => openDshSession(sessionId)}>查看会话事件</button>}</div>
      </div>}</aside>
    </div>
  </main>;
}
