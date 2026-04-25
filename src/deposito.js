// deposito.js - Versão Ultra Simples
function abrirDeposito() {
  if (!currentWalletAddress) {
    alert("Carteira não encontrada");
    return;
  }

  // Transak em modo público (mais estável que MoonPay)
  const url = `https://global.transak.com/?network=polygon&cryptoCurrency=POL&fiatCurrency=BRL&walletAddress=${currentWalletAddress}&language=pt`;

  window.open(url, '_blank');
}