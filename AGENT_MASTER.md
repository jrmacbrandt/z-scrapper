# Z-SCRAPER — ARQUIVO MESTRE DO AGENTE

> **LEIA ESTE ARQUIVO ANTES DE QUALQUER MODIFICAÇÃO.**
> Este é o documento de referência canônico do projeto. Contém arquitetura, padrões obrigatórios, fluxo de trabalho e o protocolo completo de entrega de atualizações para clientes.

---

## 1. IDENTIDADE DO PROJETO

| Campo | Valor |
|---|---|
| **Nome** | Z-Scraper |
| **Propósito** | Plataforma de scraping local para Instagram e Google Maps |
| **Stack** | TypeScript + React 19 + Express + Playwright + SQLite |
| **Versão atual** | `v1.1.0` (ver `core/version.json`) |
| **Repositório GitHub** | `https://github.com/jrmacbrandt/z-scrapper` (remoto: `z-scrapper`) |
| **Dev** | `npm run dev` → `tsx watch server.ts` (porta 3001) |
| **Build** | `npm run build:installer` → frontend (Vite) + server (esbuild) |
| **Lint** | `npm run lint` → `npx tsc --noEmit` (deve ter zero erros) |

---

## 2. MAPA DE ARQUITETURA

```
Z-SCRAPPER/
│
├── server.ts                  ← Entry point do servidor Express
├── server-ig.ts               ← Roteador Instagram (/api/ig/*)
├── server-gmaps.ts            ← Roteador Google Maps (/api/gmaps/*)
├── database.ts                ← Schema SQLite (better-sqlite3)
├── stealth-utils.ts           ← Utilitários anti-detecção compartilhados
│
├── core/
│   └── version.json           ← Versão do núcleo ("version": "1.0.0")
│
├── modules/                   ← MÓDULOS ATUALIZÁVEIS (via updater)
│   ├── instagram_scraper/
│   │   ├── selectors.json     ← 🔑 SELETORES DOM (o mais importante)
│   │   └── module.json        ← Versão local do módulo
│   └── google_maps_scraper/
│       ├── selectors.json     ← 🔑 SELETORES DOM do Google Maps
│       └── module.json        ← Versão local do módulo
│
├── updater/
│   ├── updater.ts             ← Serviço de atualização automática
│   └── temp/                  ← Downloads temporários (gitignored)
│
├── updates/
│   └── manifest.json          ← Manifesto remoto (GitHub = servidor de updates)
│
└── src/
    ├── App.tsx                ← Shell React: sidebar + roteamento + UI de update
    └── modules/
        ├── instagram/
        │   ├── InstagramDashboard.tsx   ← Profile Scraper UI
        │   └── LeadsDashboard.tsx       ← Leads Qualificados UI
        └── googlemaps/
            └── GoogleMapsDashboard.tsx  ← Google Maps UI
```

---

## 3. ROTAS DE API

### Instagram (`server-ig.ts` → montado em `/api/ig`)

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/ig/session` | Salva cookie de sessão do IG |
| `GET` | `/api/ig/session` | Retorna sessão ativa |
| `GET` | `/api/ig/status` | Status do scraper IG em execução |
| `POST` | `/api/ig/scrape` | Inicia scraping de perfil |
| `POST` | `/api/ig/stop` | Para o scraper IG |
| `GET` | `/api/ig/perfis` | Lista perfis coletados |
| `POST` | `/api/ig/leads/scrape-keyword` | Scraping por keyword (Leads) |
| `GET` | `/api/ig/leads` | Lista leads qualificados |
| `POST` | `/api/ig/dm/send` | Dispara DMs em massa |

### Google Maps (`server-gmaps.ts` → montado em `/api/gmaps`)

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/gmaps/status` | Status do scraper GMaps |
| `POST` | `/api/gmaps/stop` | Para o scraper GMaps |
| `GET` | `/api/gmaps/buscas` | Lista buscas salvas |
| `GET` | `/api/gmaps/leads` | Lista leads do GMaps |
| `DELETE` | `/api/gmaps/buscas/:id` | Deleta busca e seus leads |
| `POST` | `/api/gmaps/extract-serper` | Extração via Serper.dev API |
| `POST` | `/api/gmaps/extract-local` | Extração via Playwright (local) |

