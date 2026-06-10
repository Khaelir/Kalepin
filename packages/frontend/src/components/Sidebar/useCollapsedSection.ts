import { useEffect, useState } from 'react';

const STORAGE_KEY = 'kalepin-sidebar-collapsed';

type Map = Record<string, boolean>;

function readMap(): Map {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Map) : {};
  } catch {
    return {};
  }
}

function writeMap(map: Map): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode — silently drop */
  }
}

export function useCollapsedSection(key: string, defaultCollapsed = true): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    const map = readMap();
    return key in map ? !!map[key] : defaultCollapsed;
  });

  useEffect(() => {
    const map = readMap();
    if (map[key] === collapsed) return;
    map[key] = collapsed;
    writeMap(map);
  }, [key, collapsed]);

  return [collapsed, () => setCollapsed((v) => !v)];
}
