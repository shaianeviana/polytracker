# Polymarket Tracker 📊

Dashboard público onde qualquer pessoa cola sua wallet da Polymarket e vê seu desempenho completo — acertos, erros, lucros, categorias e mais.

## Como funciona

1. Usuário acessa o site e cola o endereço da carteira
2. O dashboard é gerado instantaneamente com dados da API pública da Polymarket
3. Um link único é criado (ex: `seusite.vercel.app/?wallet=0x...`) para compartilhar

**Sem login. Sem conexão de carteira. 100% público.**

## Deploy na Vercel

### 1. Suba para o GitHub

```bash
cd polymarket-tracker
git init
git add .
git commit -m "Initial commit"
# Crie o repo no GitHub, depois:
git remote add origin https://github.com/SEU_USUARIO/polymarket-tracker.git
git branch -M main
git push -u origin main
```

### 2. Deploy na Vercel

1. Acesse [vercel.com](https://vercel.com) e faça login com GitHub
2. Clique **"New Project"**
3. Importe o repositório `polymarket-tracker`
4. Clique **"Deploy"**

Pronto! Seu site estará online.

## Estrutura

```
polymarket-tracker/
├── api/
│   └── data.js          # Serverless proxy (qualquer wallet)
├── public/
│   └── index.html       # Landing page + Dashboard SPA
├── vercel.json           # Rotas Vercel
├── package.json
└── README.md
```

## Links diretos

Você pode linkar direto para o dashboard de qualquer carteira:

```
https://seusite.vercel.app/?wallet=0x9cc455b6be15a1182E4AB75384D46565e998abd7
```

## Stack

- **Frontend**: Vanilla HTML/CSS/JS (zero dependências, ~660 linhas)
- **Backend**: Vercel Serverless Function (proxy para evitar CORS)
- **API**: Polymarket Data API (pública, sem auth necessário)
- **Hospedagem**: Vercel Free Tier
- **Cache**: 5 min na CDN da Vercel
