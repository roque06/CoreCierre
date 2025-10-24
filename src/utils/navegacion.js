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

/**
 * 🧠 Espera perpetuamente a que un proceso específico (F4, F5, etc.)
 * cambie a estado "Completado" o "Error", sin usar timeout fijo.
 * Mantiene sincronía con el DOM y reintenta si se pierde contexto.
 *
 * @param {import('playwright').Page} page - instancia de Playwright
 * @param {string} codSistema - código de sistema (ej. "F4")
 * @param {number|string} codProceso - identificador del proceso
 * @param {string} descripcion - descripción legible del proceso
 * @param {string} claveProc - clave combinada (F4-XX)
 * @param {string} runId - identificador de ejecución global
 * @returns {Promise<"Completado"|"Error"|"Desconocido">}
 */
async function esperarHastaCompletado(page, codSistema, codProceso, descripcion, claveProc, runId = "GLOBAL") {
  const filaSelector = `#myTable tbody tr:has-text("${descripcion}")`;
  let estadoPrevio = "";
  let iteraciones = 0;
  const inicio = Date.now();

  logConsole(`🕒 Iniciando monitoreo perpetuo para "${descripcion}" (${codSistema}-${codProceso})...`, runId);

  while (true) {
    try {
      // Verificar tabla visible
      await page.waitForSelector("#myTable tbody tr", { timeout: 60000 });

      // Reubicar fila en cada ciclo
      const fila = page.locator(filaSelector);
      const existe = await fila.count();
      if (existe === 0) {
        logConsole(`⚠️ Fila de "${descripcion}" no encontrada — posible recarga automática o cambio de DOM.`, runId);
        await page.waitForTimeout(10000);
        continue;
      }

      // Leer estado visual actual
      const estadoDom = ((await fila.locator("td:nth-child(10)").textContent()) || "")
        .trim()
        .toUpperCase();

      // Registrar cambio de estado
      if (estadoDom !== estadoPrevio) {
        logConsole(`📊 "${descripcion}" cambió estado: ${estadoPrevio || "N/A"} → ${estadoDom}`, runId);
        estadoPrevio = estadoDom;
      }

      // Detectar estados finales
      if (["COMPLETADO", "ERROR"].includes(estadoDom)) {
        logConsole(`📌 Estado final de "${descripcion}": ${estadoDom}`, runId);
        return estadoDom;
      }

      // Cada 10 minutos logea un mensaje de “sigue en proceso”
      iteraciones++;
      if (iteraciones % 20 === 0) { // (20 ciclos * 30 seg ≈ 10 min)
        const mins = ((Date.now() - inicio) / 60000).toFixed(1);
        logConsole(`⏳ "${descripcion}" sigue en estado ${estadoDom || "N/A"} tras ${mins} min...`, runId);
      }

    } catch (err) {
      logConsole(`⚠️ Error monitoreando "${descripcion}": ${err.message}`, runId);

      // 🔄 Intentar recargar solo si el contexto se perdió
      try {
        const baseUrl = page.url().split("/ProcesoCierre")[0] || "";
        await navegarConRetries(page, `${baseUrl}/ProcesoCierre/Procesar`);
        logConsole(`🔁 Tabla recargada durante monitoreo de "${descripcion}".`, runId);
      } catch (recErr) {
        logConsole(`⚠️ Falló recarga durante monitoreo: ${recErr.message}`, runId);
      }
    }

    // Espera antes de nuevo ciclo
    await page.waitForTimeout(30000);
  }
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
