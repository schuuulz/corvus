import { useState } from "react";
import { Ban, CheckCircle2, ExternalLink, Globe, KeyRound, Plug, Server, Trash2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { ext, Integration, IntegrationKind } from "../api";
import { openExternal } from "../actions";
import { useG, useStore } from "../store";
import { Page, Setting } from "./controls";

interface Provider { kind: IntegrationKind; name: string; selfHosted: boolean; tokenUrl: (host: string) => string; scopes: string; icon: React.ReactNode }

const PROVIDERS: Provider[] = [
  { kind: "github", name: "GitHub", selfHosted: false, tokenUrl: () => "https://github.com/settings/tokens/new?scopes=repo,read:user,admin:public_key&description=kraken-craft", scopes: "repo, read:user, admin:public_key", icon: <Globe size={15} /> },
  { kind: "github-enterprise", name: "GitHub Enterprise Server", selfHosted: true, tokenUrl: (h) => `https://${h}/settings/tokens/new?scopes=repo,read:user,admin:public_key&description=kraken-craft`, scopes: "repo, read:user, admin:public_key", icon: <Server size={15} /> },
  { kind: "gitlab", name: "GitLab", selfHosted: false, tokenUrl: () => "https://gitlab.com/-/user_settings/personal_access_tokens?name=kraken-craft&scopes=api,read_user,write_repository", scopes: "api, read_user, write_repository", icon: <Globe size={15} /> },
  { kind: "gitlab-self", name: "GitLab Self-Managed", selfHosted: true, tokenUrl: (h) => `https://${h}/-/user_settings/personal_access_tokens?name=kraken-craft&scopes=api,read_user,write_repository`, scopes: "api, read_user, write_repository", icon: <Server size={15} /> },
];

function SshBlock({ i, provider }: { i: Integration; provider: Provider }) {
  const pub = useG("sshPublicKey");
  const { toast, setG } = useStore.getState();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const generateAndUpload = async () => {
    setBusy(true);
    try {
      const email = (await ext.configGet(null, "user.email").catch(() => "")) || "kraken-craft";
      const kp = await ext.sshGenerate(null, email, "");
      await setG("sshPrivateKey", kp.privateKey);
      await setG("sshPublicKey", kp.publicKey);
      await setG("sshUseAgent", false);
      await ext.addSshKey(i.kind, i.host, title || `kraken-craft ${new Date().toISOString().slice(0, 10)}`, kp.publicKey);
      toast(`SSH key generated and added to ${provider.name}`, "success");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const uploadExisting = async () => {
    try {
      await ext.addSshKey(i.kind, i.host, title || "kraken-craft", pub);
      toast(`Public key added to ${provider.name}`, "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };
  const browse = async (which: "sshPrivateKey" | "sshPublicKey") => {
    const f = await open({ title: which === "sshPrivateKey" ? "Private SSH key" : "Public SSH key" });
    if (typeof f === "string") {
      await setG(which, f.replace(/\\/g, "/"));
      await setG("sshUseAgent", false);
    }
  };
  return (
    <>
      <h2>SSH key</h2>
      <Setting label="Current key" help={pub ? pub : "No SSH key configured in kraken-craft. Generate one below or browse for an existing pair."}>
        {pub && <div><button className="small" onClick={uploadExisting}>Add this public key to {provider.name}</button></div>}
      </Setting>
      <Setting label="Generate SSH key">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="(optional) Enter a title for your new SSH key" style={{ maxWidth: 420 }} />
        <div><button className="success" disabled={busy} onClick={generateAndUpload}><KeyRound size={14} /> Generate SSH key and add to {provider.name}</button></div>
      </Setting>
      <Setting label="Add existing SSH key">
        <div className="row-inline">
          <button onClick={() => browse("sshPrivateKey")}>Browse for <b>private</b> key</button>
          <button onClick={() => browse("sshPublicKey")}>Browse for <b>public</b> key</button>
        </div>
      </Setting>
    </>
  );
}

function ProviderPage({ provider }: { provider: Provider }) {
  const integrations = useG("integrations");
  const { setG, toast, ask } = useStore.getState();
  const connected = integrations.filter((i) => i.kind === provider.kind);
  const [host, setHost] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const showForm = !connected.length || provider.selfHosted || editing;

  const connect = async () => {
    setBusy(true);
    try {
      const h = provider.selfHosted ? host.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "") : provider.kind === "github" ? "github.com" : "gitlab.com";
      const acc = await ext.connect(provider.kind, h, token.trim());
      const id = `${provider.kind}|${h}`;
      const entry: Integration = { id, kind: provider.kind, host: h, username: acc.username, name: acc.name, avatar: acc.avatar };
      await setG("integrations", [...integrations.filter((i) => i.id !== id), entry]);
      setToken("");
      setHost("");
      setEditing(null);
      toast(`Connected to ${provider.name} as ${acc.username}`, "success");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (i: Integration) => {
    if (!(await ask({ title: `Disconnect ${provider.name}`, message: `Remove the token for ${i.username}@${i.host}?`, confirmLabel: "Disconnect", danger: true }))) return;
    await ext.disconnect(i.kind, i.host).catch(() => {});
    await setG("integrations", integrations.filter((x) => x.id !== i.id));
  };

  const tokenHost = provider.selfHosted ? host || "your-host" : "";
  return (
    <div className="grow">
      <h1 style={{ fontSize: 20, margin: "0 0 6px", display: "flex", gap: 8, alignItems: "center" }}>{provider.icon} {provider.name}</h1>
      {connected.map((i) => (
        <div key={i.id}>
          <div className="account-card">
            <span className="avatar lg" style={{ background: "var(--panel-2)" }}>
              {i.avatar ? <img src={i.avatar} alt="" /> : i.username.slice(0, 1).toUpperCase()}
            </span>
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{i.name || i.username}</div>
              <div className="muted small">{i.username} · {i.host}</div>
              <span className="status-ok"><CheckCircle2 size={12} /> Connected</span>
            </div>
            {provider.selfHosted && <button className="small" onClick={() => (setEditing(i.id), setHost(i.host))}>Edit</button>}
            <button className="small danger-outline" onClick={() => disconnect(i)}>{provider.selfHosted ? <><Trash2 size={13} /> Remove</> : "Disconnect"}</button>
          </div>
          <SshBlock i={i} provider={provider} />
        </div>
      ))}
      {!connected.length && (
        <div className="account-card">
          <span className="avatar lg" style={{ background: "var(--panel-2)" }}><Plug size={18} /></span>
          <div className="grow">
            <div style={{ fontWeight: 600 }}>Not connected</div>
            <span className="status-off"><Ban size={12} /> Connect with a personal access token</span>
          </div>
        </div>
      )}
      {showForm && (
        <>
          <h2>{connected.length && !editing ? "Add another server" : "Connect"}</h2>
          {provider.selfHosted && (
            <Setting label="Host domain">
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder={provider.kind === "gitlab-self" ? "e.g. gitlab.mycompany.com" : "e.g. github.mycompany.com"} style={{ maxWidth: 360 }} />
            </Setting>
          )}
          <Setting
            label="Personal access token"
            help={
              <>
                Needs scopes: <code>{provider.scopes}</code>. Stored in your system keychain.{" "}
                {(!provider.selfHosted || host) && (
                  <span className="link-text" onClick={() => openExternal(provider.tokenUrl(tokenHost))}>
                    Create a token <ExternalLink size={11} />
                  </span>
                )}
              </>
            }
          >
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste token" style={{ maxWidth: 360 }} onKeyDown={(e) => e.key === "Enter" && token && connect()} />
          </Setting>
          <Setting label="">
            <div className="row-inline">
              <button className="success" disabled={busy || !token.trim() || (provider.selfHosted && !host.trim())} onClick={connect}>
                {busy ? "Connecting…" : `Connect to ${provider.name}`}
              </button>
              {editing && <button onClick={() => setEditing(null)}>Cancel</button>}
            </div>
          </Setting>
        </>
      )}
    </div>
  );
}

export default function Integrations() {
  const [sel, setSel] = useState<IntegrationKind>("github");
  const integrations = useG("integrations");
  const provider = PROVIDERS.find((p) => p.kind === sel)!;
  return (
    <Page title="Integrations" icon={<Plug size={20} />} lead="Connect hosting accounts to list pull requests and issues, create pull requests, upload SSH keys, and push over HTTPS without prompts.">
      <div className="provider-layout">
        <div className="provider-nav">
          {PROVIDERS.map((p) => {
            const n = integrations.filter((i) => i.kind === p.kind).length;
            return (
              <div key={p.kind} className={`nav-item${p.kind === sel ? " on" : ""}`} onClick={() => setSel(p.kind)}>
                {p.icon}
                <span>{p.name}</span>
                {n > 0 && <span className="hits chip ok">{n}</span>}
              </div>
            );
          })}
        </div>
        <ProviderPage key={sel} provider={provider} />
      </div>
    </Page>
  );
}
