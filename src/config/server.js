// @ts-nocheck
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { runSqlFile } = require("../utils/oracleUtils.js");
const oracledb = require("oracledb");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// =============================================================
// ⚙️ Configuración base
// =============================================================
const dbConnections = JSON.parse(
  fs.readFileSync(path.join(__dirname, "dbConnections.json"), "utf-8")
);
const ambientesConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, "ambientes.json"), "utf-8")
);

// =============================================================
// 🧩 Helper para rutas SQL
// =============================================================
function sqlPath(file) {
  return path.resolve(__dirname, "../../sql", file);
}

// =============================================================
// 🧠 Manejador SSE (canales separados por runId)
// =============================================================
let clientsBySession = {}; // { runId: [res, res...] }

app.get("/api/logs/:runId", (req, res) => {
  const { runId } = req.params;

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (!clientsBySession[runId]) clientsBySession[runId] = [];
  clientsBySession[runId].push(res);

  console.log(`📡 Cliente conectado al canal de logs [${runId}]`);

  req.on("close", () => {
    clientsBySession[runId] = clientsBySession[runId].filter((c) => c !== res);
    console.log(`❌ Cliente desconectado del canal [${runId}]`);
  });
});

function sendLog(message, runId = "GLOBAL") {
  const cleanMsg = message
    .replace(/^\[GLOBAL\]\s*/g, "")
    .replace(/^\[[A-Z0-9_]+\]\s*/g, "")
    .trim();

  const prefix = runId !== "GLOBAL" ? `${runId}` : "";
  const finalMsg = prefix ? `${prefix} ${cleanMsg}`.trim() : cleanMsg;

  if (process.env.NODE_ENV !== "production") console.log(finalMsg);

  if (!sendLog.lastMsg) sendLog.lastMsg = {};
  if (sendLog.lastMsg[runId] === finalMsg) return;
  sendLog.lastMsg[runId] = finalMsg;

  if (clientsBySession[runId]) {
    clientsBySession[runId].forEach((res) => res.write(`data: ${finalMsg}\n\n`));
  }
}

// =============================================================
// 📋 Listar bases y ambientes
// =============================================================
app.get("/api/databases", (req, res) =>
  res.json(dbConnections.map((db) => db.name))
);
app.get("/api/ambientes", (req, res) => res.json(ambientesConfig));

// =============================================================
// 📅 Validar F8
// =============================================================
app.get("/api/validar-f8", async (req, res) => {
  let connection;
  try {
    sendLog("📡 Consultando fecha Oracle para validar F8...", "GLOBAL");

    const connInfo = dbConnections.find((db) => db.name === "OPT") || dbConnections[0];
    if (!connInfo) {
      sendLog("❌ No hay configuración de conexión en dbConnections.json", "GLOBAL");
      return res.json({ ok: false, message: "Sin configuración DB" });
    }

    connection = await oracledb.getConnection({
      user: "system",
      password: "system",
      connectString: connInfo.connectString,
    });

    const sql = `
      SELECT TO_CHAR(MAX(FEC_HOY), 'DD/MM/YYYY') AS FECHA
      FROM CALENDARIOS
      WHERE COD_SISTEMA = 'CC'
    `;
    sendLog("📄 Ejecutando consulta: " + sql.replace(/\s+/g, " "), "GLOBAL");

    const result = await connection.execute(sql);
    if (!result.rows || result.rows.length === 0) {
      sendLog("⚠️ No se encontró fecha en CALENDARIOS (CC)", "GLOBAL");
      return res.json({ ok: false, message: "No se encontró fecha" });
    }

    const fechaStr = result.rows[0][0];
    const [dia, mes, anio] = fechaStr.split("/").map(Number);
    const fecha = new Date(anio, mes - 1, dia);
    const diaSemana = fecha.getDay();
    const ultimoDiaMes = new Date(anio, mes, 0).getDate();
    const esViernes = diaSemana === 5;
    const finDeMes = dia === ultimoDiaMes;

    sendLog(`📅 Fecha Oracle: ${fechaStr} → Viernes=${esViernes}, FinDeMes=${finDeMes}`, "GLOBAL");
    res.json({ ok: true, esViernes, finDeMes, fecha_db: fechaStr });
  } catch (err) {
    sendLog(`❌ Error validando F8: ${err.message}`, "GLOBAL");
    res.status(500).json({ ok: false, message: err.message });
  } finally {
    if (connection) {
      try {
        await connection.close();
        sendLog("🔌 Conexión Oracle cerrada.", "GLOBAL");
      } catch (cerr) {
        sendLog("⚠️ Error cerrando conexión: " + cerr.message, "GLOBAL");
      }
    }
  }
});

