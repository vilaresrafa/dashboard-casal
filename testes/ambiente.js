'use strict';
/**
 * Imitação (fake) dos serviços do Google Apps Script para rodar apps-script/Code.js no Node.
 * Cobre só o que o backend usa: SpreadsheetApp, DriveApp, PropertiesService, CacheService,
 * LockService, Utilities e ContentService.
 *
 * A planilha falsa imita o jeito do Google Sheets de interpretar o que é escrito:
 *  - texto que começa com "=" vira fórmula (aqui: "#FORMULA:..."), a menos que comece com apóstrofo;
 *  - em células que não são "texto puro" (@), "2026-11-18" vira data, "12" vira número, "TRUE" vira booleano.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const CAMINHO_CODIGO = path.join(__dirname, '..', 'apps-script', 'Code.js');
const FUSO = 'America/Sao_Paulo';

/* ---------------- Datas ---------------- */

function partes(date, tz) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return o;
}

function formatDate(date, tz, fmt) {
  const p = partes(date, tz);
  let out = '';
  let i = 0;
  while (i < fmt.length) {
    if (fmt[i] === "'") {
      const j = fmt.indexOf("'", i + 1);
      out += fmt.slice(i + 1, j);
      i = j + 1;
      continue;
    }
    if (fmt.startsWith('yyyy', i)) { out += p.year; i += 4; continue; }
    const t = fmt.slice(i, i + 2);
    const mapa = { MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second };
    if (mapa[t] !== undefined) { out += mapa[t]; i += 2; continue; }
    out += fmt[i];
    i++;
  }
  return out;
}

/** Data "aaaa-mm-dd" à meia-noite de São Paulo (UTC-3, sem horário de verão desde 2019). */
function dataSP(a, m, d, h = 0, mi = 0, s = 0) {
  return new Date(Date.UTC(a, m - 1, d, h + 3, mi, s));
}

/* ---------------- Planilha ---------------- */

class FakeRange {
  constructor(sheet, r, c, nr, nc) {
    if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error('Intervalo inválido');
    if (r + nr - 1 > sheet.maxRows || c + nc - 1 > sheet.maxCols) {
      throw new Error('As coordenadas do intervalo estão fora das dimensões da página.');
    }
    Object.assign(this, { sheet, r, c, nr, nc });
  }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const linha = [];
      for (let j = 0; j < this.nc; j++) linha.push(this.sheet.ler(this.r + i, this.c + j));
      out.push(linha);
    }
    return out;
  }
  getValue() { return this.sheet.ler(this.r, this.c); }
  setValues(v) {
    if (v.length !== this.nr || v.some((l) => l.length !== this.nc)) throw new Error('Dimensões não batem');
    v.forEach((linha, i) => linha.forEach((x, j) => this.sheet.escrever(this.r + i, this.c + j, x)));
    return this;
  }
  setValue(x) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.escrever(this.r + i, this.c + j, x);
    return this;
  }
  setNumberFormat(f) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.formatos.set(this.sheet.k(this.r + i, this.c + j), f);
    return this;
  }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
}

class FakeSheet {
  constructor(ss, nome) {
    this.ss = ss;
    this.nome = nome;
    this.celulas = new Map();
    this.formatos = new Map();
    this.maxRows = 1000;
    this.maxCols = 26;
    this.oculta = false;
    this.congeladas = 0;
  }
  k(r, c) { return r + ',' + c; }
  getName() { return this.nome; }
  ler(r, c) {
    const v = this.celulas.get(this.k(r, c));
    return v === undefined ? '' : v;
  }
  /** Escreve como o Sheets interpretaria um valor vindo do Apps Script. */
  escrever(r, c, v) {
    const chave = this.k(r, c);
    if (v === null || v === undefined || v === '') { this.celulas.delete(chave); return; }
    if (typeof v === 'string') {
      if (v.startsWith("'")) v = v.slice(1);
      else if (v.startsWith('=')) v = '#FORMULA:' + v;
      else if (this.formatos.get(chave) !== '@') v = interpretar(v);
    }
    this.celulas.set(chave, v);
  }
  /** Escrita crua (usada nos testes para simular dados digitados à mão ou pelo Claude). */
  escreverCru(r, c, v) {
    if (v === '' || v === null || v === undefined) this.celulas.delete(this.k(r, c));
    else this.celulas.set(this.k(r, c), v);
  }
  getLastRow() {
    let m = 0;
    for (const k of this.celulas.keys()) m = Math.max(m, +k.split(',')[0]);
    return m;
  }
  getLastColumn() {
    let m = 0;
    for (const k of this.celulas.keys()) m = Math.max(m, +k.split(',')[1]);
    return m;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  getRange(r, c, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc); }
  insertRowsAfter(depois, n) {
    const mover = (mapa) => {
      const novo = new Map();
      for (const [k, v] of mapa) {
        const [r, c] = k.split(',').map(Number);
        novo.set(this.k(r > depois ? r + n : r, c), v);
      }
      return novo;
    };
    this.celulas = mover(this.celulas);
    this.formatos = mover(this.formatos);
    this.maxRows += n;
  }
  deleteRow(linha) {
    if (linha < 1 || linha > this.maxRows) throw new Error('Linha fora do intervalo');
    const mover = (mapa) => {
      const novo = new Map();
      for (const [k, v] of mapa) {
        const [r, c] = k.split(',').map(Number);
        if (r === linha) continue;
        novo.set(this.k(r > linha ? r - 1 : r, c), v);
      }
      return novo;
    };
    this.celulas = mover(this.celulas);
    this.formatos = mover(this.formatos);
    this.maxRows -= 1;
  }
  appendRow(valores) {
    const r = this.getLastRow() + 1;
    if (r > this.maxRows) this.maxRows = r;
    valores.forEach((v, i) => this.escrever(r, i + 1, v));
    return this;
  }
  setFrozenRows(n) { this.congeladas = n; }
  hideSheet() { this.oculta = true; return this; }
  isSheetHidden() { return this.oculta; }

