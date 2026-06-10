/**
 * Parses decoded draw.io XML into a structured graph representation.
 * Uses regex-based attribute extraction — no XML parser dependency needed
 * since mxCell elements have a flat, well-defined structure.
 */

export interface GraphNode {
  id: string;
  label: string;
  type: 'decision' | 'terminal' | 'process' | 'datastore';
  page?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  label: string;
  page?: number;
}

export interface DrawioGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Classify a node type from a draw.io style string.
 */
function classifyNodeType(style: string): GraphNode['type'] {
  if (style.includes('rhombus')) return 'decision';
  if (style.includes('shape=ellipse')) return 'terminal';
  if (style.includes('shape=cylinder')) return 'datastore';
  if (style.includes('rounded=1')) return 'process';
  return 'process';
}

/**
 * Strip HTML tags from a label, converting <br> variants to spaces.
 * Handles values that may contain HTML entities from XML attributes.
 */
function stripHtmlLabel(value: string): string {
  // First decode HTML entities (XML attribute values use &lt; &gt; etc.)
  let decoded = value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  // Then strip HTML tags, converting <br> to spaces
  return decoded
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract an attribute value from an XML element string.
 */
function getAttr(element: string, name: string): string | undefined {
  const re = new RegExp(`${name}="([^"]*)"`, 'i');
  const m = element.match(re);
  return m ? m[1] : undefined;
}

/**
 * Parse decoded draw.io XML into a structured graph.
 * Accepts XML containing `<mxGraphModel>` or `<mxfile>` with `<diagram>` elements.
 */
export function parseDrawioXml(xml: string): DrawioGraph {
  const rawNodes: GraphNode[] = [];
  const rawEdges: GraphEdge[] = [];

  // Detect pages: each <diagram> element wraps a separate page
  const diagramMatches = [...xml.matchAll(/<diagram\b[^>]*>([\s\S]*?)<\/diagram>/gi)];
  const isMultiPage = diagramMatches.length > 1;

  // If no <diagram> wrappers, treat the whole XML as a single page
  const pages = diagramMatches.length > 0
    ? diagramMatches.map((m) => m[1])
    : [xml];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const pageXml = pages[pageIndex];

    // Match both self-closing <mxCell .../> and <mxCell ...>...</mxCell>
    const cellMatches = [...pageXml.matchAll(/<mxCell\b([^>]*?)\/?>(?:[\s\S]*?<\/mxCell>)?/gi)];

    for (const cellMatch of cellMatches) {
      const el = cellMatch[0];
      const attrs = cellMatch[1] || el;

      const id = getAttr(attrs, 'id');
      if (!id) continue;

      const isVertex = getAttr(attrs, 'vertex') === '1';
      const isEdge = getAttr(attrs, 'edge') === '1';
      const rawValue = getAttr(attrs, 'value') ?? '';
      const style = getAttr(attrs, 'style') ?? '';

      if (isVertex) {
        const label = stripHtmlLabel(rawValue);
        // Skip container/layer cells with no meaningful label
        if (!label && !rawValue) {
          // Still include nodes with empty string label if they have a style (visual element)
          if (!style) continue;
        }
        const node: GraphNode = {
          id,
          label,
          type: classifyNodeType(style),
        };
        if (isMultiPage) node.page = pageIndex;
        rawNodes.push(node);
      } else if (isEdge) {
        const from = getAttr(attrs, 'source') ?? '';
        const to = getAttr(attrs, 'target') ?? '';
        const edge: GraphEdge = {
          from,
          to,
          label: stripHtmlLabel(rawValue),
        };
        if (isMultiPage) edge.page = pageIndex;
        rawEdges.push(edge);
      }
    }
  }

  // Build compact ID mapping: originalId → n{sequential}
  const idMap = new Map<string, string>();
  let seq = 1;
  for (const node of rawNodes) {
    idMap.set(node.id, `n${seq++}`);
  }

  // Apply compact IDs to nodes
  const nodes = rawNodes.map((n) => ({ ...n, id: idMap.get(n.id) || n.id }));

  // Filter empty edges and apply compact IDs
  const edges = rawEdges
    .filter((e) => e.from !== '' && e.to !== '')
    .map((e) => ({
      ...e,
      from: idMap.get(e.from) || e.from,
      to: idMap.get(e.to) || e.to,
    }));

  return { nodes, edges };
}
