import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        carteira: 'carteira.html',
        swap: 'swap.html',
        futebol: 'futebol.html',
        posicoes: 'posicoes.html',
        predicoes: 'predicoes.html',
        historico: 'historico.html',
        whitepaper: 'whitepaper.html',
        deposito: 'deposito.html',
        saque: 'saque.html',
        futeboll: 'futeboll.html',
        "criar-apostas": 'criar-aposta.html',
        "view-market": 'view-market.html',
        token: 'token.html',
      },
    },
  },
})