import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function run() {
  console.log("=== BUSCAS ===");
  const { data: buscas } = await sb.from("buscas").select("*").order("criado_em", { ascending: false });
  console.log(JSON.stringify(buscas, null, 2));

  console.log("\n=== CORRETORES (count por cidade) ===");
  const { data: corretores } = await sb.from("corretores").select("estado, cidade");
  const byCity = {};
  for (const c of (corretores || [])) {
    const k = `${c.estado}/${c.cidade}`;
    byCity[k] = (byCity[k] || 0) + 1;
  }
  console.log("Total corretores:", (corretores || []).length);
  console.log("Por cidade:", JSON.stringify(byCity, null, 2));
}
run();
