import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyProjectDraft, mergeProjectDraft, projectDraftKey, readProjectDraft, removeLocalTask, saveProjectDraft } from '../src/data/projectDraft.js';
import { normalizeProject } from '../src/data/projectModel.js';
import { buildTaskTree } from '../src/data/taskGraph.js';

const storage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const project = () => normalizeProject({ key: 'workspace:a', title: 'Original', scope: 'workspace', sessions: [
  { sessionId: 's1', title: 'Session', status: 'ready', eventCount: 1, events: [
    { type: 'goal/change', seq: 1, time: 10, data: { goal: { id: 'g1', phase: 'active', objective: 'Source goal' } } },
  ] },
] });

test('drafts are versioned and isolated by project key', () => {
  const memory = storage();
  const draft = { tasks: [{ id: 'local:one', parentId: 'project:workspace:a', title: 'Plan', status: 'pending', note: '' }], notes: {}, positions: {} };
  saveProjectDraft('workspace:a', draft, memory);
  assert.deepEqual(readProjectDraft('workspace:a', memory), draft);
  assert.deepEqual(readProjectDraft('workspace:b', memory), emptyProjectDraft());
  assert.notEqual(projectDraftKey('workspace:a'), projectDraftKey('workspace:b'));
});

test('local tasks join the source tree without changing recorded progress or source nodes', () => {
  const original = project();
  const draft = { tasks: [
    { id: 'local:one', parentId: 'goal:s1:g1', title: 'Review', note: '', status: 'completed' },
    { id: 'local:two', parentId: 'local:one', title: 'Approval', note: 'Need sign-off', status: 'blocked' },
  ], notes: { 'goal:s1:g1': 'Check later' }, positions: {} };
  const merged = mergeProjectDraft(original, draft);
  const tree = buildTaskTree(merged.nodes, merged.edges);
  assert.equal(tree.parent.get('local:one'), 'goal:s1:g1');
  assert.equal(tree.parent.get('local:two'), 'local:one');
  assert.equal(merged.localStats.total, 2);
  assert.equal(merged.localStats.done, 1);
  assert.deepEqual(merged.stats, original.stats);
  assert.equal(merged.nodes.find((node) => node.id === 'goal:s1:g1').data.title, 'Source goal');
  assert.equal(original.nodes.length, 3);
});

test('missing source parents are reattached to the project root and deletion removes descendants', () => {
  const draft = { tasks: [
    { id: 'local:child', parentId: 'local:parent', title: 'Child', note: '', status: 'pending' },
    { id: 'local:parent', parentId: 'missing-source', title: 'Parent', note: '', status: 'pending' },
    { id: 'local:grandchild', parentId: 'local:child', title: 'Grandchild', note: '', status: 'pending' },
  ], notes: {}, positions: { 'local:child': { x: 10, y: 20 } } };
  const merged = mergeProjectDraft(project(), draft);
  assert.equal(buildTaskTree(merged.nodes, merged.edges).parent.get('local:child'), 'project:workspace:a');
  assert.equal(buildTaskTree(merged.nodes, merged.edges).parent.get('local:parent'), 'project:workspace:a');
  const remaining = removeLocalTask(draft, 'local:parent');
  assert.deepEqual(remaining.tasks, []);
  assert.deepEqual(remaining.positions, {});
});

test('malformed stored drafts are ignored and saved fields are bounded', () => {
  const memory = storage();
  memory.setItem(projectDraftKey('a'), '{broken');
  assert.deepEqual(readProjectDraft('a', memory), emptyProjectDraft());
  assert.deepEqual(readProjectDraft('a', { getItem() { throw Error('blocked'); } }), emptyProjectDraft());
  memory.setItem(projectDraftKey('a'), JSON.stringify({ version: 1, tasks: [
    { id: 'local:ok', parentId: 'project:a', title: ' x ', note: '', status: 'invalid' },
    { id: 'local:ok', title: 'duplicate' }, { id: 'bad', title: 'forged' },
    { id: 'local:blank', parentId: 'project:a', title: ' ' },
  ], notes: { 'goal:s:g': ' note ' }, positions: { 'local:ok': { x: Infinity, y: 1 }, 'goal:s:g': { x: 8, y: 9 } } }));
  const read = readProjectDraft('a', memory);
  assert.deepEqual(read.tasks, [
    { id: 'local:ok', parentId: 'project:a', title: 'x', note: '', status: 'pending' },
    { id: 'local:blank', parentId: 'project:a', title: '未命名任务', note: '', status: 'pending' },
  ]);
  assert.deepEqual(read.positions, { 'goal:s:g': { x: 8, y: 9 } });
  assert.deepEqual(read.notes, { 'goal:s:g': 'note' });
});
