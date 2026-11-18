/*
 * Cliente da API: manda {acao, token, ...dados} para o Apps Script e devolve o JSON.
 * Usa Content-Type text/plain para o navegador não fazer a checagem extra de CORS (preflight),
 * que o Apps Script não sabe responder.
 */
(function () {
  'use strict';

  var CHAVE_SESSAO = 'nosdois.sessao';

  function ErroApi(mensagem, codigo, detalhe) {
    var e = new Error(mensagem);
    e.codigo = codigo || 'erro';
    e.detalhe = detalhe;
    return e;
  }

  function lerSessao() {
    try {
      var s = JSON.parse(localStorage.getItem(CHAVE_SESSAO) || 'null');
      return s && s.token && s.pessoa ? s : null;
    } catch (e) {
      return null;
    }
  }

  var API = {
    sessao: lerSessao(),

    configurada: function () {
      return !!CONFIG.API_URL && CONFIG.API_URL.indexOf('COLE_AQUI') !== 0;
    },

    chamar: function (acao, dados, opcoes) {
      opcoes = opcoes || {};
      var corpo = Object.assign({ acao: acao, token: API.sessao ? API.sessao.token : undefined }, dados || {});
      var controle = new AbortController();
      var limite = setTimeout(function () { controle.abort(); }, opcoes.timeout || 45000);
      return fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(corpo),
        redirect: 'follow',
        signal: controle.signal
      }).catch(function (e) {
        throw ErroApi(e && e.name === 'AbortError'
          ? 'A conexão demorou demais. Tente de novo.'
          : 'Sem conexão com o servidor. Confira a internet.', 'rede');
      }).then(function (resp) {
        clearTimeout(limite);
        return resp.json().catch(function () {
          throw ErroApi('O servidor respondeu algo inesperado. Tente de novo em instantes.', 'resposta');
        });
      }).then(function (json) {
        if (!json || !json.ok) {
          if (json && json.codigo === 'sessao' && acao !== 'login') {
            API.limparSessao();
            window.dispatchEvent(new CustomEvent('sessao-expirada', { detail: json.erro }));
          }
          throw ErroApi((json && json.erro) || 'Algo deu errado.', json && json.codigo, json && json.detalhe);
        }
        return json;
      }, function (e) {
        clearTimeout(limite);
        throw e;
      });
    },

    entrar: function (pessoa, pin) {
      return API.chamar('login', { pessoa: pessoa, pin: pin }).then(function (r) {
        API.sessao = { token: r.token, pessoa: r.pessoa };
        try { localStorage.setItem(CHAVE_SESSAO, JSON.stringify(API.sessao)); } catch (e) { /* modo privado */ }
        return r;
      });
    },

    sair: function () {
      var fim = function () { API.limparSessao(); };
      return API.chamar('sair', {}, { timeout: 8000 }).then(fim, fim);
    },

    limparSessao: function () {
      API.sessao = null;
      try {
        localStorage.removeItem(CHAVE_SESSAO);
        localStorage.removeItem('nosdois.estado');
      } catch (e) { /* modo privado */ }
    }
  };

  window.API = API;
})();
