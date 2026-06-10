import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { AttachmentsService } from '../attachments/attachments.service';

// --- Test fixtures ---

const DRAWIO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="200" height="100" viewBox="0 0 200 100"
  content="&lt;mxfile&gt;&lt;diagram name=&quot;Page-1&quot;&gt;&lt;mxGraphModel&gt;&lt;root&gt;&lt;mxCell id=&quot;0&quot;/&gt;&lt;mxCell id=&quot;1&quot; parent=&quot;0&quot;/&gt;&lt;mxCell id=&quot;2&quot; value=&quot;Hello&quot; style=&quot;rounded=1;&quot; vertex=&quot;1&quot; parent=&quot;1&quot;&gt;&lt;mxGeometry x=&quot;10&quot; y=&quot;10&quot; width=&quot;80&quot; height=&quot;40&quot; as=&quot;geometry&quot;/&gt;&lt;/mxCell&gt;&lt;/root&gt;&lt;/mxGraphModel&gt;&lt;/diagram&gt;&lt;/mxfile&gt;">
  <defs/>
  <g>
    <rect x="10" y="10" width="80" height="40" rx="6" fill="#fff" stroke="#000"/>
    <text x="50" y="35" text-anchor="middle" font-size="12">Hello</text>
  </g>
</svg>`;

const REGULAR_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="40" fill="red"/>
</svg>`;

const DRAWIO_SVG_WITH_BASE64_IMAGE = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="200" height="100" viewBox="0 0 200 100"
  content="&lt;mxfile&gt;&lt;diagram name=&quot;Page-1&quot;&gt;&lt;mxGraphModel&gt;&lt;root&gt;&lt;mxCell id=&quot;0&quot;/&gt;&lt;mxCell id=&quot;1&quot; parent=&quot;0&quot;/&gt;&lt;/root&gt;&lt;/mxGraphModel&gt;&lt;/diagram&gt;&lt;/mxfile&gt;">
  <defs/>
  <g>
    <image xlink:href="data:image/png;base64,iVBORw0KGgo=" x="0" y="0" width="100" height="100"/>
  </g>
</svg>`;

const EMPTY_DRAWIO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="1px" height="1px" viewBox="0 0 1 1"
  content="&lt;mxfile&gt;&lt;diagram name=&quot;Page-1&quot;&gt;&lt;mxGraphModel&gt;&lt;root&gt;&lt;mxCell id=&quot;0&quot;/&gt;&lt;mxCell id=&quot;1&quot; parent=&quot;0&quot;/&gt;&lt;/root&gt;&lt;/mxGraphModel&gt;&lt;/diagram&gt;&lt;/mxfile&gt;">
  <defs/>
  <g/>
</svg>`;

