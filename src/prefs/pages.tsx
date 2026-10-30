import { useEffect, useState } from "react";
import { Bell, Code2, Copy, KeyRound, Palette, PenLine, Settings, Shield, SquareTerminal, Wrench } from "lucide-react";
import { ExternalTool, ext, GpgKey, Shell } from "../api";
import { formatDate, LOCALES } from "../format";
import { THEMES } from "../settings";
import { useG, useStore } from "../store";
import { GitSelect, GitText, GitToggle, NumberInput, Page, PathInput, Select, Setting, TextInput, Toggle, useGitConfig, useSaved } from "./controls";

export function General() {
  const { toast, setG } = useStore.getState();
  const integrations = useG("integrations");
  const forget = async () => {
    const ok = await useStore.getState().ask({
      title: "Forget all saved credentials",
      message: "Disconnects every integration and removes their tokens from the system keychain.",
      confirmLabel: "Forget all",
      danger: true,
    });
    if (!ok) return;
    for (const i of integrations) await ext.disconnect(i.kind, i.host).catch(() => {});
    await setG("integrations", []);
    toast("All saved credentials removed", "success");
  };
  return (
    <Page title="General" icon={<Settings size={20} />}>
      <h2>Identity</h2>
      <GitText gitKey="user.name" label="Author name" placeholder="Ada Lovelace" />
      <GitText gitKey="user.email" label="Author email" placeholder="ada@example.com" />
      <h2>Syncing</h2>
      <NumberInput k="autoFetchMinutes" label="Auto-fetch interval" min={0} max={60} help="In minutes, between 0 and 60 (0 disables auto-fetch). Fetches all remotes of the open repository." warn="With many remotes this can impact performance." />
      <Toggle k="autoPrune" label="Auto-prune" help="Remove remote-tracking branches that no longer exist on the remote when fetching." />
      <Toggle k="updateSubmodules" label="Keep submodules up to date" inline="Automatically update all submodules after checkout and pull" />
      <Toggle k="conflictDetection" label="Proactive conflict detection" help="Predict conflicts between your branch and its likely base branch. You can disable it per repository in Repo-Specific Preferences." />
      <h2>Repositories</h2>
      <GitText gitKey="init.defaultBranch" label="Default branch name" placeholder="main" help="Sets the default branch name when initialising new repositories." />
      <Toggle k="deleteOrig" label={'Delete ".orig" files after merging'} />
      <Toggle k="rememberTabs" label="Remember tabs" help="Reopen the repositories that were open when you last closed Corvus." />
      <h2>Graph</h2>
      <Toggle k="showAllCommits" label="Show all commits in graph" warn="Enabling this option may affect performance on very large repositories." />
      <NumberInput k="initialCommits" label="Initial commits in graph" min={500} max={100000} step={500} help="Minimum 500. With lazy loading on, more commits load as you scroll to the end of the graph." />
      <Toggle k="lazyLoad" label="Lazy load commits in graph" />
      <h2>Git</h2>
      <PathInput k="gitPath" label="Path to git executable" placeholder="git (from PATH)" help="Leave empty to use git from your PATH. Point this at a specific git.exe to use another installation." />
      <GitToggle gitKey="core.longpaths" label="Long paths" help="Windows only supports paths shorter than 260 characters by default. Enable support for longer file paths." />
      <GitToggle gitKey="core.autocrlf" label="AutoCRLF" help="Convert line endings to CRLF on checkout and LF on commit." />
      <Toggle k="extendedLog" label="Extended activity logging" help="Keep the full output of every git command in the activity log." />
      <Setting label="Forget all saved credentials" help="Removes integration tokens stored in the system keychain.">
        <div><button className="danger-outline" onClick={forget}>Forget all</button></div>
      </Setting>
    </Page>
  );
}

function TrunkList() {
  const pin = useG("pinTrunk");
  const list = useG("trunkBranches");
  const { setG } = useStore.getState();
  const flash = useSaved((s) => s.flash);
  const [draft, setDraft] = useState(list.join("\n"));
  useEffect(() => setDraft(list.join("\n")), [list]);
  const commit = () => {
    const next = draft.split("\n").map((s) => s.trim()).filter(Boolean);
    if (next.join("\n") === list.join("\n")) return;
    void setG("trunkBranches", next);
    flash();
  };
  if (!pin) return null;
  return (
    <Setting label="Main branches" help="One per line, in priority order (leftmost column first). A remote branch is used when there is no local one.">
      <textarea rows={4} style={{ maxWidth: 320 }} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} placeholder={"main\ndevelop"} />
    </Setting>
  );
}

