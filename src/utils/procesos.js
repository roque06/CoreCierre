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

function generarResumenFinal(runId, baseDatos, horaInicio, horaFin, fases) {
  const logConsole = global.logConsole || console.log;
  const logWeb = global.logWeb || console.log;

  // 🧮 Calcular duración total
  const duracionTotalMs = horaFin - horaInicio;
  const duracionTotalMin = (duracionTotalMs / 60000).toFixed(2);

  logConsole("==============================================", runId);
  logConsole("📊 RESUMEN FINAL DEL CIERRE", runId);
  logConsole("==============================================", runId);
  logConsole(`🏦 Base de datos: ${baseDatos}`, runId);
  logConsole(`🕒 Inicio del cierre: ${new Date(horaInicio).toLocaleTimeString()}`, runId);
  logConsole(`🕓 Fin del cierre: ${new Date(horaFin).toLocaleTimeString()}`, runId);
  logConsole(`🧭 Duración total: ${duracionTotalMin} minutos`, runId);
  logConsole("----------------------------------------------", runId);

  let totalGeneralMin = 0;

  // 🔁 Recorrer cada fase (F2, F3, F4...)
  for (const [fase, procesos] of Object.entries(fases)) {
    logConsole(`📂 FASE ${fase}`, runId);
    let totalFaseMin = 0;

    for (const p of procesos) {
      const duracionMin = ((p.fin - p.inicio) / 60000).toFixed(2);
      totalFaseMin += parseFloat(duracionMin);
      logConsole(`   - ${p.nombre.padEnd(35, ".")} ${duracionMin} min`, runId);
    }

    totalGeneralMin += totalFaseMin;
    logConsole(`   Total fase ${fase.padEnd(28, ".")} ${totalFaseMin.toFixed(2)} min`, runId);
    logConsole("", runId);
  }

  logConsole("==============================================", runId);
  logConsole(`🧾 Tiempo total de todas las fases: ${totalGeneralMin.toFixed(2)} min`, runId);
  logConsole("✅ CIERRE FINALIZADO CON ÉXITO", runId);
  logConsole("==============================================", runId);

  logWeb("📊 Resumen final del cierre generado correctamente.", runId);
}


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
  const maxIntentos = 180; // ~180s (3 minutos)
  const pausaMs = 1000;
  const inicio = Date.now();

  for (let i = 0; i < maxIntentos; i++) {
    estado = await leerEstadoExacto(page, sistema, descripcion);

    // 🧠 Si vuelve a PENDIENTE, salir para reprocesar
    if (estado === "PENDIENTE") {
      logConsole(
        `♻️ "${descripcion}" detectado como PENDIENTE (no sigue en proceso) — saliendo de espera para reprocesar.`,
        runId
      );
      return "Pendiente";
    }

    // ✅ Si llega a un estado final
    if (["EN PROCESO", "COMPLETADO", "ERROR"].includes(estado)) {
      const minutos = ((Date.now() - inicio) / 60000).toFixed(2);
      logConsole(`📌 Estado final de "${descripcion}" (${sistema}): ${estado} — ${minutos} minutos`, runId);
      return estado;
    }

    // 🕓 Cada 5 ciclos (5s) muestra tiempo transcurrido
    if (i % 5 === 0) {
      const minutos = ((Date.now() - inicio) / 60000).toFixed(2);
      logConsole(`⏳ "${descripcion}": estado actual = ${estado || "—"} — ${minutos}`, runId);
    }

    await page.waitForTimeout(pausaMs);
  }

  const minutosTotales = ((Date.now() - inicio) / 60000).toFixed(2);
  logConsole(`⚠️ Timeout esperando estado final de "${descripcion}" (${sistema}) tras ${minutosTotales} minutos.`, runId);
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

