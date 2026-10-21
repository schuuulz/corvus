import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { listen } from "@tauri-apps/api/event";
import { Plus, TerminalSquare, X } from "lucide-react";
import { ext } from "../api";
import { useG, useStore } from "../store";

let nextId = 1;

function readVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function Session({ id, cwd, visible }: { id: number; cwd: string; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const [focused, setFocused] = useState(true);
  const font = useG("termFont");
  const size = useG("termFontSize");
  const lineHeight = useG("termLineHeight");
  const cursor = useG("termCursor");
  const dim = useG("termDim");
  const shell = useG("termShell");
  const theme = useG("theme");

  useEffect(() => {
    const t = new XTerm({
      fontFamily: `"${font}", Consolas, monospace`,
      fontSize: size,
      lineHeight,
      cursorStyle: cursor,
      cursorBlink: true,
      allowProposedApi: true,
      theme: { background: readVar("--bg-2"), foreground: readVar("--text"), cursor: readVar("--accent-2"), selectionBackground: "#7c5cff55" },
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(host.current!);
    f.fit();
    term.current = t;
    fit.current = f;
    const subs = [
      listen<{ id: number; data: string }>("term-data", (e) => e.payload.id === id && t.write(e.payload.data)),
      listen<number>("term-exit", (e) => e.payload === id && t.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n")),
    ];
    ext.termSpawn(id, cwd, shell, t.cols, t.rows).catch((e) => t.write(`\x1b[31m${e}\x1b[0m\r\n`));
    const onData = t.onData((d) => void ext.termWrite(id, d));
    const onResize = t.onResize(({ cols, rows }) => void ext.termResize(id, cols, rows));
    t.textarea?.addEventListener("focus", () => setFocused(true));
    t.textarea?.addEventListener("blur", () => setFocused(false));
    const ro = new ResizeObserver(() => {
      try {
        f.fit();
      } catch {
        /* hidden */
      }
    });
    ro.observe(host.current!);
    return () => {
      ro.disconnect();
      onData.dispose();
      onResize.dispose();
      subs.forEach((p) => p.then((un) => un()));
      void ext.termKill(id);
      t.dispose();
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live-apply appearance preferences.
  useEffect(() => {
    const t = term.current;
    if (!t) return;
    t.options.fontFamily = `"${font}", Consolas, monospace`;
    t.options.fontSize = size;
    t.options.lineHeight = lineHeight;
    t.options.cursorStyle = cursor;
    t.options.theme = { background: readVar("--bg-2"), foreground: readVar("--text"), cursor: readVar("--accent-2"), selectionBackground: "#7c5cff55" };
    fit.current?.fit();
  }, [font, size, lineHeight, cursor, theme]);

  useEffect(() => {
    if (visible) {
      setTimeout(() => {
        fit.current?.fit();
        term.current?.focus();
      }, 0);
    }
  }, [visible]);

  return <div ref={host} className={`term-body${dim && !focused ? " dim" : ""}`} style={{ display: visible ? "block" : "none" }} />;
}

export default function TerminalDock({ cwd }: { cwd: string }) {
  const [sessions, setSessions] = useState<{ id: number; cwd: string }[]>(() => [{ id: nextId++, cwd }]);
  const [active, setActive] = useState(sessions[0].id);
  const { set } = useStore.getState();
  const add = () => {
    const s = { id: nextId++, cwd };
    setSessions((xs) => [...xs, s]);
    setActive(s.id);
  };
  const close = (id: number) => {
    const rest = sessions.filter((s) => s.id !== id);
    if (!rest.length) return set({ terminalOpen: false });
    setSessions(rest);
    if (active === id) setActive(rest[rest.length - 1].id);
  };
  return (
    <>
      <div className="term-head">
        <TerminalSquare size={14} className="muted" />
        {sessions.map((s, i) => (
          <div key={s.id} className={`term-tab${s.id === active ? " on" : ""}`} onClick={() => setActive(s.id)}>
            Terminal {i + 1}
            <button className="icon" onClick={(e) => (e.stopPropagation(), close(s.id))}>
              <X size={11} />
            </button>
          </div>
        ))}
        <button className="icon" title="New terminal" onClick={add}>
          <Plus size={14} />
        </button>
        <span className="spacer" />
        <span className="muted small">{cwd}</span>
        <button className="icon" title="Close terminal (Ctrl+`)" onClick={() => set({ terminalOpen: false })}>
          <X size={14} />
        </button>
      </div>
      {sessions.map((s) => (
        <Session key={s.id} id={s.id} cwd={s.cwd} visible={s.id === active} />
      ))}
    </>
  );
}