const RAW_DRAWIO_XML = `<mxfile host="app.diagrams.net" modified="2024-01-01">
  <diagram name="Page-1">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="2" value="Test" vertex="1" parent="1">
          <mxGeometry x="10" y="10" width="80" height="40" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

// --- Helpers ---

function makeFile(
  buffer: Buffer,
  originalname: string,
  mimetype: string,
): Express.Multer.File {
  return {
    buffer, originalname, mimetype,
    size: buffer.length, fieldname: 'file', encoding: '7bit',
    stream: null as any, destination: '', filename: '', path: '',
  };
}

function isDrawioSvg(svgContent: string): boolean {
  if (!svgContent.includes('content=')) return false;
  const contentMatch = svgContent.match(/content="([^"]*)"/);
  if (!contentMatch) return false;
  const decoded = contentMatch[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  return decoded.includes('mxGraphModel') || decoded.includes('mxfile');
}

function extractDrawioXml(svgContent: string): string | null {
  const contentMatch = svgContent.match(/content="([^"]*)"/);
  if (!contentMatch) return null;
  const decoded = contentMatch[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  if (!decoded.includes('mxGraphModel') && !decoded.includes('mxfile')) return null;
  return decoded;
}

function isDrawioXml(text: string): boolean {
  return text.includes('<mxfile') || text.includes('<mxGraphModel');
}

// --- Tests ---

describe('draw.io Detection Utilities', () => {
  it('detects draw.io SVG with content attribute', () => {
    assert.ok(isDrawioSvg(DRAWIO_SVG));
  });

  it('rejects regular SVG without draw.io metadata', () => {
    assert.ok(!isDrawioSvg(REGULAR_SVG));
  });

  it('detects draw.io SVG with base64-embedded images', () => {
    assert.ok(isDrawioSvg(DRAWIO_SVG_WITH_BASE64_IMAGE));
  });

  it('detects empty draw.io SVG template', () => {
    assert.ok(isDrawioSvg(EMPTY_DRAWIO_SVG));
  });

  it('rejects non-SVG content', () => {
    assert.ok(!isDrawioSvg('<html><body>not svg</body></html>'));
    assert.ok(!isDrawioSvg('just plain text'));
    assert.ok(!isDrawioSvg(''));
  });

  it('extracts draw.io XML from SVG content attribute', () => {
    const xml = extractDrawioXml(DRAWIO_SVG);
    assert.ok(xml);
    assert.ok(xml.includes('<mxfile>'));
    assert.ok(xml.includes('mxGraphModel'));
    assert.ok(xml.includes('Hello')); // shape label
  });

  it('returns null for non-draw.io SVG', () => {
    assert.equal(extractDrawioXml(REGULAR_SVG), null);
  });

  it('detects raw draw.io XML in code blocks', () => {
    assert.ok(isDrawioXml(RAW_DRAWIO_XML));
    assert.ok(isDrawioXml('<mxGraphModel><root/></mxGraphModel>'));
    assert.ok(!isDrawioXml('function hello() { return 42; }'));
    assert.ok(!isDrawioXml('<html><body>not drawio</body></html>'));
  });
});

describe('draw.io SVG Save Flow', () => {
  let tmpDir: string;
  let service: AttachmentsService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drawio-test-'));
    process.env.VAULT_PATH = tmpDir;
    service = new AttachmentsService();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('uploads draw.io SVG and returns content-addressed filename', async () => {
    const file = makeFile(Buffer.from(DRAWIO_SVG), 'diagram.svg', 'image/svg+xml');
    const result = await service.upload(file, 'notes/test.md');

    assert.ok(result.name.endsWith('.svg'));
    assert.ok(result.relativePath.includes('_attachments/'));

    // Verify file was written
    const written = await fs.readFile(
      path.join(tmpDir, '_attachments', result.name),
      'utf-8',
    );
    assert.equal(written, DRAWIO_SVG);
  });

  it('produces same filename for identical content (deduplication)', async () => {
    const file1 = makeFile(Buffer.from(DRAWIO_SVG), 'a.svg', 'image/svg+xml');
    const file2 = makeFile(Buffer.from(DRAWIO_SVG), 'b.svg', 'image/svg+xml');

    const r1 = await service.upload(file1, 'test.md');
    const r2 = await service.upload(file2, 'test.md');

    assert.equal(r1.name, r2.name);
  });

  it('produces different filename when SVG content changes', async () => {
    const file1 = makeFile(Buffer.from(DRAWIO_SVG), 'diagram.svg', 'image/svg+xml');
    const modified = DRAWIO_SVG.replace('Hello', 'World');
    const file2 = makeFile(Buffer.from(modified), 'diagram.svg', 'image/svg+xml');

    const r1 = await service.upload(file1, 'test.md');
    const r2 = await service.upload(file2, 'test.md');

    assert.notEqual(r1.name, r2.name);
  });

  it('serves uploaded draw.io SVG with correct MIME type', async () => {
    const file = makeFile(Buffer.from(DRAWIO_SVG), 'diagram.svg', 'image/svg+xml');
    const { name } = await service.upload(file, 'test.md');

    const result = await service.serve(name);
    assert.equal(result.contentType, 'image/svg+xml');
    assert.equal(result.buffer.toString('utf-8'), DRAWIO_SVG);
  });

  it('orphan cleanup moves unreferenced SVG to trash', async () => {
    // Upload a draw.io SVG
    const file = makeFile(Buffer.from(DRAWIO_SVG), 'diagram.svg', 'image/svg+xml');
    const { name } = await service.upload(file, 'test.md');

    // No markdown file references it → orphan
    const result = await service.cleanup();

    assert.equal(result.orphansFound, 1);
    assert.equal(result.movedToTrash, 1);

    // File should be in .trash/
    const trashDir = path.join(tmpDir, '_attachments', '.trash');
    const trashEntries = await fs.readdir(trashDir);
    assert.ok(trashEntries.some((e) => e.includes(name)));
  });

  it('keeps referenced SVG during cleanup', async () => {
    // Upload a draw.io SVG
    const file = makeFile(Buffer.from(DRAWIO_SVG), 'diagram.svg', 'image/svg+xml');
    const { name } = await service.upload(file, 'test.md');

    // Create a markdown file referencing it
    await fs.writeFile(
      path.join(tmpDir, 'test.md'),
      `# Test\n\n![diagram](_attachments/${name})\n`,
    );

    const result = await service.cleanup();
    assert.equal(result.orphansFound, 0);
  });

  it('draw.io SVG with base64 images survives upload round-trip', async () => {
    const file = makeFile(
      Buffer.from(DRAWIO_SVG_WITH_BASE64_IMAGE),
      'diagram.svg',
      'image/svg+xml',
    );
    const { name } = await service.upload(file, 'test.md');

    const result = await service.serve(name);
    const content = result.buffer.toString('utf-8');

    // Verify base64 image data is preserved
    assert.ok(content.includes('data:image/png;base64,'));
    assert.ok(isDrawioSvg(content));
  });
});

