function abrirCarpeta() {
  var url = "https://drive.google.com/drive/folders/1SzeCzSIO75zhde5dSMsMCZ7fXOYmS4_2?hl=es-419"; // Pega la URL de tu carpeta entre las comillas
  var html = HtmlService.createHtmlOutput('<script>window.open("' + url + '", "_blank");google.script.host.close();</script>')
              .setWidth(200).setHeight(50);
  SpreadsheetApp.getUi().showModalDialog(html, 'Abriendo carpeta...');
}