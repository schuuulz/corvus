// Building blocks for preference pages. Every control saves on change and
// flashes a "Saved" indicator.

import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle } from "lucide-react";
import { ext } from "../api";
import { GlobalKey, GlobalSettings, RepoKey, RepoSettings } from "../settings";
import { useG, useR, useStore } from "../store";

export const useSaved = create<{ at: number; flash: () => void }>((set) => ({ at: 0, flash: () => set({ at: Date.now() }) }));
const flash = () => useSaved.getState().flash();

/** Current search query, used to highlight matching rows. */
export const SearchCtx = createContext("");

export function Setting({ label, help, warn, tag, children }: { label: string; help?: ReactNode; warn?: ReactNode; tag?: string; children: ReactNode }) {
  const q = useContext(SearchCtx).toLowerCase();
  const matched = !!q && label.toLowerCase().includes(q);
  return (
    <div className={`setting${matched ? " matched" : ""}`}>
      <div className="lbl">{label}</div>
      <div className="ctl">
        {children}
        {help && <div className="help">{help}</div>}
        {warn && (
          <div className="warn">
            <AlertTriangle size={13} /> <span>{warn}</span>
          </div>
        )}
        {tag && <span className="tag">{tag}</span>}
      </div>
    </div>
  );
}

export function Page({ title, icon, lead, children }: { title: string; icon?: ReactNode; lead?: ReactNode; children: ReactNode }) {
  return (
    <div className="prefs-page">
      <h1>
        {icon}
        {title}
      </h1>
      {lead && <p className="lead">{lead}</p>}
      {children}
    </div>
  );
}

type Scope = { scope?: "global" } | { scope: "repo" };

function useValue(k: string, scope: "global" | "repo") {
  const gv = useG(k as GlobalKey);
  const rv = useR(k as RepoKey);
  const { setG, setR } = useStore.getState();
  const value = scope === "repo" ? rv : gv;
  const set = (v: unknown) => {
    if (scope === "repo") void setR(k as RepoKey, v as never);
    else void setG(k as GlobalKey, v as never);
    flash();
  };
  return [value, set] as const;
}

export function Toggle(p: { k: GlobalKey | RepoKey; label: string; help?: ReactNode; warn?: ReactNode; inline?: string } & Scope) {
  const [v, set] = useValue(p.k, p.scope ?? "global");
  return (
    <Setting label={p.label} help={p.help} warn={p.warn}>
      <label className="chk-line">
        <input type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked)} />
        {p.inline && <span>{p.inline}</span>}
      </label>
    </Setting>
  );
}

export function NumberInput(p: { k: GlobalKey; label: string; help?: ReactNode; warn?: ReactNode; min?: number; max?: number; step?: number }) {
  const [v, set] = useValue(p.k, "global");
  const [draft, setDraft] = useState(String(v));
  useEffect(() => setDraft(String(v)), [v]);
  const commit = () => {
    let n = Number(draft.replace(",", "."));
    if (!Number.isFinite(n)) return setDraft(String(v));
    if (p.min !== undefined) n = Math.max(p.min, n);
    if (p.max !== undefined) n = Math.min(p.max, n);
    setDraft(String(n));
    if (n !== v) set(n);
  };
  return (
    <Setting label={p.label} help={p.help} warn={p.warn}>
      <input type="number" style={{ maxWidth: 140 }} value={draft} min={p.min} max={p.max} step={p.step ?? 1} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
    </Setting>
  );
}

