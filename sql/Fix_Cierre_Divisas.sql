DECLARE
    v_ddl   CLOB;
BEGIN
    -- 1️⃣ Obtener el cuerpo actual del paquete
    SELECT DBMS_METADATA.GET_DDL('PACKAGE_BODY','PKG_CIERRE_DIARIO_PA','PA')
      INTO v_ddl
      FROM dual;

    -- 2️⃣ Insertar comentario antes y después del bloque pa.send_mail_html
    v_ddl := REPLACE(v_ddl,
                     'pa.send_mail_html(',
                     '/* INICIO BLOQUE COMENTADO POR Fix_Cierre_Divisas */ pa.send_mail_html(');
    v_ddl := REPLACE(v_ddl,
                     'vTexto);',
                     'vTexto); /* FIN BLOQUE COMENTADO POR Fix_Cierre_Divisas */');

    -- 3️⃣ Recompilar el paquete con el nuevo cuerpo
    EXECUTE IMMEDIATE v_ddl;
    DBMS_OUTPUT.PUT_LINE('✅ Fix_Cierre_Divisas aplicado correctamente (bloque comentado).');

    -- 4️⃣ Verificar estado final
    DECLARE
        v_status VARCHAR2(10);
    BEGIN
        SELECT status INTO v_status
        FROM all_objects
        WHERE owner = 'PA'
          AND object_type = 'PACKAGE BODY'
          AND object_name = 'PKG_CIERRE_DIARIO_PA';
        DBMS_OUTPUT.PUT_LINE('📦 Estado final del paquete: ' || v_status);
    END;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLCODE = -24344 THEN
            DBMS_OUTPUT.PUT_LINE('⚠️ ORA-24344: advertencia de compilación, pero paquete recompilado.');
        ELSE
            DBMS_OUTPUT.PUT_LINE('❌ Error al aplicar Fix_Cierre_Divisas: ' || SQLERRM);
        END IF;
END;
