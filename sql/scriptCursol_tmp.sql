DECLARE
  CURSOR c212021 IS
    SELECT a.fecha,
           b.cod_empresa,
           b.cod_sistema,
           b.cod_proceso,
           b.proceso_ejecuta
      FROM cc.bit_pasos_cierre_cc a,
           pa.pa_proceso_cierre b
     WHERE fecha = '12-OCT-2025' -- esta fecha será reemplazada dinámicamente
       AND b.proceso_ejecuta = a.proceso_ejecuta;

  pError VARCHAR2(1000);
BEGIN
  FOR x IN c212021 LOOP
    pa.pa_pkg_bitacora_proceso_cierre.Pa_Registra_Bitacora(
      x.cod_empresa,
      x.cod_sistema,
      x.cod_proceso,
      x.fecha,
      'X',
      pError
    );
  END LOOP;

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('✅ scriptCursol.sql ejecutado correctamente (bitácora inicializada).');

EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    DBMS_OUTPUT.PUT_LINE('❌ Error en scriptCursol.sql: ' || SQLERRM);
END;
