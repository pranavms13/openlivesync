/**
 * ReactFlow canvas with bidirectional Yjs sync.
 * Y.Maps are the single source of truth; React state derives from them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type NodeChange,
  type EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useYDoc, useAwareness } from "@openlivesync/client/yjs-react";
import type * as Y from "yjs";
import ColorNode from "./ColorNode";
import type { ColorNodeData } from "./ColorNode";
import NodeConfigPanel from "./NodeConfigPanel";
import Cursors from "./Cursors";

const nodeTypes = { colorNode: ColorNode };

/** Serialized node stored in the Y.Map. */
interface YNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: ColorNodeData;
}

/** Serialized edge stored in the Y.Map. */
interface YEdge {
  id: string;
  source: string;
  target: string;
}

function yNodesToArray(yMap: Y.Map<YNode>): Node[] {
  const nodes: Node[] = [];
  yMap.forEach((val, key) => {
    nodes.push({
      id: key,
      type: val.type,
      position: { ...val.position },
      data: { ...val.data },
    });
  });
  return nodes;
}

function yEdgesToArray(yMap: Y.Map<YEdge>): Edge[] {
  const edges: Edge[] = [];
  yMap.forEach((val, key) => {
    edges.push({ id: key, source: val.source, target: val.target });
  });
  return edges;
}

interface FlowProps {
  onAddNodeRef: React.MutableRefObject<(() => void) | null>;
}

export default function Flow({ onAddNodeRef }: FlowProps) {
  return (
    <ReactFlowProvider>
      <FlowInner onAddNodeRef={onAddNodeRef} />
    </ReactFlowProvider>
  );
}

function FlowInner({ onAddNodeRef }: FlowProps) {
  const { doc, provider } = useYDoc("flow-room");
  const awarenessStates = useAwareness(provider);
  const { screenToFlowPosition } = useReactFlow();
  const nodesMap = useMemo(() => doc.getMap<YNode>("nodes"), [doc]);
  const edgesMap = useMemo(() => doc.getMap<YEdge>("edges"), [doc]);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Track which nodes are currently being dragged locally to avoid Yjs observer overwriting mid-drag positions
  const draggingIds = useRef<Set<string>>(new Set());

  // Sync Y.Maps -> React state
  useEffect(() => {
    const syncNodes = () => {
      const arr = yNodesToArray(nodesMap);
      setNodes((prev) => {
        // Preserve local drag position for nodes being dragged
        if (draggingIds.current.size === 0) return arr;
        return arr.map((n) => {
          if (draggingIds.current.has(n.id)) {
            const local = prev.find((p) => p.id === n.id);
            return local ? { ...n, position: local.position } : n;
          }
          return n;
        });
      });
    };
    const syncEdges = () => setEdges(yEdgesToArray(edgesMap));

    syncNodes();
    syncEdges();

    nodesMap.observeDeep(syncNodes);
    edgesMap.observeDeep(syncEdges);
    return () => {
      nodesMap.unobserveDeep(syncNodes);
      edgesMap.unobserveDeep(syncEdges);
    };
  }, [nodesMap, edgesMap]);

  // Expose addNode to parent via ref
  useEffect(() => {
    onAddNodeRef.current = () => {
      const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      nodesMap.set(id, {
        id,
        type: "colorNode",
        position: { x: 100 + Math.random() * 400, y: 100 + Math.random() * 300 },
        data: { label: `Node ${nodesMap.size + 1}`, nodeColor: "#ffffff" },
      });
    };
    return () => {
      onAddNodeRef.current = null;
    };
  }, [nodesMap, onAddNodeRef]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Apply changes to local React state first for responsive UI
      setNodes((nds) => applyNodeChanges(changes, nds));

      for (const change of changes) {
        if (change.type === "position" && change.position) {
          if (change.dragging) {
            draggingIds.current.add(change.id);
          } else {
            draggingIds.current.delete(change.id);
          }
          // Write position to Y.Map
          const existing = nodesMap.get(change.id);
          if (existing) {
            nodesMap.set(change.id, {
              ...existing,
              position: change.position,
            });
          }
        } else if (change.type === "remove") {
          draggingIds.current.delete(change.id);
          nodesMap.delete(change.id);
          // Remove connected edges
          doc.transact(() => {
            edgesMap.forEach((edge, edgeId) => {
              if (edge.source === change.id || edge.target === change.id) {
                edgesMap.delete(edgeId);
              }
            });
          });
          if (selectedNodeId === change.id) {
            setSelectedNodeId(null);
          }
        }
        // 'select' and 'dimensions' changes are local-only (already applied above)
      }
    },
    [nodesMap, edgesMap, doc, selectedNodeId]
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));

      for (const change of changes) {
        if (change.type === "remove") {
          edgesMap.delete(change.id);
        }
      }
    },
    [edgesMap]
  );

  const onConnect: OnConnect = useCallback(
    (params) => {
      const id = `e-${params.source}-${params.target}-${Date.now()}`;
      edgesMap.set(id, {
        id,
        source: params.source!,
        target: params.target!,
      });
    },
    [edgesMap]
  );

  // Mouse cursor tracking via Yjs awareness
  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      const flowPos = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      provider.awareness.setLocalStateField("cursor", flowPos);
    },
    [screenToFlowPosition, provider.awareness]
  );

  const handleMouseLeave = useCallback(() => {
    provider.awareness.setLocalStateField("cursor", null);
  }, [provider.awareness]);

  // Set a display name on awareness for the cursor label
  useEffect(() => {
    const name = `User ${doc.clientID.toString(36).toUpperCase()}`;
    provider.awareness.setLocalStateField("name", name);
  }, [provider.awareness, doc.clientID]);

  return (
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      <div
        style={{ flex: 1, position: "relative" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          nodeTypes={nodeTypes}
          fitView
          deleteKeyCode={["Backspace", "Delete"]}
        >
          <Background />
          <Controls />
        </ReactFlow>
        <Cursors
          awarenessStates={awarenessStates}
          localClientId={doc.clientID}
        />
        <div className="debug-panel">
          awareness: {awarenessStates.size} total,{" "}
          {Array.from(awarenessStates.entries())
            .filter(([id]) => id !== doc.clientID)
            .filter(([, s]) => !!(s as { cursor?: unknown }).cursor)
            .length}{" "}
          remote cursors | clientID: {doc.clientID}
        </div>
      </div>
      {selectedNodeId && (
        <NodeConfigPanel
          nodeId={selectedNodeId}
          nodesMap={nodesMap}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
}
