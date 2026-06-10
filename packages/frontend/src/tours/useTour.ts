import { useState, useCallback, useRef } from 'react';
import type { TourDefinition } from './types';
import { getTourById } from './registry';
import { updateCompletedTour, type CompletedTour } from '../api';

export interface TourState {
  tour: TourDefinition;
  stepIndex: number;
}

export function useTour(
  completedTours: CompletedTour[],
  setCompletedTours: (tours: CompletedTour[]) => void,
) {
  const [activeTour, setActiveTour] = useState<TourState | null>(null);
  const prevStepRef = useRef<number>(-1);

  const startTour = useCallback((tourId: string) => {
    const tour = getTourById(tourId);
    if (!tour) return;

    // If a tour is already running, call onExit for current step
    if (activeTour) {
      activeTour.tour.steps[activeTour.stepIndex]?.onExit?.();
    }

    prevStepRef.current = -1;
    setActiveTour({ tour, stepIndex: 0 });
    tour.steps[0]?.onEnter?.();
  }, [activeTour]);

  const nextStep = useCallback(() => {
    setActiveTour((prev) => {
      if (!prev) return null;
      const current = prev.tour.steps[prev.stepIndex];
      current?.onExit?.();

      const next = prev.stepIndex + 1;
      if (next >= prev.tour.steps.length) return prev; // shouldn't happen, use completeTour instead

      const nextStepDef = prev.tour.steps[next];
      nextStepDef?.onEnter?.();
      prevStepRef.current = prev.stepIndex;
      return { ...prev, stepIndex: next };
    });
  }, []);

  const skipTour = useCallback(() => {
    if (activeTour) {
      activeTour.tour.steps[activeTour.stepIndex]?.onExit?.();
    }
    setActiveTour(null);
  }, [activeTour]);

  const completeTour = useCallback(() => {
    if (!activeTour) return;
    const { tour } = activeTour;
    tour.steps[activeTour.stepIndex]?.onExit?.();
    setActiveTour(null);

    // Persist completion
    const updated = [...completedTours];
    const idx = updated.findIndex((t) => t.tourId === tour.id);
    if (idx >= 0) {
      updated[idx] = { tourId: tour.id, version: tour.version };
    } else {
      updated.push({ tourId: tour.id, version: tour.version });
    }
    setCompletedTours(updated);
    updateCompletedTour(tour.id, tour.version).catch(() => {});
  }, [activeTour, completedTours, setCompletedTours]);

  const notifyAction = useCallback((actionId: string) => {
    setActiveTour((prev) => {
      if (!prev) return null;
      const step = prev.tour.steps[prev.stepIndex];
      if (step.type !== 'active' || step.waitFor !== actionId) return prev;

      step.onExit?.();
      const next = prev.stepIndex + 1;
      if (next >= prev.tour.steps.length) {
        // Auto-complete if it was the last active step
        return prev;
      }
      const nextStepDef = prev.tour.steps[next];
      nextStepDef?.onEnter?.();
      prevStepRef.current = prev.stepIndex;
      return { ...prev, stepIndex: next };
    });
  }, []);

  return {
    activeTour,
    startTour,
    nextStep,
    skipTour,
    completeTour,
    notifyAction,
  };
}
