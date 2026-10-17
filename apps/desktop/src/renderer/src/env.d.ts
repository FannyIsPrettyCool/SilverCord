/// <reference types="vite/client" />
import type { DesktopBridge } from '../../preload/index.ts';

declare global {
  interface Window {
    readonly desktop: DesktopBridge;
  }
}
