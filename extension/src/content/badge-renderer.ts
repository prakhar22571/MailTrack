import type { TrackedEmail } from "../lib/messages";

const BADGE_ATTR = "data-mt-badge";
const POLL_INTERVAL_MS = 15000;

let cachedEmails: TrackedEmail[] = [];

/**
 * Gmail row markup differs across its "classic" and Material 3 layouts and
 * changes without notice, so instead of relying on positional selectors we
 * match rows by checking whether the tracked subject appears anywhere in the
 * row's text. It's a heuristic (can mis-badge threads that happen to share a
 * subject) but survives DOM refactors that would break class-based selectors.
 */
export function startBadgeRenderer(): void {
  refreshTrackedEmails();
  setInterval(refreshTrackedEmails, POLL_INTERVAL_MS);

  const observer = new MutationObserver(() => renderBadges());
  observer.observe(document.body, { childList: true, subtree: true });

  renderBadges();
}

function refreshTrackedEmails(): void {
  chrome.runtime.sendMessage(
    { type: "GET_EMAILS" },
    (response: { ok: boolean; emails?: TrackedEmail[] } | undefined) => {
      if (chrome.runtime.lastError) return;
      if (response?.ok && response.emails) {
        cachedEmails = response.emails;
        renderBadges();
      }
    },
  );
}

function renderBadges(): void {
  if (cachedEmails.length === 0) return;

  document.querySelectorAll<HTMLElement>('tr[role="row"]').forEach((row) => {
    if (row.hasAttribute(BADGE_ATTR)) return;
    const text = row.textContent ?? "";

    const match = cachedEmails.find((email) => email.subject !== "(no subject)" && text.includes(email.subject));
    if (!match) return;

    const targetCell = row.querySelector("td:last-child") ?? row;
    row.setAttribute(BADGE_ATTR, "true");
    targetCell.appendChild(createBadge(match));
  });
}

function createBadge(email: TrackedEmail): HTMLElement {
  const badge = document.createElement("span");
  badge.style.marginLeft = "6px";
  badge.style.fontSize = "12px";
  badge.style.whiteSpace = "nowrap";

  const opened = email.openCount > 0;
  badge.textContent = opened ? "✓✓" : "✓";
  badge.style.color = opened ? "#1a73e8" : "#9aa0a6";
  badge.title = opened
    ? `Opened ${email.openCount}x, last at ${email.lastOpenedAt ?? "?"}${
        email.clickCount > 0 ? `, ${email.clickCount} link click(s)` : ""
      }`
    : "Sent, not yet opened";

  return badge;
}
