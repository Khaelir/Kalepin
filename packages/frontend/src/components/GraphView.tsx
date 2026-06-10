import React, { useState, useEffect } from 'react';
import { GraphPanel } from './GraphPanel';

interface GraphViewProps {
  onBack: () => void;
  onNavigate: (path: string) => void;
  initialCenter?: string;
}

export function GraphView({ onBack, onNavigate, initialCenter }: GraphViewProps) {
  const [dims, setDims] = useState({ w: window.innerWidth - 60, h: window.innerHeight - 60 });

  useEffect(() => {
    const handleResize = () => {
      setDims({ w: window.innerWidth - 60, h: window.innerHeight - 60 });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <main className="graph-view-fullscreen" data-testid="graph-view-fullscreen">
      <div className="graph-view-header">
        <button className="graph-view-back" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3L5 8l5 5" />
          </svg>
          Back
        </button>
        <h2>Graph View</h2>
        <span />
      </div>
      <div className="graph-view-canvas">
        <GraphPanel
          activeFile={initialCenter || ''}
          onNavigate={onNavigate}
          width={dims.w}
          height={dims.h}
          fullScreen
        />
      </div>
    </main>
  );
}
