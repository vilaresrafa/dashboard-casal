/**
 * Nós dois - Dashboard do casal
 * API em Google Apps Script, presa (bound) à planilha que funciona como banco de dados.
 *
 * Fluxo:
 *  - O site (GitHub Pages) manda POST com um JSON { acao, token, ...dados }.
 *  - doPost() confere o token, executa a ação e devolve JSON.
 *  - Datas ficam como texto "aaaa-mm-dd" no fuso de São Paulo.
 *  - Cada pessoa ("ele" ou "ela") só altera o que é dela; as duas leem tudo.
 *
 * Funções que terminam com "_" são privadas: o Apps Script não deixa chamá-las de fora.
 */

var VERSAO = '1.3.0';
var FUSO = 'America/Sao_Paulo';
var PESSOAS = ['ele', 'ela'];
var MAX_ERROS_PIN = 5;
var BLOQUEIO_SEG = 15 * 60;
var LIMITE_FOTO_CHARS = 6 * 1024 * 1024; // dataURL em base64 (~4,5 MB de imagem)
var LIMITE_MINIATURA_CHARS = 49000;     // uma célula aceita até 50.000 caracteres
var DIAS_PENDENTES = 7;                 // tarefas não feitas aparecem como pendentes por 7 dias
var HORA_VIRADA = 3;                    // o dia muda às 3h da manhã (horário de São Paulo), não à meia-noite
var DIAS_DIETA = 14;                    // dias da dieta (com hoje) que o site pode navegar
var LIMITE_QUADRO_CHARS = 49000;        // traços de uma pessoa num dia (uma célula aceita até 50.000 caracteres)
var MAX_TRACOS = 2000;

// Abas da planilha e suas colunas (a ordem pode mudar na planilha; o código lê pelo nome da coluna).
var ABAS = {
  Pessoas: ['id', 'meta_kcal', 'meta_proteina_g', 'meta_carbo_g', 'meta_gordura_g', 'peso_meta_kg'],
  Tarefas: ['id', 'pessoa', 'data', 'texto', 'feita', 'feita_em', 'criada_em', 'origem', 'pendencia'],
  MetasSemana: ['id', 'pessoa', 'titulo', 'vezes_por_semana', 'ativa', 'criada_em'],
  MetasSemanaLog: ['data', 'meta_id', 'pessoa', 'registrado_em'],
  MetasLongo: ['id', 'pessoa', 'titulo', 'inicial', 'atual', 'alvo', 'unidade', 'prazo', 'ativa', 'atualizada_em'],
  Dieta: ['data', 'pessoa', 'refeicao', 'alimento', 'quantidade', 'kcal', 'proteina_g', 'carbo_g', 'gordura_g', 'obs'],
  Peso: ['data', 'pessoa', 'peso_kg'],
  Momentos: ['data', 'pessoa', 'recado', 'foto_id', 'miniatura_id', 'atualizado_em'],
  Miniaturas: ['id', 'base64'],
  Anticoncepcional: ['data', 'hora', 'marcado_por', 'atualizado_em'],
  Quadro: ['data', 'pessoa', 'tracos', 'atualizado_em']
};

// Colunas guardadas como texto puro (evita a planilha transformar "2026-11-19" ou "1/2 xícara" em data).
var COLUNAS_TEXTO = {
  id: true, data: true, feita_em: true, criada_em: true, registrado_em: true, atualizada_em: true,
  atualizado_em: true, prazo: true, meta_id: true, foto_id: true, miniatura_id: true, pessoa: true,
  texto: true, recado: true, titulo: true, unidade: true, refeicao: true, alimento: true,
  quantidade: true, obs: true, origem: true, pendencia: true, base64: true, hora: true, marcado_por: true, tracos: true
};

// Cache por execução (no Apps Script cada requisição começa do zero; no servidor local é zerado em doPost).
var _ss = null;
var _abas = {};
var _cabecalhos = {};

/* =========================================================================
 * Entrada HTTP
 * ========================================================================= */

function doGet() {
  return json_({ ok: true, app: 'nos-dois', versao: VERSAO });
}

