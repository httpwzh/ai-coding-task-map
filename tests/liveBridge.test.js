import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectDshFrame, isDshFrame, requestDshSession, requestOlderEvents } from '../src/data/liveBridge.js';

test('iframe bridge accepts only messages from the exact DSH parent', () => {
  const posted = [];
  const parent = { postMessage: (message, origin) => posted.push({ message, origin }) };
  const listeners = new Map();
  const previous = globalThis.window;
  globalThis.window = {
    parent,
    location: { origin: 'http://127.0.0.1:4173' },
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
  };
  try {
    assert.equal(isDshFrame(), true);
    const messages = [];
    const disconnect = connectDshFrame((message) => messages.push(message));
    assert.equal(posted[0].message.type, 'ready');
    assert.equal(posted[0].origin, '*');
    requestOlderEvents();
    assert.equal(posted.length, 1);
    const receive = listeners.get('message');
    const data = { namespace: 'local-task-map/v1', type: 'session', events: [] };
    receive({ source: {}, origin: 'http://127.0.0.1:19387', data });
    receive({ source: parent, origin: 'http://localhost:19387', data });
    receive({ source: parent, origin: 'http://127.0.0.1:19387', data: { ...data, namespace: 'other' } });
    assert.equal(messages.length, 0);
    receive({ source: parent, origin: 'http://127.0.0.1:19387', data });
    assert.deepEqual(messages, [data]);
    requestDshSession();
    assert.equal(posted[1].message.type, 'refresh');
    assert.equal(posted[1].origin, 'http://127.0.0.1:19387');
    requestOlderEvents();
    assert.equal(posted[2].message.type, 'load-older');
    assert.equal(posted[2].origin, 'http://127.0.0.1:19387');
    disconnect();
    assert.equal(listeners.has('message'), false);
  } finally {
    globalThis.window = previous;
  }
});

test('iframe bridge supports the authenticated desktop shell origin', () => {
  const posted = [];
  const parent = { postMessage: (message, origin) => posted.push({ message, origin }) };
  const listeners = new Map();
  const previous = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    parent,
    location: { origin: 'http://127.0.0.1:4173' },
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
  };
  globalThis.document = { referrer: '' };
  try {
    const messages = [];
    const disconnect = connectDshFrame((message) => messages.push(message));
    assert.equal(posted[0].origin, '*');
    const receive = listeners.get('message');
    const data = { namespace: 'local-task-map/v1', type: 'session', events: [] };
    receive({ source: parent, origin: 'dsh-app://app', data });
    assert.deepEqual(messages, [data]);
    requestDshSession();
    assert.equal(posted[1].origin, 'dsh-app://app');
    requestOlderEvents();
    assert.equal(posted[2].origin, 'dsh-app://app');
    disconnect();
  } finally {
    globalThis.window = previous;
    globalThis.document = previousDocument;
  }
});
