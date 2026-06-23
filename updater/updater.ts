// ══════════════════════════════════════════════════════════════════════════════
// updater/updater.ts — Sistema de Atualização Automática de Módulos
//
// Fluxo:
//   1. Baixa manifest.json do GitHub (HTTPS)
//   2. Compara versões com module.json local
//   3. Se update disponível: download → checksum → backup → aplica → valida
//   4. Rollback automático em caso de falha
//
// URLs do servidor de updates: GitHub Raw Content (gratuito, HTTPS)
// ══════════════════════════════════════════════════════════════════════════════

import fs from "fs";
import path from "path";
import https from "https";
import crypto from "crypto";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface ModuleFileSpec {
  path: string;
  url: string;
  checksum: string;
  size_bytes: number;
}

export interface ModuleManifest {
  current_version: string;
  min_core_version: string;
  files: ModuleFileSpec[];
  changelog: string;
  mandatory: boolean;
  release_date: string;
}

export interface RemoteManifest {
  last_updated: string;
  modules: Record<string, ModuleManifest>;
  core: {
    latest_version: string;
    update_available: boolean;
  };
}

export interface LocalModuleInfo {
  name: string;
  version: string;
  min_core_version: string;
}

export interface UpdateStatus {
  checked_at: string | null;
  modules_with_updates: ModuleUpdate[];
  error: string | null;
  is_checking: boolean;
}

export interface ModuleUpdate {
  name: string;
  current_version: string;
  new_version: string;
  changelog: string;
  mandatory: boolean;
}

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();

const MANIFEST_URL =
  "https://raw.githubusercontent.com/jrmacbrandt/z-scrapper/main/updates/manifest.json";

// Token GitHub para repositórios privados (opcional — definir GITHUB_TOKEN no .env)
// Se o repositório for público, deixar vazio.
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";

function getRequestUrl(url: string): string {
  if (!GITHUB_TOKEN) return url;
  
  const rawPrefix = "https://raw.githubusercontent.com/";
  if (url.startsWith(rawPrefix)) {
    const parts = url.slice(rawPrefix.length).split("/");
    if (parts.length >= 4) {
      const owner = parts[0];
      const repo = parts[1];
      const branch = parts[2];
      const filePath = parts.slice(3).join("/");
      return `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
    }
  }
  return url;
}

function getGitHubHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "z-scraper-updater/1.0",
  };
  
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith("github.com")) {
      if (parsed.hostname === "api.github.com") {
        headers["Accept"] = "application/vnd.github.v3.raw";
      }
      if (GITHUB_TOKEN) {
        headers["Authorization"] = `token ${GITHUB_TOKEN}`;
      }
    } else if (parsed.hostname.endsWith("githubusercontent.com")) {
      if (GITHUB_TOKEN) {
        headers["Authorization"] = `token ${GITHUB_TOKEN}`;
      }
    }
  } catch {
    if (GITHUB_TOKEN) {
      headers["Authorization"] = `token ${GITHUB_TOKEN}`;
    }
  }
  
  return headers;
}

const MODULES_DIR  = path.join(ROOT, "modules");
const UPDATER_DIR  = path.join(ROOT, "updater");
const TEMP_DIR     = path.join(UPDATER_DIR, "temp");
const CORE_VERSION = readJson<{ version: string }>(path.join(ROOT, "core", "version.json"))?.version ?? "1.0.0";

// Intervalo de verificação em background (4 horas)
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// ── Estado em memória ─────────────────────────────────────────────────────────

let updateStatus: UpdateStatus = {
  checked_at: null,
  modules_with_updates: [],
  error: null,
  is_checking: false,
};

let checkIntervalHandle: ReturnType<typeof setInterval> | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function semverGt(a: string, b: string): boolean {
  const parse = (v: string) => v.split(".").map(Number);
  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPat > bPat;
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const doGet = (u: string) => {
      const options = {
        timeout: 15000,
        headers: getGitHubHeaders(u),
      };
      const req = https.get(u, options, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doGet(res.headers.location);
          return;
        }
        if (res.statusCode === 404) {
          reject(new Error(
            `Manifesto não encontrado (404). Verifique: (1) o repo 'z-scrapper' é privado? → adicione GITHUB_TOKEN ao .env; (2) o arquivo updates/manifest.json existe no GitHub?`
          ));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} ao baixar ${u}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        res.on("error", reject);
      });
      req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
      req.on("error", reject);
    };

    doGet(getRequestUrl(url));
  });
}

function httpsDownload(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    const doGet = (u: string) => {
      const options = { timeout: 30000, headers: getGitHubHeaders(u) };
      const req = https.get(u, options, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doGet(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} ao baixar ${u}`));
          return;
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(); });
        file.on("error", (e) => { fs.unlink(destPath, () => {}); reject(e); });
        res.on("error", (e) => { file.close(); fs.unlink(destPath, () => {}); reject(e); });
      });
      req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
      req.on("error", (e) => { reject(e); });
    };

    doGet(getRequestUrl(url));
  });
}


