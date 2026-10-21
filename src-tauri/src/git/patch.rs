//! Unified-diff text handling: parsing a single-file patch into hunks and
//! building partial patches (selected hunk/lines) for `git apply`.

use serde::Serialize;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    /// ' ', '+', '-' or '\\' (no newline marker)
    pub origin: char,
    pub content: String,
    pub old_no: Option<u32>,
    pub new_no: Option<u32>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub header: String,
    pub old_start: u32,
    pub new_start: u32,
    pub lines: Vec<Line>,
}

#[derive(Debug)]
pub struct FilePatch {
    pub header: Vec<String>,
    pub hunks: Vec<Hunk>,
}

fn parse_range(s: &str) -> u32 {
    s.split(',').next().and_then(|n| n.parse().ok()).unwrap_or(0)
}

pub fn parse(text: &str) -> FilePatch {
    let mut header = Vec::new();
    let mut hunks: Vec<Hunk> = Vec::new();
    let (mut old_no, mut new_no) = (0u32, 0u32);
    for raw in text.split_inclusive('\n') {
        let l = raw.strip_suffix('\n').unwrap_or(raw);
        let l = l.strip_suffix('\r').unwrap_or(l);
        if l.starts_with("@@") {
            // @@ -a,b +c,d @@ section
            let mut parts = l.split_whitespace().skip(1);
            let old_start = parse_range(parts.next().unwrap_or("-0").trim_start_matches('-'));
            let new_start = parse_range(parts.next().unwrap_or("+0").trim_start_matches('+'));
            old_no = old_start;
            new_no = new_start;
            hunks.push(Hunk { header: l.to_string(), old_start, new_start, lines: Vec::new() });
            continue;
        }
        let Some(h) = hunks.last_mut() else {
            header.push(l.to_string());
            continue;
        };
        let origin = l.chars().next().unwrap_or(' ');
        let content = l.get(1..).unwrap_or("").to_string();
        let (o, n) = match origin {
            '+' => {
                new_no += 1;
                (None, Some(new_no - 1))
            }
            '-' => {
                old_no += 1;
                (Some(old_no - 1), None)
            }
            '\\' => (None, None),
            _ => {
                old_no += 1;
                new_no += 1;
                (Some(old_no - 1), Some(new_no - 1))
            }
        };
        h.lines.push(Line { origin, content, old_no: o, new_no: n });
    }
    FilePatch { header, hunks }
}

/// Builds a one-hunk patch keeping only `selected` changed lines (indices
/// into `hunk.lines`; `None` keeps all). `reverse` is for patches that will
/// be applied with `--reverse` (unstage/discard): there, unselected
/// additions become context and unselected removals vanish; forwards it is
/// the other way round.
pub fn partial(fp: &FilePatch, hunk: usize, selected: Option<&[usize]>, reverse: bool) -> Option<String> {
    let h = fp.hunks.get(hunk)?;
    let is_sel = |i: usize| selected.is_none_or(|s| s.contains(&i));
    let mut body = Vec::new();
    let (mut old_n, mut new_n) = (0u32, 0u32);
    let mut last_kept = false;
    let mut changed = false;
    for (i, l) in h.lines.iter().enumerate() {
        let out = match l.origin {
            '\\' => last_kept.then_some('\\'),
            '+' if is_sel(i) => Some('+'),
            '-' if is_sel(i) => Some('-'),
            '+' => reverse.then_some(' '),
            '-' => (!reverse).then_some(' '),
            _ => Some(' '),
        };
        last_kept = out.is_some();
        match out {
            Some('+') => {
                new_n += 1;
                changed = true;
            }
            Some('-') => {
                old_n += 1;
                changed = true;
            }
            Some(' ') => {
                old_n += 1;
                new_n += 1;
            }
            _ => {}
        }
        if let Some(c) = out {
            body.push(format!("{c}{}", l.content));
        }
    }
    if !changed {
        return None;
    }
    let all = selected.is_none()
        || h.lines.iter().enumerate().all(|(i, l)| !matches!(l.origin, '+' | '-') || is_sel(i));
    let mut header: Vec<String> = fp.header.clone();
    if !all {
        // A partial deletion/creation is a modification of the file.
        let path = header
            .iter()
            .find_map(|l| l.strip_prefix("--- a/").or_else(|| l.strip_prefix("+++ b/")))
            .map(String::from);
        if let Some(path) = path {
            header.retain(|l| {
                !l.starts_with("deleted file mode") && !l.starts_with("new file mode") && !l.starts_with("index ")
            });
            for l in header.iter_mut() {
                if l == "+++ /dev/null" && !reverse {
                    *l = format!("+++ b/{path}");
                }
                if l == "--- /dev/null" && reverse {
                    *l = format!("--- a/{path}");
                }
            }
        }
    }
    let old_start = if old_n == 0 { h.old_start } else { h.old_start.max(1) };
    let mut s = header.join("\n");
    s.push('\n');
    s.push_str(&format!("@@ -{},{} +{},{} @@\n", old_start, old_n, h.new_start, new_n));
    for l in body {
        s.push_str(&l);
        s.push('\n');
    }
    Some(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    const P: &str = "diff --git a/f.txt b/f.txt\nindex 1..2 100644\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n+X\n c\n";

    #[test]
    fn parses_line_numbers() {
        let fp = parse(P);
        assert_eq!(fp.header.len(), 4);
        let l = &fp.hunks[0].lines;
        assert_eq!((l[1].origin, l[1].old_no, l[1].new_no), ('-', Some(2), None));
        assert_eq!((l[3].origin, l[3].new_no), ('+', Some(3)));
        assert_eq!(l[4].old_no, Some(3));
    }

    #[test]
    fn forward_selection_drops_unselected_additions() {
        let fp = parse(P);
        let s = partial(&fp, 0, Some(&[2]), false).unwrap();
        assert!(s.ends_with("@@ -1,3 +1,4 @@\n a\n b\n+B\n c\n"), "{s}");
    }

    #[test]
    fn reverse_selection_keeps_unselected_additions_as_context() {
        let fp = parse(P);
        let s = partial(&fp, 0, Some(&[3]), true).unwrap();
        assert!(s.ends_with("@@ -1,3 +1,4 @@\n a\n B\n+X\n c\n"), "{s}");
    }

    #[test]
    fn nothing_selected_is_none() {
        let fp = parse(P);
        assert!(partial(&fp, 0, Some(&[0]), false).is_none());
    }
}
