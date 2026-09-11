// DEV-TOOLS:START
export function isDeveloperModeSearch(search = window.location.search) {
  return search === "?dev";
}
// DEV-TOOLS:END
