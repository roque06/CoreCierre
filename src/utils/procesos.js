// ============================================================
// ▶️ Ejecutar proceso (versión persistente con control de F4 Fecha Mayor)
// ============================================================
const fs = require("fs");
const path = require("path");
const { navegarConRetries, esperarCompletado } = require("./navegacion.js");
const { monitorearF4Job } = require("./oracleUtils.js");
const { logConsole, logWeb } = require("./logger.js");


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

// =============================================================
// 🧩 Normalizador seguro
// =============================================================
function normalizarTexto(texto) {
  return texto?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
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

// =============================================================
// 🧩 Pre-scripts por descripción
// =============================================================
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

};

// =============================================================
// 🧩 Ejecutar pre-scripts (versión 100% confiable)
// =============================================================
async function ejecutarPreScripts(descripcion, baseDatos, runId = "GLOBAL") {
  if (!descripcion) return;

  const descNormalizado = normalizarTexto(descripcion);

  const clave = Object.keys(preScripts).find((k) => {
    const keyNorm = normalizarTexto(k);
    return (
      descNormalizado.includes(keyNorm) ||
      keyNorm.includes(descNormalizado) ||
      descNormalizado.startsWith(keyNorm) ||
      descNormalizado.endsWith(keyNorm)
    );
  });

  if (!clave) {
    logConsole(`ℹ️ No se encontró pre-script aplicable para "${descripcion}"`, runId);
    logWeb(`ℹ️ No se encontró pre-script aplicable para "${descripcion}"`, runId);
    return;
  }

  for (const script of preScripts[clave]) {
    logConsole(`🔵 [PRE-SCRIPT] Ejecutando ${script} antes de "${descripcion}"`, runId);
    logWeb(`🔵 [PRE-SCRIPT] Ejecutando ${script} antes de "${descripcion}"`, runId);
    await pedirScript(script, baseDatos, runId);
  }
}

