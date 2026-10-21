//! GitHub / GitHub Enterprise / GitLab / GitLab Self-Managed via personal
//! access tokens. Tokens live in the OS keychain under `<kind>|<host>`.

use crate::git::{msg, Error, Result};
use crate::system;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Github,
    GithubEnterprise,
    Gitlab,
    GitlabSelf,
}

impl Kind {
    fn is_github(self) -> bool {
        matches!(self, Kind::Github | Kind::GithubEnterprise)
    }
    fn slug(self) -> &'static str {
        match self {
            Kind::Github => "github",
            Kind::GithubEnterprise => "github-enterprise",
            Kind::Gitlab => "gitlab",
            Kind::GitlabSelf => "gitlab-self",
        }
    }
}

pub fn default_host(kind: Kind, host: &str) -> String {
    match kind {
        Kind::Github => "github.com".into(),
        Kind::Gitlab => "gitlab.com".into(),
        _ => host.trim().trim_start_matches("https://").trim_start_matches("http://").trim_end_matches('/').to_string(),
    }
}

fn api_base(kind: Kind, host: &str) -> String {
    match kind {
        Kind::Github => "https://api.github.com".into(),
        Kind::GithubEnterprise => format!("https://{host}/api/v3"),
        Kind::Gitlab | Kind::GitlabSelf => format!("https://{host}/api/v4"),
    }
}

pub fn secret_key(kind: Kind, host: &str) -> String {
    format!("{}|{}", kind.slug(), host)
}

/// Username git should present with the token for HTTPS remotes.
pub fn git_username(kind: Kind) -> &'static str {
    if kind.is_github() { "x-access-token" } else { "oauth2" }
}

struct Client {
    kind: Kind,
    base: String,
    token: String,
    http: reqwest::Client,
}

fn err(e: reqwest::Error) -> Error {
    Error::Msg(e.to_string())
}

impl Client {
    fn new(kind: Kind, host: &str, token: Option<String>) -> Result<Self> {
        let token = match token {
            Some(t) => t,
            None => system::secret_get(&secret_key(kind, host)).ok_or_else(|| Error::Msg("integration is not connected".into()))?,
        };
        let http = reqwest::Client::builder()
            .user_agent("kraken-craft")
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(err)?;
        Ok(Client { kind, base: api_base(kind, host), token, http })
    }

    fn req(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let r = self.http.request(method, format!("{}{}", self.base, path));
        if self.kind.is_github() {
            r.bearer_auth(&self.token).header("Accept", "application/vnd.github+json")
        } else {
            r.header("PRIVATE-TOKEN", &self.token)
        }
    }

    async fn send(&self, r: reqwest::RequestBuilder) -> Result<Value> {
        let res = r.send().await.map_err(err)?;
        let status = res.status();
        let body: Value = res.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            let m = body.get("message").or_else(|| body.get("error")).map(|m| m.to_string()).unwrap_or_default();
            return msg(format!("{} {}: {}", status.as_u16(), status.canonical_reason().unwrap_or(""), m.trim_matches('"')));
        }
        Ok(body)
    }

    async fn get(&self, path: &str) -> Result<Value> {
        self.send(self.req(reqwest::Method::GET, path)).await
    }

    async fn post(&self, path: &str, body: Value) -> Result<Value> {
        self.send(self.req(reqwest::Method::POST, path).json(&body)).await
    }
}

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn project(path: &str) -> String {
    path.replace('/', "%2F")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub username: String,
    pub name: String,
    pub avatar: String,
}

/// Validates the token, stores it in the keychain and returns the account.
pub async fn connect(kind: Kind, host: &str, token: &str) -> Result<Account> {
    let host = default_host(kind, host);
    let c = Client::new(kind, &host, Some(token.trim().to_string()))?;
    let u = c.get("/user").await?;
    let account = Account {
        username: if kind.is_github() { s(&u, "login") } else { s(&u, "username") },
        name: s(&u, "name"),
        avatar: s(&u, "avatar_url"),
    };
    system::secret_set(&secret_key(kind, &host), token.trim())?;
    Ok(account)
}

