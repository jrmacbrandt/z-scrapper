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
  humanType,
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
  let username = req.body.username || "MinhaConta";

  logIg(`Abrindo navegador para login interativo da conta @${username}...`);
  let browser: Browser | null = null;
  try {
    const launchOptions = {
      headless: false,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--window-size=1280,800",
        "--no-sandbox",
      ],
      ...getProxyLaunchArgs(),
    };

    try {
      browser = await chromium.launch({ ...launchOptions, channel: "chrome" });
      logIg("✅ Navegador Chrome nativo detectado e iniciado.");
    } catch (e) {
      logIg("⚠️ Chrome nativo não encontrado, usando Chromium padrão embutido...");
      browser = await chromium.launch(launchOptions);
    }

    const contextOptions = getStealthContextOptions({ viewport: { width: 1280, height: 800 } });
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

    let profilePicUrl = "";
    if (sessionCookieStr) {
      try {
        logIg(`Extraindo foto de perfil e username da tela inicial...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        logIg(`Extraindo foto de perfil e username da tela inicial (Aguardando renderização)...`);
        let userInfo: { username: string; profilePic: string } | null = null;
        
        // Tentativa 1: Loop de DOM Regex por até 15 segundos (Padrão Antigo que extraia foto em alta qualidade)
        for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            userInfo = await page.evaluate(() => {
                try {
                    const html = document.body.innerHTML;
                    const match = html.match(/"username":"([^"]+)","profile_pic_url":"([^"]+)"/);
                    if (match) return { username: match[1], profilePic: match[2].replace(/\\u0026/g, "&") };
                    
                    const links = Array.from(document.querySelectorAll('a[role="link"]'));
                    for (const a of links) {
                        const href = a.getAttribute("href") || "";
                        const parts = href.split("/");
                        if (href.startsWith("/") && href.endsWith("/") && parts.length === 3) {
                            const img = a.querySelector("img");
                            if (img && img.width > 0 && img.width <= 150) {
                                return { username: parts[1], profilePic: img.src };
                            }
                        }
                    }
                } catch(e) {}
                return null;
            });
            if (userInfo && userInfo.profilePic) break;
        }

        if (userInfo && userInfo.username && userInfo.profilePic) {
            username = userInfo.username;
            profilePicUrl = userInfo.profilePic;
            logIg(`✅ Conta identificada na tela via DOM: @${username}`);
        } else {
            // Tentativa 2: API web_form_data (Garante o username, mas a foto pode falhar)
            logIg(`⚠️ Regex DOM falhou. Tentando identificar via API interna...`);
            const apiData = await page.evaluate(async () => {
                try {
                    const res = await fetch("https://www.instagram.com/api/v1/accounts/edit/web_form_data/", {
                        headers: { "X-IG-App-ID": "936619743392459", "X-Requested-With": "XMLHttpRequest" }
                    });
                    if (res.ok) return await res.json();
                    return null;
                } catch { return null; }
            });

            if (apiData && apiData.form_data && apiData.form_data.username) {
                username = apiData.form_data.username;
                let pic = apiData.form_data.profile_pic_url || "";
                
                // Se a API não trouxe foto, tentamos forçar abrindo o perfil dele
                if (!pic) {
                    logIg(`⚠️ Foto não veio na API. Navegando para o perfil @${username} para capturar a foto...`);
                    try {
                        await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
                        await page.waitForTimeout(4000);
                        pic = await page.evaluate(() => {
                            const meta = document.querySelector('meta[property="og:image"]');
                            return meta ? (meta.getAttribute('content') || "") : "";
                        });
                    } catch(e) {}
                }

                profilePicUrl = pic;
                logIg(`✅ Conta identificada via API/Navegação: @${username}`);
            } else {
                logIg(`❌ Todas as tentativas de extrair username/foto falharam. Mantendo padrão.`);
            }
        }
      } catch (e) {
        logIg(`Erro ao tentar extrair dados do perfil: ${e}`);
      }
    }

    await browser.close();

    if (!sessionCookieStr) {
      return res.status(408).json({ error: "Tempo esgotado. Login não foi detectado." });
    }

    logIg(`Sessão capturada com sucesso! Salvando no banco...`);

    db.prepare("UPDATE ig_sessoes SET is_active = 0 WHERE username != '___'").run();
    // Salva session_cookie, all_cookies e profile_pic_url
    try { db.exec(`ALTER TABLE ig_sessoes ADD COLUMN all_cookies TEXT DEFAULT ''`); } catch (e) { /* coluna já existe */ }
    try { db.exec(`ALTER TABLE ig_sessoes ADD COLUMN profile_pic_url TEXT DEFAULT ''`); } catch (e) { /* coluna já existe */ }
    
    db.prepare("INSERT INTO ig_sessoes (username, session_cookie, all_cookies, profile_pic_url, is_active) VALUES (?, ?, ?, ?, 1)").run(username, sessionCookieStr, allCookiesJson, profilePicUrl);
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
    try { db.prepare("DELETE FROM ig_scraping_state WHERE target_username = ?").run(pai); } catch(e) {}
    try { db.prepare("DELETE FROM ig_posts_processados WHERE target_username = ?").run(pai); } catch(e) {}
    res.json({ message: "Busca excluída com sucesso." });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


router.post("/marcar-dm", async (req, res) => {
  const { usernames } = req.body;
  if (!Array.isArray(usernames) || usernames.length === 0) return res.status(400).json({ error: "No usernames provided." });
  try {
    const stmt = db.prepare("UPDATE ig_perfis SET dm_enviado = dm_enviado + 1 WHERE username = ?");
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

// ── Endpoint de Teste: Valida fetchRealName sem enviar DM ─────────────────────
router.post("/test-name-fetch", async (req, res) => {
  const { usernames } = req.body;
  if (!Array.isArray(usernames) || usernames.length === 0) {
    return res.status(400).json({ error: "Informe um array 'usernames'." });
  }

  const sessionData = db.prepare("SELECT session_cookie FROM ig_sessoes WHERE is_active = 1 LIMIT 1").get() as any;
  if (!sessionData?.session_cookie) {
    return res.status(401).json({ error: "Nenhuma sessão ativa encontrada." });
  }

  res.json({ message: `Iniciando teste de captura de nome para ${usernames.length} perfis...`, running: true });

  let browser: any = null;
  try {
    const { browser: b, context } = await launchIgBrowser(sessionData.session_cookie);
    browser = b;
    const page = await context.newPage();
    const results: any[] = [];

    for (const username of usernames) {
      logIg(`🧪 [TESTE] Buscando nome real de @${username}...`);
      const dbRow = db.prepare("SELECT nome_completo FROM ig_perfis WHERE username = ? LIMIT 1").get(username) as any;
      const cachedName = dbRow?.nome_completo?.trim();
      const hasRealName = cachedName && cachedName.toLowerCase() !== username.toLowerCase() && !cachedName.includes('.') && !cachedName.includes('_');

      let nomeFinal: string;
      let source: string;

      if (hasRealName) {
        const firstName = cachedName.split(" ")[0];
        nomeFinal = firstName.charAt(0).toUpperCase() + firstName.slice(1);
        source = "cache_banco";
        logIg(`📋 [TESTE] Nome do banco: "${nomeFinal}" para @${username}`);
      } else {
        nomeFinal = await fetchRealName(page, username);
        source = "api_instagram";
      }

      // Simula a mensagem que SERIA enviada (sem enviar nada)
      const templateSimulado = "Olá {nome}, tudo bem? Vi que segue a @contabilizei...";
      const msgSimulada = templateSimulado.replace(/{nome}/g, nomeFinal).replace(/{username}/g, `@${username}`);

      results.push({
        username,
        nome_real_capturado: nomeFinal,
        primeiro_nome: nomeFinal,
        fonte: source,
        mensagem_simulada: msgSimulada,
        banco_antes: cachedName || "(vazio)",
      });

      logIg(`✅ [TESTE] @${username} → nome="${nomeFinal}" | msg iniciaria: "${msgSimulada.substring(0, 60)}..."`);
    }

    await browser.close();
    logIg(`🏁 [TESTE] Concluído. ${results.length} perfis testados. Nenhuma DM foi enviada.`);
    // Log os resultados no console para análise
    logIg(`📊 [TESTE] Resultados: ${JSON.stringify(results, null, 2)}`);
  } catch (err: any) {
    if (browser) await browser.close().catch(() => {});
    logIg(`❌ [TESTE] Erro: ${err.message}`);
  }
});

// ── Motor de Scraping (Stealth Avançado) ──────────────────────────────────────

// ── Helper: Buscar nome real de um perfil via API do Instagram ────────────────
// Navega para o perfil e extrai o full_name via:
//   1. waitForResponse (intercepta JSON da API - 100% confiável)
//   2. <title> da página (fallback)
//   3. DOM scraping do header (fallback final)
// Nunca lança exceção — retorna username capitalizado como último recurso.
async function fetchRealName(page: Page, username: string): Promise<string> {
  let realFullName = "";

  try {
    // Registra a promise ANTES do goto para não perder a resposta
    const apiResponsePromise = page.waitForResponse(
      (res) => {
        const url = res.url();
        return (
          (url.includes("/api/v1/users/web_profile_info/") || url.includes("graphql/query")) &&
          res.status() === 200
        );
      },
      { timeout: 20000 }
    ).catch(() => null);

    await page.goto(`https://www.instagram.com/${username}/`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Aguarda a resposta da API (que será resolvida logo após o goto)
    const apiResponse = await apiResponsePromise;
    if (apiResponse) {
      try {
        const json = await apiResponse.json();
        const user = json?.data?.user || json?.graphql?.user;
        if (user && user.full_name) {
          realFullName = user.full_name.trim();
          logIg(`🔎 [fetchRealName] API JSON capturado para @${username}: "${realFullName}"`);
        }
      } catch (e) {
        logIg(`⚠️ [fetchRealName] Falha ao parsear JSON da API para @${username}`);
      }
    }
  } catch (e) {
    logIg(`⚠️ [fetchRealName] Erro no goto/waitForResponse para @${username}`);
  }

  // Fallback 2: extrai do <title> da página
  // Formato típico: "Nome Real (@username) • Fotos e vídeos do Instagram"
  if (!realFullName) {
    try {
      const title = await page.title();
      const titleMatch = title.match(/^(.+?)\s*\(@/);
      if (titleMatch && titleMatch[1].trim()) {
        realFullName = titleMatch[1].trim();
        logIg(`🔎 [fetchRealName] Nome extraído do <title> para @${username}: "${realFullName}"`);
      }
    } catch {}
  }

  // Fallback 3: DOM scraping do header do perfil
  if (!realFullName) {
    try {
      const domName = await page.evaluate((uname) => {
        // Instagram coloca o nome completo em um h1 ou em um span dentro do header
        const candidates = [
          document.querySelector('h1'),
          document.querySelector('header h1'),
          document.querySelector('header section h1'),
          document.querySelector('header span[class*="x1lliihq"]'),
        ];
        for (const el of candidates) {
          const text = el?.textContent?.trim() || '';
          // Descarta se for igual ao username ou muito curto/longo
          if (text && text.toLowerCase() !== uname.toLowerCase() && text.length > 1 && text.length < 100) {
            return text;
          }
        }
        // Tenta varredura mais ampla: spans dentro do header
        const header = document.querySelector('header');
        if (header) {
          const spans = header.querySelectorAll('span');
          for (const span of Array.from(spans)) {
            const text = span.textContent?.trim() || '';
            if (text && text.toLowerCase() !== uname.toLowerCase() && !text.startsWith('@') && text.length > 1 && text.length < 100 && !/^\d/.test(text)) {
              return text;
            }
          }
        }
        return '';
      }, username);

      if (domName) {
        realFullName = domName;
        logIg(`🔎 [fetchRealName] Nome extraído do DOM para @${username}: "${realFullName}"`);
      }
    } catch {}
  }

  // Valida e retorna
  if (realFullName && realFullName.trim() !== "" && realFullName.toLowerCase() !== username.toLowerCase()) {
    const firstName = realFullName.split(" ")[0];
    const capitalizedFirst = firstName.charAt(0).toUpperCase() + firstName.slice(1);
    // Persiste no banco para evitar nova navegação na próxima vez
    try { db.prepare("UPDATE ig_perfis SET nome_completo = ? WHERE username = ?").run(realFullName, username); } catch {}
    try { db.prepare("UPDATE ig_leads SET nome_completo = ? WHERE username = ?").run(realFullName, username); } catch {}
    logIg(`✅ Nome real capturado para @${username}: "${realFullName}" → usando "${capitalizedFirst}"`);
    return capitalizedFirst;
  }

  // Último recurso: username capitalizado
  const fallback = username.charAt(0).toUpperCase() + username.slice(1);
  logIg(`⚠️ Nome real não encontrado para @${username}. Usando fallback: "${fallback}"`);
  return fallback;
}

// ── Helper: Curtir 1–3 posts do perfil de forma humanizada antes da DM ─────────
async function likeProfilePosts(page: Page, username: string): Promise<void> {
  const numLikes = Math.floor(Math.random() * 3) + 1; // 1, 2 ou 3
  logIg(`❤️ [Warm-up] Iniciando curtidas em ${numLikes} post(s) de @${username}...`);

  try {
    // Navega para o perfil do lead
    await page.goto(`https://www.instagram.com/${username}/`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2500 + Math.random() * 2000);

    // Rolagem orgânica — simula leitura do perfil antes de ver posts
    await humanScroll(page);
    await microPause();
    await humanMouseMove(page, 400 + Math.random() * 400, 300 + Math.random() * 200);
    await page.waitForTimeout(1500 + Math.random() * 1500);

    // Coleta links de posts do grid (primeiros 12 visíveis)
    const postLinks: string[] = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/p/"]'));
      const unique = [...new Set(anchors.map((a: any) => a.href))];
      return unique.slice(0, 12);
    });

    if (postLinks.length === 0) {
      logIg(`⚠️ [Warm-up] Nenhum post encontrado no grid de @${username}. Pulando curtidas.`);
      return;
    }

    // Embaralha e seleciona N posts aleatórios
    const shuffled = postLinks.sort(() => Math.random() - 0.5);
    const tolike = shuffled.slice(0, Math.min(numLikes, shuffled.length));

    for (let pi = 0; pi < tolike.length; pi++) {
      if (igScraperStopRequested) break;

      const postUrl = tolike[pi];
      logIg(`❤️ [Warm-up] Abrindo post ${pi + 1}/${tolike.length}...`);

      await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      // Simula leitura do post (3–6s)
      await page.waitForTimeout(3000 + Math.random() * 3000);
      await humanMouseMove(page, 300 + Math.random() * 500, 200 + Math.random() * 300);
      await humanScroll(page);
      await microPause();

      // Verifica se já está curtido (aria-label muda para "Descurtir"/"Unlike")
      const alreadyLiked = await page.$(
        'svg[aria-label="Descurtir"], svg[aria-label="Unlike"]'
      );

      if (alreadyLiked) {
        logIg(`👍 [Warm-up] Post ${pi + 1} de @${username} já estava curtido. Pulando.`);
      } else {
        // Tenta encontrar o botão de curtir
        const likeBtn = await page.$(
          'svg[aria-label="Curtir"], svg[aria-label="Like"]'
        );

        if (likeBtn) {
          // Move o mouse organicamente até a área do botão antes de clicar
          const box = await likeBtn.boundingBox();
          if (box) {
            await humanMouseMove(
              page,
              box.x + box.width / 2 + (Math.random() - 0.5) * 10,
              box.y + box.height / 2 + (Math.random() - 0.5) * 10
            );
            await microPause();
          }
          await likeBtn.click();
          logIg(`❤️ [Warm-up] Post ${pi + 1} de @${username} curtido com sucesso!`);
          await page.waitForTimeout(1200 + Math.random() * 1000);
        } else {
          // Fallback: double-click na foto (gesto mais humano)
          const postImg = await page.$('article img');
          if (postImg) {
            await postImg.dblclick();
            logIg(`❤️ [Warm-up] Post ${pi + 1} de @${username} curtido via double-click.`);
            await page.waitForTimeout(1500 + Math.random() * 1000);
          } else {
            logIg(`⚠️ [Warm-up] Botão de curtir não localizado no post ${pi + 1}. Pulando.`);
          }
        }
      }

      // Delay entre curtidas (8–20s) — simula comportamento humano
      if (pi < tolike.length - 1) {
        const delayBetween = 8000 + Math.random() * 12000;
        logIg(`⏳ [Warm-up] Aguardando ${(delayBetween / 1000).toFixed(1)}s antes do próximo post...`);
        await page.waitForTimeout(delayBetween);
      }
    }

    // Cooldown final antes de iniciar a DM (30–90s)
    const cooldown = 30000 + Math.random() * 60000;
    logIg(`✅ [Warm-up] Curtidas concluídas! Aguardando ${(cooldown / 1000).toFixed(1)}s antes de enviar a DM...`);
    await page.waitForTimeout(cooldown);

  } catch (e: any) {
    logIg(`⚠️ [Warm-up] Erro ao curtir posts de @${username}: ${e.message}. Continuando com DM normalmente...`);
  }
}