function doPost(e) {
  _ss = null;
  _abas = {};
  _cabecalhos = {};
  var resposta;
  try {
    var corpo;
    try {
      corpo = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (x) {
      throw erro_('Requisição inválida.');
    }
    if (!corpo || typeof corpo !== 'object') throw erro_('Requisição inválida.');
    resposta = despachar_(corpo) || {};
    resposta.ok = true;
  } catch (err) {
    var publico = err && err.publico;
    resposta = {
      ok: false,
      erro: publico ? err.message : 'Algo deu errado no servidor. Tente de novo.',
      codigo: (err && err.codigo) || 'erro'
    };
    if (!publico) {
      resposta.detalhe = String((err && err.message) || err);
      console.error(err && err.stack ? err.stack : err);
    }
  }
  return json_(resposta);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function erro_(mensagem, codigo) {
  var e = new Error(mensagem);
  e.publico = true;
  e.codigo = codigo || 'erro';
  return e;
}

function despachar_(c) {
  var publicas = { ping: acaoPing_, login: acaoLogin_ };
  var leitura = {
    estado: acaoEstado_,
    foto: acaoFoto_,
    memorias: acaoMemorias_,
    quadro: acaoQuadro_,
    progresso: acaoProgresso_
  };
  var escrita = {
    sair: acaoSair_,
    trocarPin: acaoTrocarPin_,
    addTarefa: acaoAddTarefa_,
    editarTarefa: acaoEditarTarefa_,
    marcarTarefa: acaoMarcarTarefa_,
    excluirTarefa: acaoExcluirTarefa_,
    trazerTarefa: acaoTrazerTarefa_,
    descartarPendente: acaoDescartarPendente_,
    salvarMetaSemana: acaoSalvarMetaSemana_,
    marcarMetaSemana: acaoMarcarMetaSemana_,
    salvarMetaLongo: acaoSalvarMetaLongo_,
    salvarMomento: acaoSalvarMomento_,
    marcarRemedio: acaoMarcarRemedio_,
    salvarQuadro: acaoSalvarQuadro_
  };
  var acao = String(c.acao || '');
  if (publicas.hasOwnProperty(acao)) return publicas[acao](c);

  var eh_escrita = escrita.hasOwnProperty(acao);
  if (!eh_escrita && !leitura.hasOwnProperty(acao)) throw erro_('Ação desconhecida: ' + acao);

  var eu = autenticar_(c.token);
  if (!eh_escrita) return leitura[acao](c, eu);

  // Trava: impede que dois salvamentos ao mesmo tempo baguncem a planilha.
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(20000)) throw erro_('O servidor está ocupado. Tente de novo em alguns segundos.');
  try {
    return escrita[acao](c, eu);
  } finally {
    trava.releaseLock();
  }
}

/* =========================================================================
 * Login, PIN e sessão
 * ========================================================================= */

function acaoPing_() {
  return { versao: VERSAO, hoje: hoje_() };
}

function acaoLogin_(c) {
  var p = pessoa_(c.pessoa);
  if (!p) throw erro_('Escolha quem é você.');
  var pin = String(c.pin == null ? '' : c.pin).trim();
  verificarPin_(p, pin);
  var token = novoToken_();
  PropertiesService.getScriptProperties().setProperty('TK_' + token, JSON.stringify({ p: p, c: agoraIso_() }));
  return { token: token, pessoa: p };
}

/** Confere o PIN com bloqueio após MAX_ERROS_PIN erros seguidos. */
function verificarPin_(p, pin) {
  var cache = CacheService.getScriptCache();
  var chave = 'erros_pin_' + p;
  var erros = parseInt(cache.get(chave) || '0', 10) || 0;
  if (erros >= MAX_ERROS_PIN) throw erro_('Muitas tentativas erradas. Espere 15 minutos.', 'bloqueado');
  var salvo = PropertiesService.getScriptProperties().getProperty('PIN_' + p);
  if (!salvo) throw erro_('O PIN ainda não foi definido. Use o menu Dashboard > Definir PIN na planilha.', 'sem_pin');
  if (!pin || hashPin_(pin) !== salvo) {
    erros++;
    cache.put(chave, String(erros), BLOQUEIO_SEG);
    var restam = MAX_ERROS_PIN - erros;
    if (restam <= 0) throw erro_('Muitas tentativas erradas. Espere 15 minutos.', 'bloqueado');
    throw erro_('PIN incorreto. ' + (restam === 1 ? 'Resta 1 tentativa.' : 'Restam ' + restam + ' tentativas.'), 'pin');
  }
  cache.remove(chave);
}

function autenticar_(token) {
  token = String(token || '');
  if (!/^[a-f0-9]{32,80}$/.test(token)) throw erro_('Entre com seu PIN.', 'sessao');
  var bruto = PropertiesService.getScriptProperties().getProperty('TK_' + token);
  if (!bruto) throw erro_('Sua sessão terminou. Entre de novo com seu PIN.', 'sessao');
  var dados;
  try { dados = JSON.parse(bruto); } catch (e) { dados = null; }
  var p = dados && pessoa_(dados.p);
  if (!p) throw erro_('Sua sessão terminou. Entre de novo com seu PIN.', 'sessao');
  return p;
}

function acaoSair_(c) {
  PropertiesService.getScriptProperties().deleteProperty('TK_' + String(c.token || ''));
  return {};
}

function acaoTrocarPin_(c, eu) {
  verificarPin_(eu, String(c.pinAtual == null ? '' : c.pinAtual).trim());
  definirPin_(eu, String(c.pinNovo == null ? '' : c.pinNovo).trim(), String(c.token || ''));
  return {};
}

/** Define o PIN de uma pessoa e encerra as outras sessões dela (menos a indicada em "manterToken"). */
function definirPin_(p, pin, manterToken) {
  p = pessoa_(p);
  if (!p) throw erro_('Pessoa inválida.');
  if (!/^\d{4,8}$/.test(pin)) throw erro_('O PIN precisa ter de 4 a 8 números.');
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SAL')) props.setProperty('SAL', Utilities.getUuid());
  props.setProperty('PIN_' + p, hashPin_(pin));
  CacheService.getScriptCache().remove('erros_pin_' + p);
  revogarSessoes_(p, manterToken || null);
}

function revogarSessoes_(p, manterToken) {
  var props = PropertiesService.getScriptProperties();
  props.getKeys().forEach(function (k) {
    if (k.indexOf('TK_') !== 0) return;
    if (manterToken && k === 'TK_' + manterToken) return;
    var dados;
    try { dados = JSON.parse(props.getProperty(k)); } catch (e) { dados = null; }
    if (!dados || dados.p === p) props.deleteProperty(k);
  });
}

function hashPin_(pin) {
  var sal = PropertiesService.getScriptProperties().getProperty('SAL') || '';
  return sha256Hex_(sal + ':' + pin);
}

function sha256Hex_(texto) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function novoToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
}

/* =========================================================================
 * Estado do dia (o que a tela "Hoje" e "Amanhã" mostram)
 * ========================================================================= */

function acaoEstado_(c, eu) {
  return { estado: montarEstado_(eu, { curarIds: true }) };
}

function montarEstado_(eu, opcoes) {
  opcoes = opcoes || {};
  var hoje = hoje_();
  var amanha = somarDias_(hoje, 1);
  var ontem = somarDias_(hoje, -1);
  var semIni = inicioSemana_(hoje);
  var semFim = somarDias_(semIni, 6);

  // Tarefas
  var linhasTarefas = ler_('Tarefas');
  if (opcoes.curarIds) curarIdsTarefas_(linhasTarefas);
  var tarefas = linhasTarefas.map(tarefaObj_).filter(function (t) { return t.pessoa && t.data; });
  var limitePend = somarDias_(hoje, -DIAS_PENDENTES);
  var listas = { hoje: porPessoa_([]), amanha: porPessoa_([]), pendentes: porPessoa_([]) };
  tarefas.forEach(function (t) {
    if (t.data === hoje) listas.hoje[t.pessoa].push(publicaTarefa_(t));
    else if (t.data === amanha) listas.amanha[t.pessoa].push(publicaTarefa_(t));
    else if (t.data < hoje && t.data >= limitePend && !t.feita && !t.pendencia) listas.pendentes[t.pessoa].push(publicaTarefa_(t));
  });

  // Metas da semana (contagem da semana atual, que começa na segunda)
  var log = ler_('MetasSemanaLog').map(logMetaObj_);
  var metasSemana = porPessoa_([]);
  ler_('MetasSemana').map(metaSemanaObj_).forEach(function (m) {
    if (!m.pessoa || !m.ativa || !m.id) return;
    var feitas = log.filter(function (l) { return l.metaId === m.id && l.data >= semIni && l.data <= semFim; }).length;
    metasSemana[m.pessoa].push({ id: m.id, titulo: m.titulo, vezes: m.vezes, feitas: feitas });
  });

  // Metas de longo prazo
  var metasLongo = porPessoa_([]);
  ler_('MetasLongo').map(metaLongoObj_).forEach(function (m) {
    if (!m.pessoa || !m.ativa || !m.id) return;
    metasLongo[m.pessoa].push(publicaMetaLongo_(m));
  });

  // Dieta de hoje e dos dias anteriores (para navegar no site) + metas de calorias
  var pessoas = lerPessoas_();
  var dietaDias = dietaPorDia_(somarDias_(hoje, -(DIAS_DIETA - 1)), hoje);
  var dieta = dietaDias[hoje];

  // Peso mais recente
  var peso = porPessoa_(null);
  ler_('Peso').forEach(function (r) {
    var p = pessoa_(r.pessoa), d = dataStr_(r.data), kg = numOuNulo_(r.peso_kg);
    if (!p || !d || kg === null) return;
    if (!peso[p] || d >= peso[p].data) peso[p] = { data: d, kg: kg };
  });

  // Momentos de hoje (foto + recado)
  var momentos = porPessoa_(null);
  ler_('Momentos').forEach(function (r) {
    var m = momentoObj_(r);
    if (m.pessoa && m.data === hoje) momentos[m.pessoa] = m;
  });
  var miniIds = PESSOAS.map(function (p) { return momentos[p] && momentos[p].miniaturaId; }).filter(Boolean);
  var minis = lerMiniaturas_(miniIds);
  PESSOAS.forEach(function (p) {
    if (momentos[p]) momentos[p] = publicaMomento_(momentos[p], minis);
  });

  return {
    versao: VERSAO,
    eu: eu,
    hoje: hoje,
    amanha: amanha,
    ontem: ontem,
    semana: { inicio: semIni, fim: semFim },
    atualizadoEm: agoraIso_(),
    pessoas: pessoas,
    tarefas: listas,
    metasSemana: metasSemana,
    metasLongo: metasLongo,
    dieta: dieta,
    dietaDias: dietaDias,
    peso: peso,
    momentos: momentos,          // foto + recado (usado até a versão 1.2; hoje só aparece nas Memórias)
    quadro: lerQuadros_([hoje])[hoje] || porPessoa_([]),
    remedio: lerRemedio_()
  };
}

