// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    ignoreHTTPSErrors: true,
  },
});

import { test, expect } from '@playwright/test';

test('Cierre', async ({ context }) => {
  let page = await context.newPage();
  await context.clearCookies();
  await context.clearPermissions();

  try {
    await page.goto('https://172.27.4.13:3001/', {
      waitUntil: 'domcontentloaded',
      timeout: 90_000,
    });
    console.log('Página cargada al primer intento');
  } catch (e) {
    console.log('Primer intento falló, reintentando con nueva página...');
    await page.close();
    page = await context.newPage();
    await page.goto('https://172.27.4.13:3001/', {
      waitUntil: 'domcontentloaded',
      timeout: 90_000,
    });
    console.log('Página cargada al segundo intento');
  }
await page.setViewportSize({ width: 1920, height: 1080 });
await page.locator('//*[@id="NombreUsuario"]').fill('radames' );
await page.locator('//*[@id="Password"]').fill('santa' );
await page.press('//*[@id="Password"]', 'Enter' );
await page.goto('https://172.27.4.13:3001/ProcesoCierre');

await page.pause();





});







// --- Mapa de procesos con sus XPaths ---
const procesosXPath: Record<string, string> = {
  //SISTEMA PRE
  "PROCESO RECLASIFICACION DE CHEQUES EN PESOS": '//*[@id="myTable"]/tbody/tr[1]/td[12]/a',
  "CIERRE PROCESO CIERRE DYNAMICS (ACTIVOS FIJOS)": '//*[@id="myTable"]/tbody/tr[2]/td[12]/a',
  "CAMBIO CALENDARIO LEASING": '//*[@id="myTable"]/tbody/tr[3]/td[12]/a',
  "PROCESO CAMBIO CALENDARIO FACTORING": '//*[@id="myTable"]/tbody/tr[4]/td[12]/a',
  "CAMBIO CALENDARIO ACTIVO FIJOS (DYNAMICS)": '//*[@id="myTable"]/tbody/tr[5]/td[12]/a',

  //SISTEMA F2
  "PROCESO LIQUIDACION PAGATODO": '//*[@id="myTable"]/tbody/tr[6]/td[12]/a',
  "RECTIFICACION PROCESOS": '//*[@id="myTable"]/tbody/tr[7]/td[12]/a',
  "LIQUIDACION PAGOS SERVICIOS": '//*[@id="myTable"]/tbody/tr[8]/td[12]/a',
  "PROCESO LIQUIDACION SUBAGENTES BANCARIOS (SAB)": '//*[@id="myTable"]/tbody/tr[9]/td[12]/a',
  "CIERRE DIARIO CUENTAS POR LIQUIDAR": '//*[@id="myTable"]/tbody/tr[10]/td[12]/a',
  "CIERRE DIARIO DE CERTIFICADOS": '//*[@id="myTable"]/tbody/tr[11]/td[12]/a',
  "CIERRE DIARIO DE BANCOS": '//*[@id="myTable"]/tbody/tr[12]/td[12]/a',
  "CORRER CALENDARIO DE BANCOS": '//*[@id="myTable"]/tbody/tr[13]/td[12]/a',
  "CIERRE DIARIO PRESTAMOS": '//*[@id="myTable"]/tbody/tr[14]/td[12]/a',
  "LIQUIDACION INTERESES REAL DE PRESTAMOS": '//*[@id="myTable"]/tbody/tr[15]/td[12]/a',
  "CLASIFICACION DE SALDOS DE PRESTAMOS": '//*[@id="myTable"]/tbody/tr[16]/td[12]/a',
};