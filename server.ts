import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { PlaywrightCrawler, ProxyConfiguration, Configuration } from "crawlee";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import dotenv from "dotenv";

dotenv.config();

const PORT = 3000;

// Local Memory Database fallback (ensures the dashboard always works instantly)
const FIRST_NAMES = [
  "Alexandre", "Bruna", "Carlos", "Daniela", "Eduardo", "Fernanda", "Gabriel", "Helena", "Igor", "Juliana", "Leonardo", "Mariana", "Newton", "Patricia", "Ricardo", "Sandra", "Thiago", "Vanessa", "Rodrigo", "Camila", "Felipe", "Beatriz", "Gustavo", "Larissa"
];

const LAST_NAMES = [
  "Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira", "Gomes", "Costa", "Ribeiro", "Martins", "Carvalho", "Almeida", "Mendes", "Barros", "Azevedo", "Cardoso"
];

const IMOBILIARIAS = [
  "Lopes Imobiliária", "RE/MAX Aliança", "QuintoAndar", "Souto Imóveis", "Golden Imóveis", "Netimóveis", "Brasil Brokers", "Nova Época", "Z-Imóveis", "Direct Imobiliária", "Consultoria Nobre", "Apsa Administração"
];

let localCorretores: any[] = [];

function generateSimulatedCorretores(state: string, city: string, count = 8) {
  const ddds: Record<string, string> = {
    SP: "11", RJ: "21", MG: "31", PR: "41", SC: "48", DF: "61", BA: "71", PE: "81", CE: "85", RS: "51"
  };
  const ddd = ddds[state.toUpperCase()] || "11";
  const list = [];
  
  for (let i = 0; i < count; i++) {
    const fn = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const ln = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    const name = `${fn} ${ln}`;
    const imob = Math.random() > 0.3 ? IMOBILIARIAS[Math.floor(Math.random() * IMOBILIARIAS.length)] : "Corretor Independente";
    const creciNum = Math.floor(Math.random() * 80000 + 10000);
    const creci = Math.random() > 0.15 ? `CRECI ${creciNum}-F` : `CRECI ${creciNum}-J`;
    const randPhone = `9${Math.floor(Math.random() * 9000 + 1000)}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const phone = `(${ddd}) ${randPhone}`;
    const id = `sim-${state.toLowerCase()}-${city.toLowerCase().replace(/\s+/g, "-")}-${creciNum}`;
    
    list.push({
      id,
      anunciante_id: id,
      nome: name,
      creci,
      telefone: phone,
      estado: state.toUpperCase(),
      cidade: city.trim(),
      imobiliaria: imob,
      criado_em: new Date(Date.now() - i * 15 * 60 * 1000).toISOString(),
    });
  }
  return list;
}

// Supabase Client Lazy Init
let supabase: any = null;
const getSupabase = () => {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    
    // Improved placeholder and validity check
    const isPlaceholder = (s: string | undefined) => 
      !s || s.includes("your-project") || s.includes("your-anon-key") || s.includes("MY_SUPABASE_URL");

    if (isPlaceholder(url) || isPlaceholder(key)) {
      console.warn("Supabase credentials missing or set to placeholders. Data will not be persisted.");
      return null;
    }

    try {
      // Validate URL format before calling createClient to avoid crash in Supabase SDK
      new URL(url!);
      supabase = createClient(url!, key!);
    } catch (err: any) {
      console.error("Failed to initialize Supabase client:", err.message);
      return null;
    }
  }
  return supabase;
};

// Scraper Logic
async function runScraper(state: string, city: string, maxPages = 1) {
  const supabase = getSupabase();
  const baseUrl = `https://www.zapimoveis.com.br/venda/imoveis/${state.toLowerCase()}+${city.toLowerCase().replace(/\s+/g, "-")}/`;
  
  console.log(`Iniciando scraper para: ${state}/${city} - URL: ${baseUrl}`);

  const crawler = new PlaywrightCrawler({
    launchContext: {
      launchOptions: {
        headless: true,
      },
    },
    // Anti-bot: Use stealth mode and fingerprints (handled internally by Crawlee + Playwright)
    maxRequestsPerCrawl: 50,
    minConcurrency: 1,
    maxConcurrency: 1, // Stay subtle
    
    async requestHandler({ page, request, log }) {
      log.info(`Processando: ${request.url}`);
      
      // Simular comportamento humano (scroll)
      await page.evaluate(async () => {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 1000));
      });

      const content = await page.content();
      const $ = cheerio.load(content);
      const nextDataJson = $("#__NEXT_DATA__").html();

      if (!nextDataJson) {
        log.error("Script __NEXT_DATA__ não encontrado.");
        return;
      }

      try {
        const data = JSON.parse(nextDataJson);
        // O mapeamento do Zap Imóveis costuma ficar em:
        // props -> pageProps -> initialResults -> listings
        const listings = data?.props?.pageProps?.initialResults?.results?.listings || [];
        
        log.info(`Encontrados ${listings.length} imóveis nesta página.`);

        const contacts = listings.map((item: any) => {
          const l = item.listing || {};
          const account = l.account || {};
          
          return {
            anunciante_id: account.id || l.id,
            nome: account.name || "N/A",
            creci: account.creci || "N/A",
            telefone: account.phones?.[0] || "",
            imobiliaria: account.name || "",
            estado: state.toUpperCase(),
            cidade: city,
          };
        }).filter((c: any) => c.telefone && c.nome !== "N/A");

        if (contacts.length > 0) {
          // Push to local memory database so it renders instantly
          for (const c of contacts) {
            const index = localCorretores.findIndex(r => r.anunciante_id === c.anunciante_id);
            const item = {
              id: c.anunciante_id || `loc-${Math.random().toString(36).substring(2, 11)}`,
              nome: c.nome,
              creci: c.creci,
              telefone: c.telefone,
              estado: c.estado,
              cidade: c.cidade,
              imobiliaria: c.imobiliaria,
              criado_em: new Date().toISOString()
            };
            if (index > -1) {
              localCorretores[index] = item;
            } else {
              localCorretores.unshift(item);
            }
          }

          if (supabase) {
            const { error } = await supabase
              .from("corretores")
              .upsert(contacts, { onConflict: "anunciante_id" });
            
            if (error) log.error(`Erro no Supabase: ${error.message}`);
            else log.info(`Sucesso: ${contacts.length} registros atualizados no Supabase.`);
          } else {
            log.info(`Sucesso: ${contacts.length} registros salvos no banco local.`);
          }
        }

        // Paginação manual
        if (request.userData.page < maxPages) {
          const nextPage = request.userData.page + 1;
          const nextUrl = `${baseUrl}?pagina=${nextPage}`;
          await crawler.addRequests([{
             url: nextUrl,
             userData: { page: nextPage }
          }]);
        }

      } catch (e: any) {
        log.error(`Erro ao parsear JSON: ${e.message}`);
      }

      // Delay aleatório entre 5 e 12 segundos (como solicitado)
      const delay = Math.floor(Math.random() * (12000 - 5000 + 1) + 5000);
      await new Promise(r => setTimeout(r, delay));
    },
  });

  await crawler.run([{ url: `${baseUrl}?pagina=1`, userData: { page: 1 } }]);
}

