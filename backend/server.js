import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { normalizeVapiEventType, extractCallIdFromEvent, deriveStatusAndTranscript } from "./utils/vapiEvents.js";
import { createOutboundCall, getCall as vapiGetCall, getAssistant as vapiGetAssistant, listPhoneNumbers as vapiListPhoneNumbers, listCalls as vapiListCalls } from "./services/vapiClient.js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const VAPI_KEY = process.env.VAPI_API_KEY;
const ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
const PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID;
const MONGODB_URI = process.env.MONGODB_URI;
let USE_MEMORY_STORE = process.env.FORCE_MEMORY_STORE === "1" || !MONGODB_URI;
const USE_VAPI = Boolean(VAPI_KEY && ASSISTANT_ID && PHONE_NUMBER_ID);

// Restore MongoDB connection with safe fallback to in-memory store
if (!USE_MEMORY_STORE) {
  mongoose
    .connect(MONGODB_URI, { dbName: "vapi_demo" })
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => {
      console.error("MongoDB connection error", err?.message || err);
      USE_MEMORY_STORE = true;
      console.log("Falling back to in-memory store (non-persistent). Set FORCE_MEMORY_STORE=1 to silence this.");
    });
} else {
  console.log(
    "Using in-memory store (non-persistent).\nSet MONGODB_URI in backend/.env or unset FORCE_MEMORY_STORE to enable persistence."
  );
}

// Health
app.get("/api/health", (_req, res) => {
  res.json({ 
    ok: true, 
    db: USE_MEMORY_STORE ? "memory" : "mongo", 
    vapi: USE_VAPI,
    config: {
      hasVapiKey: Boolean(VAPI_KEY),
      hasAssistantId: Boolean(ASSISTANT_ID),
      hasPhoneNumberId: Boolean(PHONE_NUMBER_ID)
    }
  });
});

// Public config for frontend (no secrets)
app.get("/api/config", (_req, res) => {
  res.json({
    vapiConfigured: USE_VAPI,
    assistantId: ASSISTANT_ID || null,
    phoneNumberId: PHONE_NUMBER_ID || null,
  });
});

// Models (for MongoDB mode)
const contactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phoneNumber: { type: String, required: true }
  },
  { timestamps: true }
);

const callSchema = new mongoose.Schema(
  {
    vapiCallId: { type: String, index: true },
    contact: { type: mongoose.Schema.Types.ObjectId, ref: "Contact" },
    name: String,
    phoneNumber: String,
    status: { type: String, default: "initiated" },
    transcript: mongoose.Schema.Types.Mixed
  },
  { timestamps: true }
);

const Contact = mongoose.models.Contact || mongoose.model("Contact", contactSchema);
const Call = mongoose.models.Call || mongoose.model("Call", callSchema);

// In-memory fallback store
const memory = {
  contacts: [],
  calls: []
};

const generateId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// Function to format phone number to E.164 format
function formatPhoneToE164(phoneNumber, defaultCountryCode = '92') {
  if (!phoneNumber) return null;
  
  let cleanNumber = phoneNumber.replace(/[^\d+]/g, '');
  
  if (cleanNumber.startsWith('+')) {
    const digits = cleanNumber.slice(1);
    if (digits.length >= 7 && digits.length <= 15 && /^\d+$/.test(digits)) {
      return cleanNumber;
    }
    return null;
  }
  
  const digitsOnly = cleanNumber.replace(/\+/g, '');
  
  if (digitsOnly.length === 0) return null;
  
  console.log(`Processing digits: "${digitsOnly}"`);
  
  if (digitsOnly.startsWith('92')) {
    if (digitsOnly.length >= 12 && digitsOnly.length <= 13) {
      return `+${digitsOnly}`;
    }
  }
  
  if (digitsOnly.startsWith('03')) {
    if (digitsOnly.length === 11) {
      return `+92${digitsOnly.substring(1)}`;
    }
  }
  
  if (digitsOnly.startsWith('3') && digitsOnly.length === 10) {
    return `+92${digitsOnly}`;
  }
  
  if (digitsOnly.startsWith('0') && digitsOnly.length >= 10) {
    return `+92${digitsOnly.substring(1)}`;
  }
  
  if (digitsOnly.length === 10 && !digitsOnly.startsWith('0') && !digitsOnly.startsWith('3')) {
    return `+1${digitsOnly}`;
  } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return `+${digitsOnly}`;
  }
  
  if (digitsOnly.length >= 7 && digitsOnly.length <= 12) {
    return `+${defaultCountryCode}${digitsOnly}`;
  }
  
  return null;
}

