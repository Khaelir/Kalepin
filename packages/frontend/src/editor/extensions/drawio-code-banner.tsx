import React from 'react';
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';

/**
 * Renders a code block that contains raw draw.io XML (<mxfile> / <mxGraphModel>)
 * with an informational banner guiding the user to export as SVG.
 */
export function DrawioCodeBanner({ node, editor }: NodeViewProps) {
  return (
    <NodeViewWrapper className="drawio-codeblock-wrapper" data-type="drawio-xml">
      <div className="drawio-codeblock-banner" contentEditable={false}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="7" />
          <path d="M8 5v1M8 8v3" />
        </svg>
        <span>
          This looks like a draw.io diagram. Export as SVG from draw.io to see it rendered.
        </span>
      </div>
      <pre className="drawio-codeblock-source">
        <NodeViewContent />
      </pre>
    </NodeViewWrapper>
  );
}

/** Returns true if the text content looks like raw draw.io XML */
export function isDrawioXml(text: string): boolean {
  return text.includes('<mxfile') || text.includes('<mxGraphModel');
}