function sha256File(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function logUpdate(msg: string): void {
  const ts = new Date().toLocaleTimeString("pt-BR");
  console.log(`[${ts}] 🔄 [UPDATER] ${msg}`);
}

// ── Core: Verificação de updates ──────────────────────────────────────────────

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (updateStatus.is_checking) return updateStatus;

  updateStatus.is_checking = true;
  updateStatus.error = null;

  try {
    logUpdate("Verificando atualizações...");
    const raw = await httpsGet(MANIFEST_URL);
    const manifest: RemoteManifest = JSON.parse(raw);

    const modulesWithUpdates: ModuleUpdate[] = [];

    for (const [moduleName, remoteInfo] of Object.entries(manifest.modules)) {
      const moduleJsonPath = path.join(MODULES_DIR, moduleName, "module.json");
      const localInfo = readJson<LocalModuleInfo>(moduleJsonPath);

      if (!localInfo) {
        logUpdate(`Módulo ${moduleName} não encontrado localmente. Ignorando.`);
        continue;
      }

      // Verificar compatibilidade de core
      if (semverGt(remoteInfo.min_core_version, CORE_VERSION)) {
        logUpdate(`⚠️ ${moduleName}: requer core v${remoteInfo.min_core_version}, mas core local é v${CORE_VERSION}. Pulando.`);
        continue;
      }

      if (semverGt(remoteInfo.current_version, localInfo.version)) {
        logUpdate(`📦 Update disponível: ${moduleName} ${localInfo.version} → ${remoteInfo.current_version}`);
        modulesWithUpdates.push({
          name: moduleName,
          current_version: localInfo.version,
          new_version: remoteInfo.current_version,
          changelog: remoteInfo.changelog,
          mandatory: remoteInfo.mandatory,
        });
      } else {
        logUpdate(`✅ ${moduleName} está atualizado (v${localInfo.version})`);
      }
    }

    updateStatus = {
      checked_at: new Date().toISOString(),
      modules_with_updates: modulesWithUpdates,
      error: null,
      is_checking: false,
    };

    if (modulesWithUpdates.length === 0) {
      logUpdate("Todos os módulos estão atualizados.");
    } else {
      logUpdate(`${modulesWithUpdates.length} update(s) disponível(is).`);
    }

  } catch (err: any) {
    logUpdate(`❌ Falha na verificação: ${err.message}`);
    updateStatus = {
      ...updateStatus,
      error: err.message,
      is_checking: false,
    };
  }

  return updateStatus;
}

// ── Core: Aplicação de update atômico ────────────────────────────────────────

