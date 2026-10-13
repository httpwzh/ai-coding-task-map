import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeProject } from '../src/data/projectModel.js';
import { buildTaskTree } from '../src/data/taskGraph.js';

const goal = (seq, phase, revision = 1) => ({ type: 'goal/change', seq, time: seq * 100,
  data: { operation: phase === 'clear' ? 'clear' : phase === 'complete' ? 'complete' : 'create',
    ...(phase === 'clear' ? { cleared: { id: 'g1', revision } } : { goal: { id: 'g1', revision, objective: 'Ship feature', phase } }) } });
const todo = (seq, items) => ({ type: 'todo/write', seq, time: seq * 100, data: { todos: items } });
const human = (seq, kind) => ({ type: 'user/message', seq, time: seq * 100,
  data: { content: [{ type: 'text', text: 'Implement search' }], source: { kind } } });
const project = (sessions) => ({ key: 'workspace:one', title: 'Codebase', scope: 'workspace', sessions });
const session = (sessionId, events, extra = {}) => ({ sessionId, title: sessionId,
  status: 'ready', eventCount: events.length, events, ...extra });

test('project graph uses session lineage, last goal revision and last full checklist snapshot', () => {
  const inherited = goal(2, 'active');
  const result = normalizeProject(project([
    session('parent', [human(1, 'runtime-context'), inherited, todo(3, [{ content: 'Compile', status: 'completed' }]),
      todo(4, [{ content: 'Test', status: 'in_progress' }])]),
    session('child', [inherited, goal(5, 'complete', 2)], { parentSessionId: 'parent' }),
    session('broken', [human(9, 'goal')], { status: 'error', incomplete: true, error: 'no history' }),
  ]));
  const byId = new Map(result.nodes.map((node) => [node.id, node]));
  assert.deepEqual(result.stats, { sessions: 3, read: 2, pending: 0, failed: 1, incomplete: 1,
    goals: 2, claimedGoals: 1, todos: 1, claimedTodos: 0 });
  assert.equal(byId.has('todo:parent:3:0'), false);
  assert.equal(byId.get('todo:parent:4:0').data.title, 'Test');
  assert.equal(byId.has('request:broken:9'), false);
  assert.equal(byId.get('goal:child:g1').data.status, 'complete');
  const tree = buildTaskTree(result.nodes, result.edges);
  assert.equal(tree.parent.get('session:child'), 'session:parent');
  assert.equal(tree.parent.get('session:broken'), 'project:workspace:one');
});

test('copied fork records are skipped while new child records and real human requests remain', () => {
  const inherited = goal(2, 'active');
  const result = normalizeProject(project([
    session('parent', [inherited]),
    session('child', [inherited, todo(3, [{ content: 'New child task', status: 'pending' }])], { parentSessionId: 'parent' }),
    session('prompt', [human(4, 'goal'), human(5, 'user')]),
  ]));
  assert.equal(result.stats.goals, 1);
  assert.equal(result.stats.todos, 1);
  assert.equal(result.nodes.find((node) => node.id === 'request:prompt:5').data.title, 'Implement search');
});

test('cyclic parent metadata cannot create cyclic graph links', () => {
  const result = normalizeProject(project([
    session('left', [], { parentSessionId: 'right' }),
    session('right', [], { parentSessionId: 'left' }),
  ]));
  const tree = buildTaskTree(result.nodes, result.edges);
  assert.deepEqual(tree.roots, ['project:workspace:one']);
  assert.equal(tree.children.get('project:workspace:one').length, 2);
});
