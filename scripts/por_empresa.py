#!/usr/bin/env python3
"""
Corre un descargador de SUNAT para VARIAS empresas en UNA sola máquina de GitHub.

GitHub cobra cada trabajo como mínimo 1 minuto más el tiempo de preparar la máquina:
con una máquina por empresa, 7 empresas costaban ~8 minutos aunque cada una tardara
segundos. Aquí se hacen una tras otra en la misma máquina.

Las claves SOL de todas las empresas vienen en el secreto del repositorio SUNAT_CLAVES,
una empresa por línea:   RUC USUARIO CLAVE
(también acepta JSON: {"RUC": {"usuario": "...", "clave": "..."}}). Si una empresa no
está, se avisa y se sigue con las demás. Las claves nunca se imprimen (se enmascaran
antes de usarlas).

Uso: python3 scripts/por_empresa.py --rucs '["2061...","2044..."]' -- comando args...
Cada empresa corre el comando con SUNAT_RUC, SUNAT_USUARIO y SUNAT_CLAVE propios.
Si alguna falla, al final sale con error y deja una anotación "Empresas que fallaron"
con sus RUC (la leen la hoja y el bot de Telegram).
"""
import argparse
import json
import os
import subprocess
import sys


def leer_claves(texto):
    texto = (texto or "").strip()
    if not texto:
        return {}
    if texto.startswith("{"):
        datos = json.loads(texto)
        return {str(r).strip(): (str(v.get("usuario", "")).strip(), str(v.get("clave", "")))
                for r, v in datos.items() if isinstance(v, dict)}
    claves = {}
    for linea in texto.splitlines():
        partes = linea.strip().split(None, 2)
        if len(partes) == 3 and partes[0].isdigit():
            claves[partes[0]] = (partes[1], partes[2].strip())
    return claves


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rucs", required=True, help="Lista JSON de RUC")
    ap.add_argument("--minutos", type=int, default=30, help="Tope por empresa")
    ap.add_argument("comando", nargs=argparse.REMAINDER)
    a = ap.parse_args()
    comando = a.comando[1:] if a.comando[:1] == ["--"] else a.comando
    if not comando:
        sys.exit("Falta el comando a correr")

    claves = leer_claves(os.environ.get("SUNAT_CLAVES", ""))
    for usuario, clave in claves.values():   # enmascarar ANTES de usarlas
        if clave:
            print(f"::add-mask::{clave}", flush=True)
        if usuario:
            print(f"::add-mask::{usuario}", flush=True)

    rucs = json.loads(a.rucs)
    fallos, bien = [], []
    for ruc in rucs:
        print(f"::group::{ruc}", flush=True)
        if ruc not in claves:
            print(f"{ruc}: no está en el secreto SUNAT_CLAVES (agregue la línea 'RUC USUARIO CLAVE').", flush=True)
            fallos.append(ruc)
            print("::endgroup::", flush=True)
            continue
        usuario, clave = claves[ruc]
        env = dict(os.environ, SUNAT_RUC=ruc, SUNAT_USUARIO=usuario, SUNAT_CLAVE=clave)
        env.pop("SUNAT_CLAVES", None)
        try:
            r = subprocess.run(comando, env=env, timeout=a.minutos * 60)
            (bien if r.returncode == 0 else fallos).append(ruc)
            if r.returncode != 0:
                print(f"{ruc}: terminó con error (código {r.returncode}).", flush=True)
        except subprocess.TimeoutExpired:
            print(f"{ruc}: pasó los {a.minutos} min; se sigue con la siguiente.", flush=True)
            fallos.append(ruc)
        print("::endgroup::", flush=True)

    resumen = os.environ.get("GITHUB_STEP_SUMMARY")
    if resumen:
        with open(resumen, "a", encoding="utf-8") as f:
            f.write(f"Empresas bien: {len(bien)} · con error: {len(fallos)}\n\n")
            if fallos:
                f.write("Fallaron: " + ", ".join(fallos) + "\n")
    print(f"Bien: {len(bien)} · con error: {len(fallos)}")
    if fallos:
        print(f"::error title=Empresas que fallaron::{' '.join(fallos)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
