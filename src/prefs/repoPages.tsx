import { useEffect, useState } from "react";
import { CircleDot, FileType2, GitCommitHorizontal, GitMerge, HardDrive, ScanLine, ShieldAlert, Webhook } from "lucide-react";
import { ext, Gitflow as Flow, Lfs as LfsInfo, Sparse as SparseInfo } from "../api";
import { ENCODINGS } from "../settings";
import { useG, useR, useStore } from "../store";
import * as A from "../actions";
import { t } from "../i18n";
import { GitText, Page, Select, Setting, TextInput, Toggle, useSaved } from "./controls";

const R = { scope: "repo" as const };

export function Encoding() {
  return (
    <Page title="Encoding" icon={<FileType2 size={20} />}>
      <Select k="encoding" {...R} label="Default encoding" help="Encoding used when reading and writing files of this repository in diffs and the editor." options={ENCODINGS} />
    </Page>
  );
}

export function CommitPrefs() {
  const repo = useStore((s) => s.active)!;
  const summary = useR("templateSummary");
  const body = useR("templateBody");
  const { setR, toast } = useStore.getState();
  const [s, setS] = useState(summary);
  const [b, setB] = useState(body);
  useEffect(() => {
    setS(summary);
    setB(body);
  }, [summary, body]);
  const dirty = s !== summary || b !== body;
  const save = async () => {
    await setR("templateSummary", s);
    await setR("templateBody", b);
    // Also write it as git's commit.template so CLI commits share it.
    const text = b.trim() ? `${s}\n\n${b}\n` : `${s}\n`;
    try {
      const gitDir = `${repo}/.git`;
      await ext.writeRepoFile(repo, ".git/corvus-commit-template", text);
      await ext.configSet(repo, "commit.template", s || b ? `${gitDir}/corvus-commit-template` : "");
      useSaved.getState().flash();
    } catch (e) {
      toast(String(e), "error");
    }
  };
  return (
    <Page title="Commit" icon={<GitCommitHorizontal size={20} />}>
      <Toggle k="pushAfterCommit" {...R} label="Push after each commit" />
      <Toggle k="skipHooks" {...R} label="Skip git hooks by default when committing" help="Commits use --no-verify unless you untick “Skip hooks” in the commit panel." />
      <h2>Merge behaviour</h2>
      <Toggle k="mergeSquash" {...R} label="Squash" help="Merging a branch locally stages all its changes without creating a merge commit. You then commit manually." />
      <h2>Commit template</h2>
      <p className="muted small">A default message for new commits, to keep summaries and descriptions consistent. Also saved as git's <code>commit.template</code>.</p>
      <Toggle k="templateApply" {...R} label="Apply this template to commit messages" />
      <Toggle k="templateStrip" {...R} label="Remove comments from commit messages" help="Strip lines starting with # when committing." />
      <Setting label="Summary">
        <div className="summary-wrap" style={{ maxWidth: 520 }}>
          <input value={s} onChange={(e) => setS(e.target.value)} placeholder="feat: " />
          <span className={`counter${s.length > 72 ? " over" : ""}`}>{72 - s.length}</span>
        </div>
      </Setting>
      <Setting label="Description">
        <textarea rows={6} style={{ maxWidth: 520 }} value={b} onChange={(e) => setB(e.target.value)} placeholder={"Why:\n\nHow:\n\nRefs #"} />
        <div><button className="success" disabled={!dirty} onClick={save}>Save commit template</button></div>
      </Setting>
    </Page>
  );
}

export function Hooks() {
  const repo = useStore((s) => s.active)!;
  return (
    <Page title="Git Hooks" icon={<Webhook size={20} />} lead="Git hooks are scripts that run on events such as commit or push. Git for Windows runs them with its bundled sh.">
      <GitText gitKey="core.hooksPath" repo={repo} browse="dir" label="Git hooks directory" placeholder=".git/hooks (default)" help="The directory git uses for hooks in this repository and its linked worktrees." />
      <Toggle k="skipHooks" {...R} label="Skip git hooks by default when committing" />
    </Page>
  );
}