function toOracleFecha(date) {
  const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${d}-${MON[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}


async function ejecutarF4FechaMayor(page, baseDatos, connectString, runId = "GLOBAL") {
  if (f4EnEjecucion) {
    logConsole("⏸️ F4FechaMayor ya en ejecución — esperando a que termine.", runId);
    return;
  }

  const fs = require("fs");
  const path = require("path");
  const { runSqlInline, monitorearF4Job, runQuery } = require("./oracleUtils.js");

  f4EnEjecucion = true;
  global.__f4ModoEspecialActivo = true;

  try {
    logConsole("🔄 [Modo F4 Fecha Mayor] ejecución controlada por SQL directo (sin clics).", runId);
    logWeb("🔄 [Modo F4 Fecha Mayor] ejecución controlada por SQL directo (sin clics).", runId);

    // 1️⃣ Detectar FECHA MAYOR
    await page.waitForSelector("#myTable tbody tr");
    const filas = await page.$$("#myTable tbody tr");
    const fechasValidas = [];

    for (const fila of filas) {
      try {
        const sistema = (await fila.$eval("td:nth-child(3)", el => el.innerText.trim().toUpperCase())) || "";
        if (sistema !== "F4") continue;
        const ftxt = (await fila.$eval("td:nth-child(7)", el => el.innerText.trim())) || "";
        if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(ftxt)) continue;
        const [d, m, y] = ftxt.split("/").map(Number);
        const f = new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00Z`);
        if (!isNaN(f.getTime())) fechasValidas.push({ f, ftxt });
      } catch { }
    }

    if (!fechasValidas.length) {
      logConsole("⚠️ No hay fechas válidas para F4.", runId);
      return "F4_SIN_FECHAS";
    }

    fechasValidas.sort((a, b) => a.f - b.f);
    const fechaMayor = fechasValidas.at(-1).f;
    const fechaMayorDMY = fechasValidas.at(-1).ftxt;
    const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const fechaOracle = `${String(fechaMayor.getUTCDate()).padStart(2, "0")}-${MON[fechaMayor.getUTCMonth()]}-${fechaMayor.getUTCFullYear()}`;
    logConsole(`📆 Fecha mayor detectada: ${fechaMayorDMY} (${fechaOracle})`, runId);

    // 2️⃣ Ejecutar scriptCursol.sql (una sola vez)
    try {
      const original = path.join(__dirname, "../../sql/scriptCursol.sql");
      const temporal = path.join(__dirname, "../../sql/scriptCursol_tmp.sql");
      let contenido = fs.readFileSync(original, "utf-8");
      contenido = contenido.replace(/fecha\s*=\s*'[^']+'/i, `fecha = '${fechaOracle}'`);
      fs.writeFileSync(temporal, contenido, "utf-8");

      logConsole("📦 Ejecutando scriptCursol_tmp.sql...", runId);
      const contenidoFinal = fs.readFileSync(temporal, "utf-8");
      await runSqlInline(contenidoFinal, connectString);
      fs.unlinkSync(temporal);
      logConsole("✅ scriptCursol_tmp.sql ejecutado correctamente.", runId);
    } catch (err) {
      logConsole(`❌ Error al ejecutar scriptCursol.sql: ${err.message}`, runId);
    }

    // 3️⃣ Construir cola con procesos F4 de la FECHA MAYOR
    const filas2 = await page.$$("#myTable tbody tr");
    const cola = [];

    for (const fila of filas2) {
      try {
        const sistema = (await fila.$eval("td:nth-child(3)", el => el.innerText.trim().toUpperCase())) || "";
        if (sistema !== "F4") continue;
        const descripcion = (await fila.$eval("td:nth-child(5)", el => el.innerText.trim())) || "";
        const estado = ((await fila.$eval("td:nth-child(10)", el => el.innerText.trim())) || "").toUpperCase();
        const fechaTxt = (await fila.$eval("td:nth-child(7)", el => el.innerText.trim())) || "";
        if (fechaTxt !== fechaMayorDMY) continue;
        if (["COMPLETADO", "T"].includes(estado)) continue;

        const link = await fila.$("a[href*='CodProceso']");
        const href = (await link?.getAttribute("href")) || "";
        const codSistema = href.match(/CodSistema=([^&]+)/i)?.[1] || "F4";
        const codProceso = href.match(/CodProceso=([^&]+)/i)?.[1] || "0";
        cola.push({ descripcion, codSistema, codProceso, fechaTxt });
      } catch { }
    }

    if (!cola.length) {
      logConsole("📄 No hay procesos F4 pendientes para la fecha mayor.", runId);
      return "F4_SIN_TRABAJO_FECHA_MAYOR";
    }

    logConsole(`▶️ Procesos F4 pendientes (${cola.length}) — fecha ${fechaMayorDMY}`, runId);

    // 4️⃣ Procesar secuencialmente cada F4
    for (let i = 0; i < cola.length; i++) {
      const { descripcion, codSistema, codProceso, fechaTxt } = cola[i];
      logConsole(`▶️ [${codSistema}-${codProceso}] "${descripcion}" → colocar 'P'`, runId);

      const sqlSetP = `
        UPDATE PA.PA_BITACORA_PROCESO_CIERRE
           SET ESTATUS='P', FECHA_INICIO = SYSDATE
         WHERE COD_SISTEMA='${codSistema}'
           AND COD_PROCESO=${codProceso}
           AND FECHA = TO_DATE('${fechaTxt}','dd/mm/yyyy')
      `.trim();

      try {
        await runSqlInline(sqlSetP, connectString);
        logConsole(`✅ "${descripcion}" actualizado a 'P' (fecha ${fechaTxt})`, runId);
      } catch (err) {
        logConsole(`❌ Error al colocar en 'P' ${descripcion}: ${err.message}`, runId);
        continue;
      }

      // 4.2 Monitoreo perpetuo en Oracle
      const sqlEstado = `
        SELECT ESTATUS FROM PA.PA_BITACORA_PROCESO_CIERRE
         WHERE COD_SISTEMA='${codSistema}'
           AND COD_PROCESO=${codProceso}
           AND TRUNC(FECHA)=TO_DATE('${fechaTxt}','DD/MM/YYYY')
      `;
      let estadoOracle = "P";
      let ciclos = 0;
      logConsole(`🧠 Monitoreando estado Oracle de "${descripcion}" (espera indefinida)...`, runId);

      while (true) {
        try {
          const resultado = await runQuery(sqlEstado, connectString);

          // 🧩 Normalizar lectura del campo ESTATUS
          if (Array.isArray(resultado) && resultado.length > 0) {
            const firstRow = resultado[0];
            estadoOracle = (firstRow.ESTATUS || Object.values(firstRow)[0] || "").trim();
          } else if (typeof resultado === "string") {
            estadoOracle = resultado.trim();
          } else if (resultado && typeof resultado === "object") {
            estadoOracle = (resultado.ESTATUS || Object.values(resultado)[0] || "").trim();
          } else {
            estadoOracle = "P";
          }

          if (estadoOracle === "I" || estadoOracle === "P") {
            if (ciclos % 60 === 0) {
              const horas = (ciclos * 5) / 3600;
              logConsole(`⏳ "${descripcion}" sigue EN PROCESO (${estadoOracle}) — ${horas.toFixed(2)}h transcurridas`, runId);
            }
          } else if (estadoOracle === "T") {
            logConsole(`✅ "${descripcion}" confirmado desde Oracle: ESTATUS='T'`, runId);
            break;
          } else if (estadoOracle === "E") {
            logConsole(`❌ "${descripcion}" en ERROR (E) — iniciando monitoreo de job.`, runId);
            try {
              const okJob = await monitorearF4Job(connectString, baseDatos, async () => {
                const sqlSetT = `
                  UPDATE PA.PA_BITACORA_PROCESO_CIERRE
                     SET ESTATUS='T', FECHA_FIN = SYSDATE
                   WHERE COD_SISTEMA='${codSistema}'
                     AND COD_PROCESO=${codProceso}
                     AND TRUNC(FECHA) = (
                       SELECT TRUNC(MAX(x.FECHA))
                         FROM PA.PA_BITACORA_PROCESO_CIERRE x
                        WHERE x.COD_SISTEMA='${codSistema}'
                          AND x.COD_PROCESO=${codProceso}
                     )
                `.trim();
                await runSqlInline(sqlSetT, connectString);
                logConsole(`🩺 Bitácora actualizada a 'T' tras finalizar job (${codSistema}-${codProceso})`, runId);
              }, runId);

              if (!okJob) {
                logConsole(`ℹ️ No hay job activo o falló monitoreo para "${descripcion}".`, runId);
              }
            } catch (err) {
              logConsole(`⚠️ Error monitoreando job de "${descripcion}": ${err.message}`, runId);
            }
            break;
          }
        } catch (err) {
          logConsole(`⚠️ Error leyendo estado Oracle de "${descripcion}": ${err.message}`, runId);
        }

        ciclos++;
        await page.waitForTimeout(5000);
      }

      if (i + 1 < cola.length) {
        await page.waitForTimeout(10000); // pequeño respiro entre procesos
        logConsole(`➡️ Continuando con siguiente proceso (${cola[i + 1].descripcion})...`, runId);
      }
    }

    logConsole("🚀 [F4 Fecha Mayor] Finalizado — control devuelto al flujo normal.", runId);
    logWeb("🚀 [F4 Fecha Mayor] Finalizado — control devuelto al flujo normal.", runId);
    return "F4_COMPLETADO_MAYOR";

  } catch (err) {
    logConsole(`❌ Error general en ejecutarF4FechaMayor: ${err.message}`, runId);
    return "F4_ERROR";
  } finally {
    f4EnEjecucion = false;
    global.__f4ModoEspecialActivo = false;
  }
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

  // 🧹 LIMPIAR CACHE AL INICIAR (solo del ambiente actual)
  try {
    if (fs.existsSync(estadoCachePath)) {
      const data = JSON.parse(fs.readFileSync(estadoCachePath, "utf-8"));
      if (data[baseDatos]) {
        delete data[baseDatos];
        fs.writeFileSync(estadoCachePath, JSON.stringify(data, null, 2), "utf-8");
        logConsole(`🧹 Cache de ${baseDatos} reiniciada correctamente.`, runId);
      } else {
        logConsole(`ℹ️ No había cache previa para ${baseDatos}.`, runId);
      }
    }
  } catch (err) {
    logConsole(`⚠️ No se pudo limpiar cache parcial: ${err.message}`, runId);
  }

  // =============================== FUNCIONES INTERNAS ===============================
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
    } catch { }
  }

  // 🧩 NUEVO: función auxiliar para detectar si todas las fechas son iguales
  function todasLasFechasSonIguales(fechas) {
    if (!fechas || fechas.length === 0) return false;
    return fechas.every(f => f === fechas[0]);
  }

  let cacheEstado = cargarCacheEstado();
  cacheEstado[baseDatos] = cacheEstado[baseDatos] || {};

  await page.waitForSelector("#myTable tbody tr");
  logConsole(`▶️ Analizando sistema ${sistema}...`, runId);

  const procesosEjecutadosGlobal = global.procesosEjecutadosGlobal || new Map();
  global.procesosEjecutadosGlobal = procesosEjecutadosGlobal;

  const procesosFallidosGlobal = global.procesosFallidosGlobal || new Set();
  global.procesosFallidosGlobal = procesosFallidosGlobal;

  const f4Procesados = new Set();

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
      const sis =
        (await fila.$eval("td:nth-child(3)", (el) => el.innerText.trim().toUpperCase())) || "";
      if (sis !== sistema.toUpperCase()) continue;

      const descripcion =
        (await fila.$eval("td:nth-child(5)", (el) => el.innerText.trim())) || "";
      const fechaTxt =
        (await fila.$eval("td:nth-child(7)", (el) => el.innerText.trim())) || "";
      let estado =
        ((await fila.$eval("td:nth-child(10)", (el) => el.innerText.trim())) || "").toUpperCase();

      const claveEjec = buildClaveProceso(sistema, descripcion, fechaTxt);
      const estadoPrevio = cacheEstado[baseDatos][claveEjec];

      // ✅ Corrección de cache si no coincide
      if (estadoPrevio === "EN PROCESO" && estado !== "EN PROCESO") {
        logConsole(
          `♻️ Corrigiendo cache: ${descripcion} estaba EN PROCESO en cache, pero ahora está ${estado}.`,
          runId
        );
        cacheEstado[baseDatos][claveEjec] = estado;
        guardarCacheEstado(cacheEstado);
      }

      if (procesosFallidosGlobal.has(claveEjec)) {
        logConsole(`🚫 ${descripcion} ya falló previamente — no se reintentará.`, runId);
        continue;
      }

      // 🧠 Reanudar si quedó EN PROCESO
      const estadoActualizado = cacheEstado[baseDatos][claveEjec];
      if (estadoActualizado === "EN PROCESO") {
        logConsole(
          `⏸️ ${descripcion} estaba EN PROCESO al reiniciar — retomando espera hasta completado.`,
          runId
        );
        const resultadoReanudo = await esperarHastaCompletado(
          page,
          sistema,
          descripcion,
          claveEjec,
          runId
        );
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
        const resultado = await esperarHastaCompletado(
          page,
          sistema,
          descripcion,
          claveEjec,
          runId
        );
        cacheEstado[baseDatos][claveEjec] = (resultado || "DESCONOCIDO").toUpperCase();
        guardarCacheEstado(cacheEstado);
        continue;
      }

      let estadoFinal;

      // ❌ Si está en ERROR — incluye job Oracle + UPDATE SQL
      if (estado === "ERROR") {
        logConsole(`❌ ${descripcion} se encuentra en ERROR — política: no reintentar.`, runId);
        procesosFallidosGlobal.add(claveEjec);

        try {
          const hayJob =
            typeof monitorearF4Job === "function"
              ? await monitorearF4Job(connectString, baseDatos, runId)
              : false;

          if (hayJob) {
            logConsole(`🟡 Job Oracle activo detectado — esperando que finalice...`, runId);

            const filaTarget = await page
              .locator(`#myTable tbody tr:has-text("${descripcion}")`)
              .first();
            const enlace = filaTarget
              .locator('a[href*="ProcesarDirecto"], a:has-text("Procesar Directo")')
              .first();
            let href = await enlace.getAttribute("href");
            if (href && !href.startsWith("http")) {
              const base = page.url().split("/ProcesoCierre")[0];
              href = `${base}${href.startsWith("/") ? "" : "/"}${href}`;
            }
            const codSistema = href.match(/CodSistema=([^&]+)/i)?.[1] || sistema;
            const codProceso = href.match(/CodProceso=([^&]+)/i)?.[1] || "0";

            const { runSqlInline } = require("./oracleUtils.js");
            await monitorearF4Job(
              connectString,
              baseDatos,
              async () => {
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
                await runSqlInline(sql, connectString);
              },
              runId
            );

            logConsole(
              `✅ Proceso ${descripcion} (${sistema}) actualizado a 'T' tras finalizar job.`,
              runId
            );
            cacheEstado[baseDatos][claveEjec] = "COMPLETADO";
            guardarCacheEstado(cacheEstado);
          } else {
            logConsole(
              `ℹ️ No hay job Oracle activo para ${descripcion} — se deja en ERROR y continúa.`,
              runId
            );
          }
        } catch (e) {
          logConsole(`⚠️ Error monitoreando job Oracle: ${e.message}`, runId);
        }

        continue;
      }

      // ⚙️ Solo ejecutar si está PENDIENTE
      if (estado !== "PENDIENTE") continue;
      if (procesosEjecutadosGlobal.has(claveEjec)) continue;

      logConsole(`▶️ [${sistema}] ${descripcion} (${estado}) — Fecha=${fechaTxt}`, runId);

      // ============================================================
      // 🧩 Caso especial F4 (FECHA MAYOR)
      // ============================================================
      if (sistema === "F4") {
        // Leer todas las fechas F4 para comparar
        const fechasF4 = [];
        for (const filaF4 of filas) {
          try {
            const sistemaF = await filaF4.$eval("td:nth-child(3)", el => el.innerText.trim().toUpperCase());
            const fechaF = await filaF4.$eval("td:nth-child(7)", el => el.innerText.trim());
            if (sistemaF === "F4" && fechaF) fechasF4.push(fechaF);
          } catch { }
        }

        // 🚫 Nueva validación: si todas las fechas F4 son iguales, no activar modo SQL
        if (todasLasFechasSonIguales(fechasF4)) {
          logConsole(`📄 [F4] Todas las fechas F4 son iguales → se omite modo especial.`, runId);
        } else {
          const tieneFechaMayor = await esF4FechaMayor(descripcion, fechaTxt, filas, runId);
          if (tieneFechaMayor) {
            logConsole(`📆 [F4] FECHA MAYOR detectada → ejecutando SQL sin clics`, runId);
            const resultadoF4 = await ejecutarF4FechaMayor(page, baseDatos, connectString, runId);
            if (resultadoF4 === "F4_COMPLETADO_MAYOR") {
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
      }

      // ============================================================
      // ⛔️ BLOQUE DE SEGURIDAD: evitar clics mientras corre modo especial F4
      // ============================================================
      if (global.__f4ModoEspecialActivo) {
        logConsole(`⏳ Modo F4 Fecha Mayor activo — se omite clic en "${descripcion}"`, runId);
        continue;
      }

      // =============================== 📦 Ejecutar pre-scripts ===============================
      try {
        if (typeof ejecutarPreScripts === "function") {
          await ejecutarPreScripts(descripcion, baseDatos, runId);
          logConsole(`✅ Pre-scripts ejecutados correctamente para ${descripcion}`, runId);
        } else {
          logConsole(`⚠️ ejecutarPreScripts() no está definida en este contexto`, runId);
        }
      } catch (err) {
        logConsole(`⚠️ Error ejecutando pre-scripts de ${descripcion}: ${err.message}`, runId);
      }

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

      try {
        await completarEjecucionManual(page, runId);
      } catch (e) {
        logConsole(`⚠️ No se detectó modal: ${e.message}`, runId);
      }

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