export async function applyUpdate(moduleName: string): Promise<{ success: boolean; message: string }> {
  logUpdate(`Iniciando update do módulo: ${moduleName}`);

  // 1. Baixar manifesto remoto
  let manifest: RemoteManifest;
  try {
    const raw = await httpsGet(MANIFEST_URL);
    manifest = JSON.parse(raw);
  } catch (err: any) {
    return { success: false, message: `Falha ao baixar manifesto: ${err.message}` };
  }

  const remoteModule = manifest.modules[moduleName];
  if (!remoteModule) {
    return { success: false, message: `Módulo ${moduleName} não encontrado no manifesto remoto.` };
  }

  const moduleDir  = path.join(MODULES_DIR, moduleName);
  const tempDir    = path.join(TEMP_DIR, `${moduleName}_${remoteModule.current_version}_${Date.now()}`);
  const backupDir  = path.join(moduleDir, `backup_${Date.now()}`);
  const backupMade = false;

  try {
    // 2. Download de todos os arquivos para /temp/
    logUpdate(`Baixando ${remoteModule.files.length} arquivo(s) para pasta temporária...`);
    fs.mkdirSync(tempDir, { recursive: true });

    for (const fileSpec of remoteModule.files) {
      const fileName    = path.basename(fileSpec.path);
      const destPath    = path.join(tempDir, fileName);
      let downloadOk    = false;

      // Até 3 tentativas
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await httpsDownload(fileSpec.url, destPath);

          // 3. Verificar checksum (se fornecido)
          if (fileSpec.checksum) {
            const actualChecksum = sha256File(destPath);
            const expectedChecksum = fileSpec.checksum.replace(/^sha256:/i, "");
            if (actualChecksum !== expectedChecksum) {
              throw new Error(`Checksum inválido para ${fileName} (tentativa ${attempt}/3)`);
            }
          }

          downloadOk = true;
          logUpdate(`✅ ${fileName} baixado e verificado.`);
          break;
        } catch (e: any) {
          logUpdate(`⚠️ Tentativa ${attempt}/3 falhou: ${e.message}`);
          if (attempt === 3) throw e;
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }

      if (!downloadOk) {
        throw new Error(`Falha no download de ${fileName} após 3 tentativas.`);
      }
    }

    // 4. Backup do módulo atual
    if (fs.existsSync(moduleDir)) {
      logUpdate(`Fazendo backup do módulo atual...`);
      copyDirSync(moduleDir, backupDir);
      logUpdate(`Backup criado em: ${path.basename(backupDir)}`);
    }

    // 5. Aplicar novos arquivos
    logUpdate(`Aplicando novos arquivos...`);
    for (const fileSpec of remoteModule.files) {
      const fileName = path.basename(fileSpec.path);
      const srcPath  = path.join(tempDir, fileName);
      const destPath = path.join(ROOT, fileSpec.path);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      logUpdate(`📝 ${fileSpec.path} atualizado.`);
    }

    // 6. Atualizar module.json com nova versão
    const moduleJsonPath = path.join(moduleDir, "module.json");
    const localModule    = readJson<LocalModuleInfo>(moduleJsonPath) ?? { name: moduleName, version: "0.0.0", min_core_version: "1.0.0" };
    writeJson(moduleJsonPath, {
      ...localModule,
      version: remoteModule.current_version,
      updated_at: new Date().toISOString(),
    });

    // 7. Limpar temporários
    fs.rmSync(tempDir, { recursive: true, force: true });

    // 8. Limpar backups antigos (manter apenas os 2 mais recentes)
    cleanOldBackups(moduleDir);

    // 9. Atualizar status em memória
    updateStatus.modules_with_updates = updateStatus.modules_with_updates.filter(m => m.name !== moduleName);

    logUpdate(`🎉 Update de ${moduleName} aplicado com sucesso! Versão: ${remoteModule.current_version}`);
    return { success: true, message: `${moduleName} atualizado para v${remoteModule.current_version}` };

  } catch (err: any) {
    logUpdate(`❌ Falha ao aplicar update: ${err.message}`);

    // ROLLBACK AUTOMÁTICO
    try {
      if (fs.existsSync(backupDir)) {
        logUpdate(`🔙 Iniciando rollback automático...`);
        copyDirSync(backupDir, moduleDir);
        logUpdate(`✅ Rollback concluído. Módulo restaurado para versão anterior.`);
      }
    } catch (rollbackErr: any) {
      logUpdate(`🚨 Falha crítica no rollback: ${rollbackErr.message}`);
    }

    // Limpar temporários mesmo em falha
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}

    return { success: false, message: `Falha no update: ${err.message}. Rollback executado.` };
  }
}

// ── Limpeza de backups antigos ────────────────────────────────────────────────

function cleanOldBackups(moduleDir: string, keep = 2): void {
  try {
    const entries = fs.readdirSync(moduleDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith("backup_"))
      .map(e => ({ name: e.name, ts: parseInt(e.name.split("_")[1] ?? "0") }))
      .sort((a, b) => b.ts - a.ts);

    for (const old of entries.slice(keep)) {
      fs.rmSync(path.join(moduleDir, old.name), { recursive: true, force: true });
      logUpdate(`🗑️ Backup antigo removido: ${old.name}`);
    }
  } catch {}
}

// ── API pública ───────────────────────────────────────────────────────────────

export function getUpdateStatus(): UpdateStatus {
  return updateStatus;
}

/**
 * Inicializa o updater:
 * - Verifica updates ao iniciar (não bloqueante)
 * - Agenda verificação periódica a cada 4 horas
 */
export function initUpdater(): void {
  logUpdate(`Updater inicializado. Core v${CORE_VERSION}.`);

  // Verificação inicial com delay de 10s (não bloquear o startup)
  setTimeout(() => {
    checkForUpdates().catch(() => {});
  }, 10_000);

  // Verificação periódica
  if (checkIntervalHandle) clearInterval(checkIntervalHandle);
  checkIntervalHandle = setInterval(() => {
    checkForUpdates().catch(() => {});
  }, CHECK_INTERVAL_MS);
}
