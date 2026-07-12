import { newTrackingId } from "../lib/tracking-id";
import { getCachedServerBaseUrl } from "./server-config-cache";
import type { RegisterEmailResponse } from "../lib/messages";

const PROCESSED_ATTR = "data-mt-processed";
const TRACKING_ON_ATTR = "data-mt-tracking-on";
const INJECTED_ATTR = "data-mt-injected";

/**
 * Gmail has no stable IDs or class names (they're minified and change across
 * deploys), so every selector below is written against ARIA labels /
 * contenteditable roles, which Gmail keeps stable for accessibility. This is
 * the same fragility real Mailtrack has to live with.
 */
export function observeComposeWindows(): void {
  const observer = new MutationObserver(() => {
    document.querySelectorAll<HTMLElement>('div[role="dialog"]').forEach((dialog) => {
      if (dialog.hasAttribute(PROCESSED_ATTR)) return;

      const body = findMessageBody(dialog);
      const sendButton = findSendButton(dialog);
      if (!body || !sendButton) return;

      dialog.setAttribute(PROCESSED_ATTR, "true");
      setupComposeWindow(dialog, body, sendButton);
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function findMessageBody(dialog: HTMLElement): HTMLElement | null {
  return dialog.querySelector<HTMLElement>(
    'div[aria-label="Message Body"][contenteditable="true"], div[g_editable="true"][contenteditable="true"]',
  );
}

function findSendButton(dialog: HTMLElement): HTMLElement | null {
  const candidates = dialog.querySelectorAll<HTMLElement>('div[role="button"]');
  for (const el of candidates) {
    const label = (el.getAttribute("aria-label") ?? el.getAttribute("data-tooltip") ?? "").toLowerCase();
    if (label.startsWith("send")) return el;
  }
  return null;
}

function setupComposeWindow(dialog: HTMLElement, body: HTMLElement, sendButton: HTMLElement): void {
  dialog.setAttribute(TRACKING_ON_ATTR, "true");

  const toggle = createToggleButton(dialog);
  sendButton.parentElement?.insertBefore(toggle, sendButton);

  // Capture phase so we mutate the body before Gmail's own listener (attached
  // during its own render) reads it and serializes the outgoing message.
  sendButton.addEventListener("click", () => handleSend(dialog, body), true);
  body.addEventListener(
    "keydown",
    (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        handleSend(dialog, body);
      }
    },
    true,
  );
}

function createToggleButton(dialog: HTMLElement): HTMLElement {
  const button = document.createElement("div");
  button.setAttribute("role", "button");
  button.title = "Tracking is ON for this email (click to toggle)";
  button.textContent = "\u{1F441}️"; // 👁️
  button.style.cursor = "pointer";
  button.style.display = "inline-flex";
  button.style.alignItems = "center";
  button.style.padding = "0 8px";
  button.style.opacity = "1";
  button.style.userSelect = "none";

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const isOn = dialog.getAttribute(TRACKING_ON_ATTR) === "true";
    dialog.setAttribute(TRACKING_ON_ATTR, String(!isOn));
    button.style.opacity = isOn ? "0.35" : "1";
    button.title = `Tracking is ${isOn ? "OFF" : "ON"} for this email (click to toggle)`;
  });

  return button;
}

function handleSend(dialog: HTMLElement, body: HTMLElement): void {
  if (dialog.getAttribute(TRACKING_ON_ATTR) !== "true") return;
  if (dialog.getAttribute(INJECTED_ATTR) === "true") return; // click + keydown can both fire for one send
  dialog.setAttribute(INJECTED_ATTR, "true");

  const trackingId = newTrackingId();
  const baseUrl = getCachedServerBaseUrl();

  rewriteLinks(body, trackingId, baseUrl);
  appendPixel(body, trackingId, baseUrl);

  const subject = extractSubject(dialog);
  const recipients = extractRecipients(dialog);

  chrome.runtime.sendMessage(
    { type: "REGISTER_EMAIL", payload: { trackingId, subject, recipients } },
    (_response: RegisterEmailResponse) => void chrome.runtime.lastError, // swallow "no receiver" noise
  );
}

function rewriteLinks(body: HTMLElement, trackingId: string, baseUrl: string): void {
  body.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
    const original = anchor.href;
    if (!original.startsWith("http://") && !original.startsWith("https://")) return;
    anchor.href = `${baseUrl}/c/${trackingId}?u=${encodeURIComponent(original)}`;
  });
}

function appendPixel(body: HTMLElement, trackingId: string, baseUrl: string): void {
  const img = document.createElement("img");
  img.src = `${baseUrl}/p/${trackingId}.png`;
  img.width = 1;
  img.height = 1;
  img.style.display = "none";
  body.appendChild(img);
}

function extractSubject(dialog: HTMLElement): string {
  const input = dialog.querySelector<HTMLInputElement>('input[name="subjectbox"]');
  return input?.value?.trim() || "(no subject)";
}

function extractRecipients(dialog: HTMLElement): string {
  const chips = Array.from(dialog.querySelectorAll<HTMLElement>("span[email]"))
    .map((el) => el.getAttribute("email"))
    .filter((email): email is string => Boolean(email));

  if (chips.length > 0) return Array.from(new Set(chips)).join(", ");

  const fallback = dialog.querySelector<HTMLTextAreaElement>('textarea[name="to"]');
  return fallback?.value?.trim() || "(unknown recipient)";
}
