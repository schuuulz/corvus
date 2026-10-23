// Bundle Monaco locally (no CDN) so the editor works offline.
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { loader } from "@monaco-editor/react";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

monaco.editor.defineTheme("corvus-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: { "editor.background": "#151821", "diffEditor.insertedTextBackground": "#2ea04333", "diffEditor.removedTextBackground": "#f8514933" },
});
monaco.editor.defineTheme("corvus-light", { base: "vs", inherit: true, rules: [], colors: {} });

const EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", json: "json",
  rs: "rust", py: "python", go: "go", java: "java", kt: "kotlin", cs: "csharp", c: "c", h: "c", cpp: "cpp",
  hpp: "cpp", css: "css", scss: "scss", html: "html", md: "markdown", yml: "yaml", yaml: "yaml", toml: "ini",
  sh: "shell", ps1: "powershell", sql: "sql", xml: "xml", rb: "ruby", php: "php", swift: "swift", lua: "lua",
};

export const languageOf = (file: string) => EXT[file.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext";
