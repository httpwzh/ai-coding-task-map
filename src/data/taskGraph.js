const CARD_WIDTH = 256;
const CARD_HEIGHT = 176;
const COLUMN_STEP = 328;
const ROW_STEP = 208;
const MARGIN = 40;

/** Build an ordered forest. Dependency edges never establish ancestry. */
export function buildTaskTree(nodes, edges) {
  const children = new Map(nodes.map(({ id }) => [id, []]));
  const parent = new Map();
  const descendants = new Map([...children.keys()].map((id) => [id, new Set()]));
  const depth = new Map([...children.keys()].map((id) => [id, 0]));

  for (const edge of edges) {
    const { source, target, kind } = edge;
    if (kind === 'dependency' || source === target
      || !children.has(source) || !children.has(target) || parent.has(target)) continue;

    // A target without a parent creates a cycle only if it already contains source.
    let ancestor = source;
    while (ancestor !== target && parent.has(ancestor)) ancestor = parent.get(ancestor);
    if (ancestor === target) continue;

    parent.set(target, source);
    children.get(source).push(target);
  }

  const roots = [...children.keys()].filter((id) => !parent.has(id));
  const preorder = [];
  const stack = [...roots].reverse();
  while (stack.length) {
    const id = stack.pop();
    preorder.push(id);
    const childIds = children.get(id);
    for (let index = childIds.length - 1; index >= 0; index -= 1) {
      const child = childIds[index];
      depth.set(child, depth.get(id) + 1);
      stack.push(child);
    }
  }

  // Reverse preorder visits children before parents without recursive call limits.
  for (let index = preorder.length - 1; index >= 0; index -= 1) {
    const id = preorder[index];
    const result = descendants.get(id);
    for (const child of children.get(id)) {
      result.add(child);
      for (const descendant of descendants.get(child)) result.add(descendant);
    }
  }

  return { children, parent, roots, descendants, depth };
}

/**
 * Project a forest into visible cards. Search retains only matches and ancestors,
 * and takes precedence over collapse state. Coordinates are card top-lefts.
 * Empty projections have zero width/height; hiddenCount includes filtered nodes.
 */
export function projectTaskTree(nodes, tree, collapsedIds, matchingIds = null) {
  const nodeIds = new Set(nodes.map(({ id }) => id));
  const collapsed = collapsedIds instanceof Set ? collapsedIds : new Set(collapsedIds || []);
  const included = matchingIds instanceof Set ? new Set() : null;

  if (included) {
    for (const match of matchingIds) {
      let id = match;
      while (nodeIds.has(id) && !included.has(id)) {
        included.add(id);
        if (!tree.parent.has(id)) break;
        id = tree.parent.get(id);
      }
    }
  }

  const visibleChildren = new Map();
  const positions = new Map();
  const preorder = [];
  const edges = [];
  const stack = [...tree.roots].reverse().map((id) => ({ id, depth: 0, parentId: null }));

  while (stack.length) {
    const { id, depth, parentId } = stack.pop();
    if (!nodeIds.has(id) || visibleChildren.has(id) || (included && !included.has(id))) continue;

    visibleChildren.set(id, []);
    preorder.push(id);
    positions.set(id, { x: MARGIN + depth * COLUMN_STEP, y: 0 });
    if (parentId !== null) {
      visibleChildren.get(parentId).push(id);
      edges.push({ id: `tree-${parentId}-${id}`, source: parentId, target: id, kind: 'hierarchy' });
    }

    if (!included && collapsed.has(id)) continue;
    const childIds = tree.children.get(id) || [];
    for (let index = childIds.length - 1; index >= 0; index -= 1) {
      stack.push({ id: childIds[index], depth: depth + 1, parentId: id });
    }
  }

  // Visible leaves, including collapsed branches, occupy consecutive rows.
  let leafIndex = 0;
  for (const id of preorder) {
    if (visibleChildren.get(id).length === 0) {
      positions.get(id).y = MARGIN + leafIndex * ROW_STEP;
      leafIndex += 1;
    }
  }
  for (let index = preorder.length - 1; index >= 0; index -= 1) {
    const id = preorder[index];
    const childIds = visibleChildren.get(id);
    if (childIds.length) {
      positions.get(id).y = (positions.get(childIds[0]).y + positions.get(childIds.at(-1)).y) / 2;
    }
  }

  let width = 0;
  let height = 0;
  const visibleNodes = [];
  for (const node of nodes) {
    const position = positions.get(node.id);
    if (!position) continue;
    visibleNodes.push({ ...node, position: { ...position } });
    width = Math.max(width, position.x + CARD_WIDTH + MARGIN);
    height = Math.max(height, position.y + CARD_HEIGHT + MARGIN);
  }

  return { nodes: visibleNodes, edges, width, height, hiddenCount: nodes.length - visibleNodes.length };
}

/** Count work items only; completion is the rounded percentage of successes. */
export function summarizeTasks(nodes) {
  const summary = { total: 0, success: 0, running: 0, waiting: 0, failed: 0, completion: 0 };
  for (const node of nodes) {
    if (node.data?.workItem !== true) continue;
    summary.total += 1;
    const status = node.data.status;
    if (status === 'success' || status === 'running' || status === 'waiting' || status === 'failed') {
      summary[status] += 1;
    }
  }
  summary.completion = summary.total ? Math.round((summary.success / summary.total) * 100) : 0;
  return summary;
}
