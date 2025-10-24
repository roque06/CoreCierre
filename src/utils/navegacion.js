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
async function esperarCompletado(page, descripcion, runId = "GLOBAL", timeoutMin = 10) {
  const filaSelector = `tbody tr:has-text("${descripcion}")`;
  let estado = "";
  const inicio = Date.now();

  while (true) {
    try {
      // 🔁 Refresca la página para forzar sincronización visual con el backend
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector("#myTable tbody tr", { timeout: 15000 });

      // 🔹 Leer estado de la celda visible
      const fila = page.locator(filaSelector);
      const estadoCell = fila.locator("td").nth(9);
      estado = ((await estadoCell.textContent()) || "").trim();

      // 🔹 Lectura secundaria desde tabla (por si DOM cambió)
      const estadoTabla = await page.evaluate((desc) => {
        const filas = document.querySelectorAll("tbody tr");
        for (const tr of filas) {
          const cols = tr.querySelectorAll("td");
          if (cols.length < 10) continue;
          const texto = cols[4].innerText.trim().toUpperCase();
          if (texto.includes(desc.toUpperCase())) {
            return cols[9].innerText.trim();
          }
        }
        return "";
      }, descripcion);

      const estadoFinal = estadoTabla || estado;

      // 🔹 Detecta completado o error
      if (["Completado", "Error"].includes(estadoFinal)) {
        logConsole(`📌 Estado final de "${descripcion}": ${estadoFinal}`, runId);
        return estadoFinal;
      }

      // 🔹 Timeout de seguridad (por ejemplo 10 min)
      const elapsedMin = (Date.now() - inicio) / 60000;
      if (elapsedMin >= timeoutMin) {
        logConsole(`⚠️ "${descripcion}" sin cambio tras ${timeoutMin} min — forzando continuación.`, runId);
        return estadoFinal || "Desconocido";
      }

      logConsole(`⏳ "${descripcion}" sigue en estado: ${estadoFinal || "N/A"} → esperando...`, runId);
    } catch (err) {
      logConsole(`⚠️ Error leyendo estado de "${descripcion}": ${err.message}`, runId);
    }

    // 🕒 Esperar 30 segundos antes de volver a intentar
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
