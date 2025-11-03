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
  const inicio = Date.now(); // 🕒 Para medir duración total
  let estado = "";

  while (true) {
    try {
      // 🔄 Refrescar la tabla para obtener estado real del backend
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector("#myTable tbody tr", { timeout: 20000 });

      const fila = page.locator(filaSelector);
      if (!(await fila.count())) {
        logConsole(`⚠️ No se encontró la fila para "${descripcion}" tras recarga. Reintentando...`, runId);
        await page.waitForTimeout(5000);
        continue;
      }

      const estadoCell = fila.locator("td").nth(9);
      estado = ((await estadoCell.textContent()) || "").trim();

      // 🧩 Estado final detectado
      if (["Completado", "Error"].includes(estado)) {
        const duracion = ((Date.now() - inicio) / 60000).toFixed(2);
        logConsole(`📌 Estado final de "${descripcion}": ${estado} (${duracion} min)`, runId);
        return estado;
      }

      // ⏳ Estado intermedio
      const transcurrido = ((Date.now() - inicio) / 60000).toFixed(1);
      logConsole(`⏳ "${descripcion}" sigue en estado: ${estado || "N/A"} — ${transcurrido} min transcurridos...`, runId);
    } catch (err) {
      logConsole(`⚠️ Error leyendo estado de "${descripcion}": ${err.message}`, runId);
    }

    // 🕒 Esperar 30 s antes de volver a revisar
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

      if (descCelda.trim() === descNormal.trim()) {
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
async function leerEstadoExacto(page, codSistema, descripcion) {
  const filas = await page.$$("#myTable tbody tr");
  for (const fila of filas) {
    try {
      const sis = (await fila.$eval("td:nth-child(3)", el => el.innerText.trim().toUpperCase())) || "";
      const desc = (await fila.$eval("td:nth-child(5)", el => el.innerText.trim().toUpperCase())) || "";
      if (sis === codSistema.toUpperCase() && desc === descripcion.trim().toUpperCase()) {
        const estado = (await fila.$eval("td:nth-child(10)", el => el.innerText.trim().toUpperCase())) || "";
        return estado;
      }
    } catch { }
  }
  return "DESCONOCIDO";
}


module.exports = {
  navegarConRetries,
  esperarCompletado,
  esperarEstadoTabla,
};
