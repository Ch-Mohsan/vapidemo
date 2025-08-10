import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const VAPI_KEY = process.env.VAPI_API_KEY;
const ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
const MONGODB_URI = process.env.MONGODB_URI;
let USE_MEMORY_STORE = process.env.FORCE_MEMORY_STORE === "1" || !MONGODB_URI;
const USE_VAPI = Boolean(VAPI_KEY && ASSISTANT_ID);

if (!USE_MEMORY_STORE) {
  mongoose
    .connect(MONGODB_URI, { dbName: "vapi_demo" })
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => {
      console.error("MongoDB connection error", err?.message || err);
      USE_MEMORY_STORE = true;
      console.log("Falling back to in-memory store (non-persistent).");
    });
} else {
  console.log(
    "Using in-memory store (non-persistent).\nSet MONGODB_URI in backend/.env or unset FORCE_MEMORY_STORE to enable persistence."
  );
}

// Health
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, db: USE_MEMORY_STORE ? "memory" : "mongo", vapi: USE_VAPI });
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

async function updateCallByVapiId(vapiCallId, update) {
  if (USE_MEMORY_STORE) {
    const idx = memory.calls.findIndex((c) => c.vapiCallId === vapiCallId);
    if (idx > -1) Object.assign(memory.calls[idx], update);
    return memory.calls[idx];
  }
  return Call.findOneAndUpdate({ vapiCallId }, update, { new: true });
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

// Create call
app.post("/api/calls", async (req, res) => {
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

    let data;
    if (USE_VAPI) {
      const response = await axios.post(
        "https://api.vapi.ai/calls",
        {
          assistantId: ASSISTANT_ID,
          customer: { number: resolvedNumber, name: resolvedName }
        },
        {
          headers: {
            Authorization: `Bearer ${VAPI_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );
      data = response.data;
    } else {
      // Mock Vapi call in dev w/o credentials
      data = { id: `mock_${generateId()}` };
      setTimeout(() => {
        updateCallByVapiId(data.id, { status: "ringing" });
      }, 1000);
      setTimeout(() => {
        updateCallByVapiId(data.id, {
          status: "completed",
          transcript: "Hello! This is a mock transcript from the demo."
        });
      }, 3000);
    }

    if (USE_MEMORY_STORE) {
      const created = {
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
      return res.json({ ...data, local: created });
    }

    const created = await Call.create({
      vapiCallId: data.id,
      contact: resolvedContactId || undefined,
      phoneNumber: resolvedNumber,
      name: resolvedName,
      status: "initiated",
      transcript: null
    });

    res.json({ ...data, local: created });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: "Failed to create call" });
  }
});

// Webhook for Vapi to send updates
app.post("/api/vapi/webhook", async (req, res) => {
  try {
    const event = req.body || {};
    const vapiId = event.id;
    if (!vapiId) return res.sendStatus(200);

    if (USE_MEMORY_STORE) {
      const idx = memory.calls.findIndex((c) => c.vapiCallId === vapiId);
      if (idx > -1) {
        if (event.status) memory.calls[idx].status = event.status;
        if (event.transcript !== undefined) memory.calls[idx].transcript = event.transcript;
      }
      console.log("Vapi Event:", event);
      return res.sendStatus(200);
    }

    const update = {};
    if (event.status) update.status = event.status;
    if (event.transcript !== undefined) update.transcript = event.transcript;

    await Call.findOneAndUpdate({ vapiCallId: vapiId }, update, { new: true });

    console.log("Vapi Event:", event);
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
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

app.listen(5000, () => console.log("Server running on http://localhost:5000"));