/* =========================================================================
 * Anticoncepcional (calendário: um dia marcado = tomou, com a hora)
 * ========================================================================= */

/** Mapa { "aaaa-mm-dd": { hora: "21:30", por: "ela" } } com todos os dias marcados. */
function lerRemedio_() {
  var dias = {};
  ler_('Anticoncepcional').forEach(function (r) {
    var d = dataStr_(r.data);
    if (!d) return;
    dias[d] = { hora: horaStr_(r.hora), por: pessoa_(r.marcado_por) || '' };
  });
  return dias;
}

/** Marca (ou muda a hora de) um dia; com "desmarcar" tira a marca. Os dois podem marcar. */
function acaoMarcarRemedio_(c, eu) {
  var data = dataStr_(c.data);
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(String(c.data).trim())) throw erro_('Data inválida.');
  if (data > hoje_()) throw erro_('Não dá para marcar um dia que ainda não chegou.');
  var linhas = ler_('Anticoncepcional').filter(function (r) { return dataStr_(r.data) === data; });
  if (c.desmarcar) {
    // Apaga de baixo para cima para os números das linhas não mudarem no meio do caminho.
    linhas.sort(function (a, b) { return b._linha - a._linha; }).forEach(function (r) { excluirLinha_('Anticoncepcional', r._linha); });
  } else {
    var hora = horaStr_(c.hora);
    if (!hora) throw erro_('Hora inválida. Use o formato 21:30.');
    var campos = { data: data, hora: hora, marcado_por: eu, atualizado_em: agoraIso_() };
    if (linhas.length) atualizar_('Anticoncepcional', linhas[0]._linha, campos);
    else acrescentar_('Anticoncepcional', campos);
  }
  return { estado: montarEstado_(eu) };
}

/** Converte "21:30", "9:05", "21h30", um horário Date ou fração de dia da planilha para "HH:mm" ("" se inválido). */
function horaStr_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, FUSO, 'HH:mm');
  }
  if (typeof v === 'number') {
    if (v < 0 || v >= 1) return '';
    var min = Math.round(v * 1440) % 1440;
    return pad2_(Math.floor(min / 60)) + ':' + pad2_(min % 60);
  }
  var m = /^(\d{1,2})\s*[:h]\s*(\d{2})?(?::\d{2})?$/i.exec(String(v).trim());
  if (!m) return '';
  var hh = +m[1], mm = m[2] ? +m[2] : 0;
  if (hh > 23 || mm > 59) return '';
  return pad2_(hh) + ':' + pad2_(mm);
}

/* =========================================================================
 * Tarefas
 * ========================================================================= */

/** Refeições e totais de cada pessoa, para cada dia de "inicio" a "fim" (dias sem registro vêm vazios). */
function dietaPorDia_(inicio, fim) {
  var dias = {};
  for (var d = inicio; d <= fim; d = somarDias_(d, 1)) {
    dias[d] = porPessoa_(null);
    PESSOAS.forEach(function (p) {
      dias[d][p] = { itens: [], totais: { kcal: 0, proteina: 0, carbo: 0, gordura: 0 } };
    });
  }
  ler_('Dieta').forEach(function (r) {
    var p = pessoa_(r.pessoa), dia = dias[dataStr_(r.data)];
    if (!p || !dia) return;
    var item = {
      refeicao: texto_(r.refeicao), alimento: texto_(r.alimento), quantidade: texto_(r.quantidade),
      kcal: num_(r.kcal), proteina: num_(r.proteina_g), carbo: num_(r.carbo_g), gordura: num_(r.gordura_g), obs: texto_(r.obs)
    };
    dia[p].itens.push(item);
    dia[p].totais.kcal += item.kcal;
    dia[p].totais.proteina += item.proteina;
    dia[p].totais.carbo += item.carbo;
    dia[p].totais.gordura += item.gordura;
  });
  return dias;
}

function acaoAddTarefa_(c, eu) {
  var texto = textoLimpo_(c.texto, 200, false);
  if (!texto) throw erro_('Escreva a tarefa.');
  var hoje = hoje_();
  var data = dataStr_(c.data) || hoje;
  if (data < somarDias_(hoje, -1) || data > somarDias_(hoje, 7)) throw erro_('Só dá para criar tarefas de ontem até daqui a 7 dias.');
  acrescentar_('Tarefas', {
    id: novoId_('t'), pessoa: eu, data: data, texto: texto, feita: false, feita_em: '',
    criada_em: agoraIso_(), origem: 'site', pendencia: ''
  });
  return { estado: montarEstado_(eu) };
}

function acaoEditarTarefa_(c, eu) {
  var t = tarefaPropria_(c.id, eu);
  var texto = textoLimpo_(c.texto, 200, false);
  if (!texto) throw erro_('A tarefa não pode ficar vazia.');
  atualizar_('Tarefas', t._linha, { texto: texto });
  return { estado: montarEstado_(eu) };
}

function acaoMarcarTarefa_(c, eu) {
  var t = tarefaPropria_(c.id, eu);
  var feita = !!c.feita;
  atualizar_('Tarefas', t._linha, { feita: feita, feita_em: feita ? agoraIso_() : '' });
  return { estado: montarEstado_(eu) };
}

function acaoExcluirTarefa_(c, eu) {
  var t = tarefaPropria_(c.id, eu);
  excluirLinha_('Tarefas', t._linha);
  return { estado: montarEstado_(eu) };
}

/** Copia uma tarefa pendente para hoje; a original fica marcada como "trazida" (o histórico continua honesto). */
function acaoTrazerTarefa_(c, eu) {
  var t = tarefaPropria_(c.id, eu);
  var hoje = hoje_();
  if (t.feita || t.data >= hoje) throw erro_('Essa tarefa não está pendente.');
  acrescentar_('Tarefas', {
    id: novoId_('t'), pessoa: eu, data: hoje, texto: t.texto, feita: false, feita_em: '',
    criada_em: agoraIso_(), origem: 'trazida', pendencia: ''
  });
  atualizar_('Tarefas', t._linha, { pendencia: 'trazida' });
  return { estado: montarEstado_(eu) };
}