function DateRow({ k, label }: { k: "dateFormat" | "dateWordFormat" | "dateTimeFormat" | "dateVerboseFormat"; label: string }) {
  const locale = useG("dateLocale");
  const now = Date.now() / 1000;
  return <TextInput k={k} label={label} preview={(v) => formatDate(now, v, locale)} />;
}

export function UiCustomization() {
  return (
    <Page title="UI Customization" icon={<Palette size={20} />}>
      <Select k="language" label="Language" help="Language of feedback messages. More of the interface will follow." options={[["system", "System"], ["en", "English"], ["pt-BR", "Português (Brasil)"]]} />
      <Select k="theme" label="Theme" options={THEMES.map((t) => [t.id, t.name] as const)} />
      <Select k="toastPosition" label="Notification location" options={[["bottom-right", "Bottom right"], ["bottom-left", "Bottom left"], ["top-right", "Top right"], ["top-left", "Top left"]]} />
      <Toggle k="toolbarLabels" label="Show toolbar icon labels" />
      <h2>Date / Time</h2>
      <p className="muted small">Formats use tokens like <code>DD</code>, <code>MMMM</code>, <code>YYYY</code>, <code>HH:mm</code>; wrap literal text in [brackets].</p>
      <Select k="dateLocale" label="Date/time locale" options={LOCALES} />
      <Select k="dateStyle" label="Graph dates" options={[["absolute", "Absolute (use the format below)"], ["relative", "Relative (\"3 hours ago\")"]]} />
      <DateRow k="dateFormat" label="Date format" />
      <DateRow k="dateWordFormat" label="Date word format" />
      <DateRow k="dateTimeFormat" label="Date/time format" />
      <DateRow k="dateVerboseFormat" label="Date verbose format" />
      <h2>Graph</h2>
      <Toggle k="useAvatars" label="Show avatars" help="Load Gravatar images for commit authors. When off, author initials are shown instead." />
      <Toggle k="hoverHighlight" label="Highlight associated rows when hovering over a branch" />
      <Select k="graphLineStyle" label="Line style" options={[["angular", "Right angles (rounded)"], ["curved", "Curves"]]} />
      <Toggle k="pinTrunk" label="Keep main branches in fixed columns" help="Main branches get their own columns on the left; feature branches get columns to the right and curve into the branch they came from." />
      <TrunkList />
      <Select k="branchVisibility" label="Branch visibility in commit graph" options={[["all", "All branches"], ["local", "Local branches only"], ["current", "Current branch only"]]} />
      <Toggle k="colRefs" label="Show branches and tags in graph" />
      <Toggle k="colGraph" label="Show commit tree in graph" />
      <Toggle k="colMessage" label="Show commit message in graph" />
      <Select k="showDescription" label="Show commit description in graph" options={[["always", "Always"], ["hover", "On hover"], ["never", "Never"]]} />
      <Toggle k="colAuthor" label="Show commit author in graph" />
      <Toggle k="colDate" label="Show commit date/time in graph" />
      <Toggle k="colSha" label="Show commit SHA in graph" />
    </Page>
  );
}

const MONO_FONTS = ["Geist Mono", "Cascadia Code", "Cascadia Mono", "Consolas", "JetBrains Mono", "Fira Code", "Source Code Pro", "Hack", "IBM Plex Mono", "Roboto Mono", "Ubuntu Mono", "Courier New", "Lucida Console"];
const PROP_FONTS = ["Segoe UI", "Arial", "Calibri", "Inter", "Verdana", "Georgia"];

function FontSelect({ k, monoKey, label, help }: { k: "editorFont" | "termFont"; monoKey?: "editorMonoOnly"; label: string; help?: string }) {
  const value = useG(k);
  const monoOnly = useG("editorMonoOnly");
  const { setG } = useStore.getState();
  const flash = useSaved((s) => s.flash);
  const fonts = monoKey && !monoOnly ? [...MONO_FONTS, ...PROP_FONTS] : MONO_FONTS;
  const list = fonts.includes(value) ? fonts : [value, ...fonts];
  return (
    <Setting label={label} help={help}>
      <select value={value} style={{ maxWidth: 320, fontFamily: `"${value}"` }} onChange={(e) => (setG(k, e.target.value), flash())}>
        {list.map((f) => <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>{f}</option>)}
      </select>
      {monoKey && (
        <label className="check small">
          <input type="checkbox" checked={monoOnly} onChange={(e) => (setG("editorMonoOnly", e.target.checked), flash())} /> Show only monospace fonts
        </label>
      )}
    </Setting>
  );
}

