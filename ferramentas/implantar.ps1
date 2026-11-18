<#
  Publica (ou atualiza) o Nos dois:
    1) roda os testes do backend;
    2) envia o codigo do Apps Script para o Google (na primeira vez, cria o script preso a planilha)
       e publica o web app (a API);
    3) grava o endereco da API em site/js/config.js;
    4) na primeira vez, cria o repositorio no GitHub e liga o GitHub Pages; depois envia o site.

  Antes da primeira vez (uma vez so):
    - ative a "Google Apps Script API" em https://script.google.com/home/usersettings
    - rode:  clasp login       (abre o navegador para autorizar o Google)
    - rode:  gh auth login     (GitHub.com > HTTPS > Login with a web browser)

  Uso:
    powershell -ExecutionPolicy Bypass -File ferramentas\implantar.ps1
    (opcional: -SoBackend  publica so a API;  -SoSite  publica so o site)
#>
param([switch]$SoBackend, [switch]$SoSite)

# 'Continue' porque o PowerShell 5.1 trata qualquer texto em stderr de programas como erro;
# o sucesso de cada comando e conferido pelo $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
$Raiz = Split-Path -Parent $PSScriptRoot
Set-Location $Raiz
$ArqConfig = Join-Path $Raiz 'config-local.json'
$Utf8SemBom = New-Object System.Text.UTF8Encoding $false

function Passo([string]$texto) { Write-Host ''; Write-Host "==> $texto" -ForegroundColor Cyan }
function Aviso([string]$texto) { Write-Host $texto -ForegroundColor Yellow }
function Falhar([string]$texto) { Write-Host ''; Write-Host "PAROU: $texto" -ForegroundColor Red; exit 1 }

function Ler-Config {
  if (Test-Path $ArqConfig) { return ([IO.File]::ReadAllText($ArqConfig) | ConvertFrom-Json) }
  return New-Object PSObject
}
function Salvar-Config($cfg) { [IO.File]::WriteAllText($ArqConfig, ($cfg | ConvertTo-Json -Depth 5), $Utf8SemBom) }
function Definir($cfg, [string]$nome, $valor) {
  if ($cfg.PSObject.Properties.Name -contains $nome) { $cfg.$nome = $valor }
  else { $cfg | Add-Member -NotePropertyName $nome -NotePropertyValue $valor }
}
function Achar-Gh {
  $c = Get-Command gh -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $candidatos = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\GitHub.cli_Microsoft.Winget.Source_8wekyb3d8bbwe\bin\gh.exe",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\gh.exe",
    "$env:ProgramFiles\GitHub CLI\gh.exe"
  )
  foreach ($p in $candidatos) { if (Test-Path $p) { return $p } }
  return $null
}

foreach ($cmd in @('node', 'git')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Falhar "Comando '$cmd' nao encontrado." }
}

$cfg = Ler-Config

Passo 'Rodando os testes do backend'
node --test "testes/*.test.js"
if ($LASTEXITCODE -ne 0) { Falhar 'Os testes falharam. Nada foi publicado.' }

# ---------------------------------------------------------------- Backend (Google)
if (-not $SoSite) {
  if (-not (Get-Command clasp -ErrorAction SilentlyContinue)) { Falhar 'clasp nao encontrado. Instale com:  npm install -g @google/clasp' }

  Passo 'Conferindo o login no Google (clasp)'
  $quem = (clasp show-authorized-user | Out-String)
  if ($quem -match 'Not logged in') { Falhar 'Voce ainda nao entrou no clasp. Rode:  clasp login   e depois este script de novo.' }
  Write-Host $quem.Trim()

  Push-Location (Join-Path $Raiz 'apps-script')
  try {
    if (-not (Test-Path '.clasp.json')) {
      Passo 'Criando o script preso a planilha (primeira vez)'
      # O clasp baixa um appsscript.json padrao ao criar; guardamos os nossos arquivos antes.
      Copy-Item 'Code.js' 'Code.js.bak' -Force
      Copy-Item 'appsscript.json' 'appsscript.json.bak' -Force
      if ($cfg.planilhaId) {
        clasp create-script --parentId $cfg.planilhaId --title 'Nos dois - API' --rootDir .
      } else {
        clasp create-script --type sheets --title 'Nos dois - Dashboard do casal' --rootDir .
      }
      $codigo = $LASTEXITCODE
      Move-Item 'Code.js.bak' 'Code.js' -Force
      Move-Item 'appsscript.json.bak' 'appsscript.json' -Force
      if ($codigo -ne 0) {
        Falhar 'Nao consegui criar o script. Se a mensagem fala da "Apps Script API", ative em https://script.google.com/home/usersettings e rode de novo.'
      }
    }

    Passo 'Enviando o codigo para o Google'
    clasp push --force
    if ($LASTEXITCODE -ne 0) {
      Falhar 'clasp push falhou. Se a mensagem fala da "Apps Script API", ative em https://script.google.com/home/usersettings e rode de novo.'
    }

    $clasp = [IO.File]::ReadAllText((Join-Path (Get-Location) '.clasp.json')) | ConvertFrom-Json
    Definir $cfg 'scriptId' $clasp.scriptId
    if (-not $cfg.planilhaId -and $clasp.parentId) {
      $pid0 = @($clasp.parentId)[0]
      Definir $cfg 'planilhaId' $pid0
      Definir $cfg 'planilhaUrl' "https://docs.google.com/spreadsheets/d/$pid0/edit"
    }

    Passo 'Publicando o web app (API)'
    $descricao = 'Nos dois ' + (Get-Date -Format 'yyyy-MM-dd HH:mm')
    if ($cfg.deploymentId) {
      $saida = (clasp update-deployment $cfg.deploymentId --description $descricao | Out-String)
    } else {
      $saida = (clasp create-deployment --description $descricao | Out-String)
    }
    $codigo = $LASTEXITCODE
    Write-Host $saida.Trim()
    if ($codigo -ne 0) { Falhar 'Nao consegui publicar o web app.' }
    if (-not $cfg.deploymentId) {
      $m = [regex]::Match($saida, 'AKfy[A-Za-z0-9_-]+')
      if (-not $m.Success) { Falhar 'Nao achei o id da implantacao na saida do clasp. Rode "clasp list-deployments" dentro de apps-script e copie o id para deploymentId em config-local.json.' }
      Definir $cfg 'deploymentId' $m.Value
    }
    Definir $cfg 'apiUrl' ('https://script.google.com/macros/s/' + $cfg.deploymentId + '/exec')
    Salvar-Config $cfg
  } finally {
    Pop-Location
  }

  Passo 'Gravando o endereco da API em site/js/config.js'
  $arq = Join-Path $Raiz 'site\js\config.js'
  $txt = [IO.File]::ReadAllText($arq)
  $novo = [regex]::Replace($txt, "API_URL: '[^']*'", "API_URL: '" + $cfg.apiUrl + "'")
  [IO.File]::WriteAllText($arq, $novo, $Utf8SemBom)

  Passo 'Testando a API publicada'
  try {
    $r = Invoke-RestMethod -Uri $cfg.apiUrl -Method Post -Body '{"acao":"ping"}' -ContentType 'text/plain;charset=utf-8'
    if ($r.ok) { Write-Host ('API no ar. Versao ' + $r.versao + ', hoje = ' + $r.hoje) -ForegroundColor Green }
    else { Aviso ('A API respondeu com erro: ' + $r.erro) }
  } catch {
    Aviso 'A API ainda nao respondeu JSON. Normal na primeira vez: abra a planilha, use o menu Dashboard > Preparar planilha e autorize o script.'
  }
}