function acaoDescartarPendente_(c, eu) {
  var t = tarefaPropria_(c.id, eu);
  atualizar_('Tarefas', t._linha, { pendencia: 'descartada' });
  return { estado: montarEstado_(eu) };
}

function tarefaPropria_(id, eu) {
  id = String(id || '').trim();
  if (!id) throw erro_('Tarefa não encontrada.');
  var linha = ler_('Tarefas').filter(function (r) { return String(r.id).trim() === id; })[0];
  if (!linha) throw erro_('Tarefa não encontrada. Talvez já tenha sido apagada.', 'nao_encontrado');
  var t = tarefaObj_(linha);
  if (t.pessoa !== eu) throw erro_('Você só pode mudar as suas tarefas.', 'proibido');
  return t;
}

/** Tarefas adicionadas à mão (ou pelo Claude) sem id recebem um id automaticamente. */
function curarIdsTarefas_(linhas) {
  var faltando = linhas.filter(function (r) { return !String(r.id || '').trim() && String(r.texto || '').trim(); });
  if (!faltando.length) return;
  var trava = LockService.getScriptLock();
  if (!trava.tryLock(5000)) return;
  try {
    faltando.forEach(function (r) {
      var id = novoId_('t');
      atualizar_('Tarefas', r._linha, { id: id });
      r.id = id;
    });
  } finally {
    trava.releaseLock();
  }
}

/* =========================================================================
 * Metas
 * ========================================================================= */

function acaoSalvarMetaSemana_(c, eu) {
  var temId = String(c.id || '').trim();
  var campos = {};
  if (c.hasOwnProperty('titulo')) {
    campos.titulo = textoLimpo_(c.titulo, 80, false);
    if (!campos.titulo) throw erro_('Dê um nome para a meta.');
  }
  if (c.hasOwnProperty('vezes')) {
    var v = Math.round(num_(c.vezes));
    if (v < 1 || v > 21) throw erro_('Escolha de 1 a 21 vezes por semana.');
    campos.vezes_por_semana = v;
  }
  if (c.hasOwnProperty('ativa')) campos.ativa = !!c.ativa;

  if (temId) {
    var m = metaPropria_('MetasSemana', temId, eu);
    atualizar_('MetasSemana', m._linha, campos);
  } else {
    if (!campos.titulo) throw erro_('Dê um nome para a meta.');
    acrescentar_('MetasSemana', {
      id: novoId_('ms'), pessoa: eu, titulo: campos.titulo, vezes_por_semana: campos.vezes_por_semana || 3,
      ativa: true, criada_em: agoraIso_()
    });
  }
  return { estado: montarEstado_(eu) };
}

/** delta = 1 registra mais uma vez nesta semana; delta = -1 desfaz a última desta semana. */
function acaoMarcarMetaSemana_(c, eu) {
  var m = metaPropria_('MetasSemana', c.id, eu);
  var hoje = hoje_();
  if (Number(c.delta) < 0) {
    var ini = inicioSemana_(hoje), fim = somarDias_(ini, 6);
    var desta = ler_('MetasSemanaLog').filter(function (r) {
      var d = dataStr_(r.data);
      return String(r.meta_id).trim() === m.id && d >= ini && d <= fim;
    });
    if (!desta.length) throw erro_('Ainda não há nada para desfazer nesta semana.');
    var ultima = desta.reduce(function (a, b) { return b._linha > a._linha ? b : a; });
    excluirLinha_('MetasSemanaLog', ultima._linha);
  } else {
    acrescentar_('MetasSemanaLog', { data: hoje, meta_id: m.id, pessoa: eu, registrado_em: agoraIso_() });
  }
  return { estado: montarEstado_(eu) };
}

function acaoSalvarMetaLongo_(c, eu) {
  var temId = String(c.id || '').trim();
  var campos = {};
  if (c.hasOwnProperty('titulo')) {
    campos.titulo = textoLimpo_(c.titulo, 80, false);
    if (!campos.titulo) throw erro_('Dê um nome para a meta.');
  }
  ['inicial', 'atual', 'alvo'].forEach(function (k) {
    if (!c.hasOwnProperty(k)) return;
    var v = numOuNulo_(c[k]);
    if (v === null) throw erro_('Preencha o valor "' + k + '" com um número.');
    campos[k] = v;
  });
  if (c.hasOwnProperty('unidade')) campos.unidade = textoLimpo_(c.unidade, 20, false);
  if (c.hasOwnProperty('prazo')) campos.prazo = dataStr_(c.prazo);
  if (c.hasOwnProperty('ativa')) campos.ativa = !!c.ativa;
  campos.atualizada_em = agoraIso_();

  if (temId) {
    var m = metaPropria_('MetasLongo', temId, eu);
    var atual = metaLongoObj_(m);
    var inicial = campos.hasOwnProperty('inicial') ? campos.inicial : atual.inicial;
    var alvo = campos.hasOwnProperty('alvo') ? campos.alvo : atual.alvo;
    if (alvo === inicial) throw erro_('O alvo precisa ser diferente do valor inicial.');
    atualizar_('MetasLongo', m._linha, campos);
  } else {
    if (!campos.titulo) throw erro_('Dê um nome para a meta.');
    if (!campos.hasOwnProperty('alvo')) throw erro_('Diga qual é o alvo.');
    var ini = campos.hasOwnProperty('inicial') ? campos.inicial : 0;
    if (campos.alvo === ini) throw erro_('O alvo precisa ser diferente do valor inicial.');
    acrescentar_('MetasLongo', {
      id: novoId_('ml'), pessoa: eu, titulo: campos.titulo, inicial: ini,
      atual: campos.hasOwnProperty('atual') ? campos.atual : ini, alvo: campos.alvo,
      unidade: campos.unidade || '', prazo: campos.prazo || '', ativa: true, atualizada_em: campos.atualizada_em
    });
  }
  return { estado: montarEstado_(eu) };
}

function metaPropria_(aba, id, eu) {
  id = String(id || '').trim();
  var linha = id && ler_(aba).filter(function (r) { return String(r.id).trim() === id; })[0];
  if (!linha) throw erro_('Meta não encontrada.', 'nao_encontrado');
  if (pessoa_(linha.pessoa) !== eu) throw erro_('Você só pode mudar as suas metas.', 'proibido');
  linha.id = id;
  return linha;
}

/* =========================================================================
 * Momentos (foto + recado do dia)
 * ========================================================================= */

