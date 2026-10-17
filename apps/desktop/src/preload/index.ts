import { contextBridge } from 'electron';

/** Minimal typed bridge; every capability added here must be validated in main (BRIEF §8.2). */
const bridge = {
  platform: process.platform,
} as const;

export type DesktopBridge = typeof bridge;

contextBridge.exposeInMainWorld('desktop', bridge);
