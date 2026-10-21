import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import { t } from "../i18n";
import { Toast, TOAST_DURATION, useG, useStore } from "../store";

export function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const set = useStore((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 4), y: Math.min(menu.y, window.innerHeight - r.height - 4) });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = () => set({ menu: null });
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [menu, set]);

  if (!menu) return null;
  return (
    <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((it, i) =>
        it === "sep" ? (
          <div key={i} className="menu-sep" />
        ) : (
          <div
            key={i}
            className={`menu-item${it.danger ? " danger" : ""}${it.disabled ? " disabled" : ""}`}
            onClick={() => {
              if (it.disabled) return;
              set({ menu: null });
              it.action?.();
            }}
          >
            {it.icon}
            {it.label}
          </div>
        ),
      )}
    </div>
  );
}

export function Dialog() {
  const d = useStore((s) => s.dialog);
  const set = useStore((s) => s.set);
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => {
    if (d) setVals(Object.fromEntries((d.fields ?? []).map((f) => [f.name, f.value ?? ""])));
  }, [d]);
  if (!d) return null;
  const done = (ok: boolean) => {
    set({ dialog: null });
    d.resolve(ok ? vals : null);
  };
  return (
    <div className="modal-back" onMouseDown={() => done(false)}>
      <form
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          done(true);
        }}
        onKeyDown={(e) => e.key === "Escape" && done(false)}
      >
        <h3>{d.title}</h3>
        {d.message && <p>{d.message}</p>}
        {(d.fields ?? []).map((f, i) => (
          <label key={f.name} className={f.type === "checkbox" ? "check" : "field"}>
            {f.type === "checkbox" ? (
              <>
                <input type="checkbox" checked={vals[f.name] === "true"} onChange={(e) => setVals({ ...vals, [f.name]: String(e.target.checked) })} />
                {f.label}
              </>
            ) : (
              <>
                <span>{f.label}</span>
                {f.type === "textarea" ? (
                  <textarea rows={3} value={vals[f.name] ?? ""} placeholder={f.placeholder} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} />
                ) : f.type === "select" ? (
                  <select value={vals[f.name] ?? ""} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })}>
                    {f.options?.map((o) => <option key={o}>{o}</option>)}
                  </select>
                ) : (
                  <input autoFocus={i === 0} value={vals[f.name] ?? ""} placeholder={f.placeholder} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} />
                )}
              </>
            )}
          </label>
        ))}
        <div className="modal-actions">
          <button type="button" onClick={() => done(false)}>Cancel</button>
          <button type="submit" className={d.danger ? "danger-btn" : "primary"} autoFocus={!d.fields?.length}>
            {d.confirmLabel ?? "OK"}
          </button>
        </div>
      </form>
    </div>
  );
}

const TOAST_ICON = {
  success: <CheckCircle2 size={18} />,
  warning: <AlertTriangle size={18} />,
  error: <XCircle size={18} />,
  info: <Info size={18} />,
  loading: <Loader2 size={18} className="spin" />,
};

function ToastCard({ toast }: { toast: Toast }) {
  const { dismissToast } = useStore.getState();
  const [expanded, setExpanded] = useState(false);
  const duration = TOAST_DURATION[toast.kind];
  const lines = toast.description?.split("\n") ?? [];
  const long = lines.length > 3 || (toast.description?.length ?? 0) > 220;
  return (
    <div className={`toast ${toast.kind}${toast.leaving ? " leaving" : ""}`} role={toast.kind === "error" ? "alert" : "status"}>
      <span className="toast-icon">{TOAST_ICON[toast.kind]}</span>
      <div className="toast-body">
        <div className="toast-title">{toast.title}</div>
        {toast.description && (
          <div className={`toast-desc${expanded ? " open" : ""}`}>{expanded || !long ? toast.description : lines.slice(0, 3).join("\n")}</div>
        )}
        {long && (
          <button className="toast-more" onClick={() => setExpanded(!expanded)}>
            {expanded ? "−" : "+"} {t("details")}
          </button>
        )}
      </div>
      {toast.kind !== "loading" && (
        <button className="icon toast-x" title="Dismiss" onClick={() => dismissToast(toast.id)}>
          <X size={14} />
        </button>
      )}
      {duration > 0 && !toast.leaving && (
        // The bar's CSS animation is the timer: it pauses on hover and
        // dismisses the toast when it ends.
        <span key={toast.createdAt} className="toast-bar" style={{ animationDuration: `${duration}ms` }} onAnimationEnd={() => !expanded && dismissToast(toast.id)} />
      )}
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const pos = useG("toastPosition");
  return (
    <div className={`toasts ${pos}`} aria-live="polite">
      {toasts.map((x) => (
        <ToastCard key={x.id} toast={x} />
      ))}
    </div>
  );
}