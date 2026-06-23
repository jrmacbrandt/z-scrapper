import { Router, Request, Response } from "express";
import axios from "axios";
import https from "https";
import libphonenumber from "google-libphonenumber";
import dotenv from "dotenv";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import db from "./database.js";
import {
  getStealthContextOptions,
  getStealthInitScript,
  getProxyLaunchArgs,
  humanDelay,
  microPause,
  detectBlock,
  setupHttpLogger,
  humanMouseMove,
  humanScroll,
} from "./stealth-utils.js";

chromium.use(stealth());
dotenv.config();

const router = Router();
const phoneUtil = libphonenumber.PhoneNumberUtil.getInstance();
const PhoneNumberFormat = libphonenumber.PhoneNumberFormat;

// TLS: desabilitado por request via httpsAgent em pingWebsite (não globalmente)

async function pingWebsite(url: string | null): Promise<string> {
  if (!url) return "Sem Website";
  
  let targetUrl = url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = "http://" + targetUrl;
  }

  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const headers = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache"
  };

  const agent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true
  });

  // Tenta HEAD primeiro (mais rápido)
  try {
    const res = await axios.head(targetUrl, {
      headers,
      timeout: 4000,
      httpsAgent: agent,
      validateStatus: () => true, // Não lança erro para nenhum status HTTP
      maxRedirects: 5
    });
    
    // Se respondeu com qualquer status de sucesso ou redirecionamento
    if (res.status >= 200 && res.status < 400) {
      return "Ativo";
    }
    // Se o HEAD deu erro de permissão (401, 403, 405) mas o servidor respondeu, o site provavelmente está ativo (apenas bloqueou o método HEAD)
    if ([401, 403, 405].includes(res.status)) {
      return await pingGetFallback(targetUrl, headers, agent);
    }
  } catch (e: any) {
    return await pingGetFallback(targetUrl, headers, agent);
  }

  return "Inativo/Quebrado";
}

async function pingGetFallback(url: string, headers: any, agent: any): Promise<string> {
  try {
    const res = await axios.get(url, {
      headers,
      timeout: 5000,
      httpsAgent: agent,
      validateStatus: () => true, // Não lança erro para nenhum status HTTP
      maxRedirects: 5
    });

    if (res.status >= 200 && res.status < 405) {
      return "Ativo";
    }
  } catch (err: any) {
    const errMsg = err.message || "";
    if (errMsg.includes("CERT_") || errMsg.includes("unable to verify the first certificate") || errMsg.includes("certificate has expired")) {
      return "Ativo";
    }
  }
  return "Inativo/Quebrado";
}

// ── State de Monitoramento do Google Maps ─────────────────────────────────────
let gmapsScraperRunning = false;
let gmapsScraperStopRequested = false;
let gmapsScraperLog: string[] = [];

function logGmaps(msg: string) {
  const ts = new Date().toLocaleTimeString("pt-BR");
  const line = `[${ts}] 📍 ${msg}`;
  console.log(line);
  gmapsScraperLog.push(line);
  if (gmapsScraperLog.length > 100) gmapsScraperLog.shift();
}

// ── Endpoints de UI (Status, Logs, Listagem e Exclusão) ─────────────────────────

router.get("/status", (req: Request, res: Response) => {
  res.json({ running: gmapsScraperRunning, log: gmapsScraperLog });
});

router.post("/stop", (req: Request, res: Response) => {
  if (gmapsScraperRunning) {
    gmapsScraperStopRequested = true;
    logGmaps("🛑 Usuário solicitou parada. Finalizando extração do Google Maps...");
    res.json({ message: "Parando processo atual..." });
  } else {
    res.json({ message: "Nenhum processo rodando no momento." });
  }
});

