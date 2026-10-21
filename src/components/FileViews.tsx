import { useEffect, useState } from "react";
import { api, BlameLine, HistoryEntry } from "../api";
import { PALETTE } from "./ui";
import { useDateFormat } from "../hooks";
import { shortSha, useStore } from "../store";

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  const { setCenter } = useStore.getState();
  return (
    <div className="diff">
      <div className="diff-head">
        <span className="diff-title">{title}</span>
        <span className="spacer" />
        <button className="icon" onClick={() => setCenter({ kind: "graph" })}>✕</button>
      </div>
      {children}
    </div>
  );
}

function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setErr(null);
    fn().then((d) => live && setData(d), (e) => live && setErr(String(e)));
    return () => {
      live = false;
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, err };
}

export function FileHistory({ file }: { file: string }) {
  const repo = useStore((s) => s.active)!;
  const { setCenter, select } = useStore.getState();
  const fmt = useDateFormat();
  const { data, err } = useLoad<HistoryEntry[]>(() => api.fileHistory(repo, file), [repo, file]);
  return (
    <Frame title={`History of ${file}`}>
      {err && <div className="pad error-text">{err}</div>}
      {!data && !err && <div className="pad muted">Loading…</div>}
      <div className="list">
        {data?.map((h) => (
          <div
            key={h.oid}
            className="list-row"
            onClick={() => {
              select({ kind: "commit", oid: h.oid });
              setCenter({ kind: "diff", file, mode: "commit", oid: h.oid });
            }}
          >
            <span className="sha mono">{shortSha(h.oid)}</span>
            <span className="grow">{h.summary}</span>
            <span className="muted">{h.author}</span>
            <span className="muted">{fmt(h.time)}</span>
          </div>
        ))}
        {data && !data.length && <div className="empty">No committed history for this file</div>}
      </div>
    </Frame>
  );
}

export function Blame({ file }: { file: string }) {
  const repo = useStore((s) => s.active)!;
  const { select } = useStore.getState();
  const fmt = useDateFormat();
  const { data, err } = useLoad<BlameLine[]>(() => api.blame(repo, file), [repo, file]);
  const colors = new Map<string, string>();
  return (
    <Frame title={`Blame ${file}`}>
      {err && <div className="pad error-text">{err}</div>}
      {!data && !err && <div className="pad muted">Loading…</div>}
      <div className="blame mono">
        {data?.map((l, i) => {
          if (!colors.has(l.oid)) colors.set(l.oid, PALETTE[colors.size % PALETTE.length]);
          const first = i === 0 || data[i - 1].oid !== l.oid;
          return (
            <div key={l.line} className={`bl${first ? " first" : ""}`}>
              <span className="bl-meta" style={{ borderLeftColor: colors.get(l.oid) }} onClick={() => select({ kind: "commit", oid: l.oid })} title={l.summary}>
                {first ? `${shortSha(l.oid)} ${l.author} · ${fmt(l.time, "date")}` : ""}
              </span>
              <span className="ln">{l.line}</span>
              <span className="code">{l.content}</span>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}
