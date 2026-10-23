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
            .user_agent("corvus")
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

fn github_pr(p: &Value) -> PullRequest {
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
}

fn gitlab_pr(p: &Value) -> PullRequest {
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

fn to_pr(kind: Kind) -> fn(&Value) -> PullRequest {
    if kind.is_github() { github_pr } else { gitlab_pr }
}

pub async fn pull_requests(kind: Kind, host: &str, repo: &str) -> Result<Vec<PullRequest>> {
    let c = Client::new(kind, &default_host(kind, host), None)?;
    let list = if kind.is_github() {
        c.get(&format!("/repos/{repo}/pulls?state=open&per_page=50")).await?
    } else {
        c.get(&format!("/projects/{}/merge_requests?state=opened&per_page=50", project(repo))).await?
    };
    Ok(list.as_array().map(|a| a.iter().map(to_pr(kind)).collect()).unwrap_or_default())
}

/// What the connected account may do on a hosted repository.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepoAccess {
    /// Can push branches, and therefore open pull requests from them.
    pub can_push: bool,
    pub default_branch: String,
}

/// GitLab's Developer role: the lowest one allowed to push branches.
const GITLAB_DEVELOPER: u64 = 30;

fn github_access(repo: &Value) -> RepoAccess {
    RepoAccess {
        can_push: repo["permissions"]["push"].as_bool().unwrap_or(false),
        default_branch: s(repo, "default_branch"),
    }
}

/// The effective level is the higher of the project and the group membership.
fn gitlab_access(project: &Value) -> RepoAccess {
    let level = |scope: &str| project["permissions"][scope]["access_level"].as_u64().unwrap_or(0);
    RepoAccess {
        can_push: level("project_access").max(level("group_access")) >= GITLAB_DEVELOPER,
        default_branch: s(project, "default_branch"),
    }
}

pub async fn repo_access(kind: Kind, host: &str, repo: &str) -> Result<RepoAccess> {
    let c = Client::new(kind, &default_host(kind, host), None)?;
    if kind.is_github() {
        Ok(github_access(&c.get(&format!("/repos/{repo}")).await?))
    } else {
        Ok(gitlab_access(&c.get(&format!("/projects/{}", project(repo))).await?))
    }
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPullRequest {
    pub source: String,
    pub target: String,
    pub title: String,
    pub body: String,
    pub draft: bool,
}

/// GitLab has no draft flag on creation: a "Draft:" title prefix marks it.
fn gitlab_title(pr: &NewPullRequest) -> String {
    if pr.draft && !pr.title.starts_with("Draft:") { format!("Draft: {}", pr.title) } else { pr.title.clone() }
}

pub async fn create_pull_request(kind: Kind, host: &str, repo: &str, pr: &NewPullRequest) -> Result<PullRequest> {
    let c = Client::new(kind, &default_host(kind, host), None)?;
    let created = if kind.is_github() {
        c.post(
            &format!("/repos/{repo}/pulls"),
            json!({ "title": pr.title, "head": pr.source, "base": pr.target, "body": pr.body, "draft": pr.draft }),
        )
        .await?
    } else {
        c.post(
            &format!("/projects/{}/merge_requests", project(repo)),
            json!({ "title": gitlab_title(pr), "source_branch": pr.source, "target_branch": pr.target, "description": pr.body }),
        )
        .await?
    };
    Ok(to_pr(kind)(&created))
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

    #[test]
    fn reads_github_push_permission() {
        let repo = json!({ "default_branch": "main", "permissions": { "admin": false, "push": true, "pull": true } });
        assert_eq!(github_access(&repo), RepoAccess { can_push: true, default_branch: "main".into() });
        let read_only = json!({ "default_branch": "main", "permissions": { "push": false, "pull": true } });
        assert!(!github_access(&read_only).can_push);
        // Repos the account isn't a member of come back without permissions.
        assert!(!github_access(&json!({ "default_branch": "main" })).can_push);
    }

    #[test]
    fn reads_gitlab_access_level() {
        let access = |project: Value, group: Value| {
            gitlab_access(&json!({ "default_branch": "dev", "permissions": { "project_access": project, "group_access": group } }))
        };
        assert_eq!(access(json!({ "access_level": 30 }), Value::Null), RepoAccess { can_push: true, default_branch: "dev".into() });
        assert!(access(Value::Null, json!({ "access_level": 40 })).can_push, "group membership grants access");
        assert!(!access(json!({ "access_level": 20 }), Value::Null).can_push, "a Reporter cannot push");
        assert!(!access(Value::Null, Value::Null).can_push);
    }

    #[test]
    fn maps_pull_requests_from_both_providers() {
        let github = github_pr(&json!({
            "number": 7, "title": "Login", "html_url": "https://github.com/o/r/pull/7", "user": { "login": "ana" },
            "head": { "ref": "feat/login" }, "base": { "ref": "dev" }, "draft": true, "updated_at": "2026-10-23T10:00:00Z"
        }));
        let gitlab = gitlab_pr(&json!({
            "iid": 7, "title": "Login", "web_url": "https://gitlab.com/o/r/-/merge_requests/7", "author": { "username": "ana" },
            "source_branch": "feat/login", "target_branch": "dev", "draft": true, "updated_at": "2026-10-23T10:00:00Z"
        }));
        for pr in [&github, &gitlab] {
            assert_eq!((pr.number, pr.source.as_str(), pr.target.as_str(), pr.author.as_str(), pr.draft), (7, "feat/login", "dev", "ana", true));
        }
        assert!(github.url.ends_with("/pull/7"));
        assert!(gitlab.url.ends_with("/merge_requests/7"));
    }

    #[test]
    fn marks_gitlab_drafts_in_the_title() {
        let pr = |title: &str, draft: bool| NewPullRequest { source: "a".into(), target: "b".into(), title: title.into(), body: String::new(), draft };
        assert_eq!(gitlab_title(&pr("Login", true)), "Draft: Login");
        assert_eq!(gitlab_title(&pr("Draft: Login", true)), "Draft: Login");
        assert_eq!(gitlab_title(&pr("Login", false)), "Login");
    }
}
