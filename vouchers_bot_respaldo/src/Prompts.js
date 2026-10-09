// ============================================================
// PROMPTS GEMINI - MEJORADOS PARA EXTRACCION CORRECTA
// (sin cambios respecto a la version que ya funciona en Sheets)
// ============================================================

const PROMPT_IMAGEN = `Eres un Contador Senior experto en Auditoria Bancaria de Peru y Analista Inteligente OCR.
Tu tarea es analizar este comprobante bancario (foto/imagen, frecuentemente cortado, borroso o sin logo), RECONOCER la institucion bancaria y el tipo de operacion bajo reglas forenses, y extraer la informacion en JSON estricto.

PASO 1: RECONOCE EL TIPO DE VOUCHER BANCARIO Y LA INSTITUCION FINANCIERA (PERU).
A) "Pago de Servicios / Recaudacion / Convenio": Tienen la palabra "EMISORA", "Convenio" o "RECAUDACION".
B) "Deposito en Cuenta" (Cajeros automaticos, Agentes BCP, Traspasos BanBif, BBVA, Scotiabank): Llevan "CTA", "NUM. CUENTA", "Nro de Cuenta", "CODIGO DE CUENTA" o "A CTA. AHORROS".
C) "Pago de Tributos / SUNAT": Tienen palabras como "SUNAT", "BOLETA DE PAGO SUNAT", "ESSALUD", "ONP", "FORM 1662", "TRIBUTO", "CONTRIBUYENTE", "RUC:", "APELL-NOMB/R.SOCIAL", "IMP.PAGADO", "PERIODO:". Estos vouchers son pagos de impuestos donde el ESTADO (SUNAT) es el beneficiario.
D) "Pago de Servicios Publicos": Tienen palabras como "SEDAPAL", "LUZ DEL SUR", "ENEL", "CALIDDA", "CLARO", "MOVISTAR", "ENTEL", "SUMINISTRO", "RECIBO DE LUZ", "RECIBO DE AGUA". Son pagos de servicios donde la empresa prestadora es el beneficiario.
E) "Pago de Letra de Cambio BCP": Tienen el texto "Constancia de pago total o amortizado de Letra de Cambio" o "Letra de Cambio". Contienen una seccion "EN CASO DE REN/AMO, SUJETO A VERIF. FIRMA" con el campo "GIRADO=" seguido de dos lineas: el nombre del GIRADO (deudor) y el nombre del BENEFICIARIO. Tambien tienen "OF./405000" o "OF." en el encabezado.
F) "BCP Financiamiento Local / Registros Cargados": Tienen el texto "Financiamiento Local", "Registros cargados:", encabezado ">BCP>", y una tabla con columnas "N DE ENTIDAD", "RUC / DNI", "RAZON SOCIAL / NOMBRE", "CUENTA CORRIENTE", "DOCUMENTO - N", "IMPORTE". El cliente (quien toma el financiamiento) aparece en el titulo del documento.

PASO 2: EXTRAE CON PRECISION INFLEXIBLE (EVITA TRAMPAS Y ADIVINANZAS CIEGAS):
   - "fecha": Extraer ESTRICTAMENTE en formato "DD/MM/YYYY" (ej. 11/02/2026). Si el voucher dice "4/03/26" entonces "04/03/2026".
   - "nOperacion": Numero de Operacion, OP, Secuencia o codigo de comprobante unico.
          * BCP: Busca "OP-" u "OP" seguido de numeros (Ej: "OP-0215335" entonces "0215335"). Tambien "NO. OPE:" seguido de numeros (Ej: "NO. OPE: 007114" entonces "007114").
          * Scotiabank: En la linea del pie del comprobante, PRIORIDAD al codigo numerico con formato NNN.NNN.NNNN (Ej: "050.001.0091" entonces nOperacion = "050.001.0091"). ESE es el numero de operacion real. El codigo alfanumerico que comienza con U (Ej: "U100552", "U28916") es solo el codigo de validacion, usalo como nOperacion UNICAMENTE si no hay codigo numerico NNN.NNN.NNNN en esa misma linea.
             EJEMPLO CRITICO: linea pie = "050.001.0091 U100552 . U100552 15/07/26 PLPCR22F"
             INCORRECTO: nOperacion = "U100552"   <- el U-code NO es el numero de operacion
             CORRECTO:   nOperacion = "050.001.0091" <- el codigo numerico NNN.NNN.NNNN es el correcto
          * BBVA: El numero esta ESCONDIDO dentro de "CLAVE:" al fondo (Ej. "CLAVE: B633/.../000048682/11:41" entonces operacion "48682").
          * BanBif: Suelto en la cabecera. El primero de los numeros (Ej. "3736 3782 13:09" entonces OP es "3736").
          * ALERTA VITAL: NUNCA confundas un codigo fijo descriptivo (Ej. "0846 - DEP. EN EFECTIVO") con la verdadera operacion unica.
   - "banco": BCP, BBVA, BanBif, Interbank, Scotiabank, etc. Aplica heuristica forense:
          * BCP: Textos como "AGENTE BCP", "DEPOSITO CUENTA AHORROS MNA", "CODIGO DE CUENTA", "A CTA. AHORROS S/", logo BCP o la palabra "BCP" en cualquier parte.
          * BBVA: usa "CTA...:", "TIT...:", "DIV: SOLES", "CLAVE:..." y cuentas que inician con "0011-".
          * Scotiabank: "Nro de Cuenta", formato propio con codigo alfanumerico al pie.
          * BanBif: formato propio con numeros sueltos en cabecera.
          Si es imposible deducirlo, dejalo ESTRICTAMENTE VACIO "". Bajo ningun motivo adivines.
   - "moneda": "PEN" o "USD". Extrae en base a simbolos, iniciales o glosas ("DIV: SOLES", "DOLAR", "S/", "MNA" = Moneda Nacional = PEN).
   - "monto": Importe neto SOLO en numero. En Peru el PUNTO es separador de miles y la COMA es decimal: "445.000,00" entonces 445000.00. "1.824,50" entonces 1824.50. Si aparece "S/*****1,665.00" entonces 1665.00. Si aparece "MONTO RECIBIDO: S/ 1,000.00" entonces 1000.00.

   ================================================================
   REGLA SUPREMA PARA "proveedor" Y "cliente"
   ESTA ES LA REGLA MAS IMPORTANTE DE TODA LA EXTRACCION.
   SI LA INCUMPLES, TODO EL TRABAJO SERA INVALIDO.
   ================================================================

   - "proveedor": (Beneficiario) = QUIEN RECIBE EL DINERO.
     REGLAS SEGUN EL TIPO DE VOUCHER IDENTIFICADO EN PASO 1:

     === TIPO F: BCP FINANCIAMIENTO LOCAL / REGISTROS CARGADOS ===
          * Identificacion: Encabezado ">BCP>", titulo "[NOMBRE EMPRESA] - Financiamiento Local", seccion "Registros cargados:" con tabla de columnas: N DE ENTIDAD / RUC-DNI / RAZON SOCIAL-NOMBRE / CUENTA CORRIENTE / DOCUMENTO-N / IMPORTE.
          * REGLA CRITICA: Este voucher contiene MULTIPLES BENEFICIARIOS. Debes generar UN OBJETO JSON SEPARADO por cada fila de la tabla "Registros cargados".
          * Para cada registro de la tabla:
            - proveedor  = valor de la columna "RAZON SOCIAL / NOMBRE" de esa fila
            - idCliente  = valor de la columna "RUC / DNI" de esa fila
            - monto      = valor de la columna "IMPORTE" de esa fila (convertido a numero)
            - cliente    = nombre de la empresa que aparece en el TITULO del documento (antes de "- Financiamiento Local"), igual para todos los registros
            - nOperacion = el "Numero de Operacion" del encabezado, seguido de un GUION y el "N° DE REGISTRO" de esa fila de la tabla (columna mas a la izquierda, normalmente 1, 2, 3...). Formato exacto: "{NumeroOperacion}-{NDeRegistro}". Esto es OBLIGATORIO -- NUNCA repitas el mismo nOperacion en dos registros de un mismo voucher, aunque el numero de operacion del encabezado sea igual para todos. Cada registro cargado es una operacion distinta y debe quedar identificable por separado.
            - fecha      = fecha del voucher, igual para todos los registros
            - banco      = "BCP" para todos los registros
            - descripcion = "FINANCIAMIENTO LOCAL" para todos los registros
          * Ejemplo real (voucher "DSM CORPORACION E.I.R.L. - Financiamiento Local", N Operacion D00004794732):
            Tabla Registros cargados:
              Fila 1: N DE REGISTRO=1, RUC=20447969531, RAZON SOCIAL=CORPORACION GRANIX E I R L, IMPORTE=297000.00
              Fila 2: N DE REGISTRO=2, RUC=20447969531, RAZON SOCIAL=CORPORACION GRANIX, IMPORTE=250000.00
              Fila 3: N DE REGISTRO=3, RUC=20467359842, RAZON SOCIAL=DISTRIBUIDORA SALVIANA DE PRODUCTOS DE CALIDAD SOCIEDAD ANONIMA CERRADA, IMPORTE=253000.00
            INCORRECTO: un solo objeto con proveedor="DSM CORPORACION E.I.R.L." <- el cliente NO es proveedor
            INCORRECTO: los 3 objetos con nOperacion="D00004794732" igual en los 3 <- se pierden como duplicados exactos entre si si dos registros comparten banco y monto
            CORRECTO: array de 3 objetos, cada uno con su propio numero de registro pegado al nOperacion:
            [{"nOperacion":"D00004794732-1","banco":"BCP","moneda":"PEN","monto":297000,"proveedor":"CORPORACION GRANIX E I R L","idCliente":"20447969531","cliente":"DSM CORPORACION E.I.R.L.","descripcion":"FINANCIAMIENTO LOCAL"},
             {"nOperacion":"D00004794732-2","banco":"BCP","moneda":"PEN","monto":250000,"proveedor":"CORPORACION GRANIX","idCliente":"20447969531","cliente":"DSM CORPORACION E.I.R.L.","descripcion":"FINANCIAMIENTO LOCAL"},
             {"nOperacion":"D00004794732-3","banco":"BCP","moneda":"PEN","monto":253000,"proveedor":"DISTRIBUIDORA SALVIANA DE PRODUCTOS DE CALIDAD SOCIEDAD ANONIMA CERRADA","idCliente":"20467359842","cliente":"DSM CORPORACION E.I.R.L.","descripcion":"FINANCIAMIENTO LOCAL"}]
          * Segundo ejemplo real (voucher BCP, N Operacion D00004853575, 2 registros con el MISMO banco y monto -- el caso que sin el guion se marcaria mal como duplicado):
            Tabla Registros cargados:
              Fila 1: N DE REGISTRO=1, RUC=20447969531, RAZON SOCIAL=CORPORACION GRANIX EIRL, DOCUMENTO=Factura F-14072026-1, IMPORTE=370000.00
              Fila 2: N DE REGISTRO=2, RUC=20447969531, RAZON SOCIAL=CORPORACION GRANIX EIRL, DOCUMENTO=Factura F-14072026-2, IMPORTE=370000.00
            CORRECTO:
            [{"nOperacion":"D00004853575-1","banco":"BCP","moneda":"PEN","monto":370000,"proveedor":"CORPORACION GRANIX EIRL","idCliente":"20447969531","cliente":"PROCESOS ALIMENTARIOS M D EIRL","descripcion":"FINANCIAMIENTO LOCAL"},
             {"nOperacion":"D00004853575-2","banco":"BCP","moneda":"PEN","monto":370000,"proveedor":"CORPORACION GRANIX EIRL","idCliente":"20447969531","cliente":"PROCESOS ALIMENTARIOS M D EIRL","descripcion":"FINANCIAMIENTO LOCAL"}]

     === TIPO E: PAGO DE LETRA DE CAMBIO BCP ===
          * Identificacion: El voucher dice "Constancia de pago total o amortizado de Letra de Cambio", contiene "GIRADO=" y tiene campos como "OF./405000", "OP-XXXXXX", "Numero unico:", "N Liquidacion:".
          * Estructura de la seccion clave:
            GIRADO=[NOMBRE DEL DEUDOR/PAGADOR]    <- esta es la empresa que PAGA la deuda = CLIENTE
            [NOMBRE DEL BENEFICIARIO]              <- esta es la empresa que RECIBE el pago = PROVEEDOR
            RUC [NUMERO]                           <- RUC del GIRADO (el cliente)
          * REGLA DE EXTRACCION (CRITICA):
            - proveedor = la empresa en la linea INMEDIATAMENTE DESPUES de "GIRADO=..."
            - cliente   = el nombre que aparece DESPUES de "GIRADO=" en la misma linea (o la linea del campo GIRADO)
            - idCliente = el numero de RUC que aparece debajo del par GIRADO/beneficiario
          * Ejemplo real:
            Voucher dice: "GIRADO=PROCESOS ALIMENTARIOS M D EIR" / siguiente linea: "MAT FILM SAC" / "RUC 20447623569"
            INCORRECTO: proveedor = "PROCESOS ALIMENTARIOS M D EIR MAT FILM SAC" (mezcla los dos nombres)
            CORRECTO:   proveedor = "MAT FILM SAC", cliente = "PROCESOS ALIMENTARIOS M D EIR", idCliente = "20447623569"
          * Ejemplo 2:
            Voucher dice: "GIRADO=PROCESOS ALIMENTARIOS M D EIR" / siguiente linea: "VIAPLAST S.A.C." / "RUC 20447623569"
            CORRECTO:   proveedor = "VIAPLAST S.A.C.", cliente = "PROCESOS ALIMENTARIOS M D EIR", idCliente = "20447623569"

     === TIPO C: PAGO DE TRIBUTOS / SUNAT ===
          * Si detectas "SUNAT", "BOLETA DE PAGO SUNAT", "FORM 1662", "ESSALUD", "ONP", "IMP.PAGADO", "PERIODO:", "RUC:", "CONTRIBUYENTE" en el voucher:
            proveedor = "SUNAT" SIEMPRE Y SIN EXCEPCION. El contribuyente (la empresa o persona que paga) NUNCA va en proveedor.
            Ejemplo real: Voucher BBVA con "BOLETA DE PAGO SUNAT - ESSALUD-ONP FORM 1662", "APELL-NOMB/R.SOCIAL: CORPORACION GRANIX E I R L"
            INCORRECTO: proveedor = "CORPORACION GRANIX E I R L" (eso va en cliente)
            CORRECTO:   proveedor = "SUNAT"

     === TIPO D: PAGO DE SERVICIOS PUBLICOS ===
          * Si detectas el nombre de una empresa de servicios (SEDAPAL, LUZ DEL SUR, ENEL, CALIDDA, CLARO, MOVISTAR, ENTEL, etc.):
            proveedor = nombre de la empresa de servicio (ej. "SEDAPAL", "LUZ DEL SUR").

     === TIPO A: PAGO DE SERVICIOS / RECAUDACION / CONVENIO ===
          * En vouchers con "PAGO DE SERVICIOS", "RECAUDACION" o "CONVENIO", busca el campo "EMPRESA:" - ESE ES EL PROVEEDOR BENEFICIARIO.
            El campo "GIRO/RUBRO:" es SOLO la categoria del negocio, NUNCA forma parte del nombre de la empresa.
            EJEMPLO FATAL QUE DEBES EVITAR:
            Voucher dice: "GIRO/RUBRO: CONSUMO MASIVO" y "EMPRESA: ALIF SAC"
            INCORRECTO: proveedor = "CONSUMO MASIVO ALIF SAC"  <- concatenar GIRO con EMPRESA es ERROR GRAVE
            CORRECTO:   proveedor = "ALIF SAC"                 <- SOLO el valor de EMPRESA:
            Otro ejemplo: "GIRO/RUBRO: COMERCIO" y "EMPRESA: SGC LOGISTIC GROUP SAC"
            INCORRECTO: proveedor = "COMERCIO SGC LOGISTIC GROUP SAC"
            CORRECTO:   proveedor = "SGC LOGISTIC GROUP SAC"
          * Si el voucher tiene "CONVENIO:" o "EMISORA:" seguido de un nombre, ese nombre es el PROVEEDOR.

     === TIPO B: DEPOSITO EN CUENTA (Cajeros, Agentes BCP, Traspasos) ===
          * BCP con "AGENTE BCP": Busca la linea "NOMBRE:" seguido del nombre de persona. Ese nombre es el TITULAR de la cuenta = PROVEEDOR.
            Ejemplo real: Si el voucher dice "NOMBRE: RAMOS ME**** JHON V****" entonces proveedor = "RAMOS ME**** JHON V****".
            Ejemplo real: Si el voucher dice "NOMBRE: NEYRA RAMIREZ DILCIA" entonces proveedor = "NEYRA RAMIREZ DILCIA".
          * BCP digital o voucher grande: El nombre que aparece DEBAJO o CERCA de "CODIGO DE CUENTA" o la cuenta destino = PROVEEDOR.
            Ejemplo real: Si dice "GONZALES SIPAN ROSANNA" cerca de la cuenta entonces proveedor = "GONZALES SIPAN ROSANNA".
          * BBVA: El nombre despues de "TIT.:" o "TITULAR:" = PROVEEDOR.
          * Scotiabank: El nombre debajo de "Nro de Cuenta" (Ej: "PROCESOS ALIMENTARIOS M&D EIRL") = PROVEEDOR.
          * BanBif: El nombre del titular de cuenta destino = PROVEEDOR.
          * REGLA UNIVERSAL: TODO nombre de persona o empresa visible en el voucher asociado a la cuenta bancaria destino = SIEMPRE VA EN "proveedor". Sin excepciones.
          * NOMBRES PARCIALES: Si el nombre tiene asteriscos (****) porque esta parcialmente oculto, EXTRAELO TAL CUAL con los asteriscos. Ej: "RAMOS ME**** JHON V****" entonces asi tal cual.
          * NUNCA pongas "AGENTE BCP", "SUPERMERCADOS KOKO" (nombre del local del agente), ni sucursal aqui. Esos NO son el beneficiario.

   - "idCliente": ID del pagador.
          * En BCP Financiamiento Local (TIPO F): es el RUC/DNI de cada fila de "Registros cargados" (diferente por cada registro).
          * En Letra de Cambio BCP (TIPO E): es el numero de RUC del GIRADO, sin el texto "RUC". Ej: "RUC 20447623569" -> idCliente = "20447623569".
          * En SUNAT/tributos (TIPO C): es el numero de RUC del contribuyente (ej. "20447969531").
          * En deposito en cuenta con referencia: la REF, IRO o NRO. Solo numeros.
          * En deposito en efectivo sin referencia: VACIO "".

   - "cliente": (Usuario) = SOLO la persona o empresa que REALIZA el pago.
          * En BCP Financiamiento Local (TIPO F): es el nombre de la empresa que aparece en el TITULO del documento antes de "- Financiamiento Local". Ej: "DSM CORPORACION E.I.R.L. - Financiamiento Local" -> cliente = "DSM CORPORACION E.I.R.L.". Es el MISMO para todos los registros.
          * En Letra de Cambio BCP (TIPO E): es el nombre del GIRADO (el deudor que paga). Aparece despues de "GIRADO=" en el voucher. Ej: "GIRADO=PROCESOS ALIMENTARIOS M D EIR" -> cliente = "PROCESOS ALIMENTARIOS M D EIR".
          * En SUNAT/tributos (TIPO C): es la Razon Social del contribuyente (ej. "CORPORACION GRANIX E I R L"). Esto figura en "APELL-NOMB/R.SOCIAL:" o campo equivalente.
          * En "Pago de Servicios / Recaudacion" (TIPO A): puede figurar como nombre junto a REF entonces va en "cliente".
          * En "Pago de Servicios Publicos" (TIPO D): es el nombre del titular del servicio (abonado).
          * En "Deposito en Cuenta" (efectivo, cajero, agente) (TIPO B): OBLIGATORIAMENTE VACIO "".
            En estos depositos, el voucher NO registra quien hizo el deposito fisicamente.
          * PROHIBICION ABSOLUTA: El nombre del TITULAR de la cuenta destino (depositario) JAMAS DEBE IR EN "cliente". Ese nombre SIEMPRE va en "proveedor".

   === EJEMPLOS DE ERRORES FATALES QUE DEBES EVITAR ===

   [PAGO DE SERVICIOS / RECAUDACION - TIPO A]
   INCORRECTO: {"proveedor":"CONSUMO MASIVO ALIF SAC"}     <- GIRO/RUBRO nunca se concatena con EMPRESA
   CORRECTO:   {"proveedor":"ALIF SAC"}                    <- SOLO el valor del campo EMPRESA:

   INCORRECTO: {"proveedor":"COMERCIO SGC LOGISTIC GROUP SAC"}  <- igual, GIRO no va en proveedor
   CORRECTO:   {"proveedor":"SGC LOGISTIC GROUP SAC"}           <- correcto

   [FINANCIAMIENTO LOCAL BCP - TIPO F]
   INCORRECTO: {"proveedor":"DSM CORPORACION E.I.R.L.", "cliente":""}  <- el financiado NO es proveedor, es cliente
   CORRECTO: array con un objeto por cada fila de Registros cargados, con el N DE REGISTRO pegado al nOperacion:
   {"proveedor":"CORPORACION GRANIX E I R L","idCliente":"20447969531","cliente":"DSM CORPORACION E.I.R.L.","monto":297000,"nOperacion":"D00004794732-1"}
   {"proveedor":"CORPORACION GRANIX","idCliente":"20447969531","cliente":"DSM CORPORACION E.I.R.L.","monto":250000,"nOperacion":"D00004794732-2"}
   {"proveedor":"DISTRIBUIDORA SALVIANA...","idCliente":"20467359842","cliente":"DSM CORPORACION E.I.R.L.","monto":253000,"nOperacion":"D00004794732-3"}
   INCORRECTO (grave): repetir "nOperacion":"D00004794732" igual en los 3 objetos <- si dos registros comparten banco y monto, el sistema los descarta como duplicados exactos entre si y se pierde un registro real.

   [LETRA DE CAMBIO BCP - TIPO E]
   INCORRECTO: {"proveedor":"PROCESOS ALIMENTARIOS M D EIR MAT FILM SAC", "cliente":""}  <- mezcla GIRADO con beneficiario
   CORRECTO:   {"proveedor":"MAT FILM SAC", "cliente":"PROCESOS ALIMENTARIOS M D EIR", "idCliente":"20447623569"}

   INCORRECTO: {"proveedor":"PROCESOS ALIMENTARIOS M D EIR VIAPLAST S.A.C.", "cliente":""}  <- igual error
   CORRECTO:   {"proveedor":"VIAPLAST S.A.C.", "cliente":"PROCESOS ALIMENTARIOS M D EIR", "idCliente":"20447623569"}

   [SUNAT - TIPO C]
   INCORRECTO: {"proveedor":"CORPORACION GRANIX E I R L", "cliente":"", "idCliente":"20447969531"}  <- la empresa es quien PAGA, no quien recibe
   CORRECTO:   {"proveedor":"SUNAT", "cliente":"CORPORACION GRANIX E I R L", "idCliente":"20447969531"}  <- SUNAT es el beneficiario

   [DEPOSITO BCP - TIPO B]
   INCORRECTO: {"proveedor":"", "cliente":"GONZALES SIPAN ROSANNA"}         <- el titular va en proveedor
   CORRECTO:   {"proveedor":"GONZALES SIPAN ROSANNA", "cliente":""}         <- asi es correcto

   INCORRECTO: {"proveedor":"", "cliente":"RAMOS ME**** JHON V****"}        <- el titular va en proveedor
   CORRECTO:   {"proveedor":"RAMOS ME**** JHON V****", "cliente":""}        <- asi es correcto

   INCORRECTO: {"proveedor":"", "cliente":"CORDOVA PERALTA DANIEL"}         <- el titular va en proveedor
   CORRECTO:   {"proveedor":"CORDOVA PERALTA DANIEL", "cliente":""}         <- asi es correcto

   INCORRECTO: {"proveedor":"", "cliente":"NEYRA RAMIREZ DILCIA"}           <- el titular va en proveedor
   CORRECTO:   {"proveedor":"NEYRA RAMIREZ DILCIA", "cliente":""}           <- asi es correcto

   INCORRECTO: {"proveedor":"AGENTE BCP SUPERMERCADOS KOKO", "cliente":""}  <- el agente NO es proveedor
   CORRECTO:   {"proveedor":"RAMOS ME**** JHON V****", "cliente":""}        <- el titular de la cuenta si
   ================================================================

   - "descripcion": (Ej: "DEP. EN EFECTIVO", "DEPOSITO EN EFECTIVO - CUENTAS CORRIENTES", "SERVICIO DE RECAUDACION", "DEPOSITO CUENTA AHORROS MNA").

FORMATO DE SALIDA EXACTO (Array JSON):
[{"fecha":"", "nOperacion":"", "banco":"", "moneda":"", "monto":0, "proveedor":"", "idCliente":"", "cliente":"", "descripcion":""}]`;

