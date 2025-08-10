import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const VAPI_KEY = process.env.VAPI_API_KEY;
const ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;

let callsHistory = []; // Temporary in-memory storage

// Create call
app.post("/api/calls", async (req, res) => {
  try {
    const { phoneNumber, name } = req.body;

    const { data } = await axios.post(
      "https://api.vapi.ai/calls",
      {
        assistantId: ASSISTANT_ID,
        customer: { number: phoneNumber, name }
      },
      {
        headers: {
          Authorization: `Bearer ${VAPI_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    // Store in our local history
    callsHistory.push({
      id: data.id,
      phoneNumber,
      name,
      status: "initiated",
      transcript: null
    });

    res.json(data);
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: "Failed to create call" });
  }
});

// Webhook for Vapi to send updates
app.post("/api/vapi/webhook", (req, res) => {
  const event = req.body;

  // Find & update in-memory record
  const callIndex = callsHistory.findIndex(c => c.id === event.id);
  if (callIndex > -1) {
    callsHistory[callIndex].status = event.status;
    callsHistory[callIndex].transcript = event.transcript || callsHistory[callIndex].transcript;
  }

  console.log("Vapi Event:", event);
  res.sendStatus(200);
});

// View call history
app.get("/api/calls", (req, res) => {
  res.json(callsHistory);
});

app.listen(5000, () => console.log("Server running on http://localhost:5000"));
