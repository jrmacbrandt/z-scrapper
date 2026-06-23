import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { initDB } from "./database.js";
import dotenv from "dotenv";
import igRouter from "./server-ig.js";
import gmapsRouter from "./server-gmaps.js";

dotenv.config();
initDB();

const PORT = process.env.PORT || 3001;

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ── Rotas Modularizadas ───────────────────────────────────────────────────────
app.use("/api/ig", igRouter);
app.use("/api/gmaps", gmapsRouter);

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
    app.listen(Number(PORT), "0.0.0.0", () =>
      console.log(`✅ Servidor rodando em http://localhost:${PORT}`)
    );
  };
  startLocalServer().catch(console.error);
}

export default app;
