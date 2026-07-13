// Реєстр джерел.
import * as domria from './domria.js';
import * as prozorro from './prozorro.js';
import * as olx from './olx.js';
import * as lun from './lun.js';

export const SOURCES = [domria, prozorro, olx, lun];

export function enabledSources(cfg) {
  return SOURCES.filter((s) => {
    try { return s.enabled(cfg); } catch { return false; }
  });
}

export { prozorro };
