# Detracciones · Grupo (en construcción)

Reporte multiempresa de detracciones (SPOT): constancias de depósito hechas por
cada empresa del grupo a sus proveedores (como adquiriente) y las recibidas de
sus clientes (como proveedor), descargadas de SUNAT SOL, en una hoja propia.

## Estado (15/10/2026)

Exploración en SUNAT (solo lectura) con `scripts/explorar.py`
(workflow `detracciones-explorar.yml`):

- La opción de SUNAT es **12.4.1.1.2 "Consulta de detracciones"** (ícono
  "Consulta de Detracciones" del menú SOL, bloque *Detracciones* 12.4).
- Con los usuarios SOL que usa el sistema (los de los Environments de GitHub)
  SUNAT responde **"Acceso no autorizado"** en GRANIX, BKF, M&D y DSM: esa
  opción no está asignada a esos usuarios secundarios.
- Sí abren (no sirven para el reporte): 12.4.1.1.3 "Consulta de ingreso como
  recaudación" (Form. 1662) y 12.4.1.1.6 "Consulta de NPD".
- SIRE solo trae la marca "D" (comprobante sujeto a detracción), no la constancia.

**Falta**: que el usuario principal SOL de cada empresa asigne al usuario
secundario la opción *Consulta de detracciones*. Con eso se vuelve a correr el
explorador (modo `opcion`, código `icon:12.4.1.1.2`) y se arma el descargador y la hoja.
