# Documento de Requisitos de Produto (PRD)
Projeto: LocalLeads Engine
Fase: Especificação Técnica e Arquitetura
Status: Pronto para Implementação

## 1. Visão Geral do Produto
O LocalLeads Engine é uma plataforma de inteligência comercial e prospecção B2B focada em extração, higienização, enriquecimento e validação de dados de empresas e profissionais autônomos contidos no Google Maps e Google Meu Negócio (GMB).

### 1.1 Objetivo Estratégico
Permitir que o usuário digite uma palavra-chave e uma localidade, gerando uma lista de leads altamente assertiva, auditada e enriquecida com dados cadastrais da Receita Federal (CNPJ), status de conectividade (WhatsApp/Websites) e score de oportunidade comercial, operando com custo de infraestrutura zero através do uso estratégico de APIs com camadas gratuitas e processamento local.

## 2. Arquitetura do Sistema e Stack Tecnológica
O sistema será construído utilizando uma arquitetura modular baseada em eventos ou micro-serviços lógicos dentro de um ambiente monorreferenciado.

```text
[Frontend: App React / Vite] 
       │ (Requisição HTTP POST)
       ▼
[Backend API: Express / Server (server.ts)]
       │
       ├───> [Módulo 1: Coleta Extrema] ──> API Serper.dev (Camada Gratuita)
       │
       ├───> [Módulo 2: Parsing & Regex] ──> Biblioteca 'google-libphonenumber' (Local)
       │
       ├───> [Módulo 3: Validação de Rede] ──> Axios / Fetch (Pings assíncronos)
       │
       └───> [Módulo 4: Enriquecimento Fiscal] ──> API OpenCNPJ.org / BrasilAPI (Pública)
```
*(Nota: O ambiente atual é Vite/Express e não Next.js/Vercel, mas a lógica de processamento será mantida nas rotas do Express de forma otimizada e local).*

### 2.2 Stack Detalhada
- **Framework Principal:** React (Vite) no frontend, Node.js (Express) no backend.
- **Banco de Dados:** SQLite Local (`better-sqlite3`) para 100% de operação offline, sem Supabase.
- **Camada de Extração:** API do Serper.dev (Endpoint `/maps` - 2.500 requisições gratuitas sem cartão).
- **Camada Fiscal:** API OpenCNPJ.org e BrasilAPI (100% gratuitas, sem chaves e sem limite de requisições restritivo).
- **Processamento de Telefone:** `google-libphonenumber` (Biblioteca Node.js).

## 3. Requisitos Funcionais (Módulos do Pipeline)

`[Entrada do Usuário] ──> [Módulo 1: Scraping] ──> [Módulo 2: Limpeza] ──> [Módulo 3: Validação] ──> [Módulo 4: Enriquecimento] ──> [Resultado]`

### Módulo 1: Coleta Extrema (Scraping Anti-Bloqueio)
- **RF1.1:** O sistema deve receber duas strings de entrada: keyword (ex: "Barbearia") e location (ex: "Duque de Caxias").
- **RF1.2:** O backend deve concatenar os termos e disparar uma requisição estruturada POST para `https://google.serper.dev/maps` omitindo a necessidade de gerenciar navegadores headless locais.
- **RF1.3:** Parâmetros obrigatórios da requisição:
  - `q`: `${keyword} ${location}`
  - `gl`: "br" (Geolocalização travada no Brasil)
  - `hl`: "pt-br" (Idioma da resposta)

### Módulo 2: Limpeza e Normalização de Dados (Sanitização)
- **RF2.1:** Sanitização de Títulos (Nomes): O sistema deve aplicar Expressões Regulares (Regex) para remover termos redundantes de SEO aplicados por proprietários de listagens.
  - *Regra de Regex:* Remover caracteres especiais repetidos, emojis e frases após hífens ou barras que contenham a própria palavra-chave ou a cidade.
- **RF2.2:** Padronização Telefônica Local: Passar o campo phoneNumber bruto pela instância da `google-libphonenumber`.
  - Extrair o código do país (+55).
  - Validar a quantidade de dígitos com base no DDD capturado.
  - Classificar o tipo do terminal: `MOBILE` (Celular) ou `FIXED_LINE` (Telefone Fixo).

### Módulo 3: Validação de Conectividade e Ativos Digitais
- **RF3.1:** Status de Website Ativo (HTTP Ping): Para cada lead que possua o campo website preenchido, o backend deve disparar uma requisição assíncrona `axios.head()` ou fetch com método `HEAD`.
  - *Timeout Restritivo:* Máximo de 3500ms para evitar travamento.
  - *Tratamento de Erros:* Se o código de retorno for 2xx ou 3xx, classificar como Website Ativo. Se retornar 4xx, 5xx ou estourar o timeout, marcar como Website Inativo/Quebrado.
