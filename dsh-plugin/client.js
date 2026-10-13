window.__ModuleLoader__.load({
  id: 'dsh-local-task-map',
  factory(require) {
    const React = require('react');
    const NAMESPACE = 'local-task-map/v1';
    const MAP_ORIGIN = 'http://127.0.0.1:4173';
    const PAGE_SIZE = 80;
    const MAX_EVENTS = 500;
    const PROJECT_BATCH = 12;
    const MAX_PROJECT_EVENTS = 1600;
    const CSS_ID = 'dsh-local-task-map-css';
    if (!document.getElementById(CSS_ID)) {
      const style = document.createElement('style');
      style.id = CSS_ID;
      style.textContent = '.taskMapLaunch{border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:12px;padding:4px 8px}.taskMapLaunch:hover{background:rgba(120,130,150,.16)}.taskMapOverlay{position:fixed;inset:0;z-index:2147483000;background:rgba(15,22,34,.64);display:flex;align-items:center;justify-content:center;padding:16px}.taskMapDialog{display:flex;flex-direction:column;width:min(1440px,100%);height:min(900px,100%);background:#fff;border-radius:6px;overflow:hidden}.taskMapBar{height:38px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 12px;background:#232b38;color:white;font:13px sans-serif}.taskMapClose{border:0;background:transparent;color:white;font:22px sans-serif;cursor:pointer}.taskMapFrame{width:100%;flex:1;border:0}';
      document.head.append(style);
    }

    function compact(value, depth = 0, arrayLimit = 16) {
      if (typeof value === 'string') return value.slice(0, 700);
      if (value === null || typeof value !== 'object' || depth > 5) return value ?? null;
      if (Array.isArray(value)) return value.slice(0, arrayLimit).map((item) => compact(item, depth + 1, arrayLimit));
      const result = {};
      for (const key of Object.keys(value).slice(0, 35)) result[key] = compact(value[key], depth + 1, arrayLimit);
      return result;
    }

    function samePath(left, right) {
      const normalize = (value) => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      return Boolean(left && right && normalize(left) === normalize(right));
    }

    function openMap(sessions, workspaces, sessionId) {
      const overlay = document.createElement('div');
      overlay.className = 'taskMapOverlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', '项目任务图');
      const dialog = document.createElement('div');
      dialog.className = 'taskMapDialog';
      const bar = document.createElement('div');
      bar.className = 'taskMapBar';
      const title = document.createElement('span');
      title.textContent = '项目任务图 · DSH 来源只读，本地计划可编辑';
      const closeButton = document.createElement('button');
      closeButton.className = 'taskMapClose';
      closeButton.type = 'button';
      closeButton.title = '关闭任务图';
      closeButton.setAttribute('aria-label', '关闭任务图');
      closeButton.textContent = '×';
      const frame = document.createElement('iframe');
      frame.className = 'taskMapFrame';
      frame.title = 'AI 编程任务图';
      frame.src = MAP_ORIGIN;
      bar.append(title, closeButton);
      dialog.append(bar, frame);
      overlay.append(dialog);
      document.body.append(overlay);

      let closed = false;
      let ready = false;
      let eventSource = null;
      let unsubscribe = null;
      let reference = null;
      let session = null;
      let pendingError = null;
      let visibleLimit = PAGE_SIZE;
      let oldestVisibleSeq = null;
      let historyStatus = 'idle';
      let historyError = '';
      let view = 'project';
      let selectedSessionId = sessionId;
      let projectKey = null;
      let project = null;
      let projectGeneration = 0;
      let projectReading = false;
      let projectReference = null;
      function post(message) {
        if (ready && !closed) frame.contentWindow?.postMessage({ namespace: NAMESPACE, ...message }, MAP_ORIGIN);
      }
      function catalog() {
        const listing = sessions.list.getSnapshot();
        const byId = listing.byId || {};
        const workspaceList = workspaces?.list?.getSnapshot();
        const memberIds = new Set();
        const projects = (workspaceList?.items || []).map((workspace) => {
          const ids = [...new Set(workspace.sessionIds || [])];
          ids.forEach((id) => memberIds.add(id));
          return { key: `workspace:${workspace.workspaceId}`, workspaceId: workspace.workspaceId,
            title: workspace.title || workspace.path, cwd: workspace.path || '', scope: 'workspace', ids };
        });
        for (const [id, row] of Object.entries(byId)) {
          if (memberIds.has(id) || !row?.parentId) continue;
          let parent = row.parentId;
          const visited = new Set([id]);
          while (parent && !visited.has(parent)) {
            visited.add(parent);
            const owner = projects.find((item) => item.ids.includes(parent));
            if (owner) { owner.ids.push(id); memberIds.add(id); break; }
            parent = byId[parent]?.parentId;
          }
        }
        const grouped = new Map();
        for (const id of listing.ids || []) {
          const row = byId[id];
          if (memberIds.has(id) || !row?.cwd) continue;
          const key = row.cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
          if (!grouped.has(key)) grouped.set(key, { key: `cwd:${key}`, title: row.cwd.split(/[\\/]/).at(-1), cwd: row.cwd, scope: 'directory', ids: [] });
          grouped.get(key).ids.push(id);
        }
        projects.push(...grouped.values());
        let ancestor = sessionId;
        const visited = new Set();
        while (byId[ancestor]?.parentId && !visited.has(ancestor)) {
          visited.add(ancestor);
          ancestor = byId[ancestor].parentId;
        }
        const matched = projects.find((item) => item.ids.includes(sessionId)) || projects.find((item) => item.ids.includes(ancestor));
        const cwd = byId[ancestor]?.cwd || byId[sessionId]?.cwd;
        const fallback = projects.find((item) => item.scope === 'directory' && samePath(item.cwd, cwd));
        if (!matched && !fallback && !projects.some((item) => item.ids.includes(sessionId))) {
          projects.push({ key: `unresolved:${sessionId}`, title: byId[sessionId]?.displayTitle || '当前会话', cwd: cwd || '', scope: 'unresolved', ids: [sessionId] });
        }
        return { projects, selected: matched || fallback || projects.find((item) => item.key === `unresolved:${sessionId}`), byId,
          pending: listing.phase === 'pending' || workspaceList?.phase === 'pending',
          error: workspaceList?.state === 'error' ? (workspaceList.error?.message || '工作区目录读取失败') : '' };
      }
      function publishProject() {
        if (view !== 'project' || !project) return;
        post({ type: 'project', project: { ...project, sessions: project.sessions.map((item) => ({ ...item })) } });
      }
      async function readProjectSession(item, generation) {
        let held;
        try {
          held = sessions.retain(item.sessionId, { source: 'local-task-map' });
          projectReference = held;
          const binding = await held.ready;
          if (closed || generation !== projectGeneration) return;
          if (binding.session.getSnapshot().openState !== 'open') throw new Error('DSH 无法打开会话');
          let snapshot = binding.eventSource.getSnapshot();
          let rows = snapshot.entries.filter((entry) => entry.type === 'event' && entry.event?.type);
          while (snapshot.hasMore && rows.length < MAX_PROJECT_EVENTS && !closed && generation === projectGeneration) {
            const first = rows[0]?.event.seq;
            const state = binding.session.getSnapshot();
            if (state.openState !== 'open' || state.loadingOlder || !state.hasMore) throw new Error('历史分页暂不可用');
            await binding.session.loadOlder();
            if (closed || generation !== projectGeneration) return;
            const after = binding.eventSource.getSnapshot();
            const next = after.entries.filter((entry) => entry.type === 'event' && entry.event?.type);
            if (after.hasMore && !(Number.isFinite(next[0]?.event.seq) && (first === undefined || next[0].event.seq < first))) throw new Error('没有读到更早的事件');
            snapshot = after;
            rows = next;
          }
          const selected = rows.slice(-MAX_PROJECT_EVENTS);
          const goals = new Map();
          let lastTodo = null;
          let firstUser = null;
          for (const { event } of selected) {
            if (event.type === 'goal/change') {
              const id = event.data?.goal?.id || event.data?.cleared?.id;
              if (id) goals.set(id, event);
            } else if (event.type === 'todo/write') lastTodo = event;
            else if (event.type === 'user/message' && event.data?.source?.kind === 'user' && !firstUser) firstUser = event;
          }
          item.events = [...goals.values(), lastTodo, firstUser].filter(Boolean).map((event) => ({
            type: event.type, seq: event.seq, time: event.time,
            data: compact(event.data, 0, event.type === 'todo/write' ? 120 : 16),
          }));
          item.eventCount = selected.length;
          item.incomplete = Boolean(snapshot.hasMore || rows.length > MAX_PROJECT_EVENTS);
          item.status = 'ready';
          item.error = '';
        } catch (error) {
          if (closed || generation !== projectGeneration) return;
          item.status = 'error';
          item.error = error?.message || '会话读取失败';
        } finally {
          if (projectReference === held) { projectReference = null; held?.release(); }
        }
      }
      async function scanProject() {
        if (closed || !project || projectReading) return;
        projectReading = true;
        const generation = projectGeneration;
        const batch = project.sessions.filter((item) => item.status === 'pending').slice(0, PROJECT_BATCH);
        project.loading = true;
        publishProject();
        try {
          for (const item of batch) {
            if (closed || generation !== projectGeneration) break;
            item.status = 'loading';
            publishProject();
            await readProjectSession(item, generation);
            publishProject();
          }
        } finally {
          if (generation === projectGeneration) { project.loading = false; projectReading = false; publishProject(); }
        }
      }
      async function loadProject(key = projectKey, refresh = false) {
        const generation = ++projectGeneration;
        projectReading = false;
        view = 'project';
        unsubscribe?.(); unsubscribe = null;
        reference?.release(); reference = null;
        eventSource = null; session = null;
        projectReference?.release(); projectReference = null;
        post({ type: 'loading' });
        try {
          if (refresh || sessions.list.getSnapshot().phase === 'pending') await sessions.refresh?.();
          if (workspaces?.list?.getSnapshot()?.phase === 'pending') {
            await new Promise((resolve) => {
              let unsubscribeList;
              const timeout = setTimeout(() => { unsubscribeList?.(); resolve(); }, 5000);
              const settled = () => {
                if (workspaces.list.getSnapshot().phase !== 'pending') {
                  clearTimeout(timeout); unsubscribeList?.(); resolve();
                }
              };
              unsubscribeList = workspaces.list.subscribe(settled);
              settled();
            });
          }
          if (closed || generation !== projectGeneration) return;
          const result = catalog();
          if (result.pending) throw new Error(result.error || 'DSH 项目目录尚未就绪，请重试');
          const target = result.projects.find((item) => item.key === key) || result.selected;
          if (!target) throw new Error(result.error || '无法确定当前会话所属项目');
          projectKey = target.key;
          project = { key: target.key, title: target.title, cwd: target.cwd, scope: target.scope,
            workspaceId: target.workspaceId || null, currentSessionId: sessionId,
            projects: result.projects.map(({ key: projectId, title, cwd, scope, ids }) => ({ key: projectId, title, cwd, scope, count: ids.length })),
            sessions: target.ids.map((id) => {
              const row = result.byId[id] || {};
              return { sessionId: id, parentSessionId: row.parentId || null, title: row.displayTitle || row.title || '未命名会话',
                updatedAt: row.updatedAt || null, status: 'pending', events: [], eventCount: 0, incomplete: false, error: '' };
            }), loading: false, maxEventsPerSession: MAX_PROJECT_EVENTS, catalogPending: result.pending, catalogError: result.error };
          publishProject();
          scanProject();
        } catch (error) {
          if (!closed && generation === projectGeneration) post({ type: 'error', error: error?.message || '项目读取失败' });
        }
      }
      function send() {
        if (view !== 'session' || !eventSource) return;
        const windowSnapshot = eventSource.getSnapshot();
        const rows = windowSnapshot.entries.filter((entry) => entry.type === 'event' && entry.event?.type);
        if (oldestVisibleSeq !== null) {
          const anchor = rows.findIndex(({ event }) => event.seq === oldestVisibleSeq);
          if (anchor >= 0) visibleLimit = Math.min(MAX_EVENTS, Math.max(visibleLimit, rows.length - anchor));
        }
        const visibleRows = rows.slice(-visibleLimit);
        oldestVisibleSeq = visibleRows[0]?.event.seq ?? null;
        const events = visibleRows.map(({ event }) => ({
          type: event.type,
          seq: event.seq,
          time: event.time,
          sourceEventSeqs: event.sourceEventSeqs,
          data: compact(event.data),
        }));
        const listing = sessions.list.getSnapshot().byId[selectedSessionId] || {};
        const olderAvailable = Boolean(windowSnapshot.hasMore || rows.length > visibleRows.length);
        post({
          type: 'session',
          session: { sessionId: selectedSessionId, title: listing.displayTitle || listing.title || '当前会话', cwd: listing.cwd || '', parentSessionId: listing.parentId || null },
          events,
          hasMore: olderAvailable && events.length < MAX_EVENTS,
          limitReached: olderAvailable && events.length >= MAX_EVENTS,
          maxEvents: MAX_EVENTS,
          historyStatus,
          historyError,
        });
      }
      async function loadOlder() {
        if (closed || !session || !eventSource || historyStatus === 'loading') return;
        const before = eventSource.getSnapshot();
        const rows = before.entries.filter((entry) => entry.type === 'event' && entry.event?.type);
        if (rows.length > visibleLimit) {
          visibleLimit = Math.min(MAX_EVENTS, visibleLimit + PAGE_SIZE);
          historyStatus = 'idle';
          historyError = '';
          send();
          return;
        }
        if (!before.hasMore || rows.length >= MAX_EVENTS) return;
        const state = session.getSnapshot();
        if (state.openState !== 'open' || state.loadingOlder || !state.hasMore) {
          historyStatus = 'error';
          historyError = state.openState !== 'open' ? '当前会话尚未就绪，请稍后重试' : 'DSH 正在读取历史，请稍后重试';
          send();
          return;
        }
        historyStatus = 'loading';
        historyError = '';
        send();
        try {
          await session.loadOlder();
          if (closed || !eventSource) return;
          if (session.getSnapshot().openState !== 'open') throw new Error('DSH 会话读取中断');
          const after = eventSource.getSnapshot();
          const firstAfter = after.entries.find((entry) => entry.type === 'event' && entry.event?.type)?.event.seq;
          const firstBefore = rows[0]?.event.seq;
          if (after.hasMore && !(Number.isFinite(firstAfter) && (firstBefore === undefined || firstAfter < firstBefore))) {
            throw new Error('没有读到更早的事件，请重试');
          }
          visibleLimit = Math.min(MAX_EVENTS, visibleLimit + PAGE_SIZE);
          historyStatus = 'idle';
        } catch (error) {
          if (closed) return;
          historyStatus = 'error';
          historyError = error?.message || '加载更早事件失败，请重试';
        }
        send();
      }
      function receive(event) {
        if (event.origin !== MAP_ORIGIN || event.source !== frame.contentWindow) return;
        if (event.data?.namespace !== NAMESPACE) return;
        if (event.data.type === 'ready') {
          ready = true;
          loadProject();
        } else if (event.data.type === 'refresh') {
          if (view === 'project') loadProject(projectKey, true);
          else if (pendingError || !eventSource) loadSession();
          else send();
        } else if (event.data.type === 'select-project' && typeof event.data.key === 'string') {
          if (project?.projects.some((item) => item.key === event.data.key)) loadProject(event.data.key);
        } else if (event.data.type === 'load-project-more' && view === 'project') {
          scanProject();
        } else if (event.data.type === 'open-session' && typeof event.data.sessionId === 'string') {
          if (project?.sessions.some((item) => item.sessionId === event.data.sessionId)) {
            projectGeneration += 1;
            projectReading = false;
            project.loading = false;
            project.sessions.forEach((item) => { if (item.status === 'loading') item.status = 'pending'; });
            projectReference?.release(); projectReference = null;
            view = 'session';
            selectedSessionId = event.data.sessionId;
            loadSession();
          }
        } else if (event.data.type === 'show-project') {
          unsubscribe?.(); unsubscribe = null;
          reference?.release(); reference = null;
          eventSource = null; session = null;
          view = 'project';
          publishProject();
        } else if (event.data.type === 'load-older' && view === 'session') {
          loadOlder();
        }
      }
      function close() {
        if (closed) return;
        closed = true;
        window.removeEventListener('message', receive);
        document.removeEventListener('keydown', onKeyDown);
        projectGeneration += 1;
        projectReference?.release(); projectReference = null;
        unsubscribe?.();
        reference?.release();
        overlay.remove();
      }
      function onKeyDown(event) {
        if (event.key === 'Escape') close();
      }
      closeButton.addEventListener('click', close);
      overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
      document.addEventListener('keydown', onKeyDown);
      window.addEventListener('message', receive);
      async function loadSession() {
        if (closed) return;
        unsubscribe?.();
        unsubscribe = null;
        reference?.release();
        reference = null;
        eventSource = null;
        session = null;
        visibleLimit = PAGE_SIZE;
        oldestVisibleSeq = null;
        historyStatus = 'idle';
        historyError = '';
        pendingError = null;
        post({ type: 'loading' });
        let current;
        try {
          current = sessions.retain(selectedSessionId, { source: 'local-task-map' });
          reference = current;
          const binding = await current.ready;
          if (closed || reference !== current) return;
          if (binding.session.getSnapshot().openState === 'error') throw new Error('DSH 无法打开当前会话');
          session = binding.session;
          eventSource = binding.eventSource;
          unsubscribe = eventSource.subscribe(send);
          send();
        } catch (error) {
          if (closed || (current && reference !== current)) return;
          pendingError = error?.message || 'DSH 会话读取失败';
          post({ type: 'error', error: pendingError });
        }
      }
    }

    return {
      inject: ['slots', 'sessions', 'workspaces'],
      apply(ctx) {
        function LaunchButton({ sessionId }) {
          return React.createElement('button', {
            type: 'button',
            className: 'taskMapLaunch',
            title: '查看项目任务图（只读）',
            onClick: () => openMap(ctx.sessions, ctx.workspaces, sessionId),
          }, '任务图');
        }
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'local-task-map',
          order: 5,
          inject: (sessionId) => ({ sessionId }),
        }, LaunchButton));
      },
    };
  },
});
