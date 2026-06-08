import express from "express";
import { chromium } from "playwright-extra";
import { Browser, BrowserContext, Page } from "playwright";
import stealth from "puppeteer-extra-plugin-stealth";
import db from "./database.js";
import dotenv from "dotenv";
import {
  getRandomUserAgent,
  getRandomViewport,
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

const router = express.Router();


// ── Status State ─────────────────────────────────────────────────────────────
let igScraperRunning = false;
let igScraperStopRequested = false;
let igScraperLog: string[] = [];

function logIg(msg: string) {
  const ts = new Date().toLocaleTimeString("pt-BR");
  const line = `[${ts}] 📸 ${msg}`;
  console.log(line);
  igScraperLog.push(line);
  if (igScraperLog.length > 100) igScraperLog.shift();
}

// ── Endpoints de UI (Status e Sessões) ────────────────────────────────────────

router.get("/status", (req, res) => {
  res.json({ running: igScraperRunning, log: igScraperLog });
});

router.post("/stop", (req, res) => {
  if (igScraperRunning || igDmRunning) {
    igScraperStopRequested = true;
    logIg("🛑 Usuário solicitou parada. Finalizando extração...");
    res.json({ message: "Parando processo atual..." });
  } else {
    res.json({ message: "Nenhum processo rodando no momento." });
  }
});

router.get("/session", async (req, res) => {
  try {
    const data = db.prepare("SELECT * FROM ig_sessoes WHERE is_active = 1 ORDER BY atualizado_em DESC LIMIT 1").get();
    res.json({ hasSession: !!data, session: data });
  } catch {
    res.json({ hasSession: false });
  }
});


router.post("/session", async (req, res) => {
  const { username, session_cookie } = req.body;
  if (!username || !session_cookie) return res.status(400).json({ error: "Username e session_cookie são obrigatórios." });

  try {
    db.prepare("UPDATE ig_sessoes SET is_active = 0 WHERE username != '___'").run();
    db.prepare("INSERT INTO ig_sessoes (username, session_cookie, is_active) VALUES (?, ?, 1)").run(username, session_cookie);
    res.json({ message: "Sessão salva com sucesso!" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/interactive-login", async (req, res) => {
  const username = req.body.username || "MinhaConta";

  logIg(`Abrindo navegador para login interativo da conta @${username}...`);
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: false,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--start-maximized",
        "--no-sandbox",
      ],
      ...getProxyLaunchArgs(),
    });
    const contextOptions = getStealthContextOptions();
    const context = await browser.newContext(contextOptions);
    await context.addInitScript(getStealthInitScript());
    const page = await context.newPage();
    
    await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "domcontentloaded", timeout: 60000 });
    
    // Polling a cada 2 segundos para ver se o usuário fez login (cookie sessionid aparece)
    let sessionCookieStr = "";
    let allCookiesJson = "";
    for (let i = 0; i < 90; i++) { // Espera até 3 minutos
      const cookies = await context.cookies();
      const sessionid = cookies.find(c => c.name === "sessionid");
      if (sessionid && sessionid.value) {
        sessionCookieStr = sessionid.value;
        // Captura TODOS os cookies (csrftoken, ig_did, mid, rur, etc.)
        allCookiesJson = JSON.stringify(cookies.filter(c => c.domain.includes("instagram.com")));
        logIg(`🍪 ${cookies.filter(c => c.domain.includes("instagram.com")).length} cookies capturados (incluindo auxiliares).`);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    await browser.close();

    if (!sessionCookieStr) {
      return res.status(408).json({ error: "Tempo esgotado. Login não foi detectado." });
    }

    logIg(`Sessão capturada com sucesso! Salvando no banco...`);

    db.prepare("UPDATE ig_sessoes SET is_active = 0 WHERE username != '___'").run();
    // Salva session_cookie E todos os cookies auxiliares
    try {
      db.exec(`ALTER TABLE ig_sessoes ADD COLUMN all_cookies TEXT DEFAULT ''`);
    } catch (e) { /* coluna já existe */ }
    db.prepare("INSERT INTO ig_sessoes (username, session_cookie, all_cookies, is_active) VALUES (?, ?, ?, 1)").run(username, sessionCookieStr, allCookiesJson);
    res.json({ message: "Login realizado e sessão capturada com sucesso! Todos os cookies foram salvos." });

  } catch (err: any) {
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ error: `Erro no navegador: ${err.message}` });
  }
});

