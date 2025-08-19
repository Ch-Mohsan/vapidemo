export function normalizeVapiEventType(type) {
  if (!type || typeof type !== "string") return "unknown";
  const t = type.toLowerCase().trim();
  // Normalize dot and hyphen styles, handle common aliases
  const normalized = t.replace(/\./g, "-");
  switch (normalized) {
    case "call-started":
    case "started":
      return "call-started";
    case "call-ringing":
    case "ringing":
      return "ringing";
    case "call-ended":
    case "ended":
    case "completed":
      return "call-ended";
    case "in-progress":
    case "ongoing":
      return "in-progress";
    case "queued":
    case "pending":
      return "queued";
    case "transcript":
    case "transcript-final":
    case "transcript-partial":
      return "transcript";
    case "message":
    case "assistant-message":
    case "user-message":
      return "message";
    case "function-call":
    case "tool-call":
      return "function-call";
    case "hang":
    case "hangup":
    case "call-hang":
      return "hang";
    case "speech-update":
    case "speech":
      return "speech-update";
    default:
      return normalized;
  }
}

export function extractCallIdFromEvent(event) {
  if (!event || typeof event !== "object") return null;
  return (
    event.call?.id ||
    event.callId ||
    event.call_id ||
    event.id ||
    event.data?.id ||
    null
  );
}

export function deriveStatusAndTranscript(event) {
  const type = normalizeVapiEventType(event?.type);
  let statusUpdate = null;
  let transcriptUpdate = null;

  if (type === "call-started") {
    statusUpdate = "in-progress";
  } else if (type === "call-ended") {
    statusUpdate = "completed";
  } else if (type === "ringing") {
    statusUpdate = "ringing";
  } else if (type === "queued") {
    statusUpdate = "queued";
  } else if (type === "in-progress") {
    statusUpdate = "in-progress";
  } else if (type === "transcript") {
    transcriptUpdate = event?.transcript ?? event?.text ?? null;
  } else if (type === "message") {
    // Capture assistant/user message content as transcript text
    const message = event?.message;
    const contentFromArray = Array.isArray(message?.content)
      ? message.content
          .map((p) => {
            if (typeof p === "string") return p;
            if (!p || typeof p !== "object") return "";
            return p.text || p.value || "";
          })
          .filter(Boolean)
          .join(" ")
          .trim()
      : null;
    transcriptUpdate =
      message?.text ||
      contentFromArray ||
      event?.text ||
      null;
  }

  // Fallbacks for various transcript shapes seen across webhook variants
  if (!transcriptUpdate) {
    const candidates = [
      event?.transcript,
      event?.text,
      event?.delta?.transcript,
      event?.final?.transcript,
      event?.utterance?.text,
      Array.isArray(event?.words) ? event.words.map((w) => w?.word).filter(Boolean).join(" ") : null,
    ];
    transcriptUpdate = candidates.find((c) => typeof c === "string" && c.trim().length > 0) || null;
  }

  // If the event has a direct status field, prefer it
  if (event?.status && typeof event.status === "string") {
    statusUpdate = event.status;
  }

  return { statusUpdate, transcriptUpdate, normalizedType: type };
}