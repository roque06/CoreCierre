// @ts-nocheck
const procesosXPathV = {
  // /// SISTEMA PRE
  "PROCESO RECLASIFICACION DE CHEQUES EN PESOS": '//*[@id="myTable"]/tbody/tr[1]/td[12]/a',
  "PROCESO CIERRE DYNAMICS (ACTIVOS FIJOS)": '//*[@id="myTable"]/tbody/tr[2]/td[12]/a',
  "CAMBIO CALENDARIO LEASING": '//*[@id="myTable"]/tbody/tr[3]/td[12]/a',
  "CAMBIO CALENDARIO FACTORING": '//*[@id="myTable"]/tbody/tr[4]/td[12]/a',
  "CAMBIO CALENDARIO ACTIVO FIJOS (DYNAMICS)": '//*[@id="myTable"]/tbody/tr[5]/td[12]/a',
  "PASAR MOVIMIENTOS MENSUALES A HISTORICOS": '//*[@id="myTable"]/tbody/tr[6]/td[12]/a',

  // /// SISTEMA F2
  "PROCESO LIQUIDACION PAGATODO": '//*[@id="myTable"]/tbody/tr[7]/td[12]/a',
  "RECTIFICACION PROCESOS": '//*[@id="myTable"]/tbody/tr[8]/td[12]/a',
  "LIQUIDACION PAGOS SERVICIOS": '//*[@id="myTable"]/tbody/tr[9]/td[12]/a',
  "PROCESO LIQUIDACION SUBAGENTES BANCARIOS (SAB)": '//*[@id="myTable"]/tbody/tr[10]/td[12]/a',
  "CIERRE DIARIO CUENTAS POR LIQUIDAR": '//*[@id="myTable"]/tbody/tr[11]/td[12]/a',
  "CIERRE DIARIO DE CERTIFICADOS": '//*[@id="myTable"]/tbody/tr[12]/td[12]/a',
  "CIERRE DIARIO DE BANCOS": '//*[@id="myTable"]/tbody/tr[13]/td[12]/a',
  "CORRER CALENDARIO DE BANCOS": '//*[@id="myTable"]/tbody/tr[14]/td[12]/a',
  "CIERRE DIARIO PRESTAMOS": '//*[@id="myTable"]/tbody/tr[15]/td[12]/a',
  "LIQUIDACION INTERESES REAL DE PRESTAMOS": '//*[@id="myTable"]/tbody/tr[16]/td[12]/a',
  "CLASIFICACION DE SALDOS DE PRESTAMOS": '//*[@id="myTable"]/tbody/tr[17]/td[12]/a',

  // /// SISTEMA MTC
  "VALIDACION CARGA ITC": '//*[@id="myTable"]/tbody/tr[18]/td[12]/a',
  "CARGA MAESTRO TARJETA DE CREDITO ITC": '//*[@id="myTable"]/tbody/tr[19]/td[12]/a',
  "CARGA TRANSACCIONES DIARIAS ITC": '//*[@id="myTable"]/tbody/tr[20]/td[12]/a',
  "CARGA DETALLES TRANSACCIONES ITC": '//*[@id="myTable"]/tbody/tr[21]/td[12]/a',
  "CORRER CALENDARIO TC": '//*[@id="myTable"]/tbody/tr[22]/td[12]/a',
  "APLICAR CARGOS TC": '//*[@id="myTable"]/tbody/tr[23]/td[12]/a',
  "CARGA ASIENTOS INTERFACES ITC": '//*[@id="myTable"]/tbody/tr[24]/td[12]/a',
  "CARGA LINEA DIFERIDA ITC": '//*[@id="myTable"]/tbody/tr[25]/td[12]/a',
  "LIQUIDA INTERESES MULTICREDITO": '//*[@id="myTable"]/tbody/tr[26]/td[12]/a',

  // /// SISTEMA F3
  "PROVISION DE INTERESES PRESTAMOS": '//*[@id="myTable"]/tbody/tr[27]/td[12]/a',
  "CAMBIO CALENDARIO PRESTAMOS": '//*[@id="myTable"]/tbody/tr[28]/td[12]/a',
  "GENERAR ASIENTO CONTINGENCIA PROV TC": '//*[@id="myTable"]/tbody/tr[29]/td[12]/a',
  "CAMBIO CALENDARIO CUSTODIA DE VALORES": '//*[@id="myTable"]/tbody/tr[30]/td[12]/a',

  // /// SISTEMA MON
  "ACTIVACION MONO-USUARIO": '//*[@id="myTable"]/tbody/tr[31]/td[12]/a',

  // /// SISTEMA F4
  "LIBERACION DE EMBARGOS, CONGELAMIENTOS Y CONSULTAS": '//*[@id="myTable"]/tbody/tr[32]/td[12]/a',
  "APLICACION DE DEPOSITOS EN LOTE": '//*[@id="myTable"]/tbody/tr[33]/td[12]/a',
  "APLICACION DE CARGOS FIJOS": '//*[@id="myTable"]/tbody/tr[34]/td[12]/a',
  "APLICACION DE TRANSFERENCIAS AUTOMATICAS": '//*[@id="myTable"]/tbody/tr[35]/td[12]/a',

  "APLICACION DEL 1.5 POR 1000 (LEY 288-04)": [
    '//*[@id="myTable"]/tbody/tr[36]/td[12]/a',
    '//*[@id="myTable"]/tbody/tr[46]/td[12]/a',
  ],
  "RENOVACION DE TARJETAS": [
    '//*[@id="myTable"]/tbody/tr[37]/td[12]/a',
    '//*[@id="myTable"]/tbody/tr[47]/td[12]/a',
  ],
  "CIERRE DIARIO CUENTA EFECTIVO": [
    '//*[@id="myTable"]/tbody/tr[38]/td[12]/a',
    '//*[@id="myTable"]/tbody/tr[48]/td[12]/a',
  ],
  "GENERAR ASIENTO CONTABLE": [
    '//*[@id="myTable"]/tbody/tr[40]/td[12]/a',
    '//*[@id="myTable"]/tbody/tr[49]/td[12]/a',
  ],
  "GENERAR ASIENTO CLASIFICACION": [
    '//*[@id="myTable"]/tbody/tr[41]/td[12]/a',
    '//*[@id="myTable"]/tbody/tr[50]/td[12]/a',
  ],
  "GENERACION SALDOS CONTABILIZADOS": [
    '//*[@id="myTable"]/tbody/tr[43]/td[12]/a',
    '//*[@id="myTable"]/tbody/tr[54]/td[12]/a',
  ],
  "PASAR MOVIMIENTOS DIARIOS A MENSUALES": [
    '//*[@id="myTable"]/tbody/tr[44]/td[12]/a',
    '//*[@id="myTable"]/tbody/tr[52]/td[12]/a',
  ],

  "CIERRE MENSUAL": '//*[@id="myTable"]/tbody/tr[39]/td[12]/a',
  "ASIENTO CONTINGENCIA Y PROVISION SOBREGIRO PACTADO": '//*[@id="myTable"]/tbody/tr[42]/td[12]/a',
  "PASAR MOVIMIENTOS MENSUALES A HISTORICOS": '//*[@id="myTable"]/tbody/tr[45]/td[12]/a',
  "GENERAR ESTADISTICAS": '//*[@id="myTable"]/tbody/tr[51]/td[12]/a',
  "CORRER CALENDARIO": '//*[@id="myTable"]/tbody/tr[53]/td[12]/a',

  // /// SISTEMA F5
  "CIERRE DIARIO DIVISAS": '//*[@id="myTable"]/tbody/tr[55]/td[12]/a',
  "GENERAR ASIENTOS PESO IMPUESTOS MONEDA EXTRANJERA": '//*[@id="myTable"]/tbody/tr[56]/td[12]/a',
  "CIERRE DIARIO CAJA (ATM)": '//*[@id="myTable"]/tbody/tr[57]/td[12]/a',
  "ACTUALIZAR SALDOS CONTABILIDAD": '//*[@id="myTable"]/tbody/tr[58]/td[12]/a',
  "CIERRE DIARIO CONTABILIDAD": '//*[@id="myTable"]/tbody/tr[59]/td[12]/a',
  "CIERRE MENSUAL CONTABILIDAD": '//*[@id="myTable"]/tbody/tr[60]/td[12]/a',
  "CAMBIO SECTOR CONTABLE": '//*[@id="myTable"]/tbody/tr[61]/td[12]/a',
  "EXTRAER DATOS PRESTAMOS, CERTIFICADOS Y CUENTAS": '//*[@id="myTable"]/tbody/tr[62]/td[12]/a',
  "REVERSO ASIENTOS CONDONADOS": '//*[@id="myTable"]/tbody/tr[63]/td[12]/a',
  "CAMBIO DE OFICIAL AGENCIA": '//*[@id="myTable"]/tbody/tr[64]/td[12]/a',
  "ACTUALIZAR SALDOS CONTABILIDAD 2": '//*[@id="myTable"]/tbody/tr[65]/td[12]/a',
  "GENERA ASIENTO REVALUACION DOLARES": '//*[@id="myTable"]/tbody/tr[66]/td[12]/a',
  "GENERA ASIENTO REVALUACION OTRAS MONEDAS, EURO, FRANCO SUIZO ECT": '//*[@id="myTable"]/tbody/tr[67]/td[12]/a',
  "ACTUALIZAR SALDOS CONTABILIDAD 3": '//*[@id="myTable"]/tbody/tr[68]/td[12]/a',
  "GENERA ASIENTO REVERSO CONDONACION DE TARJETA CREDITO": '//*[@id="myTable"]/tbody/tr[69]/td[12]/a',
  "ACTUALIZA VISTA MATERIALIZADA PLAN PAGO DWH": '//*[@id="myTable"]/tbody/tr[70]/td[12]/a',

  // /// F8
  "CARGA ESTADOS CUENTAS ITC": '//*[@id="myTable"]/tbody/tr[71]/td[12]/a',
  "GENERACION DE TAE A LOS ESTADOS TC": '//*[@id="myTable"]/tbody/tr[72]/td[12]/a',
  "GENERACION ESTADOS DE CUENTAS TC": '//*[@id="myTable"]/tbody/tr[73]/td[12]/a',

  // /// SISTEMA FIN
  "ACTIVACION MULTI-USUARIO": '//*[@id="myTable"]/tbody/tr[74]/td[12]/a',
  "FINALIZA CIERRE": '//*[@id="myTable"]/tbody/tr[75]/td[12]/a',
};

module.exports = { procesosXPathV };
