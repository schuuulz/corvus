import { ReactNode, useEffect, useState } from "react";
import {
  ArrowLeft, Bell, CheckCircle2, CircleDot, Code2, FileType2, FolderGit2, GitCommitHorizontal, GitMerge, HardDrive, Palette, PenLine, Plug,
  ScanLine, Search, Settings, Shield, ShieldAlert, SquareTerminal, Webhook, Wrench,
} from "lucide-react";
import { NEW_TAB, useStore } from "../store";
import { SearchCtx, useSaved } from "./controls";
import { EditorPrefs, ExternalTools, General, Notifications, Signing, Ssh, TerminalPrefs, UiCustomization } from "./pages";
import Integrations from "./Integrations";
import { CommitPrefs, ConflictPrevention, Encoding, Gitflow, Hooks, IssueTracker, Lfs, SparseCheckout } from "./repoPages";

interface Section { id: string; label: string; icon: ReactNode; repo?: boolean; page: () => ReactNode; keywords: string }

const SECTIONS: Section[] = [
  { id: "general", label: "General", icon: <Settings size={16} />, page: () => <General />, keywords: "identity name email auto-fetch fetch interval prune submodules conflict default branch orig remember tabs graph commits lazy load git path executable longpaths autocrlf activity log credentials forget" },
  { id: "ssh", label: "SSH", icon: <Shield size={16} />, page: () => <Ssh />, keywords: "ssh agent private public key generate credential manager https" },
  { id: "integrations", label: "Integrations", icon: <Plug size={16} />, page: () => <Integrations />, keywords: "github gitlab enterprise self-managed token pull requests issues connect" },
  { id: "tools", label: "External Tools", icon: <Wrench size={16} />, page: () => <ExternalTools />, keywords: "merge tool diff tool editor terminal vscode meld kdiff3 beyond compare" },
  { id: "notifications", label: "Notifications", icon: <Bell size={16} />, page: () => <Notifications />, keywords: "desktop notifications" },
  { id: "ui", label: "UI Customization", icon: <Palette size={16} />, page: () => <UiCustomization />, keywords: "theme dark light midnight contrast toast notification location toolbar labels date time format locale avatars hover highlight branch visibility columns author sha description" },
  { id: "signing", label: "Commit Signing", icon: <PenLine size={16} />, page: () => <Signing />, keywords: "gpg sign signing key format program ssh x509 generate commits tags" },
  { id: "editor", label: "Editor", icon: <Code2 size={16} />, page: () => <EditorPrefs />, keywords: "font size tab end of line eol crlf lf syntax highlighting line numbers word wrap monospace" },
  { id: "terminal", label: "In-App Terminal", icon: <SquareTerminal size={16} />, page: () => <TerminalPrefs />, keywords: "terminal font size line height cursor dim shell powershell bash cmd wsl" },
  { id: "repo-encoding", label: "Encoding", icon: <FileType2 size={16} />, repo: true, page: () => <Encoding />, keywords: "encoding utf-8 utf-16 windows-1252 latin" },
  { id: "repo-gitflow", label: "Gitflow", icon: <GitMerge size={16} />, repo: true, page: () => <Gitflow />, keywords: "gitflow develop feature release hotfix prefix version tag" },
  { id: "repo-hooks", label: "Git Hooks", icon: <Webhook size={16} />, repo: true, page: () => <Hooks />, keywords: "hooks hookspath skip no-verify" },
  { id: "repo-commit", label: "Commit", icon: <GitCommitHorizontal size={16} />, repo: true, page: () => <CommitPrefs />, keywords: "push after commit skip hooks squash merge template summary description comments" },
  { id: "repo-conflicts", label: "Conflict Prevention", icon: <ShieldAlert size={16} />, repo: true, page: () => <ConflictPrevention />, keywords: "conflict detection base branches patterns" },
  { id: "repo-lfs", label: "LFS", icon: <HardDrive size={16} />, repo: true, page: () => <Lfs />, keywords: "lfs large file storage track untrack" },
  { id: "repo-sparse", label: "Sparse Checkout", icon: <ScanLine size={16} />, repo: true, page: () => <SparseCheckout />, keywords: "sparse checkout paths include" },
  { id: "repo-issues", label: "Issue Tracker", icon: <CircleDot size={16} />, repo: true, page: () => <IssueTracker />, keywords: "issue tracker github gitlab default" },
];

function SavedFlash() {
  const at = useSaved((s) => s.at);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!at) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), 1400);
    return () => clearTimeout(t);
  }, [at]);
  return show ? <div className="saved chip ok"><CheckCircle2 size={12} /> Saved</div> : null;
}

export default function PreferencesView() {
  const section = useStore((s) => s.prefsSection);
  const active = useStore((s) => s.active);
  const { set } = useStore.getState();
  const [q, setQ] = useState("");
  const repo = active && active !== NEW_TAB ? active : null;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = SECTIONS.filter((s) => (!s.repo || repo) && words.every((w) => `${s.label} ${s.keywords}`.toLowerCase().includes(w)));
  const current = SECTIONS.find((s) => s.id === section && (!s.repo || repo)) ?? SECTIONS[0];
  useEffect(() => {
    if (q && visible.length && !visible.includes(current)) set({ prefsSection: visible[0].id });
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const nav = (s: Section) => (
    <div key={s.id} className={`nav-item${s.id === current.id ? " on" : ""}`} onClick={() => set({ prefsSection: s.id })} title={s.label}>
      {s.icon}
      <span>{s.label}</span>
    </div>
  );
  return (
    <div className="prefs">
      <nav className="prefs-nav">
        <button className="exit" onClick={() => set({ view: "repo" })}>
          <ArrowLeft size={16} /> <span>Exit Preferences</span>
        </button>
        <div className="filter-box nav-search">
          <Search size={13} />
          <input placeholder="Search settings" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <div className="prefs-nav-scroll">
          <div className="grp">Preferences</div>
          {visible.filter((s) => !s.repo).map(nav)}
          {repo && (
            <>
              <div className="grp">
                <FolderGit2 size={12} /> <span className="repo-name">Repo: {repo.split("/").pop()}</span>
              </div>
              {visible.filter((s) => s.repo).map(nav)}
            </>
          )}
          {!repo && <div className="hint-box">Open a repository to edit its repo-specific preferences.</div>}
          {!visible.length && <div className="empty small">No settings match “{q}”</div>}
        </div>
      </nav>
      <div className="prefs-body">
        <SearchCtx.Provider value={q}>{current.page()}</SearchCtx.Provider>
      </div>
      <SavedFlash />
    </div>
  );
}
