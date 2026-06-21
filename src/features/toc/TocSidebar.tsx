import { useMemo } from "react";

export interface TocNode {
  id: string;
  document_id: string;
  parent_id: string | null;
  title: string;
  level: number;
  order_index: number;
  start_page: number;
  end_page: number | null;
  source: string;
  confidence: number;
}

interface TocSidebarProps {
  nodes: TocNode[];
  activeNodeId: string | null;
  onNavigate: (page: number) => void;
}

function buildTree(nodes: TocNode[]): TocNode[] {
  const map = new Map<string, TocNode>();
  const roots: TocNode[] = [];
  for (const node of nodes) map.set(node.id, node);
  for (const node of nodes) {
    if (node.parent_id && map.has(node.parent_id)) continue;
    roots.push(node);
  }
  return roots;
}

function TocItem({
  node,
  allNodes,
  activeNodeId,
  onNavigate,
  depth = 0,
}: {
  node: TocNode;
  allNodes: TocNode[];
  activeNodeId: string | null;
  onNavigate: (page: number) => void;
  depth?: number;
}) {
  const children = allNodes.filter((n) => n.parent_id === node.id);
  const isActive = activeNodeId === node.id;

  return (
    <div role="treeitem" aria-expanded={children.length > 0} aria-current={isActive ? "page" : undefined}>
      <button
        onClick={() => onNavigate(node.start_page)}
        aria-current={isActive ? "page" : undefined}
        style={{
          display: "block",
          width: "100%",
          padding: "4px 8px 4px 0",
          paddingLeft: 12 + depth * 16,
          textAlign: "left",
          background: isActive ? "var(--accent-color)" : "transparent",
          color: isActive ? "#fff" : "var(--text-primary)",
          border: "none",
          borderRadius: 3,
          fontSize: 13,
          cursor: "pointer",
          lineHeight: 1.4,
        }}
        title={`Page ${node.start_page}${node.end_page ? `–${node.end_page}` : ""}`}
      >
        {node.title}
        <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 6 }}>
          {node.start_page}
        </span>
      </button>
      {children.map((child) => (
        <TocItem
          key={child.id}
          node={child}
          allNodes={allNodes}
          activeNodeId={activeNodeId}
          onNavigate={onNavigate}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

export default function TocSidebar({
  nodes,
  activeNodeId,
  onNavigate,
}: TocSidebarProps) {
  const roots = useMemo(() => buildTree(nodes), [nodes]);

  if (nodes.length === 0) {
    return (
      <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
        No native table of contents was found. You can still use page-based AI
        actions.
      </p>
    );
  }

  return (
    <div role="tree" aria-label="Table of contents">
      {roots.map((root) => (
        <TocItem
          key={root.id}
          node={root}
          allNodes={nodes}
          activeNodeId={activeNodeId}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}
