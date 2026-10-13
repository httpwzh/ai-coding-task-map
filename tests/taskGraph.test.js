import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskTree, projectTaskTree, summarizeTasks } from '../src/data/taskGraph.js';

const makeNodes = (ids) => ids.map((id) => ({
  id,
  type: 'task',
  position: { x: -10, y: -20 },
  data: { title: id, workItem: true, status: 'waiting' },
}));
const edge = (source, target, kind = 'hierarchy') => ({ source, target, kind });
const ids = (projection) => projection.nodes.map((node) => node.id);
const positions = (projection) => new Map(projection.nodes.map((node) => [node.id, node.position]));

function fixture() {
  const nodes = makeNodes(['r', 'a', 'b', 'a1', 'a2', 'a11', 'q', 'q1', 'isolated']);
  const edges = [
    edge('r', 'a'), edge('a', 'a1'), edge('a1', 'a11'), edge('a', 'a2'),
    edge('r', 'b'), edge('q', 'q1'),
  ];
  return { nodes, edges, tree: buildTaskTree(nodes, edges) };
}

function assertLayout(projection) {
  const { nodes, edges, width, height } = projection;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    assert.ok(Number.isFinite(node.position.x) && Number.isFinite(node.position.y));
    assert.ok(node.position.x >= 40 && node.position.y >= 40, `${node.id} stays inside the margin`);
    assert.ok(node.position.x + 256 + 40 <= width, `${node.id} fits the width`);
    assert.ok(node.position.y + 176 + 40 <= height, `${node.id} fits the height`);
  }
  for (let index = 0; index < nodes.length; index += 1) {
    for (let next = index + 1; next < nodes.length; next += 1) {
      const a = nodes[index];
      const b = nodes[next];
      assert.ok(
        Math.abs(a.position.x - b.position.x) >= 256 || Math.abs(a.position.y - b.position.y) >= 176,
        `${a.id} and ${b.id} do not overlap`,
      );
    }
  }
  const children = new Map();
  for (const relation of edges) {
    assert.equal(relation.kind, 'hierarchy');
    assert.equal(relation.id, `tree-${relation.source}-${relation.target}`);
    assert.ok(byId.has(relation.source) && byId.has(relation.target));
    assert.equal(byId.get(relation.target).position.x - byId.get(relation.source).position.x, 328);
    if (!children.has(relation.source)) children.set(relation.source, []);
    children.get(relation.source).push(byId.get(relation.target));
  }
  for (const [parent, childNodes] of children) {
    assert.equal(byId.get(parent).position.y, (childNodes[0].position.y + childNodes.at(-1).position.y) / 2);
  }
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

test('buildTaskTree preserves node, root, and sibling input order with one parent per child', () => {
  const nodes = makeNodes(['leaf', 'root-2', 'root-1', 'b', 'a', 'orphan']);
  const tree = buildTaskTree(nodes, [
    edge('missing', 'a'), edge('root-1', 'b'), edge('root-1', 'a'),
    edge('root-2', 'a'), edge('root-1', 'a'), edge('a', 'leaf'),
  ]);
  assert.deepEqual([...tree.children.keys()], nodes.map((node) => node.id));
  assert.deepEqual(tree.roots, ['root-2', 'root-1', 'orphan']);
  assert.deepEqual(tree.children.get('root-1'), ['b', 'a']);
  assert.deepEqual([...tree.parent], [['b', 'root-1'], ['a', 'root-1'], ['leaf', 'a']]);
  assert.deepEqual([...tree.descendants.get('root-1')], ['b', 'a', 'leaf']);
  assert.deepEqual(tree.descendants.get('leaf'), new Set());
  assert.deepEqual([...tree.depth], [['leaf', 2], ['root-2', 0], ['root-1', 0], ['b', 1], ['a', 1], ['orphan', 0]]);
});

test('cycles, self edges, and missing endpoints are excluded without consuming a valid parent', () => {
  const nodes = makeNodes(['r', 'a', 'b', 'c', 'd', 'orphan']);
  const tree = buildTaskTree(nodes, [
    edge('missing', 'a'), edge('r', 'missing'), edge('r', 'r'),
    edge('r', 'a'), edge('a', 'b'), edge('b', 'r'),
    edge('c', 'r'), edge('c', 'a'), edge('c', 'd'), edge('d', 'c'),
  ]);
  assert.deepEqual(tree.roots, ['c', 'orphan']);
  assert.deepEqual([...tree.parent], [['a', 'r'], ['b', 'a'], ['r', 'c'], ['d', 'c']]);
  assert.deepEqual([...tree.descendants.get('c')], ['r', 'a', 'b', 'd']);
  assert.equal(tree.depth.get('b'), 3);
  for (const [id, descendants] of tree.descendants) assert.ok(!descendants.has(id));
  assertLayout(projectTaskTree(nodes, tree, new Set()));
});

