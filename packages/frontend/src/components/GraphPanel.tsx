import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { ForceGraphMethods } from 'react-force-graph-2d';
import * as api from '../api';
import type { GraphNode, GraphEdge } from '../api';

interface GraphPanelProps {
  activeFile: string;
  onNavigate: (path: string) => void;
  onPopOut?: () => void;
  width?: number;
  height?: number;
  /** Full-screen mode: show all vault nodes, larger rendering */
  fullScreen?: boolean;
}

interface FGNode extends GraphNode {
  id: string;
  val: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface FGLink {
  source: string;
  target: string;
}

const MAX_HUB_NODES = 25;
const HUB_THRESHOLD = 30;

function ageLabel(dateStr: string | null): string {
  if (!dateStr) return 'unknown';
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function stalenessAlpha(dateStr: string | null): number {
  if (!dateStr) return 0.3;
  const ms = Date.now() - new Date(dateStr).getTime();
  const days = ms / (1000 * 60 * 60 * 24);
  // Fresh (<1 day) = 1.0, old (>90 days) = 0.3
  return Math.max(0.3, 1.0 - (days / 90) * 0.7);
}

export function GraphPanel({ activeFile, onNavigate, onPopOut, width, height, fullScreen }: GraphPanelProps) {
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: FGNode } | null>(null);
  const fgRef = useRef<ForceGraphMethods<FGNode, FGLink>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: width || 268, h: height || 400 });
  const [hubOverflow, setHubOverflow] = useState(0);

  // Measure container dimensions
  useEffect(() => {
    if (width && height) {
      setDims({ w: width, h: height });
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setDims({ w: rect.width || 268, h: rect.height || 400 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  const loadGraph = useCallback(async () => {
    try {
      const data = fullScreen
        ? await api.fetchGraph()
        : await api.fetchGraph(activeFile, 2);
      setGraphData((prev) => {
        if (!prev) return data;
        // Only update if the graph structure actually changed
        const prevKey = prev.nodes.map((n) => n.path).sort().join('\0')
          + '|' + prev.edges.map((e) => `${e.source}->${e.target}`).sort().join('\0');
        const newKey = data.nodes.map((n) => n.path).sort().join('\0')
          + '|' + data.edges.map((e) => `${e.source}->${e.target}`).sort().join('\0');
        if (prevKey === newKey) return prev;
        return data;
      });
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [activeFile, fullScreen]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // Auto-refresh graph data every 5 seconds (debounced live updates)
  useEffect(() => {
    const interval = setInterval(() => {
      loadGraph();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadGraph]);

  // Center on active node after data loads
  useEffect(() => {
    if (!graphData || !fgRef.current) return;
    const timer = setTimeout(() => {
      if (fullScreen) {
        fgRef.current?.zoomToFit(400, 40);
      } else {
        const node = fgData?.nodes.find((n) => n.id === activeFile);
        if (node && node.x !== undefined && node.y !== undefined) {
          fgRef.current?.centerAt(node.x, node.y, 400);
          fgRef.current?.zoom(2, 400);
        }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [graphData, activeFile, fullScreen]);

  // Process graph data for force-graph
  const fgData = useMemo(() => {
    if (!graphData) return null;

    let nodes = graphData.nodes;
    let edges = graphData.edges;
    let overflow = 0;

    // Hub protection for local graph
    if (!fullScreen && nodes.length > HUB_THRESHOLD) {
      // Keep the center node, sort the rest by recency + degree
      const center = nodes.find((n) => n.path === activeFile);
      const others = nodes
        .filter((n) => n.path !== activeFile)
        .sort((a, b) => {
          const scoreA = (a.inCount + a.outCount) + (a.lastModified ? (1 / (1 + (Date.now() - new Date(a.lastModified).getTime()) / 86400000)) * 10 : 0);
          const scoreB = (b.inCount + b.outCount) + (b.lastModified ? (1 / (1 + (Date.now() - new Date(b.lastModified).getTime()) / 86400000)) * 10 : 0);
          return scoreB - scoreA;
        });

      const kept = others.slice(0, MAX_HUB_NODES);
      overflow = others.length - MAX_HUB_NODES;
      nodes = center ? [center, ...kept] : kept;

      // Filter edges to only include kept nodes
      const keptSet = new Set(nodes.map((n) => n.path));
      edges = edges.filter((e) => keptSet.has(e.source) && keptSet.has(e.target));
    }

    setHubOverflow(Math.max(0, overflow));

    const fgNodes: FGNode[] = nodes.map((n) => ({
      ...n,
      id: n.path,
      val: fullScreen ? Math.max(1, (n.inCount + n.outCount) * 0.5) : 1,
    }));

    const fgLinks: FGLink[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
    }));

    return { nodes: fgNodes, links: fgLinks };
  }, [graphData, activeFile, fullScreen]);

  const getNodeColor = useCallback((node: FGNode) => {
    if (node.isBroken) return 'rgba(107, 114, 128, 0.4)';
    if (node.id === activeFile) {
      // Use accent color
      return getComputedStyle(document.documentElement).getPropertyValue('--kalepin-primary').trim() || '#f77500';
    }
    // Orphan highlighting (full-screen only)
    if (fullScreen && node.inCount === 0 && !node.isBroken) {
      return 'rgba(233, 69, 96, 0.5)';
    }
    const alpha = stalenessAlpha(node.lastModified);
    // Get text-secondary color and apply staleness alpha
    const base = getComputedStyle(document.documentElement).getPropertyValue('--kalepin-text-secondary').trim() || '#4a4a52';
    // Parse hex to rgb and apply alpha
    const r = parseInt(base.slice(1, 3), 16);
    const g = parseInt(base.slice(3, 5), 16);
    const b = parseInt(base.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }, [activeFile, fullScreen]);

  const handleNodeClick = useCallback((node: FGNode) => {
    if (node.isBroken) return;
    onNavigate(node.path);
  }, [onNavigate]);

  const handleNodeHover = useCallback((node: FGNode | null) => {
    setHoveredNode(node?.id || null);
    if (node && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const coords = fgRef.current?.graph2ScreenCoords(node.x || 0, node.y || 0);
      if (coords) {
        setTooltip({
          x: coords.x,
          y: coords.y - 10,
          node,
        });
      }
    } else {
      setTooltip(null);
    }
  }, []);

  const nodeCanvasObject = useCallback((node: FGNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const size = fullScreen ? Math.sqrt(node.val || 1) * 3 : 4;
    const isActive = node.id === activeFile;
    const isHovered = node.id === hoveredNode;

    // Draw node circle
    ctx.beginPath();
    ctx.arc(node.x || 0, node.y || 0, size, 0, 2 * Math.PI);

    if (node.isBroken) {
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = 'rgba(107, 114, 128, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(107, 114, 128, 0.15)';
    } else if (fullScreen && node.inCount === 0) {
      // Orphan: hollow outline
      ctx.strokeStyle = getNodeColor(node);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = 'transparent';
    } else {
      ctx.fillStyle = getNodeColor(node);
    }
    ctx.fill();

    // Always draw label for non-broken nodes
    if (!node.isBroken) {
      const label = node.title;
      const fontSize = Math.max((isActive || isHovered ? 11 : 9) / globalScale, 2.5);
      ctx.font = `${isActive ? 'bold ' : ''}${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      // Background for readability
      const textWidth = ctx.measureText(label).width;
      const padding = 2 / globalScale;
      const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--kalepin-bg').trim() || '#ffffff';
      ctx.fillStyle = bgColor;
      ctx.globalAlpha = isActive || isHovered ? 0.9 : 0.7;
      ctx.fillRect(
        (node.x || 0) - textWidth / 2 - padding,
        (node.y || 0) + size + 1 / globalScale,
        textWidth + padding * 2,
        fontSize + padding * 2,
      );

      const textColor = isActive || isHovered
        ? (getComputedStyle(document.documentElement).getPropertyValue('--kalepin-text-default').trim() || '#1d1d22')
        : (getComputedStyle(document.documentElement).getPropertyValue('--kalepin-text-secondary').trim() || '#4a4a52');
      ctx.fillStyle = textColor;
      ctx.globalAlpha = isActive || isHovered ? 1.0 : 0.75;
      ctx.fillText(label, node.x || 0, (node.y || 0) + size + 1 / globalScale + padding);
      ctx.globalAlpha = 1.0;
    }
  }, [activeFile, hoveredNode, fullScreen, getNodeColor]);

  const nodePointerAreaPaint = useCallback((node: FGNode, color: string, ctx: CanvasRenderingContext2D) => {
    const size = fullScreen ? Math.sqrt(node.val || 1) * 3 + 2 : 6;
    ctx.beginPath();
    ctx.arc(node.x || 0, node.y || 0, size, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  }, [fullScreen]);

  if (loading) {
    return (
      <div className="graph-panel" ref={containerRef} data-testid="graph-panel">
        <p className="graph-loading">Loading graph...</p>
      </div>
    );
  }

  if (!fgData || fgData.nodes.length === 0) {
    return (
      <div className="graph-panel" ref={containerRef} data-testid="graph-panel">
        <p className="graph-empty">No connections found</p>
      </div>
    );
  }

  const linkColor = getComputedStyle(document.documentElement).getPropertyValue('--kalepin-border-color').trim() || '#e6e6e8';

  return (
    <div className="graph-panel" ref={containerRef} data-testid="graph-panel">
      <ForceGraph2D
        ref={fgRef}
        graphData={fgData}
        width={dims.w}
        height={dims.h}
        nodeId="id"
        nodeCanvasObject={nodeCanvasObject}
        nodeCanvasObjectMode={() => 'replace'}
        nodePointerAreaPaint={nodePointerAreaPaint}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        linkColor={() => linkColor}
        linkWidth={0.5}
        linkDirectionalArrowLength={3}
        linkDirectionalArrowRelPos={0.9}
        linkDirectionalArrowColor={() => linkColor}
        backgroundColor="rgba(0,0,0,0)"
        cooldownTicks={100}
        enableNodeDrag={!fullScreen ? false : true}
        showPointerCursor={(obj: any) => obj && !obj.isBroken}
      />
      {tooltip && (
        <div
          className="graph-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="graph-tooltip-title">{tooltip.node.title}</div>
          <div className="graph-tooltip-meta">
            {tooltip.node.isBroken ? (
              <span>Broken link</span>
            ) : (
              <>
                <span>{tooltip.node.inCount} in / {tooltip.node.outCount} out</span>
                <span>{ageLabel(tooltip.node.lastModified)}</span>
              </>
            )}
          </div>
        </div>
      )}
      {hubOverflow > 0 && (
        <div className="graph-hub-overflow">+{hubOverflow} more</div>
      )}
      {!fullScreen && onPopOut && (
        <button className="graph-popout-btn" onClick={onPopOut} title="Open full graph">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 2h5v5" />
            <path d="M14 2L8 8" />
            <path d="M12 9v5H2V4h5" />
          </svg>
        </button>
      )}
    </div>
  );
}
