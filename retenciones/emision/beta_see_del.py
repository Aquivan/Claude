"""Prueba en el ENTORNO DE PRUEBAS (BETA) de SUNAT: arma un Comprobante de Retención Electrónico (UBL 2.0)
con datos FICTICIOS, lo firma con un certificado de prueba y lo envía al servicio sendBill de beta.
Beta no tiene validez tributaria ni pide certificado registrado (usuario RUC+MODDATOS / moddatos).
No usa ninguna clave real."""
import base64, io, os, re, subprocess, urllib.error, urllib.request, zipfile
from datetime import date

RUC = '20000000001'   # RUC ficticio de pruebas
hoy = date.today().isoformat()
serie, numero = 'R001', '1'
nombre = f'{RUC}-20-{serie}-{numero}'

DIR = ('<cac:PostalAddress><cbc:ID>150101</cbc:ID><cbc:StreetName>AV PRUEBA 123</cbc:StreetName><cbc:CitySubdivisionName>-</cbc:CitySubdivisionName>'
       '<cbc:CityName>LIMA</cbc:CityName><cbc:CountrySubentity>LIMA</cbc:CountrySubentity><cbc:District>LIMA</cbc:District>'
       '<cac:Country><cbc:IdentificationCode>PE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>')

xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<Retention xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:Retention-1" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" xmlns:sac="urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1"><ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><ds:Signature Id="SignatureSP"><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><ds:SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><ds:Reference URI=""><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></ds:Transforms><ds:DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><ds:DigestValue/></ds:Reference></ds:SignedInfo><ds:SignatureValue/><ds:KeyInfo><ds:X509Data><ds:X509Certificate/></ds:X509Data></ds:KeyInfo></ds:Signature></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions><cbc:UBLVersionID>2.0</cbc:UBLVersionID><cbc:CustomizationID>1.0</cbc:CustomizationID><cac:Signature><cbc:ID>{RUC}</cbc:ID><cac:SignatoryParty><cac:PartyIdentification><cbc:ID>{RUC}</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>PRUEBA</cbc:Name></cac:PartyName></cac:SignatoryParty><cac:DigitalSignatureAttachment><cac:ExternalReference><cbc:URI>#SignatureSP</cbc:URI></cac:ExternalReference></cac:DigitalSignatureAttachment></cac:Signature><cbc:ID>{serie}-{numero}</cbc:ID><cbc:IssueDate>{hoy}</cbc:IssueDate><cac:AgentParty><cac:PartyIdentification><cbc:ID schemeID="6">{RUC}</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>AGENTE DE PRUEBA</cbc:Name></cac:PartyName>{DIR}<cac:PartyLegalEntity><cbc:RegistrationName>AGENTE DE PRUEBA SAC</cbc:RegistrationName></cac:PartyLegalEntity></cac:AgentParty><cac:ReceiverParty><cac:PartyIdentification><cbc:ID schemeID="6">20100066603</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>PROVEEDOR DE PRUEBA</cbc:Name></cac:PartyName>{DIR}<cac:PartyLegalEntity><cbc:RegistrationName>PROVEEDOR DE PRUEBA SAC</cbc:RegistrationName></cac:PartyLegalEntity></cac:ReceiverParty><sac:SUNATRetentionSystemCode>01</sac:SUNATRetentionSystemCode><sac:SUNATRetentionPercent>3.00</sac:SUNATRetentionPercent><cbc:Note>PRUEBA</cbc:Note><cbc:TotalInvoiceAmount currencyID="PEN">30.00</cbc:TotalInvoiceAmount><sac:SUNATTotalPaid currencyID="PEN">970.00</sac:SUNATTotalPaid><sac:SUNATRetentionDocumentReference><cbc:ID schemeID="01">F001-1</cbc:ID><cbc:IssueDate>{hoy}</cbc:IssueDate><cbc:TotalInvoiceAmount currencyID="PEN">1000.00</cbc:TotalInvoiceAmount><cac:Payment><cbc:ID>1</cbc:ID><cbc:PaidAmount currencyID="PEN">1000.00</cbc:PaidAmount><cbc:PaidDate>{hoy}</cbc:PaidDate></cac:Payment><sac:SUNATRetentionInformation><sac:SUNATRetentionAmount currencyID="PEN">30.00</sac:SUNATRetentionAmount><sac:SUNATRetentionDate>{hoy}</sac:SUNATRetentionDate><sac:SUNATNetTotalPaid currencyID="PEN">970.00</sac:SUNATNetTotalPaid><cac:ExchangeRate><cbc:SourceCurrencyCode>PEN</cbc:SourceCurrencyCode><cbc:TargetCurrencyCode>PEN</cbc:TargetCurrencyCode><cbc:CalculationRate>1.00</cbc:CalculationRate><cbc:Date>{hoy}</cbc:Date></cac:ExchangeRate></sac:SUNATRetentionInformation></sac:SUNATRetentionDocumentReference></Retention>'''
open('plantilla.xml', 'w', encoding='utf-8').write(xml)

# Certificado de PRUEBA (autofirmado, dura 2 días) y firma XML con xmlsec1.
subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'k.pem', '-out', 'c.pem', '-days', '2',
                '-subj', '/CN=PRUEBA/O=PRUEBA/C=PE'], check=True, capture_output=True)
subprocess.run(['xmlsec1', '--sign', '--privkey-pem', 'k.pem,c.pem', '--output', 'firmado.xml', 'plantilla.xml'], check=True)
print('XML firmado:', os.path.getsize('firmado.xml'), 'bytes')
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
    z.write('firmado.xml', nombre + '.xml')
contenido = base64.b64encode(buf.getvalue()).decode()

soap = (f'<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" '
        f'xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><soapenv:Header><wsse:Security>'
        f'<wsse:UsernameToken><wsse:Username>{RUC}MODDATOS</wsse:Username><wsse:Password>moddatos</wsse:Password></wsse:UsernameToken>'
        f'</wsse:Security></soapenv:Header><soapenv:Body><ser:sendBill><fileName>{nombre}.zip</fileName><contentFile>{contenido}</contentFile>'
        f'</ser:sendBill></soapenv:Body></soapenv:Envelope>')
for url in ['https://e-beta.sunat.gob.pe/ol-ti-itemision-otroscpe-gem-beta/billService',
            'https://e-beta.sunat.gob.pe/ol-ti-itemision-otroscpe-gembeta/billService']:
    print('\n== POST', url)
    req = urllib.request.Request(url, data=soap.encode(), headers={'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'urn:sendBill'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            cuerpo = r.read().decode('utf-8', 'ignore'); print('HTTP', r.status)
    except urllib.error.HTTPError as e:
        cuerpo = e.read().decode('utf-8', 'ignore'); print('HTTP', e.code)
    except Exception as e:
        print('ERROR', e); continue
    falla = re.search(r'<faultstring>(.*?)</faultstring>', cuerpo, re.S)
    if falla:
        print('SUNAT respondió con error:', falla.group(1)[:400])
        continue
    m = re.search(r'<applicationResponse>(.*?)</applicationResponse>', cuerpo, re.S)
    if not m:
        print('Respuesta:', cuerpo[:600]); continue
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(m.group(1)))) as z:
        cdr = z.read(z.namelist()[-1]).decode('utf-8', 'ignore')
    print('CDR recibido. ResponseCode:', (re.search(r'<cbc:ResponseCode>(.*?)<', cdr) or [None, '?'])[1],
          '| Descripción:', (re.search(r'<cbc:Description>(.*?)<', cdr) or [None, '?'])[1],
          '| Notas:', re.findall(r'<cbc:Note>(.*?)<', cdr)[:5])
    break
