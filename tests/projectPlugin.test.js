import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../dsh-plugin/client.js', import.meta.url), 'utf8');
const nextTurn = () => new Promise(setImmediate);

function harness() {
  const listeners = new Map();
  const messages = [];
  const retained = [];
  const released = [];
  const byId = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`s${i + 1}`, { id: `s${i + 1}`, displayTitle: `Session ${i + 1}`, cwd: 'D:/project' }]));
  byId.archived = { id: 'archived', displayTitle: 'Archived', cwd: 'D:/different' };
  byId.child = { id: 'child', displayTitle: 'Fork', parentId: 's1', origin: 'subagent', updatedAt: 0 };
  byId.other = { id: 'other', displayTitle: 'Other project', cwd: 'D:/other' };
  byId.stray = { id: 'stray', displayTitle: 'Unregistered', cwd: 'D:/orphan' };
  let frame;
  let button;
  let launch;
  let slot;
  const document = { body: { append() {} }, head: { append() {} }, getElementById: () => ({}),
    addEventListener() {}, removeEventListener() {}, createElement(tag) {
      const element = { children: [], listeners: new Map(), append(...parts) { this.children.push(...parts); },
        setAttribute() {}, remove() {}, addEventListener(name, fn) { this.listeners.set(name, fn); } };
      if (tag === 'iframe') { frame = element; element.contentWindow = { postMessage(message) { messages.push(message); } }; }
      if (tag === 'button') button = element;
      return element;
    } };
  const window = { __ModuleLoader__: { load(spec) { this.plugin = spec; } },
    addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } };
  runInNewContext(source, { window, document, Promise, setTimeout, clearTimeout });
  const plugin = window.__ModuleLoader__.plugin.factory(() => ({ createElement: (_tag, props) => ({ props }) }));
  const goal = (seq, phase) => ({ type: 'goal/change', seq, time: seq * 100, data: { operation: phase === 'complete' ? 'complete' : 'create', goal: { id: 'g', revision: seq, objective: 'Project work', phase } } });
  const events = { s1: [goal(1, 'active'), { type: 'todo/write', seq: 2, time: 200, data: { todos: [{ content: 'Old item', status: 'pending' }] } },
    goal(3, 'complete'), { type: 'todo/write', seq: 4, time: 400, data: { todos: [{ content: 'Current item', status: 'in_progress' }] } }] };
  const sessions = {
    list: { getSnapshot: () => ({ ids: [...Object.keys(byId).filter((id) => id.startsWith('s')), 'other', 'stray'], byId, phase: 'ready' }) },
    retain(id, { source: retainSource }) {
      assert.equal(retainSource, 'local-task-map');
      retained.push(id);
      const rows = (events[id] || []).map((event) => ({ type: 'event', event }));
      const eventSource = { getSnapshot: () => ({ entries: rows, hasMore: false }), subscribe: () => () => {} };
      const session = { getSnapshot: () => ({ openState: 'open', hasMore: false }) };
      return { ready: Promise.resolve({ session, eventSource }), release() { released.push(id); } };
    },
  };
  const workspaces = { list: { getSnapshot: () => ({ phase: 'ready', state: 'ready', items: [
    { workspaceId: 'one', title: 'Main workspace', path: 'D:/project', sessionIds: [...Array.from({ length: 14 }, (_, i) => `s${i + 1}`), 'archived'] },
    { workspaceId: 'two', title: 'Second workspace', path: 'D:/other', sessionIds: ['other'] },
  ] }) } };
  plugin.apply({ sessions, workspaces, slots: { inject(_name, fn) { fn(); }, register(config, fn) { slot = config; launch = fn; } } });
  function receive(type, extra = {}, origin = 'http://127.0.0.1:4173') {
    listeners.get('message')({ origin, source: frame.contentWindow, data: { namespace: 'local-task-map/v1', type, ...extra } });
  }
  return {
    async open() { launch(slot.inject('child')).props.onClick(); receive('ready'); await nextTurn(); },
    receive, get messages() { return messages; }, get retained() { return retained; }, get released() { return released; },
    latest() { return messages.filter((message) => message.type === 'project').at(-1)?.project; },
    close() { button.listeners.get('click')(); },
  };
}

test('workspace membership shows all sessions immediately, including archived and explicit fork ancestry', async () => {
  const app = harness();
  await app.open();
  const project = app.latest();
  assert.equal(project.key, 'workspace:one');
  assert.equal(project.scope, 'workspace');
  assert.equal(project.sessions.length, 16);
  assert.ok(project.sessions.some((item) => item.sessionId === 'archived'));
  assert.equal(project.sessions.find((item) => item.sessionId === 'child').parentSessionId, 's1');
  assert.equal(project.sessions.filter((item) => item.status === 'ready').length, 12);
  assert.equal(project.sessions.filter((item) => item.status === 'pending').length, 4);
  assert.ok(!project.sessions.some((item) => item.sessionId === 'stray'));
  const s1 = project.sessions.find((item) => item.sessionId === 's1');
  assert.equal(s1.events.find((event) => event.type === 'goal/change').data.goal.phase, 'complete');
  assert.equal(s1.events.find((event) => event.type === 'todo/write').data.todos[0].content, 'Current item');
  assert.deepEqual(app.retained, app.released);
  app.receive('load-project-more', {}, 'http://localhost:4173');
  assert.equal(app.retained.length, 12);
  app.receive('load-project-more');
  await nextTurn();
  assert.equal(app.latest().sessions.filter((item) => item.status === 'ready').length, 16);
  assert.deepEqual(app.retained, app.released);
  app.close();
});

test('session drilldown returns to the same project and releases both references', async () => {
  const app = harness();
  await app.open();
  app.receive('open-session', { sessionId: 'stray' });
  assert.equal(app.retained.length, 12);
  app.receive('open-session', { sessionId: 's3' });
  await nextTurn();
  assert.equal(app.messages.at(-1).type, 'session');
  assert.equal(app.messages.at(-1).session.sessionId, 's3');
  assert.equal(app.retained.length, 13);
  app.receive('show-project');
  assert.equal(app.messages.at(-1).type, 'project');
  assert.equal(app.latest().sessions.filter((item) => item.status === 'pending').length, 4);
  assert.deepEqual(app.retained, app.released);
  app.receive('load-project-more');
  await nextTurn();
  assert.equal(app.latest().sessions.filter((item) => item.status === 'ready').length, 16);
  app.close();
  assert.deepEqual(app.retained, app.released);
});

test('switching workspace reads only explicitly registered members', async () => {
  const app = harness();
  await app.open();
  app.receive('select-project', { key: 'workspace:two' });
  await nextTurn();
  assert.equal(app.latest().key, 'workspace:two');
  assert.deepEqual(Array.from(app.latest().sessions, (item) => item.sessionId), ['other']);
  app.close();
});