function acaoSalvarMomento_(c, eu) {
  var hoje = hoje_();
  var recado = textoLimpo_(c.recado, 500, true);
  var linhas = ler_('Momentos');
  var existente = linhas.filter(function (r) { return dataStr_(r.data) === hoje && pessoa_(r.pessoa) === eu; })[0];
  var fotoId = existente ? texto_(existente.foto_id) : '';
  var miniId = existente ? texto_(existente.miniatura_id) : '';

  var novaFoto = null, novaMini = null;
  if (c.foto) {
    novaFoto = decodificarImagem_(c.foto, LIMITE_FOTO_CHARS);
    if (c.miniatura) {
      if (String(c.miniatura).length > LIMITE_MINIATURA_CHARS) throw erro_('A miniatura ficou grande demais.');
      decodificarImagem_(c.miniatura, LIMITE_MINIATURA_CHARS); // só valida o formato
      novaMini = String(c.miniatura);
    }
  }

  if (novaFoto || c.removerFoto) {
    apagarFoto_(fotoId);
    apagarMiniatura_(miniId);
    fotoId = '';
    miniId = '';
  }
  if (novaFoto) {
    var arquivo = pastaFotos_().createFile(novaFoto.setName(hoje + '_' + eu + '.jpg'));
    fotoId = arquivo.getId();
    if (novaMini) {
      miniId = novoId_('mi');
      acrescentar_('Miniaturas', { id: miniId, base64: novaMini });
    }
  }

  if (!recado && !fotoId) {
    if (existente) excluirLinha_('Momentos', existente._linha);
    else throw erro_('Escreva um recado ou escolha uma foto.');
    return { estado: montarEstado_(eu) };
  }

  var campos = { data: hoje, pessoa: eu, recado: recado, foto_id: fotoId, miniatura_id: miniId, atualizado_em: agoraIso_() };
  if (existente) atualizar_('Momentos', existente._linha, campos);
  else acrescentar_('Momentos', campos);
  return { estado: montarEstado_(eu) };
}

/** Devolve a foto em tamanho cheio. Só entrega arquivos que pertencem a algum momento (nada de outros arquivos do Drive). */
function acaoFoto_(c) {
  var id = String(c.id || '').trim();
  var valido = id && ler_('Momentos').some(function (r) { return texto_(r.foto_id) === id; });
  if (!valido) throw erro_('Foto não encontrada.', 'nao_encontrado');
  var blob = DriveApp.getFileById(id).getBlob();
  return { foto: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
}

/** Histórico de momentos, do mais recente para o mais antigo, em páginas de alguns dias. */
function acaoMemorias_(c) {
  var antesDe = dataStr_(c.antesDe) || somarDias_(hoje_(), 1);
  var limite = Math.min(Math.max(parseInt(c.limite, 10) || 8, 1), 20);
  var porData = {};
  ler_('Momentos').forEach(function (r) {
    var m = momentoObj_(r);
    if (!m.pessoa || !m.data || m.data >= antesDe) return;
    (porData[m.data] = porData[m.data] || {})[m.pessoa] = m;
  });
  var quadros = lerQuadros_();
  Object.keys(quadros).forEach(function (d) {
    if (d < antesDe && !porData[d]) porData[d] = {};
  });
  var datas = Object.keys(porData).sort().reverse();
  var pagina = datas.slice(0, limite);
  var ids = [];
  pagina.forEach(function (d) {
    PESSOAS.forEach(function (p) { if (porData[d][p] && porData[d][p].miniaturaId) ids.push(porData[d][p].miniaturaId); });
  });
  var minis = lerMiniaturas_(ids);
  var dias = pagina.map(function (d) {
    var dia = { data: d, quadro: quadros[d] || null };
    PESSOAS.forEach(function (p) { dia[p] = porData[d][p] ? publicaMomento_(porData[d][p], minis) : null; });
    return dia;
  });
  return { dias: dias, temMais: datas.length > limite };
}

function pastaFotos_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PASTA_FOTOS');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* pasta apagada: cria outra */ }
  }
  var pasta = DriveApp.createFolder('Nós dois - fotos (não apagar)');
  props.setProperty('PASTA_FOTOS', pasta.getId());
  return pasta;
}

function decodificarImagem_(dataUrl, limite) {
  var s = String(dataUrl || '');
  if (s.length > limite) throw erro_('A foto é grande demais.');
  var m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(s);
  if (!m) throw erro_('Formato de imagem inválido. Use JPG, PNG ou WEBP.');
  return Utilities.newBlob(Utilities.base64Decode(m[2]), m[1]);
}

function apagarFoto_(id) {
  if (!id) return;
  try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* já não existe */ }
}

function apagarMiniatura_(id) {
  if (!id) return;
  var sh = aba_('Miniaturas');
  var ultima = sh.getLastRow();
  if (ultima < 2) return;
  var col = sh.getRange(2, 1, ultima - 1, 1).getValues();
  for (var i = col.length - 1; i >= 0; i--) {
    if (String(col[i][0]) === id) sh.deleteRow(i + 2);
  }
}

function lerMiniaturas_(ids) {
  var out = {};
  ids = (ids || []).filter(Boolean);
  if (!ids.length) return out;
  var sh = aba_('Miniaturas');
  var ultima = sh.getLastRow();
  if (ultima < 2) return out;
  var alvo = {};
  ids.forEach(function (id) { alvo[id] = true; });
  var col = sh.getRange(2, 1, ultima - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    var id = String(col[i][0]);
    if (alvo[id]) out[id] = String(sh.getRange(i + 2, 2).getValue());
  }
  return out;
}

/* =========================================================================
 * Quadro do dia (um quadro branco por dia, compartilhado; cada um desenha com a sua cor)
 *
 * Cada pessoa tem uma linha por dia na aba Quadro, com todos os seus traços em JSON:
 *   [[espessura, x1, y1, x2, y2, ...], ...]
 * As coordenadas vão de 0 a 1000 (proporção do quadro), então o desenho fica igual em qualquer tela.
 * Como cada um só grava a própria linha, os dois podem desenhar ao mesmo tempo sem um apagar o outro.
 * ========================================================================= */

/** Traços de todos os dias de "datas" (ou de todos os dias, se "datas" for omitido): { dia: { ele: [...], ela: [...] } }. */
function lerQuadros_(datas) {
  var alvo = null;
  if (datas) { alvo = {}; datas.forEach(function (d) { alvo[d] = true; }); }
  var out = {};
  ler_('Quadro').forEach(function (r) {
    var d = dataStr_(r.data), p = pessoa_(r.pessoa);
    if (!d || !p || (alvo && !alvo[d])) return;
    var tracos = tracosDoTexto_(r.tracos);
    if (!tracos.length) return;
    if (!out[d]) out[d] = porPessoa_([]);
    out[d][p] = tracos;
  });
  return out;
}

function tracosDoTexto_(v) {
  try {
    var t = JSON.parse(String(v || '[]'));
    return Array.isArray(t) ? t : [];
  } catch (e) {
    return [];
  }
}

/** Leitura leve usada pelo site a cada poucos segundos enquanto o quadro está aberto. */
function acaoQuadro_() {
  var hoje = hoje_();
  return { quadro: { data: hoje, tracos: lerQuadros_([hoje])[hoje] || porPessoa_([]) } };
}

