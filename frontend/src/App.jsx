import { useEffect, useState } from "react";

const API_BASE = "http://localhost:5000";

function App() {
  const [contacts, setContacts] = useState([]);
  const [calls, setCalls] = useState([]);
  const [config, setConfig] = useState(null);

  const [newName, setNewName] = useState("");
  const [newNumber, setNewNumber] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [userLocation, setUserLocation] = useState(null);
  const [countryCode, setCountryCode] = useState("+92"); // Default to Pakistan

  // Detect user location and set appropriate country code
  useEffect(() => {
    // Load backend config
    fetch(`${API_BASE}/api/config`).then(r => r.json()).then(setConfig).catch(() => setConfig({ vapiConfigured: false }));

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setUserLocation({ latitude, longitude });
          
          // Pakistan coordinates approximation
          // Pakistan is roughly between 24-37°N and 61-75°E
          if (latitude >= 24 && latitude <= 37 && longitude >= 61 && longitude <= 75) {
            setCountryCode("+92");
            console.log("Location detected: Pakistan - Using country code +92");
          } else {
            // You can add more country detection logic here
            console.log("Location detected outside Pakistan - Using default +92");
          }
        },
        (error) => {
          console.log("Geolocation error:", error.message);
          // Default to Pakistan since user is in Bahawalpur, Punjab, PK
          setCountryCode("+92");
        }
      );
    } else {
      console.log("Geolocation not supported");
      setCountryCode("+92");
    }
  }, []);

  const fetchContacts = async () => {
    const res = await fetch(`${API_BASE}/api/contacts`);
    const data = await res.json();
    setContacts(data);
  };

  const fetchCalls = async () => {
    const res = await fetch(`${API_BASE}/api/calls`);
    const data = await res.json();
    setCalls(data);
  };

  // Function to validate Pakistani phone numbers specifically
  const validatePakistaniPhone = (phone) => {
    if (!phone) return false;
    
    const digitsOnly = phone.replace(/\D/g, '');
    
    // Pakistani mobile numbers
    if (phone.startsWith('+92')) {
      // +923001234567 format (13 digits total)
      return digitsOnly.length === 12 && digitsOnly.startsWith('923');
    } else if (phone.startsWith('03')) {
      // 03001234567 format (11 digits)
      return digitsOnly.length === 11 && /^03[0-9]{9}$/.test(digitsOnly);
    } else if (phone.startsWith('3') && !phone.startsWith('03')) {
      // 3001234567 format (10 digits)
      return digitsOnly.length === 10 && /^3[0-9]{9}$/.test(digitsOnly);
    }
    
    return false;
  };

  // Function to validate phone numbers (Pakistan focused)
  const validatePhoneNumber = (phone) => {
    if (!phone) return false;
    
    // First try Pakistani format
    if (validatePakistaniPhone(phone)) return true;
    
    // Remove all non-digit characters except +
    const cleaned = phone.replace(/[^\d+]/g, '');
    
    // If starts with +, check it has 8-16 total characters (+ plus 7-15 digits)
    if (cleaned.startsWith('+')) {
      const digits = cleaned.slice(1);
      return digits.length >= 7 && digits.length <= 15 && /^\d+$/.test(digits);
    }
    
    // Otherwise just check digits
    const digitsOnly = cleaned.replace(/\+/g, '');
    return digitsOnly.length >= 7 && digitsOnly.length <= 15;
  };

  const formatPhoneForDisplay = (phone) => {
    if (!phone) return '';
    
    // Remove all non-digit characters except +
    let cleanNumber = phone.replace(/[^\d+]/g, '');
    
    // If already starts with +, return as is
    if (cleanNumber.startsWith('+')) {
      return cleanNumber;
    }
    
    // Remove any + that might be in the middle
    const digitsOnly = cleanNumber.replace(/\+/g, '');
    
    // Pakistan number formats
    if (digitsOnly.startsWith('92')) {
      return `+${digitsOnly}`;
    } else if (digitsOnly.startsWith('03') || digitsOnly.startsWith('3')) {
      let mobileNumber = digitsOnly;
      if (digitsOnly.startsWith('3') && !digitsOnly.startsWith('03')) {
        mobileNumber = '0' + digitsOnly;
      }
      if (mobileNumber.startsWith('03')) {
        return `+92${mobileNumber.slice(1)}`;
      }
    } else if (digitsOnly.startsWith('0')) {
      return `+92${digitsOnly.slice(1)}`;
    }
    
    // US format (for testing)
    if (digitsOnly.length === 10) {
      return `+1${digitsOnly}`;
    } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
      return `+${digitsOnly}`;
    }
    
    // Default to Pakistan
    return `+92${digitsOnly}`;
  };

  const generateTestPakistaniNumber = () => {
    const networks = [
      { name: "Jazz", prefixes: ["0300", "0301", "0302", "0303", "0304", "0305"] },
      { name: "Telenor", prefixes: ["0345", "0346", "0347", "0348", "0349"] },
      { name: "Zong", prefixes: ["0310", "0311", "0312", "0313", "0314", "0315"] },
      { name: "Ufone", prefixes: ["0330", "0331", "0332", "0333", "0334", "0335"] }
    ];
    
    const randomNetwork = networks[Math.floor(Math.random() * networks.length)];
    const randomPrefix = randomNetwork.prefixes[Math.floor(Math.random() * randomNetwork.prefixes.length)];
    const randomSuffix = Math.floor(1000000 + Math.random() * 9000000); // 7 digits
    
    const testNumber = `${randomPrefix}${randomSuffix}`;
    setNewNumber(testNumber);
    setPhoneError("");
    
    console.log(`Generated ${randomNetwork.name} test number: ${testNumber}`);
  };

  const handlePhoneChange = (e) => {
    const value = e.target.value;
    setNewNumber(value);
    
    if (value && !validatePhoneNumber(value)) {
      if (validatePakistaniPhone(value)) {
        setPhoneError("");
      } else {
        setPhoneError("Enter a valid Pakistani mobile number (e.g., +923001234567, 03001234567, or 3001234567)");
      }
    } else {
      setPhoneError("");
    }
  };

  const testPhoneFormat = async (phoneNumber) => {
    try {
      const response = await fetch(`${API_BASE}/api/test-phone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber })
      });
      const result = await response.json();
      console.log("Phone format test:", result);
      return result;
    } catch (error) {
      console.error("Error testing phone format:", error);
      return null;
    }
  };

  const addContact = async () => {
    if (!newName || !newNumber) return;
    
    if (!validatePhoneNumber(newNumber)) {
      setPhoneError("Please enter a valid phone number");
      return;
    }
    
    // Test the phone number format before adding
    const formatTest = await testPhoneFormat(newNumber);
    if (formatTest && !formatTest.isValid) {
      setPhoneError(`Invalid format: ${formatTest.original} -> ${formatTest.formatted || 'null'}`);
      return;
    }
    
    const response = await fetch(`${API_BASE}/api/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, phoneNumber: newNumber })
    });
    
    if (!response.ok) {
      const error = await response.json();
      setPhoneError(error.error || "Failed to add contact");
      return;
    }
    
    setNewName("");
    setNewNumber("");
    setPhoneError("");
    fetchContacts();
  };

  const [overrideFirstMessage, setOverrideFirstMessage] = useState("");
  const [overrideSystemMessage, setOverrideSystemMessage] = useState("");

  const createCallForContact = async (contactId) => {
    const assistantOverrides = {};
    if (overrideFirstMessage.trim()) assistantOverrides.firstMessage = overrideFirstMessage.trim();
    if (overrideSystemMessage.trim()) assistantOverrides.systemMessage = overrideSystemMessage.trim();

    await fetch(`${API_BASE}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, assistantOverrides })
    });
    fetchCalls();
  };

  useEffect(() => {
    fetchContacts();
    fetchCalls();
    const interval = setInterval(fetchCalls, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif", maxWidth: 900, margin: "0 auto" }}>
      <h1>Vapi Demo - Pakistan 🇵🇰</h1>
      {config && (
        <div style={{
          margin: "12px 0",
          padding: "10px",
          borderRadius: 4,
          background: config.vapiConfigured ? "#e8f5e9" : "#fff3cd",
          color: config.vapiConfigured ? "#1b5e20" : "#856404",
          fontSize: 14
        }}>
          {config.vapiConfigured ? (
            <>✅ Vapi configured. Assistant: <code>{config.assistantId}</code></>
          ) : (
            <>⚠️ Vapi not fully configured. Set `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, and `VAPI_PHONE_NUMBER_ID` in `backend/.env`.</>
          )}
        </div>
      )}
      
      {userLocation && (
        <div style={{ 
          background: "#e8f5e8", 
          padding: "10px", 
          borderRadius: "4px", 
          marginBottom: "20px",
          fontSize: "14px"
        }}>
          📍 Location detected: Using country code {countryCode} for Pakistani numbers
        </div>
      )}

      <section style={{ marginBottom: 24 }}>
        <h2>Add Contact</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", width: "100%" }}>
            <input
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ flex: 1 }}
            />
            <input
              placeholder="Phone Number (e.g., +923001234567 or 03001234567)"
              value={newNumber}
              onChange={handlePhoneChange}
              style={{ 
                flex: 2,
                borderColor: phoneError ? "#ff4444" : undefined
              }}
            />
            <button 
              onClick={addContact}
              disabled={!newName || !newNumber || phoneError}
              style={{ 
                backgroundColor: (!newName || !newNumber || phoneError) ? "#ccc" : "#28a745",
                color: "white",
                border: "none",
                padding: "8px 16px",
                cursor: (!newName || !newNumber || phoneError) ? "not-allowed" : "pointer"
              }}
            >
              Add Contact
            </button>
            <button 
              onClick={generateTestPakistaniNumber}
              style={{ 
                backgroundColor: "#17a2b8",
                color: "white",
                border: "none",
                padding: "8px 16px",
                cursor: "pointer",
                marginLeft: "8px"
              }}
              title="Generate a test Pakistani mobile number"
            >
              🇵🇰 Generate Test Number
            </button>
          </div>
          {phoneError && (
            <div style={{ color: "#ff4444", fontSize: "14px" }}>
              {phoneError}
            </div>
          )}
          <div style={{ fontSize: "12px", color: "#666" }}>
            🇵🇰 <strong>Pakistani Mobile Networks:</strong><br/>
            • <strong>Jazz/Warid:</strong> 0300-0305, 0320-0329<br/>
            • <strong>Telenor:</strong> 0345-0349<br/>
            • <strong>Zong:</strong> 0310-0315<br/>
            • <strong>Ufone:</strong> 0330-0335<br/>
            <em>Formats: +923001234567, 03001234567, or 3001234567</em>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Assistant Overrides (optional)</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          <textarea
            placeholder="First message the assistant will speak"
            value={overrideFirstMessage}
            onChange={(e) => setOverrideFirstMessage(e.target.value)}
            rows={2}
            style={{ width: "100%" }}
          />
          <textarea
            placeholder="System message to guide assistant behavior"
            value={overrideSystemMessage}
            onChange={(e) => setOverrideSystemMessage(e.target.value)}
            rows={2}
            style={{ width: "100%" }}
          />
          <div style={{ fontSize: 12, color: "#666" }}>
            If not provided, the backend will use environment defaults (see `backend/.env`).
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Contacts</h2>
        <table border="1" cellPadding="6" width="100%">
          <thead>
            <tr>
              <th>Name</th>
              <th>Number</th>
              <th>Formatted for Vapi</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c._id}>
                <td>{c.name}</td>
                <td>{c.phoneNumber}</td>
                <td style={{ fontFamily: "monospace", color: "#0066cc" }}>
                  {formatPhoneForDisplay(c.phoneNumber)}
                </td>
                <td>
                  <button onClick={() => createCallForContact(c._id)}>Call</button>
                </td>
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: "center" }}>
                  No contacts yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Call History</h2>
        <table border="1" cellPadding="6" width="100%">
          <thead>
            <tr>
              <th>When</th>
              <th>Name</th>
              <th>Number</th>
              <th>Status</th>
              <th>Transcript</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call) => (
              <tr key={call._id || call.vapiCallId}>
                <td>{call.createdAt ? new Date(call.createdAt).toLocaleString() : "-"}</td>
                <td>{call.name}</td>
                <td style={{ fontFamily: "monospace" }}>{call.phoneNumber}</td>
                <td>
                  <span style={{
                    padding: "4px 8px",
                    borderRadius: "4px",
                    fontSize: "12px",
                    fontWeight: "bold",
                    backgroundColor: 
                      call.status === "completed" ? "#d4edda" :
                      call.status === "in-progress" ? "#fff3cd" :
                      call.status === "ringing" ? "#cce7ff" : "#f8d7da",
                    color:
                      call.status === "completed" ? "#155724" :
                      call.status === "in-progress" ? "#856404" :
                      call.status === "ringing" ? "#004085" : "#721c24"
                  }}>
                    {call.status}
                  </span>
                </td>
                <td style={{ maxWidth: 400, whiteSpace: "pre-wrap" }}>
                  {typeof call.transcript === "string"
                    ? call.transcript
                    : call.transcript
                    ? JSON.stringify(call.transcript)
                    : "N/A"}
                </td>
              </tr>
            ))}
            {calls.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center" }}>
                  No calls yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default App;