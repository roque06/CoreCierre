// @ts-nocheck
const { chromium } = require("@playwright/test");

async function navegarConRetries(page, url, maxRetries = 3) {
  for (let intento = 1; intento <= maxRetries; intento++) {
    try {
      console.log(`🌐 Intentando navegar a ${url} (intento ${intento})`);
      await page.goto(url, {
        timeout: 60000,
        waitUntil: "domcontentloaded",
      });
      console.log(`✅ Navegación exitosa a ${url}`);
      return;
    } catch (error) {
      console.log(`❌ Error al cargar ${url} en intento ${intento}: ${error.message}`);
      if (intento === maxRetries) throw error;
      await new Promise((r) => setTimeout(r, 3000)); // espera 3 seg entre intentos
    }
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ["--ignore-certificate-errors"], // ⚡ evita bloqueo SSL interno
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  console.log("🌐 Abriendo portal de cierre con reintentos...");
  await navegarConRetries(page, "https://172.27.4.13:3001/", 2);

  console.log("🧑‍💻 Inicia sesión manualmente en el navegador...");
  console.log("➡️  No cierres la ventana; la sesión se guardará cuando llegues al menú principal.");

  // Esperar hasta que detecte que ya entraste al menú o página principal
  await page.waitForURL(/\/(Inicio|Home|ProcesoCierre)/, { timeout: 0 });

  // Guardar la sesión en archivo
  await context.storageState({ path: "tests/session.json" });
  console.log("✅ Sesión guardada en tests/session.json");

  await browser.close();
})();
