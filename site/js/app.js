/*
 * Nós dois — aplicação principal (JavaScript puro, sem framework).
 *
 * Organização:
 *  - S: estado da tela (o que veio do servidor + rascunhos e flags de interface)
 *  - h(): cria elementos HTML com segurança (texto sempre via textContent, nunca innerHTML)
 *  - render(): desenha a tela atual a partir de S
 *  - telaHoje / telaAmanha / telaMetas / telaProgresso / telaMemorias: uma função por aba
 *  - ações (marcar tarefa, +1 na meta...) atualizam a tela na hora e depois confirmam no servidor
 */
(function () {
  'use strict';

  var ABAS = [
    { id: 'hoje', rotulo: 'Hoje', icone: 'sol' },
    { id: 'amanha', rotulo: 'Amanhã', icone: 'lua' },
    { id: 'metas', rotulo: 'Metas', icone: 'alvo' },
    { id: 'progresso', rotulo: 'Progresso', icone: 'grafico' },
    { id: 'memorias', rotulo: 'Memórias', icone: 'imagem' }
  ];
  var CHAVE_ESTADO = 'nosdois.estado';

  var S = {
    estado: lerJson(CHAVE_ESTADO),
    aba: abaDaUrl(),
    progresso: null,
    progressoEm: 0,
    carregandoProgresso: false,
    erroProgresso: null,
    memorias: memoriasVazias(),
    fotos: {},
    baixandoFoto: {},
    atualizando: false,
    ultimaAtualizacao: 0,
    emVoo: 0,
    renderPendente: false,
    rascunhos: {},
    editando: null,
    cancelandoEdicao: false,
    focarChave: null,
    erroInicial: null,
    loginPessoa: null,
    loginErro: '',
    loginMsg: '',
    entrando: false
  };

  var raiz = document.getElementById('app');
  var casca = null;
  var modalAtual = null;
  var visorAtual = null;

  /* =====================================================================
   * Utilidades
   * ===================================================================== */

  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.setAttribute('style', v);
        else if (k === 'value') el.value = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) anexar(el, arguments[i]);
    return el;
  }

  function anexar(el, f) {
    if (f === null || f === undefined || f === false) return;
    if (Array.isArray(f)) { f.forEach(function (x) { anexar(el, x); }); return; }
    el.appendChild(f.nodeType ? f : document.createTextNode(String(f)));
  }

  function nada() {}

  function lerJson(chave) {
    try { return JSON.parse(localStorage.getItem(chave) || 'null'); } catch (e) { return null; }
  }

  function salvarJson(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* cheio ou modo privado */ }
  }

  function memoriasVazias() {
    return { dias: [], temMais: true, carregando: false, iniciado: false, erro: null };
  }

  function abaDaUrl() {
    var a = (location.hash || '').replace('#', '');
    return ABAS.some(function (x) { return x.id === a; }) ? a : 'hoje';
  }

  function eu() { return API.sessao ? API.sessao.pessoa : 'ele'; }
  function amor() { return eu() === 'ele' ? 'ela' : 'ele'; }
  function nome(p) { return p === eu() ? 'Eu' : 'Amor'; }
  function osDois() { return [eu(), amor()]; }

  var coresCache = {};
  function corDe(p, variante) {
    var nomeVar = '--' + p + (variante ? '-' + variante : '');
    if (!coresCache[nomeVar]) coresCache[nomeVar] = getComputedStyle(document.documentElement).getPropertyValue(nomeVar).trim();
    return coresCache[nomeVar];
  }

  function fmt(n, casas) {
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: casas || 0 }).format(n || 0);
  }

  function dataBr(iso, opcoes) {
    var p = iso.split('-').map(Number);
    return new Intl.DateTimeFormat('pt-BR', Object.assign({ timeZone: 'UTC' }, opcoes)).format(new Date(Date.UTC(p[0], p[1] - 1, p[2])));
  }

  function dataCurta(iso) { return dataBr(iso, { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  function diaMes(iso) { return dataBr(iso, { day: '2-digit', month: '2-digit' }); }

  function diasEntre(a, b) {
    var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }

  function quandoFoi(iso) {
    var n = diasEntre(iso, S.estado.hoje);
    if (n === 0) return 'hoje';
    if (n === 1) return 'ontem';
    if (n < 7) return 'há ' + n + ' dias';
    return 'em ' + diaMes(iso);
  }

  function saudacao() {
    var hora = new Date().getHours();
    if (hora < 5) return 'Boa noite';
    if (hora < 12) return 'Bom dia';
    if (hora < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  function valorComUnidade(v, unidade) {
    var casas = Math.abs(v % 1) > 0 ? 1 : 0;
    if (!unidade) return fmt(v, casas);
    if (unidade === 'R$') {
      return 'R$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas ? 2 : 0, maximumFractionDigits: 2 }).format(v);
    }
    return fmt(v, casas) + ' ' + unidade;
  }

  function toast(msg, tipo) {
    var area = document.getElementById('toasts');
    var t = h('div', { class: 'toast' + (tipo ? ' ' + tipo : ''), role: tipo === 'erro' ? 'alert' : 'status' }, msg);
    area.appendChild(t);
    setTimeout(function () { t.remove(); }, tipo === 'erro' ? 4500 : 2600);
  }

  function ocupado(botao, sim, texto) {
    if (!botao) return;
    if (sim) {
      botao.dataset.textoOriginal = botao.textContent;
      botao.disabled = true;
      botao.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), texto || 'Salvando...');
    } else {
      botao.disabled = false;
      botao.replaceChildren(botao.dataset.textoOriginal || 'Salvar');
    }
  }

  function campoTexto(chave, props) {
    var tag = props && props.multilinha ? 'textarea' : 'input';
    var p = Object.assign({ 'data-chave': chave }, props || {});
    delete p.multilinha;
    if (tag === 'input' && !p.type) p.type = 'text';
    var el = h(tag, p);
    el.value = S.rascunhos[chave] || '';
    el.addEventListener('input', function () { S.rascunhos[chave] = el.value; });
    return el;
  }

  function tituloCartao(nomeIcone, texto, extra) {
    return h('h2', { class: 'cartao-titulo' }, icone(nomeIcone), texto, extra ? h('span', { class: 'extra' }, extra) : null);
  }

  function cabPessoa(p, info) {
    return h('div', { class: 'pessoa-cab' }, h('span', { class: 'bolinha' }), h('span', { class: 'pessoa-nome' }, nome(p)),
      info ? h('span', { class: 'pessoa-info' }, info) : null);
  }

  function miniBotao(nomeIcone, rotulo, acao) {
    return h('button', { class: 'mini-botao', type: 'button', 'aria-label': rotulo, title: rotulo, onclick: acao }, icone(nomeIcone));
  }

  function esqueleto(altura, classe) {
    return h('div', { class: 'esqueleto ' + (classe || ''), style: 'height:' + altura + 'px', 'aria-hidden': 'true' });
  }

  /* =====================================================================
   * Comunicação com o servidor
   * ===================================================================== */

  function podeRenderizarAgora() {
    var a = document.activeElement;
    var digitando = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && casca && casca.main.contains(a) && a.value;
    return !modalAtual && !visorAtual && !Quadro.aberto() && !digitando && !S.editando;
  }

  function aplicarEstado(novo, forcar) {
    if (!novo) return;
    if (S.estado && novo.hoje !== S.estado.hoje) {
      S.progresso = null;
      S.memorias = memoriasVazias();
    }
    S.estado = novo;
    S.ultimaAtualizacao = Date.now();
    salvarJson(CHAVE_ESTADO, novo);
    if (forcar || podeRenderizarAgora()) {
      S.renderPendente = false;
      render();
    } else {
      S.renderPendente = true;
    }
  }

  /** Executa uma ação de escrita. A tela já foi atualizada antes (otimista); aqui confirmamos com o servidor. */
  function executar(acao, dados, opcoes) {
    opcoes = opcoes || {};
    S.emVoo++;
    marcarAtualizando();
    return API.chamar(acao, dados).then(function (r) {
      S.emVoo--;
      marcarAtualizando();
      if (r.estado && S.emVoo === 0) aplicarEstado(r.estado, opcoes.forcar);
      S.progresso = null;
      return r;
    }, function (e) {
      S.emVoo--;
      marcarAtualizando();
      if (e.codigo !== 'sessao') toast(e.message, 'erro');
      if (opcoes.reverter) opcoes.reverter();
      if (S.emVoo === 0 && e.codigo !== 'sessao') atualizar(true);
      throw e;
    });
  }

  function atualizar(silencioso) {
    if (S.atualizando || !API.sessao || !API.configurada()) return Promise.resolve();
    S.atualizando = true;
    marcarAtualizando();
    return API.chamar('estado').then(function (r) {
      S.erroInicial = null;
      if (S.emVoo === 0) aplicarEstado(r.estado, !casca);
    }).catch(function (e) {
      if (e.codigo === 'sessao') return;
      if (!S.estado) {
        S.erroInicial = e.message;
        render();
      } else if (!silencioso) {
        toast(e.message, 'erro');
      }
    }).then(function () {
      S.atualizando = false;
      marcarAtualizando();
    });
  }

  function marcarAtualizando() {
    var b = document.getElementById('botao-atualizar');
    if (b) b.classList.toggle('girando', S.atualizando || S.emVoo > 0);
  }

  function baixarFoto(id) {
    if (!id || S.fotos[id] || S.baixandoFoto[id]) return Promise.resolve(S.fotos[id]);
    S.baixandoFoto[id] = API.chamar('foto', { id: id }).then(function (r) {
      S.fotos[id] = r.foto;
      document.querySelectorAll('img[data-foto="' + id + '"]').forEach(function (img) { img.src = r.foto; });
      return r.foto;
    }).catch(function () { return null; }).then(function (f) {
      delete S.baixandoFoto[id];
      return f;
    });
    return S.baixandoFoto[id];
  }

  /* =====================================================================
   * Render principal
   * ===================================================================== */

  function render() {
    if (!API.configurada()) return renderMensagem('Quase lá', 'Este site ainda não foi ligado à planilha. Rode o script ferramentas/implantar.ps1 para publicar a API e preencher o endereço.');
    if (!API.sessao) {
      casca = null;
      return renderLogin();
    }
    if (!S.estado) {
      casca = null;
      if (S.erroInicial) return renderMensagem('Não consegui carregar', S.erroInicial, 'Tentar de novo', function () { S.erroInicial = null; render(); atualizar(false); });
      return renderCarregando();
    }
    renderApp();
  }

  function renderMensagem(titulo, texto, botao, acao) {
    document.body.className = API.sessao ? 'p-' + eu() : '';
    raiz.replaceChildren(h('div', { class: 'tela-centro' }, h('div', { class: 'caixa-msg' },
      h('img', { class: 'login-logo', src: 'icones/icone-192.png', alt: '' }),
      h('h1', { class: 'login-titulo', style: 'font-size:24px' }, titulo),
      h('p', { style: 'color:var(--texto-2);font-weight:600' }, texto),
      botao ? h('button', { class: 'botao', onclick: acao }, botao) : null,
      API.sessao ? h('button', { class: 'botao leve pequeno', onclick: sair }, 'Sair') : null)));
  }

  function renderCarregando() {
    document.body.className = 'p-' + eu();
    raiz.replaceChildren(h('div', { 'aria-busy': 'true' },
      h('header', { class: 'topo' }, h('div', { class: 'topo-dentro' }, h('div', { class: 'topo-textos' },
        h('h1', { class: 'saudacao' }, saudacao()), h('p', { class: 'data-hoje' }, 'carregando...')))),
      h('main', {}, esqueleto(300), esqueleto(240), esqueleto(200))));
    atualizar(true);
  }

  function montarCasca() {
    var botaoAtualizar = h('button', { class: 'botao-icone', id: 'botao-atualizar', type: 'button', 'aria-label': 'Atualizar agora', title: 'Atualizar agora', onclick: function () { atualizar(false); } }, icone('atualizar'));
    var botaoMenu = h('button', { class: 'botao-avatar', id: 'botao-menu', type: 'button', 'aria-label': 'Abrir menu', onclick: abrirMenu }, 'Eu');
    var topo = h('header', { class: 'topo' }, h('div', { class: 'topo-dentro' },
      h('div', { class: 'topo-textos' }, h('h1', { class: 'saudacao', id: 'saudacao' }), h('p', { class: 'data-hoje', id: 'data-hoje' })),
      botaoAtualizar, botaoMenu));
    var main = h('main', { id: 'conteudo' });
    var nav = h('nav', { class: 'abas', 'aria-label': 'Seções' }, h('div', { class: 'abas-dentro' }, ABAS.map(function (a) {
      return h('button', { class: 'aba', type: 'button', 'data-aba': a.id, onclick: function () { irPara(a.id); } }, icone(a.icone), a.rotulo);
    })));
    raiz.replaceChildren(topo, main, nav);
    casca = { topo: topo, main: main, nav: nav };
  }

  function renderApp() {
    S.renderPendente = false;
    document.body.className = 'p-' + eu();
    if (!casca) montarCasca();
    var sauda = document.getElementById('saudacao');
    sauda.replaceChildren(saudacao(), icone('coracao', 'cheio'));
    document.getElementById('data-hoje').textContent = dataBr(S.estado.hoje, { weekday: 'long', day: 'numeric', month: 'long' });
    casca.nav.querySelectorAll('.aba').forEach(function (b) {
      if (b.dataset.aba === S.aba) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    marcarAtualizando();

    var foco = capturarFoco();
    var conteudo = TELAS[S.aba]();
    casca.main.replaceChildren();
    anexar(casca.main, conteudo);
    restaurarFoco(foco);
  }

  function capturarFoco() {
    if (S.focarChave) {
      var c = S.focarChave;
      S.focarChave = null;
      return { chave: c, fim: true };
    }
    var a = document.activeElement;
    if (!a || !a.dataset || !a.dataset.chave) return null;
    return { chave: a.dataset.chave, ini: a.selectionStart, fim: a.selectionEnd };
  }

  function restaurarFoco(f) {
    if (!f) return;
    var el = casca.main.querySelector('[data-chave="' + CSS.escape(f.chave) + '"]');
    if (!el) return;
    el.focus({ preventScroll: true });
    try {
      if (f.fim === true) el.setSelectionRange(el.value.length, el.value.length);
      else el.setSelectionRange(f.ini, f.fim);
    } catch (e) { /* campo sem seleção */ }
  }

  function irPara(aba) {
    if (location.hash !== '#' + aba) location.hash = aba;
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  var TELAS = {
    hoje: telaHoje,
    amanha: telaAmanha,
    metas: telaMetas,
    progresso: telaProgresso,
    memorias: telaMemorias
  };

  /* =====================================================================
   * Tela: Hoje
   * ===================================================================== */

  function telaHoje() {
    var e = S.estado;
    return [
      cartaoQuadro(e),
      cartaoTarefas({ titulo: 'Tarefas de hoje', icone: 'check', data: e.hoje, listas: e.tarefas.hoje, chave: 'hoje' }),
      cartaoPendentes(e),
      cartaoDieta(e),
      cartaoMetasSemana(e),
      cartaoRemedio(e)
    ];
  }

  /* ---------- Quadro do dia ---------- */

  function tracosDoDia(e) {
    return e.quadro || { ele: [], ela: [] };
  }

  function coresCaneta() {
    return { ele: corDe('ele', 'caneta'), ela: corDe('ela', 'caneta') };
  }

  function cartaoQuadro(e) {
    var tracos = tracosDoDia(e);
    var vazio = !Quadro.total(tracos);
    var info = osDois().map(function (p) {
      var n = (tracos[p] || []).length;
      return h('span', { class: 'p-' + p }, h('span', { class: 'bolinha' }), nome(p) + (n ? ': ' + n + (n === 1 ? ' traço' : ' traços') : ': ainda não desenhou'));
    });
    return h('section', { class: 'cartao' },
      tituloCartao('lapis', 'Quadro do dia'),
      h('button', { class: 'quadro-previa', type: 'button', 'aria-label': vazio ? 'Abrir o quadro para desenhar' : 'Abrir o quadro do dia', onclick: abrirQuadro },
        Quadro.svg(tracos, coresCaneta(), 'Desenho de hoje'),
        vazio ? h('span', { class: 'quadro-vazio' }, icone('lapis'), 'Toque para desenhar') : null),
      h('div', { class: 'legenda quadro-legenda' }, info),
      h('button', { class: 'botao pequeno', type: 'button', onclick: abrirQuadro }, icone('lapis'), vazio ? 'Desenhar' : 'Abrir o quadro'));
  }

  function abrirQuadro() {
    var e = S.estado;
    var dia = e.hoje;
    Quadro.abrir({
      eu: eu(), outro: amor(), cores: coresCaneta(), tracos: tracosDoDia(e),
      salvar: function (lista) {
        S.emVoo++;
        marcarAtualizando();
        return API.chamar('salvarQuadro', { data: dia, tracos: lista }).then(function (r) {
          S.emVoo--;
          marcarAtualizando();
          if (S.estado && S.estado.hoje === dia) S.estado.quadro = r.quadro.tracos;
          S.progresso = null;
          return r.quadro;
        }, function (err) {
          S.emVoo--;
          marcarAtualizando();
          throw err;
        });
      },
      buscar: function () { return API.chamar('quadro').then(function (r) { return r.quadro.data === dia ? r.quadro : null; }); },
      avisar: toast,
      aoErro: function (err) {
        if (err && err.codigo === 'dia_virou') { atualizar(true); return true; }
        return err && err.codigo === 'sessao';
      },
      aoFechar: function (final) {
        if (S.estado && S.estado.hoje === dia) {
          S.estado.quadro = final;
          salvarJson(CHAVE_ESTADO, S.estado);
        }
        S.renderPendente = false;
        render();
      }
    });
  }

  /* Momento antigo (foto + recado, usado até virar quadro): aparece só nas Memórias. */
  function blocoMomento(p, m) {
    var etiqueta = h('span', { class: 'etiqueta' }, h('span', { class: 'bolinha' }), nome(p));
    var foto;
    if (m && m.fotoId) {
      var src = S.fotos[m.fotoId] || m.miniatura;
      foto = h('button', { class: 'momento-foto', type: 'button', 'aria-label': 'Ver foto de ' + nome(p), onclick: function () { abrirVisor(m, p); } },
        src ? h('img', { src: src, alt: 'Foto de ' + nome(p), 'data-foto': m.fotoId }) : icone('imagem'), etiqueta);
    } else {
      foto = h('div', { class: 'momento-foto' }, h('div', {}, icone('coracao'), h('p', { class: 'momento-vazio-txt' }, 'Sem foto neste dia')), etiqueta);
    }
    var recado = m && m.recado ? h('p', { class: 'balao' }, m.recado) : h('p', { class: 'balao vazio-balao' }, 'Sem recado');
    return h('div', { class: 'momento mini p-' + p }, foto, recado);
  }

  function cartaoTarefas(o) {
    return h('section', { class: 'cartao' + (o.largo ? ' largo' : '') },
      tituloCartao(o.icone, o.titulo, o.extra),
      o.subtitulo ? h('p', { class: 'subtitulo' }, o.subtitulo) : null,
      h('div', { class: 'pessoas' + (o.largo ? ' lado-a-lado' : '') }, osDois().map(function (p) {
        return listaPessoa(p, o.listas[p] || [], o.data, o.chave);
      })));
  }

  function listaPessoa(p, tarefas, data, chaveLista) {
    var meu = p === eu();
    var feitas = tarefas.filter(function (t) { return t.feita; }).length;
    var total = tarefas.length;
    var planejando = chaveLista === 'amanha';
    var info = !total ? '' : planejando ? (total === 1 ? '1 tarefa' : total + ' tarefas')
      : (feitas === total ? 'tudo feito' : feitas + ' de ' + total);
    return h('div', { class: 'p-' + p },
      cabPessoa(p, info),
      total && !planejando ? h('div', { class: 'barra' }, h('span', { style: 'width:' + Math.round(100 * feitas / total) + '%' })) : null,
      total
        ? h('ul', { class: 'lista', style: 'margin-top:8px' }, tarefas.map(function (t) { return meu ? itemTarefaMinha(t) : itemTarefaAmor(t); }))
        : h('p', { class: 'vazio' }, meu ? 'Nenhuma tarefa ainda.' : 'Amor ainda não colocou tarefas aqui.'),
      meu ? formNovaTarefa(data, chaveLista) : null);
  }

  function itemTarefaMinha(t) {
    var chaveEd = 'editar-' + t.id;
    if (S.editando === t.id) {
      var campo = campoTexto(chaveEd, {
        class: 'campo campo-edicao', maxlength: 200, 'aria-label': 'Editar tarefa', enterkeyhint: 'done',
        onkeydown: function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); campo.blur(); }
          if (ev.key === 'Escape') { S.cancelandoEdicao = true; campo.blur(); }
        },
        onblur: function () {
          if (S.cancelandoEdicao) { S.cancelandoEdicao = false; S.editando = null; render(); return; }
          salvarEdicao(t);
        }
      });
      return h('li', { class: 'item' }, campo);
    }
    var temp = !t.id || String(t.id).indexOf('tmp_') === 0;
    return h('li', { class: 'item' + (t.feita ? ' feita' : '') + (temp ? ' temp' : '') },
      h('button', {
        class: 'caixa', type: 'button', role: 'checkbox', 'aria-checked': String(!!t.feita),
        'aria-label': (t.feita ? 'Desmarcar: ' : 'Marcar como feita: ') + t.texto,
        onclick: temp ? null : function () { marcarTarefa(t); }, disabled: temp
      }, icone('check')),
      h('span', { class: 'item-texto' }, t.texto),
      temp ? h('span', { class: 'spinner', style: 'color:var(--texto-3)', 'aria-label': 'Salvando' }) : h('span', { class: 'item-acoes' },
        miniBotao('lapis', 'Editar tarefa', function () {
          S.editando = t.id;
          S.rascunhos[chaveEd] = t.texto;
          S.focarChave = chaveEd;
          render();
        }),
        miniBotao('lixeira', 'Apagar tarefa', function () { excluirTarefa(t); })));
  }

  function itemTarefaAmor(t) {
    return h('li', { class: 'item' + (t.feita ? ' feita' : '') },
      h('span', { class: 'caixa so-leitura', role: 'img', 'aria-checked': String(!!t.feita), 'aria-label': t.feita ? 'Feita' : 'Pendente' }, icone('check')),
      h('span', { class: 'item-texto' }, t.texto));
  }

  function formNovaTarefa(data, chaveLista) {
    var chave = 'nova-' + chaveLista;
    var campo = campoTexto(chave, {
      class: 'campo', maxlength: 200, enterkeyhint: 'send', autocomplete: 'off',
      placeholder: chaveLista === 'amanha' ? 'O que fazer amanhã?' : 'Nova tarefa', 'aria-label': 'Nova tarefa'
    });
    return h('form', { class: 'form-linha', onsubmit: function (ev) { ev.preventDefault(); adicionarTarefa(data, chave); } },
      campo, h('button', { class: 'botao botao-add', type: 'submit', 'aria-label': 'Adicionar tarefa' }, icone('mais')));
  }

  function listaDoDia(data) {
    var e = S.estado;
    if (data === e.hoje) return e.tarefas.hoje;
    if (data === e.amanha) return e.tarefas.amanha;
    return null;
  }

  function adicionarTarefa(data, chave) {
    var texto = (S.rascunhos[chave] || '').replace(/\s+/g, ' ').trim();
    if (!texto) return;
    var lista = listaDoDia(data);
    if (!lista) return;
    S.rascunhos[chave] = '';
    var temp = { id: 'tmp_' + Date.now() + Math.random().toString(36).slice(2, 6), pessoa: eu(), data: data, texto: texto, feita: false };
    lista[eu()].push(temp);
    S.focarChave = chave;
    render();
    executar('addTarefa', { data: data, texto: texto }, {
      reverter: function () {
        var l = listaDoDia(data);
        if (l) l[eu()] = l[eu()].filter(function (x) { return x !== temp; });
        S.rascunhos[chave] = texto;
        render();
      }
    }).catch(nada);
  }

  function marcarTarefa(t) {
    var novo = !t.feita;
    t.feita = novo;
    render();
    if (novo) {
      var lista = S.estado.tarefas.hoje[eu()];
      if (t.data === S.estado.hoje && lista.length > 1 && lista.every(function (x) { return x.feita; })) toast('Tudo feito hoje! Que orgulho.');
    }
    executar('marcarTarefa', { id: t.id, feita: novo }, { reverter: function () { t.feita = !novo; render(); } }).catch(nada);
  }

  function salvarEdicao(t) {
    var texto = (S.rascunhos['editar-' + t.id] || '').replace(/\s+/g, ' ').trim();
    S.editando = null;
    if (!texto || texto === t.texto) { render(); return; }
    var antigo = t.texto;
    t.texto = texto;
    render();
    executar('editarTarefa', { id: t.id, texto: texto }, { reverter: function () { t.texto = antigo; render(); } }).catch(nada);
  }

  function excluirTarefa(t) {
    var lista = listaDoDia(t.data);
    if (!lista) return;
    var antes = lista[eu()].slice();
    lista[eu()] = lista[eu()].filter(function (x) { return x !== t; });
    render();
    toast('Tarefa apagada');
    executar('excluirTarefa', { id: t.id }, { reverter: function () { lista[eu()] = antes; render(); } }).catch(nada);
  }

  function cartaoPendentes(e) {
    var lista = e.tarefas.pendentes[eu()] || [];
    if (!lista.length) return null;
    return h('section', { class: 'cartao largo p-' + eu() },
      tituloCartao('desfazer', 'Ficou pendente'),
      h('p', { class: 'subtitulo' }, 'Tarefas dos últimos dias que não foram feitas.'),
      h('ul', { class: 'lista' }, lista.map(function (t) {
        return h('li', { class: 'item' },
          h('span', { class: 'item-texto' }, t.texto, h('span', { class: 'item-data' }, quandoFoi(t.data))),
          h('button', { class: 'botao pequeno', type: 'button', onclick: function () { trazerTarefa(t); } }, icone('seta'), 'Para hoje'),
          miniBotao('x', 'Deixar pra lá', function () { descartarPendente(t); }));
      })));
  }

  function tirarDePendentes(t) {
    var pend = S.estado.tarefas.pendentes;
    var antes = pend[eu()].slice();
    pend[eu()] = pend[eu()].filter(function (x) { return x !== t; });
    return function () { pend[eu()] = antes; };
  }

  function trazerTarefa(t) {
    var voltar = tirarDePendentes(t);
    var hoje = S.estado.tarefas.hoje[eu()];
    var temp = { id: 'tmp_' + Date.now(), pessoa: eu(), data: S.estado.hoje, texto: t.texto, feita: false };
    hoje.push(temp);
    render();
    executar('trazerTarefa', { id: t.id }, {
      reverter: function () {
        voltar();
        S.estado.tarefas.hoje[eu()] = S.estado.tarefas.hoje[eu()].filter(function (x) { return x !== temp; });
        render();
      }
    }).catch(nada);
  }

  function descartarPendente(t) {
    var voltar = tirarDePendentes(t);
    render();
    executar('descartarPendente', { id: t.id }, { reverter: function () { voltar(); render(); } }).catch(nada);
  }

  /* ---------- Dieta ---------- */

  /* Dia que o cartão da dieta está mostrando (hoje, se nada foi escolhido ou o dia saiu da janela). */
  function diaDieta(e) {
    var d = S.diaDieta;
    return d && d < e.hoje && e.dietaDias && e.dietaDias[d] ? d : e.hoje;
  }

  function rotuloDia(d, e) {
    var n = diasEntre(d, e.hoje);
    if (n === 0) return 'Hoje';
    if (n === 1) return 'Ontem';
    return dataBr(d, { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '');
  }

  function cartaoDieta(e) {
    var dia = diaDieta(e);
    var ehHoje = dia === e.hoje;
    var dd = ehHoje ? e.dieta : e.dietaDias[dia];
    var dias = e.dietaDias ? Object.keys(e.dietaDias).sort() : [e.hoje];
    var i = dias.indexOf(dia);
    function ir(novo) { S.diaDieta = novo; render(); }
    var nav = h('span', { class: 'nav-dia' },
      h('button', { class: 'botao-icone', type: 'button', 'aria-label': 'Dia anterior', disabled: i <= 0, onclick: function () { ir(dias[i - 1]); } }, icone('seta_esq')),
      h('span', { class: 'nav-dia-rotulo', 'aria-live': 'polite' }, rotuloDia(dia, e)),
      h('button', { class: 'botao-icone', type: 'button', 'aria-label': 'Próximo dia', disabled: ehHoje, onclick: function () { ir(dias[i + 1]); } }, icone('seta_dir')));
    var algo = osDois().some(function (p) { return dd[p].itens.length || e.pessoas[p].metaKcal; });
    return h('section', { class: 'cartao' },
      tituloCartao('prato', 'Dieta', nav),
      h('div', { class: 'duas-colunas' }, osDois().map(function (p) { return blocoDieta(p, e, dd[p], ehHoje); })),
      detalheRefeicoes(dd),
      algo || !ehHoje ? null : h('p', { class: 'dica', style: 'margin-top:14px' }, icone('recado'),
        'A dieta é registrada pelo Claude: é só contar a ele o que vocês comeram e ele anota na planilha.'));
  }

  function blocoDieta(p, e, d, ehHoje) {
    var pes = e.pessoas[p];
    var kcal = Math.round(d.totais.kcal);
    var meta = pes.metaKcal;
    var resto = null;
    if (meta) {
      var dif = Math.round(meta - kcal);
      if (ehHoje) resto = dif >= 0 ? 'faltam ' + fmt(dif) + ' kcal' : fmt(-dif) + ' kcal acima';
      else if (!d.itens.length) resto = 'nada registrado';
      else resto = dif >= 0 ? fmt(dif) + ' kcal abaixo da meta' : fmt(-dif) + ' kcal acima da meta';
    }
    var macros = [['Proteína', d.totais.proteina, pes.metaProteina], ['Carbo', d.totais.carbo, pes.metaCarbo], ['Gordura', d.totais.gordura, pes.metaGordura]];
    return h('div', { class: 'dieta-pessoa p-' + p },
      cabPessoa(p),
      Graficos.anel({
        valor: kcal, meta: meta, cor: corDe(p), fundo: corDe(p, 'claro'), texto: fmt(kcal),
        subtexto: meta ? 'de ' + fmt(meta) + ' kcal' : 'kcal', rotulo: nome(p) + ': ' + fmt(kcal) + ' kcal' + (meta ? ' de ' + fmt(meta) : '')
      }),
      resto ? h('p', { class: 'peso-linha' }, resto) : (meta ? null : h('p', { class: 'peso-linha' }, 'sem meta definida')),
      h('div', { class: 'macros' }, macros.map(function (m) {
        var pct = m[2] ? Math.min(100, Math.round(100 * m[1] / m[2])) : (m[1] > 0 ? 100 : 0);
        return h('div', {},
          h('div', { class: 'macro-cab' }, h('span', {}, m[0]), h('b', {}, fmt(m[1]) + (m[2] ? ' / ' + fmt(m[2]) : '') + ' g')),
          h('div', { class: 'barra' }, h('span', { style: 'width:' + pct + '%' })));
      })),
      ehHoje && e.peso[p] ? h('p', { class: 'peso-linha' }, icone('balanca'), fmt(e.peso[p].kg, 1) + ' kg',
        h('span', { style: 'color:var(--texto-3)' }, '· ' + quandoFoi(e.peso[p].data))) : null);
  }

  function detalheRefeicoes(dd) {
    var total = osDois().reduce(function (s, p) { return s + dd[p].itens.length; }, 0);
    if (!total) return null;
    return h('details', { class: 'refeicoes', open: !!S.refeicoesAbertas, ontoggle: function (ev) { S.refeicoesAbertas = ev.target.open; } },
      h('summary', {}, 'Ver refeições (' + total + ')', icone('seta_baixo')),
      osDois().map(function (p) {
        var itens = dd[p].itens;
        if (!itens.length) return null;
        return h('div', { class: 'p-' + p, style: 'margin-top:10px' }, cabPessoa(p),
          itens.map(function (it) {
            var desc = [it.alimento, it.quantidade ? '(' + it.quantidade + ')' : ''].filter(Boolean).join(' ');
            return h('div', { class: 'refeicao' },
              h('div', { class: 'refeicao-cab' }, it.refeicao || 'Refeição', h('span', {}, fmt(it.kcal) + ' kcal')),
              desc ? h('p', {}, desc) : null,
              it.obs ? h('p', { style: 'font-style:italic' }, it.obs) : null);
          }));
      }));
  }

  /* ---------- Metas da semana ---------- */

  function periodoSemana(e) {
    var ini = e.semana.inicio, fim = e.semana.fim;
    if (ini.slice(5, 7) === fim.slice(5, 7)) return ini.slice(8) + ' a ' + diaMes(fim);
    return diaMes(ini) + ' a ' + diaMes(fim);
  }

  function cartaoMetasSemana(e) {
    return h('section', { class: 'cartao' },
      tituloCartao('calendario', 'Metas da semana', periodoSemana(e)),
      h('div', { class: 'pessoas' }, osDois().map(function (p) {
        var metas = e.metasSemana[p];
        var meu = p === eu();
        return h('div', { class: 'p-' + p }, cabPessoa(p),
          metas.length ? metas.map(function (m) { return itemMetaSemana(m, p, false); })
            : h('p', { class: 'vazio' }, meu ? 'Você ainda não tem metas da semana.' : 'Amor ainda não tem metas da semana.'),
          meu && !metas.length ? h('button', { class: 'botao pequeno', type: 'button', onclick: function () { irPara('metas'); } }, icone('mais'), 'Criar meta') : null);
      })));
  }

  function itemMetaSemana(m, p, completo) {
    var meu = p === eu();
    var ok = m.feitas >= m.vezes;
    var pontos = [];
    for (var i = 0; i < Math.max(m.vezes, m.feitas); i++) {
      pontos.push(h('span', { class: 'ponto' + (i < m.feitas ? (i >= m.vezes ? ' extra' : ' cheio') : '') }));
    }
    return h('div', { class: 'meta' },
      h('div', { class: 'meta-linha' },
        h('span', { class: 'meta-titulo' }, m.titulo),
        h('span', { class: 'meta-conta' + (ok ? ' cumprida' : '') }, ok ? icone('check') : null, m.feitas + '/' + m.vezes),
        meu && m.feitas > 0 ? miniBotao('desfazer', 'Desfazer uma vez', function () { marcarMeta(m, -1); }) : null,
        meu && completo ? miniBotao('lapis', 'Editar meta', function () { editarMetaSemana(m); }) : null,
        meu ? h('button', { class: 'botao-mais', type: 'button', 'aria-label': 'Mais uma vez: ' + m.titulo, onclick: function () { marcarMeta(m, 1); } }, '+1') : null),
      h('div', { class: 'pontos', 'aria-hidden': 'true' }, pontos));
  }

  function marcarMeta(m, delta) {
    m.feitas = Math.max(0, m.feitas + delta);
    render();
    if (delta > 0 && m.feitas === m.vezes) toast('Meta da semana cumprida: ' + m.titulo);
    executar('marcarMetaSemana', { id: m.id, delta: delta }, { reverter: function () { m.feitas = Math.max(0, m.feitas - delta); render(); } }).catch(nada);
  }

  /* ---------- Anticoncepcional (calendário do mês) ---------- */

  var MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  var MESES_ATRAS = 12; // quantos meses para trás dá para navegar

  /* Soma n meses a "aaaa-mm". */
  function somarMes(mes, n) {
    var p = mes.split('-').map(Number);
    var t = p[0] * 12 + (p[1] - 1) + n;
    return Math.floor(t / 12) + '-' + ('0' + (t % 12 + 1)).slice(-2);
  }

  function horaAgora() {
    var d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  /* Hora sugerida para um dia passado: a da marcação mais recente (o remédio costuma ser no mesmo horário). */
  function horaHabitual(rem) {
    var dias = Object.keys(rem).sort();
    return dias.length ? rem[dias[dias.length - 1]].hora : '21:00';
  }

  function cartaoRemedio(e) {
    var rem = e.remedio || {};
    var mesHoje = e.hoje.slice(0, 7);
    var limite = somarMes(mesHoje, -MESES_ATRAS);
    var mes = S.mesRemedio && S.mesRemedio < mesHoje && S.mesRemedio >= limite ? S.mesRemedio : mesHoje;
    function ir(n) { S.mesRemedio = somarMes(mes, n); render(); }
    var p = mes.split('-').map(Number);
    var nomeMes = MESES[p[1] - 1] + (p[0] !== Number(e.hoje.slice(0, 4)) ? ' ' + p[0] : '');
    var nav = h('div', { class: 'nav-dia cal-cab' },
      h('button', { class: 'botao-icone', type: 'button', 'aria-label': 'Mês anterior', disabled: mes <= limite, onclick: function () { ir(-1); } }, icone('seta_esq')),
      h('span', { class: 'nav-dia-rotulo', 'aria-live': 'polite' }, nomeMes),
      h('button', { class: 'botao-icone', type: 'button', 'aria-label': 'Próximo mês', disabled: mes >= mesHoje, onclick: function () { ir(1); } }, icone('seta_dir')));

    var hojeMarcado = rem[e.hoje];
    var topo = hojeMarcado
      ? h('div', { class: 'remedio-status feito' }, h('span', {}, icone('check'), 'Hoje: tomou às ' + hojeMarcado.hora),
        h('button', { class: 'botao pequeno leve', type: 'button', onclick: function () { editarRemedio(e.hoje); } }, icone('lapis'), 'Editar'))
      : h('div', { class: 'remedio-status' }, h('span', {}, 'Hoje ainda não foi marcado.'),
        h('button', { class: 'botao pequeno', type: 'button', onclick: tomouAgora }, icone('check'), 'Tomou agora'));

    // Grade do mês, começando no domingo
    var diasNoMes = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
    var primeiro = new Date(Date.UTC(p[0], p[1] - 1, 1)).getUTCDay();
    var celulas = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(function (l) { return h('span', { class: 'cal-sem', 'aria-hidden': 'true' }, l); });
    for (var v = 0; v < primeiro; v++) celulas.push(h('span', {}));
    var tomados = 0;
    for (var d = 1; d <= diasNoMes; d++) {
      var iso = mes + '-' + ('0' + d).slice(-2);
      var marca = rem[iso];
      var futuro = iso > e.hoje;
      if (marca) tomados++;
      var rotuloDia = dataBr(iso, { day: 'numeric', month: 'long' }) + (marca ? ': tomou às ' + marca.hora : futuro ? '' : ': não marcado');
      celulas.push(h('button', {
        class: 'cal-dia' + (marca ? ' marcado' : '') + (iso === e.hoje ? ' hoje' : ''), type: 'button',
        disabled: futuro, 'aria-label': rotuloDia, onclick: (function (x) { return function () { editarRemedio(x); }; })(iso)
      }, h('span', { class: 'cal-num' }, d), marca ? h('span', { class: 'cal-hora' }, marca.hora) : null));
    }
    var passados = mes === mesHoje ? Number(e.hoje.slice(8)) : diasNoMes;
    return h('section', { class: 'cartao p-ela' },
      tituloCartao('pilula', 'Anticoncepcional'),
      topo,
      nav,
      h('div', { class: 'calendario' }, celulas),
      h('p', { class: 'remedio-resumo' }, tomados + ' de ' + passados + (passados === 1 ? ' dia marcado' : ' dias marcados')));
  }

  function tomouAgora() {
    var e = S.estado;
    if (!e.remedio) e.remedio = {};
    var dia = e.hoje;
    var hora = horaAgora();
    e.remedio[dia] = { hora: hora, por: eu() };
    render();
    toast('Marcado: tomou às ' + hora);
    executar('marcarRemedio', { data: dia, hora: hora }, { reverter: function () { delete e.remedio[dia]; render(); } }).catch(nada);
  }

  function editarRemedio(dia) {
    var e = S.estado;
    var rem = e.remedio || {};
    var marca = rem[dia];
    var hora = campoModal({ type: 'time', 'aria-label': 'Hora' }, marca ? marca.hora : (dia === e.hoje ? horaAgora() : horaHabitual(rem)));
    var salvar = h('button', { class: 'botao', type: 'button' }, 'Salvar');
    salvar.addEventListener('click', function () {
      if (!hora.value) return toast('Escolha a hora.', 'erro');
      enviarModal(salvar, 'marcarRemedio', { data: dia, hora: hora.value }, marca ? 'Hora atualizada' : 'Dia marcado');
    });
    var acoes = [];
    if (marca) {
      var tirar = h('button', { class: 'botao perigo', type: 'button', style: 'margin-right:auto' }, icone('x'), 'Desmarcar');
      tirar.addEventListener('click', function () { enviarModal(tirar, 'marcarRemedio', { data: dia, desmarcar: true }, 'Dia desmarcado'); });
      acoes.push(tirar);
    }
    acoes.push(h('button', { class: 'botao leve', type: 'button', onclick: fecharModal }, 'Cancelar'), salvar);
    var titulo = dataBr(dia, { weekday: 'long', day: 'numeric', month: 'long' });
    abrirModal({
      titulo: titulo.charAt(0).toUpperCase() + titulo.slice(1), classe: 'p-ela',
      corpo: [
        rotulo(marca ? 'Tomou às' : 'Que horas tomou?', hora),
        marca && marca.por ? h('p', { class: 'dica' }, 'Marcado por ' + (marca.por === eu() ? 'você' : 'Amor') + '.') : null
      ],
      acoes: acoes
    });
  }

  /* =====================================================================
   * Tela: Amanhã
   * ===================================================================== */

  function telaAmanha() {
    var e = S.estado;
    return [
      cartaoTarefas({
        titulo: 'Amanhã', icone: 'lua', data: e.amanha, listas: e.tarefas.amanha, chave: 'amanha', largo: true,
        extra: dataBr(e.amanha, { weekday: 'long', day: 'numeric', month: 'short' }),
        subtitulo: 'Planejem à noite: amanhã essas listas aparecem em Hoje.'
      })
    ];
  }

  /* =====================================================================
   * Tela: Metas
   * ===================================================================== */

  function telaMetas() {
    var e = S.estado;
    return [
      h('section', { class: 'cartao largo' },
        tituloCartao('calendario', 'Metas da semana', periodoSemana(e)),
        h('p', { class: 'subtitulo' }, 'A contagem recomeça toda segunda-feira.'),
        h('div', { class: 'pessoas lado-a-lado' }, osDois().map(function (p) {
          var meu = p === eu();
          var metas = e.metasSemana[p];
          return h('div', { class: 'p-' + p }, cabPessoa(p),
            metas.length ? metas.map(function (m) { return itemMetaSemana(m, p, true); })
              : h('p', { class: 'vazio' }, meu ? 'Ex.: academia 4x, ler 5x, beber água todo dia.' : 'Amor ainda não tem metas da semana.'),
            meu ? h('button', { class: 'botao pequeno', type: 'button', style: 'margin-top:10px', onclick: function () { editarMetaSemana(null); } }, icone('mais'), 'Nova meta da semana') : null);
        }))),
      h('section', { class: 'cartao largo' },
        tituloCartao('alvo', 'Metas de longo prazo'),
        h('p', { class: 'subtitulo' }, 'Objetivos maiores, com barra de progresso.'),
        h('div', { class: 'pessoas lado-a-lado' }, osDois().map(function (p) {
          var meu = p === eu();
          var metas = e.metasLongo[p];
          return h('div', { class: 'p-' + p }, cabPessoa(p),
            metas.length ? metas.map(function (m) { return itemMetaLongo(m, p); })
              : h('p', { class: 'vazio' }, meu ? 'Ex.: ler 12 livros, juntar para a viagem, chegar a 75 kg.' : 'Amor ainda não tem metas de longo prazo.'),
            meu ? h('button', { class: 'botao pequeno', type: 'button', style: 'margin-top:10px', onclick: function () { editarMetaLongo(null); } }, icone('mais'), 'Nova meta') : null);
        })))
    ];
  }

  function itemMetaLongo(m, p) {
    var meu = p === eu();
    var pct = Math.round(m.progresso * 100);
    return h('div', { class: 'meta' },
      h('div', { class: 'meta-linha' },
        h('span', { class: 'meta-titulo' }, m.titulo),
        h('span', { class: 'meta-conta' + (pct >= 100 ? ' cumprida' : '') }, pct >= 100 ? icone('check') : null, pct + '%')),
      h('div', { class: 'meta-longo-valores' },
        h('span', {}, valorComUnidade(m.atual, m.unidade) + ' (alvo ' + valorComUnidade(m.alvo, m.unidade) + ')'),
        m.prazo ? h('span', {}, 'até ' + dataCurta(m.prazo)) : null),
      h('div', { class: 'barra grossa' }, h('span', { style: 'width:' + pct + '%' })),
      meu ? h('div', { class: 'linha-botoes', style: 'margin-top:10px' },
        h('button', { class: 'botao pequeno', type: 'button', onclick: function () { atualizarMetaLongo(m); } }, 'Atualizar'),
        h('button', { class: 'botao pequeno leve', type: 'button', onclick: function () { editarMetaLongo(m); } }, icone('lapis'), 'Editar')) : null);
  }

  function rotulo(texto, campo) {
    return h('label', { class: 'rotulo' }, texto, campo);
  }

  function campoModal(props, valor) {
    var el = h('input', Object.assign({ class: 'campo', type: 'text' }, props));
    if (valor !== undefined && valor !== null) el.value = valor;
    return el;
  }

  function enviarModal(botao, acao, dados, msg) {
    ocupado(botao, true);
    API.chamar(acao, dados).then(function (r) {
      fecharModal();
      S.progresso = null;
      aplicarEstado(r.estado, true);
      if (msg) toast(msg);
    }).catch(function (e) {
      ocupado(botao, false);
      toast(e.message, 'erro');
    });
  }

  function editarMetaSemana(m) {
    var titulo = campoModal({ maxlength: 80, placeholder: 'Academia', enterkeyhint: 'next' }, m ? m.titulo : '');
    var vezes = campoModal({ inputmode: 'numeric', maxlength: 2, placeholder: '3' }, m ? m.vezes : 3);
    var salvar = h('button', { class: 'botao', type: 'button' }, 'Salvar');
    salvar.addEventListener('click', function () {
      var v = parseInt(vezes.value, 10);
      if (!titulo.value.trim()) return toast('Dê um nome para a meta.', 'erro');
      if (!(v >= 1 && v <= 21)) return toast('Escolha de 1 a 21 vezes por semana.', 'erro');
      enviarModal(salvar, 'salvarMetaSemana', { id: m ? m.id : undefined, titulo: titulo.value, vezes: v }, m ? 'Meta atualizada' : 'Meta criada');
    });
    var acoes = [];
    if (m) {
      var arquivar = h('button', { class: 'botao perigo', type: 'button', style: 'margin-right:auto' }, icone('arquivar'), 'Arquivar');
      arquivar.addEventListener('click', function () { enviarModal(arquivar, 'salvarMetaSemana', { id: m.id, ativa: false }, 'Meta arquivada'); });
      acoes.push(arquivar);
    }
    acoes.push(h('button', { class: 'botao leve', type: 'button', onclick: fecharModal }, 'Cancelar'), salvar);
    abrirModal({
      titulo: m ? 'Editar meta da semana' : 'Nova meta da semana', classe: 'p-' + eu(), focar: true,
      corpo: [rotulo('Nome da meta', titulo), rotulo('Quantas vezes por semana?', vezes)], acoes: acoes
    });
  }

  function atualizarMetaLongo(m) {
    var atual = campoModal({ inputmode: 'decimal', placeholder: String(m.atual) }, String(m.atual).replace('.', ','));
    var salvar = h('button', { class: 'botao', type: 'button' }, 'Salvar');
    salvar.addEventListener('click', function () {
      if (!atual.value.trim()) return toast('Digite o valor atual.', 'erro');
      enviarModal(salvar, 'salvarMetaLongo', { id: m.id, atual: atual.value }, 'Progresso atualizado');
    });
    abrirModal({
      titulo: m.titulo, classe: 'p-' + eu(), focar: true,
      corpo: [rotulo('Valor atual' + (m.unidade ? ' (' + m.unidade + ')' : ''), atual),
        h('p', { class: 'dica' }, 'Começou em ' + valorComUnidade(m.inicial, m.unidade) + ' e o alvo é ' + valorComUnidade(m.alvo, m.unidade) + '.')],
      acoes: [h('button', { class: 'botao leve', type: 'button', onclick: fecharModal }, 'Cancelar'), salvar]
    });
  }

  function editarMetaLongo(m) {
    var num = function (v) { return v === null || v === undefined ? '' : String(v).replace('.', ','); };
    var titulo = campoModal({ maxlength: 80, placeholder: 'Ler 12 livros em 2027' }, m ? m.titulo : '');
    var inicial = campoModal({ inputmode: 'decimal', placeholder: '0' }, m ? num(m.inicial) : '0');
    var alvo = campoModal({ inputmode: 'decimal', placeholder: '12' }, m ? num(m.alvo) : '');
    var atual = campoModal({ inputmode: 'decimal', placeholder: '0' }, m ? num(m.atual) : '');
    var unidade = campoModal({ maxlength: 20, placeholder: 'livros, kg, R$' }, m ? m.unidade : '');
    var prazo = campoModal({ type: 'date' }, m ? m.prazo : '');
    var salvar = h('button', { class: 'botao', type: 'button' }, 'Salvar');
    salvar.addEventListener('click', function () {
      if (!titulo.value.trim()) return toast('Dê um nome para a meta.', 'erro');
      if (!alvo.value.trim()) return toast('Diga qual é o alvo.', 'erro');
      var dados = { id: m ? m.id : undefined, titulo: titulo.value, inicial: inicial.value || '0', alvo: alvo.value, unidade: unidade.value, prazo: prazo.value };
      if (atual.value.trim()) dados.atual = atual.value;
      enviarModal(salvar, 'salvarMetaLongo', dados, m ? 'Meta atualizada' : 'Meta criada');
    });
    var acoes = [];
    if (m) {
      var arquivar = h('button', { class: 'botao perigo', type: 'button', style: 'margin-right:auto' }, icone('arquivar'), 'Arquivar');
      arquivar.addEventListener('click', function () { enviarModal(arquivar, 'salvarMetaLongo', { id: m.id, ativa: false }, 'Meta arquivada'); });
      acoes.push(arquivar);
    }
    acoes.push(h('button', { class: 'botao leve', type: 'button', onclick: fecharModal }, 'Cancelar'), salvar);
    abrirModal({
      titulo: m ? 'Editar meta' : 'Nova meta de longo prazo', classe: 'p-' + eu(), focar: true,
      corpo: [
        rotulo('Nome da meta', titulo),
        h('div', { class: 'grade-campos' }, rotulo('Começa em', inicial), rotulo('Alvo', alvo)),
        h('div', { class: 'grade-campos' }, rotulo('Valor atual', atual), rotulo('Unidade', unidade)),
        rotulo('Prazo (opcional)', prazo),
        h('p', { class: 'dica' }, 'Para metas que diminuem (como peso), coloque o valor de hoje em "Começa em" e o objetivo em "Alvo".')
      ],
      acoes: acoes
    });
  }

  /* =====================================================================
   * Tela: Progresso
   * ===================================================================== */

  function carregarProgresso() {
    if (S.carregandoProgresso) return;
    S.carregandoProgresso = true;
    API.chamar('progresso').then(function (r) {
      S.progresso = r.progresso;
      S.progressoEm = Date.now();
      S.erroProgresso = null;
    }).catch(function (e) {
      S.erroProgresso = e.message;
    }).then(function () {
      S.carregandoProgresso = false;
      if (S.aba === 'progresso' && podeRenderizarAgora()) render();
    });
  }

  function telaProgresso() {
    if ((!S.progresso || Date.now() - S.progressoEm > 120000) && !S.erroProgresso) carregarProgresso();
    if (!S.progresso) {
      if (S.erroProgresso) {
        return h('section', { class: 'cartao largo' }, h('p', { class: 'vazio' }, S.erroProgresso),
          h('button', { class: 'botao pequeno', type: 'button', onclick: function () { S.erroProgresso = null; render(); } }, 'Tentar de novo'));
      }
      return [esqueleto(170, 'largo'), esqueleto(240), esqueleto(240), esqueleto(260, 'largo')];
    }
    var p = S.progresso;
    return [
      cartaoSequencias(p),
      cartaoGraficoTarefas(p),
      cartaoGraficoMetas(p),
      cartaoGraficoKcal(p),
      cartaoGraficoPeso(p)
    ];
  }

  function legenda() {
    return h('div', { class: 'legenda' }, osDois().map(function (p) {
      return h('span', { class: 'p-' + p }, h('span', { class: 'bolinha' }), nome(p));
    }));
  }

  function cartaoSequencias(p) {
    var bloco = function (pes) {
      var s = p.sequencias[pes];
      return h('div', { class: 'bloco p-' + pes }, icone('chama'),
        h('div', { class: 'bloco-num' }, String(s.atual)),
        h('div', { class: 'bloco-rot' }, nome(pes)),
        h('div', { class: 'bloco-sub' }, 'recorde ' + s.recorde));
    };
    return h('section', { class: 'cartao largo' },
      tituloCartao('chama', 'Sequências'),
      h('div', { class: 'blocos' }, bloco(eu()), bloco(amor()),
        h('div', { class: 'bloco casal' }, icone('coracao', 'cheio'),
          h('div', { class: 'bloco-num' }, String(p.sequenciaCasal.atual)),
          h('div', { class: 'bloco-rot' }, 'Nós dois'),
          h('div', { class: 'bloco-sub' }, 'recorde ' + p.sequenciaCasal.recorde))),
      h('p', { class: 'dica', style: 'margin-top:12px' }, icone('estrela'),
        'Cada um: dias seguidos com todas as tarefas feitas (dias sem tarefas não contam). Nós dois: dias seguidos em que os dois desenharam no quadro do dia.'));
  }

  function pct(c) { return c && c.total ? c.feitas / c.total : null; }

  function media(lista) {
    var v = lista.filter(function (x) { return x !== null && x !== undefined; });
    return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
  }

  function cartaoGraficoTarefas(p) {
    var dias = p.tarefas.slice(-14);
    var itens = dias.map(function (d) {
      return { rotulo: d.data.slice(8), titulo: diaMes(d.data), a: pct(d[eu()]), b: pct(d[amor()]) };
    });
    var ult7 = p.tarefas.slice(-7);
    var resumo = osDois().map(function (pes) {
      var m = media(ult7.map(function (d) { return pct(d[pes]); }));
      return nome(pes) + ' ' + (m === null ? '-' : Math.round(m * 100) + '%');
    }).join(' · ');
    return h('section', { class: 'cartao' },
      tituloCartao('check', 'Tarefas feitas', '14 dias'),
      Graficos.barrasPareadas({ itens: itens, cores: [corDe(eu()), corDe(amor())], rotulo: 'Porcentagem de tarefas feitas por dia' }),
      legenda(),
      h('p', { class: 'subtitulo', style: 'margin:10px 0 0;text-align:center' }, 'Média dos últimos 7 dias: ' + resumo));
  }

  function cartaoGraficoMetas(p) {
    var itens = p.metasSemana.map(function (w) {
      return { rotulo: diaMes(w.inicio), titulo: 'Semana de ' + diaMes(w.inicio), a: pct({ total: w[eu()].total, feitas: w[eu()].cumpridas }), b: pct({ total: w[amor()].total, feitas: w[amor()].cumpridas }) };
    });
    var atual = p.metasSemana[p.metasSemana.length - 1];
    return h('section', { class: 'cartao' },
      tituloCartao('calendario', 'Metas cumpridas', '8 semanas'),
      Graficos.barrasPareadas({ itens: itens, cores: [corDe(eu()), corDe(amor())], rotulo: 'Metas semanais cumpridas por semana' }),
      legenda(),
      h('p', { class: 'subtitulo', style: 'margin:10px 0 0;text-align:center' }, 'Esta semana: ' + osDois().map(function (pes) {
        return nome(pes) + ' ' + atual[pes].cumpridas + ' de ' + atual[pes].total;
      }).join(' · ')));
  }

  function cartaoGraficoKcal(p) {
    var algum = p.kcal.some(function (d) { return d.ele !== null || d.ela !== null; });
    return h('section', { class: 'cartao largo' },
      tituloCartao('prato', 'Calorias por dia', '14 dias'),
      !algum ? h('p', { class: 'vazio' }, 'Ainda não há refeições registradas. Contem ao Claude o que comeram para ele anotar.') :
        h('div', { class: 'pessoas lado-a-lado' }, osDois().map(function (pes) {
          var vals = p.kcal.map(function (d) { return d[pes]; });
          var m = media(vals);
          var meta = p.metasKcal[pes];
          return h('div', { class: 'p-' + pes },
            cabPessoa(pes, m === null ? 'sem registros' : 'média ' + fmt(m) + ' kcal'),
            Graficos.barrasMeta({
              itens: p.kcal.map(function (d) { return { rotulo: d.data.slice(8), titulo: diaMes(d.data), valor: d[pes] }; }),
              meta: meta, cor: corDe(pes), corForte: corDe(pes, 'escuro'), rotulo: 'Calorias por dia de ' + nome(pes)
            }));
        })),
      algum ? h('p', { class: 'subtitulo', style: 'margin:10px 0 0' }, 'A linha tracejada é a meta. Barras mais escuras passaram mais de 10% da meta.') : null);
  }

  function cartaoGraficoPeso(p) {
    var algum = osDois().some(function (pes) { return p.peso[pes].length; });
    return h('section', { class: 'cartao largo' },
      tituloCartao('balanca', 'Peso'),
      !algum ? h('p', { class: 'vazio' }, 'Nenhum peso registrado ainda. É só contar ao Claude que ele anota.') :
        h('div', { class: 'pessoas lado-a-lado' }, osDois().map(function (pes) {
          var l = p.peso[pes];
          if (!l.length) return h('div', { class: 'p-' + pes }, cabPessoa(pes), h('p', { class: 'vazio' }, 'Sem registros ainda.'));
          var ult = l[l.length - 1], dif = ult.kg - l[0].kg;
          var variacao = l.length > 1
            ? (dif > 0 ? '+' : dif < 0 ? '−' : '') + fmt(Math.abs(dif), 1) + ' kg desde ' + diaMes(l[0].data)
            : 'primeiro registro em ' + diaMes(ult.data);
          var meta = p.pesoMeta[pes];
          return h('div', { class: 'p-' + pes },
            cabPessoa(pes, fmt(ult.kg, 1) + ' kg'),
            Graficos.linhas({
              series: [{ pontos: l, cor: corDe(pes, 'escuro') }],
              metas: meta ? [{ valor: meta, rotulo: 'meta ' + fmt(meta, 1) }] : [],
              rotulo: 'Evolução do peso de ' + nome(pes), altura: 150
            }),
            h('p', { class: 'subtitulo', style: 'margin:6px 0 0;text-align:center' }, variacao));
        })));
  }

  /* =====================================================================
   * Tela: Memórias
   * ===================================================================== */

  function carregarMemorias() {
    var M = S.memorias;
    if (M.carregando || !M.temMais) return;
    M.carregando = true;
    M.iniciado = true;
    // Hoje já aparece na aba Hoje; as memórias começam em ontem.
    var ultimo = M.dias.length ? M.dias[M.dias.length - 1].data : S.estado.hoje;
    var dono = M;
    API.chamar('memorias', { antesDe: ultimo, limite: 8 }).then(function (r) {
      if (S.memorias !== dono) return;
      M.dias = M.dias.concat(r.dias);
      M.temMais = r.temMais;
      M.erro = null;
    }).catch(function (e) {
      M.erro = e.message;
    }).then(function () {
      M.carregando = false;
      if (S.aba === 'memorias' && podeRenderizarAgora()) render();
    });
  }

  function telaMemorias() {
    var M = S.memorias;
    if (!M.iniciado) carregarMemorias();
    if (!M.dias.length) {
      if (M.carregando || !M.iniciado) return [esqueleto(260, 'largo'), esqueleto(260, 'largo')];
      if (M.erro) return h('section', { class: 'cartao largo' }, h('p', { class: 'vazio' }, M.erro),
        h('button', { class: 'botao pequeno', type: 'button', onclick: function () { S.memorias = memoriasVazias(); render(); } }, 'Tentar de novo'));
      return h('section', { class: 'cartao largo' }, tituloCartao('imagem', 'Memórias'),
        h('p', { class: 'vazio' }, 'O quadro de cada dia fica guardado aqui a partir de amanhã. Que tal desenhar no de hoje?'),
        h('button', { class: 'botao pequeno', type: 'button', onclick: function () { irPara('hoje'); } }, icone('lapis'), 'Ir para Hoje'));
    }
    var anoAtual = S.estado.hoje.slice(0, 4);
    var cartoes = M.dias.map(function (d) {
      var opcoes = { weekday: 'long', day: 'numeric', month: 'long' };
      if (d.data.slice(0, 4) !== anoAtual) opcoes.year = 'numeric';
      var titulo = dataBr(d.data, opcoes);
      var temMomento = d[eu()] || d[amor()];
      return h('section', { class: 'cartao' },
        h('h2', { class: 'memoria-data' }, titulo),
        d.quadro ? h('button', { class: 'quadro-previa', type: 'button', 'aria-label': 'Ver o quadro de ' + titulo, onclick: function () { abrirVisorQuadro(d.quadro, titulo); } },
          Quadro.svg(d.quadro, coresCaneta(), 'Quadro de ' + titulo)) : null,
        temMomento ? h('div', { class: 'duas-colunas', style: d.quadro ? 'margin-top:12px' : null }, osDois().map(function (p) { return blocoMomento(p, d[p]); })) : null);
    });
    var rodape = M.temMais
      ? h('button', { class: 'botao secundario largo', type: 'button', disabled: M.carregando, onclick: carregarMemorias },
        M.carregando ? h('span', { class: 'spinner' }) : null, M.carregando ? 'Carregando...' : 'Carregar mais')
      : h('p', { class: 'vazio largo', style: 'text-align:center' }, 'Essas são todas as memórias, por enquanto.');
    return cartoes.concat([rodape]);
  }

  /* =====================================================================
   * Modal, visor de foto e menu
   * ===================================================================== */

  function abrirModal(o) {
    fecharModal(true);
    var fundo = h('div', { class: 'fundo-modal' });
    var caixa = h('div', { class: 'modal ' + (o.classe || ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-titulo' },
      h('div', { class: 'modal-cab' }, h('h2', { id: 'modal-titulo' }, o.titulo),
        h('button', { class: 'botao-icone', type: 'button', 'aria-label': 'Fechar', onclick: function () { fecharModal(); } }, icone('x'))),
      h('div', { class: 'modal-corpo' }, o.corpo),
      o.acoes ? h('div', { class: 'modal-acoes' }, o.acoes) : null);
    fundo.addEventListener('click', function (ev) { if (ev.target === fundo) fecharModal(); });
    caixa.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.target.tagName === 'INPUT' && ev.target.type !== 'file') {
        var botoes = caixa.querySelectorAll('.modal-acoes .botao:not(.leve):not(.perigo)');
        if (botoes.length) { ev.preventDefault(); botoes[botoes.length - 1].click(); }
      }
    });
    fundo.appendChild(caixa);
    document.body.appendChild(fundo);
    document.body.style.overflow = 'hidden';
    modalAtual = { fundo: fundo, foco: document.activeElement };
    if (o.focar) {
      var primeiro = caixa.querySelector('input:not([type=file]), textarea');
      if (primeiro) setTimeout(function () { primeiro.focus(); }, 60);
    } else {
      caixa.setAttribute('tabindex', '-1');
      caixa.focus({ preventScroll: true });
    }
  }

  function fecharModal(semRender) {
    if (!modalAtual) return;
    var m = modalAtual;
    modalAtual = null;
    m.fundo.remove();
    document.body.style.overflow = '';
    if (m.foco && m.foco.focus && document.contains(m.foco)) m.foco.focus({ preventScroll: true });
    if (!semRender && S.renderPendente && podeRenderizarAgora()) {
      S.renderPendente = false;
      render();
    }
  }

  function abrirVisor(m, p) {
    fecharVisor();
    var img = h('img', { src: S.fotos[m.fotoId] || m.miniatura || '', alt: 'Foto de ' + nome(p) });
    var visor = h('div', { class: 'visor', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Foto de ' + nome(p) },
      h('button', { class: 'botao-icone fechar', type: 'button', 'aria-label': 'Fechar foto', onclick: fecharVisor }, icone('x')),
      h('div', {}, img, m.recado ? h('p', { class: 'visor-legenda' }, nome(p) + ': ' + m.recado) : null));
    visor.addEventListener('click', function (ev) { if (ev.target === visor) fecharVisor(); });
    document.body.appendChild(visor);
    document.body.style.overflow = 'hidden';
    visorAtual = visor;
    visor.querySelector('.fechar').focus();
    if (!S.fotos[m.fotoId]) {
      baixarFoto(m.fotoId).then(function (f) { if (f && visorAtual === visor) img.src = f; });
    }
  }

  function abrirVisorQuadro(tracos, titulo) {
    fecharVisor();
    var visor = h('div', { class: 'visor', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Quadro de ' + titulo },
      h('button', { class: 'botao-icone fechar', type: 'button', 'aria-label': 'Fechar', onclick: fecharVisor }, icone('x')),
      h('div', { class: 'visor-quadro' }, Quadro.svg(tracos, coresCaneta(), 'Quadro de ' + titulo),
        h('p', { class: 'visor-legenda' }, titulo)));
    visor.addEventListener('click', function (ev) { if (ev.target === visor) fecharVisor(); });
    document.body.appendChild(visor);
    document.body.style.overflow = 'hidden';
    visorAtual = visor;
    visor.querySelector('.fechar').focus();
  }

  function fecharVisor() {
    if (!visorAtual) return;
    visorAtual.remove();
    visorAtual = null;
    if (!modalAtual) document.body.style.overflow = '';
    if (S.renderPendente && podeRenderizarAgora()) {
      S.renderPendente = false;
      render();
    }
  }

  function abrirMenu() {
    var hora = S.ultimaAtualizacao ? new Date(S.ultimaAtualizacao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-';
    abrirModal({
      titulo: 'Menu', classe: 'p-' + eu(),
      corpo: [
        h('p', { class: 'dica' }, icone('coracao'), 'Você entrou como "' + eu() + '". Última atualização às ' + hora + '.'),
        h('button', { class: 'botao secundario largo-total', type: 'button', onclick: function () { fecharModal(); atualizar(false); } }, icone('atualizar'), 'Atualizar agora'),
        h('button', { class: 'botao secundario largo-total', type: 'button', onclick: abrirTrocarPin }, icone('chave'), 'Trocar meu PIN'),
        h('button', { class: 'botao perigo largo-total', type: 'button', onclick: function () { fecharModal(true); sair(); } }, icone('sair'), 'Sair deste aparelho')
      ]
    });
  }

  function abrirTrocarPin() {
    var pinProps = { type: 'password', inputmode: 'numeric', maxlength: 8, autocomplete: 'off', class: 'campo campo-pin' };
    var atual = h('input', Object.assign({ 'aria-label': 'PIN atual', autocomplete: 'current-password' }, pinProps));
    var novo = h('input', Object.assign({ 'aria-label': 'Novo PIN', autocomplete: 'new-password' }, pinProps));
    var conf = h('input', Object.assign({ 'aria-label': 'Repita o novo PIN', autocomplete: 'new-password' }, pinProps));
    var salvar = h('button', { class: 'botao', type: 'button' }, 'Trocar PIN');
    salvar.addEventListener('click', function () {
      if (!/^\d{4,8}$/.test(novo.value)) return toast('O novo PIN precisa ter de 4 a 8 números.', 'erro');
      if (novo.value !== conf.value) return toast('Os dois PINs novos não são iguais.', 'erro');
      ocupado(salvar, true);
      API.chamar('trocarPin', { pinAtual: atual.value, pinNovo: novo.value }).then(function () {
        fecharModal();
        toast('PIN trocado. Os outros aparelhos vão precisar entrar de novo.');
      }).catch(function (e) {
        ocupado(salvar, false);
        toast(e.message, 'erro');
      });
    });
    abrirModal({
      titulo: 'Trocar meu PIN', classe: 'p-' + eu(), focar: true,
      corpo: [rotulo('PIN atual', atual), rotulo('Novo PIN (4 a 8 números)', novo), rotulo('Repita o novo PIN', conf)],
      acoes: [h('button', { class: 'botao leve', type: 'button', onclick: fecharModal }, 'Cancelar'), salvar]
    });
  }

  function sair() {
    API.sair().then(function () {
      S.estado = null;
      S.progresso = null;
      S.memorias = memoriasVazias();
      S.fotos = {};
      S.loginPessoa = null;
      S.loginMsg = '';
      casca = null;
      render();
    });
  }

  /* =====================================================================
   * Login
   * ===================================================================== */

  function renderLogin() {
    document.body.className = S.loginPessoa ? 'p-' + S.loginPessoa : 'p-ele';
    var erro = h('p', { class: 'erro-txt', role: 'alert' }, S.loginErro);
    var form = null;
    if (S.loginPessoa) {
      var pin = h('input', {
        class: 'campo campo-pin', type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 8,
        autocomplete: 'current-password', 'aria-label': 'Seu PIN', placeholder: 'PIN', name: 'pin'
      });
      var entrar = h('button', { class: 'botao largo-total', type: 'submit' }, 'Entrar');
      form = h('form', {
        style: 'display:grid;gap:12px', onsubmit: function (ev) {
          ev.preventDefault();
          if (!pin.value.trim()) { erro.textContent = 'Digite seu PIN.'; return; }
          ocupado(entrar, true, 'Entrando...');
          S.entrando = true;
          API.entrar(S.loginPessoa, pin.value.trim()).then(function () {
            S.entrando = false;
            S.loginErro = '';
            S.loginMsg = '';
            S.estado = null;
            render();
          }).catch(function (e) {
            S.entrando = false;
            ocupado(entrar, false);
            entrar.textContent = 'Entrar';
            erro.textContent = e.message;
            pin.value = '';
            pin.focus();
          });
        }
      },
      h('input', { type: 'text', name: 'username', autocomplete: 'username', value: S.loginPessoa, hidden: true, readonly: true, tabindex: '-1', 'aria-hidden': 'true' }),
      pin, entrar);
      setTimeout(function () { pin.focus(); }, 30);
    }
    raiz.replaceChildren(h('div', { class: 'tela-login' }, h('div', { class: 'login-caixa' },
      h('img', { class: 'login-logo', src: 'icones/icone-192.png', alt: '' }),
      h('h1', { class: 'login-titulo' }, 'Nós dois'),
      h('p', { class: 'login-sub' }, 'nosso cantinho de todo dia'),
      S.loginMsg ? h('p', { class: 'dica' }, S.loginMsg) : null,
      h('p', { style: 'font-weight:800' }, 'Quem é você?'),
      h('div', { class: 'escolha' }, ['ele', 'ela'].map(function (p) {
        return h('button', {
          class: 'p-' + p, type: 'button', 'aria-pressed': String(S.loginPessoa === p),
          onclick: function () { S.loginPessoa = p; S.loginErro = ''; renderLogin(); }
        }, h('span', { class: 'bolona' }, icone('coracao', 'cheio')), p === 'ele' ? 'Ele' : 'Ela');
      })),
      form,
      erro)));
  }

  /* =====================================================================
   * Início
   * ===================================================================== */

  window.addEventListener('hashchange', function () {
    var a = abaDaUrl();
    if (a === S.aba) return;
    S.aba = a;
    S.editando = null;
    fecharModal(true);
    fecharVisor();
    if (API.sessao && S.estado) {
      render();
      window.scrollTo(0, 0);
    }
  });

  window.addEventListener('sessao-expirada', function (ev) {
    S.estado = null;
    S.loginMsg = (ev.detail || 'Sua sessão terminou.') + '';
    fecharModal(true);
    fecharVisor();
    casca = null;
    render();
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (visorAtual) fecharVisor();
    else if (modalAtual) fecharModal();
  });

  // Espera um pouco depois de sair de um campo: se a pessoa tocou num botão (ex.: "+"),
  // o toque precisa ser processado antes de a tela ser redesenhada.
  document.addEventListener('focusout', function () {
    setTimeout(function () {
      if (S.renderPendente && podeRenderizarAgora()) render();
    }, 400);
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && API.sessao && Date.now() - S.ultimaAtualizacao > 30000) atualizar(true);
  });

  setInterval(function () {
    if (!document.hidden && API.sessao && S.estado && !modalAtual && !Quadro.aberto()) atualizar(true);
  }, CONFIG.INTERVALO_ATUALIZACAO_MS || 60000);

  if (S.estado && (!API.sessao || S.estado.eu !== API.sessao.pessoa)) S.estado = null;
  render();
  if (API.sessao && S.estado) atualizar(true);
})();
