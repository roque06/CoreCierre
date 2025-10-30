// ============================================================
// ▶️ Ejecutar proceso (versión persistente con control de F4 Fecha Mayor)
// ============================================================
const fs = require("fs");
const path = require("path");
const { navegarConRetries, esperarCompletado } = require("./navegacion.js");
const { monitorearF4Job } = require("./oracleUtils.js");
const { logConsole, logWeb } = require("./logger.js");

global.__sistemasActivos = global.__sistemasActivos || [];


// 📁 Archivo de persistencia (recuerda última fecha F4 detectada)
const cachePath = path.resolve(__dirname, "../cache/f4_last_date.json");

// 🧩 Crear carpeta /cache si no existe (solo se ejecuta una vez)
const cacheDir = path.dirname(cachePath);
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
  console.log("📂 Carpeta /cache creada para guardar fechas F4.");
}



// =============================================================
// 🔒 Mapa global persistente para evitar ejecuciones duplicadas
// =============================================================
const procesosEjecutadosGlobal = new Map();
const procesosSaltados = new Set();



// ============================================================
// 🧩 Normalizador y lectura exacta de filas/estadosleerEstadoExacto
// ============================================================

// Normaliza texto quitando tildes, espacios y mayúsculas
function _norm(t) {
  return (t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}



// ============================================================
// 🧩 Localizadores globales — accesibles desde todo el módulo
// ============================================================
function normalizarTexto(txt) {
  return (txt || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// --- Localiza la fila exacta ---
async function getFilaExacta(page, sistema, descripcion) {
  const filas = page.locator("#myTable tbody tr");
  const total = await filas.count();
  const sisN = normalizarTexto(sistema);
  const descN = normalizarTexto(descripcion);

  for (let i = 0; i < total; i++) {
    const fila = filas.nth(i);
    const celdas = fila.locator("td");
    if ((await celdas.count()) < 10) continue;

    const sis = normalizarTexto(await celdas.nth(2).innerText());
    const desc = normalizarTexto(await celdas.nth(4).innerText());
    if (sis === sisN && desc.includes(descN)) return fila;
  }
  return null;
}

// --- Lee el badge exacto ---
async function leerEstadoExacto(page, sistema, descripcion) {
  const fila = await getFilaExacta(page, sistema, descripcion);
  if (!fila) return "DESCONOCIDO";
  try {
    const badge = fila.locator("td .badge");
    const texto = ((await badge.textContent()) || "").trim().toUpperCase();
    return texto || "DESCONOCIDO";
  } catch {
    return "DESCONOCIDO";
  }
}



// =============================================================
// 🧩 Ejecutar script SQL vía backend
// =============================================================
async function pedirScript(script, baseDatos, runId = "GLOBAL") {
  try {
    const resp = await fetch("http://localhost:4000/api/run-script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseDatos, script }),
    });
    if (!resp.ok)
      logConsole(`❌ Error al pedir script ${script}: ${resp.statusText}`, runId);
    else
      logConsole(`✅ Script ejecutado correctamente: ${script}`, runId);
  } catch (err) {
    logConsole(`❌ Error conectando al backend para script ${script}: ${err.message}`, runId);
  }
}

const preScripts = {
  "CARGA LINEA DIFERIDA ITC": ["estadoMtc.sql"],
  "CIERRE DIARIO DE BANCOS": ["RestestatusF2.sql"],
  "CAMBIO SECTOR CONTABLE": ["Cambio_Sector.sql"],
  "PROVISION DE INTERESES PRESTAMOS": ["ResetEstatuiF3.sql", "PreF3.sql", "EliminarF3.sql"],
  "LIBERACION DE EMBARGOS, CONGELAMIENTOS Y CONSULTAS": ["ResetEstatusF4.sql"],
  "CIERRE DIARIO DIVISAS": ["Fix_Cierre_Divisas.sql", "resetEstatusF5.sql", "Prey.sql"],
  "CLASIFICACION DE SALDOS DE PRESTAMOS": ["RestF3.sql"],
  "CIERRE DIARIO CUENTA EFECTIVO": ["pre-f4.sql"],
  "CIERRE DIARIO CAJA (ATM)": ["cerrar_caja.sql"],
  "GENERAR ASIENTOS PESO IMPUESTOS MONEDA EXTRANJERA": ["cerrar_caja.sql"],
  "ACTUALIZA VISTA MATERIALIZADA PLAN PAGO DWH": [
    "Actualiza_multiuser.sql", "Reset_multi.sql", "Activa_multiuser.sql",
  ],
  "APLICACIÓN DE TRANSFERENCIAS AUTOMÁTICAS": ["fix_pre.sql"],
  "RENOVACIÓN DE TARJETAS": ["reset_tarjetas.sql"],
  "GENERACION SALDOS CONTABILIZADOS": ["Prey.sql"],
  "CARGA MAESTRO TARJETA DE CREDITO ITC": ["mtc1.sql", "mtc2.sql", "mtc4.sql", "mtc5.sql"],
  "CARGA TRANSACCIONES DIARIAS ITC": ["mtc3.sql"],



};



// ============================================================
// 🧠 Función principal
// ============================================================
async function ejecutarPreScripts(descripcion, baseDatos, runId = "GLOBAL") {
  const normalizarTexto = (txt) =>
    (txt || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();

  const desc = normalizarTexto(descripcion);
  const scripts = preScripts[desc];

  if (scripts && scripts.length > 0) {
    for (const script of scripts) {
      try {
        logConsole(`📦 Ejecutando pre-script: ${script} antes de ${descripcion}`, runId);
        logWeb(`📦 Ejecutando pre-script: ${script} antes de ${descripcion}`);
        await pedirScript(script, baseDatos);
        logConsole(`✅ Script ${script} ejecutado correctamente.`, runId);
      } catch (err) {
        logConsole(`⚠️ Error al ejecutar pre-script ${script}: ${err.message}`, runId);
        logWeb(`⚠️ Error al ejecutar pre-script ${script}: ${err.message}`);
      }
    }
  } else {
    logConsole(`ℹ️ No hay pre-scripts configurados para ${descripcion}`, runId);
  }
}


// --- Espera a que la MISMA fila cambie a EN PROCESO / COMPLETADO / ERROR ---
async function esperarHastaCompletado(page, sistema, descripcion, runId = "GLOBAL") {
  logConsole(`⏳ Esperando estado final de "${descripcion}" en ${sistema}...`, runId);

  let estado = "DESCONOCIDO";
  const maxIntentos = 180;        // ~180s (3 minutos)
  const pausaMs = 1000;

  for (let i = 0; i < maxIntentos; i++) {
    estado = await leerEstadoExacto(page, sistema, descripcion);

    if (["EN PROCESO", "COMPLETADO", "ERROR"].includes(estado)) {
      logConsole(`📌 Estado final de "${descripcion}" (${sistema}): ${estado}`, runId);
      return estado;
    }

    if (i % 5 === 0) {
      logConsole(`⏳ "${descripcion}" sigue en: ${estado || "—"} → esperando...`, runId);
    }
    await page.waitForTimeout(pausaMs);
  }

  logConsole(`⚠️ Timeout esperando estado final de "${descripcion}" (${sistema}).`, runId);
  return estado || "DESCONOCIDO";
}




// =============================================================
// 🩹 Scripts correctivos automáticos por proceso
// =============================================================
const recoveryScripts = {
  "APLICACIÓN DE TRANSFERENCIAS AUTOMÁTICAS": ["fix_transferencias.sql",],
  "APLICACIÓN DEL 1.5 POR 1000 (LEY 288-04)": ["fix_1x1000.sql", "fix_transferencias2.sql"],
  "CIERRE DIARIO CUENTA EFECTIVO": ["fix_cierre_efectivo.sql"],
  "GENERAR ASIENTO CONTABLE": ["fix_asiento_contable.sql"],
  "GENERAR ASIENTO CLASIFICACIÓN": ["fix_asiento_clasificacion.sql"],
  "ASIENTO CONTINGENCIA Y PROVISIÓN SOBREGIRO PACTADO": ["fix_asiento_contingencia.sql"],
  "GENERAR ESTADÍSTICAS": ["fix_generar_estadisticas.sql"],
  "PASAR MOVIMIENTOS DIARIOS A MENSUALES": ["fix_pasar_movimientos.sql"],
  "CORRER CALENDARIO": ["fix_correr_calendario.sql"],
  "GENERACIÓN SALDOS CONTABILIZADOS": ["fix_generacion_saldos.sql"],
};


// --- Espera específica para "Correr Calendario" en F4, sin falsos completados ---
async function esperarCorrerCalendarioF4(page, connectString, baseDatos, runId = "GLOBAL") {
  const sistema = "F4";
  const descripcion = "Correr Calendario";

  // 1) Espera corta a que arranque
  const arranque = await esperarHastaCompletado(page, sistema, descripcion, runId);
  if (["EN PROCESO", "COMPLETADO", "ERROR"].includes(arranque)) {
    return arranque;
  }

  // 2) Validación Oracle (si tienes util disponible)
  if (typeof monitorearF4Job === "function") {
    try {
      const ok = await monitorearF4Job(connectString, baseDatos, null, runId);
      if (ok) {
        // Relee badge por si ya terminó
        const final = await esperarHastaCompletado(page, sistema, descripcion, runId);
        return final || "DESCONOCIDO";
      } else {
        // No hay job → deja que el flujo normal reevalúe, no finjas COMPLETADO
        return "PENDIENTE";
      }
    } catch (e) {
      logConsole(`⚠️ monitorearF4Job falló: ${e.message}`, runId);
      return "PENDIENTE";
    }
  }

  // 3) Sin monitor Oracle, no asumimos final feliz
  return "PENDIENTE";
}

function buildClaveProceso(sistema, descripcion, fechaTxt) {
  const norm = (t) =>
    (t || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();

  return `${norm(sistema)}|${norm(descripcion)}|${(fechaTxt || "").trim()}`;
}



// =============================================================
// 🧩 Flujo especial F4 Fecha Mayor
// =============================================================
const procesosActualizados = new Set();
let f4EnEjecucion = false;


async function ejecutarF4FechaMayor(page, baseDatos, connectString, runId = "GLOBAL") {
  if (f4EnEjecucion) {
    logConsole("⏸️ F4FechaMayor ya en ejecución — esperando a que termine.", runId);
    return;
  }

  f4EnEjecucion = true;
  global.__f4ModoEspecialActivo = true;

  try {
    logConsole("🔄 [Modo F4 Fecha Mayor] ejecución controlada por SQL sin clics.", runId);

    const filas = await page.$$("#myTable tbody tr");
    const fechasF4 = [];

    for (const fila of filas) {
      try {
        const sistema = (await fila.$eval("td:nth-child(3)", el => el.innerText.trim().toUpperCase())) || "";
        const fechaTxt = (await fila.$eval("td:nth-child(7)", el => el.innerText.trim())) || "";
        if (sistema === "F4" && fechaTxt) fechasF4.push(fechaTxt);
      } catch { }
    }

    const fechasValidas = fechasF4
      .filter(f => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(f))
      .map(f => {
        const [d, m, y] = f.split("/").map(Number);
        return new Date(y, m - 1, d);
      })
      .filter(f => !isNaN(f))
      .sort((a, b) => a - b);

    if (!fechasValidas.length) {
      logConsole("⚠️ No hay fechas válidas para F4.", runId);
      return "F4_SIN_FECHAS";
    }

    const fechaMayor = fechasValidas.at(-1);
    const fechaMin = fechasValidas.at(0);
    if (fechaMayor.getTime() === fechaMin.getTime()) {
      logConsole(`ℹ️ Todas las fechas F4 son iguales (${fechaMayor.toLocaleDateString("es-ES")}) → no se activa modo especial.`, runId);
      return "F4_TODAS_IGUALES";
    }

    const mesesOracle = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const fechaOracle = `${String(fechaMayor.getUTCDate()).padStart(2, "0")}-${mesesOracle[fechaMayor.getUTCMonth()]}-${fechaMayor.getUTCFullYear()}`;

    if (!procesosActualizados.has("SCRIPT_F4")) {
      try {
        const original = path.join(__dirname, "../../sql/scriptCursol.sql");
        const temporal = path.join(__dirname, "../../sql/scriptCursol_tmp.sql");
        let contenido = fs.readFileSync(original, "utf-8");
        contenido = contenido.replace(/fecha\s*=\s*'[^']+'/i, `fecha = '${fechaOracle}'`);
        fs.writeFileSync(temporal, contenido, "utf-8");

        await fetch("http://127.0.0.1:4000/api/run-script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseDatos, script: "scriptCursol_tmp.sql", connectString }),
        });

        fs.unlinkSync(temporal);
        logConsole(`✅ scriptCursol_tmp.sql ejecutado con fecha ${fechaOracle}`, runId);
        procesosActualizados.add("SCRIPT_F4");
      } catch (err) {
        logConsole(`❌ Error ejecutando script temporal: ${err.message}`, runId);
      }
    }

    // 🔹 Iterar procesos F4
    const filasActuales = await page.$$("#myTable tbody tr");

    for (const fila of filasActuales) {
      try {
        const sistema = (await fila.$eval("td:nth-child(3)", el => el.innerText.trim().toUpperCase())) || "";
        if (sistema !== "F4") continue;

        const descripcion = (await fila.$eval("td:nth-child(5)", el => el.innerText.trim())) || "";
        const estado = ((await fila.$eval("td:nth-child(10)", el => el.innerText.trim())) || "").toUpperCase();
        const fechaTxt = (await fila.$eval("td:nth-child(7)", el => el.innerText.trim())) || "";
        const fechaObj = new Date(fechaTxt.split("/").reverse().join("-"));
        if (estado === "COMPLETADO" || fechaObj.getTime() >= fechaMayor.getTime()) continue;

        const link = await fila.$("a[href*='CodProceso']");
        const href = (await link?.getAttribute("href")) || "";
        const codSistema = href.match(/CodSistema=([^&]+)/i)?.[1] || "F4";
        const codProceso = href.match(/CodProceso=([^&]+)/i)?.[1] || "0";
        const claveProc = `${codSistema}-${codProceso}`;

        // 🧩 BLOQUE NUEVO: Actualizar estatus antes de Correr Calendario
        if (descripcion.toUpperCase().includes("CORRER CALENDARIO")) {
          try {
            const sqlUpdateGlobal = `
              UPDATE PA.PA_BITACORA_PROCESO_CIERRE
                 SET ESTATUS='T'
               WHERE COD_SISTEMA='F4'
                 AND COD_PROCESO <> 17
            `;
            logConsole("📦 Ejecutando SQL correctivo previo al proceso 'Correr Calendario' (F4 Fecha Mayor)...", runId);

            await fetch("http://127.0.0.1:4000/api/run-script", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                baseDatos,
                script: "inline",
                connectString,
                sqlInline: sqlUpdateGlobal,
              }),
            });

            logConsole("✅ Actualización de estatus F4 global ejecutada correctamente (excepto proceso 17).", runId);
          } catch (err) {
            logConsole(`❌ Error ejecutando SQL correctivo previo al calendario: ${err.message}`, runId);
          }

          // 🔹 Ejecución original del bloque “Correr Calendario”
          logConsole(`🧩 [F4 Fecha Mayor] Correr Calendario detectado → forzando estado 'P'`, runId);

          const updateSQL = `
            UPDATE PA.PA_BITACORA_PROCESO_CIERRE
               SET ESTATUS='P', FECHA_INICIO=SYSDATE
             WHERE COD_SISTEMA='${codSistema}'
               AND COD_PROCESO=${codProceso}
               AND TRUNC(FECHA) = (
                 SELECT TRUNC(MAX(x.FECHA))
                   FROM PA.PA_BITACORA_PROCESO_CIERRE x
                  WHERE x.COD_SISTEMA='${codSistema}'
                    AND x.COD_PROCESO=${codProceso}
               )`;

          await fetch("http://127.0.0.1:4000/api/run-script", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ baseDatos, script: "inline", connectString, sqlInline: updateSQL }),
          });

          await monitorearF4Job(connectString, baseDatos, runId, true);
          logConsole("🏁 Correr Calendario completado (fecha mayor).", runId);
        } else {
          const updateSQL = `
            UPDATE PA.PA_BITACORA_PROCESO_CIERRE
               SET ESTATUS='P', FECHA_INICIO=SYSDATE
             WHERE COD_SISTEMA='${codSistema}'
               AND COD_PROCESO=${codProceso}
               AND TRUNC(FECHA) = (
                 SELECT TRUNC(MAX(x.FECHA))
                   FROM PA.PA_BITACORA_PROCESO_CIERRE x
                  WHERE x.COD_SISTEMA='${codSistema}'
                    AND x.COD_PROCESO=${codProceso}
               )`;

          await fetch("http://127.0.0.1:4000/api/run-script", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ baseDatos, script: "inline", connectString, sqlInline: updateSQL }),
          });

          await monitorearF4Job(connectString, baseDatos, runId, true);
          logConsole(`✅ ${descripcion} completado vía SQL.`, runId);
        }
      } catch (errFila) {
        logConsole(`⚠️ Error en proceso F4 especial: ${errFila.message}`, runId);
      }
    }

    logConsole("✅ Todos los procesos F4 con fecha mayor completados.", runId);
    const baseUrl = page.url().split("/ProcesoCierre")[0];
    await navegarConRetries(page, `${baseUrl}/ProcesoCierre/Procesar`);
    logConsole("🔁 Tabla recargada tras finalizar modo F4 Fecha Mayor.", runId);
  } catch (err) {
    logConsole(`❌ Error general en F4FechaMayor: ${err.message}`, runId);
  } finally {
    f4EnEjecucion = false;
    global.__f4ModoEspecialActivo = false;
    logConsole("🚀 [F4 Fecha Mayor] Todos los procesos completados — devolviendo control al flujo normal.", runId);
  }

  return "F4_COMPLETADO_MAYOR";
}





