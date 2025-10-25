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
async function esperarCompletado(page, descripcion, runId = "GLOBAL", sistema = "F4", connectString = "", baseDatos = "") {
  let estado = "";
  const esperaEntreIntentos = 60000; // 1 minuto entre revisiones
  let intentosFallidosDOM = 0;

  const normalizar = (txt) =>
    (txt || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();

  while (true) {
    try {
      // 🔄 Recargar tabla solo si el sistema no es F4 (para no interferir con jobs sensibles)
      if (sistema !== "F4") {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      }

      await page.waitForSelector("#myTable tbody tr", { timeout: 20000 });
      const filas = await page.$$("#myTable tbody tr");
      let filaEncontrada = null;

      for (const fila of filas) {
        try {
          const codSistema = await fila.$eval("td:nth-child(3)", el => el.innerText.trim().toUpperCase());
          const desc = await fila.$eval("td:nth-child(5)", el => el.innerText.trim().toUpperCase());

          if (sistema === "F4") {
            if (codSistema === "F4" && normalizar(desc) === normalizar(descripcion)) {
              filaEncontrada = fila;
              break;
            }
          } else if (normalizar(desc).includes(normalizar(descripcion))) {
            filaEncontrada = fila;
            break;
          }
        } catch { }
      }

      if (!filaEncontrada) {
        intentosFallidosDOM++;
        if (intentosFallidosDOM > 10) {
          logConsole(`⚠️ No se encontró la fila para "${descripcion}" (${sistema}) tras varios intentos — se abandona espera.`, runId);
          return "IGNORADO";
        }
        await page.waitForTimeout(esperaEntreIntentos);
        continue;
      }

      intentosFallidosDOM = 0;

      // 📖 Leer el estado actual del proceso
      let estadoCelda = "";
      try {
        estadoCelda = await filaEncontrada.$eval("td:nth-child(10)", el => el.innerText.trim().toUpperCase());
      } catch {
        await page.waitForTimeout(esperaEntreIntentos);
        continue;
      }

      estado = estadoCelda || "N/A";

      // ✅ Interpretar formato de fecha/hora como COMPLETADO
      if (/^\d{1,2}\/\d{1,2}\/\d{4}\.\d{1,2}:\d{2}(AM|PM)$/i.test(estado)) {
        logConsole(`📅 "${descripcion}" finalizó correctamente (timestamp detectado).`, runId);
        return "COMPLETADO";
      }

      // 🏁 Estados finales
      if (["COMPLETADO", "ERROR"].includes(estado)) {
        logConsole(`📌 "${descripcion}" (${sistema}) finalizó con estado: ${estado}`, runId);
        return estado;
      }

      // 🔄 Si sigue en proceso, esperar sin mostrar spam
      await page.waitForTimeout(esperaEntreIntentos);
    } catch (err) {
      if (err.message?.includes("ERR_ABORTED") || err.message?.includes("Execution context")) {
        logConsole(`⚠️ Error de DOM o recarga en "${descripcion}" — reintentando...`, runId);
        await page.waitForTimeout(10000);
        continue;
      }

      logConsole(`⚠️ Error leyendo estado de "${descripcion}": ${err.message}`, runId);
      await page.waitForTimeout(esperaEntreIntentos);
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