export function EditorPrefs() {
  return (
    <Page title="Editor" icon={<Code2 size={20} />} lead="Applies to the diff viewer, file editor and merge editor.">
      <FontSelect k="editorFont" monoKey="editorMonoOnly" label="Font" />
      <NumberInput k="editorFontSize" label="Font size" min={8} max={32} />
      <NumberInput k="editorTabSize" label="Tab size" min={1} max={16} />
      <Select k="editorEol" label="End of line character" help="Used when saving files edited in Corvus." options={[["auto", "Keep as is"], ["LF", "LF"], ["CRLF", "CRLF"]]} />
      <Toggle k="editorSyntax" label="Syntax highlighting" />
      <Toggle k="editorLineNumbers" label="Show line numbers" />
      <Toggle k="editorWordWrap" label="Word wrap" />
    </Page>
  );
}

export function TerminalPrefs() {
  const [shells, setShells] = useState<Shell[]>([]);
  useEffect(() => {
    ext.termShells().then(setShells, () => {});
  }, []);
  return (
    <Page title="In-App Terminal" icon={<SquareTerminal size={20} />} lead="Open the terminal with the toolbar button or Ctrl+`.">
      <FontSelect k="termFont" label="Font" />
      <NumberInput k="termFontSize" label="Font size" min={8} max={32} />
      <NumberInput k="termLineHeight" label="Line height" min={1} max={2} step={0.1} />
      <Select k="termCursor" label="Cursor style" options={[["bar", "Bar"], ["block", "Block"], ["underline", "Underline"]]} />
      <Toggle k="termDim" label="Dim terminal when unfocused" />
      <Select k="termShell" label="Default shell" help="Applies to new terminal tabs." options={shells.map((s) => [s.id, s.name] as const)} />
    </Page>
  );
}

export function Notifications() {
  return (
    <Page title="Notifications" icon={<Bell size={20} />}>
      <Toggle k="desktopNotifications" label="Enable desktop notifications" help="Notify when long operations finish (pull, push, clone) or auto-fetch brings in new commits while Corvus is in the background." />
    </Page>
  );
}

export function ExternalTools() {
  const [tools, setTools] = useState<ExternalTool[] | null>(null);
  useEffect(() => {
    ext.detectTools().then(setTools, () => setTools([]));
  }, []);
  const of = (kind: ExternalTool["kind"]) => (tools ?? []).filter((t) => t.kind === kind).map((t) => [t.id, t.name] as const);
  const detected = tools === null ? "Detecting installed tools…" : `${tools.length} tool${tools.length === 1 ? "" : "s"} detected on this computer.`;
  return (
    <Page title="External Tools" icon={<Wrench size={20} />} lead={detected}>
      <h2>Merge tool</h2>
      <Select k="mergeTool" label="External merge tool" help="Used by “Open in external merge tool” on conflicted files." options={[["default", "Git config default"], ...of("merge")]} />
      <h2>Diff tool</h2>
      <Select k="diffTool" label="External diff tool" options={[["merge", "<Use merge tool>"], ...of("merge")]} />
      <h2>Editor</h2>
      <Select k="editorTool" label="External editor" help="Used by “Open in external editor”." options={[["", "<None>"], ...of("editor")]} />
      <h2>Terminal</h2>
      <Select k="terminalTool" label="External terminal" help="Used by “Open external terminal” from the repository menu." options={[["", "<None>"], ...of("terminal")]} />
    </Page>
  );
}

