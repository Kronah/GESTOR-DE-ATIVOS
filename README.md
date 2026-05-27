# Sistema de Controle de Dispositivos

Projeto full-stack para gestao de notebooks por ativo e QR Code.

Este repositorio agora suporta dois modos de uso:

1. Sistema de apresentacao (nuvem): frontend no GitHub Pages + backend Node.js + banco Postgres gratuito
2. Sistema local (SQLite): roda tudo localmente para uso interno e futura maquina fisica

## Etapas do sistema

1. Cadastro/Gestao
- Nome da empresa
- Responsavel da empresa (terceiro)
- Lider da equipe
- Nome do responsavel pelo notebook
- Telefone de contato
- Setor
- Planta de matricula
- Foto do responsavel
- Ativo do dispositivo
- Status (LIBERADO/BLOQUEADO)
- Geracao de QR Code por ativo

2. Validacao por QR Code
- Leitura de QR por camera
- Captura de foto do ativo na validacao
- Exibicao de nome e foto do responsavel cadastrado
- Borda verde para LIBERADO
- Borda vermelha para BLOQUEADO

## Stack

- Frontend: React + Vite + TypeScript
- Backend: Node.js + Express + TypeScript
- Banco: Prisma + SQLite (local) ou Prisma + Postgres (nuvem)
- Upload: Multer
- QR Code: qrcode + html5-qrcode

## Requisitos

- Node.js LTS (npm incluso)

## Como rodar no Windows (Sistema local - SQLite)

1. Instalar dependencias:

```bash
npm install
```

2. Gerar client do Prisma e criar banco:

```bash
npm run prisma:generate
npm run prisma:migrate
```

3. Executar frontend + backend em modo desenvolvimento:

```bash
npm run dev
```

4. Abrir no navegador:

```text
http://localhost:5173
```

API backend em:

```text
http://localhost:4000
```

## Sistema de apresentacao (GitHub + banco em nuvem gratuito)

### Banco recomendado (gratuito)

- Neon Postgres (free tier)

### Backend recomendado (gratuito)

- Render Web Service (free tier)

### Passo a passo do modo nuvem

1. Crie um banco Postgres no Neon e copie a `DATABASE_URL`.
2. No Render, conecte este repositório GitHub e configure:

Build Command:

```bash
npm ci && npm run prisma:generate:cloud && npm run prisma:push:cloud && npm run build:server
```

Start Command:

```bash
npm run start:cloud
```

Variaveis de ambiente no Render:

```text
DATABASE_URL=postgresql://...
PORT=4000
VALIDATION_PORT=4100
```

3. Pegue a URL publica do backend no Render, por exemplo:

```text
https://seu-backend.onrender.com
```

4. No GitHub do repositório, configure em `Settings > Secrets and variables > Actions > Variables`:

```text
VITE_API_BASE_URL=https://seu-backend.onrender.com
```

5. Faça push na branch `main` para republicar o frontend no GitHub Pages.

## Scripts principais

- `npm run dev`: alias para `npm run dev:local`
- `npm run dev:local`: sobe frontend e backend no modo local
- `npm run dev:cloud`: sobe frontend e backend para testes no modo nuvem
- `npm run build`: build frontend e backend
- `npm run start`: executa backend compilado
- `npm run prisma:generate`: alias para `npm run prisma:generate:local`
- `npm run prisma:migrate`: alias para `npm run prisma:migrate:local`
- `npm run prisma:generate:local`: gera client para schema SQLite
- `npm run prisma:migrate:local`: cria/aplica migration SQLite local
- `npm run prisma:generate:cloud`: gera client para schema Postgres em nuvem
- `npm run prisma:push:cloud`: cria/atualiza tabelas no Postgres de nuvem
- `npm run prisma:migrate:cloud`: aplica migrations no Postgres de nuvem

## Estrutura

- `src`: aplicacao React
- `server/src`: API Express
- `prisma/schema.prisma`: schema local (SQLite)
- `prisma/schema.cloud.prisma`: schema nuvem (Postgres)
- `uploads`: fotos e QRs gerados em runtime
- `.env.local.example`: variaveis exemplo para sistema local
- `.env.cloud.example`: variaveis exemplo para sistema de apresentacao em nuvem

## Publicar online

Este projeto continua com publicacao separada em 2 partes:

1. Frontend no GitHub Pages
2. Backend em host Node.js + banco Postgres de nuvem

### 1. Subir o codigo para o GitHub

```bash
git init
git add .
git commit -m "Primeira versao do sistema"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

### 2. Publicar o backend

Use o fluxo da secao "Sistema de apresentacao (GitHub + banco em nuvem gratuito)".

### 3. Configurar o frontend para usar a API online

Crie as variaveis no GitHub do repositorio:

- `VITE_API_BASE_URL`: URL publica do backend, ex. `https://seu-backend.onrender.com`

O workflow de GitHub Pages deste projeto usa essa variavel no build.

### 4. Ativar GitHub Pages

No GitHub:

1. Abra `Settings`
2. Entre em `Pages`
3. Em `Build and deployment`, selecione `GitHub Actions`

Depois disso, cada push na branch `main` publica o frontend automaticamente.

### 5. URLs das telas online

Quando o frontend estiver publicado, voce podera acessar:

- Cadastro: `https://SEU-USUARIO.github.io/SEU-REPOSITORIO/`
- Camera: `https://SEU-USUARIO.github.io/SEU-REPOSITORIO/?view=camera`
- Painel: `https://SEU-USUARIO.github.io/SEU-REPOSITORIO/?view=painel`

### Limites da versao atual para producao

- No modo local (SQLite), o banco e local e nao serve para alta concorrencia
- `uploads` locais podem ser perdidos em hosts sem disco persistente
- para producao definitiva, o ideal e Postgres + armazenamento externo (Cloudinary, S3 ou similar)

## Deploy automatico do frontend

O repositorio ja pode publicar a interface no GitHub Pages usando o workflow em `.github/workflows/deploy-pages.yml`.
