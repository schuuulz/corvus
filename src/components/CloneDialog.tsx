import { FormEvent, KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Lock, Plug } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import * as A from "../actions";
import { Integration } from "../api";
import { HostedRepo, useCloneableRepos } from "../hooks";
import { t } from "../i18n";
import { cloneDestination, normalizePath } from "../paths";
import { Provider, PROVIDERS } from "../prefs/Integrations";
import { g, useG, useStore } from "../store";

const close = () => useStore.getState().set({ modal: null });

/** Suggestions rendered at once; typing narrows the list down to the rest. */
const MAX_SUGGESTIONS = 50;

/** Text that is already a clone URL (https://…, ssh://…, git@host:…), not a search. */
const isCloneUrl = (text: string) => /^\s*(\w+:\/\/|[\w.-]+@)/.test(text);

function matchRepos(repos: HostedRepo[], query: string): HostedRepo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return repos.filter((repo) => words.every((word) => repo.fullName.toLowerCase().includes(word))).slice(0, MAX_SUGGESTIONS);
}

/**
 * Clone dialog: pick an integration on the left, then the repository (from
 * the connected account, or any pasted URL) and the folder it goes into.
 */
export default function CloneDialog() {
  const integrations = useG("integrations");
  const busy = useStore((s) => s.busy);
  const progress = useStore((s) => s.progress);
  const accountsOf = (provider: Provider) => integrations.filter((i) => i.kind === provider.kind);
  const [provider, setProvider] = useState(() => PROVIDERS.find((p) => accountsOf(p).length) ?? PROVIDERS[0]);
  const [url, setUrl] = useState("");
  const [parentDir, setParentDir] = useState(() => g("cloneParentFolder"));

  const accounts = accountsOf(provider);
  const dest = cloneDestination(url, parentDir);
  const ready = !!dest && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (ready && (await A.cloneRepo(url.trim(), parentDir))) close();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Escape" && !busy) close();
  };

  return (
    <div className="modal-back" onMouseDown={() => !busy && close()}>
      <form className="modal clone-modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit} onKeyDown={onKeyDown}>
        <h3>{t("clone.dialog.title")}</h3>
        <div className="clone-layout">
          <ProviderMenu selected={provider} accountsOf={accountsOf} onSelect={setProvider} />
          <div className="clone-fields">
            <RepoCombobox key={provider.kind} accounts={accounts} value={url} onChange={setUrl} />
            <ParentFolderField value={parentDir} onChange={setParentDir} />
            {dest && <div className="muted small clone-dest">{t("clone.dialog.destination", { dest })}</div>}
            {!accounts.length && <ConnectHint provider={provider} />}
          </div>
        </div>
        {busy && (
          <div className="muted small" aria-live="polite">
            <span className="spinner" /> {progress}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" disabled={!!busy} onClick={close}>
            {t("clone.dialog.cancel")}
          </button>
          <button type="submit" className="primary" disabled={!ready}>
            {t("clone.dialog.clone")}
          </button>
        </div>
      </form>
    </div>
  );
}

/** The integrations, each with the account connected to it. */
function ProviderMenu({ selected, accountsOf, onSelect }: { selected: Provider; accountsOf: (provider: Provider) => Integration[]; onSelect: (provider: Provider) => void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, provider: Provider) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onSelect(provider);
  };
  return (
    <div className="clone-nav" role="tablist" aria-label={t("clone.dialog.providers")} aria-orientation="vertical">
      {PROVIDERS.map((provider) => {
        const accounts = accountsOf(provider);
        const on = provider.kind === selected.kind;
        return (
          <div key={provider.kind} role="tab" tabIndex={0} aria-selected={on} className={`nav-item${on ? " on" : ""}`} onClick={() => onSelect(provider)} onKeyDown={(e) => onKeyDown(e, provider)}>
            {provider.icon}
            <span>{provider.name}</span>
            {accounts.length > 0 && <span className="hits chip ok">{accounts.length === 1 ? accounts[0].username : accounts.length}</span>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The repository to clone: a text field that takes any URL and, when
 * `accounts` are connected, suggests their repositories as you type.
 */
function RepoCombobox({ accounts, value, onChange }: { accounts: Integration[]; value: string; onChange: (url: string) => void }) {
  const repos = useCloneableRepos(accounts);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const labelId = useId();
  const listId = useId();
  const matches = useMemo(() => matchRepos(repos.items ?? [], value), [repos.items, value]);
  const connected = accounts.length > 0;
  const showList = connected && open && !isCloneUrl(value);

  const pick = (repo: HostedRepo) => {
    onChange(repo.cloneUrl);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && connected) {
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp" && showList) {
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && showList && matches[active]) {
      pick(matches[active]);
    } else if (e.key === "Escape" && showList) {
      setOpen(false);
    } else {
      return;
    }
    // Handled here: the form must neither submit nor close on these keys.
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="field">
      <span id={labelId}>{t("clone.dialog.repository")}</span>
      <div className={`clone-combo${showList ? " open" : ""}`} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
        <input
          autoFocus
          role="combobox"
          aria-labelledby={labelId}
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && matches[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={t(connected ? "clone.dialog.search" : "clone.dialog.paste")}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {connected && <ChevronDown size={14} className="clone-combo-chevron" aria-hidden />}
        {showList && (
          <RepoSuggestions id={listId} labelId={labelId} repos={repos} matches={matches} query={value.trim()} active={active} showHost={accounts.length > 1} onHover={setActive} onPick={pick} />
        )}
      </div>
    </div>
  );
}

interface SuggestionsProps {
  id: string;
  labelId: string;
  repos: ReturnType<typeof useCloneableRepos>;
  matches: HostedRepo[];
  query: string;
  active: number;
  /** Several servers are listed together: say which one each repository is on. */
  showHost: boolean;
  onHover: (index: number) => void;
  onPick: (repo: HostedRepo) => void;
}

/** The dropdown under the repository field: its rows, or why there are none. */
function RepoSuggestions({ id, labelId, repos, matches, query, active, showHost, onHover, onPick }: SuggestionsProps) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    // Keeps the focus in the field while the list is clicked or scrolled.
    <div ref={list} id={id} role="listbox" aria-labelledby={labelId} className="clone-repos" onMouseDown={(e) => e.preventDefault()}>
      <SuggestionsStatus repos={repos} hasMatches={matches.length > 0} query={query} />
      {matches.map((repo, i) => (
        <div key={`${repo.host}/${repo.fullName}`} id={`${id}-${i}`} role="option" aria-selected={i === active} className={`clone-repo${i === active ? " on" : ""}`} onMouseEnter={() => onHover(i)} onClick={() => onPick(repo)}>
          <span className="clone-repo-name">{repo.fullName}</span>
          {repo.private && <Lock size={12} aria-label={t("clone.repos.private")} />}
          <span className="clone-repo-desc muted small">{showHost ? repo.host : repo.description}</span>
        </div>
      ))}
    </div>
  );
}

/** What the list says when it has no rows to show: loading, failed, or empty. */
function SuggestionsStatus({ repos, hasMatches, query }: { repos: ReturnType<typeof useCloneableRepos>; hasMatches: boolean; query: string }) {
  if (repos.error) {
    return (
      <div className="empty small">
        <span>{t("clone.repos.failed")}</span>
        <span className="error-text">{repos.error}</span>
        <button type="button" className="small" onClick={repos.reload}>
          {t("clone.repos.retry")}
        </button>
      </div>
    );
  }
  if (!repos.items) {
    return (
      <div className="empty small" aria-live="polite">
        <span className="spinner" /> {t("clone.repos.loading")}
      </div>
    );
  }
  if (hasMatches) return null;
  return <div className="empty small">{repos.items.length ? t("clone.repos.noMatch", { query }) : t("clone.repos.empty")}</div>;
}

function ParentFolderField({ value, onChange }: { value: string; onChange: (dir: string) => void }) {
  const browse = async () => {
    const picked = await open({ directory: true, title: t("clone.dialog.browseTitle"), defaultPath: value || undefined });
    if (typeof picked === "string") onChange(normalizePath(picked));
  };
  return (
    <label className="field">
      <span>{t("clone.dialog.folder")}</span>
      <div className="row-inline">
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("clone.dialog.folderPlaceholder")} spellCheck={false} />
        <button type="button" onClick={browse}>
          {t("clone.dialog.browse")}
        </button>
      </div>
    </label>
  );
}

/** Shown for an integration with no account: where to connect one. */
function ConnectHint({ provider }: { provider: Provider }) {
  return (
    <div className="modal-note info">
      <Plug size={14} />
      <span className="grow">{t("clone.connect.hint", { provider: provider.name })}</span>
      <button type="button" onClick={() => useStore.getState().openPrefs("integrations")}>
        {t("clone.connect.action")}
      </button>
    </div>
  );
}