async function launchIgBrowser(sessionCookie: string) {
  const launchOptions = {
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--window-size=1280,800",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
    ...getProxyLaunchArgs(),
  };

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ ...launchOptions, channel: "chrome" });
  } catch (e) {
    logIg("⚠️ Chrome nativo não encontrado no scraper, usando Chromium padrão embutido...");
    browser = await chromium.launch(launchOptions);
  }

  // Contexto com fingerprint completo e realista
  const contextOptions = getStealthContextOptions({ colorScheme: "dark", viewport: { width: 1280, height: 800 } });
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
async function getFollowerUsernames(page: Page, targetUsername: string, resumeMaxId?: string): Promise<any[]> {
  logIg(`📋 Buscando seguidores de @${targetUsername} via Scroll DOM (Modo Stealth)...`);

  // Navega para o perfil do alvo
  await page.goto(`https://www.instagram.com/${targetUsername}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);

  // Clica no link de "seguidores" para abrir o modal
  logIg(`🖱️ Abrindo modal de seguidores de @${targetUsername}...`);
  const followersLink = await page.$(`a[href="/${targetUsername}/followers/"]`);
  if (!followersLink) {
    // Tenta pelo texto
    const altLink = await page.$(`a[href="/${targetUsername}/followers/"], [role="link"]:has-text("seguidores"), [role="link"]:has-text("followers")`);
    if (altLink) {
      await altLink.click();
    } else {
      // Navegação direta
      await page.goto(`https://www.instagram.com/${targetUsername}/followers/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    }
  } else {
    await followersLink.click();
  }
  
  await page.waitForTimeout(3000);

  // Encontra o container scrollável do modal de seguidores
  const followers: any[] = [];
  const seenUsernames = new Set<string>();
  const LIMIT_PER_SESSION = 3000;
  let noNewFollowersCount = 0;
  let scrollAttempts = 0;
  const MAX_SCROLL_ATTEMPTS = 500; // Segurança contra loop infinito

  // Função para extrair usernames visíveis do modal
  const extractVisibleFollowers = async (): Promise<number> => {
    const newFollowers = await page.evaluate(() => {
      const results: { username: string; fullName: string }[] = [];
      // O modal de seguidores usa um container com role="dialog" ou com classe específica
      const dialog = document.querySelector('[role="dialog"]') || document.querySelector('div[style*="overflow"]');
      if (!dialog) return results;

      // Busca todos os links de perfil dentro do modal
      const links = dialog.querySelectorAll('a[role="link"]');
      links.forEach(link => {
        const href = link.getAttribute('href') || '';
        const match = href.match(/^\/([^/]+)\/$/);
        if (match && match[1] !== 'explore' && match[1] !== 'accounts') {
          const username = match[1];
          // Pega o nome completo do texto próximo subindo alguns níveis no DOM
          let fullName = username;
          let currentElement: HTMLElement | null = link.parentElement;
          for (let i = 0; i < 5; i++) {
            if (!currentElement) break;
            const spans = currentElement.querySelectorAll('span');
            for (const span of Array.from(spans)) {
              const text = span.textContent?.trim() || '';
              if (text && text.toLowerCase() !== username.toLowerCase() && !text.includes('Follow') && !text.includes('Seguir') && !text.includes('Remover') && text.length > 1 && text.length < 80) {
                fullName = text;
                break;
              }
            }
            if (fullName !== username) break;
            currentElement = currentElement.parentElement;
          }
          results.push({ username, fullName });
        }
      });
      return results;
    });

    let addedCount = 0;
    for (const f of newFollowers) {
      if (!seenUsernames.has(f.username)) {
        seenUsernames.add(f.username);
        followers.push({
          username: f.username,
          nome_completo: f.fullName || f.username,
          bio: "",
          seguidores: 0,
          seguindo: 0,
          posts: 0,
          telefone_extraido: null,
          link_bio: null,
          email_extraido: null,
          is_business: false,
          perfil_pai: targetUsername,
        });
        addedCount++;
      }
    }
    return addedCount;
  };

  // Extração inicial
  await extractVisibleFollowers();
  logIg(`📥 Extração inicial: ${followers.length} seguidores encontrados no modal.`);

  // Scroll loop para carregar mais seguidores
  while (scrollAttempts < MAX_SCROLL_ATTEMPTS && followers.length < LIMIT_PER_SESSION) {
    if (igScraperStopRequested) {
      logIg("🛑 Busca de seguidores interrompida pelo usuário.");
      break;
    }

    // Scroll para baixo dentro do modal
    await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog) {
        const scrollable = dialog.querySelector('div[style*="overflow"]') || 
                           dialog.querySelector('[class*="scroll"]') ||
                           dialog.querySelectorAll('div')[1]; // fallback: segundo div dentro do dialog
        // Tenta encontrar o elemento scrollável real
        const allDivs = dialog.querySelectorAll('div');
        for (const div of Array.from(allDivs)) {
          if (div.scrollHeight > div.clientHeight && div.clientHeight > 100) {
            div.scrollTop = div.scrollHeight;
            return;
          }
        }
        // Fallback: scroll o dialog inteiro
        dialog.scrollTop = dialog.scrollHeight;
      }
    });

    await page.waitForTimeout(1500 + Math.random() * 1500); // 1.5-3s entre scrolls
    scrollAttempts++;

    const added = await extractVisibleFollowers();

    if (added > 0) {
      noNewFollowersCount = 0;
      if (scrollAttempts % 10 === 0) {
        logIg(`📥 Scroll #${scrollAttempts}: ${followers.length} seguidores coletados (+${added} novos)`);
      }
    } else {
      noNewFollowersCount++;
      if (noNewFollowersCount >= 8) {
        logIg(`✅ Fim da lista detectado (${noNewFollowersCount} scrolls sem novos). Total: ${followers.length}`);
        break;
      }
    }

    // Pausa de descanso a cada 50 scrolls (15-25s)
    if (scrollAttempts % 50 === 0) {
      const pausaDescanso = 15000 + Math.random() * 10000;
      logIg(`😴 Pausa de descanso (${(pausaDescanso / 1000).toFixed(0)}s) para evitar rate limit... Total: ${followers.length}`);
      await page.waitForTimeout(pausaDescanso);
    }
  }

  // Checagem de limite de segurança (Scraping Incremental)
  if (followers.length >= LIMIT_PER_SESSION) {
    logIg(`🛑 Limite de segurança de ${LIMIT_PER_SESSION} seguidores atingido na sessão.`);
    try {
      db.prepare(`INSERT INTO ig_scraping_state (target_username, next_max_id, total_extracted) 
                  VALUES (?, ?, ?) 
                  ON CONFLICT(target_username) DO UPDATE SET next_max_id=excluded.next_max_id, total_extracted=total_extracted+excluded.total_extracted, atualizado_em=CURRENT_TIMESTAMP`)
        .run(targetUsername, String(scrollAttempts), followers.length);
    } catch (e: any) {
      logIg(`⚠️ Erro ao salvar estado de extração: ${e.message}`);
    }
  } else {
    // Lista completa - limpa o estado
    try {
      db.prepare("DELETE FROM ig_scraping_state WHERE target_username = ?").run(targetUsername);
    } catch (e) {}
  }

  logIg(`✅ Total final: ${followers.length} seguidores extraídos de @${targetUsername}.`);
  return followers;
}