/** Grava todos os traços de hoje de quem está desenhando (substitui a linha dela/dele). Lista vazia apaga. */
function acaoSalvarQuadro_(c, eu) {
  var hoje = hoje_();
  if (c.data && dataStr_(c.data) !== hoje) throw erro_('O dia virou: o quadro de ontem já foi para as Memórias.', 'dia_virou');
  var tracos = validarTracos_(c.tracos);
  var texto = JSON.stringify(tracos);
  if (texto.length > LIMITE_QUADRO_CHARS) throw erro_('O quadro de hoje ficou cheio. Desfaça alguns traços para continuar.', 'quadro_cheio');
  var linha = ler_('Quadro').filter(function (r) { return dataStr_(r.data) === hoje && pessoa_(r.pessoa) === eu; })[0];
  if (!tracos.length) {
    if (linha) excluirLinha_('Quadro', linha._linha);
  } else {
    var campos = { data: hoje, pessoa: eu, tracos: texto, atualizado_em: agoraIso_() };
    if (linha) atualizar_('Quadro', linha._linha, campos);
    else acrescentar_('Quadro', campos);
  }
  return acaoQuadro_();
}

/** Confere o formato dos traços e devolve uma cópia limpa (só números inteiros dentro do quadro). */
function validarTracos_(v) {
  if (!Array.isArray(v)) throw erro_('Desenho inválido.');
  if (v.length > MAX_TRACOS) throw erro_('O quadro de hoje ficou cheio. Desfaça alguns traços para continuar.', 'quadro_cheio');
  return v.map(function (t) {
    if (!Array.isArray(t) || t.length < 3 || t.length % 2 !== 1) throw erro_('Desenho inválido.');
    return t.map(function (n, i) {
      n = Math.round(Number(n));
      if (!isFinite(n)) throw erro_('Desenho inválido.');
      if (i === 0) return Math.min(Math.max(n, 1), 60);   // espessura
      return Math.min(Math.max(n, 0), 1000);               // coordenada
    });
  });
}

/* =========================================================================
 * Progresso (sequências, gráficos)
 * ========================================================================= */

function acaoProgresso_() {
  var hoje = hoje_();
  var limiteHist = somarDias_(hoje, -730);

  // Tarefas por dia e pessoa
  var porDia = {};
  ler_('Tarefas').map(tarefaObj_).forEach(function (t) {
    if (!t.pessoa || !t.data || t.data > hoje || t.data < limiteHist) return;
    var d = porDia[t.data] || (porDia[t.data] = contadorVazio_());
    d[t.pessoa].total++;
    if (t.feita) d[t.pessoa].feitas++;
  });
  var serieTarefas = [];
  for (var i = 29; i >= 0; i--) {
    var dia = somarDias_(hoje, -i);
    var cont = porDia[dia] || contadorVazio_();
    serieTarefas.push({ data: dia, ele: cont.ele, ela: cont.ela });
  }
  var primeiraTarefa = Object.keys(porDia).sort()[0] || hoje;
  var sequencias = {};
  PESSOAS.forEach(function (p) {
    sequencias[p] = calcularSequencia_(hoje, primeiraTarefa, function (d) {
      var x = porDia[d] && porDia[d][p];
      if (!x || !x.total) return null;          // dia sem tarefas: não conta nem quebra
      return x.feitas === x.total;
    });
  });

  // Dias em que os dois participaram: postaram o momento (até a versão 1.2) ou desenharam no quadro
  var postou = {};
  var quadros = lerQuadros_();
  Object.keys(quadros).forEach(function (d) {
    if (d > hoje || d < limiteHist) return;
    PESSOAS.forEach(function (p) { if (quadros[d][p].length) (postou[d] = postou[d] || {})[p] = true; });
  });
  ler_('Momentos').forEach(function (r) {
    var m = momentoObj_(r);
    if (!m.pessoa || !m.data || m.data > hoje || m.data < limiteHist) return;
    if (m.recado || m.fotoId) (postou[m.data] = postou[m.data] || {})[m.pessoa] = true;
  });
  var primeiroMomento = Object.keys(postou).sort()[0] || hoje;
  var sequenciaCasal = calcularSequencia_(hoje, primeiroMomento, function (d) {
    return !!(postou[d] && postou[d].ele && postou[d].ela);
  });

  // Calorias dos últimos 14 dias
  var pessoas = lerPessoas_();
  var kcal = {};
  ler_('Dieta').forEach(function (r) {
    var d = dataStr_(r.data), p = pessoa_(r.pessoa);
    if (!d || !p) return;
    var k = kcal[d] || (kcal[d] = { ele: null, ela: null });
    k[p] = (k[p] || 0) + num_(r.kcal);
  });
  var serieKcal = [];
  for (var j = 13; j >= 0; j--) {
    var dk = somarDias_(hoje, -j);
    var v = kcal[dk] || { ele: null, ela: null };
    serieKcal.push({ data: dk, ele: v.ele, ela: v.ela });
  }

  // Peso (histórico completo)
  var peso = porPessoa_([]);
  ler_('Peso').forEach(function (r) {
    var p = pessoa_(r.pessoa), d = dataStr_(r.data), kg = numOuNulo_(r.peso_kg);
    if (p && d && kg !== null) peso[p].push({ data: d, kg: kg });
  });
  PESSOAS.forEach(function (p) { peso[p].sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : 0; }); });

  // Metas da semana cumpridas nas últimas 8 semanas
  var metas = ler_('MetasSemana').map(metaSemanaObj_).filter(function (m) { return m.pessoa && m.id; });
  var log = ler_('MetasSemanaLog').map(logMetaObj_);
  var semanaAtual = inicioSemana_(hoje);
  var serieMetas = [];
  for (var w = 7; w >= 0; w--) {
    var ini = somarDias_(semanaAtual, -7 * w), fim = somarDias_(ini, 6);
    var item = { inicio: ini, ele: { cumpridas: 0, total: 0 }, ela: { cumpridas: 0, total: 0 } };
    metas.forEach(function (m) {
      var feitas = log.filter(function (l) { return l.metaId === m.id && l.data >= ini && l.data <= fim; }).length;
      var criada = m.criadaEm ? m.criadaEm.slice(0, 10) : '';
      var existia = (!criada || criada <= fim) && (m.ativa || feitas > 0);
      if (!existia) return;
      item[m.pessoa].total++;
      if (feitas >= m.vezes) item[m.pessoa].cumpridas++;
    });
    serieMetas.push(item);
  }

  return {
    progresso: {
      hoje: hoje,
      tarefas: serieTarefas,
      sequencias: sequencias,
      sequenciaCasal: sequenciaCasal,
      kcal: serieKcal,
      metasKcal: { ele: pessoas.ele.metaKcal, ela: pessoas.ela.metaKcal },
      peso: peso,
      pesoMeta: { ele: pessoas.ele.pesoMeta, ela: pessoas.ela.pesoMeta },
      metasSemana: serieMetas
    }
  };
}

