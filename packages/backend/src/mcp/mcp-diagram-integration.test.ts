import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseDrawioXml } from './drawio-graph-parser';

/**
 * Integration tests for the MCP diagram attachments feature.
 * Tests the complete pipeline: detect diagrams in markdown → parse graph → verify topology.
 *
 * These tests exercise the core logic without needing a full McpService instance.
 * The private detectDrawioDiagrams method is simple enough (regex + attachments lookup)
 * that we replicate its logic here for testability.
 */

// --- Fixtures ---

const DRAWIO_XML = `<mxGraphModel>
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="start" value="Start" style="shape=ellipse;" vertex="1" parent="1"/>
    <mxCell id="auth" value="Authenticate" style="rounded=1;" vertex="1" parent="1"/>
    <mxCell id="check" value="Valid?" style="rhombus;" vertex="1" parent="1"/>
    <mxCell id="end" value="Done" style="shape=ellipse;" vertex="1" parent="1"/>
    <mxCell id="e1" value="" edge="1" source="start" target="auth" parent="1"/>
    <mxCell id="e2" value="" edge="1" source="auth" target="check" parent="1"/>
    <mxCell id="e3" value="yes" edge="1" source="check" target="end" parent="1"/>
  </root>
</mxGraphModel>`;

function encodedXml(xml: string): string {
  return xml.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function makeSvg(drawioXml: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" content="${encodedXml(drawioXml)}"><rect/></svg>`;
}

const FLOW_SVG = makeSvg(DRAWIO_XML);

// Replicate detectDrawioDiagrams logic for testing without full McpService
async function detectDrawioDiagrams(
  markdownContent: string,
  serveFn: (name: string) => Promise<{ buffer: Buffer }>,
): Promise<{ attachments: { id: string; type: string; label: string }[]; content: string }> {
  const svgRefs = [...markdownContent.matchAll(/!\[[^\]]*\]\(\/?_attachments\/([^\s)]+\.svg)\)/g)];
  if (svgRefs.length === 0) return { attachments: [], content: markdownContent };

  const attachments: { id: string; type: string; label: string }[] = [];
  let content = markdownContent;

  for (const match of svgRefs) {
    const name = match[1];
    const fullRef = match[0];
    try {
      const { buffer } = await serveFn(name);
      const svgText = buffer.toString('utf-8');
      const contentMatch = svgText.match(/content="([^"]*)"/);
      if (contentMatch) {
        const decoded = contentMatch[1]
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
        if (decoded.includes('mxGraphModel') || decoded.includes('mxfile')) {
          attachments.push({ id: name, type: 'diagram/drawio', label: name });
          content = content.replace(fullRef, `[diagram: ${name} (draw.io)]`);
        }
      }
    } catch {
      // skip
    }
  }

  return { attachments, content };
}

// --- Tests ---

describe('read_note with draw.io diagrams', () => {
  it('replaces SVG ref with placeholder and returns attachments metadata', async () => {
    const markdown = `# My Note\n\nSome text\n\n![](/_attachments/flow.svg)\n\nMore text`;

    const serve = async (name: string) => {
      if (name === 'flow.svg') return { buffer: Buffer.from(FLOW_SVG) };
      throw new Error('Not found');
    };

    const { attachments, content } = await detectDrawioDiagrams(markdown, serve);

    assert.equal(attachments.length, 1);
    assert.equal(attachments[0].id, 'flow.svg');
    assert.equal(attachments[0].type, 'diagram/drawio');

    assert.ok(content.includes('[diagram: flow.svg (draw.io)]'));
    assert.ok(!content.includes('![](/_attachments/flow.svg)'));
    assert.ok(content.includes('Some text'));
    assert.ok(content.includes('More text'));
  });

  it('handles multiple draw.io diagrams', async () => {
    const markdown = `# Doc\n![](/_attachments/flow.svg)\n![](/_attachments/arch.svg)`;

    const serve = async () => ({ buffer: Buffer.from(FLOW_SVG) });

    const { attachments, content } = await detectDrawioDiagrams(markdown, serve);

    assert.equal(attachments.length, 2);
    assert.equal(attachments[0].id, 'flow.svg');
    assert.equal(attachments[1].id, 'arch.svg');
    assert.ok(content.includes('[diagram: flow.svg (draw.io)]'));
    assert.ok(content.includes('[diagram: arch.svg (draw.io)]'));
  });

  it('does not affect notes without diagrams', async () => {
    const markdown = `# Plain Note\n\nJust text, no SVGs.`;

    const serve = async () => { throw new Error('unreachable'); };

    const { attachments, content } = await detectDrawioDiagrams(markdown, serve);

    assert.equal(attachments.length, 0);
    assert.equal(content, markdown);
  });

  it('does not affect non-draw.io SVGs', async () => {
    const markdown = `![](/_attachments/icon.svg)`;
    const plainSvg = `<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>`;

    const serve = async () => ({ buffer: Buffer.from(plainSvg) });

    const { attachments, content } = await detectDrawioDiagrams(markdown, serve);

    assert.equal(attachments.length, 0);
    assert.equal(content, markdown);
  });
});