function guardarFechaF4Persistente(descripcion, fecha) {
  try {
    const data = fs.existsSync(cachePath)
      ? JSON.parse(fs.readFileSync(cachePath, "utf-8"))
      : {};
    data[descripcion.toUpperCase()] = fecha;
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf-8");
    logConsole(`💾 Cache F4 actualizado → ${descripcion}: ${fecha}`);
  } catch (err) {
    console.error("⚠️ No se pudo guardar cache F4:", err.message);
  }
}

function cargarFechaF4Persistente(descripcion) {
  try {
    if (!fs.existsSync(cachePath)) return null;
    const data = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    return data[descripcion.toUpperCase()] || null;
  } catch (err) {
    console.error("⚠️ No se pudo leer cache F4:", err.message);
    return null;
  }
}





// =============================================================
// 🔄 Ejecutar proceso por URL directa
// =============================================================
async function ejecutarPorHref(page, fullUrl, descripcion, baseDatos, runId = "GLOBAL") {
  const { logConsole, logWeb } = require("./logger.js");

  try {
    await ejecutarPreScripts(descripcion, baseDatos, runId);
    await new Promise(r => setTimeout(r, 3000));

    logConsole(`🖱️ Navegando a: ${fullUrl}`, runId);
    logWeb(`🖱️ Navegando a: ${fullUrl}`, runId);

    await page.goto(fullUrl, { waitUntil: "load", timeout: 120000 });

    if (page.url().includes("ProcesarDirecto")) {
      logConsole(`Detectada pantalla "Ejecución Manual de Proceso"`, runId);

      const boton = page.locator(
        'button:has-text("Procesar Directo"), input[value="Procesar Directo"], button.btn-primary'
      );
      await boton.first().waitFor({ state: "visible", timeout: 20000 });
      await boton.first().click({ force: true });
      logConsole(`✅ Click en botón superior "Procesar Directo" ejecutado correctamente.`, runId);

      const btnIniciar = page.locator('xpath=//*[@id="myModal"]/div/div/form/div[2]/input');
      await btnIniciar.waitFor({ state: "visible", timeout: 30000 });
      await btnIniciar.click({ force: true });
      logConsole(`✅ Click en botón "Iniciar"`, runId);
    }

    await page.waitForURL(/ProcesoCierre\/Procesar$/, { timeout: 240000 });
    logConsole(`↩️ Redirección detectada correctamente a la tabla principal.`, runId);

    const match = fullUrl.match(/CodSistema=([^&]+)&CodProceso=(\d+)/i);
    const codSistema = match ? match[1] : "UNK";
    const codProceso = match ? match[2] : "0";
    const claveProceso = `${codSistema}-${codProceso}`;

    return await esperarHastaCompletado(page, codSistema, codProceso, descripcion, claveProceso, runId);
  } catch (err) {
    logConsole(`❌ Error ejecutando ${descripcion}: ${err.message}`, runId);
    return "Error";
  }
}


