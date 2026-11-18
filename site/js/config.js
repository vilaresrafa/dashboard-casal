/*
 * Endereço da API (o web app do Google Apps Script).
 * O script ferramentas/implantar.ps1 preenche API_URL automaticamente depois de publicar.
 * Rodando em localhost, o site usa o servidor local (npm run dev).
 */
window.CONFIG = {
  API_URL: 'COLE_AQUI_A_URL_DO_APPS_SCRIPT',
  INTERVALO_ATUALIZACAO_MS: 60000
};

if (['localhost', '127.0.0.1'].indexOf(location.hostname) >= 0) {
  window.CONFIG.API_URL = '/api';
}