export function TextInput(p: { k: GlobalKey | RepoKey; label: string; help?: ReactNode; placeholder?: string; multiline?: boolean; preview?: (v: string) => ReactNode } & Scope) {
  const [v, set] = useValue(p.k, p.scope ?? "global");
  const [draft, setDraft] = useState(String(v ?? ""));
  useEffect(() => setDraft(String(v ?? "")), [v]);
  const commit = () => draft !== v && set(draft);
  return (
    <Setting label={p.label} help={p.help}>
      <div className="row-inline" style={{ maxWidth: 520 }}>
        {p.multiline ? (
          <textarea rows={4} value={draft} placeholder={p.placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
        ) : (
          <input value={draft} placeholder={p.placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
        )}
        {p.preview && <span className="preview" style={{ whiteSpace: "nowrap" }}>{p.preview(draft)}</span>}
      </div>
    </Setting>
  );
}

export function Select<K extends GlobalKey | RepoKey>(p: { k: K; label: string; help?: ReactNode; options: readonly (readonly [string, string])[] } & Scope) {
  const [v, set] = useValue(p.k, p.scope ?? "global");
  return (
    <Setting label={p.label} help={p.help}>
      <select value={String(v)} onChange={(e) => set(e.target.value)} style={{ maxWidth: 320 }}>
        {p.options.map(([id, name]) => (
          <option key={id} value={id}>{name}</option>
        ))}
      </select>
    </Setting>
  );
}

export function PathInput(p: { k: GlobalKey; label: string; help?: ReactNode; directory?: boolean; placeholder?: string; extra?: ReactNode }) {
  const [v, set] = useValue(p.k, "global");
  const browse = async () => {
    const f = await open({ directory: p.directory, multiple: false, title: p.label });
    if (typeof f === "string") set(f.replace(/\\/g, "/"));
  };
  return (
    <Setting label={p.label} help={p.help}>
      <div className="row-inline">
        <button onClick={browse}>Browse…</button>
        <input value={String(v ?? "")} placeholder={p.placeholder} onChange={(e) => set(e.target.value)} />
        {v ? <button className="small" onClick={() => set("")}>Clear</button> : null}
        {p.extra}
      </div>
    </Setting>
  );
}

/** A git config value. `repo` null means the global config. */
export function useGitConfig(key: string, repo: string | null) {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    ext.configGet(repo, key).then((v) => live && setValue(v), () => live && setValue(""));
    return () => {
      live = false;
    };
  }, [key, repo]);
  const set = async (v: string) => {
    setValue(v);
    try {
      await ext.configSet(repo, key, v);
      flash();
    } catch (e) {
      useStore.getState().toast(String(e), "error");
    }
  };
  return [value, set] as const;
}

export function GitToggle({ gitKey, repo = null, label, help, defaultOn = false }: { gitKey: string; repo?: string | null; label: string; help?: ReactNode; defaultOn?: boolean }) {
  const [v, set] = useGitConfig(gitKey, repo);
  const on = v === null || v === "" ? defaultOn : v === "true";
  return (
    <Setting label={label} help={help} tag={`${repo ? "" : "--global "}${gitKey}`}>
      <label className="chk-line">
        <input type="checkbox" disabled={v === null} checked={on} onChange={(e) => set(e.target.checked ? "true" : "false")} />
      </label>
    </Setting>
  );
}

export function GitText({ gitKey, repo = null, label, help, placeholder, browse }: { gitKey: string; repo?: string | null; label: string; help?: ReactNode; placeholder?: string; browse?: "file" | "dir" }) {
  const [v, set] = useGitConfig(gitKey, repo);
  const [draft, setDraft] = useState("");
  useEffect(() => setDraft(v ?? ""), [v]);
  const pick = async () => {
    const f = await open({ directory: browse === "dir", title: label });
    if (typeof f === "string") void set(f.replace(/\\/g, "/"));
  };
  return (
    <Setting label={label} help={help} tag={`${repo ? "" : "--global "}${gitKey}`}>
      <div className="row-inline">
        {browse && <button onClick={pick}>Browse…</button>}
        <input value={draft} disabled={v === null} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== v && set(draft)} onKeyDown={(e) => e.key === "Enter" && draft !== v && set(draft)} />
      </div>
    </Setting>
  );
}

export function GitSelect({ gitKey, repo = null, label, help, options }: { gitKey: string; repo?: string | null; label: string; help?: ReactNode; options: [string, string][] }) {
  const [v, set] = useGitConfig(gitKey, repo);
  return (
    <Setting label={label} help={help} tag={`${repo ? "" : "--global "}${gitKey}`}>
      <select value={v ?? ""} disabled={v === null} onChange={(e) => set(e.target.value)} style={{ maxWidth: 320 }}>
        {options.map(([id, name]) => (
          <option key={id} value={id}>{name}</option>
        ))}
      </select>
    </Setting>
  );
}

export { useG, useR };
export type { GlobalSettings, RepoSettings };
