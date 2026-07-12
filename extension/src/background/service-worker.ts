import { registerEmail, fetchTrackedEmails } from "../lib/api";
import { areNotificationsEnabled } from "../lib/config";
import type {
  ExtensionMessage,
  GetEmailsResponse,
  RegisterEmailResponse,
} from "../lib/messages";

const OPEN_CHECK_ALARM = "mt-check-opens";
const SEEN_OPENS_KEY = "mt_seen_open_tracking_ids";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(OPEN_CHECK_ALARM, { periodInMinutes: 3 });
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // keep the message channel open for the async response
});

async function handleMessage(message: ExtensionMessage) {
  switch (message.type) {
    case "REGISTER_EMAIL": {
      try {
        await registerEmail(message.payload);
        return { ok: true } satisfies RegisterEmailResponse;
      } catch (err) {
        return { ok: false, error: String(err) } satisfies RegisterEmailResponse;
      }
    }
    case "GET_EMAILS": {
      try {
        const emails = await fetchTrackedEmails();
        return { ok: true, emails } satisfies GetEmailsResponse;
      } catch (err) {
        return { ok: false, error: String(err) } satisfies GetEmailsResponse;
      }
    }
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== OPEN_CHECK_ALARM) return;
  if (!(await areNotificationsEnabled())) return;

  try {
    const emails = await fetchTrackedEmails();
    const seenData = await chrome.storage.local.get(SEEN_OPENS_KEY);
    const seen: string[] = Array.isArray(seenData[SEEN_OPENS_KEY])
      ? seenData[SEEN_OPENS_KEY]
      : [];
    const seenSet = new Set(seen);

    const newlyOpened = emails.filter(
      (e) => e.openCount > 0 && !seenSet.has(e.trackingId),
    );

    for (const email of newlyOpened) {
      seenSet.add(email.trackingId);
      chrome.notifications.create(`mt-open-${email.trackingId}`, {
        type: "basic",
        iconUrl: "public/icons/icon128.png",
        title: "Email opened",
        message: `"${email.subject}" was opened by ${email.recipients}`,
      });
    }

    if (newlyOpened.length > 0) {
      await chrome.storage.local.set({ [SEEN_OPENS_KEY]: Array.from(seenSet) });
    }
  } catch {
    // Backend unreachable or misconfigured; silently skip this tick.
  }
});