test('dependency edges never become children, ancestors, or collapse targets', () => {
  const nodes = makeNodes(['r', 'a', 'dependency', 'root-2']);
  const tree = buildTaskTree(nodes, [
    edge('r', 'dependency', 'dependency'), edge('a', 'r', 'dependency'),
    edge('r', 'a'), edge('dependency', 'a', 'dependency'),
    edge('root-2', 'dependency'),
  ]);
  assert.deepEqual(tree.roots, ['r', 'root-2']);
  assert.deepEqual(tree.descendants.get('r'), new Set(['a']));
  assert.equal(tree.parent.get('dependency'), 'root-2');
  const collapsed = projectTaskTree(nodes, tree, new Set(['r']));
  assert.deepEqual(ids(collapsed), ['r', 'dependency', 'root-2']);
  assert.deepEqual(collapsed.edges, [{ id: 'tree-root-2-dependency', source: 'root-2', target: 'dependency', kind: 'hierarchy' }]);
  const filtered = projectTaskTree(nodes, tree, new Set(), new Set(['dependency']));
  assert.deepEqual(ids(filtered), ['dependency', 'root-2']);
});

test('nested collapse restores inner state and leaves independent branches expanded', () => {
  const { nodes, tree } = fixture();
  const state = new Set(['a1']);
  const inner = projectTaskTree(nodes, tree, state);
  assert.deepEqual(ids(inner), ['r', 'a', 'b', 'a1', 'a2', 'q', 'q1', 'isolated']);
  state.add('a');
  const outer = projectTaskTree(nodes, tree, state);
  assert.deepEqual(ids(outer), ['r', 'a', 'b', 'q', 'q1', 'isolated']);
  assert.equal(outer.hiddenCount, 3);
  assert.ok(outer.edges.some(({ source, target }) => source === 'q' && target === 'q1'));
  state.delete('a');
  assert.deepEqual(projectTaskTree(nodes, tree, state), inner);
  state.delete('a1');
  const expanded = projectTaskTree(nodes, tree, state);
  assert.equal(expanded.hiddenCount, 0);
  assert.deepEqual(expanded, projectTaskTree(nodes, tree, new Set()));
  for (const projection of [inner, outer, expanded]) assertLayout(projection);
});

test('collapsing every root leaves a compact column of roots', () => {
  const { nodes, tree } = fixture();
  const projection = projectTaskTree(nodes, tree, new Set([...tree.roots, 'a', 'unknown']));
  assert.deepEqual(ids(projection), ['r', 'q', 'isolated']);
  assert.deepEqual(projection.nodes.map((node) => node.position), [{ x: 40, y: 40 }, { x: 40, y: 248 }, { x: 40, y: 456 }]);
  assert.deepEqual(projection.edges, []);
  assert.equal(projection.hiddenCount, 6);
  assert.equal(projection.width, 336);
  assert.equal(projection.height, 672);
  assertLayout(projection);
});

test('filter retains only matches and ancestor paths through collapsed nodes', () => {
  const { nodes, tree } = fixture();
  const collapsed = new Set(['r', 'a', 'a1', 'q']);
  const matching = new Set(['a11', 'q1', 'missing']);
  const projection = projectTaskTree(nodes, tree, collapsed, matching);
  assert.deepEqual(ids(projection), ['r', 'a', 'a1', 'a11', 'q', 'q1']);
  assert.equal(projection.hiddenCount, 3);
  assert.equal(projection.edges.length, 4);
  assert.equal(positions(projection).get('a11').x, 40 + 3 * 328);
  assert.deepEqual(collapsed, new Set(['r', 'a', 'a1', 'q']));
  assert.deepEqual(matching, new Set(['a11', 'q1', 'missing']));
  assertLayout(projection);
  assert.deepEqual(ids(projectTaskTree(nodes, tree, collapsed)), ['r', 'q', 'isolated']);
  assert.deepEqual(ids(projectTaskTree(nodes, tree, collapsed, new Set(['a']))), ['r', 'a']);
  assert.deepEqual(ids(projectTaskTree(nodes, tree, collapsed, new Set(['r']))), ['r']);
});

test('empty matches, absent matches, and an empty forest return finite empty bounds', () => {
  const { nodes, tree } = fixture();
  for (const matches of [new Set(), new Set(['absent'])]) {
    assert.deepEqual(projectTaskTree(nodes, tree, new Set(), matches), {
      nodes: [], edges: [], width: 0, height: 0, hiddenCount: nodes.length,
    });
  }
  const emptyTree = buildTaskTree([], [edge('missing', 'also-missing')]);
  assert.deepEqual(emptyTree, { children: new Map(), parent: new Map(), roots: [], descendants: new Map(), depth: new Map() });
  assert.deepEqual(projectTaskTree([], emptyTree, new Set()), { nodes: [], edges: [], width: 0, height: 0, hiddenCount: 0 });
});

