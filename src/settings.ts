// App settings: defaults, typed keys and hooks. Values are persisted by the
// backend (settings.json); git-config-backed preferences are read and
// written through git directly by the preferences pages.

import type { Integration, PullMode } from "./api";

export type Theme = "corvus-dark" | "corvus-light" | "midnight" | "contrast";
export type ToastPos = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export const GLOBAL_DEFAULTS = {
  // general
  autoFetchMinutes: 1,
  autoPrune: true,
  updateSubmodules: true,
  deleteOrig: false,
  showAllCommits: false,
  initialCommits: 2000,
  lazyLoad: true,
  rememberTabs: true,
  gitPath: "",
  extendedLog: false,
  conflictDetection: true,
  pullMode: "ff-only" as PullMode,
  // ui
  language: "system" as "system" | "en" | "pt-BR",
  theme: "corvus-dark" as Theme,
  toastPosition: "bottom-right" as ToastPos,
  toolbarLabels: true,
  dateLocale: "system",
  dateStyle: "absolute" as "absolute" | "relative",
  dateFormat: "DD/MM/YYYY",
  dateWordFormat: "D MMMM YYYY",
  dateTimeFormat: "DD/MM/YYYY @ HH:mm",
  dateVerboseFormat: "dddd, D MMMM YYYY [at] HH:mm",
  useAvatars: true,
  hoverHighlight: true,
  branchVisibility: "all" as "all" | "local" | "current",
  pinTrunk: true,
  graphLineStyle: "angular" as "angular" | "curved",
  trunkBranches: ["main", "master", "develop", "dev"] as string[],
  colRefs: true,
  colGraph: true,
  colMessage: true,
  colAuthor: true,
  colDate: true,
  colSha: false,
  showDescription: "always" as "always" | "hover" | "never",
  // editor
  editorFont: "Cascadia Code",
  editorMonoOnly: true,
  editorFontSize: 13,
  editorTabSize: 4,
  editorEol: "auto" as "auto" | "LF" | "CRLF",
  editorSyntax: true,
  editorLineNumbers: true,
  editorWordWrap: false,
  // terminal
  termFont: "Cascadia Mono",
  termFontSize: 13,
  termLineHeight: 1.2,
  termCursor: "bar" as "bar" | "block" | "underline",
  termDim: true,
  termShell: "powershell",
  // notifications
  desktopNotifications: false,
  // ssh
  sshUseAgent: true,
  sshPrivateKey: "",
  sshPublicKey: "",
  // external tools
  mergeTool: "default",
  diffTool: "merge",
  editorTool: "",
  terminalTool: "",
  // integrations
  integrations: [] as Integration[],
  defaultIssueTracker: "",
  // layout & session
  leftWidth: 260,
  rightWidth: 380,
  leftCollapsed: false,
  rightCollapsed: false,
  terminalHeight: 260,
  zoom: 1,
  colWidths: { refs: 190, author: 140, date: 150, sha: 70 } as Record<string, number>,
  tabs: [] as string[],
  recent: [] as string[],
};

export const REPO_DEFAULTS = {
  encoding: "utf-8",
  pushAfterCommit: false,
  skipHooks: false,
  mergeSquash: false,
  templateApply: true,
  templateStrip: false,
  templateSummary: "",
  templateBody: "",
  conflictDetection: true,
  baseBranches: "**",
  issueTracker: "",
};

export type GlobalSettings = typeof GLOBAL_DEFAULTS;
export type RepoSettings = typeof REPO_DEFAULTS;
export type GlobalKey = keyof GlobalSettings;
export type RepoKey = keyof RepoSettings;

export const THEMES: { id: Theme; name: string }[] = [
  { id: "corvus-dark", name: "Corvus Dark" },
  { id: "corvus-light", name: "Corvus Light" },
  { id: "midnight", name: "Midnight" },
  { id: "contrast", name: "High Contrast" },
];

export const ENCODINGS = [
  ["utf-8", "UTF-8"],
  ["utf-16le", "UTF-16 LE"],
  ["utf-16be", "UTF-16 BE"],
  ["windows-1252", "Western (Windows-1252)"],
  ["iso-8859-1", "Western (ISO-8859-1)"],
  ["iso-8859-15", "Western (ISO-8859-15)"],
  ["windows-1250", "Central European (Windows-1250)"],
  ["windows-1251", "Cyrillic (Windows-1251)"],
  ["koi8-r", "Cyrillic (KOI8-R)"],
  ["shift_jis", "Japanese (Shift_JIS)"],
  ["euc-jp", "Japanese (EUC-JP)"],
  ["euc-kr", "Korean (EUC-KR)"],
  ["gbk", "Chinese Simplified (GBK)"],
  ["gb18030", "Chinese Simplified (GB18030)"],
  ["big5", "Chinese Traditional (Big5)"],
] as const;