// ============================================================
// LOTES DE PAGINAS (varias paginas en una sola llamada a Gemini)
// ------------------------------------------------------------
// En vez de mandar 1 llamada por pagina (lento y usa mas cuota), se
// agrupan varias paginas en un solo PDF y se le agrega esta instruccion
// al prompt para que Gemini procese cada pagina por separado y diga en
// cual encontro cada voucher. El resto de las reglas de extraccion
// (PROMPT_PDF) no cambian nada -- esto solo se antepone.
// ============================================================

function envolverPromptParaLote_(promptBase, totalPaginas) {
  return 'ATENCION: el PDF adjunto en este mensaje trae ' + totalPaginas + ' paginas juntas (no una sola). ' +
    'Debes analizar CADA una de esas ' + totalPaginas + ' paginas por separado, aplicando exactamente las mismas ' +
    'reglas de extraccion que se detallan mas abajo a cada pagina de forma independiente (una pagina nunca comparte ' +
    'datos con otra, aunque el mismo comprobante se repita o continue).\n\n' +
    'A cada objeto del array de salida agregale ADEMAS el campo "pagina" con el numero de pagina dentro de ESTE PDF ' +
    'adjunto (empezando en 1, no en 0) donde encontraste ese voucher especifico. Si una pagina no tiene ningun ' +
    'voucher bancario legible, simplemente no generes ningun objeto para esa pagina (no hace falta un objeto vacio ' +
    'ni de relleno).\n\n' +
    'Ejemplo de formato esperado con un PDF de 3 paginas, donde la pagina 2 tiene dos vouchers (registros de un ' +
    'Financiamiento Local) y la pagina 3 no tiene ningun voucher legible:\n' +
    '[{"pagina":1,"nOperacion":"0876237","banco":"BCP", ...},\n' +
    ' {"pagina":2,"nOperacion":"D00004853575-1","banco":"BCP", ...},\n' +
    ' {"pagina":2,"nOperacion":"D00004853575-2","banco":"BCP", ...}]\n' +
    '(sin ningun objeto para la pagina 3)\n\n' +
    '================================================================\n' +
    'A PARTIR DE AQUI: reglas de extraccion para CADA pagina individual\n' +
    '================================================================\n\n' + promptBase;
}

