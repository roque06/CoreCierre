import { useEffect, useState } from "react";

export default function LogsPanel() {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    const evtSource = new EventSource("http://localhost:4000/api/logs");

    evtSource.onmessage = (event) => {
      setLogs((prev) => [...prev, event.data]);
    };

    return () => evtSource.close();
  }, []);

  function getStyle(message) {
    if (message.includes("✅"))
      return "bg-green-100 text-green-800 font-semibold";
    if (message.includes("❌"))
      return "bg-red-100 text-red-800 font-semibold";
    if (message.includes("⏳") || message.includes("⌛"))
      return "bg-yellow-100 text-yellow-700 font-semibold";
    if (message.includes("📦"))
      return "bg-gray-100 text-gray-800 italic";
    return "bg-blue-50 text-blue-800";
  }

  return (
    <div className="flex flex-col h-screen">
      <header className="bg-blue-900 text-white p-4 text-lg font-bold">
        🔹 Panel de Ejecución - Cierre Bancario
      </header>

      <div className="flex-1 overflow-y-auto p-4 bg-white border-t-4 border-blue-900">
        {logs.map((log, idx) => (
          <div
            key={idx}
            className={`p-2 my-1 rounded-lg text-sm ${getStyle(log)}`}
          >
            {log}
          </div>
        ))}
      </div>
    </div>
  );
}