// ── Helper: FASE 3 - Extrair Curtidores e Comentadores de Posts ───────
async function getLikersAndCommenters(page: Page, targetUsername: string, tabUrl: string, state: any): Promise<void> {
  logIg(`📸 Lendo posts da aba: ${tabUrl}`);
  const LIMIT_PER_SESSION = 3000;
  if (state.sessionLeadsCount >= LIMIT_PER_SESSION) {
    logIg(`🛑 Limite de ${LIMIT_PER_SESSION} já atingido. Pulando esta aba.`);
    return;
  }

  // 1. Navegar para a aba
  await page.goto(tabUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  // Esperar o grid de posts carregar
  try {
    await page.waitForSelector('article a[href*="/p/"], article a[href*="/reel/"]', { timeout: 10000 });
  } catch (e) {
    logIg(`⚠️ Grid de posts demorou a carregar na aba ${tabUrl}.`);
  }
  await page.waitForTimeout(4000);

  // Scroll 8 vezes para carregar dezenas de posts e permitir alcançar posts mais antigos se os recentes já foram vistos
  for (let s = 0; s < 8; s++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  }

  const postLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
    return links.map((a: any) => a.getAttribute('href')).filter((href, index, self) => self.indexOf(href) === index);
  });

  if (postLinks.length === 0) {
    logIg(`❌ Nenhum post extraído da aba ${tabUrl}.`);
    return;
  }

  // Obter posts já processados no passado para este perfil
  let processedSet = new Set<string>();
  try {
    const rows = db.prepare("SELECT post_url FROM ig_posts_processados WHERE target_username = ?").all(targetUsername) as { post_url: string }[];
    processedSet = new Set(rows.map(r => r.post_url));
  } catch (e) {}

  // Filtra links: reanalisa sempre os 5 posts mais recentes da aba.
  // Os posts mais antigos (> índice 4) só serão reabertos se nunca tiverem sido processados no passado.
  const newPostLinks = postLinks.filter((link, index) => {
    if (state.seenPostLinks.has(link)) return false;
    if (index < 5) return true; // Reanalisa sempre os 5 mais recentes
    return !processedSet.has(link); // Ignora se já foi processado anteriormente
  });
  
  if (newPostLinks.length === 0) {
    logIg(`Todos os posts inéditos desta aba já foram analisados. Indo para a próxima.`);
    return;
  }

  logIg(`📸 Encontrados ${newPostLinks.length} posts inéditos nesta sessão (regressivo).`);

  const saveLead = (username: string, fullName: string, addedScore: number) => {
    if (username === targetUsername) return;
    
    let isNewToSession = false;
    if (!state.seenUsernames.has(username)) {
      state.seenUsernames.add(username);
      if (state.sessionLeadsCount < LIMIT_PER_SESSION) {
        state.sessionLeadsCount++;
        isNewToSession = true;
      }
    }

    try {
      // O score base é 10. Se for curtir/comentar, soma addedScore. Limitado a 100.
      db.prepare(`
        INSERT INTO ig_perfis (username, nome_completo, bio, seguidores, seguindo, posts, is_business, is_private, perfil_pai, score) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET 
          score = MIN(COALESCE(ig_perfis.score, 10) + excluded.score, 100),
          perfil_pai = CASE WHEN ig_perfis.perfil_pai IS NULL THEN excluded.perfil_pai ELSE ig_perfis.perfil_pai END,
          nome_completo = CASE WHEN ig_perfis.nome_completo IS NULL OR ig_perfis.nome_completo = ig_perfis.username THEN excluded.nome_completo ELSE ig_perfis.nome_completo END
      `).run(username, fullName || username, "", 0, 0, 0, 0, 0, targetUsername, addedScore);
      
      if (isNewToSession) {
        state.leads.push({ username, nome_completo: fullName || username, score: addedScore });
      }
    } catch(e: any) {
      // Ignorar erros silenciosamente para não poluir log
    }
  };

  // Iterar do mais recente para o mais antigo
  for (let i = 0; i < newPostLinks.length; i++) {
    if (igScraperStopRequested) break;
    if (state.sessionLeadsCount >= LIMIT_PER_SESSION) {
      logIg(`🛑 Limite diário de ${LIMIT_PER_SESSION} leads alcançado. Parando extração desta aba.`);
      break;
    }

    try {
      const postPath = newPostLinks[i];
      state.seenPostLinks.add(postPath);
      const postUrl = `https://www.instagram.com${postPath}`;
      logIg(`🔍 Extraindo engajamento do Post ${i+1}/${newPostLinks.length}...`);
      await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3000 + Math.random() * 2000);

      // Tenta fechar qualquer modal de login que possa ter aparecido
      await page.evaluate(() => {
        const closeBtn = document.querySelector('div[role="dialog"] button svg[aria-label="Close"]');
        if (closeBtn) (closeBtn.closest('button') as HTMLElement)?.click();
      }).catch(()=>{});

      // Extrair Comentadores (+20 pontos)
      // Carregar mais comentários clicando no botão (se existir)
      await page.evaluate(async () => {
        let attempts = 0;
        while (attempts < 50) {
          const svgs = Array.from(document.querySelectorAll('svg[aria-label="Carregar mais comentários"], svg[aria-label="Load more comments"]'));
          const spans = Array.from(document.querySelectorAll('span, div[role="button"]')).filter(el => {
            const text = el.textContent?.toLowerCase().trim() || '';
            return text === 'ver mais comentários' || text === 'load more comments' || text === 'carregar mais comentários';
          });
          const loadMoreBtn = svgs.length > 0 ? svgs[0] : spans.length > 0 ? spans[0] : null;
          
          if (!loadMoreBtn) break;
          const clickable = loadMoreBtn.closest('button') || loadMoreBtn.closest('[role="button"]') || loadMoreBtn.closest('a') || loadMoreBtn;
          try { (clickable as HTMLElement).click(); } catch(e){}
          await new Promise(r => setTimeout(r, 2000));
          attempts++;
        }
      });

      const commenters = await page.evaluate(() => {
        const results: {username: string, fullName: string}[] = [];
        const seen = new Set();
        const commentLinks = document.querySelectorAll('main a, article a');
        commentLinks.forEach(link => {
          const href = link.getAttribute('href') || '';
          const match = href.match(/^\/([^/]+)\/$/);
          if (match && match[1] !== 'explore' && match[1] !== 'p' && match[1] !== 'reel' && match[1] !== 'accounts') {
            const uname = match[1];
            if (!seen.has(uname)) {
              seen.add(uname);
              // Tenta extrair o nome real: o elemento pai do link geralmente tem um span com o nome
              let fullName = uname;
              try {
                // Sobe até 4 níveis procurando um span que seja o nome (diferente do username)
                let el: HTMLElement | null = link.parentElement;
                for (let d = 0; d < 4 && el; d++) {
                  const spans = el.querySelectorAll('span');
                  for (const span of Array.from(spans)) {
                    const text = (span.textContent || '').trim();
                    if (text && text.toLowerCase() !== uname.toLowerCase() && !text.startsWith('@') && text.length > 1 && text.length < 80 && !/^[0-9]+$/.test(text)) {
                      fullName = text;
                      break;
                    }
                  }
                  if (fullName !== uname) break;
                  el = el.parentElement;
                }
              } catch {}
              results.push({ username: uname, fullName });
            }
          }
        });
        return results;
      });

      let commentCount = 0;
      for (const c of commenters) {
        if (state.sessionLeadsCount >= LIMIT_PER_SESSION && !state.seenUsernames.has(c.username)) continue;
        saveLead(c.username, c.fullName, 20);
        commentCount++;
      }
      if (commentCount > 0) logIg(`💬 Analisados ${commentCount} comentadores (Score +20).`);

      let likesOpened = false;
      const likesLink = await page.$('a[href*="/liked_by/"]');
      if (likesLink) {
        await likesLink.click();
        likesOpened = true;
      } else {
        likesOpened = await page.evaluate(() => {
          // Localiza o ícone de Curtir (coração)
          const svg = document.querySelector('svg[aria-label="Curtir"], svg[aria-label="Descurtir"], svg[aria-label="Like"], svg[aria-label="Unlike"]');
          if (svg) {
            // Sobe para o contêiner dos botões (section ou div)
            const parent = svg.closest('section') || svg.closest('div');
            if (parent) {
              // Seleciona todos os elementos de texto/botões dentro desse bloco
              const targets = Array.from(parent.querySelectorAll('a, button, span[role="button"], div[role="button"], span'));
              for (const target of targets) {
                const text = target.textContent?.trim() || '';
                // Se contiver o número de curtidas (ex: "702" ou "702 curtidas")
                if (/^[0-9.,]+\s*(mi|mil|k|m|curtidas|likes)?$/i.test(text)) {
                  // Clica diretamente no target (span) ou no link 'a', evitando o botão geral de curtir
                  const clickable = target.closest('a') || target;
                  (clickable as HTMLElement).click();
                  return true;
                }
              }
            }
          }
          return false;
        });
      }

      if (likesOpened) {
        await page.waitForTimeout(3000);

        let scrollAttempts = 0;
        let noNewLikes = 0;
        const modalSeen = new Set<string>();
        
        while (scrollAttempts < 300 && state.sessionLeadsCount < LIMIT_PER_SESSION) {
          if (igScraperStopRequested) break;

          const newLikes = await page.evaluate(() => {
            const results: {username: string, fullName: string}[] = [];
            
            // Localiza o modal real de curtidas escolhendo o dialog que tem o maior número de botões de Seguir
            const dialog = Array.from(document.querySelectorAll('div[role="dialog"]')).sort((a, b) => {
              const countA = Array.from(a.querySelectorAll('button')).filter(btn => {
                const text = btn.textContent?.toLowerCase().trim() || '';
                return text === 'seguir' || text === 'seguindo' || text === 'follow' || text === 'following';
              }).length;
              const countB = Array.from(b.querySelectorAll('button')).filter(btn => {
                const text = btn.textContent?.toLowerCase().trim() || '';
                return text === 'seguir' || text === 'seguindo' || text === 'follow' || text === 'following';
              }).length;
              return countB - countA;
            })[0];

            if (!dialog) return results;

            const links = dialog.querySelectorAll('a');
            links.forEach(link => {
              const href = link.getAttribute('href') || '';
              const match = href.match(/^\/([^/]+)\/$/);
              if (match && match[1] !== 'explore' && match[1] !== 'accounts' && match[1] !== 'p' && match[1] !== 'reel') {
                const username = match[1];
                const container = link.closest('div[role="button"]')?.parentElement || link.parentElement;
                const spans = container?.querySelectorAll('span') || [];
                let fullName = username;
                for (const span of Array.from(spans)) {
                  const text = span.textContent?.trim() || '';
                  if (text && text !== username && text.length > 1 && text.length < 80) {
                    fullName = text; break;
                  }
                }
                results.push({ username, fullName });
              }
            });
            
            // Executa scroll combinando scrollTop e scrollIntoView para garantir carregamento
            const scrollable = Array.from(dialog.querySelectorAll('div')).find(div => {
              const style = window.getComputedStyle(div);
              return (style.overflowY === 'auto' || style.overflowY === 'scroll') && div.scrollHeight > div.clientHeight;
            });
            if (scrollable) {
              scrollable.scrollTop = scrollable.scrollHeight;
            }
            if (links.length > 0) {
              links[links.length - 1].scrollIntoView();
            }
            return results;
          });

          let addedToModal = 0;
          for (const l of newLikes) {
            if (!modalSeen.has(l.username)) {
              modalSeen.add(l.username);
              addedToModal++;
            }
            if (state.sessionLeadsCount >= LIMIT_PER_SESSION && !state.seenUsernames.has(l.username)) continue;
            saveLead(l.username, l.fullName, 10);
          }

          if (addedToModal > 0) {
            noNewLikes = 0;
          } else {
            noNewLikes++;
            if (noNewLikes >= 5) break;
          }

          await page.waitForTimeout(1500 + Math.random() * 1000);
          scrollAttempts++;
        }
        
        // Salva este post como processado no banco de dados para evitar reabrí-lo no futuro
        try {
          db.prepare("INSERT OR REPLACE INTO ig_posts_processados (post_url, target_username) VALUES (?, ?)")
            .run(postPath, targetUsername);
        } catch (e) {}

        logIg(`❤️ Analisados ${modalSeen.size} curtidores. Progresso de leads INÉDITOS na sessão: ${state.sessionLeadsCount}/${LIMIT_PER_SESSION}.`);
      } else {
        logIg(`⚠️ Não foi possível abrir lista de curtidas do post ${i+1}.`);
      }
    } catch (err: any) {
      logIg(`❌ Erro ao processar o post ${i+1}: ${err.message}`);
    }
  }
}

