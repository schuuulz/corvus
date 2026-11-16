// Path helpers shared by dialogs and preferences.

/** A picked path with forward slashes, the form settings and git both take. */
export const normalizePath = (path: string) => path.replace(/\\/g, "/");

/** The name a clone gets from its URL: "https://host/owner/repo.git" → "repo". */
const repoNameFromUrl = (url: string) => url.trim().replace(/\/+$/, "").split(/[/:]/).pop()?.replace(/\.git$/, "") ?? "";

/** Where cloning `url` into `parentDir` puts the repository; empty while either is missing. */
export function cloneDestination(url: string, parentDir: string): string {
  const name = repoNameFromUrl(url);
  const parent = parentDir.trim().replace(/[\\/]+$/, "");
  return parent && name ? `${parent}/${name}` : "";
}
