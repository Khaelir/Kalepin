import type { TourDefinition } from './types';
import { createEssentialsTour } from './essentials';

const registry: TourDefinition[] = [createEssentialsTour()];

export function getAllTours(): TourDefinition[] {
  return registry;
}

export function getTourById(id: string): TourDefinition | undefined {
  return registry.find((t) => t.id === id);
}
