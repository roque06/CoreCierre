import { Page } from '@playwright/test';
import { BASE_URL } from './config';

export async function eliminarPrerequisitoSiEsNecesario(
  page: Page,
  codSistema: string,
  codProceso: string
) {
  const filas = page.locator('tbody tr');
  const total = await filas.count();

  let procesoPendiente = false;
  for (let i = 0; i < total; i++) {
    const fila = filas.nth(i);
    const descripcion = (await fila.locator('td').nth(4).innerText()).trim();
    const estado = (await fila.locator('td').nth(9).innerText()).trim();

    if (descripcion.includes('CAMBIO CALENDARIO ACTIVO FIJOS (DYNAMICS)') && estado === 'Pendiente') {
      procesoPendiente = true;
      break;
    }
  }

  if (!procesoPendiente) {
    console.log('El prerequisito ya está completado, no se elimina nada');
    return;
  }

  const editUrl = `${BASE_URL}/ProcesoCierre/Editar?CodSistema=${codSistema}&CodProceso=${codProceso}`;
  console.log(`Revisando prerequisitos en ${editUrl}`);
  await page.goto(editUrl, { waitUntil: 'domcontentloaded' });

  const checkbox = page.locator('input[type="checkbox"][name="Eliminar"]');
  if (await checkbox.isVisible()) {
    await checkbox.check();
    console.log('Prerequisito marcado para eliminación');
  }

  const botonGuardar = page.getByRole('button', { name: /Guardar/i });
  if (await botonGuardar.isVisible()) {
    await botonGuardar.click();
    console.log('Prerequisito eliminado y guardado');
  }
}
