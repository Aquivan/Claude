#!/usr/bin/env bash
# Publica una carpeta en GitHub Pages (rama gh-pages) SIN borrar las demás (cada proyecto tiene la suya: vouchers/, mesa/…).
# Uso: publicar_pages.sh <carpeta con los archivos> <subcarpeta en el sitio>    (necesita GH_TOKEN y GITHUB_REPOSITORY)
set -u
ORIGEN="$1"; DESTINO="$2"
[ -d "$ORIGEN" ] || { echo "No existe $ORIGEN"; exit 1; }
URL="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
for intento in 1 2 3 4 5; do
  T=$(mktemp -d)
  if git clone -q --depth 1 --branch gh-pages "$URL" "$T" 2>/dev/null; then :; else
    git -C "$T" init -q -b gh-pages && git -C "$T" remote add origin "$URL"
  fi
  rm -rf "$T/$DESTINO" && mkdir -p "$T/$DESTINO" && cp -a "$ORIGEN/." "$T/$DESTINO/"
  [ -f "$T/.nojekyll" ] || touch "$T/.nojekyll"
  [ -f "$T/index.html" ] || printf '<!doctype html><meta charset="utf-8"><title>Mini Apps</title><p>Abra la Mini App desde el bot de Telegram.</p>' > "$T/index.html"
  git -C "$T" add -A
  if git -C "$T" diff --cached --quiet; then echo "Pages: $DESTINO sin cambios."; rm -rf "$T"; exit 0; fi
  git -C "$T" -c user.name="github-actions[bot]" -c user.email="github-actions[bot]@users.noreply.github.com" commit -qm "Pages: $DESTINO"
  if git -C "$T" push -q origin gh-pages; then echo "Pages: $DESTINO publicado."; rm -rf "$T"; exit 0; fi
  rm -rf "$T"; sleep $((intento * 3))
done
echo "::warning::No se pudo publicar $DESTINO en gh-pages"
exit 0