async function completarEjecucionManual(page, runId = "GLOBAL") {
  try {
    await page.waitForTimeout(800);

    // 1️⃣ Botón azul "Procesar Directo"
    const btnProcesar = page.locator('button:has-text("Procesar Directo"), input[value="Procesar Directo"]');
    if (await btnProcesar.first().isVisible().catch(() => false)) {
      logConsole(`✅ Click en botón azul "Procesar Directo"`, runId);
      //await page.waitForTimeout(800);
    }

    // 2️⃣ Botón clásico (myModalAdd)
    const modalAdd = page.locator("#myModalAdd");
    if (await modalAdd.isVisible().catch(() => false)) {
      await modalAdd.click({ force: true });
      logConsole(`✅ Click en #myModalAdd (Procesar Directo clásico)`, runId);
      await page.waitForTimeout(800);
    }

    // 3️⃣ Forzar clic en el botón Iniciar (aunque esté oculto)
    const btnIniciarHidden = await page.$('xpath=//*[@id="myModal"]//input[@type="submit" or @value="Iniciar"]');
    if (btnIniciarHidden) {
      await page.evaluate((el) => el.click(), btnIniciarHidden);
      logConsole(`✅ Click forzado en botón "Iniciar" (modal oculto)`, runId);
    } else {
      // fallback: esperar un modal visible y hacer clic normal
      const modal = page.locator("#myModal");
      await page.waitForSelector("#myModal", { timeout: 10000 }).catch(() => { });
      const btnVisible = modal.locator('input[type="submit"], input[value="Iniciar"], button:has-text("Iniciar")');
      if (await btnVisible.first().isVisible().catch(() => false)) {
        await btnVisible.first().click({ force: true });
        logConsole(`✅ Click en botón "Iniciar" visible (fallback)`, runId);
      } else {
        logConsole(`⚠️ No se encontró botón "Iniciar" visible ni oculto`, runId);
      }
    }

    // 4️⃣ Esperar redirección o forzar regreso
    try {
      await page.waitForURL(/ProcesoCierre\/Procesar$/i, { timeout: 180000 });
      logConsole(`↩️ Redirección detectada correctamente a la tabla principal.`, runId);
    } catch {
      const base = page.url().split("/ProcesoCierre")[0] || "";
      const destino = `${base}/ProcesoCierre/Procesar`;
      logConsole(`🔁 Forzando regreso manual a la tabla principal: ${destino}`, runId);
      await page.goto(destino, { waitUntil: "load", timeout: 120000 });
    }

    await page.waitForSelector("#myTable tbody tr", { timeout: 30000 });
    await page.waitForTimeout(500);
  } catch (err) {
    logConsole(`⚠️ completarEjecucionManual (forzado DOM): ${err.message}`, runId);
  }
}