describe('read_attachment — structured graph output', () => {
  it('parses draw.io SVG into structured graph', () => {
    // Extract draw.io XML from SVG (same as handler does)
    const contentMatch = FLOW_SVG.match(/content="([^"]*)"/);
    assert.ok(contentMatch);
    const decoded = contentMatch![1]
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');

    const graph = parseDrawioXml(decoded);

    assert.equal(graph.nodes.length, 4);
    assert.equal(graph.edges.length, 3);

    const start = graph.nodes.find((n) => n.label === 'Start')!;
    assert.ok(start, 'Start node should exist');
    assert.equal(start.type, 'terminal');

    const check = graph.nodes.find((n) => n.label === 'Valid?')!;
    assert.ok(check, 'Valid? node should exist');
    assert.equal(check.type, 'decision');

    const yesEdge = graph.edges.find((e) => e.label === 'yes')!;
    assert.equal(yesEdge.from, check.id);
    const endNode = graph.nodes.find((n) => n.label === 'Done')!;
    assert.equal(yesEdge.to, endNode.id);
  });
});

describe('round-trip: read_note → discover attachment → read_attachment → verify topology', () => {
  it('discovers diagram in read_note, then parses it via read_attachment flow', async () => {
    const markdown = `# Auth Flow\n\n![](/_attachments/auth-flow.svg)\n\nSee diagram above.`;

    const serve = async (name: string) => {
      if (name === 'auth-flow.svg') return { buffer: Buffer.from(FLOW_SVG) };
      throw new Error('Not found');
    };

    // Step 1: read_note → get placeholders and attachments metadata
    const { attachments, content } = await detectDrawioDiagrams(markdown, serve);

    assert.equal(attachments.length, 1);
    assert.equal(attachments[0].id, 'auth-flow.svg');
    assert.ok(content.includes('[diagram: auth-flow.svg (draw.io)]'));

    // Step 2: read_attachment → get structured graph
    const attachmentId = attachments[0].id;
    const { buffer } = await serve(attachmentId);
    const svgText = buffer.toString('utf-8');
    const contentMatch = svgText.match(/content="([^"]*)"/);
    assert.ok(contentMatch);
    const decoded = contentMatch![1]
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    const graph = parseDrawioXml(decoded);

    // Step 3: Verify topology
    assert.equal(graph.nodes.length, 4);
    assert.equal(graph.edges.length, 3);

    // Verify the flow: Start → Authenticate → Valid? → Done
    const startNode = graph.nodes.find((n) => n.label === 'Start')!;
    const authNode = graph.nodes.find((n) => n.label === 'Authenticate')!;
    const checkNode = graph.nodes.find((n) => n.label === 'Valid?')!;
    const endNode = graph.nodes.find((n) => n.label === 'Done')!;

    const startEdge = graph.edges.find((e) => e.from === startNode.id)!;
    assert.equal(startEdge.to, authNode.id);

    const authEdge = graph.edges.find((e) => e.from === authNode.id)!;
    assert.equal(authEdge.to, checkNode.id);

    const checkEdge = graph.edges.find((e) => e.from === checkNode.id)!;
    assert.equal(checkEdge.to, endNode.id);
    assert.equal(checkEdge.label, 'yes');
  });
});
