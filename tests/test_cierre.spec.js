// @ts-nocheck
process.env.PATH = "C:\\instantclient_21_13;" + process.env.PATH;
process.env.LD_LIBRARY_PATH = "C:\\instantclient_21_13";
process.env.ORACLE_HOME = "C:\\instantclient_21_13";

const { test, chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { navegarConRetries, esperarCompletado } = require("../src/utils/navegacion.js");
const {
  ejecutarProceso,
  ejecutarPorHref,
  procesosEjecutadosGlobal,
  esperarHastaCompletado,
  ejecutarF4FechaMayor,
} = require("../src/utils/procesos.js");
const { logConsole, logWeb } = require("../src/utils/logger.js");

// --- Parámetros desde process.env ---
const ambiente = process.env.AMBIENTE || "";
const baseDatos = process.env.BASE_DATOS || "";
const procesos = (process.env.PROCESOS || "").split(",").filter(Boolean);
const runId = process.env.RUN_ID || "GLOBAL";

if (!ambiente || !baseDatos || procesos.length === 0) {
  console.error(`[${runId}] ❌ Faltan parámetros obligatorios (ambiente, baseDatos, procesos)`);
  process.exit(1);
}

// --- Cargar connectString desde dbConnections.json ---
const dbConnections = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../src/config/dbConnections.json"), "utf-8")
);
const conexion = dbConnections.find((db) => db.name === baseDatos);
if (!conexion) {
  console.error(`[${runId}] ❌ No se encontró configuración para la base de datos: ${baseDatos}`);
  process.exit(1);
}
const connectString = conexion.connectString;

// ============================================================
// 🧩 RUTA Y CONTROL DE ESTADO PERSISTENTE
// ============================================================
const cachePath = path.join(__dirname, "../src/cache/estado_persistente.json");
let estadoPersistente = {};

try {
  if (fs.existsSync(cachePath)) {
    estadoPersistente = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
  }

  // 🧹 Limpieza selectiva: solo elimina procesos completados
  if (!estadoPersistente[baseDatos]) estadoPersistente[baseDatos] = {};
  for (const [desc, estado] of Object.entries(estadoPersistente[baseDatos])) {
    if (estado === "COMPLETADO") delete estadoPersistente[baseDatos][desc];
  }

  logConsole(`🧩 Estado persistente cargado para ${baseDatos}`, runId);
} catch {
  estadoPersistente = {};
  logConsole(`⚠️ No se pudo leer estado persistente, se iniciará limpio.`, runId);
}

// 🧾 Guardar cambios de estado persistente
function actualizarEstadoPersistente(descripcion, estado) {
  if (!estadoPersistente[baseDatos]) estadoPersistente[baseDatos] = {};
  estadoPersistente[baseDatos][descripcion] = estado;
  fs.writeFileSync(cachePath, JSON.stringify(estadoPersistente, null, 2));
}

// ============================================================
// 🔄 Configuración general
// ============================================================
const ordenSistemas = ["PRE", "F2", "MTC", "F3", "MON", "F4", "F5", "F8", "FIN"];
const resumen = { total: 0, completados: 0, errores: 0, detalle: [] };
const inicioCierre = Date.now();
const fechaInicioCierre = new Date();

function parseFechaDMY(fechaTxt) {
  const [d, m, y] = fechaTxt.split("/").map(Number);
  return new Date(y, m - 1, d);
}

