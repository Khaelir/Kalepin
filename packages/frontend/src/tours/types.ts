import { ReactNode } from 'react';

export interface TourStep {
  id: string;
  type: 'passive' | 'active';
  target: string | null; // CSS selector or null for centered card
  title: string;
  body: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  waitFor?: string; // action ID for active steps
  illustration?: ReactNode;
  noDim?: boolean; // Show spotlight ring without dimming the rest of the screen
  onEnter?: () => void;
  onExit?: () => void;
}

export interface TourDefinition {
  id: string;
  version: number;
  name: string;
  description: string;
  coveredBy?: string; // tour ID that covers this feature (e.g., 'essentials')
  steps: TourStep[];
}