/**
 * Sequência de dias seguidos em que "ok(dia)" é verdadeiro.
 * ok(dia) devolve true (conta), false (quebra) ou null (dia neutro: pula).
 * Hoje só soma se já estiver completo; se não estiver, não quebra (o dia ainda não acabou).
 */
function calcularSequencia_(hoje, primeira, ok) {
  var atual = 0;
  if (ok(hoje) === true) atual = 1;
  var d = somarDias_(hoje, -1);
  while (d >= primeira) {
    var r = ok(d);
    if (r === true) atual++;
    else if (r === false) break;
    d = somarDias_(d, -1);
  }
  var recorde = 0, corrida = 0;
  d = primeira;
  while (d <= hoje) {
    var x = ok(d);
    if (x === true) {
      corrida++;
      if (corrida > recorde) recorde = corrida;
    } else if (x === false && d !== hoje) {
      corrida = 0;
    }
    d = somarDias_(d, 1);
  }
  return { atual: atual, recorde: Math.max(recorde, atual) };
}

/* =========================================================================
 * Menu da planilha e preparação
 * ========================================================================= */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Dashboard')
    .addItem('Preparar planilha', 'prepararPlanilha')
    .addSeparator()
    .addItem('Definir PIN dele', 'menuPinEle')
    .addItem('Definir PIN dela', 'menuPinEla')
    .addToUi();
}

function prepararPlanilha() {
  prepararPlanilha_();
  SpreadsheetApp.getUi().alert('Planilha pronta. Agora defina os PINs pelo menu Dashboard.');
}

function menuPinEle() { menuPin_('ele'); }
function menuPinEla() { menuPin_('ela'); }

function menuPin_(p) {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Definir PIN (' + p + ')', 'Digite um PIN de 4 a 8 números. Quem já estava logado como "' + p + '" vai precisar entrar de novo.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  try {
    definirPin_(p, r.getResponseText().trim());
    ui.alert('PIN de "' + p + '" salvo.');
  } catch (e) {
    ui.alert(e.message);
  }
}

/** Cria as abas que faltam (sem mexer nos dados existentes) e guarda o id da planilha. */
function prepararPlanilha_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(FUSO);
  PropertiesService.getScriptProperties().setProperty('PLANILHA_ID', ss.getId());
  _ss = ss;
  _abas = {};
  _cabecalhos = {};
  Object.keys(ABAS).forEach(function (nome) {
    var sh = ss.getSheetByName(nome);
    if (!sh) {
      criarAba_(ss, nome);
      return;
    }
    var cab = cabecalho_(sh, true);
    var faltam = ABAS[nome].filter(function (col) { return cab.indexOf(col) < 0; });
    if (faltam.length) {
      var inicio = cab.length + 1;
      sh.getRange(1, inicio, 1, faltam.length).setValues([faltam]).setFontWeight('bold').setBackground('#FFEADF');
      faltam.forEach(function (col, i) {
        if (COLUNAS_TEXTO[col]) sh.getRange(2, inicio + i, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
      });
      delete _cabecalhos[nome];
    }
  });
  var existentes = ler_('Pessoas').map(function (r) { return pessoa_(r.id); });
  PESSOAS.forEach(function (p) {
    if (existentes.indexOf(p) < 0) acrescentar_('Pessoas', { id: p });
  });
  ['Página1', 'Sheet1', 'Planilha1'].forEach(function (n) {
    var s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
  pastaFotos_();
}

/* =========================================================================
 * Acesso à planilha
 * ========================================================================= */

function planilha_() {
  if (_ss) return _ss;
  var id = PropertiesService.getScriptProperties().getProperty('PLANILHA_ID');
  _ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!_ss) throw erro_('Planilha não encontrada. Abra a planilha e use Dashboard > Preparar planilha.');
  return _ss;
}

function aba_(nome) {
  if (_abas[nome]) return _abas[nome];
  var ss = planilha_();
  var sh = ss.getSheetByName(nome) || criarAba_(ss, nome);
  _abas[nome] = sh;
  return sh;
}

function criarAba_(ss, nome) {
  var cab = ABAS[nome];
  var sh = ss.insertSheet(nome);
  sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#FFEADF');
  sh.setFrozenRows(1);
  var linhas = Math.max(sh.getMaxRows() - 1, 1);
  cab.forEach(function (col, i) {
    if (COLUNAS_TEXTO[col]) sh.getRange(2, i + 1, linhas, 1).setNumberFormat('@');
  });
  if (nome === 'Miniaturas') sh.hideSheet();
  return sh;
}

function cabecalho_(sh, semCache) {
  var nome = sh.getName();
  if (!semCache && _cabecalhos[nome]) return _cabecalhos[nome];
  var n = sh.getLastColumn();
  var cab = n < 1 ? [] : sh.getRange(1, 1, 1, n).getValues()[0].map(function (c) {
    return String(c).trim().toLowerCase();
  });
  _cabecalhos[nome] = cab;
  return cab;
}

/** Lê uma aba inteira como lista de objetos { coluna: valor, _linha: número da linha }. */
function ler_(nome) {
  var sh = aba_(nome);
  var ultima = sh.getLastRow();
  var cab = cabecalho_(sh);
  if (ultima < 2 || !cab.length) return [];
  var valores = sh.getRange(2, 1, ultima - 1, cab.length).getValues();
  var out = [];
  for (var r = 0; r < valores.length; r++) {
    var linha = valores[r];
    var vazia = true;
    for (var k = 0; k < linha.length; k++) {
      if (linha[k] !== '' && linha[k] !== null) { vazia = false; break; }
    }
    if (vazia) continue;
    var o = { _linha: r + 2 };
    for (var c = 0; c < cab.length; c++) if (cab[c]) o[cab[c]] = linha[c];
    out.push(o);
  }
  return out;
}

function acrescentar_(nome, obj) {
  var sh = aba_(nome);
  var cab = cabecalho_(sh);
  var linha = sh.getLastRow() + 1;
  if (linha > sh.getMaxRows()) {
    var antes = sh.getMaxRows();
    sh.insertRowsAfter(antes, 200);
    cab.forEach(function (col, i) {
      if (COLUNAS_TEXTO[col]) sh.getRange(antes + 1, i + 1, 200, 1).setNumberFormat('@');
    });
  }
  var valores = cab.map(function (col) { return valorCelula_(obj.hasOwnProperty(col) ? obj[col] : ''); });
  sh.getRange(linha, 1, 1, cab.length).setValues([valores]);
  return linha;
}

function atualizar_(nome, linha, campos) {
  var sh = aba_(nome);
  var cab = cabecalho_(sh);
  Object.keys(campos).forEach(function (k) {
    var i = cab.indexOf(k);
    if (i >= 0) sh.getRange(linha, i + 1).setValue(valorCelula_(campos[k]));
  });
}

function excluirLinha_(nome, linha) {
  aba_(nome).deleteRow(linha);
}

/** Impede que um texto começando com "=" vire fórmula na planilha (o apóstrofo não aparece no valor). */
function valorCelula_(v) {
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

/* =========================================================================
 * Conversões e objetos públicos
 * ========================================================================= */

function lerPessoas_() {
  var out = {};
  PESSOAS.forEach(function (p) {
    out[p] = { id: p, metaKcal: null, metaProteina: null, metaCarbo: null, metaGordura: null, pesoMeta: null };
  });
  ler_('Pessoas').forEach(function (r) {
    var p = pessoa_(r.id);
    if (!p) return;
    out[p] = {
      id: p,
      metaKcal: numOuNulo_(r.meta_kcal),
      metaProteina: numOuNulo_(r.meta_proteina_g),
      metaCarbo: numOuNulo_(r.meta_carbo_g),
      metaGordura: numOuNulo_(r.meta_gordura_g),
      pesoMeta: numOuNulo_(r.peso_meta_kg)
    };
  });
  return out;
}

function tarefaObj_(r) {
  return {
    id: texto_(r.id),
    pessoa: pessoa_(r.pessoa),
    data: dataStr_(r.data),
    texto: texto_(r.texto),
    feita: bool_(r.feita),
    feitaEm: ts_(r.feita_em),
    origem: texto_(r.origem),
    pendencia: texto_(r.pendencia).toLowerCase(),
    _linha: r._linha
  };
}

function publicaTarefa_(t) {
  return { id: t.id, pessoa: t.pessoa, data: t.data, texto: t.texto, feita: t.feita, feitaEm: t.feitaEm, origem: t.origem };
}

function metaSemanaObj_(r) {
  var vezes = Math.round(num_(r.vezes_por_semana));
  return {
    id: texto_(r.id), pessoa: pessoa_(r.pessoa), titulo: texto_(r.titulo),
    vezes: vezes > 0 ? vezes : 1, ativa: r.ativa === '' || r.ativa === null || r.ativa === undefined ? true : bool_(r.ativa),
    criadaEm: ts_(r.criada_em), _linha: r._linha
  };
}

function logMetaObj_(r) {
  return { data: dataStr_(r.data), metaId: texto_(r.meta_id), pessoa: pessoa_(r.pessoa), _linha: r._linha };
}

function metaLongoObj_(r) {
  var inicial = numOuNulo_(r.inicial);
  if (inicial === null) inicial = 0;
  var atual = numOuNulo_(r.atual);
  return {
    id: texto_(r.id), pessoa: pessoa_(r.pessoa), titulo: texto_(r.titulo),
    inicial: inicial, atual: atual === null ? inicial : atual, alvo: num_(r.alvo),
    unidade: texto_(r.unidade), prazo: dataStr_(r.prazo),
    ativa: r.ativa === '' || r.ativa === null || r.ativa === undefined ? true : bool_(r.ativa),
    atualizadaEm: ts_(r.atualizada_em)
  };
}

function publicaMetaLongo_(m) {
  var faixa = m.alvo - m.inicial;
  var pct = faixa === 0 ? 0 : (m.atual - m.inicial) / faixa;
  pct = Math.max(0, Math.min(1, pct));
  return {
    id: m.id, titulo: m.titulo, inicial: m.inicial, atual: m.atual, alvo: m.alvo, unidade: m.unidade,
    prazo: m.prazo, progresso: Math.round(pct * 1000) / 1000, atualizadaEm: m.atualizadaEm
  };
}

function momentoObj_(r) {
  return {
    data: dataStr_(r.data), pessoa: pessoa_(r.pessoa), recado: texto_(r.recado),
    fotoId: texto_(r.foto_id), miniaturaId: texto_(r.miniatura_id), atualizadoEm: ts_(r.atualizado_em)
  };
}

function publicaMomento_(m, minis) {
  return {
    recado: m.recado,
    fotoId: m.fotoId || null,
    miniatura: (m.miniaturaId && minis[m.miniaturaId]) || null,
    atualizadoEm: m.atualizadoEm
  };
}

function porPessoa_(inicial) {
  var o = {};
  PESSOAS.forEach(function (p) { o[p] = Array.isArray(inicial) ? [] : inicial; });
  return o;
}

function contadorVazio_() {
  return { ele: { total: 0, feitas: 0 }, ela: { total: 0, feitas: 0 } };
}

function pessoa_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return PESSOAS.indexOf(s) >= 0 ? s : '';
}

function texto_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return ts_(v);
  return String(v).trim();
}

