export function normalizeVapiEventType(type) {
  if (!type || typeof type !== "string") return "unknown";
  const t = type.toLowerCase().trim();
  // Normalize dot and hyphen styles, handle common aliases
  const normalized = t.replace(/\./g, "-");
  switch (normalized) {
    case "call-started":
    case "started":
      return "call-started";
    case "call-ended":
    case "ended":
    case "completed":
      return "call-ended";
    case "transcript":
    case "transcript-final":
    case "transcript-partial":
      return "transcript";
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
  return event.call?.id || event.id || event.callId || null;
}

export function deriveStatusAndTranscript(event) {
  const type = normalizeVapiEventType(event?.type);
  let statusUpdate = null;
  let transcriptUpdate = null;

  if (type === "call-started") {
    statusUpdate = "in-progress";
  } else if (type === "call-ended") {
    statusUpdate = "completed";
  } else if (type === "transcript") {
    transcriptUpdate = event?.transcript ?? event?.text ?? null;
  }

  // If the event has a direct status field, prefer it
  if (event?.status && typeof event.status === "string") {
    statusUpdate = event.status;
  }

  return { statusUpdate, transcriptUpdate, normalizedType: type };
}