async function ejecutarProceso(page, sistema, baseDatos, connectString, runId = "GLOBAL") {
  const fs = require("fs");
  const path = require("path");
  const estadoCachePath = path.resolve(__dirname, "../cache/estado_persistente.json");

  function cargarCacheEstado() {
    try {
      if (!fs.existsSync(estadoCachePath)) return {};
      return JSON.parse(fs.readFileSync(estadoCachePath, "utf-8"));
    } catch {
      return {};
    }
  }

  function guardarCacheEstado(cache) {
    try {
      fs.writeFileSync(estadoCachePath, JSON.stringify(cache, null, 2), "utf-8");
    } catch {}
  }

  let cacheEstado = cargarCacheEstado();
  cacheEstado[baseDatos] = cacheEstado[baseDatos] || {};

  await page.waitForSelector("#myTable tbody tr");
  logConsole(`▶️ Analizando sistema ${sistema}...`, runId);

  const procesosEjecutadosGlobal = global.procesosEjecutadosGlobal || new Map();
  global.procesosEjecutadosGlobal = procesosEjecutadosGlobal;

  const procesosFallidosGlobal = global.procesosFallidosGlobal || new Set();
  global.procesosFallidosGlobal = procesosFallidosGlobal;

  const normalizar = (t) =>
    (t || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();

  const buildClaveProceso = (sistema, descripcion, fechaTxt) =>
    `${normalizar(sistema)}|${normalizar(descripcion)}|${(fechaTxt || "").trim()}`;

  let filas = await page.$$("#myTable tbody tr");

  for (let i = 0; i < filas.length; i++) {
    try {
      const fila = filas[i];
      const sis = (await fila.$eval("td:nth-child(3)", (el) => el.innerText.trim().toUpperCase())) || "";
      if (sis !== sistema.toUpperCase()) continue;

      const descripcion = (await fila.$eval("td:nth-child(5)", (el) => el.innerText.trim())) || "";
      const fechaTxt = (await fila.$eval("td:nth-child(7)", (el) => el.innerText.trim())) || "";
      let estado = ((await fila.$eval("td:nth-child(10)", (el) => el.innerText.trim())) || "").toUpperCase();

      const claveEjec = buildClaveProceso(sistema, descripcion, fechaTxt);
      const estadoPrevio = cacheEstado[baseDatos][claveEjec];

      // ✅ Corrección de cache si no coincide
      if (estadoPrevio === "EN PROCESO" && estado !== "EN PROCESO") {
        logConsole(`♻️ Corrigiendo cache: ${descripcion} estaba EN PROCESO en cache, pero ahora está ${estado}.`, runId);
        cacheEstado[baseDatos][claveEjec] = estado;
        guardarCacheEstado(cacheEstado);
      }

      if (procesosFallidosGlobal.has(claveEjec)) {
        logConsole(`🚫 ${descripcion} ya falló previamente — no se reintentará.`, runId);
        continue;
      }

      // 🧠 Reanudar si quedó EN PROCESO
      if (cacheEstado[baseDatos][claveEjec] === "EN PROCESO") {
        logConsole(`⏸️ ${descripcion} estaba EN PROCESO al reiniciar — retomando espera hasta completado.`, runId);
        const resultadoReanudo = await esperarHastaCompletado(page, sistema, descripcion, claveEjec, runId);
        if (resultadoReanudo === "Completado") {
          cacheEstado[baseDatos][claveEjec] = "COMPLETADO";
          guardarCacheEstado(cacheEstado);
          continue;
        } else if (resultadoReanudo === "Error") {
          cacheEstado[baseDatos][claveEjec] = "ERROR";
          guardarCacheEstado(cacheEstado);
          procesosFallidosGlobal.add(claveEjec);
          continue;
        }
      }

      // 🔒 Si está EN PROCESO actualmente
      if (estado === "EN PROCESO") {
        const resultado = await esperarHastaCompletado(page, sistema, descripcion, claveEjec, runId);
        cacheEstado[baseDatos][claveEjec] = (resultado || "DESCONOCIDO").toUpperCase();
        guardarCacheEstado(cacheEstado);
        continue;
      }

      let estadoFinal;

      // ❌ No reintentar si está en ERROR
      if (estado === "ERROR") {
        logConsole(`❌ ${descripcion} se encuentra en ERROR — política: no reintentar.`, runId);
        procesosFallidosGlobal.add(claveEjec);
        continue;
      }

      // ⚙️ Solo ejecutar si está PENDIENTE
      if (estado !== "PENDIENTE") continue;
      if (procesosEjecutadosGlobal.has(claveEjec)) continue;

      logConsole(`▶️ [${sistema}] ${descripcion} (${estado}) — Fecha=${fechaTxt}`, runId);

      // =============================== 🖱️ CLICK EXACTO ===============================
      const filaExacta = await getFilaExacta(page, sistema, descripcion);
      if (!filaExacta) continue;

      const botonProcesar = filaExacta
        .locator('a:has-text("Procesar"), button:has-text("Procesar")')
        .first();

      if (!(await botonProcesar.count())) {
        logConsole(`⚠️ No se encontró botón "Procesar" en la fila de ${descripcion}`, runId);
        continue;
      }

      await botonProcesar.scrollIntoViewIfNeeded();
      await botonProcesar.waitFor({ state: "visible", timeout: 5000 });
      await botonProcesar.click({ force: true });
      logConsole(`🖱️ Click ejecutado en "${descripcion}" (force)`, runId);

      // =============================== 🧩 COMPLETAR MANUAL ===============================
      try {
        await completarEjecucionManual(page, runId);
      } catch (e) {
        logConsole(`⚠️ No se detectó modal: ${e.message}`, runId);
      }

      // =============================== 🕒 MONITOREAR ESTADO ===============================
      let ciclos = 0;
      while (true) {
        await page.waitForTimeout(2000);
        const nuevo = await leerEstadoExacto(page, sistema, descripcion);
        if (nuevo === "COMPLETADO" || nuevo === "ERROR") {
          estadoFinal = nuevo;
          cacheEstado[baseDatos][claveEjec] = estadoFinal;
          guardarCacheEstado(cacheEstado);
          break;
        }
        ciclos++;
      }

      if (estadoFinal === "COMPLETADO") {
        cacheEstado[baseDatos][claveEjec] = "COMPLETADO";
        guardarCacheEstado(cacheEstado);
        logConsole(`✅ ${descripcion} marcado COMPLETADO.`, runId);
      } else if (estadoFinal === "ERROR") {
        logConsole(`❌ ${descripcion} finalizó con error.`, runId);
      }

      // Refrescar tabla
      await navegarConRetries(page, `${page.url().split("/ProcesoCierre")[0]}/ProcesoCierre/Procesar`);
      await page.waitForSelector("#myTable tbody tr", { timeout: 30000 });
      filas = await page.$$("#myTable tbody tr");
      i = -1;
    } catch (err) {
      logConsole(`⚠️ Error inesperado: ${err.message}`, runId);
      await page.waitForTimeout(3000);
      await navegarConRetries(page, `${page.url().split("/ProcesoCierre")[0]}/ProcesoCierre/Procesar`);
      await page.waitForSelector("#myTable tbody tr", { timeout: 30000 });
      filas = await page.$$("#myTable tbody tr");
      continue;
    }
  }

  return "Completado";
}





// -- Helpers globales: parseFecha + esF4FechaMayor ---------------------------
function _parseFechaF4(txt) {
  if (!txt) return null;
  const clean = txt.replace(/[–\-\.]/g, "/").trim();
  const [d, m, y] = clean.split("/").map(Number);
  if (!d || !m || !y) return null;
  const date = new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00`);
  return isNaN(date.getTime()) ? null : date;
}

// ============================================================
// 🧠 Determinar si el proceso F4 tiene la fecha mayor
// ============================================================
async function esF4FechaMayor(descripcionActual, fechaTxt, filasActuales, runId = "GLOBAL") {
  const { logConsole } = require("./logger.js");

  const normalizar = (t) =>
    (t || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();

  const parseFecha = (txt) => {
    if (!txt) return null;
    const clean = txt.replace(/[–\-\.]/g, "/").trim();
    const [d, m, y] = clean.split("/").map(Number);
    if (!d || !m || !y) return null;
    const date = new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00`);
    return isNaN(date.getTime()) ? null : date;
  };

  const descNorm = normalizar(descripcionActual);
  const fechaActual = parseFecha(fechaTxt);
  if (!fechaActual) {
    logConsole(`⚠️ [F4] ${descNorm}: fecha no válida (${fechaTxt || "vacía"}) → se omite comparación.`, runId);
    return false;
  }

  const fechasF4 = [];
  for (const fila of filasActuales) {
    try {
      const sis = (await fila.$eval("td:nth-child(3)", el => el.innerText.trim().toUpperCase())) || "";
      if (sis !== "F4") continue;

      const fechaStr = (await fila.$eval("td:nth-child(7)", el => el.innerText.trim())) || "";
      const val = parseFecha(fechaStr);
      if (val) fechasF4.push(val);
    } catch { /* continúa si alguna fila falla */ }
  }

  if (fechasF4.length === 0) {
    logConsole(`⚠️ [F4] No se detectaron fechas válidas en la tabla para comparación.`, runId);
    return false;
  }

  const fechaMayor = fechasF4.reduce((a, b) => (a > b ? a : b));
  const fechaMayorTxt = fechaMayor.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });

  logConsole(`📅 [F4] Se detectaron ${fechasF4.length} fechas válidas. Mayor encontrada: ${fechaMayorTxt}`, runId);

  if (fechaActual.getTime() === fechaMayor.getTime()) {
    logConsole(`✅ [F4] ${descNorm} tiene la FECHA MAYOR (${fechaTxt}) → activar ejecución SQL (modo especial).`, runId);
    return true;
  } else {
    logConsole(`ℹ️ [F4] ${descNorm}: su fecha (${fechaTxt}) NO es la mayor (${fechaMayorTxt}) → continuar flujo normal.`, runId);
    return false;
  }
}


module.exports = {
  procesosSaltados,
  ejecutarPreScripts,
  esperarHastaCompletado,
  ejecutarF4FechaMayor,
  ejecutarPorHref,
  ejecutarProceso,
  completarEjecucionManual,
  procesosEjecutadosGlobal,
};

