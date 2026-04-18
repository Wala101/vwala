import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        carteira: 'carteira.html',
        swap: 'swap.html',
        token: 'token.html',
      },
    },
  },
})