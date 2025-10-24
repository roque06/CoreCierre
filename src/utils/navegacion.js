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
  const filaSelector = `tbody tr:has-text("${descripcion}")`;
  let estado = "";
  let intentos = 0;

  while (true) {
    try {
      // 🔄 Refrescar tabla en cada ciclo para obtener estado real del backend
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector("#myTable tbody tr", { timeout: 15000 });

      const fila = page.locator(filaSelector);
      const estadoCell = fila.locator("td").nth(9);
      estado = ((await estadoCell.textContent()) || "").trim();

      if (["Completado", "Error"].includes(estado)) {
        logConsole(`📌 Estado final de "${descripcion}": ${estado}`, runId);
        return estado;
      }

      logConsole(`⏳ "${descripcion}" sigue en estado: ${estado || "N/A"} → esperando...`, runId);

      // 🔁 Intentos acumulados
      intentos++;

      // ⚠ Si lleva más de 6 ciclos (~3 minutos) sin cambiar, forzar recarga manual adicional
      if (intentos % 6 === 0) {
        logConsole(`🔄 "${descripcion}" sigue sin cambio tras ${(intentos * 30) / 60} min → reintentando con recarga completa...`, runId);
        const baseUrl = page.url().split("/ProcesoCierre")[0];
        try {
          await navegarConRetries(page, `${baseUrl}/ProcesoCierre/Procesar`);
          await page.waitForTimeout(2000);
          const nuevoEstado = await page.evaluate((desc) => {
            const filas = [...document.querySelectorAll("#myTable tbody tr")];
            const fila = filas.find(f => f.innerText.includes(desc));
            return fila ? fila.querySelectorAll("td")[9].innerText.trim() : "Desconocido";
          }, descripcion);
          if (["Completado", "Error"].includes(nuevoEstado)) {
            logConsole(`📌 "${descripcion}" cambió a ${nuevoEstado} tras recarga.`, runId);
            return nuevoEstado;
          }
        } catch (recErr) {
          logConsole(`⚠️ Error durante recarga de ${descripcion}: ${recErr.message}`, runId);
        }
      }

      // 🛑 Si después de 40 ciclos (~20 min) sigue igual, romper bucle
      if (intentos >= 40) {
        logConsole(`🛑 "${descripcion}" sigue en estado ${estado || "N/A"} tras 20 minutos → forzando salida de espera.`, runId);
        return estado;
      }

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