pub fn disconnect(kind: Kind, host: &str) -> Result<()> {
    system::secret_delete(&secret_key(kind, &default_host(kind, host)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub author: String,
    pub source: String,
    pub target: String,
    pub draft: bool,
    pub updated: String,
}

pub async fn pull_requests(kind: Kind, host: &str, repo: &str) -> Result<Vec<PullRequest>> {
    let c = Client::new(kind, &default_host(kind, host), None)?;
    let list = if kind.is_github() {
        c.get(&format!("/repos/{repo}/pulls?state=open&per_page=50")).await?
    } else {
        c.get(&format!("/projects/{}/merge_requests?state=opened&per_page=50", project(repo))).await?
    };
    Ok(list
        .as_array()
        .map(|a| {
            a.iter()
                .map(|p| {
                    if kind.is_github() {
                        PullRequest {
                            number: p["number"].as_u64().unwrap_or(0),
                            title: s(p, "title"),
                            url: s(p, "html_url"),
                            author: s(&p["user"], "login"),
                            source: s(&p["head"], "ref"),
                            target: s(&p["base"], "ref"),
                            draft: p["draft"].as_bool().unwrap_or(false),
                            updated: s(p, "updated_at"),
                        }
                    } else {
                        PullRequest {
                            number: p["iid"].as_u64().unwrap_or(0),
                            title: s(p, "title"),
                            url: s(p, "web_url"),
                            author: s(&p["author"], "username"),
                            source: s(p, "source_branch"),
                            target: s(p, "target_branch"),
                            draft: p["draft"].as_bool().unwrap_or(false),
                            updated: s(p, "updated_at"),
                        }
                    }
                })
                .collect()
        })
        .unwrap_or_default())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub author: String,
    pub labels: Vec<String>,
}

pub async fn issues(kind: Kind, host: &str, repo: &str) -> Result<Vec<Issue>> {
    let c = Client::new(kind, &default_host(kind, host), None)?;
    let list = if kind.is_github() {
        c.get(&format!("/repos/{repo}/issues?state=open&per_page=50")).await?
    } else {
        c.get(&format!("/projects/{}/issues?state=opened&per_page=50", project(repo))).await?
    };
    Ok(list
        .as_array()
        .map(|a| {
            a.iter()
                // GitHub lists pull requests as issues too.
                .filter(|i| i.get("pull_request").is_none())
                .map(|i| Issue {
                    number: i[if kind.is_github() { "number" } else { "iid" }].as_u64().unwrap_or(0),
                    title: s(i, "title"),
                    url: s(i, if kind.is_github() { "html_url" } else { "web_url" }),
                    author: if kind.is_github() { s(&i["user"], "login") } else { s(&i["author"], "username") },
                    labels: i["labels"]
                        .as_array()
                        .map(|l| l.iter().map(|x| x.as_str().map(String::from).unwrap_or_else(|| s(x, "name"))).collect())
                        .unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default())
}

pub async fn create_pull_request(kind: Kind, host: &str, repo: &str, source: &str, target: &str, title: &str, body: &str) -> Result<String> {
    let c = Client::new(kind, &default_host(kind, host), None)?;
    let r = if kind.is_github() {
        c.post(&format!("/repos/{repo}/pulls"), json!({ "title": title, "head": source, "base": target, "body": body })).await?
    } else {
        c.post(
            &format!("/projects/{}/merge_requests", project(repo)),
            json!({ "title": title, "source_branch": source, "target_branch": target, "description": body }),
        )
        .await?
    };
    Ok(s(&r, if kind.is_github() { "html_url" } else { "web_url" }))
}

pub async fn add_ssh_key(kind: Kind, host: &str, title: &str, public_key: &str) -> Result<()> {
    let c = Client::new(kind, &default_host(kind, host), None)?;
    c.post("/user/keys", json!({ "title": title, "key": public_key.trim() })).await.map(|_| ())
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRef {
    pub host: String,
    /// owner/repo (GitLab may include subgroups)
    pub path: String,
}

/// Parses https, scp-style and ssh:// remote URLs.
pub fn parse_remote(url: &str) -> Option<RemoteRef> {
    let url = url.trim();
    let (host, path) = if let Some(rest) = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")) {
        let rest = rest.rsplit_once('@').map(|(_, r)| r).unwrap_or(rest);
        rest.split_once('/')?
    } else if let Some(rest) = url.strip_prefix("ssh://") {
        let rest = rest.split_once('@').map(|(_, r)| r).unwrap_or(rest);
        let (h, p) = rest.split_once('/')?;
        (h.split(':').next()?, p)
    } else {
        let rest = url.split_once('@').map(|(_, r)| r).unwrap_or(url);
        rest.split_once(':')?
    };
    let path = path.trim_end_matches('/').trim_end_matches(".git").to_string();
    (!host.is_empty() && path.contains('/')).then(|| RemoteRef { host: host.to_lowercase(), path })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_remote_urls() {
        let want = Some(RemoteRef { host: "github.com".into(), path: "owner/repo".into() });
        assert_eq!(parse_remote("https://github.com/owner/repo.git"), want);
        assert_eq!(parse_remote("git@github.com:owner/repo.git"), want);
        assert_eq!(parse_remote("ssh://git@github.com:22/owner/repo"), want);
        assert_eq!(parse_remote("https://user@GitHub.com/owner/repo/"), want);
        assert_eq!(
            parse_remote("git@gitlab.example.com:group/sub/proj.git"),
            Some(RemoteRef { host: "gitlab.example.com".into(), path: "group/sub/proj".into() })
        );
        assert_eq!(parse_remote("/local/path"), None);
    }
}
