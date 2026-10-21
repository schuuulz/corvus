import { BookOpen, FolderOpen, GitBranchPlus, Keyboard, Plug, Plus, Settings, CloudDownload, X } from "lucide-react";
import * as A from "../actions";
import { useG, useStore } from "../store";
import Logo from "./Logo";

export default function NewTab() {
  const recent = useG("recent");
  const integrations = useG("integrations");
  const { openRepo, set, openPrefs, setG } = useStore.getState();
  return (
    <div className="newtab">
      <div className="newtab-inner">
        <div>
          <h1>
            <Logo size={40} /> kraken-craft
          </h1>
          <p className="muted">Open, clone or create a repository to get started.</p>
          <div className="big-actions">
            <button className="big-action" onClick={A.openRepoDialog}>
              <FolderOpen size={22} />
              <b>Open</b>
              <span>A repository on this computer</span>
            </button>
            <button className="big-action" onClick={() => set({ modal: "clone" })}>
              <CloudDownload size={22} />
              <b>Clone</b>
              <span>From GitHub, GitLab or any URL</span>
            </button>
            <button className="big-action" onClick={A.initRepoDialog}>
              <GitBranchPlus size={22} />
              <b>Create</b>
              <span>Initialise a new repository</span>
            </button>
          </div>
          <h2>Recent</h2>
          {recent.length ? (
            <div className="recent-list">
              {recent.map((r) => (
                <div key={r} className="recent-item" onClick={() => openRepo(r)} title={r}>
                  <span className="nm">{r.split("/").pop()}</span>
                  <span className="pth">{r}</span>
                  <button
                    className="icon"
                    title="Remove from list"
                    onClick={(e) => {
                      e.stopPropagation();
                      void setG("recent", recent.filter((x) => x !== r));
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty card">
              <Plus size={24} />
              Repositories you open will show up here.
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 54 }}>
          <div className="card">
            <h3><Plug size={15} /> Integrations</h3>
            <p>
              {integrations.length
                ? `Connected: ${integrations.map((i) => `${i.username}@${i.host}`).join(", ")}`
                : "Connect GitHub or GitLab to browse pull requests and issues, and push over HTTPS without prompts."}
            </p>
            <button className="primary" onClick={() => openPrefs("integrations")}>
              {integrations.length ? "Manage integrations" : "Connect integrations"}
            </button>
          </div>
          <div className="card">
            <h3><BookOpen size={15} /> Get going</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="link" onClick={() => set({ modal: "shortcuts" })}><Keyboard size={14} /> Keyboard shortcuts</button>
              <button className="link" onClick={() => openPrefs("general")}><Settings size={14} /> Preferences</button>
              <button className="link" onClick={() => set({ modal: "palette" })}><Keyboard size={14} /> Command palette <kbd>Ctrl</kbd>+<kbd>P</kbd></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
