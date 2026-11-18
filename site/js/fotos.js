/*
 * Prepara a foto no próprio celular antes de enviar:
 *  - foto principal com no máximo 1280 px no lado maior (JPEG ~80%);
 *  - miniatura pequena (cabe numa célula da planilha: < 45.000 caracteres).
 */
(function () {
  'use strict';

  var LIMITE_MINI = 45000;

  function abrirImagem(arquivo) {
    if (window.createImageBitmap) {
      return createImageBitmap(arquivo, { imageOrientation: 'from-image' }).catch(function () {
        return abrirComImg(arquivo);
      });
    }
    return abrirComImg(arquivo);
  }

  function abrirComImg(arquivo) {
    return new Promise(function (ok, erro) {
      var url = URL.createObjectURL(arquivo);
      var img = new Image();
      img.onload = function () { ok(img); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); };
      img.onerror = function () { URL.revokeObjectURL(url); erro(new Error('Não consegui abrir essa imagem. Tente outra foto.')); };
      img.src = url;
    });
  }

  function desenhar(img, maxLado, qualidade) {
    var w = img.width, h = img.height;
    var escala = Math.min(1, maxLado / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * escala)), ch = Math.max(1, Math.round(h * escala));
    var canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // PNG com transparência não fica preto
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    return canvas.toDataURL('image/jpeg', qualidade);
  }

  function preparar(arquivo) {
    if (!arquivo || !/^image\//.test(arquivo.type || 'image/')) {
      return Promise.reject(new Error('Escolha um arquivo de imagem.'));
    }
    return abrirImagem(arquivo).then(function (img) {
      var foto = desenhar(img, 1280, 0.82);
      if (foto.length > 2500000) foto = desenhar(img, 1024, 0.7);
      var mini = '';
      var tentativas = [[360, 0.72], [320, 0.62], [280, 0.55], [240, 0.5], [200, 0.45], [160, 0.4]];
      for (var i = 0; i < tentativas.length; i++) {
        mini = desenhar(img, tentativas[i][0], tentativas[i][1]);
        if (mini.length <= LIMITE_MINI) break;
      }
      if (img.close) img.close();
      return { foto: foto, miniatura: mini.length <= LIMITE_MINI ? mini : null };
    });
  }

  window.Fotos = { preparar: preparar };
})();
