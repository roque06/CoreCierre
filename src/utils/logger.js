// =============================================================
// 📜 Logger sin duplicados en consola y web
// =============================================================
let clients = [];

// Registrar cliente SSE
function registerClient(res) {
  clients.push(res);
}

// Remover cliente SSE
function unregisterClient(res) {
  clients = clients.filter((c) => c !== res);
}

// 🔹 Solo consola local (sin enviar a la web)
function logConsole(msg) {
  console.log(msg); // ✅ se imprime solo una vez
}

// 🔹 Solo frontend (sin imprimir también en consola)
function logWeb(msg) {
  clients.forEach((res) => res.write(`data: ${msg}\n\n`)); // ✅ solo web, no console.log
}

module.exports = {
  registerClient,
  unregisterClient,
  logConsole,
  logWeb,
};
// pruebas