// ============================================================
// ⏳ EsperarCompletado — monitorea hasta que cambie a Completado/Error
// ============================================================
async function esperarHastaCompletado(page, descripcion, runId = "GLOBAL") {
  const inicio = Date.now();
  let estadoPrevio = "";
  const maxMin = 15; // tiempo máximo de espera
  logConsole(`⏳ Esperando que "${descripcion}" cambie de estado...`, runId);

  while (true) {
    try {
      const filaLocator = page.locator("#myTable tbody tr", { hasText: descripcion });
      const badgeLocator = filaLocator.locator("td .badge").first();
      const estadoActual = ((await badgeLocator.innerText()) || "").trim().toUpperCase();

      if (estadoActual !== estadoPrevio) {
        estadoPrevio = estadoActual;
        logConsole(`📊 ${descripcion}: ${estadoActual}`, runId);
      }

      if (["COMPLETADO", "ERROR"].includes(estadoActual)) {
        const dur = ((Date.now() - inicio) / 60000).toFixed(2);
        logConsole(`✅ ${descripcion}: ${estadoActual} tras ${dur} min`, runId);
        return estadoActual;
      }

      const elapsed = (Date.now() - inicio) / 60000;
      if (elapsed >= maxMin) {
        logConsole(`⚠️ Timeout esperando "${descripcion}" (15 min). Último estado: ${estadoPrevio}`, runId);
        return estadoPrevio;
      }
    } catch (err) {
      logConsole(`⚠️ Error leyendo estado de "${descripcion}": ${err.message}`, runId);
    }

    await page.waitForTimeout(8000);
  }
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


async function esperarCorrerCalendarioF4(page, baseDatos, connectString, runId = "GLOBAL") {
  const { monitorearF4Job } = require("./oracleUtils.js");
  let intentos = 0;
  const MAX_INTENTOS = 40; // 160 segundos (~2.5min)
  const intervalo = 4000;

  logConsole("🕓 Iniciando monitoreo específico de 'Correr Calendario (F4)'", runId);

  while (intentos < MAX_INTENTOS) {
    await page.waitForTimeout(intervalo);
    let estadoNow = "";

    try {
      // 🔍 Buscar solo la fila del sistema F4 que contenga "Correr Calendario"
      const filas = await page.$$("#myTable tbody tr");
      let filaCalendario = null;

      for (const fila of filas) {
        const sistema = (await fila.$eval("td:nth-child(3)", el => el.innerText.trim().toUpperCase())) || "";
        const descripcion = (await fila.$eval("td:nth-child(5)", el => el.innerText.trim().toUpperCase())) || "";
        if (sistema === "F4" && descripcion.includes("CORRER CALENDARIO")) {
          filaCalendario = fila;
          break;
        }
      }

      if (!filaCalendario) {
        logConsole(`⚠️ No se encontró fila F4 'Correr Calendario' en intento ${intentos + 1}`, runId);
        const base = page.url().split("/ProcesoCierre")[0];
        await navegarConRetries(page, `${base}/ProcesoCierre/Procesar`);
        await page.waitForSelector("#myTable tbody tr", { timeout: 15000 });
        continue;
      }

      // 🧠 Leer badge del estado actual
      const badgeTxt = await filaCalendario.$eval("td .badge", el => el.innerText.trim().toUpperCase());
      estadoNow = badgeTxt || "PENDIENTE";
      logConsole(`📊 Estado actual de 'Correr Calendario (F4)': ${estadoNow}`, runId);

    } catch (err) {
      logConsole(`⚠️ DOM recargado o error leyendo fila: ${err.message}`, runId);
      const base = page.url().split("/ProcesoCierre")[0];
      await navegarConRetries(page, `${base}/ProcesoCierre/Procesar`);
      await page.waitForSelector("#myTable tbody tr", { timeout: 15000 });
      continue;
    }

    // ✅ Detectar estado final
    if (["COMPLETADO", "ERROR"].includes(estadoNow)) {
      logConsole(`✅ 'Correr Calendario (F4)' finalizó con estado ${estadoNow}`, runId);
      return estadoNow;
    }

    // ⏱️ Si se queda en pendiente mucho tiempo → validar Oracle
    if (estadoNow === "PENDIENTE" && intentos === MAX_INTENTOS - 1) {
      logConsole(`⏱️ 'Correr Calendario (F4)' sigue PENDIENTE → validando Oracle.`, runId);
      try {
        const jobActivo = await monitorearF4Job(connectString, baseDatos, null, runId);
        if (!jobActivo) {
          logConsole(`✅ Oracle confirma sin job activo → se asume COMPLETADO.`, runId);
          return "COMPLETADO";
        } else {
          logConsole(`⚙️ Oracle aún reporta job activo → se corta monitoreo sin bloqueo.`, runId);
          return "FORZADO_OK";
        }
      } catch (err) {
        logConsole(`⚠️ Error validando Oracle (${err.message}) → se asume COMPLETADO.`, runId);
        return "COMPLETADO";
      }
    }

    intentos++;
  }

  logConsole(`🏁 'Correr Calendario (F4)' terminó sin cambio visible → se asume COMPLETADO.`, runId);
  return "COMPLETADO";
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
  global.__f4ModoEspecialActivo = true; // 🟢 activa el modo especial

  try {
    logConsole("🔄 [Modo F4 Fecha Mayor] ejecución controlada por SQL sin clics.", runId);

    // ============================================================
    // 1️⃣ Detectar fechas válidas
    // ============================================================
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

    // ============================================================
    // 2️⃣ Ejecutar scriptCursol solo una vez
    // ============================================================
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

    // ============================================================
    // 3️⃣ Procesar procesos F4
    // ============================================================
    const filasActuales = await page.$$("#myTable tbody tr");

    for (const fila of filasActuales) {
      try {
        const sistema = (await fila.$eval("td:nth-child(3)", el => el.innerText.trim().toUpperCase())) || "";
        if (sistema !== "F4") continue;

        const descripcion = (await fila.$eval("td:nth-child(5)", el => el.innerText.trim())) || "";
        const estado = ((await fila.$eval("td:nth-child(10)", el => el.innerText.trim())) || "").toUpperCase();
        const fechaTxt = (await fila.$eval("td:nth-child(7)", el => el.innerText.trim())) || "";
        const fechaObj = new Date(fechaTxt.split("/").reverse().join("-"));

        // 🚫 Omitir si ya está completado o con fecha igual/mayor
        if (estado === "COMPLETADO" || fechaObj.getTime() >= fechaMayor.getTime()) {
          logConsole(`⏭️ ${descripcion} ya completado o con fecha igual/mayor — omitido.`, runId);
          continue;
        }

        const link = await fila.$("a[href*='CodProceso']");
        const href = (await link?.getAttribute("href")) || "";
        const codSistema = href.match(/CodSistema=([^&]+)/i)?.[1] || "F4";
        const codProceso = href.match(/CodProceso=([^&]+)/i)?.[1] || "0";
        const claveProc = `${codSistema}-${codProceso}`;

        // ============================================================
        // 🧩 Caso especial: Correr Calendario
        // ============================================================
        if (descripcion.toUpperCase().includes("CORRER CALENDARIO")) {
          if (procesosActualizados.has("F4-CORRER_CALENDARIO_FINALIZADO")) {
            logConsole("ℹ️ Correr Calendario (F4) ya fue finalizado previamente — no se reejecuta.", runId);
          } else {
            logConsole(`🧩 [F4 Fecha Mayor] Correr Calendario detectado → forzando estado 'P' y monitoreo especial.`, runId);

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

            logConsole(`✅ Correr Calendario marcado 'P' (${claveProc})`, runId);

            const estadoFinal = await esperarCorrerCalendarioF4(page, baseDatos, connectString, runId);
            if (estadoFinal !== "COMPLETADO") {
              logConsole(`⚠️ [F4 Fecha Mayor] Correr Calendario terminó con estado '${estadoFinal}' → continuando flujo.`, runId);
            }

            logConsole(`🏁 Correr Calendario completado (fecha mayor).`, runId);
            procesosActualizados.add("F4-CORRER_CALENDARIO_FINALIZADO");
          }
        } else {
          // ============================================================
          // 🔸 Procesos F4 normales
          // ============================================================
          if (procesosActualizados.has(claveProc)) continue;

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

          logConsole(`✅ ${descripcion} marcado 'P' (${claveProc})`, runId);
          procesosActualizados.add(claveProc);

          const t0 = Date.now();
          const resultado = await esperarHastaCompletado(page, codSistema, codProceso, descripcion, claveProc, runId);
          const duracion = ((Date.now() - t0) / 60000).toFixed(2);
          logConsole(`✅ ${descripcion}. Completado en ${duracion} min`, runId);
        }

        // ============================================================
        // 🧩 Ejecutar script final de cierre F4
        // ============================================================
        if (
          (
            descripcion.toUpperCase().includes("CORRER CALENDARIO") ||
            descripcion.toUpperCase().includes("GENERACION SALDOS CONTABILIZADOS")
          ) &&
          !procesosActualizados.has("F4_FINAL_T_EJECUTADO")
        ) {
          try {
            logConsole("🏁 Detectado último proceso F4 (Correr Calendario o Generación Saldos Contabilizados) → ejecutando cierre lógico.", runId);
            const sqlFinal = `
              UPDATE PA.PA_BITACORA_PROCESO_CIERRE
                 SET ESTATUS='T'
               WHERE COD_SISTEMA='F4'
               AND COD_PROCESO <> 17`
               ;

            await fetch("http://127.0.0.1:4000/api/run-script", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ baseDatos, script: "inline", connectString, sqlInline: sqlFinal }),
            });

            logConsole("✅ Script final ejecutado — todos los procesos F4 marcados como 'T'.", runId);
            procesosActualizados.add("F4_FINAL_T_EJECUTADO");
          } catch (err) {
            logConsole(`⚠️ Error ejecutando script final de cierre F4: ${err.message}`, runId);
          }
        }

      } catch (errFila) {
        logConsole(`⚠️ Error en proceso F4 especial: ${errFila.message}`, runId);
      }
    }

    // ============================================================
    // 🏁 Fin del modo F4 Fecha Mayor
    // ============================================================
    logConsole("✅ Todos los procesos F4 con fecha mayor completados.", runId);
    const baseUrl = page.url().split("/ProcesoCierre")[0] || "https://default.url";
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

