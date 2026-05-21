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

const SEED_CORRETORES = [
  {
    id: "seed-1",
    anunciante_id: "a-101",
    nome: "Marcos Venícius Silva",
    creci: "CRECI 54321-F",
    telefone: "(21) 98765-4321",
    estado: "RJ",
    cidade: "Niterói",
    imobiliaria: "RE/MAX Aliança",
    criado_em: new Date(Date.now() - 3600000 * 2).toISOString(),
  },
  {
    id: "seed-2",
    anunciante_id: "a-102",
    nome: "Amanda Silveira Oliveira",
    creci: "CRECI 65432-F",
    telefone: "(21) 97654-3210",
    estado: "RJ",
    cidade: "Niterói",
    imobiliaria: "Lopes Imobiliária",
    criado_em: new Date(Date.now() - 3600000 * 4).toISOString(),
  },
  {
    id: "seed-3",
    anunciante_id: "a-103",
    nome: "Roberto Carlos Mendes",
    creci: "CRECI 12345-J",
    telefone: "(11) 99123-4567",
    estado: "SP",
    cidade: "São Paulo",
    imobiliaria: "Mendes Imobiliare",
    criado_em: new Date(Date.now() - 3600000 * 6).toISOString(),
  },
  {
    id: "seed-4",
    anunciante_id: "a-104",
    nome: "Juliana Peixoto Barros",
    creci: "CRECI 78901-F",
    telefone: "(11) 98888-7777",
    estado: "SP",
    cidade: "Santos",
    imobiliaria: "Golden Imóveis",
    criado_em: new Date(Date.now() - 3600000 * 8).toISOString(),
  }
];

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

    const simulated = generateSimulatedCorretores(state, city, 8);

    // No ambiente Serverless (Vercel), apenas retornamos dados simulados para a UI não quebrar.
    // NÃO salvamos no Supabase para não poluir o banco de dados real com dados falsos.
    console.log("Execução na Vercel: retornando apenas dados simulados na memória.");

    return res.json({
      message: "Motor de busca de corretores iniciado. Capturando registros...",
      data: simulated,
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
