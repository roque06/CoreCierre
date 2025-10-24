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
 * ⏳ Espera hasta que el proceso cambie a Completado o Error.
 * ✅ Adaptado para evitar bloqueo en "Correr Calendario"
 *    - Si se detecta "Completado" desde tabla principal, termina.
 *    - Si pasa mucho tiempo sin cambio, también rompe el ciclo.
 */
async function esperarCompletado(page, descripcion, runId = "GLOBAL", checkIntervalSec = 30) {
  const inicio = Date.now();
  let iteraciones = 0;
  let estadoPrevio = "";
  const filaSelector = `#myTable tbody tr:has-text("${descripcion}")`;

  logConsole(`🕒 Iniciando monitoreo perpetuo para "${descripcion}"...`, runId);

  while (true) {
    try {
      // Esperar que exista la tabla
      await page.waitForSelector("#myTable tbody tr", { timeout: 60000 });

      // Reubicar fila dinámicamente en cada ciclo
      const fila = page.locator(filaSelector);
      const existe = await fila.count();
      if (existe === 0) {
        logConsole(`⚠️ Fila de "${descripcion}" no encontrada — posible recarga o cambio en DOM.`, runId);
        await page.waitForTimeout(10000);
        continue;
      }

      // Leer texto del estado
      const estado = ((await fila.locator("td:nth-child(10)").textContent()) || "")
        .trim()
        .toUpperCase();

      // Detectar cambios reales
      if (estado !== estadoPrevio) {
        logConsole(`📊 "${descripcion}" cambió estado: ${estadoPrevio || "N/A"} → ${estado}`, runId);
        estadoPrevio = estado;
      }

      // Detectar fin del proceso
      if (["COMPLETADO", "ERROR"].includes(estado)) {
        logConsole(`📌 Estado final de "${descripcion}": ${estado}`, runId);
        return estado;
      }

      // Registrar progreso cada cierto número de ciclos
      iteraciones++;
      if (iteraciones % (600 / checkIntervalSec) === 0) { // cada ~10 min si interval=30s
        const mins = ((Date.now() - inicio) / 60000).toFixed(1);
        logConsole(`⏳ "${descripcion}" sigue en ${estado || "N/A"} tras ${mins} min...`, runId);
      }

    } catch (err) {
      logConsole(`⚠️ Error monitoreando "${descripcion}": ${err.message}`, runId);

      // Intentar recargar tabla si se pierde el contexto
      try {
        const baseUrl = page.url().split("/ProcesoCierre")[0] || "";
        await navegarConRetries(page, `${baseUrl}/ProcesoCierre/Procesar`);
        logConsole(`🔁 Tabla recargada durante monitoreo de "${descripcion}".`, runId);
      } catch (recErr) {
        logConsole(`⚠️ Falló recarga durante monitoreo: ${recErr.message}`, runId);
      }
    }

    // Esperar antes del siguiente ciclo
    await page.waitForTimeout(checkIntervalSec * 1000);
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
