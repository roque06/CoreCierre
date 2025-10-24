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
      // 🔁 Rebuscar la fila en cada ciclo (evita referencias muertas tras refresh AJAX)
      const filas = await page.$$("#myTable tbody tr");
      let filaObjetivo = null;

      for (const fila of filas) {
        const textoFila = (await fila.innerText()).toUpperCase();
        if (textoFila.includes(descripcion.toUpperCase())) {
          filaObjetivo = fila;
          break;
        }
      }

      if (!filaObjetivo) {
        logConsole(`⚠️ No se encontró fila para "${descripcion}" (reintentando)...`, runId);
        await page.waitForTimeout(5000);
        continue;
      }

      // 📖 Leer la celda 10 (estado)
      const celdas = await filaObjetivo.$$("td");
      estado = ((await celdas[9].innerText()) || "").trim();

      // ✅ Detectar fin
      if (["Completado", "Error"].includes(estado)) {
        logConsole(`📌 Estado final de "${descripcion}": ${estado}`, runId);
        return estado;
      }

      logConsole(`🔁 "${descripcion}" sigue en estado: ${estado || "N/A"} → esperando...`, runId);

    } catch (err) {
      logConsole(`⚠️ Error leyendo estado de "${descripcion}": ${err.message}`, runId);
    }

    // 🕒 Esperar 30 segundos antes de volver a leer
    await page.waitForTimeout(30000);

    intentos++;
    if (intentos % 60 === 0) {
      const horas = (intentos / 2 / 60).toFixed(1);
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
