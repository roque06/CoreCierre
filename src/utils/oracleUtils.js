// @ts-nocheck
const oracledb = require("oracledb");
const fs = require("fs");
const path = require("path");
const { logConsole, logWeb } = require("./logger.js");


// =============================================================
// 🔧 Inicializar Oracle Instant Client (modo Thick garantizado)
// =============================================================
(() => {
  try {
    const clientDir = "C:\\instantclient_21_13";
    const dllPath = path.join(clientDir, "oci.dll");

    if (!process.env.PATH.includes("instantclient_21_13")) {
      process.env.PATH = `${clientDir};${process.env.PATH}`;
      process.env.LD_LIBRARY_PATH = clientDir;
      process.env.ORACLE_HOME = clientDir;
    }

    if (!fs.existsSync(dllPath)) {
      console.error(`❌ No se encontró oci.dll en ${clientDir}`);
      return;
    }

    if (!oracledb.oracleClientVersionString) {
      oracledb.initOracleClient({ libDir: clientDir });
      console.log("✅ Oracle Instant Client inicializado correctamente.");
    } else {
      console.log(`ℹ️ Cliente Oracle ya inicializado (v${oracledb.oracleClientVersionString}).`);
    }

    if (oracledb.thin) {
      console.warn("⚠️ node-oracledb está en modo THIN.");
    } else {
      console.log("🟢 node-oracledb en modo THICK — soporte completo habilitado.");
    }
  } catch (err) {
    console.error("❌ Error inicializando Oracle Client:", err.message);
  }
})();

// =============================================================
// 🧩 Ejecutar un archivo SQL local (compatible con PL/SQL y F4 viernes)
// =============================================================
async function runSqlFile(filePath, connectString) {
  let connection;
  try {
    let sql = fs.readFileSync(path.resolve(filePath), "utf-8");
    sql = sql.replace(/\r/g, "").replace(/^\uFEFF/, "").replace(/\/\s*$/m, "").trim();

    console.log(`▶️ Ejecutando script: ${filePath}`);
    connection = await oracledb.getConnection({
      user: "system",
      password: "system",
      connectString,
    });

    if (/^\s*(DECLARE|BEGIN)/i.test(sql)) {
      await connection.execute(sql, [], { autoCommit: true });
    } else {
      const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        await connection.execute(stmt, [], { autoCommit: true });
      }
    }

    console.log(`✅ Script ejecutado correctamente: ${filePath}`);
    return true;
  } catch (err) {
    console.error(`❌ Error ejecutando script ${path.basename(filePath)}:`, err.message || err);
    return false;
  } finally {
    if (connection) {
      try { await connection.close(); } catch (closeErr) { console.error("⚠️ Error cerrando conexión:", closeErr.message); }
    }
  }
}

// =============================================================
// 🧩 Ejecutar SQL directo (inline)
// =============================================================
async function runSqlInline(sql, connectString) {
  let connection;
  try {
    if (!sql || !sql.trim()) return false;
    connection = await oracledb.getConnection({
      user: "system",
      password: "system",
      connectString,
    });
    sql = sql.replace(/\r/g, "").replace(/\/\s*$/m, "").trim();
    await connection.execute(sql, [], { autoCommit: true });
    console.log("✅ SQL inline ejecutado correctamente.");
    return true;
  } catch (err) {
    console.error("❌ Error ejecutando SQL inline:", err.message);
    return false;
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) { console.error("⚠️ Error cerrando conexión:", err.message); }
    }
  }
}

// =============================================================
// 🧠 Funciones especializadas para monitorear jobs Oracle (F4)
// =============================================================

/**
 * 🔎 Retorna todos los jobs activos del esquema PA (excepto perpetuos)
 */
async function listarJobsPA(connectString) {
  let conn;
  try {
    conn = await oracledb.getConnection({ user: "system", password: "system", connectString });
    const res = await conn.execute(`
      SELECT job_name 
      FROM all_scheduler_running_jobs 
      WHERE owner = 'PA' 
        AND job_name LIKE 'JOB_%'
        AND job_name NOT LIKE '%JOB_CIERRE_DIARIO_SCHEDULER%'`);
    return res.rows.map((r) => r[0]);
  } catch (err) {
    console.error("❌ Error listando jobs activos:", err.message);
    return [];
  } finally {
    if (conn) await conn.close().catch(() => { });
  }
}

/**
 * ⏱️ Esperar indefinidamente a que un job termine (sin timeout)
 */
