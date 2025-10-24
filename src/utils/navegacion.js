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
      // 🔎 Buscar la fila de nuevo cada vez (evita referencias muertas del DOM)
      const filas = page.locator("#myTable tbody tr");
      const total = await filas.count();

      let filaEncontrada = null;
      for (let i = 0; i < total; i++) {
        const texto = (await filas.nth(i).innerText()).toUpperCase();
        if (texto.includes(descripcion.toUpperCase())) {
          filaEncontrada = filas.nth(i);
          break;
        }
      }

      if (!filaEncontrada) {
        logConsole(`⚠️ No se encontró la fila para "${descripcion}" (reintentando)...`, runId);
        await page.waitForTimeout(5000);
        continue;
      }

      // 📖 Leer estado directamente desde la celda 10 (índice 9)
      const estadoCell = filaEncontrada.locator("td").nth(9);
      estado = ((await estadoCell.textContent()) || "").trim();

      // ✅ Estado final detectado
      if (["Completado", "Error"].includes(estado)) {
        logConsole(`📌 Estado final de "${descripcion}": ${estado}`, runId);
        return estado;
      }

      logConsole(`🔁 "${descripcion}" sigue en estado: ${estado || "N/A"} → esperando...`, runId);

      // Espera entre chequeos
      await page.waitForTimeout(60000); // 1 minuto entre lecturas

      intentos++;
      // Cada 60 intentos (1 hora), log informativo sin forzar salida
      if (intentos % 60 === 0) {
        const horas = (intentos / 60).toFixed(1);
        logConsole(`⏳ "${descripcion}" lleva ~${horas} h esperando → sigue en ${estado}`, runId);
      }

    } catch (err) {
      logConsole(`⚠️ Error leyendo estado de "${descripcion}": ${err.message}`, runId);
      await page.waitForTimeout(10000);
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
