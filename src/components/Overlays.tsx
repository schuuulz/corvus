import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import { t } from "../i18n";
import { Toast, TOAST_DURATION, useG, useStore } from "../store";

/** Gap kept between a menu and the window edges. */
const EDGE = 4;

/**
 * Where one side of a menu starts: at the click when it fits, flipped to end
 * at the click when it doesn't, and always inside the window.
 */
function placeAlong(click: number, extent: number, room: number): number {
  const start = click + extent <= room - EDGE ? click : click - extent;
  return Math.max(EDGE, Math.min(start, room - extent - EDGE));
}

export function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const set = useStore((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ menu: typeof menu; left: number; top: number } | null>(null);

  // A new menu first renders hidden at the origin, where it can size itself
  // against the whole window; it is measured and placed before the paint.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    setPlaced({ menu, left: placeAlong(menu.x, width, window.innerWidth), top: placeAlong(menu.y, height, window.innerHeight) });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = () => set({ menu: null });
    // A press outside closes the menu. Listening to `click` instead would
    // close a menu opened by a click (toolbar carets) during that same click.
    const closeOutside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("blur", close);
    };
  }, [menu, set]);

  if (!menu) return null;
  return (
    <div
      className="menu"
      ref={ref}
      style={placed?.menu === menu ? { left: placed.left, top: placed.top } : { left: 0, top: 0, visibility: "hidden" }}
      onContextMenu={(e) => e.preventDefault()}
    >
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
            {/* One flex item, so rich labels keep their own spacing. */}
            <span>{it.content ?? it.label}</span>
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