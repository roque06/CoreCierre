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
    channel: undefined, // ✅ Forzar uso de Chromium embebido, no Edge
    executablePath: undefined,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-infobars",
      "--disable-extensions",
      "--disable-background-networking",
      "--start-maximized",
    ],
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
  let cierreCompleto = false; // 🧩 bandera global para salida limpia del bucle

  // ============================================================
  // 🔁 BUCLE PRINCIPAL — motor híbrido
  // ============================================================
  while (!cierreCompleto) {
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

      let cierreListo = false;

      for (let intento = 1; intento <= 3; intento++) {
        await page.waitForTimeout(4000);
        await page.reload({ waitUntil: "load" });

        // 🔎 Escanear tabla y detectar solo fases seleccionadas con procesos activos
        const fasesPendientes = await page.evaluate((procesosSeleccionados) => {
          const seleccionados = procesosSeleccionados.map(p => p.toUpperCase());
          const filas = Array.from(document.querySelectorAll("#myTable tbody tr"));
          const pendientes = new Set();

          for (const tr of filas) {
            const style = window.getComputedStyle(tr);
            if (style.display === "none" || style.visibility === "hidden") continue;

            const celdas = tr.querySelectorAll("td");
            if (celdas.length < 10) continue;

            const sistema = (celdas[2]?.innerText || "").trim().toUpperCase();
            const estado = (celdas[9]?.innerText || "").trim().toUpperCase();

            // ⚙️ Ignorar filas de sistemas no seleccionados
            if (!seleccionados.includes(sistema)) continue;

            // ⚙️ Ignorar estados finales
            if (!estado || ["COMPLETADO", "FINALIZADO", "T", "S", "OK"].includes(estado)) continue;

            // ⚙️ Solo marcar como pendiente si sigue activo
            if (["PENDIENTE", "EN PROCESO", "ERROR"].includes(estado)) {
              pendientes.add(sistema);
            }
          }

          return Array.from(pendientes);
        }, procesos);

        // 🔹 Si no hay pendientes, todas las fases seleccionadas están cerradas
        if (fasesPendientes.length === 0) {
          logConsole(`✅ Confirmado: todas las fases seleccionadas (${procesos.join(", ")}) están completadas.`, runId);
          cierreCompleto = true;
          cierreListo = true;
          break;
        }

        logConsole(
          `⏳ Validación intento ${intento}: aún hay fases pendientes → ${fasesPendientes.join(", ")}`,
          runId
        );
      }

      if (cierreListo) break;
      continue;
    }



    if (sistemaActivo !== ultimoSistemaLogueado) {
      logConsole("==========================================", runId);
      logConsole(`🚀 Iniciando fase ${sistemaActivo}`, runId);
      logConsole("==========================================", runId);
      ultimoSistemaLogueado = sistemaActivo;
    }

    // ============================================================
    // ▶️ PROCESAMIENTO DE FILAS (con cache persistente)
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

      const claveCache = `${sistema}|${descripcion}`;
      const estadoPrevio = estadoPersistente[baseDatos]?.[claveCache];

      // 🧠 1️⃣ Si el proceso estaba en ejecución antes del reinicio → esperarlo
      if (estadoPrevio === "EN PROCESO") {
        logConsole(`⏳ Retomando proceso previo "${descripcion}" — esperando que finalice...`, runId);
        await esperarCompletado(page, descripcion);
        actualizarEstadoPersistente(claveCache, "COMPLETADO");
        logConsole(`✅ "${descripcion}" completado tras reanudación.`, runId);
        encontrado = true;
        break;
      }

      // 🧠 2️⃣ Si el proceso ya figura EN PROCESO en pantalla → esperarlo
      if (estado.toUpperCase() === "EN PROCESO") {
        logConsole(`⏳ "${descripcion}" está en ejecución actualmente — esperando finalización...`, runId);
        actualizarEstadoPersistente(claveCache, "EN PROCESO");
        await esperarCompletado(page, descripcion);
        actualizarEstadoPersistente(claveCache, "COMPLETADO");
        logConsole(`✅ "${descripcion}" finalizó correctamente.`, runId);
        encontrado = true;
        break;
      }

      // 🧩 3️⃣ Ejecutar procesos pendientes o con error normalmente
      if (["PENDIENTE", "ERROR"].includes(estado.toUpperCase())) {
        const inicioProceso = Date.now();
        logConsole(`▶️ [${sistema}] ${descripcion} — INICIANDO`, runId);
        actualizarEstadoPersistente(claveCache, "EN PROCESO");

        // 🧩 Simular progreso en vivo (seguro y sin depender del DOM)
        const progresoInterval = setInterval(() => {
          try {
            const transcurrido = ((Date.now() - inicioProceso) / 60000).toFixed(1);
            logConsole(`⏳ [${sistema}] ${descripcion} — EN PROCESO (${transcurrido} min transcurridos)`, runId);
          } catch (err) {
            logConsole(`⚠️ Error al calcular progreso de ${descripcion}: ${err.message}`, runId);
          }
        }, 30000);

        logConsole(`⏳ [${sistema}] ${descripcion} — EN PROCESO (0.0 min transcurridos)`, runId);

        const resultado = await ejecutarProceso(page, sistema, baseDatos, connectString, runId);
        await esperarCompletado(page, descripcion);
        clearInterval(progresoInterval);

        const duracion = ((Date.now() - inicioProceso) / 60000).toFixed(2);
        const final = resultado || "Desconocido";
        actualizarEstadoPersistente(claveCache, final.toUpperCase());

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
      const hayActivos = await filas.evaluateAll((trs) =>
        trs.some((tr) => {
          const estado = tr.querySelectorAll("td")[9]?.innerText.trim();
          return ["Pendiente", "Error", "En Proceso"].includes(estado);
        })
      );
      if (!hayActivos) break; // 🔹 rompe si ya no hay procesos pendientes
      await page.waitForTimeout(3000);
    }

  }

  // 🧩 VALIDACIÓN GLOBAL FINAL (forzada) — también filtrada por fases seleccionadas
  let quedanPendientesFinal = true;
  for (let intento = 1; intento <= 3; intento++) {
    await page.waitForTimeout(4000);
    await page.reload({ waitUntil: "load" });

    quedanPendientesFinal = await page.evaluate((procesosSeleccionados) => {
      const seleccionados = procesosSeleccionados.map(p => p.toUpperCase());
      const filas = Array.from(document.querySelectorAll("#myTable tbody tr"));

      return filas.some(tr => {
        const style = window.getComputedStyle(tr);
        if (style.display === "none" || style.visibility === "hidden") return false;

        const celdas = tr.querySelectorAll("td");
        if (celdas.length < 10) return false;

        const sistema = (celdas[2]?.innerText || "").trim().toUpperCase();
        const estadoRaw = (celdas[9]?.innerText || "").replace(/\s+/g, " ").trim().toUpperCase();

        if (!seleccionados.includes(sistema)) return false;
        return ["PENDIENTE", "EN PROCESO", "ERROR"].includes(estadoRaw);
      });
    }, procesos);

    if (!quedanPendientesFinal) break;
    logConsole(`⏳ Validación final intento ${intento}: aún hay procesos visibles en ejecución dentro de las fases seleccionadas...`, runId);
  }

  if (quedanPendientesFinal) {
    logConsole("⏸️ Persisten procesos pendientes tras múltiples verificaciones (solo de las fases seleccionadas). No se imprimirá el resumen aún.", runId);
    await browser.close();
    return;
  }


  // ============================================================
  // 🧩 VALIDACIÓN GLOBAL FINAL (forzada tras salir del bucle principal)
  // ============================================================
  let quedanPendientesFinal = true;
  for (let intento = 1; intento <= 3; intento++) {
    await page.waitForTimeout(4000); // espera 4 segundos para asegurar actualización del DOM
    await page.reload({ waitUntil: "load" });

    quedanPendientesFinal = await page.$$eval("#myTable tbody tr", trs =>
      trs.some(tr => {
        const style = window.getComputedStyle(tr);
        if (style.display === "none" || style.visibility === "hidden") return false;

        const celdas = tr.querySelectorAll("td");
        if (celdas.length < 10) return false;

        const estadoRaw = celdas[9]?.innerText || "";
        const estado = estadoRaw.replace(/\s+/g, " ").trim().toUpperCase();

        return ["PENDIENTE", "EN PROCESO", "ERROR"].includes(estado);
      })
    );

    if (!quedanPendientesFinal) break;
    logConsole(`⏳ Validación final intento ${intento}: aún hay procesos visibles en ejecución...`, runId);
  }

  if (quedanPendientesFinal) {
    logConsole("⏸️ Persisten procesos pendientes tras múltiples verificaciones. No se imprimirá el resumen aún.", runId);
    await browser.close();
    return;
  }

  logConsole("✅ Todas las fases seleccionadas finalizaron correctamente. Generando resumen final...", runId);

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
