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


async function esperarCompletado(page, descripcion, runId = "GLOBAL", sistema = "F4") {
  let estado = "";
  let intentos = 0;
  const maxIntentos = 200; // seguridad para no quedarse infinito
  const esperaEntreIntentos = 30000; // 30 segundos entre ciclos

  // 🔧 Normalizador de texto (quita tildes, espacios, mayúsculas)
  const normalizar = (txt) =>
    (txt || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();

  while (intentos < maxIntentos) {
    try {
      intentos++;

      // 🔄 Recargar tabla (esperar DOM listo)
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector("#myTable tbody tr", { timeout: 20000 });

      const filas = await page.$$("#myTable tbody tr");
      let filaEncontrada = null;

      // ============================================================
      // 🧩 Buscar la fila correcta
      // ============================================================
      for (const fila of filas) {
        try {
          const codSistema = await fila.$eval("td:nth-child(3)", el =>
            el.innerText.trim().toUpperCase()
          );
          const desc = await fila.$eval("td:nth-child(5)", el =>
            el.innerText.trim().toUpperCase()
          );

          // ✅ Si es F4, comparar sistema y descripción exacta
          if (sistema === "F4") {
            // Evita confundir con Correr Calendario de F2 o MTC
            if (codSistema === "F4" && normalizar(desc) === normalizar(descripcion)) {
              filaEncontrada = fila;
              break;
            }
          } else {
            // 🔹 Para otros sistemas usa coincidencia parcial
            if (normalizar(desc).includes(normalizar(descripcion))) {
              filaEncontrada = fila;
              break;
            }
          }
        } catch { /* ignora errores de fila parcial */ }
      }

      // ⚠️ Si no se encontró la fila → reintenta después de esperar
      if (!filaEncontrada) {
        logConsole(
          `⚠️ No se encontró la fila para "${descripcion}" (${sistema}) — reintentando (${intentos}/${maxIntentos})...`,
          runId
        );
        await page.waitForTimeout(20000);
        continue;
      }

      // ============================================================
      // 📖 Leer el estado actual del proceso
      // ============================================================
      let estadoCelda = "N/A";
      try {
        estadoCelda = await filaEncontrada.$eval("td:nth-child(9)", el =>
          el.innerText.trim().toUpperCase()
        );
      } catch {
        logConsole(`⚠️ No se pudo leer estado de "${descripcion}" (${sistema}) — reintentando...`, runId);
        await page.waitForTimeout(15000);
        continue;
      }

      estado = estadoCelda || "N/A";

      // ============================================================
      // 🏁 Verificar si completó o dio error
      // ============================================================
      if (["COMPLETADO", "ERROR"].includes(estado.toUpperCase())) {
        logConsole(`📌 Estado final de "${descripcion}" (${sistema}): ${estado}`, runId);
        return estado;
      }

      logConsole(
        `⏳ "${descripcion}" (${sistema}) sigue en estado: ${estado} → esperando... (${intentos}/${maxIntentos})`,
        runId
      );

    } catch (err) {
      logConsole(
        `⚠️ Error leyendo estado de "${descripcion}" (${sistema}): ${err.message}`,
        runId
      );
    }

    // 🕒 Esperar antes del siguiente intento
    await page.waitForTimeout(esperaEntreIntentos);
  }

  // 🚨 Si llegó aquí, se agotaron los intentos
  logConsole(
    `🛑 Se alcanzó el máximo de intentos esperando "${descripcion}" (${sistema}) — último estado conocido: ${estado}`,
    runId
  );
  return estado;
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