// ============================================================
// ▶️ TEST PRINCIPAL DE CIERRE
// ============================================================
test(`[${runId}] Cierre con selección de sistemas`, async () => {
  test.setTimeout(0);

  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    args: ["--start-maximized", "--disable-infobars", "--no-default-browser-check"],
  });

  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: null });
  const page = await context.newPage();

  logWeb(`▶️ Ejecutando cierre en ambiente=${ambiente}, DB=${baseDatos}, procesos=[${procesos}]`, runId);
  logConsole(`▶️ Ejecutando cierre en ambiente=${ambiente}, DB=${baseDatos}, procesos=[${procesos}]`, runId);

  // --- Login ---
  await navegarConRetries(page, ambiente);
  await page.locator("#NombreUsuario").fill("radames");
  await page.locator("#Password").fill("santa");
  await page.press("#Password", "Enter");
  await navegarConRetries(page, `${ambiente.replace(/\/$/, "")}/ProcesoCierre/Procesar`);

  let ultimoSistemaLogueado = null;
  global.__sistemasActivos = procesos.map(p => p.toUpperCase());
  logConsole(`📄 Sistemas activos definidos: ${global.__sistemasActivos.join(", ")}`, runId);

  // ============================================================
  // 🔁 Bucle principal
  // ============================================================
  while (true) {
    const filas = page.locator("tbody tr");
    const total = await filas.count();

    // --- Determinar sistema activo ---
    // 🔍 Determinar el siguiente sistema activo según orden fijo
    let sistemaActivo = null;

    for (const sis of ordenSistemas) {
      // Solo considera los sistemas seleccionados en el frontend
      if (!procesos.map(p => p.toUpperCase()).includes(sis)) continue;

      const hayPendientes = await filas.evaluateAll((trs, sis) => {
        return trs.some((tr) => {
          const tds = tr.querySelectorAll("td");
          if (tds.length < 8) return false;
          const sistema = tds[2]?.innerText.trim().toUpperCase();
          const estado = tds[9]?.innerText.trim().toUpperCase();
          return sistema === sis && /(PENDIENTE|EN PROCESO)/.test(estado);
        });
      }, sis);

      if (hayPendientes) {
        sistemaActivo = sis;
        break; // ✅ se detiene en el primero con pendientes en orden oficial
      }
    }


    if (!sistemaActivo) {
      logConsole("✅ No quedan procesos pendientes según configuración", runId);
      break;
    }

    if (sistemaActivo !== ultimoSistemaLogueado) {
      logConsole(`🔹 Sistema en ejecución: ${sistemaActivo}`, runId);
      ultimoSistemaLogueado = sistemaActivo;
    }

    // ============================================================
    // ▶️ Procesamiento de filas (adaptado para TODOS los procesos)
    // ============================================================
    for (let i = 0; i < total; i++) {
      const fila = filas.nth(i);
      const celdas = fila.locator("td");
      const sistema = (await celdas.nth(2).innerText().catch(() => "")).trim();
      const descripcion = (await celdas.nth(4).innerText().catch(() => "")).trim();
      const fecha = (await celdas.nth(6).innerText().catch(() => "")).trim();
      const estado = (await celdas.nth(9).innerText().catch(() => "")).trim();

      if (sistema !== sistemaActivo) continue;

      // 🔒 Control: si hay un proceso EN PROCESO visible
      if (estado.toUpperCase() === "EN PROCESO") {
        logConsole(`⏳ ${descripcion} está EN PROCESO — esperando finalización antes de continuar...`, runId);
        await esperarCompletado(page, descripcion);
        logConsole(`✅ ${descripcion} finalizó — continuando con el siguiente proceso.`, runId);
        await navegarConRetries(page, `${ambiente.replace(/\/$/, "")}/ProcesoCierre/Procesar`);
        continue;
      }

      const estadoPrevio = estadoPersistente[baseDatos][descripcion];
      if (estadoPrevio === "EN PROCESO") {
        logConsole(`⏳ ${descripcion} sigue "En Proceso" (persistente) — esperando finalización...`, runId);
        await esperarCompletado(page, descripcion);
        continue;
      }

      logConsole(`• ${sistema} | ${descripcion} | Estado=${estado} | Fecha=${fecha}`, runId);

      if (estado === "Pendiente") {
        actualizarEstadoPersistente(descripcion, "EN PROCESO");
        const inicio = Date.now();
        const resultado = await ejecutarProceso(page, sistema, baseDatos, connectString, runId);
        await esperarCompletado(page, descripcion);

        const duracion = ((Date.now() - inicio) / 60000).toFixed(2);
        const final = resultado || "Desconocido";
        actualizarEstadoPersistente(descripcion, final.toUpperCase());

        resumen.total++;
        resumen.detalle.push({ sistema, descripcion, estado: final, duracion: `${duracion} min` });
        if (final === "Completado") resumen.completados++;
        else if (final === "Error") resumen.errores++;

        logConsole(`✅ ${descripcion} → ${final} (${duracion} min)`, runId);

        // 🔄 Refrescar tabla tras cada ejecución
        await navegarConRetries(page, `${ambiente.replace(/\/$/, "")}/ProcesoCierre/Procesar`);
        await page.waitForSelector("#myTable tbody tr", { timeout: 30000 });
      }

      if (estado === "Error") {
        logConsole(`❌ ${descripcion} está en ERROR — sin job activo, se continúa sin reintentar.`, runId);
        continue;
      }
    }

    // 🔁 Verificar si quedan pendientes globales antes de continuar
    // 🔁 Verificar si quedan pendientes globales antes de continuar
    let hayPendientesRestantes = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("#myTable tbody tr td:nth-child(10)"))
        .some(td => /(Pendiente|En Proceso)/i.test(td.innerText));
    });

    // 🧩 Nueva validación con reintentos dinámicos
    if (!hayPendientesRestantes) {
      logConsole("🔁 Revalidando tabla para detectar siguientes sistemas (espera controlada)...", runId);

      let detectado = false;
      for (let intento = 1; intento <= 5; intento++) {
        await navegarConRetries(page, `${ambiente.replace(/\/$/, "")}/ProcesoCierre/Procesar`);
        await page.waitForSelector("#myTable tbody tr", { timeout: 20000 });

        hayPendientesRestantes = await page.evaluate(() => {
          return Array.from(document.querySelectorAll("#myTable tbody tr td:nth-child(10)"))
            .some(td => /(Pendiente|En Proceso)/i.test(td.innerText));
        });

        if (hayPendientesRestantes) {
          logConsole(`🟢 Pendientes detectados en intento ${intento} — continúa el cierre.`, runId);
          detectado = true;
          break;
        }

        logConsole(`⏳ Intento ${intento}: aún no aparecen nuevos pendientes, reintentando...`, runId);
        await page.waitForTimeout(5000); // espera entre intentos (5 segundos)
      }

      if (!detectado) {
        logConsole("✅ No se detectaron más pendientes tras varios reintentos.", runId);
        break;
      }
    }


    await page.waitForTimeout(3000);

  }

  // ============================================================
  // 🧾 RESUMEN FINAL
  // ============================================================
  const totalMin = ((Date.now() - inicioCierre) / 60000).toFixed(2);

  logConsole("==========================================", runId);
  logConsole("📊 RESUMEN FINAL DEL CIERRE", runId);
  logConsole("==========================================", runId);
  logConsole(`🗓 Fecha de ejecución real: ${new Date().toLocaleString("es-VE")}`, runId);
  logConsole(`🧩 Instancia ejecutada: ${baseDatos}`, runId);
  logConsole(`🌐 Ambiente: ${ambiente}`, runId);
  logConsole("------------------------------------------", runId);

  for (const p of resumen.detalle) {
    const icon =
      p.estado.toLowerCase().includes("completado") ? "✅" :
        p.estado.toLowerCase().includes("error") ? "❌" : "⏭️";
    logConsole(`${icon} [${p.sistema}] ${p.descripcion} → ${p.estado} | ⏱ ${p.duracion}`, runId);
  }

  logConsole("------------------------------------------", runId);
  logConsole(`📊 Total procesos ejecutados: ${resumen.total}`, runId);
  logConsole(`✅ Completados: ${resumen.completados}`, runId);
  logConsole(`❌ Errores: ${resumen.errores}`, runId);
  logConsole("------------------------------------------", runId);
  logConsole(`🕒 Tiempo total transcurrido: ${totalMin} min`, runId);
  logConsole("==========================================", runId);
  logConsole(`✅ Cierre completado según configuración (${totalMin} min)`, runId);

  // 📝 Guardar también en archivo de texto plano
  const resumenTxt = [
    "==========================================",
    "📊 RESUMEN FINAL DEL CIERRE",
    "==========================================",
    `🗓 Fecha: ${new Date().toLocaleString("es-VE")}`,
    `🧩 Base de Datos: ${baseDatos}`,
    `🌐 Ambiente: ${ambiente}`,
    "------------------------------------------",
    ...resumen.detalle.map(
      p => `${p.estado === "Completado" ? "✅" : "❌"} [${p.sistema}] ${p.descripcion} → ${p.estado} | ${p.duracion}`
    ),
    "------------------------------------------",
    `Completados: ${resumen.completados} / ${resumen.total}`,
    `Errores: ${resumen.errores}`,
    `🕒 Total: ${totalMin} min`,
    "=========================================="
  ].join("\n");

  const carpetaLogs = path.join(__dirname, "../logs");
  if (!fs.existsSync(carpetaLogs)) fs.mkdirSync(carpetaLogs);
  const nombreArchivo = `resumen_cierre_${baseDatos}_${new Date().toISOString().slice(0, 10)}.log`;
  fs.writeFileSync(path.join(carpetaLogs, nombreArchivo), resumenTxt, "utf-8");
  logConsole(`📝 Archivo .log generado: logs/${nombreArchivo}`, runId);

  await browser.close();
});
