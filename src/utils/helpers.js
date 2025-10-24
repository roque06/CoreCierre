// src/utils/helpers.js

// Navegación con reintentos
async function navegarConRetries(page, url, retries = 3) {
  for (let i = 1; i <= retries; i++) {
    try {
      console.log(`Intentando navegar a ${url} (intento ${i})`);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return;
    } catch (err) {
      console.error(`Error al cargar ${url} en intento ${i}: ${err.message}`);
      if (i === retries) throw err;
    }
  }
}

// Espera hasta que el proceso cambie de estado
async function esperarCompletado(page, fila) {
  while (true) {
    const estado = (await fila.locator("td").nth(9).innerText()).trim();
    if (["Completado", "Error"].includes(estado)) break;
    await page.waitForTimeout(2000); // espera 2s antes de reintentar
  }
}

function normalizarTexto(texto) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

module.exports = {
  navegarConRetries,
  esperarCompletado,
  normalizarTexto,
};
