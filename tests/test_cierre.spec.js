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

// --- Cargar connectString ---
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
// 🧩 Estado persistente
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
// ⚙️ Configuración
// ============================================================
const ordenSistemas = ["PRE", "F2", "MTC", "F3", "MON", "F4", "F5", "F8", "FIN"];
const resumen = { total: 0, completados: 0, errores: 0, detalle: [] };
const inicioCierre = Date.now();

// ============================================================
// ▶️ TEST PRINCIPAL
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
  global.__sistemasActivos = procesos.map(p => p.toUpperCase());
  logConsole(`📄 Sistemas activos definidos: ${global.__sistemasActivos.join(", ")}`, runId);

  // ============================================================
  // 🔁 Bucle principal
  // ============================================================
  while (true) {
    const filas = page.locator("tbody tr");
    const total = await filas.count();

    // --- Buscar siguiente sistema activo en orden ---
    let sistemaActivo = null;
    for (const sis of ordenSistemas) {
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
        break;
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
    // ▶️ Procesar filas de ese sistema
    // ============================================================
    for (let i = 0; i < total; i++) {
      const fila = filas.nth(i);
      const celdas = fila.locator("td");
      const sistema = (await celdas.nth(2).innerText().catch(() => "")).trim();
      const descripcion = (await celdas.nth(4).innerText().catch(() => "")).trim();
      const fecha = (await celdas.nth(6).innerText().catch(() => "")).trim();
      const estado = (await celdas.nth(9).innerText().catch(() => "")).trim();

      if (sistema !== sistemaActivo) continue;

      if (estado.toUpperCase() === "EN PROCESO") {
        logConsole(`⏳ ${descripcion} está EN PROCESO — esperando finalización...`, runId);
        await esperarCompletado(page, descripcion);
        await page.goto(`${ambiente}/ProcesoCierre/Procesar`, { waitUntil: "load" });
        await page.evaluate(() => location.reload(true));
        await page.waitForSelector("#myTable tbody tr");
        logConsole("🔁 Recarga completa del DOM tras esperar proceso en curso.", runId);
        continue;
      }

      const estadoPrevio = estadoPersistente[baseDatos][descripcion];
      if (estadoPrevio === "EN PROCESO") {
        logConsole(`⏳ ${descripcion} sigue "En Proceso" (persistente).`, runId);
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

        // 🔄 Recarga forzada tras ejecutar
        await page.goto(`${ambiente}/ProcesoCierre/Procesar`, { waitUntil: "load" });
        await page.evaluate(() => location.reload(true));
        await page.waitForSelector("#myTable tbody tr", { timeout: 30000 });
        logConsole("🔁 Recarga completa forzada tras ejecutar proceso.", runId);
      }
    }

    // ============================================================
    // 🔁 Validar si el sistema terminó
    // ============================================================
    let completado = false;
    for (let intento = 1; intento <= 5; intento++) {
      completado = await page.evaluate((sis) => {
        const filas = Array.from(document.querySelectorAll("#myTable tbody tr"));
        const delSistema = filas.filter(tr => tr.querySelectorAll("td")[2]?.innerText.trim().toUpperCase() === sis);
        return delSistema.every(tr => {
          const estado = tr.querySelectorAll("td")[9]?.innerText.trim().toUpperCase();
          return estado === "COMPLETADO" || estado === "OMITIDO";
        });
      }, sistemaActivo);
      if (completado) break;

      logConsole(`⏳ Verificando cierre de ${sistemaActivo} (intento ${intento}/5)...`, runId);
      await page.waitForTimeout(4000);
      await page.goto(`${ambiente}/ProcesoCierre/Procesar`, { waitUntil: "load" });
      await page.evaluate(() => location.reload(true));
      await page.waitForSelector("#myTable tbody tr");
      logConsole("🔁 Recarga completa durante verificación de cierre.", runId);
    }

    if (completado) {
      logConsole(`✅ ${sistemaActivo} completado — buscando siguiente sistema...`, runId);
      await page.goto(`${ambiente}/ProcesoCierre/Procesar`, { waitUntil: "load" });
      await page.evaluate(() => location.reload(true));
      await page.waitForSelector("#myTable tbody tr");

      let siguiente = null;
      for (const sis of ordenSistemas) {
        if (!procesos.map(p => p.toUpperCase()).includes(sis)) continue;
        const hayPend = await page.evaluate((sis) => {
          const filas = Array.from(document.querySelectorAll("#myTable tbody tr"));
          return filas.some(tr => {
            const tds = tr.querySelectorAll("td");
            const sistema = tds[2]?.innerText.trim().toUpperCase();
            const estado = tds[9]?.innerText.trim().toUpperCase();
            return sistema === sis && /(PENDIENTE|EN PROCESO)/.test(estado);
          });
        }, sis);
        if (hayPend) {
          siguiente = sis;
          break;
        }
      }

      if (siguiente && siguiente !== sistemaActivo) {
        logConsole(`🚀 Nueva fase detectada: ${siguiente}`, runId);
        ultimoSistemaLogueado = siguiente;
        continue;
      }

      logConsole("✅ No hay más sistemas pendientes tras revalidar.", runId);
      break;
    }

    await page.waitForTimeout(2000);
  }

  // ============================================================
  // 📊 RESUMEN FINAL
  // ============================================================
  const totalMin = ((Date.now() - inicioCierre) / 60000).toFixed(2);
  logConsole("==========================================", runId);
  logConsole("📊 RESUMEN FINAL DEL CIERRE", runId);
  logConsole("==========================================", runId);
  logConsole(`🗓 Fecha: ${new Date().toLocaleString("es-VE")}`, runId);
  logConsole(`🧩 Instancia ejecutada: ${baseDatos}`, runId);
  logConsole(`🌐 Ambiente: ${ambiente}`, runId);
  logConsole("------------------------------------------", runId);

  for (const p of resumen.detalle) {
    const icon = p.estado.toLowerCase().includes("completado") ? "✅" :
      p.estado.toLowerCase().includes("error") ? "❌" : "⏭️";
    logConsole(`${icon} [${p.sistema}] ${p.descripcion} → ${p.estado} | ${p.duracion}`, runId);
  }

  logConsole("------------------------------------------", runId);
  logConsole(`📊 Total procesos ejecutados: ${resumen.total}`, runId);
  logConsole(`✅ Completados: ${resumen.completados}`, runId);
  logConsole(`❌ Errores: ${resumen.errores}`, runId);
  logConsole(`🕒 Tiempo total transcurrido: ${totalMin} min`, runId);
  logConsole("==========================================", runId);
  logConsole(`✅ Cierre completado según configuración (${totalMin} min)`, runId);

  const carpetaLogs = path.join(__dirname, "../logs");
  if (!fs.existsSync(carpetaLogs)) fs.mkdirSync(carpetaLogs);
  const nombreArchivo = `resumen_cierre_${baseDatos}_${new Date().toISOString().slice(0, 10)}.log`;
  fs.writeFileSync(path.join(carpetaLogs, nombreArchivo), JSON.stringify(resumen, null, 2), "utf-8");
  logConsole(`📝 Archivo .log generado: logs/${nombreArchivo}`, runId);

  await browser.close();
});
