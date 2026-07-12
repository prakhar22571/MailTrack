import { DEFAULT_SERVER_BASE_URL, STORAGE_KEYS } from "../lib/config";

// Content scripts inject the pixel/link rewrite synchronously inside Gmail's
// send-button click handler, so there's no time to await chrome.storage there
// without risking Gmail's own handler firing first. We keep a warm,
// synchronously-readable cache instead and refresh it in the background.
let cachedBaseUrl = DEFAULT_SERVER_BASE_URL;

chrome.storage.sync.get(STORAGE_KEYS.serverBaseUrl).then((data) => {
  const url = data[STORAGE_KEYS.serverBaseUrl];
  if (typeof url === "string" && url.length > 0) {
    cachedBaseUrl = url.replace(/\/+$/, "");
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  const change = changes[STORAGE_KEYS.serverBaseUrl];
  if (change && typeof change.newValue === "string" && change.newValue.length > 0) {
    cachedBaseUrl = change.newValue.replace(/\/+$/, "");
  }
});

export function getCachedServerBaseUrl(): string {
  return cachedBaseUrl;
}