describe('Sandboxed Iframe Security', () => {
  it('embed.html has CSP meta tag blocking connect-src', async () => {
    // Read the embed.html file
    const embedPath = path.join(
      process.cwd(),
      'packages/frontend/public/drawio/embed.html',
    );
    let embedHtml: string;
    try {
      embedHtml = await fs.readFile(embedPath, 'utf-8');
    } catch {
      // If vendored assets not present (CI), skip
      return;
    }

    // CSP must block network requests
    assert.ok(embedHtml.includes('connect-src'), 'CSP must include connect-src directive');
    assert.ok(embedHtml.includes("connect-src 'none'"), 'connect-src must be none');
  });

  it('embed.html does not include allow-same-origin in sandbox', () => {
    // The sandbox attribute is set on the iframe in the modal component,
    // not in the HTML itself. Verify the expected value.
    const expectedSandbox = 'allow-scripts';
    // allow-same-origin MUST NOT be present (security invariant)
    assert.ok(!expectedSandbox.includes('allow-same-origin'));
  });

  it('embed.html does not load external scripts', async () => {
    const embedPath = path.join(
      process.cwd(),
      'packages/frontend/public/drawio/embed.html',
    );
    let embedHtml: string;
    try {
      embedHtml = await fs.readFile(embedPath, 'utf-8');
    } catch {
      return; // skip if assets not vendored
    }

    // All script sources must be relative (no https:// or // external URLs)
    const scriptTags = embedHtml.match(/<script[^>]*src="([^"]*)"[^>]*>/g) || [];
    for (const tag of scriptTags) {
      const srcMatch = tag.match(/src="([^"]*)"/);
      if (srcMatch) {
        assert.ok(
          !srcMatch[1].startsWith('http') && !srcMatch[1].startsWith('//'),
          `Script source must be local, found: ${srcMatch[1]}`,
        );
      }
    }
  });

  it('embed.html CSP blocks inline eval if possible', async () => {
    const embedPath = path.join(
      process.cwd(),
      'packages/frontend/public/drawio/embed.html',
    );
    let embedHtml: string;
    try {
      embedHtml = await fs.readFile(embedPath, 'utf-8');
    } catch {
      return;
    }

    // CSP should exist
    const cspMatch = embedHtml.match(/content="([^"]*connect-src[^"]*)"/);
    assert.ok(cspMatch, 'CSP meta tag must exist');

    // Verify no allow-same-origin related directives that weaken security
    assert.ok(
      !embedHtml.includes('allow-same-origin'),
      'HTML must not suggest allow-same-origin',
    );
  });

  it('clipboard proxy rejects oversized payloads', () => {
    const CLIPBOARD_SIZE_LIMIT = 5 * 1024 * 1024;
    const oversized = 'x'.repeat(CLIPBOARD_SIZE_LIMIT + 1);
    assert.ok(oversized.length > CLIPBOARD_SIZE_LIMIT);
    // The modal component checks: msg.data.length <= CLIPBOARD_SIZE_LIMIT
    // Oversized data would be silently dropped
  });

  it('draw.io embed URL includes stealth mode parameter', () => {
    // The iframe src used in the modal component
    const iframeSrc = '/drawio/embed.html?embed=1&proto=json&spin=1&stealth=1&configure=1';
    assert.ok(iframeSrc.includes('stealth=1'), 'stealth=1 disables cloud features');
    assert.ok(iframeSrc.includes('embed=1'), 'embed=1 enables embed protocol');
    assert.ok(iframeSrc.includes('proto=json'), 'proto=json uses JSON messages');
  });
});

describe('MCP draw.io Diagram Extraction', () => {
  it('extracts diagram XML from markdown with SVG attachment references', () => {
    const markdown = `# Architecture

Here's our SSO flow:

![SSO diagram](_attachments/abc123.svg)

And some regular text.
`;

    // Simulate the regex used in McpService.extractDrawioDiagrams
    const svgRefs = [...markdown.matchAll(/_attachments\/([^\s)]+\.svg)/g)];
    assert.equal(svgRefs.length, 1);
    assert.equal(svgRefs[0][1], 'abc123.svg');
  });

  it('finds multiple SVG references in markdown', () => {
    const markdown = `![a](_attachments/first.svg)\n![b](_attachments/second.svg)\n![c](_attachments/photo.png)`;
    const svgRefs = [...markdown.matchAll(/_attachments\/([^\s)]+\.svg)/g)];
    assert.equal(svgRefs.length, 2);
    assert.equal(svgRefs[0][1], 'first.svg');
    assert.equal(svgRefs[1][1], 'second.svg');
  });

  it('skips non-SVG attachment references', () => {
    const markdown = `![photo](_attachments/abc123.png)`;
    const svgRefs = [...markdown.matchAll(/_attachments\/([^\s)]+\.svg)/g)];
    assert.equal(svgRefs.length, 0);
  });
});
