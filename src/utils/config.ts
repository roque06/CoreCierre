
export const BASE_URL =
  process.env.AMBIENTE ||
  process.env.APP_URL ||
  "https://172.27.4.13:3001";


export const ejecutarSistemas: Record<string, boolean> = {
  PRE: false, 
  F2: true,
  MTC: false,
  F3: false,
  MON: false,
  F4: true,
  F5: true,
  FIN: false,
};
// 🧩 Configuración opcional de reintentos y tiempos de espera
export const configTiempo = {
  maxIntentosNavegacion: 3, 
  tiempoEntreReintentos: 4000, 
  timeoutProcesarDirecto: 30000,
  timeoutIniciar: 20000, 
};

// 🗃️ Configuración opcional de Oracle (si se requiere conexión directa)
export const oracleConfig = {
  usuario: "system",
  password: "system",
  clientePath: "C:\\instantclient_21_13", // Ajusta según tu servidor
};

// 📜 Utilidad rápida de log (puede omitirse si ya usas logger.js)
export function logConfig() {
  console.log("⚙️ Configuración cargada:");
  console.log(`🌐 BASE_URL: ${BASE_URL}`);
  console.log(`🧩 Ejecutar sistemas:`, ejecutarSistemas);
}
