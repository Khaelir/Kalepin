/**
 * Utilities for detecting and working with draw.io SVG diagrams.
 *
 * draw.io exports SVGs with the diagram XML stored in the root <svg> element's
 * `content` attribute. This attribute contains URL-encoded mxGraphModel XML.
 */

/**
 * Checks if an SVG string contains draw.io diagram metadata.
 * Looks for a `content` attribute on the root <svg> element containing
 * mxGraphModel or mxfile data.
 */
export function isDrawioSvg(svgContent: string): boolean {
  // Quick early-exit: the SVG must contain 'content=' to be a draw.io SVG
  if (!svgContent.includes('content=')) return false;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg.tagName !== 'svg') return false;

    const content = svg.getAttribute('content');
    if (!content) return false;

    // draw.io stores mxGraphModel or mxfile XML in the content attribute
    return content.includes('mxGraphModel') || content.includes('mxfile');
  } catch {
    return false;
  }
}

/**
 * Extracts the draw.io XML content from an SVG string.
 * Returns the decoded XML string, or null if not a draw.io SVG.
 */
export function extractDrawioXml(svgContent: string): string | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, 'image/svg+xml');
    const svg = doc.documentElement;
    const content = svg.getAttribute('content');
    if (!content) return null;
    if (!content.includes('mxGraphModel') && !content.includes('mxfile')) return null;
    return content;
  } catch {
    return null;
  }
}

/** Empty draw.io SVG template for creating new diagrams via /drawio slash command */
export const EMPTY_DRAWIO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg1.1.dtd">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="1px" height="1px" viewBox="0 0 1 1"
  content="&lt;mxfile&gt;&lt;diagram name=&quot;Page-1&quot;&gt;&lt;mxGraphModel&gt;&lt;root&gt;&lt;mxCell id=&quot;0&quot;/&gt;&lt;mxCell id=&quot;1&quot; parent=&quot;0&quot;/&gt;&lt;/root&gt;&lt;/mxGraphModel&gt;&lt;/diagram&gt;&lt;/mxfile&gt;">
  <defs/>
  <g/>
</svg>`;
