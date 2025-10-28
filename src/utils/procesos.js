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
  // 🔹 F2
  "PROCESO LIQUIDACION PAGATODO": ["estadoMtc.sql"],
  "RECTIFICACION PROCESOS": ["rectificar.sql"],
  "LIQUIDACION PAGOS SERVICIOS": ["ResetestatusF2.sql"],
  "CIERRE DIARIO DE BANCOS": ["RestestatusF2.sql"],

  // 🔹 F3
  "PROVISION DE INTERESES PRESTAMOS": ["ResetEstatuiF3.sql", "PreF3.sql", "EliminarF3.sql"],
  "CLASIFICACION DE SALDOS DE PRESTAMOS": ["RestF3.sql"],

  // 🔹 F4
  "LIBERACION DE EMBARGOS, CONGELAMIENTOS Y CONSULTAS": ["ResetEstatusF4.sql"],
  "CIERRE DIARIO CUENTA EFECTIVO": ["pre-f4.sql"],
  "CIERRE DIARIO CAJA (ATM)": ["cerrar_caja.sql"],
  "GENERAR ASIENTOS PESO IMPUESTOS MONEDA EXTRANJERA": ["cerrar_caja.sql"],
  "GENERACION SALDOS CONTABILIZADOS": ["Prey.sql"],

  // 🔹 F5
  "CIERRE DIARIO DIVISAS": ["Fix_Cierre_Divisas.sql", "resetEstatusF5.sql"],
  "ACTUALIZA VISTA MATERIALIZADA PLAN PAGO DWH": [
    "Reset_multi.sql",
    "Activa_multiUser.sql",
    "Actualiza_multiuser.sql",
  ],

  // 🔹 Otros sistemas o utilitarios
  "CAMBIO SECTOR CONTABLE": ["Cambio_Sector.sql"],
  "CARGA LINEA DIFERIDA ITC": ["estadoMtc.sql"],
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

        if (descripcion.toUpperCase().includes("CORRER CALENDARIO")) {
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



// ============================================================
// ▶️ Ejecutar proceso (espera indefinida + pre-scripts + control de jobs + UPDATE preciso)
// ============================================================
async function ejecutarProceso(page, sistema, baseDatos, connectString, runId = "GLOBAL") {
  await page.waitForSelector("#myTable tbody tr");
  logConsole(`▶️ Analizando sistema ${sistema}...`, runId);

  const procesosEjecutadosGlobal = global.procesosEjecutadosGlobal || new Map();
  global.procesosEjecutadosGlobal = procesosEjecutadosGlobal;

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

  const buildClaveProceso = (sistema, descripcion, fechaTxt) =>
    `${normalizar(sistema)}|${normalizar(descripcion)}|${(fechaTxt || "").trim()}`;

  let filas = await page.$$("#myTable tbody tr");

  for (let i = 0; i < filas.length; i++) {
    try {
      const fila = filas[i];
      const sis = (await fila.$eval("td:nth-child(3)", el => el.innerText.trim().toUpperCase())) || "";
      if (sis !== sistema.toUpperCase()) continue;

      const descripcion = (await fila.$eval("td:nth-child(5)", el => el.innerText.trim())) || "";
      const fechaTxt = (await fila.$eval("td:nth-child(7)", el => el.innerText.trim())) || "";
      const estado = ((await fila.$eval("td:nth-child(10)", el => el.innerText.trim())) || "").toUpperCase();

      const claveEjec = buildClaveProceso(sistema, descripcion, fechaTxt);
      if (!["PENDIENTE", "ERROR"].includes(estado)) continue;
      if (procesosEjecutadosGlobal.has(claveEjec)) continue;

      logConsole(`▶️ [${sistema}] ${descripcion} (${estado}) — Fecha=${fechaTxt}`, runId);

      // =============================== ⚙️ Pre-Scripts configurados ===============================
      if (typeof ejecutarPreScripts === "function") {
        try {
          await ejecutarPreScripts(descripcion, baseDatos, runId);
          logConsole(`✅ Pre-script(s) ejecutado(s) correctamente para ${descripcion}`, runId);
        } catch (preErr) {
          logConsole(`⚠️ Error ejecutando pre-script(s) de ${descripcion}: ${preErr.message}`, runId);
        }
      }

      // =============================== 🧠 F4 Fecha Mayor ===============================
      if (sistema.toUpperCase() === "F4" && typeof ejecutarF4FechaMayor === "function") {
        const filasAct = await page.$$("#myTable tbody tr");
        const tieneMayor = await esF4FechaMayor(descripcion, fechaTxt, filasAct);
        if (tieneMayor) {
          const resultado = await ejecutarF4FechaMayor(page, baseDatos, connectString, runId);
          if (resultado === "F4_COMPLETADO_MAYOR") {
            logConsole(`✅ [F4] ${descripcion} completado vía SQL.`, runId);
            await navegarConRetries(page, `${page.url().split("/ProcesoCierre")[0]}/ProcesoCierre/Procesar`);
            await page.waitForSelector("#myTable tbody tr", { timeout: 30000 });
            filas = await page.$$("#myTable tbody tr");
            continue;
          }
        }
      }

      // =============================== 🖱️ Click normal ===============================
      const filaExacta = await getFilaExacta(page, sistema, descripcion);
      if (!filaExacta) continue;
      const botonProcesar = filaExacta
        .locator('a:has-text("Procesar Directo"), a[href*="Procesar"], a[onclick*="Procesar"]')
        .first();
      if (!(await botonProcesar.count())) continue;

      await botonProcesar.click({ force: true });
      logConsole(`🖱️ Click en "${descripcion}" (force)`, runId);

      try {
        await Promise.race([
          page.waitForURL(/(EjecucionManual|ProcesarDirecto)/i, { timeout: 25000 }),
          page.waitForSelector("#myModalAdd", { timeout: 25000 })
        ]);

        const btn = page.locator("#myModalAdd");
        if (await btn.count()) {
          await btn.click({ force: true });
          logConsole("✅ Click en botón azul 'Procesar Directo'.", runId);
        }

        await completarEjecucionManual(page, runId);

      } catch (e) {
        logConsole(`⚠️ No se detectó modal: ${e.message}`, runId);
      }

      // =============================== 🕒 Espera INDEFINIDA del estado ===============================
      let estadoFinal = null;
      let ciclos = 0;

      while (true) {
        await page.waitForTimeout(2000);

        const nuevo = await leerEstadoExacto(page, sistema, descripcion);
        if (nuevo) {
          if (nuevo !== estado && ciclos % 5 === 0) {
            logConsole(`📄 ${descripcion}: estado actual = ${nuevo}`, runId);
          }
          if (nuevo === "COMPLETADO" || nuevo === "ERROR") {
            estadoFinal = nuevo;
            logConsole(`📊 ${descripcion}: ${estado} → ${estadoFinal}`, runId);
            break;
          }
        } else if (ciclos % 5 === 0) {
          logConsole(`📄 ${descripcion}: estado actual = DESCONOCIDO`, runId);
        }

        if (ciclos % 30 === 29) {
          logConsole(`⏳ Esperando ${descripcion} — refrescando tabla...`, runId);
          await navegarConRetries(page, `${page.url().split("/ProcesoCierre")[0]}/ProcesoCierre/Procesar`);
          await page.waitForSelector("#myTable tbody tr", { timeout: 30000 });
        }

        ciclos++;
      }

      // =============================== ⚠️ Manejo de ERROR con job ===============================
      if (estadoFinal === "ERROR") {
        logConsole(`❌ ${descripcion} finalizó con error.`, runId);

        try {
          const hayJob = typeof monitorearF4Job === "function"
            ? await monitorearF4Job(connectString, baseDatos, runId)
            : false;

          if (hayJob) {
            logConsole(`🟡 Job Oracle activo detectado — esperando que finalice...`, runId);
            await monitorearF4Job(connectString, baseDatos, runId, true);
            logConsole(`✅ Todos los jobs Oracle finalizaron correctamente.`, runId);

            try {
              const link = await fila.$("a[href*='CodProceso']");
              const href = (await link?.getAttribute("href")) || "";
              const codSistema = href.match(/CodSistema=([^&]+)/i)?.[1] || sistema;
              const codProceso = href.match(/CodProceso=([^&]+)/i)?.[1] || "0";

              const sql = `
                UPDATE PA.PA_BITACORA_PROCESO_CIERRE
                   SET ESTATUS='T', FECHA_FIN = SYSDATE
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
                body: JSON.stringify({ baseDatos, script: "inline", connectString, sqlInline: sql }),
              });

              logConsole(`🩹 Proceso ${descripcion} (${codSistema}-${codProceso}) actualizado a 'T' tras finalizar job.`, runId);
            } catch (updateErr) {
              logConsole(`⚠️ Error aplicando UPDATE 'T': ${updateErr.message}`, runId);
            }

          } else {
            logConsole(`ℹ️ No se detectó job Oracle activo para ${descripcion} — continúa flujo normal.`, runId);
            procesosEjecutadosGlobal.set(claveEjec, true);
            logConsole(`🔁 Proceso ${descripcion} en ERROR será omitido en próximos ciclos.`, runId);
          }

        } catch (e) {
          logConsole(`⚠️ Error monitoreando job Oracle: ${e.message}`, runId);
          procesosEjecutadosGlobal.set(claveEjec, true);
          logConsole(`🔁 Proceso ${descripcion} marcado como tratado tras error de monitoreo.`, runId);
        }

        await navegarConRetries(page, `${page.url().split("/ProcesoCierre")[0]}/ProcesoCierre/Procesar`);
        await page.waitForSelector("#myTable tbody tr", { timeout: 30000 });
        filas = await page.$$("#myTable tbody tr");
        i = -1;
        continue;
      }

      // =============================== ✅ Completado normal ===============================
      if (estadoFinal === "COMPLETADO") {
        procesosEjecutadosGlobal.set(claveEjec, true);
        logConsole(`✅ ${descripcion} marcado COMPLETADO.`, runId);
      }

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

async function esF4FechaMayor(descripcionActual, fechaTxt, filasActuales, runId = "GLOBAL") {
  const normalize = (t) =>
    (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

  const descNorm = normalize(descripcionActual);
  const actual = _parseFechaF4(fechaTxt);

  if (!actual) {
    logConsole(`⚠️ [F4] ${descNorm}: no tiene fecha válida, se omite comparación.`, runId);
    return false;
  }

  const fechasF4 = [];
  for (const f of filasActuales) {
    try {
      const sis = (await f.$eval("td:nth-child(3)", el => el.innerText.trim().toUpperCase())) || "";
      if (sis !== "F4") continue;
      const fechaStr = (await f.$eval("td:nth-child(7)", el => el.innerText.trim())) || "";
      const val = _parseFechaF4(fechaStr);
      if (val) fechasF4.push(val);
    } catch { /* noop */ }
  }

  if (fechasF4.length === 0) {
    logConsole(`⚠️ [F4] No hay fechas F4 válidas en la tabla.`, runId);
    return false;
  }

  const fechaMayorGlobal = fechasF4.reduce((a, b) => (a > b ? a : b));
  if (actual.getTime() === fechaMayorGlobal.getTime()) {
    // opcional: persistencia si ya la usas en este archivo
    if (typeof guardarFechaF4Persistente === "function") {
      guardarFechaF4Persistente(descNorm, fechaTxt);
    }
    logConsole(`📆 [F4] ${descNorm} tiene la FECHA MAYOR (${fechaTxt}) → activar cursol.`, runId);
    return true;
  } else {
    logConsole(
      `ℹ️ [F4] ${descNorm}: su fecha (${fechaTxt}) no es la mayor (${fechaMayorGlobal.toLocaleDateString("es-ES")}) → continuar flujo normal.`,
      runId
    );
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