async function esperarJobEspecifico(connectString, jobName, baseDatos = "GLOBAL") {
  let conn;
  try {
    conn = await oracledb.getConnection({ user: "system", password: "system", connectString });
    const inicio = Date.now();
    console.log(`PT 🧠 [${baseDatos}] Monitoreando job Oracle: ${jobName} (espera indefinida)...`);

    let ultimoLog = 0;
    while (true) {
      const res = await conn.execute(
        `SELECT COUNT(*) 
           FROM all_scheduler_running_jobs 
          WHERE owner='PA' 
            AND job_name = :jobName 
            AND job_name NOT LIKE '%JOB_CIERRE_DIARIO_SCHEDULER%'`,
        [jobName]
      );

      const activos = res.rows[0][0];
      const minutos = ((Date.now() - inicio) / 60000).toFixed(1);

      if (activos === 0) {
        console.log(`PT ✅ [${baseDatos}] Job ${jobName} finalizó correctamente (${minutos} min).`);
        break;
      }

      const minInt = Math.floor((Date.now() - inicio) / 60000);
      if (minInt % 2 === 0 && minInt !== ultimoLog) {
        console.log(`PT ⏳ [${baseDatos}] Job ${jobName} aún activo (${minutos} min)...`);
        ultimoLog = minInt;
      }

      await new Promise((r) => setTimeout(r, 30000));
    }

    return true;
  } catch (err) {
    console.error(`PT ❌ [${baseDatos}] Error monitoreando job: ${err.message}`);
    return false;
  } finally {
    if (conn) await conn.close().catch((err) => console.error(`PT ⚠️ [${baseDatos}] Error cerrando conexión: ${err.message}`));
  }
}


/**
 * 🧩 Detectar un nuevo job
 */
async function detectarNuevoJob(connectString, prevJobs) {
  let conn;
  try {
    conn = await oracledb.getConnection({ user: "system", password: "system", connectString });
    for (let i = 0; i < 10; i++) {
      const res = await conn.execute(`
        SELECT job_name 
        FROM all_scheduler_running_jobs 
        WHERE owner='PA' 
          AND job_name LIKE 'JOB_%'
          AND job_name NOT LIKE '%JOB_CIERRE_DIARIO_SCHEDULER%'`);
      const actuales = res.rows.map((r) => r[0]);
      const nuevo = actuales.find((j) => !prevJobs.includes(j));
      if (nuevo) return nuevo;
      await new Promise((r) => setTimeout(r, 2000));
    }
    return null;
  } catch (err) {
    console.error("❌ Error detectando job:", err.message);
    return null;
  } finally {
    if (conn) await conn.close().catch(() => { });
  }
}



async function monitorearF4Job(connectString, baseDatos, runId = "GLOBAL", modoEspera = false) {
  try {
    let jobs = [];

    // 🔁 Reintentos hasta detectar jobs activos
    for (let intento = 1; intento <= 10; intento++) {
      jobs = await listarJobsPA(connectString);
      if (jobs.length > 0) break;
      logConsole(`⏳ Esperando aparición de job Oracle... intento ${intento}`, runId);
      await new Promise(r => setTimeout(r, 5000));
    }

    if (jobs.length === 0) {
      logConsole("🚫 No hay jobs Oracle activos — continúa el flujo normal.", runId);
      return false;
    }

    // 🧩 Filtrar solo jobs válidos del cierre
    const jobsFiltrados = jobs.filter(
      (j) =>
        !j.toUpperCase().includes("JOB_CIERRE_DIARIO_SCHEDULER") &&
        !j.toUpperCase().includes("JOB_P_VAL_DOC_LEGAL_PER_MORAL") &&
        !j.toUpperCase().includes("JOB_INACTIVA_CLIENTES")
    );

    if (jobsFiltrados.length === 0) {
      logConsole("🚫 Solo se detectaron jobs no relevantes (omitidos).", runId);
      return false;
    }

    logConsole(`🧩 Jobs detectados: ${jobsFiltrados.join(", ")}`, runId);

    // 🔄 Espera activa si modoEspera = true
    if (modoEspera) {
      logConsole("⏳ Esperando finalización de jobs Oracle activos...", runId);
      for (const job of jobsFiltrados) {
        await esperarJobEspecifico(connectString, job, baseDatos);
      }
      logConsole("✅ Todos los jobs Oracle finalizaron correctamente.", runId);
    }

    logConsole("Control devuelto al proceso principal.", runId);
    return true;
  } catch (err) {
    logConsole(`❌ Error monitoreando job Oracle: ${err.message}`, runId);
    return false;
  }
}



// =============================================================
// ✅ Exportar todas las funciones
// =============================================================
module.exports = {
  runSqlFile,
  runSqlInline,
  listarJobsPA,
  esperarJobEspecifico,
  detectarNuevoJob,
  monitorearF4Job,
};