- **RF3.2:** Auditoria de Reivindicação GMB: O sistema deve mapear a propriedade booleana `cid` e a presença do marcador de propriedade. Se a empresa não estiver reivindicada no Google, o lead deve receber a flag `Nao_Reivindicada = true`.

### Módulo 4: Enriquecimento Fiscal (Linkagem de CNPJ)
- **RF4.1:** O sistema deve pegar o nome limpo da empresa obtido no Módulo 2 e, caso o cliente solicite a validação avançada, fazer uma busca por aproximação ou exatidão na API do OpenCNPJ.org ou BrasilAPI.
- **RF4.2:** O sistema deve anexar ao lead as informações retornadas:
  - CNPJ (Formatado)
  - Situacao_Cadastral (Ativa / Inativa)
  - CNAE_Principal (Código de atividade econômica)
  - Data_Abertura

## 4. Requisitos Não-Funcionais (Qualidade e Desempenho)

### 4.1 Desempenho e Concorrência
- **RNF4.1.1 (Processamento Assíncrono):** As validações de ping de sites e consultas de CNPJ devem ocorrer em paralelo utilizando `Promise.allSettled()` para evitar gargalos sequenciais. O tempo total de resposta de um lote de 20 leads não deve ultrapassar 6 segundos.
- **RNF4.1.2 (Arquitetura):** O processamento de dados ocorrerá na rota de backend da própria aplicação.

### 4.2 Segurança e Armazenamento
- **RNF4.2.1 (Ocultação de Chaves):** Nenhuma chave de API (X-API-KEY do Serper) pode estar exposta no client-side (Frontend). Todas as requisições externas são executadas rigidamente no ambiente de backend isolado através de variáveis de ambiente (`.env`).
- **RNF4.2.2 (Restrição de Dados Sensíveis):** O sistema não armazenará CPFs, apenas dados públicos PJ.

## 5. Regras de Negócio e Lógica de Scoring (Algoritmo de Qualificação)
Para enriquecer a experiência do cliente final, o sistema aplicará um algoritmo interno de pontuação (Score de Oportunidade) calculado dinamicamente no backend:

```javascript
// Lógica de cálculo do Score de Oportunidade (0 a 100)
let score = 100;

if (lead.websiteStatus === "Inativo/Quebrado") score -= 30; // Péssimo para o lead
if (!lead.website) score -= 20;                             // Falta de presença digital
if (lead.isGmbClaimed === false) score -= 25;              // Canal aberto para venda de SEO
if (lead.rating < 4.0 && lead.reviewCount > 0) score -= 15; // Precisa de gestão de reputação
if (lead.phoneType === "FIXED_LINE") score -= 10;           // Não aceita WhatsApp nativo facilmente

lead.opportunityScore = score;
```

**Matriz de Classificação de Leads para o Painel do Cliente**
- `isGmbClaimed === false` -> 🔥 Oportunidade de Ouro (Oferecer serviço de Reivindicação e Configuração do Perfil do GMB)
- `websiteStatus === "Inativo/Quebrado"` -> 🚨 Lead Crítico (Venda de Desenvolvimento Web / Correção de Site fora do ar)
- `phoneType === "MOBILE"` -> 💬 Lead Acessível (Disparar abordagem comercial via WhatsApp)

## 6. Especificação das Interfaces de Dados (JSON Schemas)
**Payload de Resposta Final Sanitizada**
```json
{
  "search_metadata": {
    "keyword": "Barbearia",
    "location": "Duque de Caxias",
    "total_extracted": 1
  },
  "leads": [
    {
      "gmb_id": "ChIJb1...",
      "company_name": "Barbearia Silva",
      "raw_name": "Barbearia Silva - O Melhor Corte de Duque de Caxias!!!",
      "presence": {
        "google_rating": 4.7,
        "reviews_count": 42,
        "is_claimed": false
      },
      "contact": {
        "phone_raw": "(21) 98888-7777",
        "phone_e164": "+5521988887777",
        "phone_type": "MOBILE",
        "has_whatsapp": true
      },
      "digital_asset": {
        "website_url": "https://barbeariasilva.com.br",
        "website_status": "Ativo"
      },
      "fiscal_data": {
        "cnpj": "12.345.678/0001-99",
        "status_receita": "ATIVA",
        "cnae": "9602-5/01 - Cabeleireiros, manicure e pedicure"
      },
      "marketing_intelligence": {
        "opportunity_score": 75,
        "primary_pitch": "Oferecer serviço de Reivindicação de Perfil e Automação de Agendamentos."
      }
    }
  ]
}
```

## 7. Plano de Validação e Homologação (Critérios de Aceite)
- **Critério de Aceite 1 (Zero Bloqueio):** Executar 5 buscas consecutivas sem timeouts ou 429.
- **Critério de Aceite 2 (Precisão do Telefone):** Tratar "21988887777" e formatar para `+5521988887777`.
- **Critério de Aceite 3 (Resiliência de Links):** URL inválida não deve quebrar a execução, apenas marcar como "Inativo/Quebrado".
