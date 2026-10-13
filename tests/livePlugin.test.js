import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const pluginSource = readFileSync(new URL('../dsh-plugin/client.js', import.meta.url), 'utf8');

function setup(entries, openState = 'open', loadPage = () => {}) {
  const windowListeners = new Map();
  let overlay;
  let frame;
  let closeButton;
  let component;
  let slotConfig;
  let released = 0;
  let unsubscribed = 0;
  let loadCalls = 0;
  let feedEntries = entries;
  let hasMore = false;
  let subscriber = null;
  const messages = [];
  const makeElement = (tag) => {
    const element = {
      children: [],
      listeners: new Map(),
      append(...children) { this.children.push(...children); },
      addEventListener(name, listener) { this.listeners.set(name, listener); },
      setAttribute() {},
      remove() { this.removed = true; },
    };
    if (tag === 'iframe') {
      frame = element;
      element.contentWindow = { postMessage(message, origin) { messages.push({ message, origin }); } };
    }
    if (tag === 'button') closeButton = element;
    if (tag === 'div' && !overlay) overlay = element;
    return element;
  };
  const document = {
    body: { append() {} },
    head: { append() {} },
    getElementById() { return {}; },
    createElement: makeElement,
    addEventListener() {},
    removeEventListener() {},
  };
  const window = {
    __ModuleLoader__: { load(spec) { this.spec = spec; } },
    addEventListener(name, listener) { windowListeners.set(name, listener); },
    removeEventListener(name) { windowListeners.delete(name); },
  };
  runInNewContext(pluginSource, { window, document, Promise });
  const plugin = window.__ModuleLoader__.spec.factory((id) => {
    assert.equal(id, 'react');
    return { createElement: (type, props, ...children) => ({ type, props, children }) };
  });
  const prepend = (older, more) => {
    feedEntries = [...older, ...feedEntries];
    hasMore = more;
    subscriber?.();
  };
  const eventSource = {
    getSnapshot: () => ({ entries: feedEntries, hasMore }),
    subscribe(callback) { subscriber = callback; return () => { subscriber = null; unsubscribed += 1; }; },
  };
  const sessions = {
    list: { getSnapshot: () => ({ byId: { 'session-1': { displayTitle: 'Live session', cwd: 'D:/project' } } }) },
    retain(id, options) {
      assert.equal(id, 'session-1');
      assert.equal(options.source, 'local-task-map');
      const session = {
        getSnapshot: () => ({ openState, hasMore, loadingOlder: false }),
        async loadOlder() { loadCalls += 1; await loadPage(prepend); },
      };
      return { ready: Promise.resolve({ eventSource, session }), release() { released += 1; } };
    },
  };
  plugin.apply({
    sessions,
    slots: {
      inject(name, fn) { assert.equal(name, 'conversation.input.left'); fn(); },
      register(config, launch) { slotConfig = config; component = launch; },
    },
  });
  return {
    open() { component(slotConfig.inject('session-1')).props.onClick(); },
    handshake() { windowListeners.get('message')({ origin: 'http://127.0.0.1:4173', source: frame.contentWindow, data: { namespace: 'local-task-map/v1', type: 'ready' } }); },
    refresh() { windowListeners.get('message')({ origin: 'http://127.0.0.1:4173', source: frame.contentWindow, data: { namespace: 'local-task-map/v1', type: 'refresh' } }); },
    loadOlder() { windowListeners.get('message')({ origin: 'http://127.0.0.1:4173', source: frame.contentWindow, data: { namespace: 'local-task-map/v1', type: 'load-older' } }); },
    openSession() { hasMore = true; windowListeners.get('message')({ origin: 'http://127.0.0.1:4173', source: frame.contentWindow, data: { namespace: 'local-task-map/v1', type: 'open-session', sessionId: 'session-1' } }); },
    prepend,
    close() { closeButton.listeners.get('click')(); },
    get messages() { return messages; },
    get released() { return released; },
    get unsubscribed() { return unsubscribed; },
    get loadCalls() { return loadCalls; },
    get overlay() { return overlay; },
  };
}

test('client plugin transfers a bounded persistent window and releases on close', async () => {
  const entries = Array.from({ length: 85 }, (_, index) => ({ type: 'event', event: { seq: index + 1, type: 'user/message', data: { content: 'x'.repeat(900) } } }));
  entries.push({ type: 'transient', event: { seq: 86, type: 'assistant/message' } });
  const app = setup(entries);
  app.open();
  await new Promise(setImmediate);
  app.handshake();
  await new Promise(setImmediate);
  app.openSession();
  await new Promise(setImmediate);
  const snapshot = app.messages.find(({ message }) => message.type === 'session');
  assert.ok(snapshot);
  assert.equal(snapshot.origin, 'http://127.0.0.1:4173');
  assert.equal(snapshot.message.events.length, 80);
  assert.equal(snapshot.message.events[0].seq, 6);
  assert.equal(snapshot.message.events.at(-1).seq, 85);
  assert.equal(snapshot.message.events[0].data.content.length, 700);
  assert.equal(snapshot.message.hasMore, true);
  app.close();
  assert.equal(app.released, 2);
  assert.equal(app.unsubscribed, 1);
  assert.equal(app.overlay.removed, true);
});

test('client plugin reports a settled failed open and still releases it', async () => {
  const app = setup([], 'error');
  app.open();
  await new Promise(setImmediate);
  app.handshake();
  await new Promise(setImmediate);
  app.openSession();
  await new Promise(setImmediate);
  assert.ok(app.messages.some(({ message }) => message.type === 'error'));
  app.refresh();
  await new Promise(setImmediate);
  assert.equal(app.released, 2);
  assert.equal(app.messages.filter(({ message }) => message.type === 'error').length, 2);
  app.close();
  assert.equal(app.released, 3);
});
