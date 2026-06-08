// ══════════════════════════════════════════════════════════════════════════════
// stealth-utils.ts — Motor Anti-Detecção Compartilhado
// Usado por server-ig.ts e server-gmaps.ts
// ══════════════════════════════════════════════════════════════════════════════

import dotenv from "dotenv";
dotenv.config();

// ── Pool de User-Agents Atualizados (2025-2026) ────────────────────────────────
const USER_AGENTS = [
  // Chrome Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  // Chrome Mac
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  // Edge Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
  // Firefox Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
  // Firefox Mac
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0",
];

// ── Viewports Comuns com Variação ───────────────────────────────────────────────
const BASE_VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
  { width: 1680, height: 1050 },
];

// ── WebGL Renderer/Vendor Pairs (comuns em máquinas reais) ──────────────────────
const WEBGL_CONFIGS = [
  { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) HD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
];

// ══════════════════════════════════════════════════════════════════════════════
// FUNÇÕES EXPORTADAS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Retorna um User-Agent aleatório do pool atualizado
 */
export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Retorna um viewport com variação realista (±10px)
 */
export function getRandomViewport(): { width: number; height: number } {
  const base = BASE_VIEWPORTS[Math.floor(Math.random() * BASE_VIEWPORTS.length)];
  return {
    width: base.width + Math.floor(Math.random() * 21) - 10,  // ±10
    height: base.height + Math.floor(Math.random() * 21) - 10, // ±10
  };
}

/**
 * Gera um device_scale_factor realista (1 ou 2, com 70% de chance de ser 1)
 */
export function getRandomDeviceScale(): number {
  return Math.random() < 0.7 ? 1 : 2;
}

/**
 * Extrai a versão do Chrome do User-Agent para construir Sec-Ch-Ua correto
 */
function extractChromeVersion(ua: string): string | null {
  const match = ua.match(/Chrome\/([\d]+)/);
  return match ? match[1] : null;
}

/**
 * Gera headers HTTP realistas baseados no User-Agent fornecido
 */
export function getRealisticHeaders(userAgent: string): Record<string, string> {
  const chromeVersion = extractChromeVersion(userAgent);
  const isEdge = userAgent.includes("Edg/");
  const isFirefox = userAgent.includes("Firefox/");

  const headers: Record<string, string> = {
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  };

  if (chromeVersion && !isFirefox) {
    if (isEdge) {
      headers["Sec-Ch-Ua"] = `"Microsoft Edge";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not-A.Brand";v="99"`;
    } else {
      headers["Sec-Ch-Ua"] = `"Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}", "Not-A.Brand";v="99"`;
    }
    headers["Sec-Ch-Ua-Mobile"] = "?0";
    headers["Sec-Ch-Ua-Platform"] = userAgent.includes("Macintosh") ? '"macOS"' : '"Windows"';
    headers["Sec-Fetch-Dest"] = "document";
    headers["Sec-Fetch-Mode"] = "navigate";
    headers["Sec-Fetch-Site"] = "none";
    headers["Sec-Fetch-User"] = "?1";
    headers["Upgrade-Insecure-Requests"] = "1";
  }

  return headers;
}

/**
 * Delay humanizado com distribuição gaussiana (mais realista que uniform)
 * @param minMs - Mínimo em ms
 * @param maxMs - Máximo em ms
 */
export function humanDelay(minMs: number, maxMs: number): Promise<void> {
  // Box-Muller transform para distribuição gaussiana centrada no meio do range
  const u1 = Math.random();
  const u2 = Math.random();
  const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

  const mean = (minMs + maxMs) / 2;
  const stdDev = (maxMs - minMs) / 6; // 99.7% dentro do range
  let delay = mean + gaussian * stdDev;

  // Clamp ao range
  delay = Math.max(minMs, Math.min(maxMs, delay));

  return new Promise(resolve => setTimeout(resolve, Math.floor(delay)));
}

/**
 * Micro-pausa aleatória (para inserir entre sub-ações)
 */
export function microPause(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 800));
}

/**
 * Pausa de descanso longa (para inserir entre blocos de trabalho)
 */
