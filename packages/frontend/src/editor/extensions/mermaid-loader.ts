import type mermaidAPI from 'mermaid';

let mermaidInstance: typeof mermaidAPI | null = null;
let loadingPromise: Promise<typeof mermaidAPI> | null = null;

/**
 * Lazily load and initialize mermaid. Returns the cached instance on subsequent calls.
 */
export async function getMermaid(): Promise<typeof mermaidAPI> {
  if (mermaidInstance) return mermaidInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = import('mermaid').then((mod) => {
    const mermaid = mod.default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
    });
    mermaidInstance = mermaid;
    return mermaid;
  });

  return loadingPromise;
}

let renderCounter = 0;

/**
 * Render mermaid source to SVG. Returns the SVG string or throws on parse error.
 */
export async function renderMermaid(source: string): Promise<string> {
  const mermaid = await getMermaid();
  const id = `mermaid-${renderCounter++}`;
  const { svg } = await mermaid.render(id, source);
  return svg;
}