router.post("/logout", async (req, res) => {
  try {
    db.prepare("UPDATE ig_sessoes SET is_active = 0 WHERE username != '___'").run();
    res.json({ message: "Logout realizado com sucesso." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


router.delete("/buscas/:pai", async (req, res) => {
  const { pai } = req.params;
  try {
    db.prepare("DELETE FROM ig_perfis WHERE username = ?").run(pai);
    db.prepare("DELETE FROM ig_perfis WHERE perfil_pai = ?").run(pai);
    res.json({ message: "Busca excluída com sucesso." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


router.post("/marcar-dm", async (req, res) => {
  const { usernames } = req.body;
  if (!Array.isArray(usernames) || usernames.length === 0) return res.status(400).json({ error: "No usernames provided." });
  try {
    const stmt = db.prepare("UPDATE ig_perfis SET dm_enviado = 1 WHERE username = ?");
    const updateMany = db.transaction((names) => {
      for (const name of names) stmt.run(name);
    });
    updateMany(usernames);
    res.json({ message: "DMs marcadas como enviadas." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


router.get("/perfis", async (req, res) => {
  try {
    const parents = db.prepare("SELECT * FROM ig_perfis WHERE perfil_pai IS NULL").all();
    const followers = db.prepare("SELECT * FROM ig_perfis WHERE perfil_pai IS NOT NULL ORDER BY criado_em DESC").all();
    res.json([...(parents || []), ...(followers || [])]);
  } catch (e) {
    console.error("Erro ao buscar perfis:", e);
    res.json([]);
  }
});

// ── Motor de Scraping (Stealth Avançado) ──────────────────────────────────────
async function launchIgBrowser(sessionCookie: string) {
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--start-maximized",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
    ...getProxyLaunchArgs(),
  });

  // Contexto com fingerprint completo e realista
  const contextOptions = getStealthContextOptions({ colorScheme: "dark" });
  const context = await browser.newContext(contextOptions);

  // Inject stealth completo (canvas noise, WebGL, plugins, etc.)
  await context.addInitScript(getStealthInitScript());

  // Tentar carregar TODOS os cookies salvos (auxiliares inclusos)
  let allCookiesLoaded = false;
  try {
    const sessionRow = db.prepare("SELECT all_cookies FROM ig_sessoes WHERE is_active = 1 LIMIT 1").get() as any;
    if (sessionRow?.all_cookies) {
      const parsedCookies = JSON.parse(sessionRow.all_cookies);
      if (Array.isArray(parsedCookies) && parsedCookies.length > 0) {
        // Filtrar cookies válidos e atualizar o sameSite para formato Playwright
        const validCookies = parsedCookies.map((c: any) => ({
          name: c.name,
          value: c.value,
          domain: c.domain || ".instagram.com",
          path: c.path || "/",
          secure: c.secure !== false,
          httpOnly: c.httpOnly || false,
          sameSite: (c.sameSite === "Strict" || c.sameSite === "Lax" || c.sameSite === "None") ? c.sameSite : "Lax",
        })).filter((c: any) => c.name && c.value);
        await context.addCookies(validCookies);
        allCookiesLoaded = true;
        logIg(`🍪 ${validCookies.length} cookies carregados (sessão completa com auxiliares).`);
      }
    }
  } catch (e) {
    // Falha ao carregar cookies auxiliares, usar só o sessionid
  }

  // Fallback: se não carregou cookies auxiliares, usar apenas sessionid
  if (!allCookiesLoaded) {
    await context.addCookies([{
      name: "sessionid",
      value: sessionCookie,
      domain: ".instagram.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax" as const
    }]);
    logIg(`🍪 Apenas sessionid carregado (sem cookies auxiliares).`);
  }

  return { browser, context };
}

// ── Helper: Scrape um perfil individual ───────────────────────────────────────
async function scrapeProfileData(page: Page, targetUsername: string): Promise<any | null> {
  let profileDataFound: any = null;

  const responseHandler = async (response: any) => {
    const url = response.url();
    if (url.includes("/api/v1/users/web_profile_info/") || url.includes("graphql/query")) {
      try {
        const json = await response.json();
        const user = json?.data?.user || json?.graphql?.user;
        if (user && user.username === targetUsername) {
          profileDataFound = user;
        }
      } catch {}
    }
  };

  page.on("response", responseHandler);

  const waitTime = Math.floor(Math.random() * 10000) + 5000; // 5-15s (anti-detecção)
  logIg(`Navegando para @${targetUsername} (${(waitTime / 1000).toFixed(1)}s)...`);

  await page.goto(`https://www.instagram.com/${targetUsername}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
  
  // Simular comportamento humano: mouse move e scroll antes de esperar
  await humanMouseMove(page, 400 + Math.random() * 600, 200 + Math.random() * 300);
  await microPause();
  await humanScroll(page);
  
  await page.waitForTimeout(waitTime);
  
  // Verificar bloqueio após navegação
  let blockCheck = await detectBlock(page);
  if (blockCheck.isBlocked) {
    logIg(`🚨 BLOQUEIO DETECTADO: ${blockCheck.reason}`);
    logIg(`Aguardando resolução manual do usuário (até 3 minutos)...`);
    
    await page.bringToFront().catch(() => {});
    await page.evaluate(() => {
      setTimeout(() => alert("🚨 AÇÃO NECESSÁRIA: O robô encontrou um bloqueio ou CAPTCHA!\n\nPor favor, resolva para que o robô continue.\n\n⚠️ IMPORTANTE: Se o teste de imagens NÃO aparecer e a página mostrar apenas texto, significa que sua rede foi temporariamente bloqueada (Hard Block). Nesse caso, feche e conecte-se a outra rede (ex: Wi-Fi do celular) ou reinicie o modem, depois volte e dê F5 na página!"), 500);
    }).catch(() => {});
    
    // O alerta já foi exibido na primeira abertura do navegador para não flodar a tela.
    
    let attempts = 0;
    while (blockCheck.isBlocked && attempts < 36) {
      if (igScraperStopRequested) break;
      await new Promise(resolve => setTimeout(resolve, 5000));
      blockCheck = await detectBlock(page);
      attempts++;
    }
    
    if (blockCheck.isBlocked) {
      logIg(`❌ Tempo esgotado para resolução do bloqueio. Abortando.`);
      return null;
    } else if (!igScraperStopRequested) {
      logIg(`✅ Bloqueio resolvido! Retomando coleta...`);
    }
  }

  // Fallback: _sharedData
  if (!profileDataFound) {
    try {
      const sharedData = await page.evaluate(() => (window as any)._sharedData || null);
      if (sharedData?.entry_data?.ProfilePage?.[0]?.graphql?.user) {
        profileDataFound = sharedData.entry_data.ProfilePage[0].graphql.user;
      }
    } catch {}
  }

  // Fallback: DOM scraping
  if (!profileDataFound) {
    logIg(`Lendo metadados visuais de @${targetUsername}...`);
    const meta = await page.evaluate(() => {
      const title = document.querySelector("title")?.innerText || "";
      const desc = document.querySelector("meta[property='og:description']")?.getAttribute("content") || "";
      
      // Look for external links anywhere on the page, not just header
      const links = Array.from(document.querySelectorAll("a"));
      const extL = links.map((a: any) => a.href).find((l: string) => 
        l && 
        !l.includes("instagram.com") && 
        !l.includes("threads.net") && 
        !l.includes("threads.com") && 
        !l.includes("facebook.com") && 
        l.startsWith("http")
      );
      
      const headerText = document.querySelector("header")?.innerText || document.body.innerText || "";
      return { title, desc, externalLink: extL || null, headerText };
    });

    if (meta.desc) {
      const segMatch = meta.desc.match(/([\d.,Mkm]+)\s*(seguidores|Followers)/i);
      const seguindoMatch = meta.desc.match(/([\d.,Mkm]+)\s*(seguindo|Following)/i);
      const postsMatch = meta.desc.match(/([\d.,Mkm]+)\s*(posts|Posts)/i);

      const parseNumber = (str: string | undefined) => {
        if (!str) return 0;
        let clean = str.replace(/,/g, "").replace(/\./g, "");
        if (clean.toLowerCase().includes("m")) return parseFloat(clean) * 1000000;
        if (clean.toLowerCase().includes("k")) return parseFloat(clean) * 1000;
        return parseInt(clean) || 0;
      };

      const nomeMatch = meta.title.match(/(.+) \(@/);
      const fullName = nomeMatch ? nomeMatch[1] : targetUsername;

      let bioStr = "";
      let foundUrl = meta.externalLink;

      if (meta.headerText) {
        if (!foundUrl) {
          // Regex muito mais abrangente para pegar qualquer link (.app, .site, .link, etc)
          const urlMatch = meta.headerText.match(/(https?:\/\/[^\s]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,10}(?:\/[^\s]*)?)/i);
          if (urlMatch) foundUrl = urlMatch[0];
        }
        const lines = meta.headerText.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
        const filteredLines = lines.filter((l: string) =>
          l !== targetUsername &&
          l !== fullName &&
          !l.includes("posts") && !l.includes("seguidores") && !l.includes("seguindo") &&
          l !== "Mensagens" && l !== "Seguir" && l !== "Editar perfil" && l !== "Ver Itens Arquivados" &&
          !(foundUrl && l.includes(foundUrl))
        );
        bioStr = filteredLines.join('\n');
      }

      if (foundUrl && foundUrl.includes("l.instagram.com/?u=")) {
        try {
          const uParam = new URL(foundUrl).searchParams.get("u");
          if (uParam) foundUrl = uParam;
        } catch {}
      }

      profileDataFound = {
        username: targetUsername,
        full_name: fullName,
        biography: bioStr,
        edge_followed_by: { count: parseNumber(segMatch?.[1]) },
        edge_follow: { count: parseNumber(seguindoMatch?.[1]) },
        edge_owner_to_timeline_media: { count: parseNumber(postsMatch?.[1]) },
        external_url: foundUrl,
        is_business_account: false
      };
      logIg(`Fallback DOM ok para @${targetUsername}.`);
    }
  }

  page.off("response", responseHandler);

  if (!profileDataFound) return null;

  const bio = profileDataFound.biography || "";
  const emailMatch = bio.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi);
  const email = profileDataFound.business_email || (emailMatch ? emailMatch[0] : null);
  const phoneMatch = bio.match(/(\+55|55)?\s?\(?\d{2}\)?\s?\d{4,5}[-\s]?\d{4}/gi);
  
  let telefone = phoneMatch ? phoneMatch[0] : null;
  if (!telefone && profileDataFound.business_phone_number) {
    telefone = profileDataFound.business_phone_number;
  } else if (!telefone && profileDataFound.public_phone_number) {
    telefone = profileDataFound.public_phone_country_code ? `${profileDataFound.public_phone_country_code}${profileDataFound.public_phone_number}` : profileDataFound.public_phone_number;
  }

  return {
    username: profileDataFound.username,
    nome_completo: profileDataFound.full_name,
    bio,
    seguidores: profileDataFound.edge_followed_by?.count || 0,
    posts: profileDataFound.edge_owner_to_timeline_media?.count || 0,
    email_extraido: email,
    telefone_extraido: telefone,
    link_bio: profileDataFound.external_url,
    is_business: profileDataFound.is_business_account,
    is_private: profileDataFound.is_private || false
  };
}

// ── Helper: Extrair lista de seguidores via chamada DIRETA à API interna ───────
async function getFollowerUsernames(page: Page, targetUsername: string): Promise<any[]> {
  logIg(`📋 Buscando seguidores REAIS de @${targetUsername} via API direta (Modo Ultra Rápido)...`);

  // Garante que o browser está na página do Instagram (cookies ativos)
  const currentUrl = page.url();
  if (!currentUrl.includes("instagram.com")) {
    await page.goto(`https://www.instagram.com/${targetUsername}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);
  }

  // PASSO 1: Obtém o user_id numérico via web_profile_info
  logIg(`🔍 Obtendo user_id de @${targetUsername}...`);
  const userId: string | null = await page.evaluate(async (username: string) => {
    try {
      const res = await fetch(
        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`,
        {
          headers: {
            "X-IG-App-ID": "936619743392459",
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "*/*",
          },
          credentials: "include",
        }
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data?.data?.user?.id || null;
    } catch {
      return null;
    }
  }, targetUsername);

  if (!userId) {
    logIg(`❌ Não conseguiu obter user_id de @${targetUsername}. Perfil privado ou bloqueio.`);
    return [];
  }

  logIg(`🔑 User ID de @${targetUsername}: ${userId}. Paginando seguidores...`);

  // PASSO 2: Pagina pela API /friendships/{user_id}/followers/ até pegar todos
  const followers: any[] = [];
  let nextMaxId = "";
  let pageNum = 1;
  let consecutive_errors = 0;

  while (true) {
    if (igScraperStopRequested) {
      logIg("🛑 Busca de seguidores interrompida pelo usuário.");
      break;
    }
    const url = `https://www.instagram.com/api/v1/friendships/${userId}/followers/?count=50${nextMaxId ? `&max_id=${encodeURIComponent(nextMaxId)}` : ""}`;

    const result: { users: any[]; next_max_id?: string } | null = await page.evaluate(async (apiUrl: string) => {
      try {
        const res = await fetch(apiUrl, {
          headers: {
            "X-IG-App-ID": "936619743392459",
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "*/*",
          },
          credentials: "include",
        });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    }, url);

    if (!result || !Array.isArray(result.users)) {
      consecutive_errors++;
      logIg(`⚠️ Página ${pageNum}: resposta inválida. Tentativa ${consecutive_errors}/3.`);
      if (consecutive_errors >= 3) break;
      await page.waitForTimeout(3000);
      continue;
    }

    consecutive_errors = 0;

    if (result.users.length === 0) {
      logIg(`✅ Página ${pageNum}: sem mais seguidores. Fim da lista.`);
      break;
    }

    result.users.forEach((u: any) => {
      if (u.username && !followers.find(f => f.username === u.username)) {
        followers.push({
          username: u.username,
          nome_completo: u.full_name || u.username,
          bio: "",
          seguidores: 0,
          seguindo: 0,
          posts: 0,
          telefone_extraido: null,
          link_bio: null,
          email_extraido: null,
          is_business: u.is_business || false,
          perfil_pai: targetUsername,
        });
      }
    });

    logIg(`📥 Página ${pageNum}: +${result.users.length} seguidores (total: ${followers.length})`);

    if (result.next_max_id) {
      nextMaxId = result.next_max_id;
      pageNum++;
      // Delay humanizado entre páginas de seguidores (2-5s)
      await humanDelay(2000, 5000);
      // Pausa de descanso a cada 5 páginas (15-30s)
      if (pageNum % 5 === 0) {
        const pausaDescanso = 15000 + Math.random() * 15000;
        logIg(`😴 Pausa de descanso (${(pausaDescanso / 1000).toFixed(0)}s) para evitar rate limit...`);
        await page.waitForTimeout(pausaDescanso);
      }
    } else {
      logIg(`✅ Todos os ${followers.length} seguidores carregados!`);
      break;
    }
  }

  logIg(`✅ Total final: ${followers.length} seguidores extraídos de @${targetUsername}.`);
  return followers;
}

// ── Rota de Profile Scraper (com Seguidores) ────────────────────────────────────
router.post("/scrape-profile", async (req, res) => {
  if (igScraperRunning) return res.status(400).json({ message: "Outra extração do IG já está rodando." });

  const { targetUsername } = req.body;
  if (!targetUsername) return res.status(400).json({ error: "targetUsername é obrigatório." });

  const sessionData = db.prepare("SELECT session_cookie FROM ig_sessoes WHERE is_active = 1 LIMIT 1").get() as any;

  if (!sessionData || !sessionData.session_cookie) {
    return res.status(401).json({ error: "Nenhuma sessão ativa encontrada. Configure o Login primeiro." });
  }

  igScraperRunning = true;
  igScraperStopRequested = false;
  igScraperLog = [];
  res.json({ message: `Iniciando extração de @${targetUsername} + seguidores...`, running: true });

  let browser: Browser | null = null;

  try {
    logIg(`Iniciando motor Chromium Stealth (Anti-Detecção v2.0)...`);
    const { browser: b, context } = await launchIgBrowser(sessionData.session_cookie);
    browser = b;
    const page = await context.newPage();
    
    // Setup HTTP response logger
    const removeHttpLogger = setupHttpLogger(page, logIg);

    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate(() => {
      alert("Aviso do Robô: A navegação começou. Se aparecer um CAPTCHA ou desafio para confirmar que você é humano, clique em 'OK' aqui, resolva o desafio e aguarde. O robô continuará sozinho assim que detectar que foi resolvido.");
    }).catch(() => {});

    // ── FASE 1: Perfil Principal ───────────────────────────────────────────────────
    logIg(`══════ FASE 1: Perfil @${targetUsername} ══════`);
    const mainProfile = await scrapeProfileData(page, targetUsername);

    if (mainProfile) {
      logIg(`✅ Perfil capturado! Seguidores: ${mainProfile.seguidores} | Email: ${mainProfile.email_extraido || 'Não'}`);
      let error: any = null;
      try {
        db.prepare(`INSERT INTO ig_perfis (username, nome_completo, bio, seguidores, seguindo, posts, telefone_extraido, link_bio, email_extraido, is_business, is_private, perfil_pai) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET nome_completo=excluded.nome_completo, seguidores=excluded.seguidores, telefone_extraido=excluded.telefone_extraido, email_extraido=excluded.email_extraido`)
        .run(mainProfile.username, mainProfile.nome_completo, mainProfile.bio, mainProfile.seguidores, 0, mainProfile.posts, mainProfile.telefone_extraido, mainProfile.link_bio, mainProfile.email_extraido, mainProfile.is_business ? 1 : 0, mainProfile.is_private ? 1 : 0, null);
      } catch(e) { error = e; }
      if (error) logIg(`⚠️ Erro ao salvar perfil principal: ${error.message}`);
      else logIg(`💾 Perfil principal salvo no SQLite.`);

      try { db.prepare("INSERT INTO ig_buscas (tipo_busca, alvo, total_capturado) VALUES (?, ?, ?)").run('PROFILE', `@${targetUsername}`, 1); } catch(e){}
    } else {
      logIg(`❌ Não foi possível extrair dados de @${targetUsername}. Conta pode ser privada.`);
    }

    // ── PAUSA ENTRE FASES (Anti-Detecção) ─────────────────────────────────────
    const pausaEntreFases = 30000 + Math.random() * 30000; // 30-60s
    logIg(`😴 Pausa entre fases (${(pausaEntreFases / 1000).toFixed(0)}s) para simular comportamento humano...`);
    await page.waitForTimeout(pausaEntreFases);
    
    // ── FASE 2: Lista de Seguidores ─────────────────────────────────────────────
    logIg(`══════ FASE 2: Seguidores de @${targetUsername} ══════`);
    const followerProfiles = await getFollowerUsernames(page, targetUsername);

    if (followerProfiles.length === 0) {
      logIg(`Nenhum seguidor encontrado (perfil privado ou bloqueio).`);
    } else {
      logIg(`Salvando ${followerProfiles.length} seguidores no banco (Modo Rápido)...`);
      //O SQLite permite realizar operações de upsert  em lotes utilizando transações
      const chunkSize = 500;
      for (let i = 0; i < followerProfiles.length; i += chunkSize) {
        const chunk = followerProfiles.slice(i, i + chunkSize);
        let error: any = null;
        try {
          const stmt = db.prepare(`INSERT INTO ig_perfis (username, nome_completo, bio, seguidores, seguindo, posts, telefone_extraido, link_bio, email_extraido, is_business, is_private, perfil_pai) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(username) DO UPDATE SET nome_completo=excluded.nome_completo`);
          const insertMany = db.transaction((items) => {
            for (const item of items) {
              stmt.run(item.username, item.nome_completo, item.bio, item.seguidores, item.seguindo, item.posts, item.telefone_extraido, item.link_bio, item.email_extraido, item.is_business ? 1 : 0, item.is_private ? 1 : 0, item.perfil_pai);
            }
          });
          insertMany(chunk);
        } catch(e) { error = e; }
        if (error) {
          logIg(`⚠️ Erro ao salvar chunk de seguidores no banco: ${error.message}`);
        }
      }
      logIg(`💾 Todos os seguidores foram salvos com sucesso!`);
    }

    logIg(`══════════════════════════════════════════`);
    logIg(`✅ Extração completa! 1 perfil principal + ${followerProfiles.length} seguidores.`);

    try { db.prepare("INSERT INTO ig_buscas (tipo_busca, alvo, total_capturado) VALUES (?, ?, ?)").run('FOLLOWERS_SCRAPE_FAST', `@${targetUsername}`, followerProfiles.length); } catch(e){}

    removeHttpLogger();
    igScraperRunning = false;
    await browser.close();

  } catch (error: any) {
    logIg(`🔥 Erro crítico na extração: ${error.message}`);
    if (browser) await browser.close();
    igScraperRunning = false;
  }
});
// ── Rota de Disparo em Massa de DMs ─────────────────────────────────────────────
let igDmRunning = false;

router.post("/send-bulk-dms", async (req, res) => {
  if (igScraperRunning || igDmRunning) {
    return res.status(400).json({ message: "Outra automação (Scraper ou DM) já está rodando." });
  }

  const { targets, template } = req.body;
  if (!targets || !Array.isArray(targets) || targets.length === 0) {
    return res.status(400).json({ error: "Nenhum alvo (targets) informado." });
  }
  if (!template) {
    return res.status(400).json({ error: "Mensagem (template) não pode estar vazia." });
  }

  const sessionData = db.prepare("SELECT session_cookie FROM ig_sessoes WHERE is_active = 1 LIMIT 1").get() as any;

  if (!sessionData || !sessionData.session_cookie) {
    return res.status(401).json({ error: "Nenhuma sessão ativa encontrada. Configure o Login primeiro." });
  }

  igDmRunning = true;
  igScraperRunning = true; // Use the same UI loading state
  igScraperStopRequested = false;
  igScraperLog = [];
  res.json({ message: `Iniciando disparo para ${targets.length} perfis...`, running: true });

  let browser: Browser | null = null;

  try {
    logIg(`Iniciando motor Chromium Stealth para DMs...`);
    const { browser: b, context } = await launchIgBrowser(sessionData.session_cookie);
    browser = b;
    const page = await context.newPage();

    let successCount = 0;

    for (let i = 0; i < targets.length; i++) {
      if (igScraperStopRequested) {
        logIg("🛑 Disparo de DMs interrompido pelo usuário.");
        break;
      }
      const username = targets[i];
      logIg(`══════ DM [${i + 1}/${targets.length}]: @${username} ══════`);

      // 1. Fetch user real name from DB to personalize
      const userData = db.prepare("SELECT nome_completo FROM ig_perfis WHERE username = ? LIMIT 1").get(username) as any;
      
      const nomeCompleto = userData?.nome_completo && userData.nome_completo.trim() !== "" 
        ? userData.nome_completo.split(" ")[0] // Primeiro nome apenas
        : username;

      // Replace variables
      let message = template.replace(/{nome}/g, nomeCompleto).replace(/{username}/g, `@${username}`);

      // --- ANTI-FINGERPRINTING: VARIAÇÃO DE TEXTO ---
      // 1. Adiciona espaços extras aleatórios no final (0 a 2 espaços)
      const extraSpaces = " ".repeat(Math.floor(Math.random() * 3));
      // 2. Chance de 30% de adicionar um ponto final extra no fim
      const endChar = Math.random() > 0.7 ? "." : "";
      // 3. Chance de 50% de inserir um caractere invisível (Zero-width space) no meio do texto para burlar detecção de hash exato
      if (Math.random() > 0.5 && message.length > 5) {
        const insertPos = Math.floor(message.length / 2);
        message = message.slice(0, insertPos) + '\u200B' + message.slice(insertPos);
      }
      message = message + extraSpaces + endChar;
      // ----------------------------------------------

      // 2. Navigate to New Message directly
      logIg(`Abrindo a tela de Nova Mensagem...`);
      await page.goto(`https://www.instagram.com/direct/new/`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3000 + Math.random() * 2000);

      // Dismiss "Turn on Notifications" or similar popups if they appear
      try {
        logIg(`Aguardando possíveis popups...`);
        // Aguarda até 5 segundos para o popup aparecer (às vezes ele demora a renderizar)
        const agoraNaoBtn = await page.waitForSelector(`xpath=//button[contains(., 'Agora não') or contains(., 'Not Now') or contains(., 'agora não')] | //div[@role="button" and (contains(., 'Agora não') or contains(., 'Not Now'))]`, { timeout: 5000 });
        
        if (agoraNaoBtn) {
          logIg(`Fechando popup chato do Instagram...`);
          await agoraNaoBtn.click();
          await page.waitForTimeout(1000);
        }
      } catch (e) {
        // Se der timeout, significa que o popup não apareceu, então segue o jogo normalmente
      }

      // 3. Search for the user
      logIg(`Buscando @${username} na lista de contatos...`);
      try {
        // Usa um seletor múltiplo (separado por vírgula) para encontrar o campo de busca de forma segura
        const searchInput = await page.waitForSelector('input[name="queryBox"], input[placeholder*="esquisa"], input[placeholder*="earch"], input[type="text"]', { timeout: 15000 });
                         
        if (searchInput) {
          await searchInput.type(username, { delay: 50 });
          await page.waitForTimeout(3000 + Math.random() * 1000); // Wait for results to load
        } else {
          throw new Error("Campo de busca não encontrado.");
        }
        
        // 4. Click the search result (the user's checkbox or row)
        logIg(`Selecionando @${username}...`);
        // O Instagram mostra uma lista de usuários, vamos clicar no primeiro que tiver o texto exato do username
        const userResult = await page.waitForSelector(`xpath=//span[translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')="${username.toLowerCase()}"]/ancestor::div[@role="button"] | //span[translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')="${username.toLowerCase()}"]`, { timeout: 10000 });
        if (userResult) {
          await userResult.click();
          await page.waitForTimeout(1000);
        } else {
          throw new Error("Usuário não encontrado na busca.");
        }
        
        // 5. Click the "Chat" / "Bate-papo" / "Avançar" / "Next" button (OPTIONAL)
        // Ocasionalmente, clicar no resultado da busca já navega direto para o chat sem precisar clicar em "Bate-papo"
        logIg(`Iniciando o chat com @${username}...`);
        const nextBtn = await page.waitForSelector(`xpath=//div[@role="button" and (contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'bate-papo') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'chat') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'avan') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'next'))]`, { timeout: 3000 }).catch(() => null);
        
        if (nextBtn) {
          await nextBtn.click();
        }
      } catch (e: any) {
        logIg(`❌ Falha ao buscar/iniciar chat com @${username}: ${e.message}`);
        continue;
      }

      // 6. Wait for chat box to load
      await page.waitForTimeout(4000 + Math.random() * 2000); // 4-6s
      
      try {
        // Encontra o input de texto (a textarea com placeholder de "Mensagem...")
        logIg(`Procurando campo de texto do chat...`);
        const messageInput = await page.waitForSelector('div[role="textbox"][contenteditable="true"]', { timeout: 15000 });
        
        if (messageInput) {
          await messageInput.click();
          await page.waitForTimeout(500 + Math.random() * 1000);
          
          logIg(`Digitando mensagem simulando humano...`);
          // Digitação com tempo bem aleatório para simular cadência humana (entre 40ms a 150ms por tecla)
          await messageInput.type(message, { delay: 40 + Math.floor(Math.random() * 110) }); 
          
          await page.waitForTimeout(1000 + Math.random() * 1500); // Wait a bit after typing

          // Click the send button or hit Enter
          logIg(`Enviando mensagem...`);
          
          // O Instagram as vezes precisa do Enter duas vezes ou focar no input
          await messageInput.focus();
          await page.keyboard.press('Enter');
          
          // Fallback adicional por precaução (um segundo enter)
          await page.waitForTimeout(1000);
          try {
             const sendBtn = await page.$(`xpath=//div[@role="button" and (contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'enviar') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'send'))]`);
             if (sendBtn) await sendBtn.click();
          } catch (e) {}
          
          logIg(`✅ Mensagem enviada para @${username}!`);
          successCount++;
          
          // Atualiza o banco de dados marcando que a DM foi enviada com sucesso para este perfil
          try {
            db.prepare("UPDATE ig_perfis SET dm_enviado = 1 WHERE username = ?").run(username);
            logIg(`💾 Status de DM enviado salvo no banco para @${username}`);
          } catch (dbErr) {
            logIg(`⚠️ Erro ao salvar status de DM no banco para @${username}`);
          }
        }
      } catch (e) {
        logIg(`❌ Erro ao enviar mensagem no chat para @${username}.`);
        continue; // Pula para o próximo se der erro
      }

      // 5. Cooldown between messages to simulate human behavior
      if (i < targets.length - 1) {
        // Wait before next message to avoid rate limits (30 a 60 segundos)
        const waitTime = 30000 + Math.random() * 30000;
        logIg(`Aguardando ${(waitTime / 1000).toFixed(1)}s antes do próximo envio...`);
        await page.waitForTimeout(waitTime);
      }
    }

    logIg(`══════════════════════════════════════════`);
    logIg(`✅ Disparo Completo! Mensagens enviadas: ${successCount}/${targets.length}.`);

    igDmRunning = false;
    igScraperRunning = false;
    await browser.close();

  } catch (error: any) {
    logIg(`🔥 Erro crítico no disparo de DM: ${error.message}`);
    if (browser) await browser.close();
    igDmRunning = false;
    igScraperRunning = false;
  }
});

// ── MÓDULO LEADS QUALIFICADOS ────────────────────────────────────────────────

router.get("/leads", async (req, res) => {
  try {
    const data = db.prepare("SELECT *, origem AS perfil_pai, telefone AS telefone_extraido, email AS email_extraido FROM ig_leads ORDER BY criado_em DESC LIMIT 5000").all();
    res.json(data || []);
  } catch (e) {
    res.json([]);
  }
});

router.delete("/leads/buscas/:keyword", async (req, res) => {
  const { keyword } = req.params;
  try {
    db.prepare("DELETE FROM ig_leads WHERE origem = ?").run(keyword);
    res.json({ message: "Busca excluída com sucesso." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


router.post("/leads/marcar-dm", async (req, res) => {
  const { usernames } = req.body;
  if (!Array.isArray(usernames) || usernames.length === 0) return res.status(400).json({ error: "No usernames provided." });
  try {
    const stmt = db.prepare("UPDATE ig_leads SET dm_enviado = 1 WHERE username = ?"); // Assuming ig_leads might need dm_enviado but it's not in schema. I'll add dm_enviado to schema later.
    const updateMany = db.transaction((names) => {
      for (const name of names) stmt.run(name);
    });
    updateMany(usernames);
    res.json({ message: "DMs marcadas como enviadas." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


router.post("/leads/send-bulk-dms", async (req, res) => {
  if (igScraperRunning || igDmRunning) {
    return res.status(400).json({ message: "Outra automação (Scraper ou DM) já está rodando." });
  }

  const { targets, template } = req.body;
  if (!targets || !Array.isArray(targets) || targets.length === 0) return res.status(400).json({ error: "Nenhum alvo informado." });
  if (!template) return res.status(400).json({ error: "Mensagem vazia." });

  const sessionData = db.prepare("SELECT session_cookie FROM ig_sessoes WHERE is_active = 1 LIMIT 1").get() as any;
  if (!sessionData || !sessionData.session_cookie) return res.status(401).json({ error: "Nenhuma sessão ativa." });

  igDmRunning = true;
  igScraperRunning = true;
  igScraperStopRequested = false;
  igScraperLog = [];
  res.json({ message: `Iniciando disparo para ${targets.length} leads...`, running: true });

  let browser: Browser | null = null;

  try {
    const { browser: b, context } = await launchIgBrowser(sessionData.session_cookie);
    browser = b;
    const page = await context.newPage();

    let successCount = 0;

    for (let i = 0; i < targets.length; i++) {
      if (igScraperStopRequested) break;
      const username = targets[i];
      logIg(`══════ DM [${i + 1}/${targets.length}]: @${username} ══════`);

      const userData = db.prepare("SELECT nome_completo FROM ig_leads WHERE username = ? LIMIT 1").get(username) as any;
      const nomeCompleto = userData?.nome_completo && userData.nome_completo.trim() !== "" ? userData.nome_completo.split(" ")[0] : username;
      let message = template.replace(/{nome}/g, nomeCompleto).replace(/{username}/g, `@${username}`);

      // Antifingerprinting
      const extraSpaces = " ".repeat(Math.floor(Math.random() * 3));
      const endChar = Math.random() > 0.7 ? "." : "";
      if (Math.random() > 0.5 && message.length > 5) {
        const insertPos = Math.floor(message.length / 2);
        message = message.slice(0, insertPos) + '\u200B' + message.slice(insertPos);
      }
      message = message + extraSpaces + endChar;

      await page.goto(`https://www.instagram.com/direct/new/`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3000 + Math.random() * 2000);

      try {
        const agoraNaoBtn = await page.waitForSelector(`xpath=//button[contains(., 'Agora não') or contains(., 'Not Now') or contains(., 'agora não')] | //div[@role="button" and (contains(., 'Agora não') or contains(., 'Not Now'))]`, { timeout: 5000 });
        if (agoraNaoBtn) { await agoraNaoBtn.click(); await page.waitForTimeout(1000); }
      } catch (e) {}

      try {
        const searchInput = await page.waitForSelector('input[name="queryBox"], input[placeholder*="esquisa"], input[placeholder*="earch"], input[type="text"]', { timeout: 15000 });
        if (searchInput) {
          await searchInput.type(username, { delay: 50 });
          await page.waitForTimeout(3000 + Math.random() * 1000);
        } else throw new Error("Campo de busca não encontrado.");
        
        const userResult = await page.waitForSelector(`xpath=//span[translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')="${username.toLowerCase()}"]/ancestor::div[@role="button"] | //span[translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')="${username.toLowerCase()}"]`, { timeout: 10000 });
        if (userResult) { await userResult.click(); await page.waitForTimeout(1000); }
        else throw new Error("Usuário não encontrado.");
        
        const nextBtn = await page.waitForSelector(`xpath=//div[@role="button" and (contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'bate-papo') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'chat') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'avan') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'next'))]`, { timeout: 3000 }).catch(() => null);
        if (nextBtn) await nextBtn.click();
      } catch (e: any) {
        logIg(`❌ Falha ao buscar/iniciar chat: ${e.message}`);
        continue;
      }

      await page.waitForTimeout(4000 + Math.random() * 2000);
      
      try {
        const messageInput = await page.waitForSelector('div[role="textbox"][contenteditable="true"]', { timeout: 15000 });
        if (messageInput) {
          await messageInput.click();
          await page.waitForTimeout(500 + Math.random() * 1000);
          await messageInput.type(message, { delay: 40 + Math.floor(Math.random() * 110) }); 
          await page.waitForTimeout(1000 + Math.random() * 1500);
          await messageInput.focus();
          await page.keyboard.press('Enter');
          await page.waitForTimeout(1000);
          try {
             const sendBtn = await page.$(`xpath=//div[@role="button" and (contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'enviar') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'send'))]`);
             if (sendBtn) await sendBtn.click();
          } catch (e) {}
          
          logIg(`✅ Mensagem enviada para @${username}!`);
          successCount++;
          try {
            // Ignore se a tabela n tiver a coluna dm_enviado, no SQLite melhor tentar e pegar o erro
            try { db.prepare("UPDATE ig_leads SET dm_enviado = 1 WHERE username = ?").run(username); } catch(e) {}
          } catch (e) {}
        }
      } catch (e) {
        continue;
      }

      if (i < targets.length - 1) {
        const waitTime = 30000 + Math.random() * 30000;
        await page.waitForTimeout(waitTime);
      }
    }

    igDmRunning = false;
    igScraperRunning = false;
    await browser.close();

  } catch (error: any) {
    if (browser) await browser.close();
    igDmRunning = false;
    igScraperRunning = false;
  }
});

router.post("/leads/scrape-keyword", async (req, res) => {
  if (igScraperRunning) return res.status(400).json({ message: "Outra extração do IG já está rodando." });

  const { keyword } = req.body;
  if (!keyword) return res.status(400).json({ error: "keyword é obrigatória." });

  const sessionData = db.prepare("SELECT session_cookie FROM ig_sessoes WHERE is_active = 1 LIMIT 1").get() as any;

  if (!sessionData || !sessionData.session_cookie) {
    return res.status(401).json({ error: "Nenhuma sessão ativa encontrada. Configure o Login primeiro." });
  }

  igScraperRunning = true;
  igScraperStopRequested = false;
  igScraperLog = [];
  res.json({ message: `Iniciando busca por leads com a palavra-chave "${keyword}"...`, running: true });

  let browser: Browser | null = null;

  try {
    logIg(`Iniciando motor Chromium Stealth...`);
    const { browser: b, context } = await launchIgBrowser(sessionData.session_cookie);
    browser = b;
    const page = await context.newPage();

    logIg(`══════ BUSCA DE LEADS POR PALAVRA-CHAVE ══════`);
    
    const currentUrl = page.url();
    if (!currentUrl.includes("instagram.com")) {
      await page.goto(`https://www.instagram.com/`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.evaluate(() => {
        alert("Aviso do Robô: A navegação começou. Se aparecer um CAPTCHA ou desafio para confirmar que você é humano, clique em 'OK' aqui, resolva o desafio e aguarde. O robô continuará sozinho assim que detectar que foi resolvido.");
      }).catch(() => {});
      await page.waitForTimeout(3000);
    }
    
    logIg(`📋 Fase 1: buscando "${keyword}" via Motores de Busca Nativos (Google/DDG)...`);

    const allUsernames = new Set<string>();
    
    // --- FUNÇÃO AUXILIAR PARA EXTRAIR USERNAMES DA TELA ---
    const extractUsernamesFromDOM = async (pageObj: Page) => {
        return await pageObj.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a'));
            const extracted: string[] = [];
            anchors.forEach((a: any) => {
                if (!a.href) return;
                // Decodifica a URL (útil para DuckDuckGo que codifica https%3A%2F%2F)
                const decoded = decodeURIComponent(a.href);
                if (decoded.includes("instagram.com")) {
                    const match = decoded.match(/instagram\.com\/([a-zA-Z0-9._]+)\/?/);
                    if (match) {
                        const u = match[1];
                        if (!["explore", "accounts", "p", "reel", "stories", "direct", "tv", "developer", "about", "legal"].includes(u)) {
                            extracted.push(u);
                        }
                    }
                }
            });
            return extracted;
        });
    };

    // --- MOTOR DE BUSCA: DUCKDUCKGO ---
    try {
        logIg(`🦆 Iniciando Busca no DuckDuckGo (Motor Nativo)...`);
        // DuckDuckGo lite/html é excelente para scraper sem captchas bloqueantes
        await page.goto(`https://html.duckduckgo.com/html/?q=site:instagram.com+${encodeURIComponent(keyword)}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3000);

        for (let pageNum = 1; pageNum <= 30; pageNum++) { // Até 30 páginas no DDG para garantir volume
            if (igScraperStopRequested) break;
            
            const usernames = await extractUsernamesFromDOM(page);
            let added = 0;
            usernames.forEach(u => {
                if (!allUsernames.has(u)) {
                    allUsernames.add(u);
                    added++;
                }
            });
            logIg(`✅ DuckDuckGo (Página ${pageNum}): +${added} perfis novos. Total único: ${allUsernames.size}`);

            // Procurar botão de próxima página no DDG HTML
            const nextForms = await page.$$('form');
            let clickedNext = false;
            for (const form of nextForms) {
                const action = await form.getAttribute('action');
                const btn = await form.$('input[value="Next"]');
                if (action?.includes('html') && btn) {
                    await btn.click();
                    await page.waitForTimeout(3000 + Math.random() * 2000);
                    clickedNext = true;
                    break;
                }
            }
            
            if (!clickedNext) break;
        }
    } catch (e: any) {
        logIg(`❌ Erro no scraper do DuckDuckGo: ${e.message}`);
    }


    // --- MOTOR DE BUSCA: BING ---
    try {
        logIg(`🔵 Iniciando Busca no Bing (Motor Alternativo contra bloqueios)...`);
        await page.goto(`https://www.bing.com/search?q=site:instagram.com+${encodeURIComponent(keyword)}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3000);
        
        for (let pageNum = 1; pageNum <= 15; pageNum++) { // Até 15 páginas no Bing
            if (igScraperStopRequested) break;
            
            const usernames = await extractUsernamesFromDOM(page);
            let added = 0;
            usernames.forEach(u => {
                if (!allUsernames.has(u)) {
                    allUsernames.add(u);
                    added++;
                }
            });
            logIg(`✅ Bing (Página ${pageNum}): +${added} perfis novos. Total único: ${allUsernames.size}`);

            // Clicar no botão "Próximo" do Bing
            const nextBtn = await page.$('.sb_pagN, a[title="Next page"]');
            if (nextBtn) {
                await nextBtn.click();
                await page.waitForTimeout(3000 + Math.random() * 2000);
            } else {
                logIg(`✅ Fim das páginas do Bing alcançado.`);
                break;
            }
        }
    } catch (e: any) {
        logIg(`❌ Erro no scraper do Bing: ${e.message}`);
    }

    logIg(`📊 Total após Busca Profunda Nativa: ${allUsernames.size} perfis únicos descobertos.`);

    const foundUsers = Array.from(allUsernames).map(username => ({ username }));
    if (foundUsers.length === 0) {
      logIg(`❌ Nenhum perfil encontrado para "${keyword}".`);
      igScraperRunning = false;
      await browser.close();
      return;
    }
    logIg(`🚀 Iniciando inspeção profunda de ${foundUsers.length} perfis...`);


    const leads: any[] = [];

    for (let i = 0; i < foundUsers.length; i++) {
      if (igScraperStopRequested) {
        logIg("🛑 Extração de leads interrompida pelo usuário.");
        break;
      }
      
      const targetUser = foundUsers[i].username;
      logIg(`Extraindo [${i+1}/${foundUsers.length}]: @${targetUser}`);
      
      const pData = await scrapeProfileData(page, targetUser);
      if (pData) {
        leads.push({ ...pData, perfil_pai: keyword });
        const upsertPayload = { ...pData, perfil_pai: keyword };
        logIg(`💾 Salvando @${targetUser} → ${JSON.stringify(Object.keys(upsertPayload))}`);
        let upsertErr: any = null;
        try {
          db.prepare(`INSERT INTO ig_leads (username, nome_completo, bio, seguidores, posts, telefone, email, link_bio, is_business, origem)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(username) DO UPDATE SET nome_completo=excluded.nome_completo`)
          .run(pData.username, pData.nome_completo, pData.bio, pData.seguidores, pData.posts, pData.telefone_extraido, pData.email_extraido, pData.link_bio, pData.is_business ? 1 : 0, keyword);
        } catch(e) { upsertErr = e; }
        if (upsertErr) {
          logIg(`❌ ERRO ao salvar @${targetUser}: ${upsertErr.message} | Código: ${upsertErr.code}`);
        } else {
          logIg(`✅ @${targetUser} salvo com sucesso na tabela ig_leads!`);
        }
      } else {
        logIg(`⚠️ scrapeProfileData retornou null para @${targetUser}`);
      }
      
      // Delay humanizado entre perfis (15-45s)
      await humanDelay(15000, 45000);
      
      // Pausa de descanso a cada 10 perfis (1-2 min)
      if ((i + 1) % 10 === 0 && i < foundUsers.length - 1) {
        const restTime = 60000 + Math.random() * 60000;
        logIg(`😴 Pausa de descanso (${(restTime / 1000).toFixed(0)}s) após ${i + 1} perfis...`);
        await page.waitForTimeout(restTime);
      }
    }

    logIg(`══════════════════════════════════════════`);
    logIg(`✅ Busca completa! ${leads.length} leads qualificados salvos para "${keyword}".`);

    try { db.prepare("INSERT INTO ig_buscas (tipo_busca, alvo, total_capturado) VALUES (?, ?, ?)").run('KEYWORD_LEADS', keyword, leads.length); } catch(e){}

    igScraperRunning = false;
    await browser.close();

  } catch (error: any) {
    logIg(`🔥 Erro crítico na extração de leads: ${error.message}`);
    if (browser) await browser.close();
    igScraperRunning = false;
  }
});

export default router;