  /** Ajuda dos testes: linhas como objetos pelo cabeçalho. */
  objetos() {
    const ultima = this.getLastRow();
    const nc = this.getLastColumn();
    const cab = [];
    for (let c = 1; c <= nc; c++) cab.push(String(this.ler(1, c)));
    const out = [];
    for (let r = 2; r <= ultima; r++) {
      const o = { _linha: r };
      cab.forEach((h, i) => { o[h] = this.ler(r, i + 1); });
      out.push(o);
    }
    return out;
  }
  /** Ajuda dos testes: acrescenta uma linha crua (sem interpretação) pelo nome das colunas. */
  acrescentarCru(obj) {
    const nc = this.getLastColumn();
    const r = this.getLastRow() + 1;
    for (let c = 1; c <= nc; c++) {
      const h = String(this.ler(1, c));
      if (Object.prototype.hasOwnProperty.call(obj, h)) this.escreverCru(r, c, obj[h]);
    }
    return r;
  }
}

function interpretar(s) {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return dataSP(+m[1], +m[2], +m[3]);
  m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (m) return dataSP(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(s);
  if (m) return dataSP(m[3] ? +m[3] : 2026, +m[2], +m[1]);
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^true$/i.test(s)) return true;
  if (/^false$/i.test(s)) return false;
  return s;
}

class FakeSpreadsheet {
  constructor() {
    this.id = 'planilha_' + crypto.randomBytes(6).toString('hex');
    this.abas = [new FakeSheet(this, 'Página1')];
    this.fuso = 'Etc/GMT';
  }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheetByName(n) { return this.abas.find((a) => a.nome === n) || null; }
  getSheets() { return this.abas.slice(); }
  insertSheet(n) {
    if (this.getSheetByName(n)) throw new Error('Já existe uma página com o nome ' + n);
    const s = new FakeSheet(this, n);
    this.abas.push(s);
    return s;
  }
  deleteSheet(s) { this.abas = this.abas.filter((a) => a !== s); }
  setSpreadsheetTimeZone(tz) { this.fuso = tz; }
  getSpreadsheetTimeZone() { return this.fuso; }
}

/* ---------------- Drive ---------------- */

const comSinal = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const semSinal = (arr) => Buffer.from(arr.map((b) => b & 255));

class FakeBlob {
  constructor(bytes, tipo, nome) {
    this.buf = Buffer.isBuffer(bytes) ? bytes : semSinal(bytes);
    this.tipo = tipo || 'application/octet-stream';
    this.nome = nome || 'arquivo';
  }
  getBytes() { return comSinal(this.buf); }
  getContentType() { return this.tipo; }
  getName() { return this.nome; }
  setName(n) { this.nome = n; return this; }
  getDataAsString() { return this.buf.toString('utf8'); }
}

