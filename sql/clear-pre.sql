DELETE FROM PA.PA_REQUISITO_PROCESO_CIERRE
WHERE (cod_sistema_requisito = 'PRE' AND COD_PROCESO_REQUISITO = 1)
   OR (cod_sistema_requisito = 'PRE' AND COD_PROCESO_REQUISITO = 4)
   OR (cod_sistema_requisito = 'PRE' AND COD_PROCESO_REQUISITO = 5)
   OR (cod_sistema_requisito = 'MTC')
   OR (cod_sistema_requisito = 'F5' AND COD_PROCESO_REQUISITO = 2)
