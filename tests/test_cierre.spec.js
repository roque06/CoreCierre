// @ts-nocheck
process.env.PATH = "C:\\instantclient_21_13;" + process.env.PATH;
process.env.LD_LIBRARY_PATH = "C:\\instantclient_21_13";
process.env.ORACLE_HOME = "C:\\instantclient_21_13";

const { test, chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { navegarConRetries } = require("../src/utils/navegacion.js");
const {
  ejecutarProceso,
  ejecutarPorHref,
  procesosEjecutadosGlobal,
  esperarHastaCompletado,
  ejecutarF4FechaMayor, // ✅ función especial F4
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

// --- Orden de ejecución ---
const ordenSistemas = ["PRE", "F2", "MTC", "F3", "MON", "F4", "F5", "FIN"];

// --- Estructura resumen ---
const resumen = { total: 0, completados: 0, errores: 0, detalle: [] };
const inicioCierre = Date.now();
const fechaInicioCierre = new Date(); // 🕒 Captura la hora real de inicio del cierre

// --- Helper functions ---
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
  // 🧩 Registrar los sistemas activos seleccionados
  // ============================================================
  global.__sistemasActivos = procesos.map(p => p.toUpperCase());
  logConsole(`📄 Sistemas activos definidos: ${global.__sistemasActivos.join(", ")}`, runId);
  logWeb(`📄 Sistemas activos definidos: ${global.__sistemasActivos.join(", ")}`, runId);

  // ============================================================
  // 🔄 Bucle principal
  // ============================================================
  while (true) {
    const filas = page.locator("tbody tr");
    const total = await filas.count();
    let encontrado = false;

    logConsole(`▶ Analizando ${total} filas de procesos...`, runId);

    // --- Determinar sistema activo ---
    let sistemaActivo = null;
    for (const sis of ordenSistemas) {
      if (!procesos.includes(sis)) continue;
      const hayPendientes = await filas.evaluateAll((trs, sis) => {
        return trs.some((tr) => {
          const tds = tr.querySelectorAll("td");
          if (tds.length < 8) return false;
          const sistema = tds[2]?.innerText.trim();
          const estado = tds[9]?.innerText.trim();
          return sistema === sis && /(Pendiente|Error|En Proceso)/i.test(estado);
        });
      }, sis);
      if (hayPendientes) {
        sistemaActivo = sis;
        break;
      }
    }

    if (!sistemaActivo) {
      logWeb("✅ No quedan procesos pendientes según configuración", runId);
      logConsole("✅ No quedan procesos pendientes según configuración", runId);
      break;
    }

    if (sistemaActivo !== ultimoSistemaLogueado) {
      logConsole("==========================================", runId);
      logConsole(`🚀 Iniciando fase ${sistemaActivo}`, runId);
      logConsole("==========================================", runId);
      logWeb(`🔹 Sistema en ejecución: ${sistemaActivo}`, runId);
      ultimoSistemaLogueado = sistemaActivo;
    }

    // ============================================================
    // ▶️ Ejecutar procesos del sistema activo
    // ============================================================
    for (let i = 0; i < total; i++) {
      const fila = filas.nth(i);
      if (!(await fila.isVisible())) continue;

      const celdas = fila.locator("td");
      const sistema = (await celdas.nth(2).innerText().catch(() => "")).trim();
      const descripcion = (await celdas.nth(4).innerText().catch(() => "")).trim();
      const fecha = (await celdas.nth(6).innerText().catch(() => "")).trim();
      const estado = (await celdas.nth(9).innerText().catch(() => "")).trim();

      if (sistema !== sistemaActivo) continue;

      // --- Verificar duplicados F4 ---
      if (sistema === "F4") {
        const duplicados = await filas.evaluateAll((trs, desc) => {
          return trs
            .map((tr) => {
              const tds = tr.querySelectorAll("td");
              return {
                sistema: tds[2]?.innerText?.trim(),
                descripcion: tds[4]?.innerText?.trim(),
                fecha: tds[6]?.innerText?.trim(),
              };
            })
            .filter((p) => p.sistema === "F4" && p.descripcion === desc);
        }, descripcion);

        if (duplicados.length > 1) {
          const f1 = parseFechaDMY(duplicados[0].fecha);
          const f2 = parseFechaDMY(duplicados[1].fecha);
          const fechaMayor = f1 > f2 ? f1 : f2;
          const fechaActual = parseFechaDMY(fecha);

          if (fechaActual.getTime() === fechaMayor.getTime()) {
            logConsole(`📆 Detectada nueva fecha (${fecha}) → Activando flujo F4 Fecha Mayor`, runId);
            await ejecutarF4FechaMayor(page, baseDatos, connectString, runId);
            encontrado = true;
            break;
          } else {
            logConsole(`❌ Fecha actual (${fecha}) no es la mayor (${fechaMayor.toLocaleDateString("es-ES")})`, runId);
          }
        }
      }

      logWeb(`• ${sistema} | ${descripcion} | Estado=${estado} | Fecha=${fecha}`, runId);
      logConsole(`• ${sistema} | ${descripcion} | Estado=${estado} | Fecha=${fecha}`, runId);

      if (["Pendiente", "Error"].includes(estado)) {
        const clave = `${sistema}|${descripcion}`;
        if (procesosEjecutadosGlobal.has(clave)) {
          logConsole(`⏭️ ${descripcion} — ya en ejecución, evitando doble clic.`, runId);
          logWeb(`⏭️ ${descripcion} — ya en ejecución, evitando doble clic.`, runId);
          continue;
        }
        procesosEjecutadosGlobal.set(clave, true);

        const inicioProceso = Date.now();
        const resultado = await ejecutarProceso(page, sistema, baseDatos, connectString, runId);
        const estadoFinal = resultado || "Desconocido";
        const duracionMin = ((Date.now() - inicioProceso) / 60000).toFixed(2);

        resumen.total++;
        resumen.detalle.push({
          sistema,
          descripcion,
          estado: estadoFinal,
          duracion: duracionMin + " min",
        });

        if (estadoFinal === "Completado") resumen.completados++;
        else if (estadoFinal === "Error") resumen.errores++;

        logConsole(`⏱️ Duración del proceso ${descripcion}: ${duracionMin} min`, runId);
        logWeb(`⏱️ Duración del proceso ${descripcion}: ${duracionMin} min`, runId);

        encontrado = true;
        break;
      }
    }

    if (!encontrado) await page.waitForTimeout(3000);
  }

  // ============================================================
  // 🧾 Resumen Final del Cierre (actualizado con hora real de inicio)
  // ============================================================
  const duracionTotal = ((Date.now() - inicioCierre) / 60000).toFixed(2);
  const fechaEjecucion = fechaInicioCierre.toLocaleString("es-VE", {
    dateStyle: "full",
    timeStyle: "medium",
  });

  const resumenFinal = [];
  resumenFinal.push("==========================================");
  resumenFinal.push(`📊 RESUMEN FINAL DEL CIERRE [${runId}]`);
  resumenFinal.push("==========================================");
  resumenFinal.push(`🗓 Fecha de ejecución real: ${fechaEjecucion}`);
  resumenFinal.push(`🧩 Instancia ejecutada: ${baseDatos}`);
  resumenFinal.push(`🌐 Ambiente: ${ambiente}`);
  resumenFinal.push("------------------------------------------");

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

  resumenFinal.push("⏱️ TIEMPO TOTAL POR FASE:");
  Object.keys(fases).forEach((fase) => {
    const tiempoLegible = formatoTiempoLegible(fases[fase]);
    resumenFinal.push(`   • ${fase} — Suma total: ${tiempoLegible}`);
  });
  resumenFinal.push("------------------------------------------");

  const agrupado = {};
  for (const p of resumen.detalle) {
    if (!agrupado[p.sistema]) agrupado[p.sistema] = [];
    agrupado[p.sistema].push(p);
  }

  Object.keys(agrupado).forEach((sistema) => {
    resumenFinal.push(`📦 ${sistema} — ${agrupado[sistema].length} procesos ejecutados:`);
    agrupado[sistema].forEach((p) => {
      const icon =
        p.estado === "Completado" ? "✅" :
          p.estado === "Error" ? "❌" :
            "⏭️";
      resumenFinal.push(`${icon} [${p.sistema}] ${p.descripcion} → ${p.estado} (Duración: ${p.duracion})`);
    });
    resumenFinal.push("------------------------------------------");
  });

  resumenFinal.push(`🕒 TOTAL TIEMPO TRANSCURRIDO: ${duracionTotal} min`);
  resumenFinal.push("==========================================");

  resumenFinal.forEach((linea) => {
    logConsole(linea, runId);
    logWeb(linea, runId);
  });

  await browser.close();
});