function criarDrive() {
  const arquivos = new Map();
  const pastas = new Map();
  const novoId = () => crypto.randomBytes(16).toString('hex');
  function criarArquivo(blob, pastaId) {
    const id = novoId();
    const arq = {
      id, pastaId, blob: new FakeBlob(blob.buf, blob.tipo, blob.nome), lixeira: false,
      getId: () => id,
      getName: () => arq.blob.nome,
      getBlob: () => new FakeBlob(arq.blob.buf, arq.blob.tipo, arq.blob.nome),
      setTrashed: (t) => { arq.lixeira = !!t; return arq; },
      isTrashed: () => arq.lixeira
    };
    arquivos.set(id, arq);
    return arq;
  }
  const DriveApp = {
    createFolder(nome) {
      const id = novoId();
      const pasta = {
        id, nome, lixeira: false,
        getId: () => id,
        getName: () => nome,
        createFile: (blob) => criarArquivo(blob, id)
      };
      pastas.set(id, pasta);
      return pasta;
    },
    getFolderById(id) {
      const p = pastas.get(id);
      if (!p || p.lixeira) throw new Error('Pasta não encontrada: ' + id);
      return p;
    },
    getFileById(id) {
      const a = arquivos.get(id);
      if (!a) throw new Error('Arquivo não encontrado: ' + id);
      return a;
    }
  };
  return { DriveApp, arquivos, pastas };
}

/* ---------------- Ambiente completo ---------------- */

/**
 * @param {object} opcoes
 * @param {string} [opcoes.agora] data/hora ISO fixa (ex.: '2026-11-18T12:00:00-03:00'); sem ela usa o relógio real
 */
function criarAmbiente(opcoes = {}) {
  const relogio = { fixo: !!opcoes.agora, ms: opcoes.agora ? new Date(opcoes.agora).getTime() : 0 };
  const agoraMs = () => (relogio.fixo ? relogio.ms : Date.now());

  const ss = new FakeSpreadsheet();
  const drive = criarDrive();
  const props = new Map();
  const cache = new Map();
  const errosLog = [];
  const travas = { tentativas: 0 };

  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: (id) => {
        if (id !== ss.getId()) throw new Error('Planilha não encontrada');
        return ss;
      },
      getUi: () => { throw new Error('Sem interface no ambiente de teste'); }
    },
    DriveApp: drive.DriveApp,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty(k, v) { props.set(k, String(v)); return this; },
        deleteProperty(k) { props.delete(k); return this; },
        getKeys: () => Array.from(props.keys()),
        getProperties: () => Object.fromEntries(props)
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get(k) {
          const e = cache.get(k);
          if (!e) return null;
          if (e.expira <= agoraMs()) { cache.delete(k); return null; }
          return e.v;
        },
        put(k, v, seg = 600) { cache.set(k, { v: String(v), expira: agoraMs() + seg * 1000 }); },
        remove(k) { cache.delete(k); }
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { travas.tentativas++; return true; },
        waitLock: () => { travas.tentativas++; },
        releaseLock: () => {},
        hasLock: () => true
      })
    },
    Utilities: {
      formatDate,
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, texto) => comSinal(crypto.createHash(alg).update(String(texto), 'utf8').digest()),
      base64Encode: (x) => (typeof x === 'string' ? Buffer.from(x, 'utf8') : semSinal(x)).toString('base64'),
      base64Decode: (s) => comSinal(Buffer.from(s, 'base64')),
      newBlob: (bytes, tipo, nome) => new FakeBlob(typeof bytes === 'string' ? Buffer.from(bytes) : semSinal(bytes), tipo, nome),
      sleep: () => {}
    },
    ContentService: {
      createTextOutput: (s) => ({ conteudo: s, setMimeType() { return this; }, getContent() { return this.conteudo; } }),
      MimeType: { JSON: 'application/json' }
    },
    console: {
      log: () => {},
      info: () => {},
      warn: () => {},
      error: (...a) => errosLog.push(a.join(' '))
    }
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(CAMINHO_CODIGO, 'utf8'), ctx, { filename: 'Code.js' });
  // Relógio controlável: o backend só pega "agora" por agora_().
  ctx.agora_ = () => new Date(agoraMs());

  function chamar(acao, dados = {}) {
    const saida = ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ acao }, dados)) } });
    return JSON.parse(saida.getContent());
  }

  function chamarCru(conteudo) {
    return JSON.parse(ctx.doPost({ postData: { contents: conteudo } }).getContent());
  }

  return {
    ctx, ss, drive, props, cache, errosLog, travas,
    chamar,
    chamarCru,
    aba: (n) => ss.getSheetByName(n),
    agora: () => new Date(agoraMs()),
    definirAgora(iso) { relogio.fixo = true; relogio.ms = new Date(iso).getTime(); },
    avancar(ms) { relogio.fixo = true; relogio.ms = agoraMs() + ms; },
    avancarDias(n) { relogio.fixo = true; relogio.ms = agoraMs() + n * 86400000; },
    login(pessoa, pin) {
      const r = chamar('login', { pessoa, pin });
      if (!r.ok) throw new Error('login falhou: ' + r.erro);
      return r.token;
    }
  };
}

module.exports = { criarAmbiente, dataSP, formatDate, FUSO };
