/*
 * Ícones em SVG (traços adaptados do Tabler Icons, licença MIT).
 * Uso: icone('coracao')  ->  elemento <svg> que herda a cor do texto.
 */
(function () {
  'use strict';

  var P = {
    coracao: 'M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572',
    check: 'M5 12l5 5l10 -10',
    mais: 'M12 5l0 14M5 12l14 0',
    menos: 'M5 12l14 0',
    x: 'M18 6l-12 12M6 6l12 12',
    lixeira: 'M4 7l16 0M10 11l0 6M14 11l0 6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3',
    lapis: 'M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4M13.5 6.5l4 4',
    camera: 'M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0',
    sol: 'M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7',
    lua: 'M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z',
    alvo: 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0',
    grafico: 'M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1zM15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1zM9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z',
    imagem: 'M15 8h.01M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12zM3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3',
    chama: 'M12 12c2 -2.96 0 -7 -1 -8c0 3.038 -1.773 4.741 -3 6c-1.226 1.26 -2 3.24 -2 5a6 6 0 1 0 12 0c0 -1.532 -1.056 -3.94 -2 -5c-1.786 3 -2.791 3 -4 2z',
    sair: 'M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2M9 12h12l-3 -3M18 15l3 -3',
    chave: 'M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6zM11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0M8 11v-4a4 4 0 1 1 8 0v4',
    atualizar: 'M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4',
    seta: 'M5 12l14 0M13 18l6 -6M13 6l6 6',
    prato: 'M7 3v7M5 3v4a2 2 0 0 0 4 0v-4M7 10v11M17 21v-18c-2 0 -3.5 3 -3.5 8h3.5',
    balanca: 'M7 20l10 0M6 6l6 -1l6 1M12 3l0 17M9 12l-3 -6l-3 6a3 3 0 0 0 6 0M21 12l-3 -6l-3 6a3 3 0 0 0 6 0',
    calendario: 'M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12zM16 3v4M8 3v4M4 11h16',
    recado: 'M8 9h8M8 13h6M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z',
    desfazer: 'M9 14l-4 -4l4 -4M5 10h11a4 4 0 1 1 0 8h-1',
    arquivar: 'M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2zM5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-10M10 12l4 0',
    seta_baixo: 'M6 9l6 6l6 -6',
    seta_esq: 'M15 6l-6 6l6 6',
    seta_dir: 'M9 6l6 6l-6 6',
    pilula: 'M4.5 12.5l8 -8a4.94 4.94 0 0 1 7 7l-8 8a4.94 4.94 0 0 1 -7 -7M8.5 8.5l7 7',
    estrela: 'M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z'
  };

  function icone(nome, classe) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'ic' + (classe ? ' ' + classe : ''));
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', P[nome] || '');
    svg.appendChild(path);
    return svg;
  }

  window.icone = icone;
})();
