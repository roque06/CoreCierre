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

  if (!estadoPersistente[baseDatos]) estadoPersistente[baseDatos] = {};
  for (const [desc, estado] of Object.entries(estadoPersistente[baseDatos])) {
    if (estado === "COMPLETADO") delete estadoPersistente[baseDatos][desc];
  }

  logConsole(`🧩 Estado persistente cargado para ${baseDatos}`, runId);
} catch {
  estadoPersistente = {};
  logConsole(`⚠️ No se pudo leer estado persistente, se iniciará limpio.`, runId);
}

function actualizarEstadoPersistente(descripcion, estado) {
  if (!estadoPersistente[baseDatos]) estadoPersistente[baseDatos] = {};
  estadoPersistente[baseDatos][descripcion] = estado;
  fs.writeFileSync(cachePath, JSON.stringify(estadoPersistente, null, 2));
}

// ============================================================
// 🔄 CONFIGURACIÓN GENERAL
// ============================================================
const ordenSistemas = ["PRE", "F2", "MTC", "F3", "MON", "F4", "F5", "F8", "FIN"];
const resumen = { total: 0, completados: 0, errores: 0, detalle: [] };
const inicioCierre = Date.now();

// ============================================================
// ▶️ TEST PRINCIPAL DE CIERRE
// ============================================================
test(`[${runId}] Cierre con selección de sistemas`, async () => {
  test.setTimeout(0);

  const browser = await chromium.launch({
    channel: "msedge",
    headless: false,
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

  // ============================================================
  // 🔁 BUCLE PRINCIPAL — motor híbrido
  // ============================================================
  while (true) {
    const filas = page.locator("tbody tr");
    const total = await filas.count();
    let encontrado = false;

    // --- Determinar sistema activo ---
    let sistemaActivo = null;
    for (const sis of ordenSistemas) {
      if (!procesos.map(p => p.toUpperCase()).includes(sis)) continue;
      const hayPendientes = await filas.evaluateAll((trs, sis) => {
        return trs.some(tr => {
          const tds = tr.querySelectorAll("td");
          const sistema = tds[2]?.innerText.trim().toUpperCase();
          const estado = tds[9]?.innerText.trim().toUpperCase();
          return sistema === sis && /(PENDIENTE|ERROR|EN PROCESO)/.test(estado);
        });
      }, sis);
      if (hayPendientes) {
        sistemaActivo = sis;
        break;
      }
    }

    if (!sistemaActivo) {
      logConsole("⏸️ Revalidando posibles nuevas fases...", runId);
      await page.waitForTimeout(5000);
      await page.reload({ waitUntil: "load" });
      const nuevosPendientes = await page.evaluate(() => {
        const filas = Array.from(document.querySelectorAll("#myTable tbody tr"));
        return filas.some(tr => {
          const estado = tr.querySelectorAll("td")[9]?.innerText.trim().toUpperCase();
          return estado === "PENDIENTE" || estado === "EN PROCESO";
        });
      });
      if (!nuevosPendientes) {
        logConsole("✅ Confirmado: no hay más procesos pendientes. Cierre completado.", runId);
        break;
      }
      continue;
    }

    if (sistemaActivo !== ultimoSistemaLogueado) {
      logConsole("==========================================", runId);
      logConsole(`🚀 Iniciando fase ${sistemaActivo}`, runId);
      logConsole("==========================================", runId);
      ultimoSistemaLogueado = sistemaActivo;
    }

    // ============================================================
    // ▶️ PROCESAMIENTO DE FILAS
    // ============================================================
    for (let i = 0; i < total; i++) {
      const fila = filas.nth(i);
      if (!(await fila.isVisible())) continue;
      const celdas = fila.locator("td");
      const sistema = (await celdas.nth(2).innerText().catch(() => "")).trim().toUpperCase();
      const descripcion = (await celdas.nth(4).innerText().catch(() => "")).trim();
      const estado = (await celdas.nth(9).innerText().catch(() => "")).trim();

      if (sistema !== sistemaActivo) continue;
      logConsole(`• ${sistema} | ${descripcion} | Estado=${estado}`, runId);

      if (["PENDIENTE", "ERROR"].includes(estado.toUpperCase())) {
        const inicioProceso = Date.now();
        logConsole(`▶️ [${sistema}] ${descripcion} — INICIANDO`, runId);

        // Simular progreso en vivo
        const progresoInterval = setInterval(() => {
          const transcurrido = ((Date.now() - inicioProceso) / 60000).toFixed(1);
          logConsole(`⏳ [${sistema}] ${descripcion} — EN PROCESO (${transcurrido} min transcurridos)`, runId);
        }, 30000);

        const resultado = await ejecutarProceso(page, sistema, baseDatos, connectString, runId);
        await esperarCompletado(page, descripcion);
        clearInterval(progresoInterval);

        const duracion = ((Date.now() - inicioProceso) / 60000).toFixed(2);
        const final = resultado || "Desconocido";
        resumen.total++;
        resumen.detalle.push({ sistema, descripcion, estado: final, duracion: `${duracion} min` });

        if (final === "Completado") resumen.completados++;
        else if (final === "Error") resumen.errores++;

        logConsole(`✅ [${sistema}] ${descripcion} → ${final} (${duracion} min)`, runId);
        encontrado = true;
        break;
      }
    }

    if (!encontrado) {
      await page.waitForTimeout(3000);
      await page.reload({ waitUntil: "load" });
    }
  }

  // ============================================================
  // 🧾 RESUMEN FINAL
  // ============================================================
  const totalMin = ((Date.now() - inicioCierre) / 60000).toFixed(2);
  logConsole("==========================================", runId);
  logConsole("📊 RESUMEN FINAL DEL CIERRE", runId);
  logConsole("==========================================", runId);

  const fases = {};
  for (const p of resumen.detalle) {
    const fase = p.sistema;
    const durMin = parseFloat(p.duracion.replace(" min", "")) || 0;
    if (!fases[fase]) fases[fase] = 0;
    fases[fase] += durMin;
  }

  function formatoTiempoLegible(totalMin) {
    const horas = Math.floor(totalMin / 60);
    const minutos = Math.round(totalMin % 60);
    if (horas > 0 && minutos > 0)
      return `${horas} hora${horas > 1 ? "s" : ""} y ${minutos} minuto${minutos > 1 ? "s" : ""}`;
    if (horas > 0) return `${horas} hora${horas > 1 ? "s" : ""}`;
    return `${minutos} minuto${minutos > 1 ? "s" : ""}`;
  }

  logConsole("⏱️ TIEMPO TOTAL POR FASE:", runId);
  Object.keys(fases).forEach((fase) => {
    const tiempoLegible = formatoTiempoLegible(fases[fase]);
    logConsole(`   • ${fase} — ${tiempoLegible}`, runId);
  });

  logConsole("------------------------------------------", runId);
  for (const p of resumen.detalle) {
    const icon =
      p.estado === "Completado" ? "✅" : p.estado === "Error" ? "❌" : "⏭️";
    logConsole(`${icon} [${p.sistema}] ${p.descripcion} → ${p.estado} | ⏱ ${p.duracion}`, runId);
  }
  logConsole("------------------------------------------", runId);
  logConsole(`📊 Total procesos ejecutados: ${resumen.total}`, runId);
  logConsole(`✅ Completados: ${resumen.completados}`, runId);
  logConsole(`❌ Errores: ${resumen.errores}`, runId);
  logConsole(`🕒 Tiempo total transcurrido: ${totalMin} min`, runId);
  logConsole("==========================================", runId);

  await browser.close();
});
