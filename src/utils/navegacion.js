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
 */
async function esperarCompletado(page, descripcion, runId = "GLOBAL") {
  logConsole(`⏳ Esperando que "${descripcion}" cambie a Completado o Error...`, runId);

  let estado = "";
  let intentos = 0;

  while (true) {
    try {
      // 🔍 Buscar la fila que contenga el texto del proceso
      const filaLocator = page.locator(`#myTable tbody tr:has-text("${descripcion}")`);

      // Esperar que la fila aparezca (por si hay render diferido)
      await filaLocator.first().waitFor({ timeout: 10000 });

      // 📖 Leer el texto del estado directamente (celda 10)
      const estadoLocator = filaLocator.locator("td").nth(9);
      estado = ((await estadoLocator.innerText()) || "").trim();

      // ✅ Si terminó, salir del bucle
      if (["Completado", "Error"].includes(estado)) {
        logConsole(`📌 Estado final de "${descripcion}": ${estado}`, runId);
        return estado;
      }

      // 🔁 Log informativo mientras está en proceso o pendiente
      logConsole(`🔁 "${descripcion}" sigue en estado: ${estado || "N/A"} → esperando...`, runId);

    } catch (err) {
      // 🔄 Si se pierde el contexto DOM (refresh AJAX detectado)
      if (
        err.message.includes("Cannot find context") ||
        err.message.includes("Execution context was destroyed")
      ) {
        logConsole(`⚠️ Contexto DOM perdido durante monitoreo de "${descripcion}" — refrescando referencia...`, runId);
      } else {
        logConsole(`⚠️ Error leyendo estado de "${descripcion}": ${err.message}`, runId);
      }
    }

    // 🕒 Esperar antes de volver a chequear
    await page.waitForTimeout(20000);

    intentos++;
    if (intentos % 60 === 0) {
      const horas = ((intentos * 20) / 3600).toFixed(1);
      logConsole(`⏳ "${descripcion}" lleva ${horas}h esperando — sigue en ${estado}`, runId);
    }
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