### Sistema de Atualização (`server.ts`)

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/updates/status` | Estado atual dos updates (polled pelo frontend a cada 30s) |
| `POST` | `/api/updates/check` | Força verificação manual imediata |
| `POST` | `/api/updates/apply` | Aplica update de um módulo (`body: { module: "instagram_scraper" }`) |

---

## 4. BANCO DE DADOS (SQLite — `database.sqlite`)

Gerenciado por `database.ts` com `better-sqlite3`. Todas as tabelas usam `CREATE TABLE IF NOT EXISTS`.

| Tabela | Módulo | Descrição |
|---|---|---|
| `ig_sessoes` | Instagram | Cookies de sessão |
| `ig_perfis` | Instagram | Perfis coletados |
| `ig_buscas` | Instagram | Histórico de buscas |
| `ig_leads` | Instagram | Leads qualificados |
| `ig_scraping_state` | Instagram | Estado de paginação |
| `ig_posts_processados` | Instagram | Posts já visitados |
| `gmaps_buscas` | Google Maps | Histórico de buscas |
| `gmaps_leads` | Google Maps | Leads extraídos |
| `corretores` | (legado Zap) | Mantida no schema, não usada |
| `buscas` | (legado Zap) | Mantida no schema, não usada |

> ⚠️ **NUNCA** dropar tabelas existentes — o banco do cliente pode ter dados.
> Apenas adicionar novas tabelas/colunas com `IF NOT EXISTS`.

---

## 5. SISTEMA DE ATUALIZAÇÃO AUTOMÁTICA

### Como funciona (fluxo completo)

```
GitHub (raw.githubusercontent.com)
  └── updates/manifest.json  ← DEV edita aqui quando quer publicar update

Cliente (app rodando localmente)
  ├── updater.ts verifica manifest.json 10s após startup
  ├── Compara "current_version" remota vs "version" em module.json local
  ├── Se remota > local: App.tsx mostra 🔔 sino com badge vermelho
  ├── Cliente clica "Atualizar" → POST /api/updates/apply
  └── updater.ts: download → SHA-256 → backup → aplica → valida
```

### Protocolo de publicação de update (passo a passo obrigatório)

#### Cenário A: Seletores do Instagram quebraram

1. Identificar o novo seletor correto (inspecionar o IG manualmente)
2. Editar `modules/instagram_scraper/selectors.json` com os novos valores
3. Incrementar versão em `updates/manifest.json`:
   - `modules.instagram_scraper.current_version`: ex `"1.0.0"` → `"1.0.1"`
   - Atualizar `modules.instagram_scraper.changelog` com descrição da mudança
   - Atualizar `modules.instagram_scraper.release_date` com data atual
   - Atualizar `last_updated` no topo do manifest
4. Se quiser forçar update: setar `"mandatory": true`
5. Commit e push:

```powershell
git add modules/instagram_scraper/selectors.json updates/manifest.json
git commit -m "fix: atualizar seletores Instagram (layout jun/2026)"
git push z-scrapper main
```

6. Em até 30 segundos todos os clientes veem o sino. Clicam → atualizado.

#### Cenário B: Seletores do Google Maps quebraram

Mesmo processo, substituindo `instagram_scraper` por `google_maps_scraper`.

#### Cenário C: Adicionar campo novo ao selectors.json

Apenas adicione a nova chave. O `updater.ts` substitui o arquivo inteiro.
Incremente a versão minor (ex: `1.0.0` → `1.1.0`).

#### ⚠️ NUNCA fazer:
- Alterar o `module.json` LOCAL do cliente diretamente — ele é atualizado pelo updater
- Remover chaves existentes do `selectors.json` sem verificar se o código ainda as usa
- Publicar version `0.0.0` no manifest — o comparador semver ignora igualdade

---

## 6. REGRAS INVIOLÁVEIS DE DESENVOLVIMENTO

### 6.1 Stack — NUNCA mudar
- **Linguagem**: TypeScript exclusivamente (backend e frontend)
- **Sem Python**: o prompt original menciona Python/Flask — IGNORAR. A app é Node.js.
- **Sem Electron por ora**: app roda como servidor local + browser. Mudança só com solicitação explícita.
- **Frontend**: React 19 + Vite + Tailwind CSS v4

### 6.2 Preservação de funcionalidade
- Toda alteração é **ADITIVA**. Nunca remover funcionalidade sem solicitação explícita.
- Antes de deletar qualquer arquivo, verificar se é importado em outro lugar.
- O servidor Express (`server.ts`) é o entry point de tudo — nunca deletar.

### 6.3 Banco de dados
- Usar **apenas** `CREATE TABLE IF NOT EXISTS` — nunca `DROP TABLE`
- Não alterar nomes de colunas existentes — adicionar novas colunas com `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`

### 6.4 Seletores
- Qualquer seletor DOM novo para Instagram ou Google Maps **deve** ir para o `selectors.json` correspondente, não hardcoded no `.ts`
- Após adicionar/alterar seletores, incrementar versão e publicar manifest

### 6.5 Validação obrigatória antes de commit
```powershell
npx tsc --noEmit   # deve retornar sem output (zero erros)
```

### 6.6 Commits
Formato de mensagem:
```
tipo: descrição curta

