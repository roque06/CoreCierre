// @ts-nocheck
const oracledb = require("oracledb");
const path = require("path");
const fs = require("fs");
const { logConsole } = require("../utils/logger.js");


// --- Inicializar Oracle Client en modo THICK ---
try {
  const clientPath = "C:\\oracle\\instantclient_21_13";
  oracledb.initOracleClient({ libDir: path.resolve(clientPath) });
  console.log("✅ Oracle Client inicializado en modo THICK");
} catch (e) {
  console.warn("⚠ No se pudo inicializar Oracle Client:", e);
}

// --- Cargar conexiones disponibles ---
const dbConnections = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../config/dbConnections.json"), "utf-8")
);

// --- Crear carpeta logs si no existe ---
function asegurarCarpetaLogs() {
  const logsDir = path.join(__dirname, "../../logs");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  return path.join(logsDir, "fecha_instancia.log");
}

// --- Registrar información de auditoría ---
function registrarAuditoria(mensaje) {
  const logPath = asegurarCarpetaLogs();
  const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);
  fs.appendFileSync(logPath, `[${timestamp}] ${mensaje}\n`, "utf-8");
}

// --- Función principal ---
async function obtenerProcesosXPath(baseDatos) {
  const connInfo = dbConnections.find((db) => db.name === baseDatos);
  if (!connInfo) {
    const msg = `❌ No se encontró configuración de conexión para ${baseDatos}`;
    logConsole(msg);
    registrarAuditoria(msg);
    throw new Error(msg);
  }

  let connection;
  try {
    connection = await oracledb.getConnection({
      user: "system",
      password: "system",
      connectString: connInfo.connectString,
    });

    // 🔹 Consultar fecha contable real desde Oracle
    const result = await connection.execute(`
      SELECT 
        TO_CHAR(MAX(FEC_HOY), 'DY', 'NLS_DATE_LANGUAGE=ENGLISH') AS DIA,
        TO_CHAR(MAX(FEC_HOY), 'YYYY-MM-DD') AS FECHA,
        TO_CHAR(LAST_DAY(MAX(FEC_HOY)), 'YYYY-MM-DD') AS FIN_MES
      FROM CALENDARIOS
      WHERE COD_SISTEMA = 'CC'
    `);

    const dia = (result.rows?.[0]?.[0] || "").trim().toUpperCase();
    const fechaStr = result.rows?.[0]?.[1];
    const finMesStr = result.rows?.[0]?.[2];

    const esViernes = dia === "FRI";
    const esFinDeMes = fechaStr === finMesStr;

    const resumen = `📅 Fecha Oracle: ${fechaStr} (${dia}) | Viernes=${esViernes} | FinDeMes=${esFinDeMes} | DB=${baseDatos}`;
    logConsole(resumen);
    registrarAuditoria(resumen);

    // 🔹 Elegir archivo de XPaths según condición
    let procesosXPath;

    if (esViernes) {
      logConsole("📘 Es viernes → usando procesosxpathV.js");
      registrarAuditoria("📘 Es viernes → usando procesosxpathV.js");
      procesosXPath = require(path.join(__dirname, "procesosxpathV.js")).procesosXPathV;

    } else if (esFinDeMes) {
      logConsole("📙 Es fin de mes → usando procesosxpathM.js");
      registrarAuditoria("📙 Es fin de mes → usando procesosxpathM.js");
      procesosXPath = require(path.join(__dirname, "procesosxpathM.js")).procesosxpathM;

    } else {
      logConsole("📗 Día normal → usando procesosxpath.js");
      registrarAuditoria("📗 Día normal → usando procesosxpath.js");
      procesosXPath = require(path.join(__dirname, "procesosxpath.js")).procesosXPath;
    }

    return procesosXPath;

  } catch (err) {
    const errorMsg = `❌ Error al obtener fecha desde Oracle: ${err.message}`;
    logConsole(errorMsg);
    registrarAuditoria(errorMsg);
    throw err;
  } finally {
    if (connection) await connection.close().catch(() => {});
  }
}

module.exports = { obtenerProcesosXPath };
