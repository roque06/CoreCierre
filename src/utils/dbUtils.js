const fs = require("fs");
const path = require("path");

// cargamos conexiones de src/config/dbConnections.json
const dbConnections = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../config/dbConnections.json"), "utf-8")
);

/**
 * Devuelve la cadena de conexión de Oracle según el nombre de base de datos
 */
function getConnectString(baseDatos) {
  const dbConfig = dbConnections.find((db) => db.name === baseDatos);
  if (!dbConfig) {
    throw new Error(`❌ Base de datos no encontrada: ${baseDatos}`);
  }
  return dbConfig.connectString;
}

module.exports = { getConnectString };