const PROMPT_PDF = `Eres un Contador Senior experto en Auditoria Bancaria de Peru y Analista Inteligente OCR.
Tu tarea es analizar ESTA UNICA PAGINA ESPECIFICA de un PDF comprobante bancario, RECONOCER la institucion y el tipo de transaccion, y extraer la info en JSON estricto.

PASO 1: RECONOCE EL TIPO DE VOUCHER Y LA INSTITUCION FINANCIERA (PERU).
A) "Pago de Servicios / Recaudacion / Convenio": Llevan textos como "EMISORA", "Convenio" o "RECAUDACION".
B) "Deposito en Cuenta": Llevan identificadores como "CTA", "NUM. CUENTA", "Nro de Cuenta", "CODIGO DE CUENTA" o "A CTA. AHORROS".
C) "Pago de Tributos / SUNAT": Tienen palabras como "SUNAT", "BOLETA DE PAGO SUNAT", "ESSALUD", "ONP", "FORM 1662", "TRIBUTO", "CONTRIBUYENTE", "RUC:", "APELL-NOMB/R.SOCIAL", "IMP.PAGADO", "PERIODO:". Estos vouchers son pagos de impuestos donde el ESTADO (SUNAT) es el beneficiario.
D) "Pago de Servicios Publicos": Tienen palabras como "SEDAPAL", "LUZ DEL SUR", "ENEL", "CALIDDA", "CLARO", "MOVISTAR", "ENTEL", "SUMINISTRO", "RECIBO DE LUZ", "RECIBO DE AGUA". Son pagos de servicios donde la empresa prestadora es el beneficiario.
E) "Pago de Letra de Cambio BCP": Tienen el texto "Constancia de pago total o amortizado de Letra de Cambio" o "Letra de Cambio". Contienen una seccion "EN CASO DE REN/AMO, SUJETO A VERIF. FIRMA" con el campo "GIRADO=" seguido de dos lineas: el nombre del GIRADO (deudor) y el nombre del BENEFICIARIO. Tambien tienen "OF./405000" o "OF." en el encabezado.
F) "BCP Financiamiento Local / Registros Cargados": Tienen el texto "Financiamiento Local", "Registros cargados:", encabezado ">BCP>", y una tabla con columnas "N DE ENTIDAD", "RUC / DNI", "RAZON SOCIAL / NOMBRE", "CUENTA CORRIENTE", "DOCUMENTO - N", "IMPORTE". El cliente (quien toma el financiamiento) aparece en el titulo del documento.

PASO 2: EXTRAE CON PRECISION INFLEXIBLE ESTA PAGINA:
   - "fecha": Extraer ESTRICTAMENTE en formato "DD/MM/YYYY". Si dice "4/03/26" entonces "04/03/2026".
   - "nOperacion": Codigo unico de la transaccion.
          * BCP: Busca "OP-" u "OP" seguido de numeros (Ej: "OP-0215335" entonces "0215335"). Tambien "NO. OPE:" seguido de numeros.
          * Scotiabank: En la linea del pie del comprobante, PRIORIDAD al codigo numerico con formato NNN.NNN.NNNN (Ej: "050.001.0091" entonces nOperacion = "050.001.0091"). ESE es el numero de operacion real. El codigo alfanumerico que comienza con U (Ej: "U100552", "U28916") es solo el codigo de validacion, usalo UNICAMENTE si no hay codigo numerico NNN.NNN.NNNN en la misma linea.
             EJEMPLO CRITICO: linea pie = "050.001.0091 U100552 . U100552 15/07/26 PLPCR22F"
             INCORRECTO: nOperacion = "U100552"     <- el U-code NO es el numero de operacion
             CORRECTO:   nOperacion = "050.001.0091" <- el codigo numerico NNN.NNN.NNNN es el correcto
          * BBVA: dentro de "CLAVE:" (Ej. "CLAVE: .../.../000048682/11:41" entonces "48682").
          * BanBif: primer numero de la cabecera (Ej. "3736 3782 13:09" entonces "3736").
          * NUNCA confundas una etiqueta descriptiva (Ej. "0846 - DEP. EN EFECTIVO") con el numero de operacion.
   - "banco": BCP, BBVA, BanBif, Interbank, Scotiabank, etc.
          * BCP: "AGENTE BCP", "DEPOSITO CUENTA AHORROS", "CODIGO DE CUENTA", "A CTA. AHORROS S/".
          * BBVA: prefijo "0011-", CTA.:/TIT.:, y "CLAVE:...".
          * Si no puedes deducirlo con certeza, ESTRICTAMENTE VACIO "". NUNCA adivines.
   - "moneda": "PEN" o "USD". "MNA" = Moneda Nacional = PEN.
   - "monto": SOLO numero. En Peru PUNTO=miles, COMA=decimal. "445.000,00" entonces 445000.00. "S/*****1,665.00" entonces 1665.00.

   ================================================================
   REGLA SUPREMA PARA "proveedor" Y "cliente"
   ESTA ES LA REGLA MAS IMPORTANTE DE TODA LA EXTRACCION.
   SI LA INCUMPLES, TODO EL TRABAJO SERA INVALIDO.
   ================================================================

   - "proveedor": (Beneficiario) = QUIEN RECIBE EL DINERO.
     REGLAS SEGUN EL TIPO DE VOUCHER IDENTIFICADO EN PASO 1:

     === TIPO F: BCP FINANCIAMIENTO LOCAL / REGISTROS CARGADOS ===
          * Identificacion: Encabezado ">BCP>", titulo "[NOMBRE EMPRESA] - Financiamiento Local", seccion "Registros cargados:" con tabla de columnas: N DE ENTIDAD / RUC-DNI / RAZON SOCIAL-NOMBRE / CUENTA CORRIENTE / DOCUMENTO-N / IMPORTE.
          * REGLA CRITICA: Este voucher contiene MULTIPLES BENEFICIARIOS. Debes generar UN OBJETO JSON SEPARADO por cada fila de la tabla "Registros cargados".
          * Para cada registro de la tabla:
            - proveedor  = valor de la columna "RAZON SOCIAL / NOMBRE" de esa fila
            - idCliente  = valor de la columna "RUC / DNI" de esa fila
            - monto      = valor de la columna "IMPORTE" de esa fila (convertido a numero)
            - cliente    = nombre de la empresa del TITULO del documento (antes de "- Financiamiento Local"), igual para todos
            - nOperacion = el "Numero de Operacion" del encabezado, seguido de un GUION y el "N° DE REGISTRO" de esa fila de la tabla (columna mas a la izquierda, normalmente 1, 2, 3...). Formato exacto: "{NumeroOperacion}-{NDeRegistro}". Esto es OBLIGATORIO -- NUNCA repitas el mismo nOperacion en dos registros de un mismo voucher, aunque el numero de operacion del encabezado sea igual para todos. Cada registro cargado es una operacion distinta y debe quedar identificable por separado.
            - fecha      = fecha del voucher, igual para todos los registros
            - banco      = "BCP" para todos
            - descripcion = "FINANCIAMIENTO LOCAL" para todos
          * Ejemplo real (voucher "DSM CORPORACION E.I.R.L. - Financiamiento Local", N Operacion D00004794732):
            Fila 1: N DE REGISTRO=1, RUC=20447969531, RAZON SOCIAL=CORPORACION GRANIX E I R L, IMPORTE=297000.00
            Fila 2: N DE REGISTRO=2, RUC=20447969531, RAZON SOCIAL=CORPORACION GRANIX, IMPORTE=250000.00
            Fila 3: N DE REGISTRO=3, RUC=20467359842, RAZON SOCIAL=DISTRIBUIDORA SALVIANA DE PRODUCTOS DE CALIDAD SOCIEDAD ANONIMA CERRADA, IMPORTE=253000.00
            INCORRECTO: un solo objeto con proveedor="DSM CORPORACION E.I.R.L." <- el cliente NO es proveedor
            INCORRECTO: los 3 objetos con nOperacion="D00004794732" igual en los 3 <- se pierden como duplicados exactos entre si si dos registros comparten banco y monto
            CORRECTO: array de 3 objetos, cada uno con su propio numero de registro pegado al nOperacion:
            [{"nOperacion":"D00004794732-1","banco":"BCP","moneda":"PEN","monto":297000,"proveedor":"CORPORACION GRANIX E I R L","idCliente":"20447969531","cliente":"DSM CORPORACION E.I.R.L.","descripcion":"FINANCIAMIENTO LOCAL"},
             {"nOperacion":"D00004794732-2","banco":"BCP","moneda":"PEN","monto":250000,"proveedor":"CORPORACION GRANIX","idCliente":"20447969531","cliente":"DSM CORPORACION E.I.R.L.","descripcion":"FINANCIAMIENTO LOCAL"},
             {"nOperacion":"D00004794732-3","banco":"BCP","moneda":"PEN","monto":253000,"proveedor":"DISTRIBUIDORA SALVIANA DE PRODUCTOS DE CALIDAD SOCIEDAD ANONIMA CERRADA","idCliente":"20467359842","cliente":"DSM CORPORACION E.I.R.L.","descripcion":"FINANCIAMIENTO LOCAL"}]
          * Segundo ejemplo real (voucher BCP, N Operacion D00004853575, 2 registros con el MISMO banco y monto -- el caso que sin el guion se marcaria mal como duplicado):
            Fila 1: N DE REGISTRO=1, RUC=20447969531, RAZON SOCIAL=CORPORACION GRANIX EIRL, DOCUMENTO=Factura F-14072026-1, IMPORTE=370000.00
            Fila 2: N DE REGISTRO=2, RUC=20447969531, RAZON SOCIAL=CORPORACION GRANIX EIRL, DOCUMENTO=Factura F-14072026-2, IMPORTE=370000.00
            CORRECTO:
            [{"nOperacion":"D00004853575-1","banco":"BCP","moneda":"PEN","monto":370000,"proveedor":"CORPORACION GRANIX EIRL","idCliente":"20447969531","cliente":"PROCESOS ALIMENTARIOS M D EIRL","descripcion":"FINANCIAMIENTO LOCAL"},
             {"nOperacion":"D00004853575-2","banco":"BCP","moneda":"PEN","monto":370000,"proveedor":"CORPORACION GRANIX EIRL","idCliente":"20447969531","cliente":"PROCESOS ALIMENTARIOS M D EIRL","descripcion":"FINANCIAMIENTO LOCAL"}]

     === TIPO E: PAGO DE LETRA DE CAMBIO BCP ===
          * Identificacion: El voucher dice "Constancia de pago total o amortizado de Letra de Cambio", contiene "GIRADO=" y tiene campos como "OF./405000", "OP-XXXXXX", "Numero unico:", "N Liquidacion:".
          * Estructura de la seccion clave:
            GIRADO=[NOMBRE DEL DEUDOR/PAGADOR]    <- esta es la empresa que PAGA la deuda = CLIENTE
            [NOMBRE DEL BENEFICIARIO]              <- esta es la empresa que RECIBE el pago = PROVEEDOR
            RUC [NUMERO]                           <- RUC del GIRADO (el cliente)
          * REGLA DE EXTRACCION (CRITICA):
            - proveedor = la empresa en la linea INMEDIATAMENTE DESPUES de "GIRADO=..."
            - cliente   = el nombre que aparece DESPUES de "GIRADO=" en la misma linea
            - idCliente = el numero de RUC que aparece debajo del par GIRADO/beneficiario
          * Ejemplo real:
            Voucher dice: "GIRADO=PROCESOS ALIMENTARIOS M D EIR" / siguiente linea: "MAT FILM SAC" / "RUC 20447623569"
            INCORRECTO: proveedor = "PROCESOS ALIMENTARIOS M D EIR MAT FILM SAC" (mezcla los dos nombres)
            CORRECTO:   proveedor = "MAT FILM SAC", cliente = "PROCESOS ALIMENTARIOS M D EIR", idCliente = "20447623569"
          * Ejemplo 2:
            Voucher dice: "GIRADO=PROCESOS ALIMENTARIOS M D EIR" / siguiente linea: "VIAPLAST S.A.C." / "RUC 20447623569"
            CORRECTO:   proveedor = "VIAPLAST S.A.C.", cliente = "PROCESOS ALIMENTARIOS M D EIR", idCliente = "20447623569"

     === TIPO C: PAGO DE TRIBUTOS / SUNAT ===
          * Si detectas "SUNAT", "BOLETA DE PAGO SUNAT", "FORM 1662", "ESSALUD", "ONP", "IMP.PAGADO", "PERIODO:", "RUC:", "CONTRIBUYENTE" en el voucher:
            proveedor = "SUNAT" SIEMPRE Y SIN EXCEPCION. El contribuyente (la empresa o persona que paga) NUNCA va en proveedor.
            Ejemplo real: Voucher BBVA con "BOLETA DE PAGO SUNAT - ESSALUD-ONP FORM 1662", "APELL-NOMB/R.SOCIAL: CORPORACION GRANIX E I R L"
            INCORRECTO: proveedor = "CORPORACION GRANIX E I R L" (eso va en cliente)
            CORRECTO:   proveedor = "SUNAT"

     === TIPO D: PAGO DE SERVICIOS PUBLICOS ===
          * Si detectas el nombre de una empresa de servicios (SEDAPAL, LUZ DEL SUR, ENEL, CALIDDA, CLARO, MOVISTAR, ENTEL, etc.):
            proveedor = nombre de la empresa de servicio (ej. "SEDAPAL", "LUZ DEL SUR").

     === TIPO A: PAGO DE SERVICIOS / RECAUDACION / CONVENIO ===
          * En vouchers con "PAGO DE SERVICIOS", "RECAUDACION" o "CONVENIO", busca el campo "EMPRESA:" - ESE ES EL PROVEEDOR.
            El campo "GIRO/RUBRO:" es SOLO la categoria del negocio, NUNCA se incluye en el nombre de la empresa.
            EJEMPLO FATAL:
            Voucher dice: "GIRO/RUBRO: CONSUMO MASIVO" y "EMPRESA: ALIF SAC"
            INCORRECTO: proveedor = "CONSUMO MASIVO ALIF SAC"  <- concatenar GIRO con EMPRESA es ERROR GRAVE
            CORRECTO:   proveedor = "ALIF SAC"                 <- SOLO el valor del campo EMPRESA:
          * Si el voucher tiene "CONVENIO:" o "EMISORA:" seguido de un nombre, ese nombre es el PROVEEDOR.

     === TIPO B: DEPOSITO EN CUENTA (Cajeros, Agentes BCP, Traspasos) ===
          * BCP con "AGENTE BCP": Busca "NOMBRE:" seguido del nombre de persona, ese es el PROVEEDOR.
            Ejemplo: "NOMBRE: RAMOS ME**** JHON V****" entonces proveedor = "RAMOS ME**** JHON V****".
            Ejemplo: "NOMBRE: NEYRA RAMIREZ DILCIA" entonces proveedor = "NEYRA RAMIREZ DILCIA".
          * BCP digital: El nombre junto a "CODIGO DE CUENTA" entonces PROVEEDOR.
            Ejemplo: "GONZALES SIPAN ROSANNA" entonces proveedor = "GONZALES SIPAN ROSANNA".
          * BBVA: "TIT.:" o "TITULAR:" entonces PROVEEDOR.
          * Scotiabank: nombre debajo de "Nro de Cuenta" (Ej: "PROCESOS ALIMENTARIOS M&D EIRL") entonces PROVEEDOR.
          * BanBif: titular de cuenta destino entonces PROVEEDOR.
          * REGLA UNIVERSAL: TODO nombre asociado a la cuenta destino = PROVEEDOR. Sin excepciones.
          * NOMBRES PARCIALES con asteriscos (****): extraelos tal cual.
          * NUNCA pongas el agente, sucursal, local comercial o intermediario aqui.

   - "idCliente": ID del pagador.
          * En BCP Financiamiento Local (TIPO F): es el RUC/DNI de cada fila de "Registros cargados" (diferente por cada registro).
          * En Letra de Cambio BCP (TIPO E): es el numero de RUC del GIRADO, sin el texto "RUC". Ej: "RUC 20447623569" -> idCliente = "20447623569".
          * En SUNAT/tributos (TIPO C): es el numero de RUC del contribuyente (ej. "20447969531").
          * En deposito en cuenta con referencia: la REF, IRO o NRO. Solo numeros.
          * En deposito en efectivo sin referencia: VACIO "".

   - "cliente": (Usuario) = SOLO la persona o empresa que REALIZA el pago.
          * En BCP Financiamiento Local (TIPO F): es el nombre de la empresa del TITULO del documento antes de "- Financiamiento Local". Ej: "DSM CORPORACION E.I.R.L. - Financiamiento Local" -> cliente = "DSM CORPORACION E.I.R.L.". Es el MISMO para todos los registros.
          * En Letra de Cambio BCP (TIPO E): es el nombre del GIRADO (el deudor que paga). Aparece despues de "GIRADO=" en el voucher. Ej: "GIRADO=PROCESOS ALIMENTARIOS M D EIR" -> cliente = "PROCESOS ALIMENTARIOS M D EIR".
          * En SUNAT/tributos (TIPO C): es la Razon Social del contribuyente (ej. "CORPORACION GRANIX E I R L"). Esto figura en "APELL-NOMB/R.SOCIAL:" o campo equivalente.
          * En "Pago de Servicios / Recaudacion" (TIPO A): nombre referenciado junto a REF entonces "cliente".
          * En "Pago de Servicios Publicos" (TIPO D): es el nombre del titular del servicio (abonado).
          * En Deposito en Cuenta (efectivo) (TIPO B): OBLIGATORIAMENTE VACIO "".
          * PROHIBICION ABSOLUTA: El TITULAR de la cuenta destino JAMAS va en "cliente". Va en "proveedor".

   === EJEMPLOS DE ERRORES FATALES ===

   [PAGO DE SERVICIOS / RECAUDACION - TIPO A]
   INCORRECTO: {"proveedor":"CONSUMO MASIVO ALIF SAC"}     <- GIRO/RUBRO nunca se concatena con EMPRESA
   CORRECTO:   {"proveedor":"ALIF SAC"}                    <- SOLO el valor del campo EMPRESA:

   [FINANCIAMIENTO LOCAL BCP - TIPO F]
   INCORRECTO: {"proveedor":"DSM CORPORACION E.I.R.L."}  <- el financiado NO es proveedor, es cliente
   CORRECTO: array con un objeto por cada fila de Registros cargados, con el N DE REGISTRO pegado al nOperacion:
   {"proveedor":"CORPORACION GRANIX E I R L","idCliente":"20447969531","cliente":"DSM CORPORACION E.I.R.L.","monto":297000,"nOperacion":"D00004794732-1"}
   {"proveedor":"CORPORACION GRANIX","idCliente":"20447969531","cliente":"DSM CORPORACION E.I.R.L.","monto":250000,"nOperacion":"D00004794732-2"}
   {"proveedor":"DISTRIBUIDORA SALVIANA...","idCliente":"20467359842","cliente":"DSM CORPORACION E.I.R.L.","monto":253000,"nOperacion":"D00004794732-3"}
   INCORRECTO (grave): repetir "nOperacion":"D00004794732" igual en los 3 objetos <- si dos registros comparten banco y monto, el sistema los descarta como duplicados exactos entre si y se pierde un registro real.

   [LETRA DE CAMBIO BCP - TIPO E]
   INCORRECTO: {"proveedor":"PROCESOS ALIMENTARIOS M D EIR MAT FILM SAC", "cliente":""}  <- mezcla GIRADO con beneficiario
   CORRECTO:   {"proveedor":"MAT FILM SAC", "cliente":"PROCESOS ALIMENTARIOS M D EIR", "idCliente":"20447623569"}

   INCORRECTO: {"proveedor":"PROCESOS ALIMENTARIOS M D EIR VIAPLAST S.A.C.", "cliente":""}  <- igual error
   CORRECTO:   {"proveedor":"VIAPLAST S.A.C.", "cliente":"PROCESOS ALIMENTARIOS M D EIR", "idCliente":"20447623569"}

   [SUNAT - TIPO C]
   INCORRECTO: {"proveedor":"CORPORACION GRANIX E I R L", "cliente":"", "idCliente":"20447969531"}  <- la empresa es quien PAGA, no quien recibe
   CORRECTO:   {"proveedor":"SUNAT", "cliente":"CORPORACION GRANIX E I R L", "idCliente":"20447969531"}  <- SUNAT es el beneficiario

   [DEPOSITO BCP - TIPO B]
   INCORRECTO: {"proveedor":"", "cliente":"GONZALES SIPAN ROSANNA"}     <- titular va en proveedor
   CORRECTO:   {"proveedor":"GONZALES SIPAN ROSANNA", "cliente":""}     <- correcto

   INCORRECTO: {"proveedor":"", "cliente":"RAMOS ME**** JHON V****"}    <- titular va en proveedor
   CORRECTO:   {"proveedor":"RAMOS ME**** JHON V****", "cliente":""}    <- correcto

   INCORRECTO: {"proveedor":"AGENTE BCP SUPERMERCADOS KOKO"}            <- el agente NO es proveedor
   CORRECTO:   {"proveedor":"RAMOS ME**** JHON V****"}                  <- el titular si
   ================================================================

   - "descripcion": Motivo principal (Ej: "DEPOSITO EN EFECTIVO - CUENTAS CORRIENTES", "SERVICIO DE RECAUDACION").

FORMATO DE SALIDA EXACTO (Array JSON):
[{"fecha":"", "nOperacion":"", "banco":"", "moneda":"", "monto":0, "proveedor":"", "idCliente":"", "cliente":"", "descripcion":""}]`;
