# Vapi Demo (Contacts + Calls + MongoDB)

This demo lets you:
- Add contacts (name + phone number)
- Store them in MongoDB (or use an in-memory fallback if no Mongo is configured)
- Select a contact to initiate a Vapi call
- Receive webhook updates from Vapi and display call status/transcript in the UI

## Stack
- Backend: Node.js + Express
- DB: MongoDB via Mongoose (optional in-memory fallback)
- Frontend: React + Vite

## Prerequisites
- Node.js 18+
- MongoDB (local or Atlas). If you don't have MongoDB, the backend will fall back to a non-persistent in-memory store.
- A Vapi account with an Assistant ready. You'll need:
  - Vapi API Key
  - Assistant ID
  - Phone Number ID (the Vapi phone number to place outbound calls from)

## Setup

1) Backend env vars

Copy `backend/.env.example` to `backend/.env` and fill in:

```
MONGODB_URI=mongodb://localhost:27017/vapi_demo  # or your Mongo Atlas URI
VAPI_API_KEY=your_vapi_api_key
VAPI_ASSISTANT_ID=your_assistant_id
VAPI_PHONE_NUMBER_ID=your_vapi_phone_number_id
```

Optional (assistant overrides and behavior):
```
# Defaults used if your Vapi Assistant is missing them
VAPI_FIRST_MESSAGE=Hello! This is your AI assistant calling.
# VAPI_SYSTEM_MESSAGE=You are a helpful phone assistant for outbound calls.

# Voice (only used if both provider and voice id are set)
# VAPI_VOICE_PROVIDER=11labs
# VAPI_VOICE_ID=rachel
# VAPI_VOICE_STABILITY=0.5
# VAPI_VOICE_SIMILARITY_BOOST=0.8
# VAPI_VOICE_STYLE=0.0
# VAPI_VOICE_USE_SPEAKER_BOOST=true

# Call behavior
# VAPI_SILENCE_TIMEOUT_SECONDS=30
# VAPI_MAX_DURATION_SECONDS=300
# VAPI_RECORDING_ENABLED=true
# VAPI_END_CALL_FUNCTION_ENABLED=true
```

If `MONGODB_URI` is omitted, the backend uses an in-memory store (not persisted). Use MongoDB for persistence.

2) Install dependencies

```
cd backend && npm i
cd ../frontend && npm i
```

3) Run backend

```
cd backend
npm run dev
# Server runs on http://localhost:5000
```

4) Run frontend

```
cd frontend
npm run dev
# Vite will show a local URL (e.g., http://localhost:5173)
```

5) Configure Vapi webhook

Expose your backend to the internet (for webhooks) using a tunnel like ngrok:

```
ngrok http 5000
```

Set your Vapi Assistant's webhook URL to:

```
https://<your-ngrok-subdomain>.ngrok.io/api/vapi/webhook
```

Vapi will POST call events to this endpoint. The backend updates call records and the UI will reflect changes.

## API Summary

- POST `/api/contacts` { name, phoneNumber }
- GET `/api/contacts`
- POST `/api/calls` { contactId } | { name, phoneNumber }
  - Optional: `assistantOverrides` can be provided per-call
- GET `/api/calls`
- POST `/api/vapi/webhook` (Vapi -> Backend)

## Troubleshooting the assistant "not talking"
- Ensure your Vapi Assistant has a voice and a non-empty `firstMessage` configured in the Vapi dashboard.
- Or set `VAPI_FIRST_MESSAGE` and voice env vars in `backend/.env` to force overrides.
- Use backend diagnostics:
  - `GET /api/test/assistant` – checks model, voice, firstMessage, systemMessage
  - After initiating a call: `GET /api/debug/call/:CALL_ID`

## Notes
- CORS is enabled for development. Adjust as needed for production.
- In-memory mode is helpful for quick demos but does not persist data.