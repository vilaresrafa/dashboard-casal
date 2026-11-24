# Nós dois — dashboard do casal

Um cantinho compartilhado para um casal acompanhar o dia a dia pelo celular:

- **Tarefas**: cada um monta a própria lista de amanhã à noite; no dia seguinte ela vira a lista de hoje (o dia só vira às 3h da manhã, para quem dorme tarde). As tarefas que ficaram para trás aparecem como pendentes, com opção de trazer para hoje.
- **Metas**: da semana (ex.: academia 4x, contagem zera toda segunda) e de longo prazo (barra de progresso, inclusive metas que diminuem, como peso).
- **Dieta**: calorias e macros do dia de cada um contra a meta, refeições registradas (dá para voltar até 14 dias) e evolução do peso. Os registros são feitos conversando com o Claude, que escreve direto na planilha.
- **Quadro do dia**: um quadro branco compartilhado onde os dois desenham, cada um com a sua cor (menta e pêssego). Com o quadro aberto, os traços do outro aparecem em alguns segundos. Às 3h começa um quadro novo e o do dia fica em Memórias, junto com as fotos e recados de antes do quadro.
- **Anticoncepcional**: calendário do mês no fim da tela Hoje; um toque em "Tomou agora" marca o dia com a hora, e tocar num dia permite marcar, mudar a hora ou desmarcar.
- **Progresso**: sequências (dias seguidos com tudo feito, dias seguidos em que os dois desenharam), gráficos de tarefas, metas, calorias e peso.

Visual em tons de pêssego e menta, pensado primeiro para celular, e pode ser instalado na tela inicial.

## Como funciona

```
Celular / PC
   │  site estático (HTML, CSS e JavaScript puro) no GitHub Pages
   ▼
API em Google Apps Script (web app)  ── fotos antigas ──▶  Google Drive
   │
   ▼
Planilha Google (o "banco de dados")  ◀── Claude (conector Google Sheets) registra dieta e peso
```

- **Sem servidor próprio e sem custo**: a planilha guarda os dados e o Apps Script responde às requisições.
- **Login por PIN individual**: o PIN identifica quem está usando; cada um só altera o que é seu (o servidor confere). O PIN é guardado só como hash SHA-256 com sal, e 5 erros seguidos bloqueiam por 15 minutos.
- **Desenhos leves**: cada traço é guardado como uma lista de pontos de 0 a 1000 (proporção do quadro), então o desenho fica igual em qualquer tela e cabe numa célula da planilha. Cada um grava só os próprios traços, e os dois podem desenhar ao mesmo tempo.
- **Fotos antigas privadas**: as fotos de antes do quadro ficam no Drive sem link público e só chegam ao site pela API, depois do PIN.
- **Escritas seguras**: travas (`LockService`) evitam que dois salvamentos ao mesmo tempo baguncem a planilha, e textos que começam com `=` não viram fórmula.

## Estrutura

```
apps-script/        API (Code.js) e manifesto do Apps Script
site/               o site publicado no GitHub Pages
testes/             testes do backend com uma imitação da planilha em memória (Node, sem dependências)
ferramentas/        servidor local, dados de exemplo, geração de ícones e script de publicação
.github/workflows/  roda os testes e publica o site a cada push
```

## Rodando localmente

Requisitos: Node 18 ou mais novo.

```bash
npm test          # 37 testes do backend
npm run dev       # http://localhost:8787  (PINs de teste: ele 111111, ela 222222)
```

O servidor local roda o mesmo `Code.js` do Apps Script contra uma planilha em memória com 30 dias de dados de exemplo (`node ferramentas/servidor-local.js --vazio` sobe sem dados).

## Publicando

Uma vez só:

1. Ative a "Google Apps Script API" em https://script.google.com/home/usersettings
2. `npm install -g @google/clasp` e depois `clasp login`
3. Instale o GitHub CLI (`winget install --id GitHub.cli`) e rode `gh auth login`

Depois, sempre que quiser publicar:

```bash
powershell -ExecutionPolicy Bypass -File ferramentas\implantar.ps1
```

Na primeira publicação: abra a planilha, use o menu **Dashboard > Preparar planilha** (o Google pede autorização para o seu próprio script) e depois **Definir PIN dele / Definir PIN dela**.

## Tecnologias

HTML, CSS e JavaScript sem framework; Google Apps Script; Google Sheets e Drive; GitHub Pages e GitHub Actions; testes com `node:test`.