export function Ssh() {
  const useAgent = useG("sshUseAgent");
  const pub = useG("sshPublicKey");
  const { setG, toast, ask } = useStore.getState();
  const [helper, setHelper] = useGitConfig("credential.helper", null);
  const generate = async () => {
    const v = await ask({
      title: "Generate SSH key",
      message: "Creates an ed25519 key pair and configures Corvus to use it.",
      fields: [
        { name: "path", label: "Private key path", placeholder: "~/.ssh/corvus_ed25519 (default)" },
        { name: "comment", label: "Comment", value: (await ext.configGet(null, "user.email").catch(() => "")) || "Corvus" },
        { name: "pass", label: "Passphrase (optional)" },
      ],
      confirmLabel: "Generate",
    });
    if (!v) return;
    try {
      const kp = await ext.sshGenerate(v.path?.trim() || null, v.comment, v.pass ?? "");
      await setG("sshPrivateKey", kp.privateKey);
      await setG("sshPublicKey", kp.publicKey);
      await setG("sshUseAgent", false);
      toast(`Generated ${kp.privateKey}`, "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };
  const copyPub = async () => {
    try {
      await navigator.clipboard.writeText((await ext.readPublicKey(pub)).trim());
      toast("Public key copied", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };
  const gcm = helper === "manager" || helper === "manager-core";
  return (
    <Page title="SSH" icon={<Shield size={20} />}>
      <Toggle k="sshUseAgent" label="Use local SSH agent" help="Let ssh / ssh-agent pick keys as usual. Turn off to force a specific key below." />
      {!useAgent && (
        <>
          <PathInput k="sshPrivateKey" label="SSH private key" placeholder="~/.ssh/id_ed25519" />
          <PathInput
            k="sshPublicKey"
            label="SSH public key"
            placeholder="~/.ssh/id_ed25519.pub"
            extra={pub ? <button className="icon" title="Copy public key" onClick={copyPub}><Copy size={14} /></button> : undefined}
          />
        </>
      )}
      <Setting label="Generate new key pair" help="Creates new keys and configures Corvus to use them.">
        <div><button className="success" onClick={generate}><KeyRound size={14} /> Generate</button></div>
      </Setting>
      <h2>HTTPS</h2>
      <Setting label="Use Git Credential Manager" help="Use the credential manager configured in Git for HTTPS remotes." tag="--global credential.helper">
        <label className="chk-line">
          <input type="checkbox" disabled={helper === null} checked={gcm} onChange={(e) => setHelper(e.target.checked ? "manager" : "")} />
        </label>
      </Setting>
    </Page>
  );
}

export function Signing() {
  const [program] = useGitConfig("gpg.program", null);
  const [format] = useGitConfig("gpg.format", null);
  const [key, setKey] = useGitConfig("user.signingkey", null);
  const [keys, setKeys] = useState<GpgKey[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { toast, ask } = useStore.getState();
  const prog = program || "gpg";
  const load = () => {
    setErr(null);
    ext.gpgList(prog).then(setKeys, (e) => (setKeys([]), setErr(String(e))));
  };
  useEffect(() => {
    if (program !== null && format !== "ssh") load();
  }, [program, format]); // eslint-disable-line react-hooks/exhaustive-deps
  const generate = async () => {
    const name = await ext.configGet(null, "user.name").catch(() => "");
    const email = await ext.configGet(null, "user.email").catch(() => "");
    if (!name || !email) return toast("Set your author name and email in General first", "error");
    const v = await ask({ title: "Generate GPG key", message: `Creates a 4096-bit key for ${name} <${email}> that expires in 2 years and sets it as your signing key.`, fields: [{ name: "pass", label: "Passphrase (optional)" }], confirmLabel: "Generate" });
    if (!v) return;
    try {
      await ext.gpgGenerate(prog, name, email, v.pass ?? "");
      const list = await ext.gpgList(prog);
      setKeys(list);
      const newest = list[list.length - 1];
      if (newest) await setKey(newest.id);
      toast("GPG key generated", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };
  const ssh = format === "ssh";
  return (
    <Page title="Commit Signing" icon={<PenLine size={20} />}>
      <GitSelect gitKey="gpg.format" label="Signing format" options={[["", "OpenPGP (default)"], ["openpgp", "OpenPGP"], ["ssh", "SSH"], ["x509", "X.509"]]} />
      {!ssh && <GitText gitKey="gpg.program" label="GPG program" browse="file" placeholder="gpg" help={'Usually "gpg" or "gpg2". You can also browse for the path directly.'} />}
      {ssh ? (
        <GitText gitKey="user.signingkey" label="Signing key" browse="file" placeholder="~/.ssh/id_ed25519.pub" help="Path to the public SSH key used for signing." />
      ) : (
        <Setting label="Signing key" help={err ? <span className="error-text">{err}</span> : "Secret keys from your GPG keyring."} tag="--global user.signingkey">
          <div className="row-inline">
            <select value={key ?? ""} onChange={(e) => setKey(e.target.value)} style={{ maxWidth: 420 }}>
              <option value="">&lt;None&gt;</option>
              {key && !keys?.some((k) => k.id === key) && <option value={key}>{key}</option>}
              {keys?.map((k) => (
                <option key={k.id} value={k.id}>{k.id} — {k.uid}{k.expires ? ` (expires ${new Date(k.expires * 1000).toLocaleDateString()})` : ""}</option>
              ))}
            </select>
            <button className="small" onClick={load}>Refresh</button>
          </div>
        </Setting>
      )}
      {!ssh && (
        <Setting label="Generate new GPG key" help="Uses the name and email from General › Identity.">
          <div><button className="success" onClick={generate}>Generate</button></div>
        </Setting>
      )}
      <GitToggle gitKey="commit.gpgsign" label="Sign commits by default" />
      <GitToggle gitKey="tag.gpgsign" label="Sign tags by default" />
    </Page>
  );
}

