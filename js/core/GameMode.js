const EASY_MODE_SEARCH = "?easy";

export function isEasyModeSearch(search = globalThis.location?.search || "") {
  return search === EASY_MODE_SEARCH;
}

export const easyModeEnabled = isEasyModeSearch();

export function selectWorkEntries(entries, easyMode = easyModeEnabled) {
  return easyMode ? entries.slice(0, 3) : entries;
}
