import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "http";

// Vercel serverless handler types (compatible with @vercel/node runtime)
type VercelRequest = IncomingMessage & { body?: any; query?: Record<string, string | string[]>; url?: string; method?: string };
type VercelResponse = ServerResponse & { status: (code: number) => VercelResponse; json: (body: any) => void; end: () => void; setHeader: (name: string, value: string) => VercelResponse };

// ── Local Memory Database (Serverless-safe) ─────────────────────────────────

const FIRST_NAMES = [
  "Alexandre", "Bruna", "Carlos", "Daniela", "Eduardo", "Fernanda", "Gabriel", "Helena", "Igor", "Juliana", "Leonardo", "Mariana", "Newton", "Patricia", "Ricardo", "Sandra", "Thiago", "Vanessa", "Rodrigo", "Camila", "Felipe", "Beatriz", "Gustavo", "Larissa"
];

const LAST_NAMES = [
  "Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira", "Gomes", "Costa", "Ribeiro", "Martins", "Carvalho", "Almeida", "Mendes", "Barros", "Azevedo", "Cardoso"
];

const IMOBILIARIAS = [
  "Lopes Imobiliária", "RE/MAX Aliança", "QuintoAndar", "Souto Imóveis", "Golden Imóveis", "Netimóveis", "Brasil Brokers", "Nova Época", "Z-Imóveis", "Direct Imobiliária", "Consultoria Nobre", "Apsa Administração"
];

const SEED_CORRETORES: any[] = [];

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  const isPlaceholder = (s: string | undefined) =>
    !s || s.includes("your-project") || s.includes("your-anon-key") || s.includes("MY_SUPABASE_URL");

  if (isPlaceholder(url) || isPlaceholder(key)) return null;

  try {
    new URL(url!);
    return createClient(url!, key!);
  } catch {
    return null;
  }
}

// ── Vercel Serverless Handler ────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const path = req.url?.replace(/\?.*$/, "") || "";

  // ── POST /api/scrape ───────────────────────────────────────────────────────
  if (req.method === "POST" && path === "/api/scrape") {
    const { state, city } = req.body || {};
    if (!state || !city) {
      return res.status(400).json({ error: "Estado e Cidade são obrigatórios." });
    }

    // No ambiente Serverless (Vercel), bloqueamos a geração de fake data.
    // O usuário deve rodar a versão local (npm run dev) para realizar scraping real.
    console.log("Execução na Vercel: Extração em tempo real não suportada.");

    return res.json({
      message: "Por favor, utilize o ambiente local (Motor de Busca) para realizar novas extrações. A Vercel exibirá os resultados extraídos.",
      data: [],
    });
  }

  // ── GET /api/corretores ────────────────────────────────────────────────────
  if (req.method === "GET" && path === "/api/corretores") {
    const supabase = getSupabase();

    if (!supabase) {
      // Return seed data when no Supabase is configured
      return res.json(SEED_CORRETORES);
    }

    try {
      const { data, error } = await supabase
        .from("corretores")
        .select("*")
        .order("criado_em", { ascending: false });

      if (error) {
        console.error("Supabase query error:", error.message);
        return res.json(SEED_CORRETORES);
      }

      // Merge with seeds (no duplicates)
      const combined = [...(data || [])];
      for (const seed of SEED_CORRETORES) {
        if (!combined.some(r => r.anunciante_id === seed.anunciante_id)) {
          combined.push(seed);
        }
      }
      combined.sort((a, b) => new Date(b.criado_em || 0).getTime() - new Date(a.criado_em || 0).getTime());

      return res.json(combined);
    } catch (err: any) {
      console.error("Supabase fetch error:", err.message);
      return res.json(SEED_CORRETORES);
    }
  }

  // ── Fallback ───────────────────────────────────────────────────────────────
  return res.status(404).json({ error: "Not found" });
}
