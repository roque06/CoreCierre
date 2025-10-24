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
 * 🧠 Espera perpetuamente a que un proceso específico cambie
 * a estado "Completado" o "Error", sin usar timeout fijo.
 * Compatible con llamadas desde procesos.js (usa solo descripcion y runId).
 *
 * @param {import('playwright').Page} page - instancia Playwright
 * @param {string} descripcion - texto visible del proceso en la tabla
 * @param {string} runId - identificador global opcional
 * @returns {Promise<"Completado"|"Error"|"Desconocido">}
 */
/**
 * 🧠 Monitorea perpetuamente un proceso hasta que cambie a "Completado" o "Error".
 * Si hay duplicados (misma descripción con distintas fechas), usa la fila con fecha más reciente.
 */
async function esperarCompletado(page, descripcion, runId = "GLOBAL") {
  if (!descripcion) {
    logConsole(`⚠️ esperarCompletado recibió descripción vacía`, runId);
    return "Desconocido";
  }

  const filasSelector = `#myTable tbody tr:has-text("${descripcion}")`;
  let estadoPrevio = "";
  let iteraciones = 0;
  const inicio = Date.now();

  logConsole(`🕒 Iniciando monitoreo perpetuo para "${descripcion}"...`, runId);

  while (true) {
    try {
      await page.waitForSelector("#myTable tbody tr", { timeout: 60000 });

      // Buscar todas las filas que coincidan con la descripción
      const filas = page.locator(filasSelector);
      const totalFilas = await filas.count();

      if (totalFilas === 0) {
        logConsole(`⚠️ Fila de "${descripcion}" no encontrada — posible recarga o cambio de DOM.`, runId);
        await page.waitForTimeout(10000);
        continue;
      }

      // Si hay duplicadas, usar la fila con la FECHA más reciente
      let fila = totalFilas > 1 ? await seleccionarFilaMasReciente(page, filas) : filas.first();

      // Leer estado visual actual
      const celdaEstado = fila.locator("td:nth-child(10)").first();
      const estadoDom = ((await celdaEstado.textContent()) || "")
        .trim()
        .toUpperCase();

      // Registrar cambio
      if (estadoDom !== estadoPrevio) {
        logConsole(`📊 "${descripcion}" cambió estado: ${estadoPrevio || "N/A"} → ${estadoDom}`, runId);
        estadoPrevio = estadoDom;
      }

      // Detectar estados finales
      if (["COMPLETADO", "ERROR"].includes(estadoDom)) {
        logConsole(`📌 Estado final de "${descripcion}": ${estadoDom}`, runId);
        return estadoDom;
      }

      // Log periódico cada 10 minutos
      iteraciones++;
      if (iteraciones % 20 === 0) {
        const mins = ((Date.now() - inicio) / 60000).toFixed(1);
        logConsole(`⏳ "${descripcion}" sigue en ${estadoDom || "N/A"} tras ${mins} min...`, runId);
      }

    } catch (err) {
      logConsole(`⚠️ Error monitoreando "${descripcion}": ${err.message}`, runId);

      try {
        const baseUrl = page.url().split("/ProcesoCierre")[0] || "";
        await navegarConRetries(page, `${baseUrl}/ProcesoCierre/Procesar`);
        logConsole(`🔁 Tabla recargada durante monitoreo de "${descripcion}".`, runId);
      } catch (recErr) {
        logConsole(`⚠️ Falló recarga durante monitoreo: ${recErr.message}`, runId);
      }
    }

    await page.waitForTimeout(30000);
  }
}

/**
 * 🔍 Selecciona la fila más reciente (mayor fecha en columna 7)
 */
/**
 * 🔍 Selecciona la fila más reciente (mayor fecha en columna 7)
 * y genera logs legibles sin HTML basura.
 */
async function seleccionarFilaMasReciente(page, filas, runId = "GLOBAL") {
  let filaMasReciente = filas.first();
  let fechaMax = new Date(0);

  const total = await filas.count();
  for (let i = 0; i < total; i++) {
    const filaTmp = filas.nth(i);
    const fechaTxt = (await filaTmp.locator("td:nth-child(7)").textContent())?.trim() || "";
    const [d, m, y] = fechaTxt.split("/").map(Number);
    if (!d || !m || !y) continue;
    const fechaObj = new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00`);
    if (fechaObj > fechaMax) {
      fechaMax = fechaObj;
      filaMasReciente = filaTmp;
    }
  }

  const descripcionTxt = (await filaMasReciente.locator("td:nth-child(5)").textContent())?.trim() || "N/D";
  const fechaTxt = fechaMax.toLocaleDateString("es-ES");
  logConsole(`⚙️ Duplicadas detectadas → usando "${descripcionTxt}" con fecha más reciente ${fechaTxt}`, runId);

  return filaMasReciente;
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
