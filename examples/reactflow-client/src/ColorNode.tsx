/**
 * Custom ReactFlow node that renders with a configurable background color.
 */

import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

export type ColorNodeData = {
  label: string;
  nodeColor: string;
};

type ColorNodeType = Node<ColorNodeData, "colorNode">;

export default function ColorNode({ data, selected }: NodeProps<ColorNodeType>) {
  return (
    <div
      className="color-node"
      style={{
        background: data.nodeColor || "#ffffff",
        borderColor: selected ? "#0d6efd" : "#333",
        borderWidth: selected ? 2 : 1,
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="color-node-label">{data.label}</div>
      <div className="color-node-hex">{data.nodeColor}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