export function Gitflow() {
  const repo = useStore((s) => s.active)!;
  const locals = useStore((s) => s.repos[repo]?.refs?.locals);
  const { toast } = useStore.getState();
  const [gf, setGf] = useState<Flow | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => ext.gitflow(repo).then(setGf, (e) => toast(String(e), "error"));
  useEffect(() => {
    void load();
  }, [repo]); // eslint-disable-line react-hooks/exhaustive-deps
  const names = new Set(locals?.map((b) => b.name) ?? []);
  if (!gf) return <Page title="Gitflow" icon={<GitMerge size={20} />}><div className="skeleton" /></Page>;
  // Branch fields must name existing local branches exactly.
  const missing = (k: "master" | "develop") => !names.has(gf[k].trim());
  const field = (k: keyof Omit<Flow, "initialized">, label: string, branch = false) => (
    <Setting label={label} help={branch && missing(k as "master") ? <span className="error-text">{t("gitflow.fieldMissing")}</span> : undefined}>
      <input
        className={branch && missing(k as "master") ? "invalid" : ""}
        list={branch ? "gitflow-branches" : undefined}
        value={gf[k]}
        onChange={(e) => setGf({ ...gf, [k]: e.target.value })}
        style={{ maxWidth: 320 }}
      />
    </Setting>
  );
  const save = async () => {
    const { initialized: _i, ...cfg } = gf;
    void _i;
    setBusy(true);
    if (await A.gitflowInit(cfg)) void load();
    setBusy(false);
  };
  return (
    <Page title="Gitflow" icon={<GitMerge size={20} />} lead={gf.initialized ? "Gitflow is initialised. Hover a main branch in the left panel and press › to start or finish branches." : "Gitflow is not initialised for this repository yet."}>
      <datalist id="gitflow-branches">{[...names].map((n) => <option key={n} value={n} />)}</datalist>
      <h2>Branches</h2>
      {field("master", "Main / master", true)}
      {field("develop", "Develop", true)}
      <h2>Prefixes</h2>
      {field("feature", "Feature")}
      {field("release", "Release")}
      {field("hotfix", "Hotfix")}
      {field("versionTag", "Version tag")}
      <Setting label="">
        <div>
          <button className="success" disabled={busy || missing("master") || missing("develop")} onClick={save}>
            {gf.initialized ? "Save Gitflow settings" : t("gitflow.init")}
          </button>
        </div>
      </Setting>
    </Page>
  );
}
export function Lfs() {
  const repo = useStore((s) => s.active)!;
  const { run, toast } = useStore.getState();
  const [info, setInfo] = useState<LfsInfo | null>(null);
  const [pattern, setPattern] = useState("");
  const [files, setFiles] = useState<string | null>(null);
  const load = () => ext.lfs(repo).then(setInfo, (e) => toast(String(e), "error"));
  useEffect(() => {
    void load();
  }, [repo]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (label: string, fn: () => Promise<unknown>) => {
    await run(label, fn, { success: () => ({ title: label, description: "LFS" }) });
    void load();
  };
  const name = repo.split("/").pop();
  return (
    <Page title="LFS" icon={<HardDrive size={20} />} lead="Git Large File Storage keeps big binaries out of your history.">
      {!info && <div className="skeleton" />}
      {info && !info.installed && <div className="hint-box">Git LFS is not installed. Install it from git-lfs.com (it ships with Git for Windows) and reopen this page.</div>}
      {info?.installed && !info.initialized && (
        <>
          <h2>Initialise LFS</h2>
          <p className="muted">LFS has not been initialised on {name}.</p>
          <button className="success" onClick={() => act("Initialising LFS", () => ext.lfsAction(repo, "init"))}>Initialize LFS on this repo</button>
        </>
      )}
      {info?.initialized && (
        <>
          <h2>Tracked patterns</h2>
          {info.patterns.map((p) => (
            <div key={p} className="setting" style={{ gridTemplateColumns: "1fr auto" }}>
              <span className="mono">{p}</span>
              <button className="small danger-outline" onClick={() => act("Untracking", () => ext.lfsAction(repo, "untrack", p))}>Untrack</button>
            </div>
          ))}
          {!info.patterns.length && <p className="muted">No patterns tracked yet.</p>}
          <Setting label="Track pattern" help="Adds the pattern to .gitattributes, e.g. *.psd or assets/**/*.png">
            <div className="row-inline">
              <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="*.psd" />
              <button className="success" disabled={!pattern.trim()} onClick={() => act("Tracking", () => ext.lfsAction(repo, "track", pattern.trim())).then(() => setPattern(""))}>Track</button>
            </div>
          </Setting>
          <Setting label="LFS files">
            <div><button className="small" onClick={() => ext.lfsAction(repo, "files").then((f) => setFiles(f || "(none)"), (e) => toast(String(e), "error"))}>List files</button></div>
            {files && <pre className="mono small" style={{ whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>{files}</pre>}
          </Setting>
        </>
      )}
    </Page>
  );
}

export function SparseCheckout() {
  const repo = useStore((s) => s.active)!;
  const { run, toast } = useStore.getState();
  const [info, setInfo] = useState<SparseInfo | null>(null);
  const [paths, setPaths] = useState("");
  const load = () =>
    ext.sparse(repo).then((s) => {
      setInfo(s);
      setPaths(s.paths.join("\n"));
    }, (e) => toast(String(e), "error"));
  useEffect(() => {
    void load();
  }, [repo]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = paths.split("\n").map((p) => p.trim()).filter(Boolean);
  const act = async (label: string, fn: () => Promise<unknown>) => {
    await run(label, fn, { success: () => ({ title: label, description: "Sparse checkout" }) });
    void load();
  };
  return (
    <Page title="Sparse Checkout" icon={<ScanLine size={20} />} lead={info?.enabled ? "Sparse checkout is enabled." : "Sparse checkout is disabled; the full working tree is checked out."}>
      <Setting label="Paths to include" help="One pattern per line. Only these paths will be checked out in your working directory. With no paths, only root files are checked out.">
        <textarea rows={8} value={paths} onChange={(e) => setPaths(e.target.value)} placeholder={"/src/\n/docs/\n/README.md"} style={{ maxWidth: 520 }} />
        <div className="row-inline">
          <button className="success" onClick={() => act(info?.enabled ? "Updating sparse checkout" : "Enabling sparse checkout", () => ext.sparseSet(repo, list))}>
            {info?.enabled ? "Update sparse checkout" : "Enable sparse checkout"}
          </button>
          <button disabled={!info?.enabled} onClick={() => act("Disabling sparse checkout", () => ext.sparseAction(repo, "disable"))}>Disable sparse checkout</button>
          <button disabled={!info?.enabled} onClick={() => act("Reapplying sparse checkout", () => ext.sparseAction(repo, "reapply"))}>Reapply</button>
        </div>
      </Setting>
    </Page>
  );
}

export function ConflictPrevention() {
  const global = useG("conflictDetection");
  const repo = useStore((s) => s.active)!;
  return (
    <Page title="Conflict Prevention" icon={<ShieldAlert size={20} />}>
      <Toggle
        k="conflictDetection"
        {...R}
        label="Enable proactive conflict detection with target branch"
        help={`Unchecking disables detection only for ${repo.split("/").pop()}.${global ? "" : " It is currently disabled globally in Preferences › General."}`}
      />
      <TextInput
        k="baseBranches"
        {...R}
        multiline
        label="Base branches"
        help="One pattern per line. Corvus guesses which branch yours started from among these and predicts which files would conflict when merging it."
      />
      <div className="pattern-table" style={{ marginLeft: "min(284px, 30%)" }}>
        <code>origin/main</code><i>include a single branch (main) on origin</i>
        <code>origin/**</code><i>include all branches on origin</i>
        <code>origin/feature/**</code><i>include branches on origin that begin with feature/</i>
        <code>!origin/abc</code><i>exclude a single branch (abc) on origin</i>
      </div>
    </Page>
  );
}

export function IssueTracker() {
  const integrations = useG("integrations");
  const def = useG("defaultIssueTracker");
  const cur = useR("issueTracker");
  const { setR, setG, openPrefs } = useStore.getState();
  const flash = useSaved((s) => s.flash);
  return (
    <Page title="Issue Tracker" icon={<CircleDot size={20} />} lead="Choose which connected account provides issues and pull requests for this repository.">
      {!integrations.length && (
        <div className="hint-box">
          No integrations connected. <span className="link-text" onClick={() => openPrefs("integrations")}>Connect GitHub or GitLab</span>.
        </div>
      )}
      <Setting label="Issue tracker for this repo">
        <select value={cur} onChange={(e) => (setR("issueTracker", e.target.value), flash())} style={{ maxWidth: 360 }}>
          <option value="">Automatic (match the remote's host)</option>
          {integrations.map((i) => <option key={i.id} value={i.id}>{i.kind} · {i.username}@{i.host}</option>)}
        </select>
        <label className="check">
          <input type="checkbox" checked={!!cur && def === cur} onChange={(e) => (setG("defaultIssueTracker", e.target.checked ? cur : ""), flash())} disabled={!cur} />
          Use this as the default for all repositories
        </label>
      </Setting>
    </Page>
  );
}
