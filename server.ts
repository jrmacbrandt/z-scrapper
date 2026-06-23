import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { initDB } from "./database.js";
import dotenv from "dotenv";
import igRouter from "./server-ig.js";
import gmapsRouter from "./server-gmaps.js";
import { initUpdater, checkForUpdates, applyUpdate, getUpdateStatus } from "./updater/updater.js";

dotenv.config();
initDB();

const PORT = process.env.PORT || 3001;

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ── Rotas Modularizadas ───────────────────────────────────────────────────────
app.use("/api/ig", igRouter);
app.use("/api/gmaps", gmapsRouter);

// ── Rotas do Sistema de Atualização ──────────────────────────────────────────

/** Retorna o status atual dos updates (chamado pelo frontend para exibir o sino) */
app.get("/api/updates/status", (_req, res) => {
  res.json(getUpdateStatus());
});

/** Dispara verificação manual de updates */
app.post("/api/updates/check", async (_req, res) => {
  try {
    const status = await checkForUpdates();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Aplica update de um módulo específico */
app.post("/api/updates/apply", async (req, res) => {
  const { module: moduleName } = req.body as { module?: string };
  if (!moduleName) {
    return res.status(400).json({ error: "Campo 'module' é obrigatório." });
  }

  try {
    const result = await applyUpdate(moduleName);
    if (result.success) {
      res.json({ success: true, message: result.message });
    } else {
      res.status(500).json({ success: false, message: result.message });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
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
    app.listen(Number(PORT), "0.0.0.0", () => {
      console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
      // Inicializa o updater APÓS o servidor estar ouvindo
      initUpdater();
    });
  };
  startLocalServer().catch(console.error);
}

export default app;