export function restPause(): Promise<void> {
  const delay = 60000 + Math.random() * 60000; // 60-120 segundos
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Retorna uma configuração WebGL aleatória
 */
function getRandomWebGL(): { vendor: string; renderer: string } {
  return WEBGL_CONFIGS[Math.floor(Math.random() * WEBGL_CONFIGS.length)];
}

/**
 * Gera o InitScript completo de stealth para injetar no contexto do navegador.
 * Cobre TODOS os pontos de fingerprinting conhecidos.
 */
export function getStealthInitScript(): () => void {
  // Os valores são gerados AQUI (no Node.js) para serem consistentes em toda a sessão
  const webgl = getRandomWebGL();
  const hardwareConcurrency = [4, 6, 8, 12, 16][Math.floor(Math.random() * 5)];
  const deviceMemory = [4, 8, 16][Math.floor(Math.random() * 3)];
  const canvasNoiseSeed = Math.random();

  // Retorna uma closure que captura os valores gerados
  const vendor = webgl.vendor;
  const renderer = webgl.renderer;

  return function stealthScript() {
    // ═══ 1. navigator.webdriver ═══
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });

    // Deletar a propriedade se ela existir como data descriptor
    try { delete (navigator as any).__proto__.webdriver; } catch (e) {}

    // ═══ 2. navigator.plugins (PluginArray realista) ═══
    const makePlugin = (name: string, desc: string, filename: string) => {
      const plugin: any = { name, description: desc, filename, length: 1 };
      plugin[0] = { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format" };
      Object.setPrototypeOf(plugin, Plugin.prototype);
      return plugin;
    };

    const pluginArray = [
      makePlugin("Chrome PDF Plugin", "Portable Document Format", "internal-pdf-viewer"),
      makePlugin("Chrome PDF Viewer", "", "mhjfbmdgcfjbbpaeojofohoefgiehjai"),
      makePlugin("Native Client", "", "internal-nacl-plugin"),
    ];
    Object.setPrototypeOf(pluginArray, PluginArray.prototype);
    Object.defineProperty(navigator, "plugins", { get: () => pluginArray });

    // ═══ 3. navigator.mimeTypes ═══
    const mimeTypes: any = [
      { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format", enabledPlugin: pluginArray[0] }
    ];
    Object.setPrototypeOf(mimeTypes, MimeTypeArray.prototype);
    Object.defineProperty(navigator, "mimeTypes", { get: () => mimeTypes });

    // ═══ 4. navigator.languages ═══
    Object.defineProperty(navigator, "languages", { get: () => ["pt-BR", "pt", "en-US", "en"] });

    // ═══ 5. chrome object ═══
    const w = window as any;
    if (!w.chrome) {
      w.chrome = {};
    }
    w.chrome.runtime = w.chrome.runtime || {
      OnInstalledReason: {},
      OnRestartRequiredReason: {},
      PlatformArch: {},
      PlatformNaclArch: {},
      PlatformOs: {},
      RequestUpdateCheckStatus: {},
      connect: function() {},
      sendMessage: function() {},
    };
    w.chrome.loadTimes = w.chrome.loadTimes || function() {
      return {
        commitLoadTime: Date.now() / 1000,
        connectionInfo: "h2",
        finishDocumentLoadTime: Date.now() / 1000,
        finishLoadTime: Date.now() / 1000,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000,
        navigationType: "Other",
        npnNegotiatedProtocol: "h2",
        requestTime: Date.now() / 1000 - 0.3,
        startLoadTime: Date.now() / 1000 - 0.5,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
      };
    };
    w.chrome.csi = w.chrome.csi || function() {
      return { onloadT: Date.now(), pageT: Date.now() / 1000, startE: Date.now(), tran: 15 };
    };
    w.chrome.app = w.chrome.app || { isInstalled: false, InstallState: { INSTALLED: "installed", NOT_INSTALLED: "not_installed" }, RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" } };

    // ═══ 6. Permissions API ═══
    const origQuery = (navigator as any).permissions?.query?.bind((navigator as any).permissions);
    if (origQuery) {
      (navigator as any).permissions.query = (parameters: any) =>
        parameters.name === "notifications"
          ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
          : origQuery(parameters);
    }

    // ═══ 7. WebGL Vendor/Renderer Spoofing ═══
    const getParameterProto = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param: number) {
      // UNMASKED_VENDOR_WEBGL = 0x9245, UNMASKED_RENDERER_WEBGL = 0x9246
      if (param === 0x9245) return (arguments as any).__vendor || vendor;
      if (param === 0x9246) return (arguments as any).__renderer || renderer;
      return getParameterProto.apply(this, arguments as any);
    };

    // WebGL2
    if (typeof WebGL2RenderingContext !== "undefined") {
      const getParameterProto2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(param: number) {
        if (param === 0x9245) return vendor;
        if (param === 0x9246) return renderer;
        return getParameterProto2.apply(this, arguments as any);
      };
    }

    // ═══ 8. Canvas Fingerprint Noise ═══
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type?: string, quality?: any) {
      const context = this.getContext("2d");
      if (context && this.width > 0 && this.height > 0) {
        try {
          const imageData = context.getImageData(0, 0, Math.min(this.width, 10), Math.min(this.height, 10));
          for (let i = 0; i < imageData.data.length; i += 4) {
            // Adiciona ruído imperceptível (±1) baseado em seed fixa por sessão
            const noise = ((canvasNoiseSeed * (i + 1) * 0.1) % 1) > 0.5 ? 1 : -1;
            imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + noise));
          }
          context.putImageData(imageData, 0, 0);
        } catch (e) { /* SecurityError em cross-origin canvas, ignorar */ }
      }
      return origToDataURL.apply(this, [type, quality]);
    };

    // ═══ 9. navigator.hardwareConcurrency ═══
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => hardwareConcurrency });

    // ═══ 10. navigator.deviceMemory ═══
    Object.defineProperty(navigator, "deviceMemory", { get: () => deviceMemory });

    // ═══ 11. navigator.connection ═══
    if (!(navigator as any).connection) {
      Object.defineProperty(navigator, "connection", {
        get: () => ({
          effectiveType: "4g",
          rtt: 50 + Math.floor(Math.random() * 50),
          downlink: 8 + Math.random() * 5,
          saveData: false,
          type: "wifi",
        }),
      });
    }

    // ═══ 12. window.outerWidth/outerHeight (simular chrome toolbar) ═══
    Object.defineProperty(window, "outerWidth", { get: () => window.innerWidth });
    Object.defineProperty(window, "outerHeight", { get: () => window.innerHeight + 85 }); // 85px = chrome toolbar

    // ═══ 13. Prevenir detecção via Function.toString ═══
    const nativeToString = Function.prototype.toString;
    const customFunctions = new Set<Function>();

    const patchToString = (fn: Function, nativeName: string) => {
      customFunctions.add(fn);
      const originalToString = fn.toString;
      (fn as any).toString = function() {
        if (customFunctions.has(this)) {
          return `function ${nativeName}() { [native code] }`;
        }
        return nativeToString.call(this);
      };
    };

    // Patch the overridden functions to look native
    patchToString(WebGLRenderingContext.prototype.getParameter, "getParameter");
    patchToString(HTMLCanvasElement.prototype.toDataURL, "toDataURL");

    // ═══ 14. Notification.permission ═══
    try {
      Object.defineProperty(Notification, "permission", { get: () => "default" });
    } catch (e) {}

    // ═══ 15. AudioContext fingerprint (normalize) ═══
    try {
      const origCreateOscillator = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function() {
        const osc = origCreateOscillator.apply(this, arguments as any);
        // Adicionar micro-variação na frequência para alterar o fingerprint
        const origFreqValue = osc.frequency.value;
        try {
          osc.frequency.value = origFreqValue + (canvasNoiseSeed * 0.001);
        } catch (e) {}
        return osc;
      };
    } catch (e) {}
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// DETECÇÃO DE BLOQUEIO
// ══════════════════════════════════════════════════════════════════════════════

