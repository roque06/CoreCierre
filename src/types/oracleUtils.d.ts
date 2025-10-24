// @ts-nocheck
const oracledb = require("oracledb");
const fs = require("fs");
const path = require("path");

// ⚠️ Ajusta la ruta de Oracle Instant Client si lo usas en Windows
// oracledb.initOracleClient({ libDir: "C:\\instantclient_21_13" });

async function runSqlFile(filePath, connectString) {
  let connection;
  try {
    const sql = fs.readFileSync(path.resolve(filePath), "utf-8");

    connection = await oracledb.getConnection({
      user: "system",        // 🔑 Ajusta según tu usuario
      password: "system",    // 🔑 Ajusta según tu password
      connectString,         // 🔑 Pasado desde el backend (dbConnections.json)
    });

    console.log(`▶️ Ejecutando script: ${filePath}`);

    // 👇 aquí activamos autoCommit
    await connection.execute(sql, [], { autoCommit: true });

    console.log(`✅ Script ejecutado correctamente: ${filePath}`);
    await connection.close();
    return true;
  } catch (err) {
    console.error(`❌ Error ejecutando ${filePath}:`, err.message);
    if (connection) {
      try {
        await connection.close();
      } catch (e) {
        console.error("Error cerrando la conexión:", e.message);
      }
    }
    throw err;
  }
}

module.exports = {
  runSqlFile,
};
