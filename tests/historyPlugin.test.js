import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../dsh-plugin/client.js', import.meta.url), 'utf8');

function harness(entries, onLoad = () => {}) {
  const messages = [];
  const listeners = new Map();
  let frame;
  let closeButton;
  let callback;
  let rows = entries;
  let hasMore = false;
  let calls = 0;
  let released = 0;
  let unsubscribed = 0;
  const document = {
    getElementById: () => ({}),
    createElement(tag) {
      const element = {
        listeners: {},
        append() {}, setAttribute() {}, remove() {},
        addEventListener(name, fn) { this.listeners[name] = fn; },
      };
      if (tag === 'iframe') {
        frame = element;
        frame.contentWindow = { postMessage(message, origin) { messages.push({ message, origin }); } };
      }
      if (tag === 'button') closeButton = element;
      return element;
    },
    head: { append() {} }, body: { append() {} },
    addEventListener() {}, removeEventListener() {},
  };
  const window = {
    __ModuleLoader__: { load(value) { this.plugin = value; } },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
  };
  runInNewContext(source, { document, window, Promise });
  const plugin = window.__ModuleLoader__.plugin.factory(() => ({ createElement: (_type, props) => ({ props }) }));
  const prepend = (older, more) => {
    rows = [...older, ...rows];
    hasMore = more;
    callback?.();
  };
  const append = (newer) => {
    rows = [...rows, ...newer];
    callback?.();
  };
  const session = {
    getSnapshot: () => ({ openState: 'open', hasMore, loadingOlder: false }),
    async loadOlder() { calls += 1; await onLoad(prepend, append); },
  };
  const eventSource = {
    getSnapshot: () => ({ entries: rows, hasMore }),
    subscribe(fn) { callback = fn; return () => { callback = null; unsubscribed += 1; }; },
  };
  let launch;
  plugin.apply({
    sessions: {
      retain: () => ({ ready: Promise.resolve({ session, eventSource }), release() { released += 1; } }),
      list: { getSnapshot: () => ({ byId: {} }) },
    },
    slots: { inject: (_name, fn) => fn(), register: (_config, component) => { launch = component; } },
  });
  const receive = (type) => listeners.get('message')({ source: frame.contentWindow, origin: 'http://127.0.0.1:4173', data: { namespace: 'local-task-map/v1', type } });
  return {
    async open() { launch({ sessionId: 'one' }).props.onClick(); receive('ready'); await new Promise(setImmediate); hasMore = true; listeners.get('message')({ source: frame.contentWindow, origin: 'http://127.0.0.1:4173', data: { namespace: 'local-task-map/v1', type: 'open-session', sessionId: 'one' } }); await new Promise(setImmediate); },
    load() { receive('load-older'); },
    forgedLoad(origin) { listeners.get('message')({ source: frame.contentWindow, origin, data: { namespace: 'local-task-map/v1', type: 'load-older' } }); },
    close() { closeButton.listeners.click(); },
    latest() { return messages.filter(({ message }) => message.type === 'session').at(-1)?.message; },
    get calls() { return calls; }, get released() { return released; }, get unsubscribed() { return unsubscribed; },
  };
}

const events = (start, count) => Array.from({ length: count }, (_, index) => ({ type: 'event', event: { seq: start + index, type: 'user/message', data: { content: 'test' } } }));

 test('reveals cached entries before requesting DSH and stops at the history start', async () => {
  const app = harness(events(111, 90), (prepend) => prepend(events(31, 80), false));
  await app.open();
  assert.equal(app.latest().events[0].seq, 121);
  app.load();
  assert.equal(app.calls, 0);
  assert.equal(app.latest().events.length, 90);
  app.load();
  await new Promise(setImmediate);
  assert.equal(app.calls, 1);
  assert.equal(app.latest().events.length, 170);
  assert.equal(app.latest().events[0].seq, 31);
  app.load();
  assert.equal(app.calls, 1);
  assert.equal(app.latest().events.length, 170);
  assert.equal(app.latest().hasMore, false);
  app.close();
  assert.equal(app.released, 2);
});

test('history requests from another origin cannot trigger DSH reads', async () => {
  const app = harness(events(1, 80));
  await app.open();
  app.forgedLoad('http://localhost:4173');
  assert.equal(app.calls, 0);
  assert.equal(app.latest().events.length, 80);
  app.close();
});

test('silent pagination failure retains the view and can retry', async () => {
  let succeed = false;
  const app = harness(events(81, 80), (prepend) => {
    if (succeed) prepend(events(1, 80), false);
  });
  await app.open();
  app.load();
  await new Promise(setImmediate);
  assert.equal(app.latest().historyStatus, 'error');
  assert.equal(app.latest().events.length, 80);
  assert.equal(app.latest().hasMore, true);
  succeed = true;
  app.load();
  await new Promise(setImmediate);
  assert.equal(app.calls, 2);
  assert.equal(app.latest().events.length, 160);
  assert.equal(app.latest().historyStatus, 'idle');
  app.close();
});

test('incoming live events do not masquerade as older history', async () => {
  const app = harness(events(81, 80), (_prepend, append) => append(events(161, 5)));
  await app.open();
  app.load();
  await new Promise(setImmediate);
  assert.equal(app.latest().historyStatus, 'error');
  assert.equal(app.latest().hasMore, true);
  app.close();
});

test('pagination is single-flight and closing suppresses late results', async () => {
  let resolvePage;
  const app = harness(events(81, 80), async (prepend) => {
    await new Promise((resolve) => { resolvePage = resolve; });
    prepend(events(1, 80), false);
  });
  await app.open();
  app.load();
  app.load();
  assert.equal(app.calls, 1);
  assert.equal(app.latest().historyStatus, 'loading');
  app.close();
  resolvePage();
  await new Promise(setImmediate);
  assert.equal(app.released, 2);
  assert.equal(app.unsubscribed, 1);
});

test('500-event cap prevents unbounded history exposure', async () => {
  const app = harness(events(1, 650));
  await app.open();
  for (let i = 0; i < 6; i++) app.load();
  assert.equal(app.latest().events.length, 500);
  assert.equal(app.latest().hasMore, false);
  assert.equal(app.latest().limitReached, true);
  assert.equal(app.calls, 0);
  app.close();
});