async function ejecutarProceso(page, sistema, baseDatos, connectString, runId = "GLOBAL") {
  const { esperarCompletado, navegarConRetries } = require("./navegacion.js");
  const { ejecutarPreScripts } = require("./helpers.js");
  await page.waitForSelector("#myTable tbody tr");
  logConsole(`▶️ Analizando sistema ${sistema}...`, runId);

  const procesosEjecutadosGlobal = global.procesosEjecutadosGlobal || new Map();
  global.procesosEjecutadosGlobal = procesosEjecutadosGlobal;
  const f4Procesados = new Set();

  // Helper para parsear fechas
  const parseFecha = (txt) => {
    if (!txt) return null;
    const clean = txt.replace(/[–\-\.]/g, "/").trim();
    const [d, m, y] = clean.split("/").map(Number);
    if (!d || !m || !y) return null;
    const date = new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00`);
    return isNaN(date.getTime()) ? null : date;
  };

  // Comparador de fecha mayor para F4
  async function esF4FechaMayor(descripcionActual, fechaTxt, filasActuales, runId = "GLOBAL") {
    const normalize = (t) =>
      t.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();

    const descNorm = normalize(descripcionActual);
    const actual = parseFecha(fechaTxt);
    if (!actual) return false;

    const fechasF4 = [];
    for (const f of filasActuales) {
      try {
        const sis = (await f.$eval("td:nth-child(3)", el => el.innerText.trim().toUpperCase())) || "";
        if (sis !== "F4") continue;
        const fechaStr = (await f.$eval("td:nth-child(7)", el => el.innerText.trim())) || "";
        const val = parseFecha(fechaStr);
        if (val) fechasF4.push(val);
      } catch { }
    }

    if (fechasF4.length === 0) return false;
    const todasIguales = fechasF4.every(f => f.getTime() === fechasF4[0].getTime());
    if (todasIguales) return false;

    const fechaMayorGlobal = fechasF4.reduce((a, b) => (a > b ? a : b));
    return actual.getTime() === fechaMayorGlobal.getTime();
  }

  // ============================================================
  // 🔁 Recorrido de procesos en la tabla
  // ============================================================
  let filas = await page.$$("#myTable tbody tr");

  for (let i = 0; i < filas.length; i++) {
    try {
      const fila = filas[i];
      const sis = (await fila.$eval("td:nth-child(3)", el => el.innerText.trim().toUpperCase())) || "";
      if (sis !== sistema.toUpperCase()) continue;

      const descripcion = (await fila.$eval("td:nth-child(5)", el => el.innerText.trim())) || "";
      const fechaTxt = (await fila.$eval("td:nth-child(7)", el => el.innerText.trim())) || "";
      const estado = ((await fila.$eval("td:nth-child(10)", el => el.innerText.trim())) || "").toUpperCase();
      const descUpper = descripcion.toUpperCase();

      const esCorrerCalendarioF4 = sistema === "F4" && descUpper.includes("CORRER CALENDARIO");
      if (procesosEjecutadosGlobal.has(descUpper) && !esCorrerCalendarioF4) continue;

      if (!["PENDIENTE", "ERROR", "EN PROCESO"].includes(estado)) continue;

      logConsole(`▶️ [${sistema}] ${descripcion} (${estado}) — Fecha=${fechaTxt}`, runId);

      // ============================================================
      // 🧩 CASO ESPECIAL: CORRER CALENDARIO (F4)
      // ============================================================
      if (esCorrerCalendarioF4) {
        logConsole(`🧩 [F4] Caso especial "Correr Calendario"`, runId);

        const tieneMayor = await esF4FechaMayor(descripcion, fechaTxt, filas, runId);
        if (tieneMayor) {
          logConsole(`📆 [F4 Fecha Mayor] Ejecutando Correr Calendario vía SQL`, runId);
          const resultadoF4 = await ejecutarF4FechaMayor(page, baseDatos, connectString, runId);
          if (resultadoF4 === "F4_COMPLETADO_MAYOR") {
            await esperarCorrerCalendarioF4(page, baseDatos, connectString, runId);
          }
          procesosEjecutadosGlobal.set(descUpper, true);
          continue;
        }

        // 🔹 Flujo normal (con clics reales)
        logConsole(`🖱️ [F4] Correr Calendario sin fecha mayor → flujo normal`, runId);

        // 1️⃣ Click en “Procesar Directo”
        const filaLoc = page.locator(`#myTable tbody tr:has-text("${descripcion}")`);
        let boton = filaLoc.locator('a:has-text("Procesar Directo"), button:has-text("Procesar Directo")');
        if (!(await boton.count()))
          boton = filaLoc.locator('a:has-text("Procesar"), button:has-text("Procesar")');

        if (!(await boton.count())) {
          logConsole(`⚠️ No se encontró botón "Procesar Directo" para ${descripcion}`, runId);
          continue;
        }

        await boton.first().scrollIntoViewIfNeeded();
        await boton.first().click({ force: true });
        logConsole(`✅ Click inicial en "Procesar Directo"`, runId);

        // 2️⃣ Esperar pantalla de ejecución manual
        await page.waitForSelector('text=Ejecución Manual de Proceso', { timeout: 20000 });
        logConsole(`📄 Pantalla "Ejecución Manual de Proceso" visible`, runId);

        // 3️⃣ Ejecutar flujo original estable del modal (idéntico al que sí funcionaba)
        await completarEjecucionManual(page, runId);

        // 4️⃣ Esperar resultado real
        const estadoFinal = await esperarCompletado(page, descripcion, runId);
        logConsole(`📊 [F4] Correr Calendario: estado final = ${estadoFinal}`, runId);

        procesosEjecutadosGlobal.set(descUpper, true);
        continue;
      }

      // ============================================================
      // 🧩 Procesos F4 normales (sin caso especial)
      // ============================================================
      if (sistema === "F4") {
        const tieneFechaMayor = await esF4FechaMayor(descripcion, fechaTxt, filas, runId);
        if (tieneFechaMayor) {
          const resultadoF4 = await ejecutarF4FechaMayor(page, baseDatos, connectString, runId);
          if (resultadoF4 === "F4_COMPLETADO_MAYOR") {
            f4Procesados.add(descUpper);
            await navegarConRetries(page, `${page.url().split("/ProcesoCierre")[0]}/ProcesoCierre/Procesar`);
            filas = await page.$$("#myTable tbody tr");
            continue;
          }
        }
      }

      // ============================================================
      // 🧩 Procesos normales (F2–F5)
      // ============================================================
      await ejecutarPreScripts(descripcion, baseDatos);
      const filaLocator = page.locator("#myTable tbody tr", { hasText: descripcion });
      let botonProcesar = filaLocator.locator('a[href*="ProcesarDirecto"]:has-text("Procesar Directo")');
      if (!(await botonProcesar.count()))
        botonProcesar = filaLocator.locator('a:has-text("Procesar"), button:has-text("Procesar")');

      if (!(await botonProcesar.count())) {
        logConsole(`⚠️ No se encontró botón Procesar para "${descripcion}"`, runId);
        continue;
      }

      await botonProcesar.first().scrollIntoViewIfNeeded();
      await botonProcesar.first().click({ force: true });
      logConsole(`🖱️ Click ejecutado en "${descripcion}"`, runId);

      await completarEjecucionManual(page, runId);
      const estadoFinal = await esperarCompletado(page, descripcion, runId);
      logConsole(`📊 ${descripcion}: estado final = ${estadoFinal}`, runId);

    } catch (err) {
      if (err.message?.includes("context") || err.message?.includes("Execution context")) {
        logConsole(`⚠️ Error DOM/contexto (${err.message}) — ignorado.`, runId);
        await page.waitForTimeout(8000);
        continue;
      } else {
        logConsole(`⚠️ Error inesperado: ${err.message}`, runId);
      }
    }
  }

  return "Completado";
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






