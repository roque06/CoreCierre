// @ts-nocheck
const { logConsole, logWeb } = require("./logger.js");
const { BASE_URL } = require("./config.js");

/**
 * 🔁 Navega con reintentos automáticos si hay error o timeout.
 */
async function navegarConRetries(page, url, maxRetries = 3) {
  for (let intento = 1; intento <= maxRetries; intento++) {
    try {
      logConsole(`🌐 Intentando navegar a ${url} (intento ${intento})`);
      await page.goto(url, { waitUntil: "load", timeout: 60000 });
      logConsole(`✅ Navegación exitosa a ${url}`);
      return true;
    } catch (err) {
      logConsole(`❌ Error al cargar ${url} en intento ${intento}: ${err.message}`);
      if (intento === maxRetries) throw err;
      await page.waitForTimeout(3000);
    }
  }
}


const { monitorearF4Job, runSqlInline } = require("./oracleUtils.js");


async function esperarCompletado(page, descripcion, runId = "GLOBAL", sistema = "F4") {
  let estado = "";
  let intentos = 0;
  const maxIntentos = 200;
  const esperaEntreIntentos = 30000;

  const normalizar = (txt) =>
    (txt || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();

  while (intentos < maxIntentos) {
    intentos++;

    try {
      // 🔄 Refrescar tabla
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector("#myTable tbody tr", { timeout: 20000 });

      const filas = await page.$$("#myTable tbody tr");
      let filaEncontrada = null;

      // ============================================================
      // 🧩 Buscar fila correcta (filtrado por sistema + descripción exacta)
      // ============================================================
      for (const fila of filas) {
        try {
          // Detectar columna donde está el sistema (1 o 3)
          let codSistema = "";
          for (const idx of [1, 3]) {
            try {
              const txt = await fila.$eval(`td:nth-child(${idx})`, el => el.innerText.trim().toUpperCase());
              if (["F2", "F4", "F5", "MTC"].includes(txt)) {
                codSistema = txt;
                break;
              }
            } catch { }
          }

          const desc = await fila.$eval("td:nth-child(5)", el => el.innerText.trim().toUpperCase());

          // ✅ Filtrar solo coincidencias exactas del sistema
          if (codSistema === sistema.toUpperCase()) {
            if (normalizar(desc) === normalizar(descripcion)) {
              filaEncontrada = fila;
              break;
            }
          }
        } catch { }
      }

      if (!filaEncontrada) {
        logConsole(`⚠️ No se encontró la fila para "${descripcion}" (${sistema}) — reintentando...`, runId);
        await page.waitForTimeout(20000);
        continue;
      }

      // ============================================================
      // 📖 Leer estado actual del proceso
      // ============================================================
      let estadoCelda = "N/A";
      try {
        estadoCelda = await filaEncontrada.$eval("td:nth-child(9)", el => el.innerText.trim().toUpperCase());
      } catch (err) {
        logConsole(`⚠️ No se pudo leer estado de "${descripcion}" (${sistema}): ${err.message}`, runId);
        await page.waitForTimeout(15000);
        continue;
      }

      estado = estadoCelda || "N/A";

      // ============================================================
      // 🧩 CASO ESPECIAL: F4-5 (Aplicación de Transferencias Automáticas)
      // ============================================================
      if (sistema === "F4" && normalizar(descripcion) === normalizar("Aplicación de Transferencias Automáticas")) {
        logConsole(`⚙️ Proceso F4-5 detectado → ejecutando UPDATE forzado en bitácora y omitiendo espera.`, runId);
        const updateSQL = `
          UPDATE PA.PA_BITACORA_PROCESO_CIERRE
             SET ESTATUS='T', FECHA_FIN = SYSDATE
           WHERE COD_SISTEMA='F4'
             AND COD_PROCESO=5
             AND TRUNC(FECHA) = (
               SELECT TRUNC(MAX(x.FECHA))
                 FROM PA.PA_BITACORA_PROCESO_CIERRE x
                WHERE x.COD_SISTEMA='F4'
                  AND x.COD_PROCESO=5
             )`;
        try {
          const { runSqlInline } = require("./oracleUtils.js");
          const ok = await runSqlInline(updateSQL, connectString);
          logConsole(ok ? `✅ Bitácora actualizada correctamente para F4-5.` : `⚠️ No se pudo actualizar bitácora para F4-5.`, runId);
        } catch (e) {
          logConsole(`❌ Error ejecutando SQL inline (F4-5): ${e.message}`, runId);
        }
        return "IGNORADO";
      }

      // ============================================================
      // 🧩 CASO ESPECIAL: F4-16 (Correr Calendario)
      // ============================================================
      if (sistema === "F4" && normalizar(descripcion) === normalizar("Correr Calendario")) {
        logConsole(`⚙️ Proceso F4-16 'Correr Calendario' detectado → forzando cierre automático.`, runId);
        const updateSQL = `
          UPDATE PA.PA_BITACORA_PROCESO_CIERRE
             SET ESTATUS='T', FECHA_FIN = SYSDATE
           WHERE COD_SISTEMA='F4'
             AND COD_PROCESO=16
             AND TRUNC(FECHA) = (
               SELECT TRUNC(MAX(x.FECHA))
                 FROM PA.PA_BITACORA_PROCESO_CIERRE x
                WHERE x.COD_SISTEMA='F4'
                  AND x.COD_PROCESO=16
             )`;
        try {
          const { runSqlInline } = require("./oracleUtils.js");
          const ok = await runSqlInline(updateSQL, connectString);
          logConsole(ok ? `✅ Bitácora actualizada correctamente para F4-16 (Correr Calendario).` : `⚠️ No se pudo actualizar bitácora para F4-16.`, runId);
        } catch (e) {
          logConsole(`❌ Error ejecutando SQL inline (F4-16): ${e.message}`, runId);
        }
        return "IGNORADO";
      }

      // ============================================================
      // 🏁 Detectar fin del proceso
      // ============================================================
      if (["COMPLETADO", "ERROR"].includes(estado)) {
        logConsole(`📌 Estado final de "${descripcion}" (${sistema}): ${estado}`, runId);
        return estado;
      }

      if (/^\d{1,2}\/\d{1,2}\/\d{4}\.\d{1,2}:\d{2}(AM|PM)$/i.test(estado)) {
        logConsole(`📅 Estado con timestamp detectado ("${estado}") → interpretado como COMPLETADO.`, runId);
        return "COMPLETADO";
      }

      logConsole(`⏳ "${descripcion}" (${sistema}) sigue en estado: ${estado} → esperando... (${intentos}/${maxIntentos})`, runId);
    } catch (err) {
      logConsole(`⚠️ Error leyendo estado de "${descripcion}" (${sistema}): ${err.message}`, runId);
    }

    await page.waitForTimeout(esperaEntreIntentos);
  }

  logConsole(`🛑 Se alcanzó el máximo de intentos esperando "${descripcion}" (${sistema}) — último estado: ${estado}`, runId);
  return estado;
}









/**
 * 🔍 Lee el estado actual del proceso en la tabla principal (tolerante y con reintentos)
 */
async function esperarEstadoTabla(page, descripcion, reintento = 0) {
  try {
    const filas = page.locator("#myTable tbody tr");
    const total = await filas.count();
    const descNormal = descripcion
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .trim();

    for (let i = 0; i < total; i++) {
      const fila = filas.nth(i);
      const celdas = fila.locator("td");
      if ((await celdas.count()) < 10) continue;

      const descCelda = ((await celdas.nth(4).textContent()) || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .trim();

      if (descCelda.includes(descNormal)) {
        const estadoCelda = ((await celdas.nth(9).textContent()) || "").trim();
        logConsole(`📄 Estado leído para "${descripcion}": ${estadoCelda}`);
        return estadoCelda || "Desconocido";
      }
    }

    // 🔁 Si no encontró la fila, reintenta hasta 3 veces
    if (reintento < 3) {
      logConsole(
        `⚠ No se encontró fila para "${descripcion}" (intento ${reintento + 1}) → reintentando...`
      );
      await page.waitForTimeout(3000);
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
      return await esperarEstadoTabla(page, descripcion, reintento + 1);
    }

    logConsole(`⚠ No se encontró fila definitiva para "${descripcion}" tras varios intentos.`);
    return "Desconocido";
  } catch (err) {
    logConsole(`⚠ Error leyendo estado de "${descripcion}": ${err.message}`);
    if (
      err.message.includes("Target page, context or browser has been closed") &&
      reintento < 2
    ) {
      logConsole(`🔁 Página cerrada, reintentando lectura (${reintento + 1})...`);
      await page.waitForTimeout(2000);
      return esperarEstadoTabla(page, descripcion, reintento + 1);
    }
    return "Desconocido";
  }
}

module.exports = {
  navegarConRetries,
  esperarCompletado,
  esperarEstadoTabla,
};
