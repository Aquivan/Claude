"""Dirección del bot de Cobranzas (aplicación web «Asistente Telegram…») sin clasp ni Node: para el ejecutor de la PC (Windows).
Usa las credenciales de clasp (secreto CLASPRC_JSON) solo para preguntar a Google la lista de implementaciones del proyecto.
Escribe BOT_URL en GITHUB_ENV y la oculta en los registros (nunca la imprime)."""
import json
import os
import sys
import urllib.parse
import urllib.request

raiz = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
crudo = os.environ.get("CLASPRC_JSON", "")
if not crudo:
    sys.exit("::error::Falta CLASPRC_JSON: no puedo hablar con el bot.")
c = json.loads(crudo)
if "tokens" in c:   # clasp 3
    t = c["tokens"].get("default") or next(iter(c["tokens"].values()))
    cid, csec, rt = t.get("client_id"), t.get("client_secret"), t.get("refresh_token")
else:               # clasp 2
    o, t = c.get("oauth2ClientSettings") or {}, c.get("token") or {}
    cid, csec, rt = o.get("clientId"), o.get("clientSecret"), t.get("refresh_token")
datos = urllib.parse.urlencode({"client_id": cid, "client_secret": csec, "refresh_token": rt, "grant_type": "refresh_token"}).encode()
tok = json.loads(urllib.request.urlopen("https://oauth2.googleapis.com/token", data=datos, timeout=30).read())["access_token"]
sid = json.load(open(os.path.join(raiz, "cobranzas", ".clasp.json")))["scriptId"]
req = urllib.request.Request(f"https://script.googleapis.com/v1/projects/{sid}/deployments?pageSize=50", headers={"Authorization": "Bearer " + tok})
deps = json.loads(urllib.request.urlopen(req, timeout=30).read()).get("deployments", [])
b = [d for d in deps if str((d.get("deploymentConfig") or {}).get("description") or "").startswith("Asistente Telegram")]
if not b:
    sys.exit("::error::No encontré la aplicación web del bot.")
did = b[0]["deploymentId"]
print("::add-mask::" + did)
with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as f:
    f.write(f"BOT_URL=https://script.google.com/macros/s/{did}/exec\n")
print("Bot encontrado.")
