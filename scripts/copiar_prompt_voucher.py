"""Copia las instrucciones REALES del lector de vouchers (vouchers_bot_cambios/src/Prompts.js, PROMPT_IMAGEN) a
cobranzas/telegram/TG_PromptVoucher.js, para que la prueba «nvidia» del bot compare con las mismas instrucciones.
Lo corre «Desplegar Cobranzas» antes de subir (así nunca quedan desactualizadas). Uso: python3 scripts/copiar_prompt_voucher.py"""
import json, os, re, sys
raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(raiz, 'vouchers_bot_cambios/src/Prompts.js'), encoding='utf-8').read()
m = re.search(r'const PROMPT_IMAGEN = `(.*?)`;', src, re.S)
if not m:
    sys.exit('No encontré PROMPT_IMAGEN en Prompts.js')
dest = os.path.join(raiz, 'cobranzas/telegram/TG_PromptVoucher.js')
open(dest, 'w', encoding='utf-8').write(
    '/**\n * Instrucciones REALES del lector de vouchers (copia de vouchers_bot_cambios/src/Prompts.js · PROMPT_IMAGEN).\n'
    ' * NO editar aquí: lo genera scripts/copiar_prompt_voucher.py (y «Desplegar Cobranzas» lo rehace en cada despliegue).\n'
    ' * Lo usa la prueba «nvidia» del bot (TG_Nvidia.js) para comparar Gemini y NVIDIA con las mismas instrucciones.\n */\n'
    'var TGNV_PROMPT_VOUCHER_ = ' + json.dumps(m.group(1).replace('\\`', '`'), ensure_ascii=False) + ';\n')
print('Instrucciones copiadas:', len(m.group(1)), 'caracteres')
