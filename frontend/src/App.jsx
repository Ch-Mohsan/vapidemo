import { useEffect, useState } from "react";

const API_BASE = "http://localhost:5000";

function App() {
  const [contacts, setContacts] = useState([]);
  const [calls, setCalls] = useState([]);

  const [newName, setNewName] = useState("");
  const [newNumber, setNewNumber] = useState("");

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

  const addContact = async () => {
    if (!newName || !newNumber) return;
    await fetch(`${API_BASE}/api/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, phoneNumber: newNumber })
    });
    setNewName("");
    setNewNumber("");
    fetchContacts();
  };

  const createCallForContact = async (contactId) => {
    await fetch(`${API_BASE}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId })
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
      <h1>Vapi Demo</h1>

      <section style={{ marginBottom: 24 }}>
        <h2>Add Contact</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            placeholder="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            placeholder="Phone Number"
            value={newNumber}
            onChange={(e) => setNewNumber(e.target.value)}
          />
          <button onClick={addContact}>Add</button>
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Contacts</h2>
        <table border="1" cellPadding="6" width="100%">
          <thead>
            <tr>
              <th>Name</th>
              <th>Number</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c._id}>
                <td>{c.name}</td>
                <td>{c.phoneNumber}</td>
                <td>
                  <button onClick={() => createCallForContact(c._id)}>Call</button>
                </td>
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr>
                <td colSpan={3} style={{ textAlign: "center" }}>
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
                <td>{call.phoneNumber}</td>
                <td>{call.status}</td>
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