test('collapse recomputes leaf rows and shrinks the canvas; leaf collapse is a no-op', () => {
  const { nodes, tree } = fixture();
  const expanded = projectTaskTree(nodes, tree, new Set());
  const collapsed = projectTaskTree(nodes, tree, new Set(['a']));
  assert.equal(positions(expanded).get('b').y, 40 + 2 * 208);
  assert.equal(positions(collapsed).get('b').y, 40 + 208);
  assert.equal(collapsed.height, expanded.height - 208);
  assert.ok(collapsed.width < expanded.width);
  assert.deepEqual(projectTaskTree(nodes, tree, new Set(['a11', 'isolated', 'unknown'])), expanded);
  assert.deepEqual(projectTaskTree(nodes, tree, new Set()), expanded);
  assertLayout(collapsed);
});

test('asymmetric forests keep all cards within bounds and every column free of overlap', () => {
  const nodes = makeNodes(['r', 'left', 'right', 'r2', 'single']);
  const edges = [edge('r', 'left'), edge('r', 'right'), edge('r2', 'single')];
  for (let index = 0; index < 18; index += 1) {
    const id = `leaf-${index}`;
    nodes.push(...makeNodes([id]));
    edges.push(edge(index < 15 ? 'left' : 'right', id));
    if (index % 4 === 0) {
      nodes.push(...makeNodes([`${id}-deep`, `${id}-deeper`]));
      edges.push(edge(id, `${id}-deep`), edge(`${id}-deep`, `${id}-deeper`));
    }
  }
  const tree = buildTaskTree(nodes, edges);
  for (const collapsed of [new Set(), new Set(['left']), new Set(['right', 'leaf-0']), new Set(['r', 'r2'])]) {
    const projection = projectTaskTree(nodes, tree, collapsed);
    assertLayout(projection);
    assert.deepEqual(projection, projectTaskTree(nodes, tree, collapsed));
  }
});

test('building, projecting, and summarizing leave inputs and tree maps unchanged', () => {
  const { nodes, edges } = fixture();
  const originalNodes = structuredClone(nodes);
  const originalEdges = structuredClone(edges);
  freeze(nodes);
  freeze(edges);
  const tree = buildTaskTree(nodes, edges);
  const originalTree = structuredClone(tree);
  for (const children of tree.children.values()) Object.freeze(children);
  Object.freeze(tree.roots);
  const projection = projectTaskTree(nodes, tree, new Set(['a']), new Set(['a11']));
  summarizeTasks(nodes);
  assert.deepEqual(nodes, originalNodes);
  assert.deepEqual(edges, originalEdges);
  assert.deepEqual(tree, originalTree);
  for (const node of projection.nodes) {
    const input = nodes.find((candidate) => candidate.id === node.id);
    assert.notStrictEqual(node, input);
    assert.notStrictEqual(node.position, input.position);
  }
});

test('a long cycle is reduced to a finite chain and can collapse to one card', () => {
  const count = 1200;
  const nodes = makeNodes(Array.from({ length: count }, (_, index) => `n${index}`));
  const edges = Array.from({ length: count }, (_, index) => edge(`n${index}`, `n${(index + 1) % count}`));
  const tree = buildTaskTree(nodes, edges);
  assert.deepEqual(tree.roots, ['n0']);
  assert.equal(tree.parent.size, count - 1);
  assert.equal(tree.depth.get(`n${count - 1}`), count - 1);
  assert.equal(tree.descendants.get('n0').size, count - 1);
  const collapsed = projectTaskTree(nodes, tree, new Set(['n0']));
  assert.deepEqual(ids(collapsed), ['n0']);
  assert.equal(collapsed.width, 336);
  assert.equal(collapsed.height, 256);
  const expanded = projectTaskTree(nodes, tree, new Set());
  assert.equal(expanded.nodes.length, count);
  assert.equal(expanded.height, 256);
  assert.equal(expanded.width, 336 + (count - 1) * 328);
});

test('statistics count only explicit work items, without counting group rollups', () => {
  const nodes = [
    { id: 'group', data: { status: 'success', workItem: false } },
    { id: 'rollup', data: { status: 'running' } },
    { id: 'truthy', data: { status: 'success', workItem: 'true' } },
    { id: 'no-data' },
    ...['success', 'success', 'running', 'waiting', 'failed'].map((status, index) => ({
      id: `task-${index}`, data: { status, workItem: true },
    })),
  ];
  assert.deepEqual(summarizeTasks(nodes), { total: 5, success: 2, running: 1, waiting: 1, failed: 1, completion: 40 });
  assert.deepEqual(summarizeTasks(nodes.slice(0, 4)), { total: 0, success: 0, running: 0, waiting: 0, failed: 0, completion: 0 });
  assert.deepEqual(summarizeTasks([]), { total: 0, success: 0, running: 0, waiting: 0, failed: 0, completion: 0 });
});

test('completion rounds success percentage and keeps unknown-state work items in total', () => {
  const nodes = ['success', 'failed', 'unknown'].map((status, index) => ({ id: index, data: { workItem: true, status } }));
  assert.deepEqual(summarizeTasks(nodes), { total: 3, success: 1, running: 0, waiting: 0, failed: 1, completion: 33 });
  nodes[1].data.status = 'success';
  assert.equal(summarizeTasks(nodes).completion, 67);
  nodes[2].data.status = 'success';
  assert.equal(summarizeTasks(nodes).completion, 100);
});
