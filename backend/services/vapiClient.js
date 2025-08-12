import axios from "axios";

const VAPI_BASE_URL = "https://api.vapi.ai";
const VAPI_API_KEY = process.env.VAPI_API_KEY;

function getAuthHeaders() {
  if (!VAPI_API_KEY) {
    throw new Error("VAPI_API_KEY is not set in environment");
  }
  return { Authorization: `Bearer ${VAPI_API_KEY}` };
}

export async function createOutboundCall(payload) {
  const response = await axios.post(`${VAPI_BASE_URL}/call`, payload, {
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    timeout: 30000,
  });
  return response.data;
}

export async function getCall(callId) {
  const response = await axios.get(`${VAPI_BASE_URL}/call/${callId}`, {
    headers: getAuthHeaders(),
  });
  return response.data;
}

export async function getAssistant(assistantId) {
  const response = await axios.get(`${VAPI_BASE_URL}/assistant/${assistantId}`, {
    headers: getAuthHeaders(),
  });
  return response.data;
}

export async function listPhoneNumbers() {
  const response = await axios.get(`${VAPI_BASE_URL}/phone-number`, {
    headers: getAuthHeaders(),
  });
  return response.data;
}

export async function listCalls() {
  const response = await axios.get(`${VAPI_BASE_URL}/call`, {
    headers: getAuthHeaders(),
  });
  return response.data;
}