router.get("/buscas", async (req: Request, res: Response) => {
  try {
    const data = db.prepare("SELECT * FROM gmaps_buscas ORDER BY criado_em DESC").all();
    res.json(data || []);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/leads", async (req: Request, res: Response) => {
  const buscaId = req.query.buscaId as string;
  try {
    let data;
    if (buscaId && buscaId !== "*") {
      data = db.prepare("SELECT * FROM gmaps_leads WHERE busca_id = ? ORDER BY criado_em DESC").all(buscaId);
    } else {
      data = db.prepare("SELECT * FROM gmaps_leads ORDER BY criado_em DESC LIMIT 2000").all();
    }
    res.json(data || []);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/buscas/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    db.prepare("DELETE FROM gmaps_leads WHERE busca_id = ?").run(id);
    db.prepare("DELETE FROM gmaps_buscas WHERE id = ?").run(id);
    res.json({ message: "Busca e contatos associados excluídos com sucesso." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});
// Tipagem de Resposta Esperada
interface LeadResult {
  gmb_id: string;
  company_name: string;
  raw_name: string;
  presence: {
    google_rating: number;
    reviews_count: number;
    is_claimed: boolean;
  };
  contact: {
    phone_raw: string;
    phone_e164: string | null;
    phone_type: string;
    has_whatsapp: boolean;
  };
  digital_asset: {
    website_url: string | null;
    website_status: string;
  };
  fiscal_data: {
    cnpj: string | null;
    status_receita: string | null;
    cnae: string | null;
  };
  marketing_intelligence: {
    opportunity_score: number;
    primary_pitch: string;
  };
}

interface ApiResponse {
  search_metadata: {
    keyword: string;
    location: string;
    total_extracted: number;
  };
  leads: LeadResult[];
}

router.post("/extract-serper", async (req: Request, res: Response) => {
  try {
    const { keyword, location } = req.body;

    // Validação de Parâmetros
    if (!keyword || !location) {
      return res.status(400).json({ error: "Parâmetros 'keyword' e 'location' são obrigatórios." });
    }

    // MÓDULO 1: EXTRAÇÃO ANTI-BLOQUEIO (SERPER.DEV)
    const serperApiKey = process.env.SERPER_API_KEY;
    if (!serperApiKey) {
      return res.status(500).json({ error: "SERPER_API_KEY não configurada no servidor." });
    }

    const serperPayload = {
      q: `${keyword} ${location}`,
      gl: "br",
      hl: "pt-br"
    };

    let serperData;
    try {
      const response = await fetch("https://google.serper.dev/maps", {
        method: "POST",
        headers: {
          "X-API-KEY": serperApiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(serperPayload)
      });
      if (!response.ok) {
        throw new Error(`Serper API retornou ${response.status}`);
      }
      serperData = await response.json();
    } catch (err: any) {
      return res.status(502).json({ error: "Falha na comunicação com a API Serper.dev", details: err.message });
    }

    const rawPlaces = serperData.places || [];
    
    // Preparação de chamadas assíncronas paralelas para todos os leads
    // Vamos criar um array de promessas que processam cada lead de ponta a ponta
    const processLeadPromises = rawPlaces.map(async (place: any) => {
      
      // MÓDULO 2: SANITIZAÇÃO E LIMPEZA LOCAL
      const rawName = place.title || "";
      // Regex: Remover emojis, caracteres especiais no início/fim, ou descritores após hífens comuns em nomes de GMB
      let companyName = rawName.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '') // Remove emojis
                               .split(/ - | \| | \/ /)[0] // Tira " - Barbearia", " | Melhor de Caxias"
                               .trim();
                               
      // Telefone parsing
      let phoneE164: string | null = null;
      let phoneType = "UNKNOWN";
      let hasWhatsapp = false;
      const rawPhone = place.phoneNumber || "";

      if (rawPhone) {
        try {
          const number = phoneUtil.parseAndKeepRawInput(rawPhone, "BR");
          if (phoneUtil.isValidNumber(number)) {
            phoneE164 = phoneUtil.format(number, PhoneNumberFormat.E164);
            const type = phoneUtil.getNumberType(number);
            
            // google-libphonenumber: 0=FIXED_LINE, 1=MOBILE, 2=FIXED_LINE_OR_MOBILE
            if (type === 1 || type === 2) {
              phoneType = "MOBILE";
              hasWhatsapp = true;
            } else if (type === 0) {
              phoneType = "FIXED_LINE";
            } else {
              phoneType = "OTHER";
            }
          }
        } catch (e) {
          // Ignora erro de formatação e segue
        }
      }

      // MÓDULO 3: VALIDAÇÃO DE CONECTIVIDADE (HTTP PING ASYNC)
      const websiteUrl = place.website || null;
      const websiteStatus = await pingWebsite(websiteUrl);

      const isActuallyClaimed = place.unclaimedListing === true ? false : true;

      // MÓDULO 4: ENRIQUECIMENTO FISCAL (BRASILAPI / OPENCNPJ)
      let fiscalData = {
        cnpj: null as string | null,
        status_receita: null as string | null,
        cnae: null as string | null
      };

      try {
        // Na prática, buscar por Razão Social em APIs gratuitas abertas e ilimitadas é difícil sem chave.
        // A BrasilAPI só permite busca por CNPJ. A MinhaReceita permite busca aproximada mas tem rate limits.
        // O código abaixo demonstra a resiliência pedida no PRD. Se o fetch falhar, a promessa falha localmente
        // no catch, e prosseguimos com o Enriquecimento Fiscal vazio sem estourar 500 no pipeline inteiro.
        
        // Exemplo fictício/teórico de busca em api.opencnpj.com (substituir por API real válida):
        // const cnpjSearch = await axios.get(`https://api.opencnpj.com/v1/search?q=${encodeURIComponent(companyName)}`, { timeout: 3000 });
        // if (cnpjSearch.data && cnpjSearch.data.length > 0) {
        //   fiscalData.cnpj = cnpjSearch.data[0].cnpj;
        //   fiscalData.status_receita = cnpjSearch.data[0].status;
        //   fiscalData.cnae = cnpjSearch.data[0].cnae_principal;
        // }
      } catch (err) {
        // Silenciosamente falha e não preenche o CNPJ (Resiliência)
      }

      // MÓDULO 5: SCORE DE OPORTUNIDADE (ALGORITMO)
      let score = 100;
      if (websiteStatus === "Inativo/Quebrado") score -= 30;
      if (!websiteUrl) score -= 20;
      if (isActuallyClaimed === false) score -= 25;
      
      const rating = place.rating || 0;
      const reviewCount = place.ratingCount || 0;
      if (rating < 4.0 && reviewCount > 0) score -= 15;
      if (phoneType === "FIXED_LINE") score -= 10;

      // Pitch suggestion baseado na matriz do PRD
      let pitch = "Abordagem padrão de vendas.";
      if (isActuallyClaimed === false) {
        pitch = "Oferecer serviço de Reivindicação e Configuração do Perfil do GMB.";
      } else if (websiteStatus === "Inativo/Quebrado") {
        pitch = "Venda de Desenvolvimento Web / Correção de Site fora do ar.";
      } else if (phoneType === "MOBILE") {
        pitch = "Disparar abordagem comercial via WhatsApp automatizado/manual.";
      }

      // Montar Lead Final
      const leadResult: LeadResult = {
        gmb_id: place.cid || place.id || `temp_${Math.random().toString(36).substring(7)}`,
        company_name: companyName,
        raw_name: rawName,
        presence: {
          google_rating: rating,
          reviews_count: reviewCount,
          is_claimed: isActuallyClaimed
        },
        contact: {
          phone_raw: rawPhone,
          phone_e164: phoneE164,
          phone_type: phoneType,
          has_whatsapp: hasWhatsapp
        },
        digital_asset: {
          website_url: websiteUrl,
          website_status: websiteStatus
        },
        fiscal_data: fiscalData,
        marketing_intelligence: {
          opportunity_score: Math.max(0, score),
          primary_pitch: pitch
        }
      };

      return leadResult;
    });

    // RNF4.1.1: Processamento em Paralelo usando Promise.allSettled
    const results = await Promise.allSettled(processLeadPromises);
    
    const finalLeads: LeadResult[] = [];
    results.forEach(res => {
      if (res.status === "fulfilled" && res.value) {
        finalLeads.push(res.value);
      }
    });

    const finalResponse: ApiResponse = {
      search_metadata: {
        keyword,
        location,
        total_extracted: finalLeads.length
      },
      leads: finalLeads
    };

    return res.status(200).json(finalResponse);

  } catch (error: any) {
    console.error("[GMAPS API] Erro no processamento do LocalLeads Engine:", error);
    return res.status(500).json({ error: "Erro interno no servidor", details: error.message });
  }
});

// MÓDULO LOCAL - ROBÔ INVISÍVEL (PLAYWRIGHT)
router.post("/extract-local", async (req: Request, res: Response) => {
  if (gmapsScraperRunning) {
    return res.status(400).json({ error: "Outra extração do Google Maps já está rodando." });
  }

  const { keyword, location } = req.body;
  if (!keyword || !location) {
    return res.status(400).json({ error: "Parâmetros 'keyword' e 'location' são obrigatórios." });
  }

  gmapsScraperRunning = true;
  gmapsScraperStopRequested = false;
  gmapsScraperLog = [];

  logGmaps(`Iniciando extração do Google Maps para: "${keyword}" em "${location}"...`);

  // Respond immediately so frontend can poll status/logs
  res.json({ message: `Iniciando motor Chromium Stealth para Google Maps...`, running: true });

  // Run the scraper in background
  (async () => {
    let browser: any = null;
    let removeHttpLogger: (() => void) | null = null;
    
    try {
      logGmaps(`Iniciando motor Chromium Stealth (Anti-Detecção v2.0)...`);
      browser = await chromium.launch({
        headless: false,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
          "--no-sandbox",
          "--disable-dev-shm-usage",
        ],
        ...getProxyLaunchArgs(),
      });
      const contextOptions = getStealthContextOptions({
        locale: "pt-BR",
        timezoneId: "America/Sao_Paulo",
      });
      const context = await browser.newContext(contextOptions);
      await context.addInitScript(getStealthInitScript());
      const page = await context.newPage();
      
      // Setup HTTP response logger
      removeHttpLogger = setupHttpLogger(page, (msg) => logGmaps(msg));
      
      const query = encodeURIComponent(`${keyword} ${location}`);
      logGmaps(`Navegando para busca do Google Maps...`);
      await page.goto(`https://www.google.com/maps/search/${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

      await page.evaluate(() => {
        alert("Aviso do Robô: A navegação começou. Se aparecer um CAPTCHA (teste de imagem) para confirmar que você é humano, clique em 'OK' aqui, resolva o desafio e aguarde. O robô continuará sozinho assim que detectar que foi resolvido.");
      }).catch(() => {});

      // Simular comportamento humano após carregamento
      await humanDelay(2000, 4000);
      await humanMouseMove(page, 400 + Math.random() * 400, 300 + Math.random() * 200);

      let rawPlaces: any[] = [];
      
      // Verificar bloqueio/CAPTCHA após carregamento
      let blockCheck = await detectBlock(page);
      if (blockCheck.isBlocked) {
        logGmaps(`🚨 CAPTCHA detectado (${blockCheck.reason}). Aguardando resolução manual (até 3 minutos)...`);
        
        await page.bringToFront().catch(() => {});
        await page.evaluate(() => {
          setTimeout(() => alert("🚨 AÇÃO NECESSÁRIA: O robô encontrou um bloqueio ou CAPTCHA!\n\nPor favor, resolva para que o robô continue.\n\n⚠️ IMPORTANTE: Se o teste de imagens NÃO aparecer e a página mostrar apenas texto, significa que o Google bloqueou temporariamente o seu IP (Hard Block). Nesse caso, feche e conecte-se a outra rede (ex: Wi-Fi do celular) ou reinicie o modem, depois volte e dê F5 na página!"), 500);
        }).catch(() => {});
        
        // Aguardando silenciosamente a resolução (aviso já foi dado na abertura)
        
        let attempts = 0;
        while (blockCheck.isBlocked && attempts < 36) {
          if (gmapsScraperStopRequested) break;
          await new Promise(resolve => setTimeout(resolve, 5000));
          blockCheck = await detectBlock(page);
          attempts++;
        }
        
        if (blockCheck.isBlocked) {
          logGmaps(`❌ Tempo esgotado para resolução do CAPTCHA. Abortando.`);
          await browser.close();
          gmapsScraperRunning = false;
          return;
        } else if (!gmapsScraperStopRequested) {
          logGmaps(`✅ CAPTCHA resolvido! Retomando extração...`);
        }
      }
      
      try {
        const acceptButton = page.locator('button:has-text("Aceitar tudo"), button:has-text("Accept all")').first();
        if (await acceptButton.isVisible({ timeout: 2000 })) {
          logGmaps(`Clicando em "Aceitar Cookies"...`);
          await acceptButton.click();
          await humanDelay(1000, 2000);
        }
      } catch(e) {}

      try {
        logGmaps(`Aguardando feed de estabelecimentos carregar...`);
        await page.waitForSelector('div[role="feed"]', { timeout: 10000 });
        const feed = page.locator('div[role="feed"]');
        
        logGmaps(`Rolando feed de estabelecimentos (scroll humanizado)...`);
        // Scroll humanizado (4 vezes com delays aleatórios 2-4s)
        for (let i = 0; i < 4; i++) {
          if (gmapsScraperStopRequested) break;
          await feed.evaluate((node) => {
            const scrollAmount = node.clientHeight * (0.6 + Math.random() * 0.4);
            node.scrollTop += scrollAmount;
          });
          await humanDelay(2000, 4000);
          await humanMouseMove(page, 300 + Math.random() * 600, 200 + Math.random() * 400);
        }

        if (gmapsScraperStopRequested) {
          logGmaps("🛑 Extração interrompida pelo usuário antes da coleta profunda.");
          await browser.close();
          gmapsScraperRunning = false;
          return;
        }

        // Seletores primário + fallbacks baseados em ARIA roles
        rawPlaces = await page.evaluate(() => {
          let items = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
          
          if (items.length === 0) {
            const feed = document.querySelector('[role="feed"]');
            if (feed) {
              const articles = Array.from(feed.querySelectorAll('[role="article"] a[href]'));
              items = articles.filter(el => el.getAttribute('href')?.includes('/maps/'));
            }
          }
          
          return items.map(el => ({
            title: el.getAttribute('aria-label') || "",
            href: (el as HTMLAnchorElement).href,
            rating: 0,
            ratingCount: 0,
            website: null,
            phoneNumber: null,
            unclaimedListing: false,
            id: Math.random().toString(36).substring(7)
          })).filter(item => item.title !== "");
        });

        logGmaps(`🔍 Encontrados ${rawPlaces.length} estabelecimentos. Iniciando coleta profunda de telefones e websites...`);

        // --- DEEP EXTRACTION LOOP (com delays anti-detecção) ---
        for (let idx = 0; idx < rawPlaces.length; idx++) {
           if (gmapsScraperStopRequested) {
             logGmaps("🛑 Extração interrompida pelo usuário.");
             break;
           }
           const place = rawPlaces[idx];
           if (!place.href) continue;
           
           logGmaps(`Inspecionando [${idx + 1}/${rawPlaces.length}]: ${place.title}...`);
           try {
              await humanDelay(3000, 5000);
              await page.goto(place.href, { waitUntil: 'domcontentloaded', timeout: 8000 });
              await humanDelay(2000, 3000);
              await humanMouseMove(page, 300 + Math.random() * 400, 200 + Math.random() * 300);
              
              let deepBlockCheck = await detectBlock(page);
              if (deepBlockCheck.isBlocked) {
                logGmaps(`🚨 CAPTCHA detectado (${deepBlockCheck.reason}). Aguardando resolução manual (até 3 minutos)...`);
                
                await page.bringToFront().catch(() => {});
                await page.evaluate(() => {
                  setTimeout(() => alert("🚨 AÇÃO NECESSÁRIA: O robô encontrou um bloqueio ou CAPTCHA!\n\nPor favor, resolva para que o robô continue.\n\n⚠️ IMPORTANTE: Se o teste de imagens NÃO aparecer e a página mostrar apenas texto, significa que o Google bloqueou temporariamente o seu IP (Hard Block). Nesse caso, feche e conecte-se a outra rede (ex: Wi-Fi do celular) ou reinicie o modem, depois volte e dê F5 na página!"), 500);
                }).catch(() => {});
                
                // Aguardando silenciosamente a resolução (aviso já foi dado na abertura)
                
                let attempts = 0;
                while (deepBlockCheck.isBlocked && attempts < 36) {
                  if (gmapsScraperStopRequested) break;
                  await new Promise(resolve => setTimeout(resolve, 5000));
                  deepBlockCheck = await detectBlock(page);
                  attempts++;
                }
                
                if (deepBlockCheck.isBlocked) {
                  logGmaps(`❌ Tempo esgotado para resolução do CAPTCHA na coleta profunda. Pulando lead.`);
                  break;
                } else if (!gmapsScraperStopRequested) {
                  logGmaps(`✅ CAPTCHA resolvido! Continuando a coletar dados do lead...`);
                }
              }
              
              const deepData = await page.evaluate(() => {
                 let phoneNumber: string | null = null;
                 const phoneBtn = document.querySelector('button[data-item-id^="phone:"]');
                 if (phoneBtn) {
                   phoneNumber = phoneBtn.getAttribute('aria-label')?.replace(/Telefone:\s*/i, '').replace(/Phone:\s*/i, '').trim() || (phoneBtn as HTMLElement).innerText || null;
                 }
                 if (!phoneNumber) {
                   const allButtons = Array.from(document.querySelectorAll('button[aria-label]'));
                   for (const btn of allButtons) {
                     const label = btn.getAttribute('aria-label') || '';
                     if (/\(?\d{2}\)?\s?\d{4,5}[-.\s]?\d{4}/.test(label) || /\+55/.test(label)) {
                       phoneNumber = label.replace(/Telefone:\s*/i, '').replace(/Phone:\s*/i, '').trim();
                       break;
                     }
                   }
                 }
                 
                 let website: string | null = null;
                 const websiteBtn = document.querySelector('a[data-item-id="authority"]');
                 if (websiteBtn) {
                   website = websiteBtn.getAttribute('href');
                 }
                 if (!website) {
                   const allLinks = Array.from(document.querySelectorAll('a[href]'));
                   for (const link of allLinks) {
                     const label = link.getAttribute('aria-label') || '';
                     if (label.toLowerCase().includes('site') || label.toLowerCase().includes('website')) {
                       website = link.getAttribute('href');
                       break;
                     }
                   }
                 }

                 let rating = 0, ratingCount = 0;

                 // 1. Tenta buscar pelo container padrão do Google Maps (.F7nice)
                 const f7nice = document.querySelector('.F7nice');
                 if (f7nice) {
                   const text = (f7nice as HTMLElement).innerText || "";
                   // Exemplo: "4,7(1.234)" ou "4.7 (12)"
                   const match = text.match(/([\d,\.]+)\s*\(([\d\.\,]+)\)/);
                   if (match) {
                     rating = parseFloat(match[1].replace(',', '.'));
                     ratingCount = parseInt(match[2].replace(/[\.,]/g, ''));
                   } else {
                     // Se não bateu o regex direto, busca o texto de spans/buttons filhos
                     const ratingSpan = f7nice.querySelector('span[aria-hidden="true"]');
                     if (ratingSpan) {
                       const rVal = (ratingSpan as HTMLElement).innerText.trim().replace(',', '.');
                       rating = parseFloat(rVal) || 0;
                     }
                     const countBtn = f7nice.querySelector('button, span[aria-label]');
                     if (countBtn) {
                       const aria = countBtn.getAttribute('aria-label') || "";
                       const countMatch = aria.match(/([\d\.\,]+)\s*(?:avalia|coment|review)/i);
                       if (countMatch) {
                         ratingCount = parseInt(countMatch[1].replace(/[\.,]/g, ''));
                       } else {
                         const textMatch = (countBtn as HTMLElement).innerText.match(/([\d\.\,]+)/);
                         if (textMatch) ratingCount = parseInt(textMatch[1].replace(/[\.,]/g, ''));
                       }
                     }
                   }
                 }

                 // 2. Fallback 1: Buscar por elementos com aria-label de estrelas/stars (sem restrição de tag div/span)
                 if (rating === 0 || ratingCount === 0) {
                   const ratingEl = document.querySelector('[aria-label*="estrelas"], [aria-label*="stars"]');
                   if (ratingEl) {
                     const aria = ratingEl.getAttribute('aria-label') || "";
                     const ratingMatch = aria.match(/([\d,\.]+)\s*(?:estrelas|stars)/);
                     if (ratingMatch && rating === 0) {
                       rating = parseFloat(ratingMatch[1].replace(',', '.'));
                     }
                     
                     // Busca elemento de review próximo no mesmo pai
                     const parent = ratingEl.parentElement;
                     if (parent) {
                       const text = parent.innerText || "";
                       const countMatch = text.match(/([\d\.\,]+)\s*(?:avalia|coment|review)/i) || text.match(/\(([\d\.\,]+)\)/);
                       if (countMatch && ratingCount === 0) {
                         ratingCount = parseInt(countMatch[1].replace(/[\.,]/g, ''));
                       }
                     }
                   }
                 }

                 // 3. Fallback 2: Varredura ampla de botões e spans para o número de avaliações
                 if (ratingCount === 0) {
                   const elements = Array.from(document.querySelectorAll('button, span, a'));
                   for (const el of elements) {
                     const text = (el as HTMLElement).innerText?.trim() || "";
                     const m = text.match(/^([\d\.\,]+)\s+(?:avalia|coment|review)/i) || text.match(/^\(([\d\.\,]+)\)$/);
                     if (m) {
                       const val = m[1].replace(/[\.,]/g, '').trim();
                       if (val && (text.includes('avalia') || text.includes('review') || text.includes('coment') || text.startsWith('('))) {
                         ratingCount = parseInt(val) || 0;
                         if (ratingCount > 0) break;
                       }
                     }
                   }
                 }

                 // 4. Fallback 3: Varredura de rating decimal (como 4,7 ou 5,0)
                 if (rating === 0) {
                   const spans = Array.from(document.querySelectorAll('span'));
                   for (const s of spans) {
                     const text = (s as HTMLElement).innerText.trim();
                     if (/^[3-5][,\.][0-9]$/.test(text)) {
                       rating = parseFloat(text.replace(',', '.'));
                       break;
                     }
                   }
                 }

                 return { phoneNumber, website, rating, ratingCount };
              });

              place.phoneNumber = deepData.phoneNumber;
              place.website = deepData.website;
              place.rating = deepData.rating;
              place.ratingCount = deepData.ratingCount;
              
              if (place.phoneNumber) {
                logGmaps(`📞 Telefone obtido: ${place.phoneNumber}`);
              }
              
              if ((idx + 1) % 5 === 0 && idx < rawPlaces.length - 1) {
                const restTime = 10000 + Math.random() * 5000;
                logGmaps(`😴 Pausa de descanso (${(restTime / 1000).toFixed(0)}s)...`);
                await page.waitForTimeout(restTime);
              }
           } catch (err) {
              logGmaps(`⚠️ Erro ao extrair dados de ${place.title}`);
           }
        }

      } catch (e: any) {
        logGmaps(`🔥 Erro de navegação/DOM: ${e.message}`);
      } finally {
        if (removeHttpLogger) removeHttpLogger();
        await browser.close();
      }

      logGmaps(`Enriquecendo dados e calculando Opportunity Scores...`);
      const processLeadPromises = rawPlaces.map(async (place: any) => {
        const rawName = place.title || "";
        let companyName = rawName.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '').split(/ - | \| | \/ /)[0].trim();
                                 
        let phoneE164: string | null = null, phoneType = "UNKNOWN", hasWhatsapp = false;
        const rawPhone = place.phoneNumber || "";
        if (rawPhone) {
          try {
            const number = phoneUtil.parseAndKeepRawInput(rawPhone, "BR");
            if (phoneUtil.isValidNumber(number)) {
              phoneE164 = phoneUtil.format(number, PhoneNumberFormat.E164);
              const type = phoneUtil.getNumberType(number);
              if (type === 1 || type === 2) { phoneType = "MOBILE"; hasWhatsapp = true; }
              else if (type === 0) { phoneType = "FIXED_LINE"; }
            }
          } catch (e) {}
        }

        const websiteUrl = place.website || null;
        const websiteStatus = await pingWebsite(websiteUrl);

        let score = 100;
        if (websiteStatus === "Inativo/Quebrado") score -= 30;
        if (!websiteUrl) score -= 20;
        if (place.rating < 4.0 && place.ratingCount > 0) score -= 15;
        if (phoneType === "FIXED_LINE") score -= 10;

        let pitch = "Abordagem padrão de vendas.";
        if (websiteStatus === "Inativo/Quebrado") pitch = "Venda de Desenvolvimento Web / Site Fora do Ar.";
        else if (phoneType === "MOBILE") pitch = "Abordagem comercial pelo WhatsApp.";

        return {
          gmb_id: place.id, company_name: companyName, raw_name: rawName,
          presence: { google_rating: place.rating, reviews_count: place.ratingCount, is_claimed: true },
          contact: { phone_raw: rawPhone, phone_e164: phoneE164, phone_type: phoneType, has_whatsapp: hasWhatsapp },
          digital_asset: { website_url: websiteUrl, website_status: websiteStatus },
          fiscal_data: { cnpj: null, status_receita: null, cnae: null },
          marketing_intelligence: { opportunity_score: Math.max(0, score), primary_pitch: pitch }
        };
      });

      const results = await Promise.allSettled(processLeadPromises);
      const finalLeads: any[] = [];
      results.forEach(res => { if (res.status === "fulfilled" && res.value) finalLeads.push(res.value); });

      logGmaps(`💾 Gravando ${finalLeads.length} leads no SQLite local...`);
      
      try {
        const searchStmt = db.prepare(`
          INSERT INTO gmaps_buscas (keyword, location, total_leads)
          VALUES (?, ?, ?)
        `);
        const searchRes = searchStmt.run(keyword, location, finalLeads.length);
        const buscaId = searchRes.lastInsertRowid;

        const leadStmt = db.prepare(`
          INSERT INTO gmaps_leads (
            gmb_id, company_name, google_rating, reviews_count, is_claimed,
            phone_raw, phone_e164, phone_type, has_whatsapp,
            website_url, website_status, opportunity_score, primary_pitch, busca_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(gmb_id) DO UPDATE SET
            company_name=excluded.company_name,
            google_rating=excluded.google_rating,
            reviews_count=excluded.reviews_count,
            is_claimed=excluded.is_claimed,
            phone_raw=excluded.phone_raw,
            phone_e164=excluded.phone_e164,
            phone_type=excluded.phone_type,
            has_whatsapp=excluded.has_whatsapp,
            website_url=excluded.website_url,
            website_status=excluded.website_status,
            opportunity_score=excluded.opportunity_score,
            primary_pitch=excluded.primary_pitch,
            busca_id=excluded.busca_id
        `);

        const insertMany = db.transaction((leads) => {
          for (const lead of leads) {
            leadStmt.run(
              lead.gmb_id,
              lead.company_name,
              lead.presence.google_rating,
              lead.presence.reviews_count,
              lead.presence.is_claimed ? 1 : 0,
              lead.contact.phone_raw,
              lead.contact.phone_e164,
              lead.contact.phone_type,
              lead.contact.has_whatsapp ? 1 : 0,
              lead.digital_asset.website_url,
              lead.digital_asset.website_status,
              lead.marketing_intelligence.opportunity_score,
              lead.marketing_intelligence.primary_pitch,
              buscaId
            );
          }
        });
        insertMany(finalLeads);
        logGmaps(`💾 Sucesso! Todos os contatos foram salvos.`);
      } catch (dbErr: any) {
        logGmaps(`❌ Erro ao salvar no banco local: ${dbErr.message}`);
      }

      gmapsScraperRunning = false;
      logGmaps(`🏁 Processo concluído! Total extraído: ${finalLeads.length} leads.`);
    } catch (err: any) {
      logGmaps(`🔥 Erro crítico em background: ${err.message}`);
      gmapsScraperRunning = false;
    }
  })();
});

router.post("/leads/:id/msg_enviada", async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: "ID é obrigatório" });

  try {
    const stmt = db.prepare("UPDATE gmaps_leads SET msg_enviada = 1 WHERE id = ?");
    const info = stmt.run(id);
    if (info.changes === 0) {
      return res.status(404).json({ error: "Lead não encontrado." });
    }
    res.json({ message: "Status atualizado com sucesso." });
  } catch (err: any) {
    console.error("Erro ao atualizar msg_enviada (gmaps):", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
});

export default router;