async function updateCallByVapiId(vapiCallId, update) {
  if (USE_MEMORY_STORE) {
    const idx = memory.calls.findIndex((c) => c.vapiCallId === vapiCallId);
    if (idx > -1) Object.assign(memory.calls[idx], update);
    return memory.calls[idx];
  }
  return Call.findOneAndUpdate({ vapiCallId }, update, { new: true });
}

async function getCallByVapiId(vapiCallId) {
  if (USE_MEMORY_STORE) {
    return memory.calls.find((c) => c.vapiCallId === vapiCallId) || null;
  }
  return Call.findOne({ vapiCallId });
}

// Extract best-effort transcript text from Vapi getCall response
function parseTranscriptFromVapiCall(callData) {
  if (!callData || typeof callData !== "object") return null;

  if (typeof callData.transcript === "string" && callData.transcript.trim()) {
    return callData.transcript.trim();
  }

  // Aggregate messages text if present
  if (Array.isArray(callData.messages)) {
    const parts = [];
    for (const msg of callData.messages) {
      if (!msg) continue;
      if (typeof msg.text === "string" && msg.text.trim()) {
        parts.push(msg.text.trim());
        continue;
      }
      if (Array.isArray(msg.content)) {
        const c = msg.content
          .map((p) => {
            if (typeof p === "string") return p;
            if (p && typeof p === "object") return p.text || p.value || "";
            return "";
          })
          .filter(Boolean)
          .join(" ")
          .trim();
        if (c) parts.push(c);
      }
    }
    if (parts.length > 0) return parts.join("\n");
  }

  // Fallbacks commonly seen
  if (Array.isArray(callData.turns)) {
    const t = callData.turns
      .map((t) => (typeof t?.text === "string" ? t.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
    if (t) return t;
  }

  if (Array.isArray(callData.events)) {
    const e = callData.events
      .map((e) => e?.transcript || e?.text || "")
      .filter((s) => typeof s === "string" && s.trim())
      .join("\n");
    if (e.trim()) return e.trim();
  }

  // Additional common shapes observed across providers / API versions
  const moreCandidates = [
    callData.finalTranscript,
    callData.fullTranscript,
    Array.isArray(callData.transcripts) ? callData.transcripts.join("\n") : null,
    callData.summary?.transcript,
    callData.summary?.text,
    callData.analysis?.transcript,
    callData.analysis?.text,
    Array.isArray(callData.dialog) ? callData.dialog.join("\n") : null,
    Array.isArray(callData.conversation) ? callData.conversation.join("\n") : null,
    typeof callData.log === "string" ? callData.log : null,
  ];
  const found = moreCandidates.find((s) => typeof s === "string" && s.trim().length > 0);
  if (found) return found.trim();

  return null;
}

function isTerminalCallStatus(status) {
  if (!status || typeof status !== "string") return false;
  const s = status.toLowerCase();
  return [
    "completed",
    "ended",
    "failed",
    "no-answer",
    "busy",
    "canceled",
    "cancelled"
  ].includes(s);
}

function startPollingVapiCall(callId) {
  const MAX_MS = Number(process.env.VAPI_POLL_MAX_MS || 180000); // 3 minutes
  const INTERVAL_MS = Number(process.env.VAPI_POLL_INTERVAL_MS || 3000);
  const GRACE_MS = Number(process.env.VAPI_POLL_GRACE_MS || 15000); // keep polling a bit after end
  const startedAt = Date.now();
  let terminalSeenAt = null;

  async function tick() {
    try {
      const data = await vapiGetCall(callId);
      const status = data?.status;

      // Update status if present
      if (status) {
        await updateCallByVapiId(callId, { status });
      }

      // Append transcript if we can extract anything new
      const incomingText = parseTranscriptFromVapiCall(data);
      if (incomingText && incomingText.trim()) {
        const existing = await getCallByVapiId(callId);
        const previous = typeof existing?.transcript === "string" ? existing.transcript : "";

        let nextTranscript;
        if (!previous) {
          nextTranscript = incomingText;
        } else if (incomingText.length > previous.length && incomingText.includes(previous)) {
          // Monotonic growth from API, prefer the longer aggregate
          nextTranscript = incomingText;
        } else if (!previous.includes(incomingText)) {
          // New chunk, append
          nextTranscript = `${previous}\n${incomingText}`;
        }

        if (nextTranscript && nextTranscript !== previous) {
          await updateCallByVapiId(callId, { transcript: nextTranscript });
        }
      }

      if (isTerminalCallStatus(status) && terminalSeenAt === null) {
        terminalSeenAt = Date.now();
      }

      const exceeded = Date.now() - startedAt > MAX_MS;
      const graceExceeded = terminalSeenAt !== null && Date.now() - terminalSeenAt > GRACE_MS;
      if ((isTerminalCallStatus(status) && graceExceeded) || exceeded) {
        return; // stop polling
      }
    } catch (err) {
      // Keep polling despite transient errors
    }
    setTimeout(tick, INTERVAL_MS);
  }

  // Start without awaiting
  setTimeout(tick, INTERVAL_MS);
}

// Contacts
app.post("/api/contacts", async (req, res) => {
  try {
    const { name, phoneNumber } = req.body;
    if (!name || !phoneNumber) {
      return res.status(400).json({ error: "name and phoneNumber are required" });
    }
    if (USE_MEMORY_STORE) {
      const contact = { _id: generateId(), name, phoneNumber, createdAt: new Date().toISOString() };
      memory.contacts.unshift(contact);
      return res.json(contact);
    }
    const contact = await Contact.create({ name, phoneNumber });
    res.json(contact);
  } catch (error) {
    console.error("Create contact error:", error?.message || error);
    res.status(500).json({ error: "Failed to create contact" });
  }
});

app.get("/api/contacts", async (_req, res) => {
  try {
    if (USE_MEMORY_STORE) {
      return res.json(memory.contacts);
    }
    const contacts = await Contact.find().sort({ createdAt: -1 });
    res.json(contacts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch contacts" });
  }
});

// Build assistant overrides from environment
function getAssistantOverridesFromEnv() {
  const overrides = {};

  const firstMessage = process.env.VAPI_FIRST_MESSAGE;
  const systemMessage = process.env.VAPI_SYSTEM_MESSAGE;

  if (firstMessage) overrides.firstMessage = firstMessage;
  if (systemMessage) overrides.systemMessage = systemMessage;

  const voiceProvider = process.env.VAPI_VOICE_PROVIDER;
  const voiceId = process.env.VAPI_VOICE_ID;

  if (voiceProvider && voiceId) {
    overrides.voice = {
      provider: voiceProvider,
      voiceId: voiceId,
    };

    const stability = process.env.VAPI_VOICE_STABILITY;
    const similarityBoost = process.env.VAPI_VOICE_SIMILARITY_BOOST;
    const style = process.env.VAPI_VOICE_STYLE;
    const useSpeakerBoost = process.env.VAPI_VOICE_USE_SPEAKER_BOOST;

    if (stability) overrides.voice.stability = Number(stability);
    if (similarityBoost) overrides.voice.similarityBoost = Number(similarityBoost);
    if (style) overrides.voice.style = Number(style);
    if (useSpeakerBoost) overrides.voice.useSpeakerBoost = useSpeakerBoost === "1" || useSpeakerBoost === "true";
  }

  const silenceTimeout = process.env.VAPI_SILENCE_TIMEOUT_SECONDS;
  const maxDuration = process.env.VAPI_MAX_DURATION_SECONDS;
  const recordingEnabled = process.env.VAPI_RECORDING_ENABLED;
  const endCallFunctionEnabled = process.env.VAPI_END_CALL_FUNCTION_ENABLED;

  if (silenceTimeout) overrides.silenceTimeoutSeconds = Number(silenceTimeout);
  if (maxDuration) overrides.maxDurationSeconds = Number(maxDuration);
  if (recordingEnabled) overrides.recordingEnabled = recordingEnabled === "1" || recordingEnabled === "true";
  if (endCallFunctionEnabled) overrides.endCallFunctionEnabled = endCallFunctionEnabled === "1" || endCallFunctionEnabled === "true";

  return overrides;
}

// ENHANCED CALL CREATION WITH BETTER CONFIGURATION
async function createCallRouteHandler(req, res) {
  try {
    const { contactId, phoneNumber, name } = req.body;

    let resolvedName = name;
    let resolvedNumber = phoneNumber;
    let resolvedContactId = contactId;

    if (contactId) {
      if (USE_MEMORY_STORE) {
        const contact = memory.contacts.find((c) => c._id === contactId);
        if (!contact) return res.status(404).json({ error: "Contact not found" });
        resolvedName = contact.name;
        resolvedNumber = contact.phoneNumber;
      } else {
        const contact = await Contact.findById(contactId);
        if (!contact) return res.status(404).json({ error: "Contact not found" });
        resolvedName = contact.name;
        resolvedNumber = contact.phoneNumber;
      }
    }

    if (!resolvedNumber || !resolvedName) {
      return res.status(400).json({ error: "Provide contactId or both name and phoneNumber" });
    }

    const formattedNumber = formatPhoneToE164(resolvedNumber);
    if (!formattedNumber) {
      return res.status(400).json({ 
        error: `Invalid phone number format: "${resolvedNumber}". Please use E.164 format like +1234567890` 
      });
    }

    console.log(`Formatting phone number: "${resolvedNumber}" -> "${formattedNumber}"`);

    let data;
    if (USE_VAPI) {
      try {
        // Allow request-level overrides to temporarily customize the assistant
        const requestOverrides = (req.body && req.body.assistantOverrides && typeof req.body.assistantOverrides === 'object')
          ? req.body.assistantOverrides
          : {};

        // Merge env overrides (as defaults) with request overrides (as specific per-call changes)
        const envOverrides = getAssistantOverridesFromEnv();
        const mergedOverrides = { ...envOverrides, ...requestOverrides };

        const payload = {
          type: "outboundPhoneCall",
          assistantId: ASSISTANT_ID,
          phoneNumberId: PHONE_NUMBER_ID,
          customer: {
            number: formattedNumber,
            name: resolvedName
          },
        };

        // Ensure the assistant will talk: if no firstMessage anywhere, apply a gentle default
if (!mergedOverrides.firstMessage) {
  mergedOverrides.firstMessage = process.env.VAPI_FIRST_MESSAGE || "Hello! This is your AI assistant calling.";
}
// Only include assistantOverrides if we have at least one override
if (Object.keys(mergedOverrides).length > 0) {
  payload.assistantOverrides = mergedOverrides;
}

        console.log("=== ENHANCED VAPI CALL PAYLOAD ===");
        console.log(JSON.stringify(payload, null, 2));
        console.log("==================================");
        data = await createOutboundCall(payload);
        console.log("✅ Vapi call initiated successfully:", data);
        
        // IMMEDIATE STATUS CHECK AFTER 5 SECONDS
        setTimeout(async () => {
          try {
            const statusData = await vapiGetCall(data.id);
            console.log(`📞 Call ${data.id} status after 5s:`, statusData.status);
            console.log(`📞 Full call details:`, JSON.stringify(statusData, null, 2));
            // Persist status immediately so UI reflects progress even if webhook lags
            if (statusData?.status) {
              await updateCallByVapiId(data.id, { status: statusData.status });
            }
            // Also persist any available transcript early
            const earlyTranscript = parseTranscriptFromVapiCall(statusData);
            if (earlyTranscript && earlyTranscript.trim()) {
              const existing = await getCallByVapiId(data.id);
              const previousText = typeof existing?.transcript === "string" ? existing.transcript : "";
              const nextText = previousText
                ? (earlyTranscript.length > previousText.length && earlyTranscript.includes(previousText)
                    ? earlyTranscript
                    : `${previousText}\n${earlyTranscript}`)
                : earlyTranscript;
              if (nextText !== previousText) {
                await updateCallByVapiId(data.id, { transcript: nextText });
                console.log(`📝 Early transcript saved (len=${nextText.length})`);
              }
            }
          } catch (err) {
            console.error("Failed to check call status:", err.message);
          }
        }, 5000);

        // Start polling as a fallback in case webhooks are delayed or unreachable
        try {
          startPollingVapiCall(data.id);
        } catch {}
        
      } catch (err) {
        console.error("❌ Vapi call failed:");
        console.error("Status:", err.response?.status);
        console.error("Status Text:", err.response?.statusText);
        console.error("Response Data:", JSON.stringify(err.response?.data, null, 2));
        console.error("Message:", err.message);
        
        return res.status(500).json({
          error: "Vapi call failed",
          details: {
            status: err.response?.status,
            statusText: err.response?.statusText,
            data: err.response?.data,
            message: err.message
          }
        });
      }
    } else {
      console.log("Using mock call - Missing Vapi credentials");
      data = { id: `mock_${generateId()}` };
    }

    // Store call in database
    let created;
    if (USE_MEMORY_STORE) {
      created = {
        _id: generateId(),
        vapiCallId: data.id,
        contact: resolvedContactId || null,
        phoneNumber: resolvedNumber,
        name: resolvedName,
        status: "initiated",
        transcript: null,
        createdAt: new Date().toISOString()
      };
      memory.calls.unshift(created);
    } else {
      created = await Call.create({
        vapiCallId: data.id,
        contact: resolvedContactId || undefined,
        phoneNumber: resolvedNumber,
        name: resolvedName,
        status: "initiated",
        transcript: null
      });
    }

    res.json({ ...data, local: created });
  } catch (error) {
    console.error("Create call error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to create call" });
  }
}

app.post("/api/calls", createCallRouteHandler);

// ENHANCED WEBHOOK HANDLER WITH DETAILED LOGGING AND NORMALIZATION
app.post("/api/vapi/webhook", async (req, res) => {
  try {
    const event = req.body || {};

    const normalizedType = normalizeVapiEventType(event.type);
    const vapiId = extractCallIdFromEvent(event);

    console.log("🔔 === VAPI WEBHOOK RECEIVED ===");
    console.log("Timestamp:", new Date().toISOString());
    console.log("Event Type:", event.type, "=>", normalizedType);
    console.log("Call ID:", vapiId);
    console.log("Full Event:", JSON.stringify(event, null, 2));
    console.log("===============================");

    if (!vapiId) {
      console.log("⚠️ No call ID found in webhook event");
      return res.sendStatus(200);
    }

    const { statusUpdate, transcriptUpdate } = deriveStatusAndTranscript(event);

    // Additional logging for important milestones
    if (normalizedType === "call-started") {
      console.log("📞 Call started - Assistant should begin talking now");
    } else if (normalizedType === "call-ended") {
      console.log("📞 Call ended", event.endedReason ? `- Reason: ${event.endedReason}` : "");
    } else if (normalizedType === "function-call") {
      console.log("⚡ Function call:", event.functionCall);
    } else if (normalizedType === "speech-update") {
      console.log("🗣️ Speech update - Role:", event.role, "Status:", event.status);
    } else {
      console.log("📋 Event:", normalizedType);
    }

    // Update database
    const update = {};
    if (statusUpdate) update.status = statusUpdate;
    if (event.status && !update.status) update.status = event.status;

    // Append transcript updates instead of overwriting to ensure UI shows full conversation
    if (transcriptUpdate) {
      const existing = await getCallByVapiId(vapiId);
      const previousText = typeof existing?.transcript === "string" ? existing.transcript : "";
      update.transcript = previousText
        ? `${previousText}\n${transcriptUpdate}`
        : transcriptUpdate;
    }

    if (Object.keys(update).length > 0) {
      await updateCallByVapiId(vapiId, update);
      console.log("💾 Updated call in database:", update);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook error:", err);
    res.sendStatus(200);
  }
});

// View call history
app.get("/api/calls", async (_req, res) => {
  try {
    if (USE_MEMORY_STORE) {
      return res.json(memory.calls);
    }
    const calls = await Call.find().populate("contact").sort({ createdAt: -1 });
    res.json(calls);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch calls" });
  }
});

// DIAGNOSTIC ENDPOINTS

// 1. Test assistant configuration
app.get("/api/test/assistant", async (req, res) => {
  try {
    if (!VAPI_KEY || !ASSISTANT_ID) {
      return res.status(400).json({ error: "Vapi credentials not configured" });
    }

    const assistant = await vapiGetAssistant(ASSISTANT_ID);
    
    const diagnostics = {
      assistantId: ASSISTANT_ID,
      hasModel: !!assistant.model,
      hasVoice: !!assistant.voice,
      hasFirstMessage: !!assistant.firstMessage,
      model: assistant.model,
      voice: assistant.voice,
      firstMessage: assistant.firstMessage,
      systemMessage: assistant.systemMessage,
      status: "Assistant configuration looks good"
    };

    const issues = [];
    if (!assistant.model) issues.push("❌ No model configured");
    if (!assistant.voice) issues.push("❌ No voice configured");
    if (!assistant.firstMessage) issues.push("❌ No first message - assistant might not start talking");
    if (!assistant.systemMessage) issues.push("⚠️ No system message - might cause unexpected behavior");

    if (issues.length > 0) {
      diagnostics.status = "Issues found";
      diagnostics.issues = issues;
    }

    console.log("🔧 Assistant diagnostics:", diagnostics);
    res.json(diagnostics);
  } catch (error) {
    console.error("Assistant test failed:", error.response?.data || error.message);
    res.status(500).json({ 
      error: "Assistant test failed",
      details: error.response?.data || error.message
    });
  }
});

// 2. Get full assistant configuration (default to current assistant)
app.get("/api/vapi/assistant", async (req, res) => {
  try {
    if (!VAPI_KEY) {
      return res.status(400).json({ error: "Vapi API key not configured" });
    }

    const assistant = await vapiGetAssistant(ASSISTANT_ID);
    console.log("Assistant configuration:", JSON.stringify(assistant, null, 2));
    res.json(assistant);
  } catch (error) {
    console.error("Failed to fetch assistant:", error.response?.data || error.message);
    res.status(500).json({ 
      error: "Failed to fetch assistant",
      details: error.response?.data || error.message
    });
  }
});

// 2b. Get specific assistant configuration by ID
app.get("/api/vapi/assistant/:id", async (req, res) => {
  try {
    if (!VAPI_KEY) {
      return res.status(400).json({ error: "Vapi API key not configured" });
    }

    const assistantId = req.params.id;
    const assistant = await vapiGetAssistant(assistantId);
    console.log("Assistant configuration:", JSON.stringify(assistant, null, 2));
    res.json(assistant);
  } catch (error) {
    console.error("Failed to fetch assistant:", error.response?.data || error.message);
    res.status(500).json({ 
      error: "Failed to fetch assistant",
      details: error.response?.data || error.message
    });
  }
});

// 3. Get detailed call information
app.get("/api/debug/call/:callId", async (req, res) => {
  try {
    if (!VAPI_KEY) {
      return res.status(400).json({ error: "Vapi API key not configured" });
    }

    const callId = req.params.callId;
    const call = await vapiGetCall(callId);
    console.log("🔍 Call debug info:", JSON.stringify(call, null, 2));
    res.json(call);
  } catch (error) {
    console.error("Failed to fetch call details:", error.response?.data || error.message);
    res.status(500).json({ 
      error: "Failed to fetch call details",
      details: error.response?.data || error.message
    });
  }
});

// 4. Get phone numbers from Vapi
app.get("/api/vapi/phone-numbers", async (req, res) => {
  try {
    if (!VAPI_KEY) {
      return res.status(400).json({ error: "Vapi API key not configured" });
    }

    const phoneNumbers = await vapiListPhoneNumbers();
    console.log("Available Vapi phone numbers:", phoneNumbers);
    res.json(phoneNumbers);
  } catch (error) {
    console.error("Failed to fetch Vapi phone numbers:", error.response?.data || error.message);
    res.status(500).json({ 
      error: "Failed to fetch Vapi phone numbers",
      details: error.response?.data || error.message
    });
  }
});

// 5. Get calls from Vapi API directly
app.get("/api/vapi/calls", async (req, res) => {
  try {
    if (!USE_VAPI) {
      return res.status(400).json({ error: "Vapi not configured" });
    }

    const calls = await vapiListCalls();
    res.json(calls);
  } catch (error) {
    console.error("Failed to fetch Vapi calls:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch Vapi calls" });
  }
});

// 6. Test phone number formatting
app.post("/api/test-phone", (req, res) => {
  const { phoneNumber } = req.body;
  const formatted = formatPhoneToE164(phoneNumber);
  
  res.json({
    original: phoneNumber,
    formatted: formatted,
    isValid: formatted !== null,
    examples: {
      pakistani: "03001234567 -> +923001234567",
      us: "1234567890 -> +11234567890"
    }
  });
});

// Enhanced logging for debugging
console.log("=== Vapi Configuration Check ===");
console.log("VAPI_API_KEY:", VAPI_KEY ? `Set (${VAPI_KEY.substring(0, 10)}...)` : "Missing");
console.log("VAPI_ASSISTANT_ID:", ASSISTANT_ID ? `Set (${ASSISTANT_ID})` : "Missing");
console.log("VAPI_PHONE_NUMBER_ID:", PHONE_NUMBER_ID ? `Set (${PHONE_NUMBER_ID})` : "Missing");
// Also log if any overrides present
const _overrides = getAssistantOverridesFromEnv();
console.log("Assistant overrides from env present:", Object.keys(_overrides).length > 0);
console.log("USE_VAPI:", USE_VAPI);
console.log("================================");

app.listen(5000, () => {
  console.log("🚀 Server running on http://localhost:5000");
  console.log("\n🔧 DEBUGGING ENDPOINTS:");
  console.log("- GET /api/test/assistant - Test your assistant configuration");
  console.log("- GET /api/vapi/assistant - Get full assistant config");
  console.log("- GET /api/debug/call/:callId - Get detailed call information");
  console.log("- GET /api/vapi/phone-numbers - List your phone numbers");
  console.log("- POST /api/test-phone - Test phone number formatting");
  console.log("\n📞 TO TROUBLESHOOT YOUR ISSUE:");
  console.log("1. First run: GET /api/test/assistant");
  console.log("2. After making a call, run: GET /api/debug/call/YOUR_CALL_ID");
  console.log("3. Check your Vapi dashboard for assistant configuration");
});