export type AppLanguage = "de" | "en";

export function appLanguage(): AppLanguage {
  const language = (
    typeof navigator === "undefined" ? "" : navigator.language || navigator.languages?.[0] || ""
  ).toLowerCase();
  return language.startsWith("en") ? "en" : "de";
}
