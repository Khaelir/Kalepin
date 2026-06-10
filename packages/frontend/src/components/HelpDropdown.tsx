import React, { useState, useRef, useEffect } from 'react';
import { getAllTours } from '../tours/registry';
import type { CompletedTour } from '../api';

interface HelpDropdownProps {
  completedTours: CompletedTour[];
  onStartTour: (tourId: string) => void;
}

export function HelpDropdown({ completedTours, onStartTour }: HelpDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const tours = getAllTours();

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className={`header-help-btn${open ? ' active' : ''}`} onClick={() => setOpen(!open)} aria-label="Tutorials & help">
        ?
        {!open && <span className="header-btn-tooltip">Tutorials & help</span>}
      </button>
      {open && (
        <div className="help-dropdown">
          {tours.map((tour) => {
            const completed = completedTours.find((c) => c.tourId === tour.id);
            const isComplete = completed && completed.version >= tour.version;
            return (
              <button
                key={tour.id}
                className="help-dropdown-item"
                onClick={() => {
                  setOpen(false);
                  onStartTour(tour.id);
                }}
              >
                <span className="help-dropdown-check">{isComplete ? '\u2713' : ''}</span>
                <span>{tour.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
