//! Commit graph: walks all refs topologically and assigns each commit a
//! lane, plus the line segments needed to draw the row.
//!
//! Each row is drawn independently. A segment is either a pass-through
//! (`Full`, top to bottom of the same lane), an incoming line (`Top`, from a
//! lane at the top edge to the node) or an outgoing line (`Bottom`, from the
//! node to a lane at the bottom edge).

use super::Result;
use git2::{Oid, Repository, Sort};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RefLabel {
    /// Display name: the branch name for local branches (grouped with their
    /// remote counterparts), "remote/branch" for remote-only, the tag name.
    pub name: String,
    /// "local" | "remote" | "tag" | "head" (detached HEAD)
    pub kind: &'static str,
    pub current: bool,
    /// Remotes whose branch of the same name (or the configured upstream)
    /// points at this same commit, e.g. ["origin"].
    pub remotes: Vec<String>,
}
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Half {
    Full,
    Top,
    Bottom,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub struct Seg {
    pub from: u16,
    pub to: u16,
    pub half: Half,
    pub color: u16,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GraphRow {
    pub oid: String,
    pub parents: Vec<String>,
    pub lane: u16,
    pub color: u16,
    pub segs: Vec<Seg>,
    pub refs: Vec<RefLabel>,
    pub summary: String,
    /// Commit description (message after the summary), truncated.
    pub body: String,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub is_head: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    pub rows: Vec<GraphRow>,
    pub width: u16,
    pub has_more: bool,
    pub head: Option<String>,
    /// Number of trunk columns (0..trunks). Trunk lines use colors
    /// 0..trunks, so a segment with `color < trunks` belongs to a trunk.
    pub trunks: u16,
}

/// A ref before grouping: kind ("local" | "remote" | "tag") and short name.
#[derive(Debug, Clone)]
pub struct RawRef {
    pub kind: &'static str,
    pub name: String,
}

/// Merges remote branches into the local branch on the same commit when
/// they are the same branch (configured upstream, or the same name), so
/// "main" + "origin/main" in sync become one label `main` with
/// `remotes: ["origin"]`. Diverged branches stay separate, on their own
/// commits.
pub fn group_refs(raw: Vec<RawRef>, upstreams: &HashMap<String, String>, head_branch: Option<&str>) -> Vec<RefLabel> {
    let locals: Vec<&str> = raw.iter().filter(|r| r.kind == "local").map(|r| r.name.as_str()).collect();
    let mut out: Vec<RefLabel> = Vec::new();
    let mut absorbed = std::collections::HashSet::new();
    for l in &locals {
        let mut remotes = Vec::new();
        for r in raw.iter().filter(|r| r.kind == "remote") {
            let Some((remote, branch)) = r.name.split_once('/') else { continue };
            let is_upstream = upstreams.get(*l).map(|u| u == &r.name);
            // An explicit upstream wins; otherwise match by branch name.
            if is_upstream.unwrap_or(branch == *l) {
                remotes.push(remote.to_string());
                absorbed.insert(r.name.clone());
            }
        }
        remotes.sort();
        out.push(RefLabel { name: l.to_string(), kind: "local", current: head_branch == Some(*l), remotes });
    }
    for r in &raw {
        match r.kind {
            "remote" if !absorbed.contains(&r.name) => out.push(RefLabel {
                name: r.name.clone(),
                kind: "remote",
                current: false,
                remotes: r.name.split_once('/').map(|(rm, _)| vec![rm.to_string()]).unwrap_or_default(),
            }),
            "tag" => out.push(RefLabel { name: r.name.clone(), kind: "tag", current: false, remotes: vec![] }),
            _ => {}
        }
    }
    // Current branch first, then locals, remotes, tags; alphabetical within.
    out.sort_by(|a, b| {
        let rank = |l: &RefLabel| (!l.current, match l.kind { "head" => 0, "local" => 1, "remote" => 2, _ => 3 });
        rank(a).cmp(&rank(b)).then_with(|| a.name.cmp(&b.name))
    });
    out
}

pub fn ref_labels(repo: &Repository) -> Result<HashMap<Oid, Vec<RefLabel>>> {
    let head = repo.head().ok();
    let head_branch = head
        .as_ref()
        .filter(|h| h.is_branch())
        .and_then(|h| h.shorthand().ok().map(String::from));
    let mut raw: HashMap<Oid, Vec<RawRef>> = HashMap::new();
    let mut upstreams = HashMap::new();
    for r in repo.references()? {
        let r = r?;
        let Ok(name) = r.name() else { continue };
        let (kind, short) = if let Some(s) = name.strip_prefix("refs/heads/") {
            ("local", s)
        } else if let Some(s) = name.strip_prefix("refs/remotes/") {
            if s.ends_with("/HEAD") {
                continue;
            }
            ("remote", s)
        } else if let Some(s) = name.strip_prefix("refs/tags/") {
            ("tag", s)
        } else {
            continue;
        };
        let Ok(c) = r.peel_to_commit() else { continue };
        if kind == "local" {
            let up = repo
                .find_branch(short, git2::BranchType::Local)
                .ok()
                .and_then(|b| b.upstream().ok())
                .and_then(|u| u.name().ok().flatten().map(String::from));
            if let Some(up) = up {
                upstreams.insert(short.to_string(), up);
            }
        }
        raw.entry(c.id()).or_default().push(RawRef { kind, name: short.to_string() });
    }
    let mut map: HashMap<Oid, Vec<RefLabel>> =
        raw.into_iter().map(|(oid, refs)| (oid, group_refs(refs, &upstreams, head_branch.as_deref()))).collect();
    if let Some(h) = head.as_ref().filter(|h| !h.is_branch()) {
        if let Some(oid) = h.target() {
            map.entry(oid).or_default().insert(0, RefLabel { name: "HEAD".into(), kind: "head", current: true, remotes: vec![] });
        }
    }
    Ok(map)
}
/// A pending connection drawn down a column: the commit it leads to and the
/// line's color.
type Pending = (Oid, u16);

struct Lanes {
    /// Each column carries zero or more pending connections. Several can
    /// share a column (e.g. a branch's own line plus a merge connection
    /// waiting to turn left at its parent's row); they draw as one line.
    slots: Vec<Vec<Pending>>,
    next_color: u16,
    /// Columns `0..reserved` belong exclusively to trunk branches.
    reserved: usize,
}

impl Lanes {
    fn find(&self, oid: Oid) -> Option<usize> {
        self.slots.iter().position(|s| s.iter().any(|(o, _)| *o == oid))
    }
    fn color_in(&self, i: usize, oid: Oid) -> Option<u16> {
        self.slots.get(i)?.iter().find(|(o, _)| *o == oid).map(|(_, c)| *c)
    }
    fn ensure(&mut self, i: usize) {
        while self.slots.len() <= i {
            self.slots.push(Vec::new());
        }
    }
    /// Adds a connection to column `i`. A column draws as one line in one
    /// colour, so a connection joining a busy column takes on its colour.
    fn push(&mut self, i: usize, (oid, color): Pending) {
        self.ensure(i);
        let slot = &mut self.slots[i];
        if slot.iter().any(|(o, _)| *o == oid) {
            return;
        }
        let color = slot.first().map_or(color, |(_, c)| *c);
        slot.push((oid, color));
    }
    /// First empty column right of the trunk columns (and of `after`, when
    /// given). Trunk columns are never lent out.
    fn free_slot_from(&mut self, after: Option<usize>) -> usize {
        let start = after.map_or(self.reserved, |a| (a + 1).max(self.reserved));
        self.ensure(start.saturating_sub(1));
        match self.slots.iter().skip(start).position(|s| s.is_empty()) {
            Some(i) => i + start,
            None => {
                self.slots.push(Vec::new());
                self.slots.len() - 1
            }
        }
    }
    fn free_slot(&mut self) -> usize {
        self.free_slot_from(None)
    }
    fn new_color(&mut self) -> u16 {
        let c = self.next_color;
        self.next_color = self.next_color.wrapping_add(1);
        c
    }
}

/// Computes the lane layout for an ordered (children before parents) list
/// of `(commit, parents)`.
///
/// `trunk` pins commits of the main branches (main, develop, …) to fixed
/// columns `0..reserved`; everything else lives to their right.
///
/// Routing rule (matches the classic right-angle look): a connection
/// between a node on the left and a node on the right turns at the row of
/// the **left** node and runs vertically in the **right** column. So:
/// - a branch line stays in its own column until its parent's row, then
///   turns left into the parent;
/// - a merge whose other parent lies to the right turns right at the merge
///   row and goes down that column;
/// - a merge whose other parent lies to the left keeps going down the
///   merge's own column and turns left at that parent's row.
pub fn layout(commits: &[(Oid, Vec<Oid>)], trunk: &HashMap<Oid, u16>, reserved: u16) -> Vec<(u16, u16, Vec<Seg>)> {
    let reserved = reserved as usize;
    let mut lanes = Lanes { slots: vec![Vec::new(); reserved], next_color: reserved as u16, reserved };
    let mut out = Vec::with_capacity(commits.len());
    for (oid, parents) in commits {
        let mut segs: Vec<Seg> = Vec::new();
        let (lane, color) = match trunk.get(oid) {
            Some(&k) => (k as usize, k),
            None => match lanes.find(*oid) {
                Some(i) => (i, lanes.color_in(i, *oid).unwrap_or(0)),
                None => {
                    let c = lanes.new_color();
                    (lanes.free_slot(), c)
                }
            },
        };
        lanes.ensure(lane);
        // A trunk commit owns its column: lines in it that lead to
        // non-trunk commits are moved aside.
        if trunk.contains_key(oid) {
            let (keep, stray): (Vec<Pending>, Vec<Pending>) =
                lanes.slots[lane].drain(..).partition(|(o, _)| *o == *oid || trunk.contains_key(o));
            lanes.slots[lane] = keep;
            for (o, c) in stray {
                let j = lanes.free_slot();
                lanes.push(j, (o, c));
                segs.push(Seg { from: lane as u16, to: j as u16, half: Half::Full, color: c });
            }
        }
        // Connections arriving at this commit turn into it at this row.
        for i in 0..lanes.slots.len() {
            let arriving: Vec<u16> = lanes.slots[i].iter().filter(|(o, _)| *o == *oid).map(|(_, c)| *c).collect();
            if arriving.is_empty() {
                continue;
            }
            lanes.slots[i].retain(|(o, _)| *o != *oid);
            for c in arriving {
                let s = Seg { from: i as u16, to: lane as u16, half: Half::Top, color: c };
                if !segs.contains(&s) {
                    segs.push(s);
                }
            }
        }
        // Everything still pending passes straight through.
        for (i, s) in lanes.slots.iter().enumerate() {
            if let Some((_, c)) = s.first() {
                if !segs.iter().any(|x| x.half == Half::Full && x.to == i as u16 && x.from != x.to) {
                    segs.push(Seg { from: i as u16, to: i as u16, half: Half::Full, color: *c });
                }
            }
        }
        // Lines leaving towards parents.
        for (n, p) in parents.iter().enumerate() {
            if n == 0 {
                // First parent: stay in this column until the parent's row.
                lanes.push(lane, (*p, color));
                segs.push(Seg { from: lane as u16, to: lane as u16, half: Half::Bottom, color });
                continue;
            }
            // Where the other parent will be drawn, if already known.
            let target = trunk.get(p).map(|&m| (m as usize, m)).or_else(|| lanes.find(*p).map(|j| (j, lanes.color_in(j, *p).unwrap_or(color))));
            match target {
                // Parent on the left: run down our own column, turn left at
                // the parent's row.
                Some((t, c)) if t < lane => {
                    lanes.push(lane, (*p, c));
                    let s = Seg { from: lane as u16, to: lane as u16, half: Half::Bottom, color };
                    if !segs.contains(&s) {
                        segs.push(s);
                    }
                }
                // Parent on the right: turn right here, go down its column.
                Some((t, c)) if t > lane => {
                    lanes.push(t, (*p, c));
                    segs.push(Seg { from: lane as u16, to: t as u16, half: Half::Bottom, color: c });
                }
                Some(_) => {}
                // New line: always opened to the right of this commit.
                None => {
                    let c = lanes.new_color();
                    let j = lanes.free_slot_from(Some(lane));
                    lanes.push(j, (*p, c));
                    segs.push(Seg { from: lane as u16, to: j as u16, half: Half::Bottom, color: c });
                }
            }
        }
        while lanes.slots.len() > reserved && matches!(lanes.slots.last(), Some(s) if s.is_empty()) {
            lanes.slots.pop();
        }
        out.push((lane as u16, color, segs));
    }
    out
}
/// Pins trunk branches (in priority order) to columns: each existing trunk
/// claims its first-parent chain, stopping at commits an earlier trunk owns.
pub fn trunk_lanes(repo: &Repository, trunks: &[String]) -> HashMap<Oid, u16> {
    let mut claimed: HashMap<Oid, u16> = HashMap::new();
    let mut lane = 0u16;
    let mut seen = std::collections::HashSet::new();
    for name in trunks.iter().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        let tip = repo
            .find_branch(name, git2::BranchType::Local)
            .or_else(|_| repo.find_branch(&format!("origin/{name}"), git2::BranchType::Remote))
            .ok()
            .and_then(|b| b.get().target());
        let Some(tip) = tip else { continue };
        if !seen.insert(tip) && claimed.contains_key(&tip) {
            continue;
        }
        let mut cur = Some(tip);
        let mut any = false;
        while let Some(oid) = cur {
            if claimed.contains_key(&oid) {
                break;
            }
            claimed.insert(oid, lane);
            any = true;
            cur = repo.find_commit(oid).ok().and_then(|c| c.parent_id(0).ok());
        }
        if any {
            lane += 1;
        }
    }
    claimed
}

pub fn build(repo: &Repository, limit: usize, trunks: &[String]) -> Result<Graph> {
    let mut walk = repo.revwalk()?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)?;
    let _ = walk.push_glob("refs/heads");
    let _ = walk.push_glob("refs/remotes");
    let _ = walk.push_glob("refs/tags");
    let head = repo.head().ok().and_then(|h| h.target());
    if let Some(h) = head {
        let _ = walk.push(h);
    }

    let mut commits = Vec::new();
    let mut has_more = false;
    for oid in walk {
        let oid = oid?;
        if commits.len() >= limit {
            has_more = true;
            break;
        }
        commits.push(repo.find_commit(oid)?);
    }
    let shape: Vec<(Oid, Vec<Oid>)> =
        commits.iter().map(|c| (c.id(), c.parent_ids().collect())).collect();
    let trunk = trunk_lanes(repo, trunks);
    let reserved = trunk.values().map(|l| l + 1).max().unwrap_or(0);
    let laid = layout(&shape, &trunk, reserved);    let mut labels = ref_labels(repo)?;

    let mut width = 0u16;
    let rows = commits
        .iter()
        .zip(laid)
        .map(|(c, (lane, color, segs))| {
            width = width.max(lane + 1);
            for s in &segs {
                width = width.max(s.from.max(s.to) + 1);
            }
            let author = c.author();
            GraphRow {
                oid: c.id().to_string(),
                parents: c.parent_ids().map(|p| p.to_string()).collect(),
                lane,
                color,
                segs,
                refs: labels.remove(&c.id()).unwrap_or_default(),
                summary: c.summary().ok().flatten().unwrap_or("").to_string(),
                body: c
                    .body()
                    .ok()
                    .flatten()
                    .map(|b| b.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(200).collect())
                    .unwrap_or_default(),
                author: author.name().unwrap_or_default().to_string(),
                email: author.email().unwrap_or_default().to_string(),
                time: c.time().seconds(),
                is_head: Some(c.id()) == head,
            }
        })
        .collect();
    Ok(Graph { rows, width: width.max(reserved), has_more, head: head.map(|h| h.to_string()), trunks: reserved })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn oid(n: u8) -> Oid {
        Oid::from_bytes(&[n; 20]).unwrap()
    }

    fn plain(c: &[(Oid, Vec<Oid>)]) -> Vec<(u16, u16, Vec<Seg>)> {
        layout(c, &HashMap::new(), 0)
    }

    fn has(segs: &[Seg], from: u16, to: u16, half: Half) -> bool {
        segs.iter().any(|s| s.from == from && s.to == to && s.half == half)
    }

    #[test]
    fn linear_history_stays_in_one_lane() {
        let c = vec![(oid(3), vec![oid(2)]), (oid(2), vec![oid(1)]), (oid(1), vec![])];
        let l = plain(&c);
        assert!(l.iter().all(|(lane, _, _)| *lane == 0));
        assert_eq!(l[2].2, vec![Seg { from: 0, to: 0, half: Half::Top, color: 0 }]);
    }

    #[test]
    fn merge_opens_and_closes_a_second_lane() {
        // M merges A (first parent) and B; both come from R.
        let (m, a, b, r) = (oid(4), oid(3), oid(2), oid(1));
        let c = vec![(m, vec![a, b]), (a, vec![r]), (b, vec![r]), (r, vec![])];
        let l = plain(&c);
        assert_eq!(l[0].0, 0);
        assert!(l[0].2.contains(&Seg { from: 0, to: 1, half: Half::Bottom, color: 1 }));
        assert_eq!(l[1].0, 0);
        // B keeps its own lane down to R, where both lanes converge.
        assert_eq!(l[2].0, 1);
        assert!(has(&l[2].2, 1, 1, Half::Bottom));
        assert_eq!(l[3].0, 0);
        assert!(has(&l[3].2, 1, 0, Half::Top) && has(&l[3].2, 0, 0, Half::Top));
    }

    #[test]
    fn a_column_keeps_one_colour_until_it_empties() {
        // Feature F2 merges trunk T2 in (other parent on the left), then F1
        // reaches its own parent T1 further down the same column.
        let (f2, f1, t2, t1) = (oid(4), oid(3), oid(2), oid(1));
        let c = vec![(f2, vec![f1, t2]), (f1, vec![t1]), (t2, vec![t1]), (t1, vec![])];
        let trunk = HashMap::from([(t2, 0), (t1, 0)]);
        let l = layout(&c, &trunk, 1);
        let feature = l[0].1;
        assert_eq!(l[0].0, 1, "the feature has its own column");
        for (row, (_, _, segs)) in l.iter().enumerate() {
            for s in segs.iter().filter(|s| s.from == 1) {
                assert_eq!(s.color, feature, "row {row}: {s:?}");
            }
        }
        assert!(l[2].2.contains(&Seg { from: 1, to: 0, half: Half::Top, color: feature }), "the merge turns into the trunk in the feature's colour");
    }

    fn raw(kind: &'static str, name: &str) -> RawRef {
        RawRef { kind, name: name.into() }
    }

    #[test]
    fn groups_local_with_remote_on_same_commit() {
        let ups = HashMap::new();
        let g = group_refs(vec![raw("remote", "origin/main"), raw("local", "main"), raw("remote", "upstream/main"), raw("tag", "v1")], &ups, Some("main"));
        assert_eq!(g.len(), 2);
        assert_eq!((g[0].name.as_str(), g[0].kind, g[0].current), ("main", "local", true));
        assert_eq!(g[0].remotes, vec!["origin", "upstream"]);
        assert_eq!(g[1].kind, "tag");
    }

    #[test]
    fn remote_only_and_upstream_mapping() {
        let mut ups = HashMap::new();
        ups.insert("dev".to_string(), "origin/develop".to_string());
        let g = group_refs(vec![raw("local", "dev"), raw("remote", "origin/develop"), raw("remote", "origin/dev"), raw("remote", "origin/feat/x")], &ups, None);
        let dev = g.iter().find(|l| l.name == "dev").unwrap();
        assert_eq!(dev.remotes, vec!["origin"]);
        // origin/dev is not dev's upstream, so it stays separate.
        assert!(g.iter().any(|l| l.name == "origin/dev" && l.kind == "remote"));
        assert!(g.iter().any(|l| l.name == "origin/feat/x" && l.remotes == vec!["origin"]));
    }

    #[test]
    fn two_branch_tips_get_separate_lanes() {
        let (x, y, r) = (oid(3), oid(2), oid(1));
        let c = vec![(x, vec![r]), (y, vec![r]), (r, vec![])];
        let l = plain(&c);
        assert_eq!((l[0].0, l[1].0, l[2].0), (0, 1, 0));
    }

    #[test]
    fn sibling_tips_get_separate_lanes() {
        // Three branches forked from P, none merged: no column reuse.
        let (a, b, c, p) = (oid(4), oid(3), oid(2), oid(1));
        let l = plain(&[(a, vec![p]), (b, vec![p]), (c, vec![p]), (p, vec![])]);
        assert_eq!((l[0].0, l[1].0, l[2].0, l[3].0), (0, 1, 2, 0));
        assert!(has(&l[3].2, 2, 0, Half::Top) && has(&l[3].2, 1, 0, Half::Top));
    }

    #[test]
    fn merge_from_left_parent_turns_at_parent_row() {
        // dev (trunk, column 0): D2 <- X.  homolog: H1 merges X, first
        // parent H0. The connection H1 -> X must run down H1's column and
        // turn left at X's row, not at H1's row.
        let (d2, h1, x_, h0) = (oid(4), oid(3), oid(2), oid(1));
        let mut trunk = HashMap::new();
        trunk.insert(d2, 0);
        trunk.insert(x_, 0);
        let c = vec![(d2, vec![x_]), (h1, vec![h0, x_]), (x_, vec![]), (h0, vec![])];
        let l = layout(&c, &trunk, 1);
        assert_eq!((l[0].0, l[1].0, l[2].0, l[3].0), (0, 1, 0, 1));
        assert!(!l[1].2.iter().any(|s| s.from == 1 && s.to == 0), "no turn at the merge row: {:?}", l[1].2);
        assert!(has(&l[2].2, 1, 0, Half::Top), "turns left at X's row: {:?}", l[2].2);
        assert!(has(&l[2].2, 1, 1, Half::Full), "homolog keeps passing through");
        // The turn into dev keeps the colour of the column it comes down.
        assert!(l[2].2.iter().any(|s| s.from == 1 && s.to == 0 && s.color == l[1].1));
    }

    #[test]
    fn new_merge_parent_opens_to_the_right() {
        // M sits in column 2 while column 1 is free; its new second parent N
        // must open to the right (column 3), so the turn is at M's row.
        let (a, b, cc, y, m, z, n) = (oid(7), oid(6), oid(5), oid(4), oid(3), oid(2), oid(1));
        let rows = vec![(a, vec![z]), (b, vec![y]), (cc, vec![m]), (y, vec![]), (m, vec![z, n]), (z, vec![]), (n, vec![])];
        let l = plain(&rows);
        assert_eq!(l[4].0, 2);
        assert!(has(&l[4].2, 2, 3, Half::Bottom), "{:?}", l[4].2);
        assert_eq!(l[6].0, 3);
    }

    #[test]
    fn feature_off_trunk_gets_own_lane() {
        // main: M1 <- M2 ; dev: D (parent M2) ; feature: F (parent D);
        // pr: P (parent D). Trunks: main -> 0, dev -> 1.
        let (f, pr, d, m2, m1) = (oid(5), oid(4), oid(3), oid(2), oid(1));
        let mut trunk = HashMap::new();
        trunk.insert(m2, 0);
        trunk.insert(m1, 0);
        trunk.insert(d, 1);
        let c = vec![(f, vec![d]), (pr, vec![d]), (d, vec![m2]), (m2, vec![m1]), (m1, vec![])];
        let l = layout(&c, &trunk, 2);
        assert_eq!(l.iter().map(|x| x.0).collect::<Vec<_>>(), vec![2, 3, 1, 0, 0]);
        // Features converge into dev at D; dev converges into main at M2.
        assert!(has(&l[2].2, 2, 1, Half::Top) && has(&l[2].2, 3, 1, Half::Top));
        assert!(has(&l[3].2, 1, 0, Half::Top));
        // Trunk colors are fixed by lane.
        assert_eq!((l[2].1, l[3].1), (1, 0));
    }
}
