import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import localizedFormat from "dayjs/plugin/localizedFormat";
import "dayjs/locale/pt-br";
import "dayjs/locale/es";
import "dayjs/locale/fr";
import "dayjs/locale/de";
import "dayjs/locale/it";
import "dayjs/locale/ja";
import "dayjs/locale/zh-cn";

dayjs.extend(relativeTime);
dayjs.extend(localizedFormat);

export const LOCALES = [
  ["system", "System"],
  ["en", "English"],
  ["pt-br", "Português (Brasil)"],
  ["es", "Español"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["it", "Italiano"],
  ["ja", "日本語"],
  ["zh-cn", "中文 (简体)"],
] as const;

export function resolveLocale(l: string) {
  if (l !== "system") return l;
  const nav = navigator.language.toLowerCase();
  const known = LOCALES.map(([k]) => k as string);
  return known.includes(nav) ? nav : known.includes(nav.split("-")[0]) ? nav.split("-")[0] : "en";
}

export function formatDate(secs: number, fmt: string, locale: string) {
  return dayjs(secs * 1000).locale(resolveLocale(locale)).format(fmt);
}

export function fromNow(secs: number, locale: string) {
  return dayjs(secs * 1000).locale(resolveLocale(locale)).fromNow();
}