function textoLimpo_(v, max, multilinha) {
  var s = String(v == null ? '' : v);
  if (multilinha) {
    s = s.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  } else {
    s = s.replace(/\s+/g, ' ');
  }
  s = s.trim();
  return s.length > max ? s.slice(0, max).trim() : s;
}

function bool_(v) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  return /^(true|verdadeiro|sim|s|x|1|feita|feito|ok)$/i.test(String(v).trim());
}

function num_(v) {
  var n = numOuNulo_(v);
  return n === null ? 0 : n;
}

/** Aceita 72.5, "72,5", "1.450,5", "2.100", "1450" etc. Vazio vira null. */
function numOuNulo_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v === null || v === undefined || v === true || v === false) return null;
  var s = String(v).trim().replace(/\s/g, '').replace(/[^0-9,.\-]/g, '');
  if (!s) return null;
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // "2.100" = dois mil e cem
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/** Converte qualquer forma de data que a planilha devolva para "aaaa-mm-dd". */
function dataStr_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, FUSO, 'yyyy-MM-dd');
  }
  if (typeof v === 'number') {
    if (v < 1 || v > 200000) return '';
    var d = new Date(Math.round((v - 25569) * 86400000)); // número de série do Sheets
    return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
  }
  var s = String(v).trim();
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad2_(m[2]) + '-' + pad2_(m[1]);
  return '';
}

function ts_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, FUSO, "yyyy-MM-dd'T'HH:mm:ss");
  }
  return String(v).trim();
}

/* =========================================================================
 * Datas (sempre texto "aaaa-mm-dd"; contas feitas em UTC para não sofrer com fuso)
 * ========================================================================= */

function agora_() {
  return new Date();
}

/** O dia só vira às HORA_VIRADA da manhã: 1h da madrugada ainda conta como o dia anterior. */
function hoje_() {
  return Utilities.formatDate(new Date(agora_().getTime() - HORA_VIRADA * 3600000), FUSO, 'yyyy-MM-dd');
}

function agoraIso_() {
  return Utilities.formatDate(agora_(), FUSO, "yyyy-MM-dd'T'HH:mm:ss");
}

function somarDias_(s, n) {
  var p = s.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}

function diaSemana_(s) {
  var p = s.split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
}

/** Segunda-feira da semana de "s". */
function inicioSemana_(s) {
  return somarDias_(s, -((diaSemana_(s) + 6) % 7));
}

function pad2_(n) {
  n = String(n);
  return n.length < 2 ? '0' + n : n;
}

function novoId_(prefixo) {
  return prefixo + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}
