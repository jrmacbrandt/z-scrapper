import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { PlaywrightCrawler, ProxyConfiguration, Configuration } from "crawlee";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import dotenv from "dotenv";

dotenv.config();

const PORT = 3000;

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

        if (supabase && contacts.length > 0) {
          const { error } = await supabase
            .from("corretores")
            .upsert(contacts, { onConflict: "anunciante_id" });
          
          if (error) log.error(`Erro no Supabase: ${error.message}`);
          else log.info(`Sucesso: ${contacts.length} registros atualizados.`);
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

async function startServer() {
  const app = express();
  app.use(express.json());

  // API Routes
  app.post("/api/scrape", async (req, res) => {
    console.log("POST /api/scrape received");
    const { state, city } = req.body;
    if (!state || !city) return res.status(400).json({ error: "Estado e Cidade são obrigatórios." });

    runScraper(state, city, 2).catch(console.error);
    res.json({ message: "Scraper iniciado com sucesso. Os dados aparecerão no dashboard em instantes." });
  });

  app.get("/api/corretores", async (req, res) => {
    console.log("GET /api/corretores received");
    const supabase = getSupabase();
    if (!supabase) return res.json([]);

    const { data, error } = await supabase
      .from("corretores")
      .select("*")
      .order("criado_em", { ascending: false });

    if (error) {
      console.error("Supabase query error:", error.message);
      return res.status(500).json({ error: error.message });
    }
    res.json(data || []);
  });

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
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
});