- detalhe 1
- detalhe 2
```
Tipos: `feat`, `fix`, `refactor`, `docs`, `chore`

### 6.7 Push
**Sempre** usar o remote `z-scrapper` (não `origin`):
```powershell
git push z-scrapper main
```
`origin` aponta para o repo antigo `SCRAPPER-ZAP` e não deve ser atualizado.

---

## 7. PADRÕES DE CÓDIGO

### Backend (TypeScript/Express)

```typescript
// ✅ Correto — carregar seletores do JSON
import fs from "fs";
import path from "path";
const selectors = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "modules/instagram_scraper/selectors.json"), "utf-8")
);

// ❌ Errado — hardcodar seletores
const el = await page.$('svg[aria-label="Curtir"]');
```

```typescript
// ✅ Correto — log com timestamp
function logIg(msg: string) {
  const ts = new Date().toLocaleTimeString("pt-BR");
  console.log(`[${ts}] 📸 ${msg}`);
}

// ✅ Correto — resposta imediata + processamento em background
res.json({ message: "Iniciando...", running: true });
(async () => { /* lógica de scraping */ })();
```

### Frontend (React/TSX)

```tsx
// ✅ Correto — usar lucide-react para ícones
import { Bell, ArrowUp, X } from "lucide-react";

// ✅ Correto — Tailwind classes com dark palette padrão
className="bg-slate-900 border border-slate-700 text-slate-200"

// ✅ Correto — animações com motion/react (não framer-motion)
import { motion, AnimatePresence } from "motion/react";
```

### Variáveis de ambiente (`.env`)
```
SERPER_API_KEY=...        # API do Serper.dev para Google Maps
PORT=3001                 # Porta do servidor local
```
O `.env` nunca vai para o git (protegido pelo `.gitignore`).

---

## 8. FLUXO DE TRABALHO PARA MUDANÇAS

### Para qualquer modificação, seguir SEMPRE esta ordem:

1. **Ler este arquivo** (AGENT_MASTER.md)
2. **Identificar qual arquivo modificar** usando o Mapa de Arquitetura (seção 2)
3. **Verificar se há seletores envolvidos** → se sim, editar `selectors.json`
4. **Implementar a mudança**
5. **Rodar** `npx tsc --noEmit` → zero erros obrigatório
6. **Commit** com mensagem descritiva
7. **Push** para `z-scrapper` (não `origin`)
8. **Se a mudança afeta seletores**: publicar update no manifest (seção 5)

---

## 9. MÓDULOS FUTUROS

Para adicionar um novo módulo de scraping:

1. Criar `modules/[nome_modulo]/selectors.json`
2. Criar `modules/[nome_modulo]/module.json` com `"version": "1.0.0"`
3. Criar `server-[nome].ts` com Router Express
4. Montar no `server.ts`: `app.use("/api/[nome]", nomeRouter)`
5. Adicionar o módulo ao `updates/manifest.json`
6. Criar `src/modules/[nome]/[Nome]Dashboard.tsx`
7. Adicionar entrada na sidebar do `src/App.tsx`
8. Adicionar tabelas no `database.ts`

---

## 10. BUILD E DISTRIBUIÇÃO

### Desenvolvimento
```powershell
npm run dev          # server.ts + Vite middleware na porta 3001
```

### Build para instalador (quando solicitado)
```powershell
npm run build:installer  # gera dist/ com frontend + server.cjs
.\build-installer.ps1    # gera instalador via Inno Setup
```

O `build-installer.ps1` usa `esbuild` para empacotar o servidor e `Inno Setup` para criar o `.exe` instalável para Windows.

### Variáveis que o `build-installer.ps1` usa:
- Lê `metadata.json` na raiz para versão e nome do produto

---

## 11. RASTREABILIDADE DE VERSÕES

| Arquivo | Propósito | Quando atualizar |
|---|---|---|
| `core/version.json` | Versão do núcleo da aplicação | Mudanças no core (server.ts, database.ts, etc.) |
| `modules/instagram_scraper/module.json` | Versão local do módulo IG | Atualizado **automaticamente** pelo `updater.ts` após apply |
| `modules/google_maps_scraper/module.json` | Versão local do módulo GMaps | Atualizado **automaticamente** pelo `updater.ts` após apply |
| `updates/manifest.json` | Versão "remota" (GitHub) | **Manualmente** pelo dev ao publicar um update |
| `package.json` | Versão do pacote npm | Raramente — apenas releases maiores |

---

## CHECKLIST RÁPIDO (colar antes de cada sessão de trabalho)

```
[ ] Li o AGENT_MASTER.md
[ ] Identifiquei os arquivos a modificar
[ ] Verifiquei se há seletores DOM envolvidos
[ ] Rodei npx tsc --noEmit (zero erros)
[ ] Commitei com mensagem descritiva
[ ] Push para z-scrapper (não origin)
[ ] Se seletores: atualizei manifest.json e publiquei
```
