import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { chromium } from "playwright";
import db, { initDB, uuidv4 } from "./database.js";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import igRouter from "./server-ig.js";
import gmapsRouter from "./server-gmaps.js";

dotenv.config();
initDB();

const PORT = process.env.PORT || 3001;

// ── State ─────────────────────────────────────────────────────────────────────
let localCorretores: any[] = [];
let localBuscas: any[] = [];
let scraperRunning = false;
let scraperLog: string[] = [];

function logScraper(msg: string) {
  const ts = new Date().toLocaleTimeString("pt-BR");
  const line = `[${ts}] ${msg}`;
  console.log(line);
  scraperLog.unshift(line);
  if (scraperLog.length > 100) scraperLog.pop();
}

// ── Save contacts ─────────────────────────────────────────────────────────────
async function saveContacts(contacts: any[]) {
  if (contacts.length === 0) return;
  for (const c of contacts) {
    const idx = localCorretores.findIndex(r => r.anunciante_id === c.anunciante_id);
    if (idx > -1) localCorretores[idx] = c;
    else localCorretores.unshift(c);
  }
  
  try {
    const stmt = db.prepare(`
      INSERT INTO corretores (id, anunciante_id, nome, creci, telefone, estado, cidade, imobiliaria, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(anunciante_id) DO UPDATE SET
        nome=excluded.nome,
        creci=excluded.creci,
        telefone=excluded.telefone,
        estado=excluded.estado,
        cidade=excluded.cidade,
        imobiliaria=excluded.imobiliaria,
        criado_em=excluded.criado_em
    `);
    
    const insertMany = db.transaction((items) => {
      for (const c of items) {
        stmt.run(
          uuidv4(), 
          c.anunciante_id, 
          c.nome, 
          c.creci || null, 
          c.telefone, 
          c.estado, 
          c.cidade, 
          c.imobiliaria || null, 
          c.criado_em
        );
      }
    });
    
    insertMany(contacts);
    logScraper(`✅ ${contacts.length} contatos salvos no banco SQLite.`);
  } catch (e: any) {
    logScraper(`⚠️ SQLite Exception: ${e.message}`);
  }
}

// ── Parse contacts from any listing JSON ──────────────────────────────────────
function parseContacts(listings: any[], state: string, city: string, seen: Set<string>): any[] {
  const contacts: any[] = [];
  
  // Step 1: Build a registry of advertisers to resolve RSC references
  const advRegistry = new Map<string, { name?: string, creci?: string, phones: Set<string> }>();
  
  for (const item of listings) {
    const l = item?.listing || item || {};
    const adv = item?.advertiser || l?.advertiser || l?.account || {};
    const advId = String(adv.id || adv.legacyId || "");
    if (!advId) continue;
    
    let entry = advRegistry.get(advId);
    if (!entry) {
      entry = { phones: new Set<string>() };
      advRegistry.set(advId, entry);
    }
    
    if (adv.name && !String(adv.name).startsWith("$")) {
      entry.name = String(adv.name).trim();
    }
    if (adv.license && !String(adv.license).startsWith("$")) {
      entry.creci = String(adv.license).trim();
    }
    if (adv.creci && !String(adv.creci).startsWith("$")) {
      entry.creci = String(adv.creci).trim();
    }
    
    const rawPhones: any[] = [];
    if (Array.isArray(adv.phoneNumbers)) rawPhones.push(...adv.phoneNumbers);
    if (Array.isArray(adv.phones)) rawPhones.push(...adv.phones);
    if (adv.phone) rawPhones.push(adv.phone);
    if (adv.whatsAppNumber) rawPhones.push(adv.whatsAppNumber);
    if (Array.isArray(l.phones)) rawPhones.push(...l.phones);
    if (l.phone) rawPhones.push(l.phone);
    
    for (const p of rawPhones) {
      if (p && typeof p === "string" && !p.startsWith("$")) {
        const digits = p.replace(/\D/g, "");
        if (digits.length >= 8) {
          entry.phones.add(p.trim());
        }
      }
    }
  }
  
  // Step 2: Extract contacts using resolved registry details
  for (const item of listings) {
    const l = item?.listing || item || {};
    const adv = item?.advertiser || l?.advertiser || l?.account || {};
    
    const advId = String(adv.id || adv.legacyId || l.id || l.listingId || "");
    if (!advId) continue;
    
    // Resolve from registry
    const registryEntry = advRegistry.get(advId);
    
    const nome = (registryEntry?.name || adv.name || l.advertiserName || l.name || "").trim();
    const creci = (registryEntry?.creci || adv.license || adv.creci || l.creci || "N/A").trim();
    
    const phones = registryEntry ? Array.from(registryEntry.phones) : [];
    // Fallback if registry didn't capture or wasn't keyed
    if (phones.length === 0) {
      const rawPhones: any[] = [];
      if (Array.isArray(adv.phoneNumbers)) rawPhones.push(...adv.phoneNumbers);
      if (adv.whatsAppNumber) rawPhones.push(adv.whatsAppNumber);
      for (const p of rawPhones) {
        if (p && typeof p === "string" && !p.startsWith("$")) {
          phones.push(p.trim());
        }
      }
    }
    
    const phone = phones[0] || "";
    
    if (!advId || !nome || seen.has(advId)) continue;
    seen.add(advId);
    
    // We only want real estate contacts (either has a phone number or a CRECI)
    if (!phone && creci === "N/A") continue;
    
    contacts.push({
      anunciante_id: advId,
      nome,
      creci,
      telefone: phone || "Não informado",
      imobiliaria: nome || "N/A",
      estado: state.toUpperCase(),
      cidade: city.trim(),
      criado_em: new Date().toISOString(),
    });
  }
  
  return contacts;
}