// ============================================================
// 🧩 completarEjecucionManual — QA7 (clic garantizado en “Iniciar”)
// ============================================================
async function completarEjecucionManual(page, runId = "GLOBAL") {
  try {
    logConsole("⚙️ Iniciando completarEjecucionManual...", runId);

    // 1️⃣ Clic en "Procesar Directo" usando XPath o texto
    const xpathProcesar = '//*[@id="myModalAdd"]';
    const btnProcesar = await page.$(xpathProcesar);

    if (btnProcesar) {
      await btnProcesar.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      await btnProcesar.click({ force: true });
      logConsole(`✅ Click en botón "Procesar Directo" (XPath ${xpathProcesar})`, runId);
    } else {
      logConsole(`⚠️ No se encontró botón "Procesar Directo" (XPath ${xpathProcesar})`, runId);
    }

    // 2️⃣ Esperar que aparezca el modal visible
    await page.waitForSelector("#myModal", { state: "visible", timeout: 15000 });
    logConsole(`📄 Modal de ejecución detectado.`, runId);

    // 3️⃣ Esperar que el botón Iniciar sea visible y clickeable
    const selectorIniciar = "#myModal > div > div > form > div.modal-footer > input";
    await page.waitForTimeout(1000);

    const btnIniciar = await page.$(selectorIniciar);
    if (!btnIniciar) {
      logConsole(`⚠️ No se detectó el botón "Iniciar" (${selectorIniciar})`, runId);
    } else {
      logConsole(`✅ Botón "Iniciar" localizado — esperando habilitación...`, runId);

      // Espera activa hasta que sea clickeable (no oculto, no deshabilitado)
      await page.waitForFunction((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style && style.visibility !== "hidden" && style.display !== "none" && !el.disabled;
      }, selectorIniciar, { timeout: 15000 });

      await page.waitForTimeout(300);
      await btnIniciar.scrollIntoViewIfNeeded();

      try {
        await btnIniciar.click({ delay: 120 });
        logConsole(`✅ Click real ejecutado en botón "Iniciar" (${selectorIniciar})`, runId);
      } catch (err) {
        logConsole(`⚠️ Click directo falló (${err.message}) — aplicando fallback via JS`, runId);
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.click();
        }, selectorIniciar);
        logConsole(`✅ Click forzado en botón "Iniciar" vía JavaScript`, runId);
      }
    }

    // 4️⃣ Esperar redirección natural
    try {
      logConsole(`⏳ Esperando redirección natural de la web...`, runId);
      await page.waitForURL(/ProcesoCierre\/Procesar$/i, { timeout: 180000 });
      await page.waitForSelector("#myTable tbody tr", { timeout: 20000 });
      logConsole(`✅ Redirección detectada y tabla principal cargada nuevamente.`, runId);
    } catch (err) {
      logConsole(`⚠️ No se detectó redirección automática (${err.message}) — recargando manualmente.`, runId);
      const base = page.url().split("/ProcesoCierre")[0];
      await navegarConRetries(page, `${base}/ProcesoCierre/Procesar`);
      await page.waitForSelector("#myTable tbody tr", { timeout: 20000 });
      logConsole(`✅ Tabla principal recargada manualmente.`, runId);
    }
  } catch (err) {
    logConsole(`⚠️ completarEjecucionManual (error): ${err.message}`, runId);
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

