import { useState, useEffect } from "react";

function App() {
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [history, setHistory] = useState([]);

  const fetchHistory = async () => {
    const res = await fetch("http://localhost:5000/api/calls");
    setHistory(await res.json());
  };

  const createCall = async () => {
    await fetch("http://localhost:5000/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumber: number, name })
    });
    fetchHistory();
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  return (
    <div style={{ padding: "20px" }}>
      <h1>Vapi Demo</h1>
      <input
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />{" "}
      <input
        placeholder="Phone Number"
        value={number}
        onChange={(e) => setNumber(e.target.value)}
      />{" "}
      <button onClick={createCall}>Create Call</button>

      <h2>Call History</h2>
      <table border="1" cellPadding="5">
        <thead>
          <tr>
            <th>Name</th>
            <th>Number</th>
            <th>Status</th>
            <th>Transcript</th>
          </tr>
        </thead>
        <tbody>
          {history.map((call) => (
            <tr key={call.id}>
              <td>{call.name}</td>
              <td>{call.phoneNumber}</td>
              <td>{call.status}</td>
              <td>{call.transcript || "N/A"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;
