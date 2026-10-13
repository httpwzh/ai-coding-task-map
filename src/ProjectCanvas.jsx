import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, applyNodeChanges } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const STATUS = { active: '进行中', paused: '已暂停', blocked: '受阻', complete: '声明完成',
  pending: '待处理', in_progress: '进行中', completed: '已完成', ready: '已读取', loading: '读取中',
  error: '读取失败', unknown: '未知' };
const nodeTypes = { task: CanvasNode };

function CanvasNode({ data, selected }) {
  const { item, children, folded, onChoose, onToggle } = data;
  return <div className={`project-node kind-${item.data.kind} ${selected ? 'selected' : ''}`}>
    <Handle type="target" position={Position.Left} className="project-connector" isConnectable={false} />
    <div className="project-node-grip" title="拖动节点" aria-label="拖动节点">⠿</div>
    <button type="button" className="project-node-main nodrag" onClick={() => onChoose(item.id)}>
      <small>{item.data.label} <em>{STATUS[item.data.status] || ''}</em></small>
      <strong>{item.data.title}</strong><span>{item.data.summary}</span>
    </button>
    {children > 0 && <button type="button" className="project-fold nodrag" onClick={() => onToggle(item.id)} aria-label={folded ? `展开 ${item.data.title}` : `折叠 ${item.data.title}`}>{folded ? `+ ${children}` : `− ${children}`}</button>}
    <Handle type="source" position={Position.Right} className="project-connector" isConnectable={false} />
  </div>;
}

export default function ProjectCanvas({ projection, tree, folded, selectedId, positions, onChoose, onToggle, onMoveNode, focusRequest }) {
  const instance = useRef(null);
  const userMoved = useRef(false);
  const sourceNodes = useMemo(() => projection.nodes.map((item) => ({
    id: item.id, type: 'task', position: positions[item.id] || item.position,
    dragHandle: '.project-node-grip', selected: selectedId === item.id,
    data: { item, children: tree.descendants.get(item.id)?.size || 0, folded: folded.has(item.id), onChoose, onToggle },
  })), [projection.nodes, positions, selectedId, tree, folded, onChoose, onToggle]);
  const [nodes, setNodes] = useState(sourceNodes);
  useEffect(() => { setNodes(sourceNodes); }, [sourceNodes]);
  const edges = useMemo(() => projection.edges.map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, type: 'smoothstep',
    style: { stroke: '#8fae9e', strokeWidth: 1.5 },
  })), [projection.edges]);
  useEffect(() => {
    if (!instance.current || userMoved.current || focusRequest) return;
    const root = sourceNodes[0];
    if (root) instance.current.setCenter(root.position.x + 128, root.position.y + 88, { zoom: 1 });
  }, [sourceNodes, focusRequest]);
  useEffect(() => {
    if (!instance.current || !focusRequest) return;
    const focused = sourceNodes.find((node) => node.id === focusRequest.id);
    if (focused) instance.current.setCenter(focused.position.x + 128, focused.position.y + 88, { zoom: 1, duration: 200 });
  }, [sourceNodes, focusRequest]);
  return <div className="project-flow" aria-label="项目任务画布">
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
      onNodesChange={(changes) => setNodes((current) => applyNodeChanges(changes, current))}
      onNodeDragStop={(_, node) => { userMoved.current = true; onMoveNode(node.id, node.position); }}
      onNodeClick={(_, node) => onChoose(node.id)}
      onInit={(flow) => { instance.current = flow; const root = sourceNodes[0]; if (root) flow.setCenter(root.position.x + 128, root.position.y + 88, { zoom: 1 }); }}
      onMoveStart={(event) => { if (event) userMoved.current = true; }}
      panOnDrag zoomOnPinch zoomOnScroll={false} zoomOnDoubleClick={false}
      nodesConnectable={false} elementsSelectable minZoom={0.2} maxZoom={2}>
      <Background color="#d5dfdd" gap={24} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  </div>;
}
