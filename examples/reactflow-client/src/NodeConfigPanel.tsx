/**
 * Side panel for configuring the selected node's color.
 * Reads from and writes to the Y.Map; observes remote changes.
 */

import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";

interface YNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: { label: string; nodeColor: string };
}

interface NodeConfigPanelProps {
  nodeId: string;
  nodesMap: Y.Map<YNode>;
  onClose: () => void;
}

export default function NodeConfigPanel({
  nodeId,
  nodesMap,
  onClose,
}: NodeConfigPanelProps) {
  const [nodeColor, setNodeColor] = useState("#ffffff");
  const [label, setLabel] = useState("");
  const didRequestCloseRef = useRef(false);

  // Read current values and observe changes
  useEffect(() => {
    const sync = () => {
      const node = nodesMap.get(nodeId);
      if (node) {
        didRequestCloseRef.current = false;
        setNodeColor(node.data.nodeColor);
        setLabel(node.data.label);
        return;
      }

      // Keep parent selection state in sync when node is deleted.
      if (!didRequestCloseRef.current) {
        didRequestCloseRef.current = true;
        onClose();
      }
    };
    sync();
    nodesMap.observeDeep(sync);
    return () => nodesMap.unobserveDeep(sync);
  }, [nodeId, nodesMap, onClose]);

  const updateColor = (color: string) => {
    setNodeColor(color);
    const node = nodesMap.get(nodeId);
    if (node) {
      nodesMap.set(nodeId, {
        ...node,
        data: { ...node.data, nodeColor: color },
      });
    }
  };

  // Close if node was deleted
  if (!nodesMap.has(nodeId)) {
    return null;
  }

  return (
    <div className="config-panel">
      <div className="config-header">
        <h3>Node Config</h3>
        <button className="close-btn" onClick={onClose}>
          &times;
        </button>
      </div>

      <div className="config-field">
        <label>Label</label>
        <div className="config-value">{label}</div>
      </div>

      <div className="config-field">
        <label htmlFor="nodeColor">Node Color</label>
        <div className="color-row">
          <input
            type="color"
            id="nodeColor"
            value={nodeColor}
            onChange={(e) => updateColor(e.target.value)}
          />
          <input
            type="text"
            value={nodeColor}
            onChange={(e) => {
              const val = e.target.value;
              if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                setNodeColor(val);
                if (val.length === 7) {
                  updateColor(val);
                }
              }
            }}
            placeholder="#ffffff"
            maxLength={7}
          />
        </div>
      </div>

      <div className="config-field">
        <label>Node ID</label>
        <code className="config-value">{nodeId}</code>
      </div>
    </div>
  );
}
