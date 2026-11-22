'use client';

import { useSyncExternalStore } from 'react';

import { cleanTaste, isSetlistMode, NO_TASTE, type SetlistMode, type Taste } from '@/lib/game/setlist';

// Host-screen preferences, kept in this browser.

export interface Settings {
  lobbyMusic: boolean;
  /** Experimental: where the songs come from. The host screen copies it into the room. */
  setlistMode: SetlistMode;
  /** What this screen picks in Host picks mode. */
  hostTaste: Taste;
}

const KEY = 'mm:settings';
const DEFAULTS: Settings = { lobbyMusic: true, setlistMode: 'classic', hostTaste: NO_TASTE };

/** Whatever was stored, with anything this version does not understand put back to the default. */
function sanitize(stored: Partial<Settings>): Settings {
  return {
    ...DEFAULTS,
    ...stored,
    setlistMode: isSetlistMode(stored.setlistMode) ? stored.setlistMode : DEFAULTS.setlistMode,
    hostTaste: cleanTaste(stored.hostTaste) ?? DEFAULTS.hostTaste,
  };
}

const listeners = new Set<() => void>();
let cached: Settings | null = null;

function read(): Settings {
  if (cached) return cached;
  try {
    cached = sanitize(JSON.parse(window.localStorage.getItem(KEY) ?? '{}'));
  } catch {
    cached = DEFAULTS;
  }
  return cached!;
}

export function updateSettings(patch: Partial<Settings>): void {
  cached = { ...read(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Private mode: the choice lasts until the tab closes.
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, read, () => DEFAULTS);
}