const app = express();
app.use(express.json());

// API Routes
app.post("/api/scrape", async (req, res) => {
  console.log("POST /api/scrape received");
  const { state, city } = req.body;
  if (!state || !city) return res.status(400).json({ error: "Estado e Cidade são obrigatórios." });

  // APENAS INICIAR O CRAWLER REAL - sem gerar dados simulados.
  console.log(`Iniciando crawler real para: ${state}/${city}`);

  // 3. Fire up the background crawler to attempt real web scraping too
  if (!process.env.VERCEL) {
    runScraper(state, city, 2).catch(console.error);
  } else {
    console.log("Running on Vercel Serverless: skipping background scraping.");
  }

  res.json({ message: "Motor de busca de corretores iniciado. Capturando registros..." });
});

app.get("/api/corretores", async (req, res) => {
  console.log("GET /api/corretores received");
  const supabase = getSupabase();
  if (!supabase) {
    console.log("No Supabase available, returning local database.");
    // Sort localCorretores by criado_em descending
    localCorretores.sort((a, b) => new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime());
    return res.json(localCorretores);
  }

  try {
    const { data, error } = await supabase
      .from("corretores")
      .select("*")
      .order("criado_em", { ascending: false });

    if (error) {
      console.error("Supabase query error:", error.message);
      // Fallback to local
      localCorretores.sort((a, b) => new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime());
      return res.json(localCorretores);
    }

    // Merge remote real data and local data (eliminate duplicates)
    const combined = [...(data || [])];
    for (const local of localCorretores) {
      const exists = combined.some(r => r.anunciante_id === local.anunciante_id);
      if (!exists) {
        combined.push(local);
      }
    }

    // Sort by criado_em descending
    combined.sort((a, b) => new Date(b.criado_em || 0).getTime() - new Date(a.criado_em || 0).getTime());

    return res.json(combined);
  } catch (err: any) {
    console.error("Failed to fetch from remote Supabase:", err.message);
    localCorretores.sort((a, b) => new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime());
    return res.json(localCorretores);
  }
});

if (!process.env.VERCEL) {
  const startLocalServer = async () => {
    if (process.env.NODE_ENV !== "production") {
      console.log("Starting server in DEVELOPMENT mode with Vite middleware");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      console.log("Starting server in PRODUCTION mode");
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server listening on port ${PORT}`);
    });
  };

  startLocalServer().catch(err => {
    console.error("Failed to start local server:", err);
  });
}

export default app;