// ── Recursive search for listings in any parsed JSON ─────────────────────────
function deepFindListings(obj: any, depth = 0): any[] {
  if (depth > 8 || !obj || typeof obj !== "object") return [];
  if (Array.isArray(obj)) {
    if (obj.length > 0 && (obj[0]?.listing || obj[0]?.account || obj[0]?.listingId || obj[0]?.advertiser)) return obj;
    for (const item of obj) {
      const found = deepFindListings(item, depth + 1);
      if (found.length) return found;
    }
    return [];
  }
  if (Array.isArray(obj.listings) && obj.listings.length > 0) return obj.listings;
  for (const key of Object.keys(obj)) {
    const found = deepFindListings(obj[key], depth + 1);
    if (found.length) return found;
  }
  return [];
}

// ── Extract all listings from RSC / script payloads ──────────────────────────
function extractListingsFromText(text: string): any[] {
  const results: any[] = [];
  
  const extractWithBracketCounting = (str: string) => {
    const list: any[] = [];
    const targets = ['"listings":', '"results":'];
    for (const target of targets) {
      let startIdx = str.indexOf(target);
      while (startIdx !== -1) {
        const nextChar = str[startIdx + target.length];
        if (nextChar === '[' || nextChar === '{') {
          const openChar = nextChar;
          const closeChar = nextChar === '[' ? ']' : '}';
          let count = 1;
          let endIdx = startIdx + target.length + 1;
          while (count > 0 && endIdx < str.length) {
            if (str[endIdx] === openChar) count++;
            else if (str[endIdx] === closeChar) count--;
            endIdx++;
          }
          const chunkStr = str.substring(startIdx + target.length, endIdx);
          try {
            const parsed = JSON.parse(chunkStr);
            if (Array.isArray(parsed)) {
              list.push(...parsed);
            } else if (parsed && typeof parsed === "object") {
              const found = deepFindListings(parsed);
              if (found.length > 0) list.push(...found);
            }
          } catch {}
        }
        startIdx = str.indexOf(target, startIdx + 1);
      }
    }
    return list;
  };

  // 1. Process as RSC push calls
  if (text.includes("self.__next_f.push")) {
    const rscPushRegex = /self\.__next_f\.push\(\s*\[\s*\d+\s*,\s*"([\s\S]*?)"\s*\]\s*\)/g;
    let match;
    while ((match = rscPushRegex.exec(text)) !== null) {
      const rawStr = match[1];
      try {
        const jsonCompatibleString = `"${rawStr.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
        const unescaped = JSON.parse(jsonCompatibleString);
        results.push(...extractWithBracketCounting(unescaped));
      } catch {}
    }
  }

  // 2. Process whole text with bracket counting
  results.push(...extractWithBracketCounting(text));

  // 3. Process as complete JSON if possible
  try {
    const trimmed = text.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const parsed = JSON.parse(trimmed);
      results.push(...deepFindListings(parsed));
    }
  } catch {}

  return results;
}

// ── Save search to database ───────────────────────────────────────────────────
async function saveSearch(state: string, city: string, totalContatos: number) {
  const record = {
    id: uuidv4(),
    estado: state.toUpperCase(),
    cidade: city.trim(),
    total_contatos: totalContatos,
    criado_em: new Date().toISOString(),
  };
  // Store in memory (newest first)
  localBuscas.unshift(record);
  if (localBuscas.length > 100) localBuscas.pop();

  try {
    const stmt = db.prepare(`
      INSERT INTO buscas (id, estado, cidade, total_contatos, criado_em)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(record.id, record.estado, record.cidade, record.total_contatos, record.criado_em);
    
    logScraper(`📚 Busca salva no banco de dados SQLite.`);
  } catch (e: any) {
    logScraper(`⚠️ SQLite Exception (buscas): ${e.message}`);
  }
}

// ── Main scraper ──────────────────────────────────────────────────────────────
async function runScraper(state: string, city: string, neighborhood = "") {
  if (scraperRunning) { logScraper("⚠️ Scraper já em execução."); return; }
  scraperRunning = true;
  scraperLog = [];

  const citySlug = city.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-");
  const stateSlug = state.toLowerCase();
  const neighborhoodSlug = neighborhood ? neighborhood.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-") : "";

  logScraper(`🚀 Iniciando captura real: ${state.toUpperCase()}/${city}${neighborhood ? ` - ${neighborhood}` : ""}`);

  let browser: any = null;
  try {
    browser = await chromium.launch({
      headless: true,
      channel: "chrome",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--window-size=1366,768",
      ],
    });

    const seen = new Set<string>();
    let totalCaptured = 0;
    const maxPages = 9999;
    let consecutiveEmpty = 0;

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      if (!scraperRunning) {
        logScraper("🛑 Extração cancelada pelo usuário.");
        break;
      }
      const locationPath = neighborhoodSlug
        ? `${stateSlug}+${citySlug}+${neighborhoodSlug}`
        : `${stateSlug}+${citySlug}`;
      const url = `https://www.zapimoveis.com.br/venda/imoveis/${locationPath}/?pagina=${pageNum}`;
      logScraper(`📄 Página ${pageNum}...`);

      const context = await browser.newContext({
        viewport: { width: 1366, height: 768 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        extraHTTPHeaders: {
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Sec-Ch-Ua":
            '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
          "Sec-Ch-Ua-Mobile": "?0",
          "Sec-Ch-Ua-Platform": '"Windows"',
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
        },
      });

      // ── Stealth: mascarar todas as propriedades detectáveis pelo Cloudflare ──
      await context.addInitScript(() => {
        // Ocultar webdriver
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        // Simular plugins de navegador real
        Object.defineProperty(navigator, "plugins", {
          get: () => [1, 2, 3, 4, 5],
        });
        // Simular idiomas
        Object.defineProperty(navigator, "languages", {
          get: () => ["pt-BR", "pt", "en-US", "en"],
        });
        // Simular objeto chrome
        (window as any).chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
        // Corrigir permissões
        const origQuery = window.navigator.permissions?.query.bind(window.navigator.permissions);
        if (origQuery) {
          (window.navigator.permissions as any).query = (parameters: any) =>
            parameters.name === "notifications"
              ? Promise.resolve({ state: Notification.permission })
              : origQuery(parameters);
        }
      });

      const page = await context.newPage();
      const interceptedListings: any[] = [];

      // ── Interceptar respostas de API de rede (mais robusto que parsear scripts) ──
      page.on("response", async (response) => {
        try {
          const respUrl = response.url();
          const ct = response.headers()["content-type"] || "";
          if (
            ct.includes("application/json") &&
            (respUrl.includes("zapimoveis") || respUrl.includes("glue-api") || respUrl.includes("vivareal"))
          ) {
            const body = await response.json().catch(() => null);
            if (body) {
              const found = deepFindListings(body);
              if (found.length > 0) interceptedListings.push(...found);
            }
          }
        } catch {}
      });

      try {
        // Delay aleatório pré-navegação (comportamento humano)
        await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

        // Verificar e aguardar Cloudflare
        let blocked = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          const title = await page.title();
          const titleLow = title.toLowerCase();
          if (!titleLow.includes("attention") && !titleLow.includes("cloudflare") && !titleLow.includes("just a moment")) break;
          if (attempt === 9) { blocked = true; break; }
          logScraper(`🛡️ Cloudflare... aguardando (${attempt + 1}/10)`);
          await page.waitForTimeout(6000);
        }

        if (blocked) {
          logScraper(`🔒 IP temporariamente bloqueado pelo Cloudflare. Aguardando 60s antes de tentar novamente...`);
          await page.close().catch(() => {});
          await context.close().catch(() => {});
          await new Promise(r => setTimeout(r, 60000));
          consecutiveEmpty++;
          if (consecutiveEmpty >= 3) {
            logScraper(`⛔ Bloqueio persistente. Encerrando para evitar penalidade maior.`);
            break;
          }
          pageNum--; // retry same page
          continue;
        }

        consecutiveEmpty = 0;
        const title = await page.title();
        logScraper(`📌 "${title}"`);

        // Aguardar carregamento completo
        await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});

        // Simular comportamento humano: scroll e movimento de mouse
        await page.mouse.move(200 + Math.random() * 700, 100 + Math.random() * 400);
        await page.waitForTimeout(500 + Math.random() * 800);
        await page.evaluate(() => window.scrollBy(0, 300 + Math.random() * 400));
        await page.waitForTimeout(600 + Math.random() * 600);

        // Extrair dados de scripts inline (RSC streaming do Next.js)
        const scriptTexts = await page
          .$$eval("script:not([src])", (els) =>
            els.map((el) => el.textContent || "").filter((t) => t.length > 100)
          )
          .catch(() => [] as string[]);

        for (const text of scriptTexts) {
          if (
            text.includes("listings") ||
            text.includes("advertiser") ||
            text.includes("phone") ||
            text.includes("self.__next_f")
          ) {
            const found = extractListingsFromText(text);
            if (found.length) {
              logScraper(`📡 Script inline: ${found.length} listings`);
              interceptedListings.push(...found);
            }
          }
        }

        // Processar dados coletados (via API ou scripts)
        if (interceptedListings.length > 0) {
          const contacts = parseContacts(interceptedListings, state, city, seen);
          if (contacts.length > 0) {
            logScraper(`📞 Página ${pageNum}: ${contacts.length} contatos capturados!`);
            await saveContacts(contacts);
            totalCaptured += contacts.length;
          } else {
            logScraper(`⚠️ Página ${pageNum}: ${interceptedListings.length} listings sem telefone/CRECI.`);
          }
        } else {
          logScraper(`❌ Página ${pageNum}: sem dados. Fim dos resultados.`);
          break;
        }
      } catch (err: any) {
        logScraper(`❌ Página ${pageNum}: ${err.message}`);
      } finally {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
      }

      if (pageNum < maxPages && scraperRunning) {
        const delay = 8000 + Math.random() * 5000;
        logScraper(`⏳ Aguardando ${Math.round(delay / 1000)}s...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    logScraper(`🏁 Concluído! ${totalCaptured} contatos reais capturados.`);
    if (totalCaptured > 0) await saveSearch(state, city, totalCaptured);
  } catch (err: any) {
    logScraper(`🔥 Erro crítico: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    scraperRunning = false;
  }
}

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ── Rotas Modularizadas ───────────────────────────────────────────────────────
app.use("/api/ig", igRouter);
app.use("/api/gmaps", gmapsRouter);

app.post("/api/scrape", async (req, res) => {
  const { state, city, neighborhood } = req.body;
  if (!state || !city) return res.status(400).json({ error: "Estado e Cidade são obrigatórios." });
  if (scraperRunning) return res.json({ message: "Extração já em andamento. Aguarde...", running: true });

  runScraper(state, city, neighborhood).catch(console.error);
  res.json({
    message: `🚀 Captura real iniciada para ${state.toUpperCase()}/${city}${neighborhood ? ` - ${neighborhood}` : ""}. Contatos aparecerão em instantes...`,
    running: true,
  });
});

app.post("/api/stop", (_req, res) => {
  if (scraperRunning) {
    scraperRunning = false;
    res.json({ message: "Sinal de parada enviado. Encerrando página atual..." });
  } else {
    res.json({ message: "Nenhuma extração em andamento." });
  }
});

app.get("/api/scrape-status", (_req, res) => {
  res.json({ running: scraperRunning, log: scraperLog.slice(0, 30) });
});

app.get("/api/corretores", async (_req, res) => {
  try {
    const data = db.prepare("SELECT * FROM corretores ORDER BY criado_em DESC").all();
    const combined = [...(data || [])];
    for (const local of localCorretores) {
      if (!combined.some((r: any) => r.anunciante_id === local.anunciante_id)) combined.push(local);
    }
    combined.sort((a: any, b: any) =>
      new Date(b.criado_em || 0).getTime() - new Date(a.criado_em || 0).getTime()
    );
    return res.json(combined);
  } catch (e) { 
    return res.json(localCorretores); 
  }
});

// ── Saved searches endpoints ─────────────────────────────────────────────────
app.get("/api/buscas", async (_req, res) => {
  try {
    const data = db.prepare("SELECT * FROM buscas ORDER BY criado_em DESC LIMIT 50").all();
    return res.json(data || localBuscas);
  } catch (e) { 
    return res.json(localBuscas); 
  }
});

// Load a saved search's contacts by state+city
app.post("/api/buscas/load", async (req, res) => {
  const { state, city } = req.body;
  if (!state || !city) return res.status(400).json({ error: "state e city são obrigatórios" });

  try {
    const data = db.prepare("SELECT * FROM corretores WHERE estado = ? AND cidade LIKE ? ORDER BY criado_em DESC").all(state.toUpperCase(), `%${city}%`);
    return res.json(data || []);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Delete a saved search and its corresponding contacts
app.delete("/api/buscas/:id", async (req, res) => {
  const { id } = req.params;
  const estado = req.query.estado as string;
  const cidade = req.query.cidade as string;

  if (!id) return res.status(400).json({ error: "ID da busca é obrigatório" });

  // 1. Remove from in-memory searches
  localBuscas = localBuscas.filter(b => b.id !== id);

  // 2. Remove associated contacts from in-memory if state and city are provided
  if (estado && cidade) {
    localCorretores = localCorretores.filter(
      c => !(c.estado === estado.toUpperCase() && c.cidade.toLowerCase() === cidade.toLowerCase())
    );
  }

  try {
    // 3. Delete from "buscas" table
    db.prepare("DELETE FROM buscas WHERE id = ?").run(id);

    // 4. Delete from "corretores" table
    if (estado && cidade) {
      db.prepare("DELETE FROM corretores WHERE estado = ? AND cidade LIKE ?").run(estado.toUpperCase(), `%${cidade}%`);
    }
  } catch (err: any) {
    console.error("Erro ao excluir busca no SQLite:", err);
    return res.status(500).json({ error: "Erro ao excluir busca do banco de dados." });
  }

  res.json({ message: "Busca e contatos associados excluídos com sucesso." });
});

app.post("/api/corretores/:id/msg_enviada", async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "ID é obrigatório" });

  // Update in memory if it exists
  const corretorIndex = localCorretores.findIndex(c => c.id === id);
  if (corretorIndex > -1) {
    localCorretores[corretorIndex].msg_enviada = 1;
  }

  try {
    const stmt = db.prepare("UPDATE corretores SET msg_enviada = 1 WHERE id = ?");
    const info = stmt.run(id);
    if (info.changes === 0) {
      return res.status(404).json({ error: "Corretor não encontrado." });
    }
    res.json({ message: "Status atualizado com sucesso." });
  } catch (err: any) {
    console.error("Erro ao atualizar msg_enviada:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
});

app.delete("/api/corretores", async (req, res) => {
  const estado = req.query.estado as string;
  const cidade = req.query.cidade as string;

  if (!estado || !cidade) {
    return res.status(400).json({ error: "Estado e Cidade são obrigatórios para limpar a base." });
  }

  // Clear from in-memory array for this specific city
  localCorretores = localCorretores.filter(
    c => !(c.estado === estado.toUpperCase() && c.cidade.toLowerCase() === cidade.toLowerCase())
  );

  try {
    db.prepare("DELETE FROM corretores WHERE estado = ? AND cidade LIKE ?").run(estado.toUpperCase(), `%${cidade}%`);
    
    // Also delete the "busca salva" record for this city to keep things consistent when a new scrape starts
    db.prepare("DELETE FROM buscas WHERE estado = ? AND cidade LIKE ?").run(estado.toUpperCase(), `%${cidade}%`);
    
    localBuscas = localBuscas.filter(
      b => !(b.estado === estado.toUpperCase() && b.cidade.toLowerCase() === cidade.toLowerCase())
    );
  } catch (err: any) {
    console.error("Erro ao limpar banco SQLite:", err);
    return res.status(500).json({ error: "Erro ao limpar banco de dados." });
  }
  
  res.json({ message: `Base limpa para ${estado}/${cidade}.` });
});

// ── Dev server ────────────────────────────────────────────────────────────────
if (!process.env.VERCEL) {
  const startLocalServer = async () => {
    if (process.env.NODE_ENV !== "production") {
      console.log("🌐 Modo DESENVOLVIMENTO — Vite middleware ativo");
      const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
    }
    app.listen(PORT, "0.0.0.0", () =>
      console.log(`✅ Servidor rodando em http://localhost:${PORT}`)
    );
  };
  startLocalServer().catch(console.error);
}

export default app;
