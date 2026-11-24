/*
 * Quadro do dia: um quadro branco compartilhado onde cada um desenha com a sua cor.
 *
 * Formato dos traços (o mesmo guardado na planilha):
 *   [espessura, x1, y1, x2, y2, ...]  com coordenadas de 0 a 1000 (proporção do quadro)
 * Assim o desenho fica igual em qualquer tamanho de tela.
 *
 * Quadro.svg(tracos, cores, rotulo)  ->  <svg> com o desenho (prévia e Memórias)
 * Quadro.abrir(opcoes)                ->  editor em tela cheia (veja os parâmetros em abrir)
 */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var ESPESSURAS = [{ w: 5, nome: 'Fina' }, { w: 11, nome: 'Média' }, { w: 24, nome: 'Grossa' }];
  var ESPERA_SALVAR_MS = 700;   // junta vários traços seguidos num salvamento só
  var BUSCAR_A_CADA_MS = 5000;  // traz os traços do outro enquanto o quadro está aberto
  var DIST_MIN = 3;             // ignora pontos muito próximos (deixa o traço mais leve)

  function el(tag, props) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    function anexar(f) {
      if (f === null || f === undefined) return;
      if (Array.isArray(f)) { f.forEach(anexar); return; }
      e.appendChild(f.nodeType ? f : document.createTextNode(String(f)));
    }
    for (var i = 2; i < arguments.length; i++) anexar(arguments[i]);
    return e;
  }

  function total(tracos) {
    return (tracos.ele || []).length + (tracos.ela || []).length;
  }

  /* Caminho suavizado (curvas pelos pontos médios) no formato do atributo "d" do SVG. */
  function caminho(t) {
    var n = (t.length - 1) / 2;
    if (n === 1) return 'M' + t[1] + ' ' + t[2] + 'l0 0';
    var d = 'M' + t[1] + ' ' + t[2];
    for (var i = 1; i < n - 1; i++) {
      var x = t[1 + 2 * i], y = t[2 + 2 * i];
      var mx = (x + t[3 + 2 * i]) / 2, my = (y + t[4 + 2 * i]) / 2;
      d += 'Q' + x + ' ' + y + ' ' + mx + ' ' + my;
    }
    return d + 'L' + t[t.length - 2] + ' ' + t[t.length - 1];
  }

  function svg(tracos, cores, rotulo) {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 1000 1000');
    s.setAttribute('class', 'quadro-svg');
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', rotulo || 'Desenho do quadro');
    ['ele', 'ela'].forEach(function (p) {
      (tracos[p] || []).forEach(function (t) {
        var path = document.createElementNS(NS, 'path');
        path.setAttribute('d', caminho(t));
        path.setAttribute('stroke', cores[p]);
        path.setAttribute('stroke-width', t[0]);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        s.appendChild(path);
      });
    });
    return s;
  }

  /* Desenha um traço no canvas (coordenadas 0-1000 convertidas pela escala "k"). */
  function desenharTraco(ctx, t, cor, k) {
    var n = (t.length - 1) / 2;
    ctx.strokeStyle = cor;
    ctx.fillStyle = cor;
    ctx.lineWidth = t[0] * k;
    if (n === 1) {
      ctx.beginPath();
      ctx.arc(t[1] * k, t[2] * k, t[0] * k / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(t[1] * k, t[2] * k);
    for (var i = 1; i < n - 1; i++) {
      var x = t[1 + 2 * i], y = t[2 + 2 * i];
      ctx.quadraticCurveTo(x * k, y * k, (x + t[3 + 2 * i]) / 2 * k, (y + t[4 + 2 * i]) / 2 * k);
    }
    ctx.lineTo(t[t.length - 2] * k, t[t.length - 1] * k);
    ctx.stroke();
  }

  var aberto = null;

  /**
   * opcoes:
   *   eu, outro        'ele' / 'ela'
   *   cores            { ele: '#...', ela: '#...' }
   *   tracos           { ele: [...], ela: [...] } do servidor
   *   salvar(lista)    Promise com { tracos: { ele, ela } } (grava só os traços de "eu")
   *   buscar()         Promise com { tracos: { ele, ela } }
   *   aoFechar(tracos) chamado ao fechar, com o estado final
   *   avisar(msg, tipo) mostra uma mensagem curta
   *   aoErro(erro)     devolve true se o editor deve fechar (ex.: o dia virou)
   */
  function abrir(o) {
    if (aberto) return;
    var meus = (o.tracos[o.eu] || []).map(function (t) { return t.slice(); });
    var outros = (o.tracos[o.outro] || []).map(function (t) { return t.slice(); });
    var espessura = ESPESSURAS[1].w;
    var atual = null;        // traço em andamento
    var ponteiro = null;     // id do dedo/caneta que está desenhando
    var sujo = false;        // há traços meus ainda não salvos
    var salvando = false;
    var timerSalvar = null, timerBuscar = null, timerLimpar = null;
    var tamanho = 0, k = 1, dpr = 1;

    var status = el('span', { class: 'quadro-status', 'aria-live': 'polite' }, 'Salvo');
    var canvas = el('canvas', { class: 'quadro-canvas', 'aria-label': 'Quadro para desenhar. Sua cor: ' + (o.eu === 'ele' ? 'menta' : 'pêssego') + '.' });
    var ctx = canvas.getContext('2d');
    var caixa = el('div', { class: 'quadro-caixa' }, canvas);

    var botoesEsp = ESPESSURAS.map(function (e) {
      var b = el('button', {
        class: 'quadro-esp', type: 'button', 'aria-label': 'Caneta ' + e.nome.toLowerCase(), title: e.nome,
        'aria-pressed': String(e.w === espessura),
        onclick: function () {
          espessura = e.w;
          botoesEsp.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        }
      }, el('span', { class: 'quadro-ponto', style: 'width:' + Math.max(6, e.w * 0.9) + 'px;height:' + Math.max(6, e.w * 0.9) + 'px' }));
      return b;
    });
    var desfazer = el('button', { class: 'botao pequeno leve', type: 'button', onclick: desfazerUltimo }, icone('desfazer'), 'Desfazer');
    var limpar = el('button', { class: 'botao pequeno leve', type: 'button', onclick: limparMeus }, icone('lixeira'), 'Limpar os meus');
    var fechar = el('button', { class: 'botao-icone', type: 'button', 'aria-label': 'Fechar o quadro', onclick: fecharQuadro }, icone('x'));

    var tela = el('div', { class: 'quadro-tela p-' + o.eu, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Quadro do dia' },
      el('div', { class: 'quadro-cab' },
        el('div', {}, el('h2', {}, 'Quadro de hoje'), status),
        fechar),
      caixa,
      el('div', { class: 'quadro-ferramentas' },
        el('div', { class: 'quadro-esps', role: 'group', 'aria-label': 'Espessura da caneta' }, botoesEsp),
        el('div', { class: 'quadro-acoes' }, desfazer, limpar)),
      el('p', { class: 'quadro-dica' }, 'Você desenha em ' + (o.eu === 'ele' ? 'menta' : 'pêssego') + '; os traços do Amor aparecem sozinhos em alguns segundos.'));

    function atualizarBotoes() {
      desfazer.disabled = !meus.length;
      limpar.disabled = !meus.length;
    }

    function medir() {
      var r = caixa.getBoundingClientRect();
      tamanho = Math.floor(Math.min(r.width, r.height));
      if (tamanho < 50) tamanho = Math.floor(r.width) || 300;
      dpr = window.devicePixelRatio || 1;
      canvas.style.width = tamanho + 'px';
      canvas.style.height = tamanho + 'px';
      canvas.width = Math.round(tamanho * dpr);
      canvas.height = Math.round(tamanho * dpr);
      k = tamanho * dpr / 1000;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      redesenhar();
    }

    function redesenhar() {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      outros.forEach(function (t) { desenharTraco(ctx, t, o.cores[o.outro], k); });
      meus.forEach(function (t) { desenharTraco(ctx, t, o.cores[o.eu], k); });
      if (atual) desenharTraco(ctx, atual, o.cores[o.eu], k);
    }

    function pontoDe(ev) {
      var r = canvas.getBoundingClientRect();
      var x = Math.round((ev.clientX - r.left) / r.width * 1000);
      var y = Math.round((ev.clientY - r.top) / r.height * 1000);
      return [Math.min(Math.max(x, 0), 1000), Math.min(Math.max(y, 0), 1000)];
    }

    canvas.addEventListener('pointerdown', function (ev) {
      if (ponteiro !== null || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      ev.preventDefault();
      ponteiro = ev.pointerId;
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* sem captura */ }
      var p = pontoDe(ev);
      atual = [espessura, p[0], p[1]];
      desenharTraco(ctx, atual, o.cores[o.eu], k);
    });

    canvas.addEventListener('pointermove', function (ev) {
      if (ev.pointerId !== ponteiro || !atual) return;
      ev.preventDefault();
      var eventos = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
      if (!eventos.length) eventos = [ev];
      var mudou = false;
      eventos.forEach(function (e2) {
        var p = pontoDe(e2);
        var lx = atual[atual.length - 2], ly = atual[atual.length - 1];
        if (Math.abs(p[0] - lx) + Math.abs(p[1] - ly) < DIST_MIN) return;
        // trecho novo: desenha só o pedaço para ficar leve no celular
        ctx.strokeStyle = o.cores[o.eu];
        ctx.lineWidth = atual[0] * k;
        ctx.beginPath();
        ctx.moveTo(lx * k, ly * k);
        ctx.lineTo(p[0] * k, p[1] * k);
        ctx.stroke();
        atual.push(p[0], p[1]);
        mudou = true;
      });
      return mudou;
    });

    function terminarTraco(ev) {
      if (ev.pointerId !== ponteiro) return;
      ponteiro = null;
      if (!atual) return;
      meus.push(atual);
      atual = null;
      redesenhar(); // refaz com as curvas suavizadas
      mudouMeus();
    }
    canvas.addEventListener('pointerup', terminarTraco);
    canvas.addEventListener('pointercancel', terminarTraco);

    function mudouMeus() {
      sujo = true;
      atualizarBotoes();
      status.textContent = 'Salvando...';
      clearTimeout(timerSalvar);
      timerSalvar = setTimeout(salvar, ESPERA_SALVAR_MS);
    }

    function desfazerUltimo() {
      if (!meus.length) return;
      meus.pop();
      redesenhar();
      mudouMeus();
    }

    function limparMeus() {
      if (!meus.length) return;
      if (!timerLimpar) {
        limpar.lastChild.textContent = 'Toque de novo';
        timerLimpar = setTimeout(function () { timerLimpar = null; limpar.lastChild.textContent = 'Limpar os meus'; }, 3000);
        return;
      }
      clearTimeout(timerLimpar);
      timerLimpar = null;
      limpar.lastChild.textContent = 'Limpar os meus';
      meus = [];
      redesenhar();
      mudouMeus();
    }

    function receber(q) {
      if (!q || !q.tracos) return;
      var novos = q.tracos[o.outro] || [];
      if (JSON.stringify(novos) !== JSON.stringify(outros)) {
        outros = novos;
        if (!atual) redesenhar();
      }
    }

    function salvar() {
      clearTimeout(timerSalvar);
      if (salvando || !sujo) return Promise.resolve();
      salvando = true;
      sujo = false;
      var enviados = meus.slice();
      return o.salvar(enviados).then(function (q) {
        salvando = false;
        receber(q);
        if (sujo) salvar();
        else if (aberto) status.textContent = 'Salvo';
      }, function (e) {
        salvando = false;
        sujo = true;
        if (o.aoErro && o.aoErro(e)) { fecharQuadro(true); return; }
        if (e && e.codigo === 'quadro_cheio') {
          // tira o último traço para caber e tenta de novo
          meus.pop();
          redesenhar();
          atualizarBotoes();
        }
        o.avisar(e && e.message ? e.message : 'Não consegui salvar o desenho.', 'erro');
        if (aberto) {
          status.textContent = 'Não salvou; tentando de novo...';
          timerSalvar = setTimeout(salvar, 3000);
        }
      });
    }

    function buscar() {
      if (!aberto || document.hidden || salvando || sujo || atual) return;
      o.buscar().then(receber, function () { /* tenta de novo na próxima */ });
    }

    function aoVoltar() {
      if (!document.hidden) buscar();
    }

    function aoTeclar(ev) {
      if (ev.key === 'Escape') { ev.stopPropagation(); fecharQuadro(); }
      else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); desfazerUltimo(); }
    }

    function fecharQuadro(semSalvar) {
      if (!aberto) return;
      aberto = null;
      clearInterval(timerBuscar);
      clearTimeout(timerLimpar);
      window.removeEventListener('resize', medir);
      document.removeEventListener('keydown', aoTeclar, true);
      document.removeEventListener('visibilitychange', aoVoltar);
      tela.remove();
      document.body.style.overflow = '';
      if (sujo && !semSalvar) {
        o.salvar(meus.slice()).catch(function (e) { o.avisar(e && e.message ? e.message : 'Não consegui salvar o desenho.', 'erro'); });
      }
      clearTimeout(timerSalvar);
      var final = {};
      final[o.eu] = meus;
      final[o.outro] = outros;
      o.aoFechar(final);
    }

    document.body.appendChild(tela);
    document.body.style.overflow = 'hidden';
    aberto = { fechar: fecharQuadro };
    atualizarBotoes();
    medir();
    window.addEventListener('resize', medir);
    document.addEventListener('keydown', aoTeclar, true);
    document.addEventListener('visibilitychange', aoVoltar);
    timerBuscar = setInterval(buscar, BUSCAR_A_CADA_MS);
    fechar.focus({ preventScroll: true });
    buscar();
  }

  window.Quadro = {
    svg: svg,
    abrir: abrir,
    total: total,
    aberto: function () { return !!aberto; }
  };
})();
