'use strict';
/**
 * Servidor de desenvolvimento: serve a pasta site/ e responde /api com o MESMO código do
 * Apps Script (apps-script/Code.js), rodando contra a planilha falsa em memória.
 *
 * Uso:  npm run dev          -> http://localhost:8787  (PINs de teste: ele 111111, ela 222222)
 * Variáveis opcionais: PORTA=8787  LATENCIA=400 (ms, imita a demora do Google)  VAZIO=1 (sem dados de exemplo)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { criarAmbiente } = require('../testes/ambiente');
const { semear } = require('./dados-teste');

const VAZIO = process.env.VAZIO === '1' || process.argv.includes('--vazio');
const argPorta = process.argv.find((a) => a.startsWith('--porta='));
const PORTA = Number(argPorta ? argPorta.split('=')[1] : process.env.PORTA) || 8787;
const LATENCIA = process.env.LATENCIA !== undefined ? Number(process.env.LATENCIA) : 400;
const RAIZ = path.join(__dirname, '..', 'site');
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const amb = criarAmbiente();
amb.ctx.prepararPlanilha_();
semear(amb, { vazio: VAZIO });

function responderApi(req, res) {
  const partes = [];
  let tamanho = 0;
  req.on('data', (p) => {
    tamanho += p.length;
    if (tamanho > 12 * 1024 * 1024) req.destroy();
    else partes.push(p);
  });
  req.on('end', () => {
    const corpo = Buffer.concat(partes).toString('utf8');
    setTimeout(() => {
      let saida;
      try {
        saida = amb.ctx.doPost({ postData: { contents: corpo } }).getContent();
      } catch (e) {
        saida = JSON.stringify({ ok: false, erro: 'Falha no servidor local: ' + e.message });
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(saida);
      let acao = '?';
      try { acao = JSON.parse(corpo).acao; } catch (e) { /* corpo inválido */ }
      console.log(new Date().toISOString().slice(11, 19), 'POST /api', acao, JSON.parse(saida).ok ? 'ok' : 'ERRO ' + JSON.parse(saida).erro);
    }, LATENCIA);
  });
}

/** Rota de depuração: mostra o conteúdo das abas (sem as miniaturas) para conferir o que foi gravado. */
function responderDebug(res, url) {
  const nome = decodeURIComponent(url.pathname.replace('/__planilha/', ''));
  const aba = amb.aba(nome);
  if (!aba || nome === 'Miniaturas') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Aba não encontrada');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(aba.objetos(), null, 2));
}

function responderArquivo(res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const arq = path.normalize(path.join(RAIZ, rel));
  if (!arq.startsWith(RAIZ)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(arq, (err, dados) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Não encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(dados);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/api') return responderApi(req, res);
  if (req.method === 'GET' && url.pathname.startsWith('/__planilha/')) return responderDebug(res, url);
  if (req.method === 'GET') return responderArquivo(res, url);
  res.writeHead(405);
  res.end();
}).listen(PORTA, () => {
  console.log(`Servidor local em http://localhost:${PORTA}  (PINs de teste: ele 111111, ela 222222)`);
});