// ── Endpoint: Obter Estado de Extração ────────────────────────────────────
router.get("/scrape-state/:username", (req, res) => {
  try {
    const { username } = req.params;
    const cleanUser = username.replace("@", "").trim();
    const state = db.prepare("SELECT next_max_id FROM ig_scraping_state WHERE target_username = ?").get(cleanUser) as any;
    res.json({ hasState: !!state, maxId: state?.next_max_id || null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Rota de Profile Scraper (com Seguidores) ────────────────────────────────────
router.post("/scrape-profile", async (req, res) => {
  if (igScraperRunning) return res.status(400).json({ message: "Outra extração do IG já está rodando." });

  const { targetUsername, resume } = req.body;
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
    
    // Atualiza a data da última extração imediatamente (tempo real) para aparecer no topo
    try {
      db.prepare(`UPDATE ig_perfis SET criado_em = CURRENT_TIMESTAMP, atualizado_em = CURRENT_TIMESTAMP WHERE username = ?`).run(targetUsername);
    } catch(e) {}
    
    let resumeMaxId: string | undefined = undefined;
    if (resume) {
      const state = db.prepare("SELECT next_max_id FROM ig_scraping_state WHERE target_username = ?").get(targetUsername) as any;
      if (state && state.next_max_id) {
        resumeMaxId = state.next_max_id;
        logIg(`🔄 Retomando extração incremental a partir do cursor salvo: ${resumeMaxId.substring(0, 8)}...`);
      }
    }

    // Só captura o perfil principal se não for uma retomada (evitar spam)
    if (!resumeMaxId) {
      const mainProfile = await scrapeProfileData(page, targetUsername);
      if (mainProfile) {
        logIg(`✅ Perfil capturado! Seguidores: ${mainProfile.seguidores} | Email: ${mainProfile.email_extraido || 'Não'}`);
      let error: any = null;
      try {
        db.prepare(`INSERT INTO ig_perfis (username, nome_completo, bio, seguidores, seguindo, posts, telefone_extraido, link_bio, email_extraido, is_business, is_private, perfil_pai) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET nome_completo=excluded.nome_completo, seguidores=excluded.seguidores, telefone_extraido=excluded.telefone_extraido, email_extraido=excluded.email_extraido, criado_em=CURRENT_TIMESTAMP, atualizado_em=CURRENT_TIMESTAMP`)
        .run(mainProfile.username, mainProfile.nome_completo, mainProfile.bio, mainProfile.seguidores, 0, mainProfile.posts, mainProfile.telefone_extraido, mainProfile.link_bio, mainProfile.email_extraido, mainProfile.is_business ? 1 : 0, mainProfile.is_private ? 1 : 0, null);
      } catch(e) { error = e; }
      if (error) logIg(`⚠️ Erro ao salvar perfil principal: ${error.message}`);
      else logIg(`💾 Perfil principal salvo no SQLite.`);

      try { db.prepare("INSERT INTO ig_buscas (tipo_busca, alvo, total_capturado) VALUES (?, ?, ?)").run('PROFILE', `@${targetUsername}`, 1); } catch(e){}
      } else {
        logIg(`❌ Não foi possível extrair dados de @${targetUsername}. Conta pode ser privada.`);
        try {
          db.prepare(`INSERT OR IGNORE INTO ig_perfis (username, nome_completo, bio, seguidores, seguindo, posts, telefone_extraido, link_bio, email_extraido, is_business, is_private, perfil_pai) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(targetUsername, targetUsername, "", 0, 0, 0, null, null, null, 0, 1, null);
        } catch(e) {}
      }
    }

    // ── PAUSA ENTRE FASES (Anti-Detecção) ─────────────────────────────────────
    const pausaEntreFases = 30000 + Math.random() * 30000; // 30-60s
    logIg(`😴 Pausa entre fases (${(pausaEntreFases / 1000).toFixed(0)}s) para simular comportamento humano...`);
    await page.waitForTimeout(pausaEntreFases);
    
    // ── FASE 2: Busca Inteligente Sequencial (Feed -> Reels -> Marcados) ────
    logIg(`══════ FASE 2: Engajamento (Busca Inteligente Multi-Abas) ══════`);
    logIg(`(Focando 100% em engajamento: Feed Principal, Reels e Marcados)`);
    
    const scrapingState = {
      sessionLeadsCount: 0,
      seenUsernames: new Set<string>(),
      seenPostLinks: new Set<string>(),
      leads: [] as any[]
    };

    const tabsToScrape = [
      { name: "Feed Principal (Posts/Collabs)", url: `https://www.instagram.com/${targetUsername}/` },
      { name: "Aba Reels", url: `https://www.instagram.com/${targetUsername}/reels/` },
      { name: "Aba Marcados (Tagged)", url: `https://www.instagram.com/${targetUsername}/tagged/` }
    ];

    for (const tab of tabsToScrape) {
      if (igScraperStopRequested) break;
      if (scrapingState.sessionLeadsCount >= 3000) break;
      
      logIg(`🚀 Iniciando varredura na aba: ${tab.name}`);
      await getLikersAndCommenters(page, targetUsername, tab.url, scrapingState);
      
      if (scrapingState.sessionLeadsCount < 3000 && tab !== tabsToScrape[tabsToScrape.length - 1]) {
        const pausaAba = 15000 + Math.random() * 15000;
        logIg(`😴 Pausa antes de mudar de aba (${(pausaAba / 1000).toFixed(0)}s)...`);
        await page.waitForTimeout(pausaAba);
      }
    }

    if (scrapingState.leads.length === 0) {
      logIg(`Nenhum contato engajado novo extraído nesta sessão.`);
    } else {
      logIg(`✅ Todos os contatos de engajamento foram salvos progressivamente no banco de dados com suas pontuações!`);
    }

    logIg(`══════════════════════════════════════════`);
    logIg(`✅ Extração completa! 1 perfil principal + ${scrapingState.sessionLeadsCount} leads capturados na sessão.`);

    try { db.prepare("INSERT INTO ig_buscas (tipo_busca, alvo, total_capturado) VALUES (?, ?, ?)").run('FOLLOWERS_SCRAPE_FAST', `@${targetUsername}`, scrapingState.sessionLeadsCount); } catch(e){}

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

  const { targets, template, likePosts } = req.body;
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
  const modoWarmup = likePosts ? " [❤️ Warm-up de curtidas ATIVO]" : "";
  res.json({ message: `Iniciando disparo para ${targets.length} perfis...${modoWarmup}`, running: true });

  let browser: Browser | null = null;

  try {
    logIg(`Iniciando motor Chromium Stealth para DMs...${modoWarmup}`);
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

      // 1. Buscar nome real navegando pelo perfil (via interceptação da API do Instagram)
      // Verifica primeiro se já há um nome real no banco (diferente do username)
      const userData = db.prepare("SELECT nome_completo FROM ig_perfis WHERE username = ? LIMIT 1").get(username) as any;
      const cachedName = userData?.nome_completo?.trim();
      const hasRealName = cachedName && cachedName.toLowerCase() !== username.toLowerCase() && !cachedName.includes('.')  && !cachedName.includes('_');
      
      let nomeCompleto: string;
      if (hasRealName) {
        const firstName = cachedName.split(" ")[0];
        nomeCompleto = firstName.charAt(0).toUpperCase() + firstName.slice(1);
        logIg(`📋 Nome real do banco: "${nomeCompleto}" para @${username}`);
      } else {
        logIg(`🔍 Buscando nome real de @${username} no perfil...`);
        nomeCompleto = await fetchRealName(page, username);
      }

      // 1b. Warm-up: curtir posts antes da DM (se opt-in ativado)
      if (likePosts && !igScraperStopRequested) {
        await likeProfilePosts(page, username);
      }

      // 2. Navigate to New Message directly
      logIg(`Abrindo a tela de Nova Mensagem para @${username}...`);
      await page.goto(`https://www.instagram.com/direct/new/`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3000 + Math.random() * 2000);

      // Dismiss popups se aparecerem
      try {
        const agoraNaoBtn = await page.waitForSelector(`xpath=//button[contains(., 'Agora não') or contains(., 'Not Now') or contains(., 'agora não')] | //div[@role="button" and (contains(., 'Agora não') or contains(., 'Not Now'))]`, { timeout: 5000 });
        if (agoraNaoBtn) { logIg(`Fechando popup...`); await agoraNaoBtn.click(); await page.waitForTimeout(1000); }
      } catch (e) {}

      // 3. Search for the user
      logIg(`Buscando @${username} na lista de contatos...`);
      try {
        const searchInput = await page.waitForSelector('input[name="queryBox"], input[placeholder*="esquisa"], input[placeholder*="earch"], input[type="text"]', { timeout: 15000 });
        if (searchInput) {
          await searchInput.click();
          await humanDelay(300, 800);
          await humanType(page, username);
          await humanDelay(3000, 4500);
        } else {
          throw new Error("Campo de busca não encontrado.");
        }
        
        // 4. Click the search result
        logIg(`Selecionando @${username}...`);
        const userResult = await page.waitForSelector(`xpath=//span[translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')="${username.toLowerCase()}"]/ancestor::div[@role="button"] | //span[translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')="${username.toLowerCase()}"]`, { timeout: 10000 });
        if (userResult) {
          await userResult.click();
          await page.waitForTimeout(1000);
        } else {
          throw new Error("Usuário não encontrado na busca.");
        }
        
        // 5. Clica em Bate-papo / Avançar se necessário
        logIg(`Iniciando o chat com @${username}...`);
        const nextBtn = await page.waitForSelector(`xpath=//div[@role="button" and (contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'bate-papo') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'chat') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'avan') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'next'))]`, { timeout: 3000 }).catch(() => null);
        if (nextBtn) { await nextBtn.click(); }
      } catch (e: any) {
        logIg(`❌ Falha ao buscar/iniciar chat com @${username}: ${e.message}`);
        continue;
      }

      // 6. Wait for chat box to load
      await page.waitForTimeout(4000 + Math.random() * 2000); // 4-6s

      // Replace variables after extraction
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
      
      try {
        // Encontra o input de texto (a textarea com placeholder de "Mensagem...")
        logIg(`Procurando campo de texto do chat...`);
        const messageInput = await page.waitForSelector('div[role="textbox"][contenteditable="true"]', { timeout: 15000 });
        
        if (messageInput) {
          await messageInput.click();
          await page.waitForTimeout(500 + Math.random() * 1000);
          
          logIg(`Digitando mensagem simulando humano (suportando parágrafos)...`);
          const paragraphs = message.split(/\r?\n/);
          for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
            const paragraph = paragraphs[pIdx];
            if (paragraph) {
              await humanType(page, paragraph);
            }
            if (pIdx < paragraphs.length - 1) {
              await page.keyboard.down('Shift');
              await page.keyboard.press('Enter');
              await page.keyboard.up('Shift');
              await humanDelay(150, 400);
            }
          }
          await humanDelay(1000, 2500);

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
          
          // Incrementa o contador de mensagens enviadas para este perfil
          try {
            db.prepare("UPDATE ig_perfis SET dm_enviado = dm_enviado + 1 WHERE username = ?").run(username);
            logIg(`💾 Contador de DMs incrementado no banco para @${username}`);
          } catch (dbErr) {
            logIg(`⚠️ Erro ao incrementar contador de DM no banco para @${username}`);
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
    const stmt = db.prepare("UPDATE ig_leads SET dm_enviado = dm_enviado + 1 WHERE username = ?");
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

  const { targets, template, likePosts } = req.body;
  if (!targets || !Array.isArray(targets) || targets.length === 0) return res.status(400).json({ error: "Nenhum alvo informado." });
  if (!template) return res.status(400).json({ error: "Mensagem vazia." });

  const sessionData = db.prepare("SELECT session_cookie FROM ig_sessoes WHERE is_active = 1 LIMIT 1").get() as any;
  if (!sessionData || !sessionData.session_cookie) return res.status(401).json({ error: "Nenhuma sessão ativa." });

  igDmRunning = true;
  igScraperRunning = true;
  igScraperStopRequested = false;
  igScraperLog = [];
  const modoWarmupLeads = likePosts ? " [❤️ Warm-up de curtidas ATIVO]" : "";
  res.json({ message: `Iniciando disparo para ${targets.length} leads...${modoWarmupLeads}`, running: true });

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

      // 1. Buscar nome real navegando pelo perfil (via interceptação da API do Instagram)
      const leadsData = db.prepare("SELECT nome_completo FROM ig_leads WHERE username = ? LIMIT 1").get(username) as any;
      // Também tenta na tabela ig_perfis como fallback
      const perfisData = !leadsData ? db.prepare("SELECT nome_completo FROM ig_perfis WHERE username = ? LIMIT 1").get(username) as any : null;
      const anyRecord = leadsData || perfisData;
      const cachedName = anyRecord?.nome_completo?.trim();
      const hasRealName = cachedName && cachedName.toLowerCase() !== username.toLowerCase() && !cachedName.includes('.') && !cachedName.includes('_');
      
      let nomeCompleto: string;
      if (hasRealName) {
        const firstName = cachedName.split(" ")[0];
        nomeCompleto = firstName.charAt(0).toUpperCase() + firstName.slice(1);
        logIg(`📋 Nome real do banco: "${nomeCompleto}" para @${username}`);
      } else {
        logIg(`🔍 Buscando nome real de @${username} no perfil...`);
        nomeCompleto = await fetchRealName(page, username);
      }

      // 1b. Warm-up: curtir posts antes da DM (se opt-in ativado)
      if (likePosts && !igScraperStopRequested) {
        await likeProfilePosts(page, username);
      }

      await page.goto(`https://www.instagram.com/direct/new/`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3000 + Math.random() * 2000);

      try {
        const agoraNaoBtn = await page.waitForSelector(`xpath=//button[contains(., 'Agora não') or contains(., 'Not Now') or contains(., 'agora não')] | //div[@role="button" and (contains(., 'Agora não') or contains(., 'Not Now'))]`, { timeout: 5000 });
        if (agoraNaoBtn) { await agoraNaoBtn.click(); await page.waitForTimeout(1000); }
      } catch (e) {}

      try {
        const searchInput = await page.waitForSelector('input[name="queryBox"], input[placeholder*="esquisa"], input[placeholder*="earch"], input[type="text"]', { timeout: 15000 });
        if (searchInput) {
          await searchInput.click();
          await humanDelay(300, 800);
          await humanType(page, username);
          await humanDelay(3000, 4500);
        } else throw new Error("Campo de busca não encontrado.");
        
        const userResult = await page.waitForSelector(`xpath=//span[translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')="${username.toLowerCase()}"]/ancestor::div[@role="button"] | //span[translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')="${username.toLowerCase()}"]`, { timeout: 10000 });
        if (userResult) { 
          await userResult.click(); 
          await page.waitForTimeout(1000); 
        } else {
          throw new Error("Usuário não encontrado.");
        }
        
        const nextBtn = await page.waitForSelector(`xpath=//div[@role="button" and (contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'bate-papo') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'chat') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'avan') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'next'))]`, { timeout: 3000 }).catch(() => null);
        if (nextBtn) await nextBtn.click();
      } catch (e: any) {
        logIg(`❌ Falha ao buscar/iniciar chat: ${e.message}`);
        continue;
      }

      await page.waitForTimeout(4000 + Math.random() * 2000);

      // Prepara a mensagem com o nome correto (já capturado acima)
      let message = template.replace(/{nome}/g, nomeCompleto).replace(/{username}/g, `@${username}`);
      logIg(`💬 Mensagem preparada com nome "${nomeCompleto}" para @${username}`);

      // Antifingerprinting
      const extraSpaces = " ".repeat(Math.floor(Math.random() * 3));
      const endChar = Math.random() > 0.7 ? "." : "";
      if (Math.random() > 0.5 && message.length > 5) {
        const insertPos = Math.floor(message.length / 2);
        message = message.slice(0, insertPos) + '\u200B' + message.slice(insertPos);
      }
      message = message + extraSpaces + endChar;
      
      try {
        const messageInput = await page.waitForSelector('div[role="textbox"][contenteditable="true"]', { timeout: 15000 });
        if (messageInput) {
          await messageInput.click();
          await page.waitForTimeout(500 + Math.random() * 1000);
          const paragraphs = message.split(/\r?\n/);
          for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
            const paragraph = paragraphs[pIdx];
            if (paragraph) {
              await humanType(page, paragraph);
            }
            if (pIdx < paragraphs.length - 1) {
              await page.keyboard.down('Shift');
              await page.keyboard.press('Enter');
              await page.keyboard.up('Shift');
              await humanDelay(150, 400);
            }
          }
          await humanDelay(1000, 2500);
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
            // Incrementa o contador de mensagens enviadas para este lead
            try { db.prepare("UPDATE ig_leads SET dm_enviado = dm_enviado + 1 WHERE username = ?").run(username); } catch(e) {}
            try { db.prepare("UPDATE ig_perfis SET dm_enviado = dm_enviado + 1 WHERE username = ?").run(username); } catch(e) {}
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
          ON CONFLICT(username) DO UPDATE SET nome_completo=excluded.nome_completo, criado_em=CURRENT_TIMESTAMP`)
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