# ---------------------------------------------------------------- Site (GitHub Pages)
if (-not $SoBackend) {
  $gh = Achar-Gh
  if (-not $gh) { Falhar 'GitHub CLI (gh) nao encontrado. Instale com:  winget install --id GitHub.cli' }
  & $gh auth status *> $null
  if ($LASTEXITCODE -ne 0) { Falhar 'Voce ainda nao entrou no GitHub. Rode:  gh auth login   e depois este script de novo.' }
  $usuario = (& $gh api user --jq .login | Out-String).Trim()
  $repo = if ($cfg.repositorio) { $cfg.repositorio } else { 'dashboard-casal' }

  Passo 'Salvando as mudancas no git'
  git add -A
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    git commit -m ('Publica o Nos dois (' + (Get-Date -Format 'yyyy-MM-dd HH:mm') + ')') | Out-Null
  }

  if (-not ((git remote) -contains 'origin')) {
    Passo "Criando o repositorio $usuario/$repo no GitHub (primeira vez)"
    & $gh repo create $repo --public --source . --remote origin --description 'Nos dois: dashboard do casal (planilha Google + Apps Script + GitHub Pages)'
    if ($LASTEXITCODE -ne 0) { Falhar 'Nao consegui criar o repositorio no GitHub.' }
  }

  Passo 'Ligando o GitHub Pages (publicacao pelo GitHub Actions)'
  & $gh api -X POST "repos/$usuario/$repo/pages" -f build_type=workflow *> $null
  if ($LASTEXITCODE -ne 0) {
    & $gh api -X PUT "repos/$usuario/$repo/pages" -f build_type=workflow *> $null
  }

  Passo 'Enviando para o GitHub'
  git push -u origin main
  if ($LASTEXITCODE -ne 0) { Falhar 'git push falhou.' }

  $site = 'https://' + $usuario.ToLower() + '.github.io/' + $repo + '/'
  Definir $cfg 'siteUrl' $site
  Salvar-Config $cfg

  Passo 'Esperando o GitHub publicar o site (1 a 3 minutos)'
  Start-Sleep -Seconds 5
  $runId = (& $gh run list --repo "$usuario/$repo" --workflow pages.yml --limit 1 --json databaseId --jq '.[0].databaseId' | Out-String).Trim()
  if ($runId) {
    & $gh run watch $runId --repo "$usuario/$repo" --exit-status
    if ($LASTEXITCODE -ne 0) { Aviso ('A publicacao no GitHub falhou. Veja em: https://github.com/' + $usuario + '/' + $repo + '/actions') }
  }
}

Write-Host ''
Write-Host '==================== Pronto ====================' -ForegroundColor Green
if ($cfg.planilhaUrl) { Write-Host ('Planilha: ' + $cfg.planilhaUrl) }
if ($cfg.apiUrl) { Write-Host ('API:      ' + $cfg.apiUrl) }
if ($cfg.siteUrl) { Write-Host ('Site:     ' + $cfg.siteUrl) }
Write-Host ''
Write-Host 'Se for a primeira vez:'
Write-Host '  1. Abra a planilha > menu Dashboard > Preparar planilha (autorize o script).'
Write-Host '  2. Menu Dashboard > Definir PIN dele / Definir PIN dela.'
Write-Host '  3. Abra o site no celular, entre com o PIN e use "Adicionar a tela inicial".'
