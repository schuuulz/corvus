// The webview behaves like a browser by default: a right-click menu with
// Back, Reload, Print and Inspect, plus the matching keyboard shortcuts.
// A desktop app shouldn't expose any of that, so release builds cancel
// those defaults. Dev builds keep them for debugging.

import { useEffect } from "react";

interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/**
 * Browser shortcuts whose default action is cancelled. App handlers for the
 * same keys (Ctrl+P palette, F5 refresh) still run: only the default goes.
 */
const BROWSER_SHORTCUTS: Shortcut[] = [
  // reload
  { key: "F5" },
  { key: "r", ctrl: true },
  { key: "r", ctrl: true, shift: true },
  // print and view source
  { key: "p", ctrl: true },
  { key: "u", ctrl: true },
  // developer tools
  { key: "F12" },
  { key: "i", ctrl: true, shift: true },
  { key: "j", ctrl: true, shift: true },
  { key: "c", ctrl: true, shift: true },
  // history navigation
  { key: "ArrowLeft", alt: true },
  { key: "ArrowRight", alt: true },
  { key: "BrowserBack" },
  { key: "BrowserForward" },
  // find bar
  { key: "F3" },
  { key: "g", ctrl: true },
];

/** Mouse buttons 3 and 4: back and forward. */
const HISTORY_BUTTONS = new Set([3, 4]);

const TEXT_INPUTS = new Set(["text", "search", "url", "email", "password", "number", "tel"]);

/** Text fields keep the native menu: it offers copy, paste and spell check. */
function isTextField(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return TEXT_INPUTS.has(target.type);
  return target instanceof HTMLElement && target.isContentEditable;
}

function isBrowserShortcut(e: KeyboardEvent): boolean {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return BROWSER_SHORTCUTS.some(
    (s) => s.key === key && !!s.ctrl === (e.ctrlKey || e.metaKey) && !!s.shift === e.shiftKey && !!s.alt === e.altKey,
  );
}

/** Hides the webview's browser menu and shortcuts in release builds. */
export function useBrowserChromeGuard() {
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const onContextMenu = (e: MouseEvent) => {
      if (!isTextField(e.target)) e.preventDefault();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isBrowserShortcut(e)) e.preventDefault();
    };
    const onHistoryButton = (e: MouseEvent) => {
      if (HISTORY_BUTTONS.has(e.button)) e.preventDefault();
    };
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mouseup", onHistoryButton);
    window.addEventListener("auxclick", onHistoryButton);
    return () => {
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mouseup", onHistoryButton);
      window.removeEventListener("auxclick", onHistoryButton);
    };
  }, []);
}