export interface BlockDetectionResult {
  isBlocked: boolean;
  reason: string | null;
  severity: "none" | "warning" | "critical";
}

/**
 * Verifica se a página atual indica um bloqueio/CAPTCHA/desafio
 */
export async function detectBlock(page: any): Promise<BlockDetectionResult> {
  try {
    const pageUrl = page.url();
    const title = await page.title().catch(() => "");
    const titleLow = title.toLowerCase();

    // Instagram: login redirect
    if (pageUrl.includes("/accounts/login/") && !pageUrl.includes("accounts/login/?next")) {
      return { isBlocked: true, reason: "Redirecionado para login (sessão expirada)", severity: "critical" };
    }

    // Instagram: challenge / suspicious login
    if (pageUrl.includes("/challenge/") || pageUrl.includes("/checkpoint/")) {
      return { isBlocked: true, reason: "Desafio de segurança / checkpoint detectado", severity: "critical" };
    }

    // Instagram: consent required
    if (pageUrl.includes("/consent/")) {
      return { isBlocked: true, reason: "Consent page detectada", severity: "warning" };
    }

    // Google: CAPTCHA
    if (titleLow.includes("unusual traffic") || titleLow.includes("sorry") || titleLow.includes("captcha")) {
      return { isBlocked: true, reason: "Google CAPTCHA / tráfego incomum detectado", severity: "critical" };
    }

    // Cloudflare
    if (titleLow.includes("just a moment") || titleLow.includes("attention required") || titleLow.includes("cloudflare")) {
      return { isBlocked: true, reason: "Cloudflare challenge detectado", severity: "critical" };
    }

    // Generic rate limiting
    if (titleLow.includes("rate limit") || titleLow.includes("too many requests")) {
      return { isBlocked: true, reason: "Rate limit atingido", severity: "critical" };
    }

    // DOM check para CAPTCHA elements
    const hasCaptcha = await page.evaluate(() => {
      return !!(
        document.querySelector("#captcha-form") ||
        document.querySelector(".g-recaptcha") ||
        document.querySelector("#recaptcha") ||
        document.querySelector("[data-sitekey]") ||
        document.querySelector("iframe[src*='recaptcha']") ||
        document.querySelector("iframe[src*='captcha']")
      );
    }).catch(() => false);

    if (hasCaptcha) {
      return { isBlocked: true, reason: "Elemento de CAPTCHA detectado no DOM", severity: "critical" };
    }

    return { isBlocked: false, reason: null, severity: "none" };
  } catch (e) {
    return { isBlocked: false, reason: null, severity: "none" };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGGING DETALHADO DE HTTP
// ══════════════════════════════════════════════════════════════════════════════

export interface HttpLogEntry {
  timestamp: string;
  url: string;
  status: number;
  method: string;
  duration?: number;
  isError: boolean;
  isRateLimit: boolean;
  isRedirect: boolean;
}

/**
 * Configura interceptação de respostas HTTP para logging detalhado.
 * Retorna uma função para remover o listener.
 */
export function setupHttpLogger(
  page: any,
  logFn: (msg: string) => void,
  options: { logAll?: boolean } = {}
): () => void {
  const handler = async (response: any) => {
    try {
      const status = response.status();
      const url = response.url();
      const method = response.request().method();

      // Só logar eventos significativos (4xx, 5xx, redirects) a menos que logAll=true
      if (status >= 400 || options.logAll) {
        const entry: HttpLogEntry = {
          timestamp: new Date().toISOString(),
          url: url.substring(0, 120),
          status,
          method,
          isError: status >= 400,
          isRateLimit: status === 429,
          isRedirect: status >= 300 && status < 400,
        };

        if (status === 429) {
          logFn(`🚨 RATE LIMIT (429) detectado: ${method} ${url.substring(0, 80)}`);
        } else if (status === 403) {
          logFn(`🔒 FORBIDDEN (403): ${method} ${url.substring(0, 80)}`);
        } else if (status === 401) {
          logFn(`🔑 UNAUTHORIZED (401): ${method} ${url.substring(0, 80)}`);
        } else if (status >= 500) {
          logFn(`💥 SERVER ERROR (${status}): ${method} ${url.substring(0, 80)}`);
        } else if (status >= 400) {
          logFn(`⚠️ HTTP ${status}: ${method} ${url.substring(0, 80)}`);
        }
      }
    } catch (e) { /* Silently ignore logging errors */ }
  };

  page.on("response", handler);

  return () => {
    page.off("response", handler);
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÃO DE PROXY (STANDBY)
// ══════════════════════════════════════════════════════════════════════════════

export interface ProxyConfig {
  enabled: boolean;
  server: string | null;
  username: string | null;
  password: string | null;
}

/**
 * Lê configuração de proxy do .env
 * Variáveis esperadas:
 *   PROXY_ENABLED=true
 *   PROXY_SERVER=http://proxy.example.com:8080
 *   PROXY_USERNAME=user
 *   PROXY_PASSWORD=pass
 */
export function getProxyConfig(): ProxyConfig {
  const enabled = process.env.PROXY_ENABLED === "true";
  return {
    enabled,
    server: process.env.PROXY_SERVER || null,
    username: process.env.PROXY_USERNAME || null,
    password: process.env.PROXY_PASSWORD || null,
  };
}

/**
 * Retorna as opções de launch do Playwright com proxy (se configurado)
 */
export function getProxyLaunchArgs(): { proxy?: { server: string; username?: string; password?: string } } {
  const config = getProxyConfig();
  if (!config.enabled || !config.server) {
    return {};
  }

  const proxyOpts: any = { server: config.server };
  if (config.username) proxyOpts.username = config.username;
  if (config.password) proxyOpts.password = config.password;

  return { proxy: proxyOpts };
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTEXT FACTORY (cria um BrowserContext completo e realista)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Cria opções de BrowserContext com todos os patches anti-detecção.
 * Usar com browser.newContext(getStealthContextOptions())
 */
export function getStealthContextOptions(overrides: Record<string, any> = {}): Record<string, any> {
  const ua = overrides.userAgent || getRandomUserAgent();
  const viewport = overrides.viewport || getRandomViewport();
  const headers = getRealisticHeaders(ua);

  return {
    userAgent: ua,
    viewport,
    deviceScaleFactor: overrides.deviceScaleFactor || getRandomDeviceScale(),
    isMobile: false,
    hasTouch: false,
    locale: overrides.locale || "pt-BR",
    timezoneId: overrides.timezoneId || "America/Sao_Paulo",
    colorScheme: overrides.colorScheme || "dark",
    extraHTTPHeaders: { ...headers, ...(overrides.extraHTTPHeaders || {}) },
    // Spread any remaining overrides
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => 
        !["userAgent", "viewport", "deviceScaleFactor", "locale", "timezoneId", "colorScheme", "extraHTTPHeaders"].includes(key)
      )
    ),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// SIMULAÇÃO DE COMPORTAMENTO HUMANO
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Simula um movimento de mouse com curva de Bezier (mais realista que line reta)
 */
export async function humanMouseMove(page: any, targetX: number, targetY: number, steps = 10): Promise<void> {
  const currentPos = { x: Math.random() * 500 + 100, y: Math.random() * 300 + 100 };

  // Ponto de controle aleatório para curva de Bezier quadrática
  const cpX = (currentPos.x + targetX) / 2 + (Math.random() - 0.5) * 200;
  const cpY = (currentPos.y + targetY) / 2 + (Math.random() - 0.5) * 200;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Bezier quadrática: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
    const x = Math.pow(1 - t, 2) * currentPos.x + 2 * (1 - t) * t * cpX + Math.pow(t, 2) * targetX;
    const y = Math.pow(1 - t, 2) * currentPos.y + 2 * (1 - t) * t * cpY + Math.pow(t, 2) * targetY;

    await page.mouse.move(x, y);
    await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 30));
  }
}

/**
 * Scroll humanizado (quantidade variável, velocidade aleatória)
 */
export async function humanScroll(page: any, direction: "down" | "up" = "down"): Promise<void> {
  const amount = 200 + Math.floor(Math.random() * 400); // 200-600px
  const sign = direction === "down" ? 1 : -1;

  await page.evaluate((scrollAmount: number) => {
    window.scrollBy({ top: scrollAmount, behavior: "smooth" });
  }, amount * sign);

  await humanDelay(500, 1500);
}