// =============================================================
// ▶️ Ejecutar cierre principal
// =============================================================
app.post("/api/run-cierre", async (req, res) => {
  try {
    const { baseDatos, ambiente, procesos, usarPreF4 } = req.body;
    const runId = baseDatos;
    const dbConfig = dbConnections.find((db) => db.name === baseDatos);
    if (!dbConfig) return res.status(400).json({ error: "Base de datos no encontrada" });

    sendLog(`▶️ Iniciando cierre`, runId);
    sendLog(`Ambiente: ${ambiente}`, runId);
    sendLog(`Base de Datos: ${baseDatos}`, runId);
    sendLog(`Procesos seleccionados: ${procesos.join(", ")}`, runId);
    sendLog(`Usar pre-f4.sql: ${usarPreF4 ? "✅ Activado" : "🚫 Desactivado"}`, runId);
    sendLog(`ConnectString: ${dbConfig.connectString}`, runId);

    // ---- SQL inicial ----
    try {
      sendLog(`📦 Quitando prerequisitos...`, runId);
      await runSqlFile(sqlPath("clear-pre.sql"), dbConfig.connectString);
      sendLog(`✅ clear-pre.sql ejecutado correctamente`, runId);

      sendLog(`📦 Activando Comunica en linea...`, runId);
      await runSqlFile(sqlPath("Comunica_en_linea.sql"), dbConfig.connectString);
      sendLog(`✅ Comunica_en_linea en estado S`, runId);
    } catch (err) {
      sendLog(`❌ Error ejecutando SQL inicial: ${err.message}`, runId);
      throw err;
    }

    // ---- Lanzar Playwright ----
    const testPath = fs.existsSync(path.resolve(__dirname, "../../tests/test_cierre.spec.js"))
      ? "tests/test_cierre.spec.js"
      : "tests/test_cierre.spec.ts";

    sendLog(`▶️ Lanzando automatización Playwright...`, runId);

    const child = spawn(
      "npx",
      ["playwright", "test", testPath, "--reporter=null", "--project=edge"],
      {
        cwd: path.resolve(__dirname, "../.."),
        shell: true,
        windowsHide: true,
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          AMBIENTE: ambiente,
          BASE_DATOS: baseDatos,
          PROCESOS: procesos.join(","),
          USAR_PRE_F4: usarPreF4 ? "true" : "false",
          RUN_ID: runId,
        },
      }
    );

    // 🧹 Limpieza de salida de consola
    function cleanAnsi(str) {
      return str
        .replace(/\x1B\[[0-9;]*[A-Za-z]/g, "")
        .replace(/\[\d+\/\d+\].*/g, "")
        .replace(/\r/g, "")
        .replace(/^\s+|\s+$/g, "")
        .trim();
    }

    const handleOutput = (data, prefix = "") => {
      data
        .toString()
        .split(/\r?\n/)
        .map((line) => cleanAnsi(line))
        .filter(Boolean)
        .forEach((line) => {
          const finalLine = prefix ? `${prefix} ${line}` : line;
          sendLog(finalLine, runId);
        });
    };

    child.stdout.on("data", (data) => handleOutput(data));
    child.stderr.on("data", (data) => handleOutput(data, "❌"));

    child.on("close", (code) => {
      sendLog(
        code === 0
          ? `✅ Automatización completada correctamente (código ${code})`
          : `⚠️ Playwright finalizó con código ${code}`,
        runId
      );
    });

    res.json({ ok: true, message: "Cierre iniciado con Playwright (Edge)", runId });
  } catch (err) {
    console.error(err);
    sendLog(`❌ Error ejecutando cierre: ${err.message}`, "GLOBAL");
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// 📜 Ejecutar script puntual
// =============================================================
// =============================================================
// 📜 Ejecutar script puntual (archivo o inline)
// =============================================================
app.post("/api/run-script", async (req, res) => {
  try {
    const { baseDatos, script, sqlInline, connectString } = req.body;
    const runId = baseDatos;
    const dbConfig =
      dbConnections.find((db) => db.name === baseDatos) || { connectString };

    if (!dbConfig || !dbConfig.connectString) {
      return res.status(400).json({ error: "Base de datos no encontrada o sin connectString" });
    }

    // --- INLINE MODE ---
    if (script === "inline" && sqlInline) {
      sendLog(`📦 Ejecutando SQL inline...`, runId);
      const { runSqlInline } = require("../utils/oracleUtils.js");
      const ok = await runSqlInline(sqlInline, dbConfig.connectString);
      if (ok) {
        sendLog(`✅ SQL inline ejecutado correctamente`, runId);
        return res.json({ ok: true, message: "SQL inline ejecutado correctamente" });
      } else {
        sendLog(`❌ Error ejecutando SQL inline`, runId);
        return res.status(500).json({ ok: false, message: "Error ejecutando SQL inline" });
      }
    }

    // --- FILE MODE ---
    sendLog(`📦 Ejecutando script solicitado: ${script}...`, runId);
    const filePath = path.join(__dirname, "../../sql", script);
    if (!fs.existsSync(filePath)) {
      sendLog(`❌ Archivo no encontrado: ${filePath}`, runId);
      return res.status(404).json({ error: `Archivo no encontrado: ${filePath}` });
    }

    await runSqlFile(filePath, dbConfig.connectString);
    sendLog(`✅ Script ${script} ejecutado correctamente`, runId);
    res.json({ ok: true, message: `Script ${script} ejecutado` });
  } catch (err) {
    sendLog(`❌ Error ejecutando script: ${err.message}`, "GLOBAL");
    res.status(500).json({ error: err.message });
  }
});


// =============================================================
// 🌐 Servir frontend
// =============================================================
app.use(express.static(path.join(__dirname, "../../public")));
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "../../public/frontend.html"))
);

// =============================================================
// 🖥️ Iniciar servidor
// =============================================================
const PORT = 4000;
app
  .listen(PORT, () =>
    console.log(`🚀 Servidor backend corriendo en http://localhost:${PORT}`)
  )
  .on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log(`⚠️ El puerto ${PORT} ya está en uso.`);
      process.exit(0);
    } else {
      console.error("❌ Error iniciando servidor:", err);
      process.exit(1);
    }
  });
