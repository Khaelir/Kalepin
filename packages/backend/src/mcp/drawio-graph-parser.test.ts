import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseDrawioXml } from './drawio-graph-parser';

describe('parseDrawioXml', () => {
  it('parses a simple flowchart with vertices and edges', () => {
    const xml = `
      <mxGraphModel>
        <root>
          <mxCell id="0"/>
          <mxCell id="1" parent="0"/>
          <mxCell id="2" value="Start" style="shape=ellipse;" vertex="1" parent="1"/>
          <mxCell id="3" value="Process A" style="rounded=1;" vertex="1" parent="1"/>
          <mxCell id="4" value="End" style="shape=ellipse;" vertex="1" parent="1"/>
          <mxCell id="5" value="" style="" edge="1" source="2" target="3" parent="1"/>
          <mxCell id="6" value="yes" style="" edge="1" source="3" target="4" parent="1"/>
        </root>
      </mxGraphModel>`;

    const graph = parseDrawioXml(xml);

    assert.equal(graph.nodes.length, 3);
    assert.equal(graph.edges.length, 2);

    // IDs are compact sequential: n1, n2, n3
    const start = graph.nodes.find((n) => n.label === 'Start')!;
    assert.equal(start.id, 'n1');
    assert.equal(start.type, 'terminal');

    const proc = graph.nodes.find((n) => n.label === 'Process A')!;
    assert.equal(proc.id, 'n2');
    assert.equal(proc.type, 'process');

    const edge = graph.edges.find((e) => e.from === 'n2')!;
    assert.equal(edge.to, 'n3');
    assert.equal(edge.label, 'yes');

    // Single page — no page field
    assert.equal(start.page, undefined);
  });

  it('classifies node types from style strings', () => {
    const xml = `
      <mxGraphModel>
        <root>
          <mxCell id="0"/>
          <mxCell id="1" parent="0"/>
          <mxCell id="d" value="Choice?" style="rhombus;" vertex="1" parent="1"/>
          <mxCell id="t" value="End" style="shape=ellipse;" vertex="1" parent="1"/>
          <mxCell id="p" value="Step" style="rounded=1;" vertex="1" parent="1"/>
          <mxCell id="s" value="DB" style="shape=cylinder;" vertex="1" parent="1"/>
          <mxCell id="u" value="Unknown" style="whiteSpace=wrap;" vertex="1" parent="1"/>
        </root>
      </mxGraphModel>`;

    const graph = parseDrawioXml(xml);
    const byLabel = Object.fromEntries(graph.nodes.map((n) => [n.label, n]));

    assert.equal(byLabel['Choice?'].type, 'decision');
    assert.equal(byLabel['End'].type, 'terminal');
    assert.equal(byLabel['Step'].type, 'process');
    assert.equal(byLabel['DB'].type, 'datastore');
    assert.equal(byLabel['Unknown'].type, 'process'); // default
  });

  it('strips HTML tags and converts <br> to spaces', () => {
    const xml = `
      <mxGraphModel>
        <root>
          <mxCell id="0"/>
          <mxCell id="1" parent="0"/>
          <mxCell id="2" value="&lt;b&gt;Login&lt;/b&gt;&lt;br&gt;Service" style="rounded=1;" vertex="1" parent="1"/>
          <mxCell id="3" value="&lt;div&gt;&lt;b&gt;Multi&lt;/b&gt;&lt;br/&gt;Line&lt;/div&gt;" style="" vertex="1" parent="1"/>
        </root>
      </mxGraphModel>`;

    const graph = parseDrawioXml(xml);
    const byLabel = Object.fromEntries(graph.nodes.map((n) => [n.label, n]));

    assert.ok(byLabel['Login Service']);
    assert.ok(byLabel['Multi Line']);
  });

  it('handles plain text labels unchanged', () => {
    const xml = `
      <mxGraphModel>
        <root>
          <mxCell id="0"/>
          <mxCell id="1" parent="0"/>
          <mxCell id="2" value="POST /api/auth" style="" vertex="1" parent="1"/>
        </root>
      </mxGraphModel>`;

    const graph = parseDrawioXml(xml);
    assert.equal(graph.nodes[0].label, 'POST /api/auth');
  });

  it('handles multi-page diagrams with page field', () => {
    const xml = `
      <mxfile>
        <diagram name="Page 1">
          <mxGraphModel>
            <root>
              <mxCell id="0"/>
              <mxCell id="1" parent="0"/>
              <mxCell id="a" value="Node A" style="" vertex="1" parent="1"/>
              <mxCell id="e1" value="" style="" edge="1" source="a" target="a" parent="1"/>
            </root>
          </mxGraphModel>
        </diagram>
        <diagram name="Page 2">
          <mxGraphModel>
            <root>
              <mxCell id="0"/>
              <mxCell id="1" parent="0"/>
              <mxCell id="b" value="Node B" style="" vertex="1" parent="1"/>
            </root>
          </mxGraphModel>
        </diagram>
      </mxfile>`;

    const graph = parseDrawioXml(xml);

    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.edges.length, 1);

    const a = graph.nodes.find((n) => n.label === 'Node A')!;
    assert.equal(a.page, 0);
    assert.match(a.id, /^n\d+$/);

    const b = graph.nodes.find((n) => n.label === 'Node B')!;
    assert.equal(b.page, 1);

    assert.equal(graph.edges[0].page, 0);
  });

  it('returns empty graph for empty or invalid XML', () => {
    assert.deepEqual(parseDrawioXml(''), { nodes: [], edges: [] });
    assert.deepEqual(parseDrawioXml('<root></root>'), { nodes: [], edges: [] });
    assert.deepEqual(parseDrawioXml('not xml at all'), { nodes: [], edges: [] });
  });

  it('returns empty graph for mxGraphModel with no cells', () => {
    const xml = '<mxGraphModel><root></root></mxGraphModel>';
    assert.deepEqual(parseDrawioXml(xml), { nodes: [], edges: [] });
  });

  it('handles self-closing mxCell elements', () => {
    const xml = `
      <mxGraphModel>
        <root>
          <mxCell id="0"/>
          <mxCell id="1" parent="0"/>
          <mxCell id="2" value="Self-closing" style="rounded=1;" vertex="1" parent="1"/>
        </root>
      </mxGraphModel>`;

    const graph = parseDrawioXml(xml);
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.nodes[0].label, 'Self-closing');
  });

  it('filters out edges with missing source or target', () => {
    const xml = `
      <mxGraphModel>
        <root>
          <mxCell id="0"/>
          <mxCell id="1" parent="0"/>
          <mxCell id="2" value="" style="" edge="1" target="3" parent="1"/>
        </root>
      </mxGraphModel>`;

    const graph = parseDrawioXml(xml);
    // Edge with empty from is now filtered out
    assert.equal(graph.edges.length, 0);
  });

  it('produces compact sequential node IDs', () => {
    const xml = `
      <mxGraphModel>
        <root>
          <mxCell id="0"/>
          <mxCell id="1" parent="0"/>
          <mxCell id="8pqnUvXt2sdNWuhrvl4b-41" value="Start" style="shape=ellipse;" vertex="1" parent="1"/>
          <mxCell id="8pqnUvXt2sdNWuhrvl4b-42" value="Middle" style="rounded=1;" vertex="1" parent="1"/>
          <mxCell id="8pqnUvXt2sdNWuhrvl4b-43" value="End" style="shape=ellipse;" vertex="1" parent="1"/>
          <mxCell id="e1" value="" style="" edge="1" source="8pqnUvXt2sdNWuhrvl4b-41" target="8pqnUvXt2sdNWuhrvl4b-42" parent="1"/>
          <mxCell id="e2" value="" style="" edge="1" source="8pqnUvXt2sdNWuhrvl4b-42" target="8pqnUvXt2sdNWuhrvl4b-43" parent="1"/>
        </root>
      </mxGraphModel>`;

    const graph = parseDrawioXml(xml);

    // Nodes get compact IDs
    assert.equal(graph.nodes[0].id, 'n1');
    assert.equal(graph.nodes[1].id, 'n2');
    assert.equal(graph.nodes[2].id, 'n3');

    // Edges reference compact IDs
    assert.equal(graph.edges[0].from, 'n1');
    assert.equal(graph.edges[0].to, 'n2');
    assert.equal(graph.edges[1].from, 'n2');
    assert.equal(graph.edges[1].to, 'n3');
  });

  it('decodes &#39; and &nbsp; in labels', () => {
    const xml = `
      <mxGraphModel>
        <root>
          <mxCell id="0"/>
          <mxCell id="1" parent="0"/>
          <mxCell id="2" value="it&#39;s&amp;nbsp;a&amp;nbsp;test" style="" vertex="1" parent="1"/>
        </root>
      </mxGraphModel>`;

    const graph = parseDrawioXml(xml);
    // &#39; → ' and &nbsp; → space (after XML entity decode)
    assert.equal(graph.nodes[0].label, "it's a test");
  });

  it('filters edges with empty from or to', () => {
    const xml = `
      <mxGraphModel>
        <root>
          <mxCell id="0"/>
          <mxCell id="1" parent="0"/>
          <mxCell id="a" value="A" style="" vertex="1" parent="1"/>
          <mxCell id="b" value="B" style="" vertex="1" parent="1"/>
          <mxCell id="e1" value="" style="" edge="1" source="" target="a" parent="1"/>
          <mxCell id="e2" value="" style="" edge="1" source="a" target="" parent="1"/>
          <mxCell id="e3" value="" style="" edge="1" source="a" target="b" parent="1"/>
        </root>
      </mxGraphModel>`;

    const graph = parseDrawioXml(xml);
    // Only the edge with both from and to should survive
    assert.equal(graph.edges.length, 1);
    assert.equal(graph.edges[0].from, 'n1');
    assert.equal(graph.edges[0].to, 'n2');
  });

  it('single-page diagram in mxfile has no page field', () => {
    const xml = `
      <mxfile>
        <diagram name="Only Page">
          <mxGraphModel>
            <root>
              <mxCell id="0"/>
              <mxCell id="1" parent="0"/>
              <mxCell id="2" value="Solo" style="" vertex="1" parent="1"/>
            </root>
          </mxGraphModel>
        </diagram>
      </mxfile>`;

    const graph = parseDrawioXml(xml);
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.nodes[0].page, undefined);
  });
});
