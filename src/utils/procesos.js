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
// 🧩 Mapa global persistente para evitar reejecuciones de F4 por misma fecha
const f4FechasProcesadas = new Set();

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
  "CIERRE DIARIO CUENTA EFECTIVO": ["pre-f4.sql", "resetarjetas.sql"],
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

// =============================================================
// 🕒 Esperar hasta completado (robusta y con timeout)
// =============================================================
// ⏳ Esperar hasta que un proceso termine (Completado / Error)
// =============================================================
async function esperarHastaCompletado(page, codSistema, codProceso, descripcion, claveProceso, runId = "GLOBAL") {
  const nombreProc = descripcion || claveProceso;
  logConsole(`⏳ Monitoreando estado de "${nombreProc}" hasta completado...`, runId);

  const inicio = Date.now();
  let estadoAnterior = "";

  while (true) {
    await page.waitForTimeout(10000); // 🔁 revisar cada 10s

    let estado = "DESCONOCIDO";
    try {
      const filaLocator = page.locator("#myTable tbody tr", { hasText: descripcion });
      const badgeLocator = filaLocator.locator("td .badge").first();
      estado = ((await badgeLocator.innerText()) || "").trim().toUpperCase();
    } catch (err) {
      logConsole(`⚠️ Error leyendo estado de "${nombreProc}": ${err.message}`, runId);
      estado = "DESCONOCIDO";
    }

    // 🔄 Si hay cambio de estado, lo registramos
    if (estado !== estadoAnterior) {
      estadoAnterior = estado;
      logConsole(`📊 ${nombreProc}. ${estado}`, runId);
    }

    // 📈 Evaluar estado
    if (estado.includes("EN PROCESO") || estado === "DESCONOCIDO") {
      continue; // sigue esperando indefinidamente
    }

    if (estado.includes("COMPLETADO")) {
      const minutos = ((Date.now() - inicio) / 60000).toFixed(2);
      logConsole(`✅ ${nombreProc}. Completado en ${minutos} minutos`, runId);
      return "Completado";
    }

    if (estado.includes("ERROR")) {
      const minutos = ((Date.now() - inicio) / 60000).toFixed(2);
      logConsole(`❌ ${nombreProc}. Finalizó con error en ${minutos} minutos`, runId);
      return "Error";
    }
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

  try {
    logConsole("🔄 [Modo F4 Fecha Mayor] ejecución controlada por SQL sin clics.", runId);

    // ============================================================
    // 1️⃣ Detectar fechas F4 y determinar si realmente hay fecha mayor
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
    const todasIguales = fechaMayor.getTime() === fechaMin.getTime();

    logConsole(`🔎 Detectadas ${fechasValidas.length} fechas F4 — mayor=${fechaMayor.toLocaleDateString("es-ES")}`, runId);

    if (todasIguales) {
      logConsole(`ℹ️ Todas las fechas F4 son iguales (${fechaMayor.toLocaleDateString("es-ES")}) → no se activa modo especial.`, runId);
      return "F4_TODAS_IGUALES";
    }

    // ============================================================
    // 2️⃣ Preparar fecha Oracle (DD-MMM-YYYY)
    // ============================================================
    const mesesOracle = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const fechaOracle = `${String(fechaMayor.getUTCDate()).padStart(2, "0")}-${mesesOracle[fechaMayor.getUTCMonth()]}-${fechaMayor.getUTCFullYear()}`;
    logConsole(`📅 Fecha F4 más reciente detectada: ${fechaOracle}`, runId);

    // ============================================================
    // 🧠 Evitar repetir ejecución para la misma fecha
    // ============================================================
    if (f4FechasProcesadas.has(fechaOracle)) {
      logConsole(`⚠️ Fecha mayor ${fechaOracle} ya fue procesada previamente — se omite reejecución.`, runId);
      return "F4_FECHA_DUPLICADA";
    }
    f4FechasProcesadas.add(fechaOracle);

    // ============================================================
    // 3️⃣ Ejecutar scriptCursol.sql solo una vez (si no hay completados)
    // ============================================================
    let fechaYaCompletada = false;
    for (const fila of filas) {
      const sistema = (await fila.$eval("td:nth-child(3)", el => el.innerText.trim().toUpperCase())) || "";
      const fechaTxt = (await fila.$eval("td:nth-child(7)", el => el.innerText.trim())) || "";
      const estadoTxt = ((await fila.$eval("td:nth-child(10)", el => el.innerText.trim())) || "").toUpperCase();

      if (sistema === "F4" && fechaTxt) {
        const f = new Date(fechaTxt.split("/").reverse().join("-"));
        if (f.getTime() === fechaMayor.getTime() && estadoTxt === "COMPLETADO") {
          fechaYaCompletada = true;
          break;
        }
      }
    }

    if (fechaYaCompletada) {
      logConsole("✅ Fecha mayor F4 ya tiene procesos completados — no se ejecuta scriptCursol.sql", runId);
      return "F4_FECHA_YA_PROCESADA";
    }

    if (!procesosActualizados.has("SCRIPT_F4")) {
      try {
        const original = path.join(__dirname, "../../sql/scriptCursol.sql");
        const temporal = path.join(__dirname, "../../sql/scriptCursol_tmp.sql");
        let contenido = fs.readFileSync(original, "utf-8");
        contenido = contenido.replace(/fecha\s*=\s*'[^']+'/i, `fecha = '${fechaOracle}'`);
        fs.writeFileSync(temporal, contenido, "utf-8");

        logConsole(`📦 Ejecutando scriptCursol_tmp.sql con fecha ${fechaOracle}`, runId);
        await fetch("http://127.0.0.1:4000/api/run-script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseDatos, script: "scriptCursol_tmp.sql", connectString }),
        });

        fs.unlinkSync(temporal);
        logConsole("✅ scriptCursol_tmp.sql ejecutado correctamente.", runId);
        procesosActualizados.add("SCRIPT_F4");
      } catch (err) {
        logConsole(`❌ Error ejecutando script temporal: ${err.message}`, runId);
      }
    }

    // ============================================================
    // 4️⃣ Procesar procesos F4 (orden natural, no por codProceso)
    // ============================================================
    const filasActuales = await page.$$("#myTable tbody tr");
    const procesos = [];

    for (const fila of filasActuales) {
      try {
        const sistema = (await fila.$eval("td:nth-child(3)", el => el.innerText.trim().toUpperCase())) || "";
        if (sistema !== "F4") continue;
        const descripcion = (await fila.$eval("td:nth-child(5)", el => el.innerText.trim())) || "";
        const estado = ((await fila.$eval("td:nth-child(10)", el => el.innerText.trim())) || "").toUpperCase();
        const fechaTxt = (await fila.$eval("td:nth-child(7)", el => el.innerText.trim())) || "";
        const link = await fila.$("a[href*='CodProceso']");
        const href = (await link?.getAttribute("href")) || "";
        const codProceso = parseInt(href.match(/CodProceso=([^&]+)/i)?.[1] || "0", 10);
        procesos.push({ descripcion, estado, fechaTxt, codProceso });
      } catch { }
    }

    let omitidos = 0;

    for (const { descripcion, estado, fechaTxt, codProceso } of procesos) {
      try {
        if (page.isClosed && page.isClosed()) {
          logConsole("⚠️ Página cerrada prematuramente durante F4FechaMayor — abortando monitoreo.", runId);
          return "F4_ABORTADO";
        }

        const fechaObj = new Date(fechaTxt.split("/").reverse().join("-"));

        // ⚠️ Omitir solo si COMPLETADO y fecha > fechaMayor
        // 🚫 Omitir todo proceso COMPLETADO (de cualquier fecha)
        if (estado === "COMPLETADO") {
          omitidos++;
          continue;
        }

        // 🚫 Omitir los procesos cuya fecha es IGUAL o MAYOR a la fecha mayor global
        if (fechaObj.getTime() >= fechaMayor.getTime()) {
          omitidos++;
          continue;
        }

        // ✅ Solo procesar los que estén PENDIENTES o ERROR y con fecha menor

        // --- Detectar fila más reciente si hay duplicados
        const filasDuplicadas = page.locator("#myTable tbody tr", { hasText: descripcion });
        const total = await filasDuplicadas.count();
        let filaCorrecta;
        if (total > 1) {
          let fechaMax = 0;
          for (let x = 0; x < total; x++) {
            const filaTmp = filasDuplicadas.nth(x);
            const fechaTxtTmp = (await filaTmp.locator("td:nth-child(7)").textContent())?.trim() || "";
            const f = new Date(fechaTxtTmp.split("/").reverse().join("-"));
            if (f && f.getTime() > fechaMax) {
              fechaMax = f.getTime();
              filaCorrecta = filaTmp;
            }
          }
          logConsole(`⚙️ Duplicadas detectadas para "${descripcion}" → usando fila con fecha más reciente.`, runId);
        } else {
          filaCorrecta = filasDuplicadas.first();
        }

        const linkLocator = filaCorrecta.locator("a[href*='CodProceso']").first();
        const href = (await linkLocator.getAttribute("href")) || "";
        const codSistema = href.match(/CodSistema=([^&]+)/i)?.[1] || "F4";
        const claveProc = `${codSistema}-${codProceso}`;
        if (procesosActualizados.has(claveProc)) continue;

        // ============================================================
        // 4A️⃣ Actualizar a 'P' (en proceso) y confirmar en DOM
        // ============================================================
        const updateSQL = `
          UPDATE PA.PA_BITACORA_PROCESO_CIERRE t
             SET t.ESTATUS='P', t.FECHA_INICIO=SYSDATE
           WHERE t.COD_SISTEMA='${codSistema}'
             AND t.COD_PROCESO=${codProceso}
             AND TRUNC(t.FECHA) = (
               SELECT TRUNC(MAX(x.FECHA))
                 FROM PA.PA_BITACORA_PROCESO_CIERRE x
                WHERE x.COD_SISTEMA='${codSistema}'
                  AND x.COD_PROCESO=${codProceso}
             )`;

        logConsole(`📦 Ejecutando actualización vía backend: ${claveProc}`, runId);
        await fetch("http://127.0.0.1:4000/api/run-script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseDatos,
            script: "inline",
            connectString,
            sqlInline: updateSQL,
          }),
        });

        logConsole(`✅ ${descripcion} marcado como 'P' (en proceso).`, runId);
        procesosActualizados.add(claveProc);

        // --- Esperar DOM actualizado
        let confirmado = false;
        for (let intento = 0; intento < 20; intento++) {
          await page.waitForTimeout(1000);
          const estadoDom = ((await filaCorrecta.locator("td:nth-child(10)").textContent()) || "").trim().toUpperCase();
          if (estadoDom.includes("PROCESO")) {
            confirmado = true;
            logConsole(`🟢 DOM confirmado: "${descripcion}" está EN PROCESO`, runId);
            break;
          }
        }
        if (!confirmado) {
          logConsole(`⚠️ No se confirmó cambio DOM a 'EN PROCESO' para "${descripcion}". Continuando...`, runId);
        }

        // ============================================================
        // 4B️⃣ Esperar hasta COMPLETADO o ERROR
        // ============================================================
        logConsole(`⏳ Monitoreando estado de "${descripcion}" hasta completado...`, runId);
        const t0 = Date.now();
        const resultado = await esperarHastaCompletado(page, codSistema, codProceso, descripcion, claveProc, runId)
          .catch(err => {
            logConsole(`⚠️ Error en esperarHastaCompletado: ${err.message}`, runId);
            return "Error";
          });
        const duracion = ((Date.now() - t0) / 60000).toFixed(2);

        if (resultado === "Error") {
          logConsole(`🔍 [F4 Fecha Mayor] Error en ${descripcion} → iniciando monitoreo Oracle.`, runId);
          const { monitorearF4Job, runSqlInline } = require("./oracleUtils.js");
          await monitorearF4Job(connectString, baseDatos, async () => {
            const updateSQL2 = `
              UPDATE PA.PA_BITACORA_PROCESO_CIERRE
                 SET ESTATUS='T', FECHA_FIN=SYSDATE
               WHERE COD_SISTEMA='${codSistema}'
                 AND COD_PROCESO=${codProceso}
                 AND TRUNC(FECHA) = (
                   SELECT TRUNC(MAX(x.FECHA))
                     FROM PA.PA_BITACORA_PROCESO_CIERRE x
                    WHERE x.COD_SISTEMA='${codSistema}'
                      AND x.COD_PROCESO=${codProceso}
                 )`;
            await runSqlInline(updateSQL2, connectString);
            logConsole(`✅ Bitácora Oracle actualizada para ${codSistema}-${codProceso}`, runId);
          }, runId);
        }

        logConsole(`✅ ${descripcion}. Completado en ${duracion} minutos`, runId);
      } catch (errFila) {
        logConsole(`⚠️ Error en proceso F4 especial: ${errFila.message}`, runId);
      }
    }

    if (omitidos > 0)
      logConsole(`⏭️ ${omitidos} procesos completados con fecha mayor fueron omitidos.`, runId);

    // ============================================================
    // 5️⃣ Recargar tabla
    // ============================================================
    logConsole("✅ Todos los procesos F4 con fecha mayor completados.", runId);
    const baseUrl = page.url().split("/ProcesoCierre")[0] || "";
    if (!page.isClosed || !page.isClosed()) {
      await navegarConRetries(page, `${baseUrl}/ProcesoCierre/Procesar`);
      logConsole("🔁 Tabla recargada tras finalizar modo F4 Fecha Mayor.", runId);
    } else {
      logConsole("⚠️ No se pudo recargar tabla (la página fue cerrada).", runId);
    }
  } catch (err) {
    logConsole(`❌ Error general en F4FechaMayor: ${err.message}`, runId);
  } finally {
    f4EnEjecucion = false;
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
  await page.waitForSelector("#myTable tbody tr");
  logConsole(`▶️ Analizando sistema ${sistema}...`, runId);

  const procesosEjecutadosGlobal = global.procesosEjecutadosGlobal || new Map();
  global.procesosEjecutadosGlobal = procesosEjecutadosGlobal;
  const f4Procesados = new Set();

  // --- Helper para parsear fechas ---
  const parseFecha = (txt) => {
    if (!txt) return null;
    const clean = txt.replace(/[–\-\.]/g, "/").trim();
    const [d, m, y] = clean.split("/").map(Number);
    if (!d || !m || !y) return null;
    const date = new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00`);
    return isNaN(date.getTime()) ? null : date;
  };

  // --- Detectar si el proceso F4 tiene fecha mayor ---
  async function esF4FechaMayor(descripcionActual, fechaTxt, filasActuales, runId = "GLOBAL") {
    const normalize = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ").trim().toUpperCase();

    const descNorm = normalize(descripcionActual);
    const actual = parseFecha(fechaTxt);

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
        const val = parseFecha(fechaStr);
        if (val) fechasF4.push(val);
      } catch { }
    }

    if (fechasF4.length === 0) {
      logConsole(`⚠️ [F4] No hay fechas F4 válidas en la tabla.`, runId);
      return false;
    }

    const fechaMayorGlobal = fechasF4.reduce((a, b) => (a > b ? a : b));
    if (actual.getTime() === fechaMayorGlobal.getTime()) {
      guardarFechaF4Persistente(descNorm, fechaTxt);
      logConsole(`📆 [F4] ${descNorm} tiene la FECHA MAYOR (${fechaTxt}) → activar cursol.`, runId);
      return true;
    }

    logConsole(`ℹ️ [F4] ${descNorm}: su fecha (${fechaTxt}) no es la mayor (${fechaMayorGlobal.toLocaleDateString("es-ES")}) → continuar flujo normal.`, runId);
    return false;
  }

  // --- Recorrer todas las filas ---
  let filas = await page.$$("#myTable tbody tr");

  for (let i = 0; i < filas.length; i++) {
    try {
      const fila = filas[i];
      const sis = (await fila.$eval("td:nth-child(3)", el => el.innerText.trim().toUpperCase())) || "";
      if (sis !== sistema.toUpperCase()) continue;

      const descripcion = (await fila.$eval("td:nth-child(5)", el => el.innerText.trim())) || "";
      const fechaTxt = (await fila.$eval("td:nth-child(7)", el => el.innerText.trim())) || "";
      const estado = ((await fila.$eval("td:nth-child(10)", el => el.innerText.trim())) || "").toUpperCase();

      // --- Omitir filas F4 con fecha menor ---
      // --- Omitir filas F4 con fecha menor ---
      if (sistema.toUpperCase() === "F4") {
        const fechasF4 = [];
        for (const f of filas) {
          try {
            const sis = (await f.$eval("td:nth-child(3)", el => el.innerText.trim().toUpperCase())) || "";
            if (sis !== "F4") continue;
            const fechaStr = (await f.$eval("td:nth-child(7)", el => el.innerText.trim())) || "";
            const val = parseFecha(fechaStr);
            if (val) fechasF4.push(val);
          } catch { }
        }

        if (fechasF4.length > 0) {
          const fechaMayor = fechasF4.reduce((a, b) => (a > b ? a : b));
          const fechaActual = parseFecha(fechaTxt);
          if (fechaActual < fechaMayor) {
            logConsole(`⏭️ [F4] ${descripcion} tiene fecha menor (${fechaTxt}) → omitido.`, runId);
            continue;
          }
        }
      }


      // --- Procesos en ejecución ---
      if (estado === "EN PROCESO") {
        logConsole(`⏸️ ${descripcion} está en proceso — esperando que finalice.`, runId);
        const resultado = await esperarCompletado(page, descripcion, runId);
        if (resultado === "Error") {
          logConsole(`❌ ${descripcion} terminó con error — deteniendo ejecución.`, runId);
          break;
        }
        continue;
      }

      if (procesosEjecutadosGlobal.has(descripcion.toUpperCase())) continue;
      if (!["PENDIENTE", "ERROR"].includes(estado)) continue;
      if (sistema === "F4" && f4Procesados.has(descripcion.toUpperCase())) continue;

      logConsole(`▶️ [${sistema}] ${descripcion} (${estado}) — Fecha=${fechaTxt}`, runId);

      // --- F4 con fecha mayor ---
      if (sistema.toUpperCase() === "F4") {
        let tieneFechaMayor = false;
        try {
          tieneFechaMayor = await esF4FechaMayor(descripcion, fechaTxt, filas, runId);
        } catch (err) {
          logConsole(`⚠️ Error evaluando FECHA MAYOR para ${descripcion}: ${err.message}`, runId);
        }

        if (tieneFechaMayor) {
          const fechaParsed = parseFecha(fechaTxt);
          const mesesOracle = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
          const fechaOracle = `${String(fechaParsed.getUTCDate()).padStart(2, "0")}-${mesesOracle[fechaParsed.getUTCMonth()]}-${fechaParsed.getUTCFullYear()}`;

          if (f4FechasProcesadas.has(fechaOracle)) {
            logConsole(`⚙️ [F4] Fecha mayor ${fechaOracle} ya fue procesada anteriormente — omitiendo.`, runId);
            continue;
          }

          logConsole(`📆 [F4] FECHA MAYOR detectada → ejecutando SQL sin clics`, runId);
          const resultadoF4 = await ejecutarF4FechaMayor(page, baseDatos, connectString, runId);
          if (resultadoF4 === "F4_COMPLETADO_MAYOR") {
            f4FechasProcesadas.add(fechaOracle);
            f4Procesados.add(descripcion.toUpperCase());
            await navegarConRetries(page, `${page.url().split("/ProcesoCierre")[0]}/ProcesoCierre/Procesar`);
            logConsole(`✅ [F4] Flujo FECHA MAYOR completado sin clics`, runId);
            filas = await page.$$("#myTable tbody tr");
            continue;
          }
        } else {
          logConsole(`⏭️ [F4] ${descripcion} no tiene fecha mayor → flujo normal.`, runId);
        }
      }

      // --- Flujo normal ---
      try {
        await ejecutarPreScripts(descripcion, baseDatos);
      } catch (err) {
        logConsole(`⚠️ Error ejecutando pre-scripts: ${err.message}`, runId);
      }

      // Duplicados → fila más reciente
      const filasCoincidentes = page.locator("#myTable tbody tr", { hasText: descripcion });
      const totalCoincidencias = await filasCoincidentes.count();
      let filaCorrecta;
      if (totalCoincidencias > 1) {
        filaCorrecta = await seleccionarFilaMasReciente(page, filasCoincidentes, runId);
      } else {
        filaCorrecta = filasCoincidentes.first();
      }

      let botonProcesar = filaCorrecta.locator('a[href*="ProcesarDirecto"]:has-text("Procesar Directo")');
      if ((await botonProcesar.count()) === 0)
        botonProcesar = filaCorrecta.locator('a:has-text("Procesar"), button:has-text("Procesar")');

      if ((await botonProcesar.count()) === 0) {
        logConsole(`⚠️ No se encontró botón Procesar para "${descripcion}"`, runId);
        continue;
      }

      await botonProcesar.first().scrollIntoViewIfNeeded();
      await botonProcesar.first().click({ force: true });

      procesosEjecutadosGlobal.set(descripcion.toUpperCase(), true);
      logConsole(`🖱️ Click ejecutado en "${descripcion}"`, runId);

      await completarEjecucionManual(page, runId);

      const estadoFinal = await esperarCompletado(page, descripcion, runId);
      logConsole(`📊 ${descripcion}: estado final = ${estadoFinal}`, runId);

      logConsole(`✅ ${descripcion} completado correctamente.`, runId);
      await navegarConRetries(page, `${page.url().split("/ProcesoCierre")[0]}/ProcesoCierre/Procesar`);
      await page.waitForSelector("#myTable tbody tr", { timeout: 30000 });
      filas = await page.$$("#myTable tbody tr");
      logConsole(`🔁 Tabla actualizada tras completar ${descripcion} — continuando.`, runId);
      i = -1;
    } catch (err) {
      logConsole(`⚠️ Error inesperado: ${err.message}`, runId);
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

// =============================================================
// 🧩 completarEjecucionManual (modo forzado DOM + fallback visible)
// =============================================================
async function completarEjecucionManual(page, runId = "GLOBAL") {
  try {
    await page.waitForTimeout(800);

    // 1️⃣ Botón azul "Procesar Directo"
    const btnProcesar = page.locator('button:has-text("Procesar Directo"), input[value="Procesar Directo"]');
    if (await btnProcesar.first().isVisible().catch(() => false)) {
      await btnProcesar.first().click({ force: true });
      logConsole(`✅ Click en botón azul "Procesar Directo"`, runId);
      await page.waitForTimeout(800);
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

