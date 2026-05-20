import React, { useState, useEffect } from "react";
import { 
  Search, 
  MapPin, 
  Phone, 
  User, 
  MessageCircle, 
  Database, 
  Play, 
  RefreshCcw,
  Zap,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface Corretor {
  id: string;
  nome: string;
  creci: string;
  telefone: string;
  estado: string;
  cidade: string;
  imobiliaria: string;
  criado_em: string;
}

const UF_LIST = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", 
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];

// Mock de cidades populares por estado para facilitar o protótipo
const CITIES_BY_UF: Record<string, string[]> = {
  SP: ["São Paulo", "Campinas", "Santos", "Ribeirão Preto"],
  RJ: ["Rio de Janeiro", "Niterói", "Búzios", "Petrópolis"],
  MG: ["Belo Horizonte", "Uberlândia", "Ouro Preto"],
  PR: ["Curitiba", "Londrina", "Maringá"],
  SC: ["Florianópolis", "Balneário Camboriú", "Joinville"],
};

export default function App() {
  const [state, setState] = useState("RJ");
  const [city, setCity] = useState("Niterói");
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [loading, setLoading] = useState(false);
  const [scrapingStatus, setScrapingStatus] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(true);

  const fetchCorretores = async () => {
    try {
      const res = await fetch("/api/corretores");
      if (!res.ok) {
        const text = await res.text();
        console.error(`API Error (${res.status}):`, text.substring(0, 100));
        return;
      }
      const data = await res.json();
      setCorretores(data);
    } catch (err) {
      console.error("Erro ao buscar corretores:", err);
    }
  };

  useEffect(() => {
    fetchCorretores();
    let interval: any;
    if (isLive) {
      interval = setInterval(fetchCorretores, 5000);
    }
    return () => clearInterval(interval);
  }, [isLive]);

  const startScrape = async () => {
    setLoading(true);
    setScrapingStatus("Iniciando motor de busca...");
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, city }),
      });
      const data = await res.json();
      setScrapingStatus(data.message);
      setTimeout(() => setScrapingStatus(null), 5000);
    } catch (err) {
      setScrapingStatus("Erro ao iniciar captura.");
    } finally {
      setLoading(false);
    }
  };

  const getWhatsAppUrl = (phone: string) => {
    const cleanPhone = phone.replace(/\D/g, "");
    return `https://wa.me/55${cleanPhone}`;
  };

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-200 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-800 bg-slate-950 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-sky-500 rounded flex items-center justify-center font-bold text-slate-950 shadow-lg shadow-sky-500/20">Z</div>
            <h1 className="text-xl font-bold tracking-tight text-white">Z-Scraper</h1>
          </div>
          <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest font-semibold">v1.0.4-stable</p>
        </div>
        
        <nav className="flex-1 px-4 space-y-2 mt-4">
          <button className="w-full flex items-center gap-3 px-3 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium transition-all">
            <Database className="w-4 h-4 text-sky-400" />
            Dashboard
          </button>
          <button className="w-full flex items-center gap-3 px-3 py-2 text-slate-400 hover:bg-slate-900 hover:text-white rounded-lg text-sm transition-all group">
            <Zap className="w-4 h-4 group-hover:text-yellow-400 transition-colors" />
            Extração Ativa
          </button>
        </nav>

        <div className="p-4 mt-auto">
          <div className="glass rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-bold">
              <span className="text-slate-400">Status Scraper</span>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className={`w-2 h-2 rounded-full ${loading ? 'bg-yellow-400 animate-pulse' : 'bg-emerald-400 animate-status-pulse'}`}></span>
                {loading ? 'Running' : 'Idle'}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-bold">
              <span className="text-slate-400">Modo Live</span>
              <button 
                onClick={() => setIsLive(!isLive)}
                className={`px-2 py-0.5 rounded text-[9px] ${isLive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}
              >
                {isLive ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col bg-slate-950 p-8 overflow-hidden">
        <header className="flex justify-between items-start mb-8 shrink-0">
          <div>
            <h2 className="text-3xl font-bold text-white tracking-tight">Painel de Leads</h2>
            <p className="text-slate-400 text-sm mt-1">Filtre e extraia contatos reais em tempo real do Zap Imóveis.</p>
          </div>
          <div className="flex gap-6 items-center">
            <div className="text-right">
              <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Total Capturado</p>
              <p className="text-2xl font-bold text-sky-400 font-mono leading-none">{corretores.length.toLocaleString()}</p>
            </div>
            <div className="h-10 w-[1px] bg-slate-800"></div>
            <div className="text-right">
              <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Bypass Cloudflare</p>
              <p className="text-2xl font-bold text-emerald-400 font-mono leading-none">ACTIVE</p>
            </div>
          </div>
        </header>

        {/* Filter Section */}
        <section className="shrink-0 mb-8">
          <div className="glass rounded-2xl p-6 flex items-end gap-6 shadow-2xl">
            <div className="flex-1 space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">Estado (UF)</label>
              <div className="relative">
                <select 
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-sky-500/50 outline-none appearance-none cursor-pointer transition-all hover:border-slate-600"
                >
                  {UF_LIST.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              </div>
            </div>
            <div className="flex-1 space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">Cidade</label>
              <input 
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Ex: Niterói"
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-sky-500/50 outline-none transition-all hover:border-slate-600 placeholder:text-slate-600"
              />
            </div>
            <button 
              onClick={startScrape}
              disabled={loading}
              className="h-[52px] px-8 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-black rounded-xl transition-all flex items-center gap-2 active:scale-[0.98] shadow-lg shadow-sky-500/20 uppercase text-xs tracking-widest"
            >
              {loading ? (
                <RefreshCcw className="w-4 h-4 animate-spin text-slate-950" />
              ) : (
                <>
                  <span>Iniciar Captura</span>
                  <Play className="w-4 h-4 fill-current" />
                </>
              )}
            </button>
          </div>
          
          <AnimatePresence>
            {scrapingStatus && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="mt-4 bg-sky-500/10 border border-sky-500/30 px-6 py-3 rounded-xl flex items-center gap-3 text-sky-400 text-sm font-medium"
              >
                <div className="w-2 h-2 bg-sky-500 rounded-full animate-pulse"></div>
                {scrapingStatus}
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Leads Table Section */}
        <section className="flex-1 glass rounded-2xl flex flex-col overflow-hidden shadow-2xl relative">
          <div className="border-b border-slate-800 px-6 py-5 flex justify-between items-center bg-slate-900/40">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-800 rounded-lg">
                <Database className="w-4 h-4 text-sky-500" />
              </div>
              <h3 className="font-bold text-white uppercase tracking-tight text-sm">Base de Corretores Capturados</h3>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={fetchCorretores}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
                title="Sincronizar agora"
              >
                <RefreshCcw className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="min-w-[800px]">
              {/* Header Grid */}
              <div className="grid grid-cols-12 text-[10px] uppercase font-black tracking-widest text-slate-500 border-b border-slate-800 sticky top-0 bg-slate-900/95 backdrop-blur-md z-10 px-6 py-5">
                <div className="col-span-4">Nome / Imobiliária</div>
                <div className="col-span-2">CRECI</div>
                <div className="col-span-2">Região</div>
                <div className="col-span-2">Contato</div>
                <div className="col-span-2 text-right pr-6">Ação</div>
              </div>

              {/* Body Rows */}
              <div className="divide-y divide-slate-800/40">
                <AnimatePresence mode="popLayout">
                  {corretores.length === 0 ? (
                    <motion.div 
                      initial={{ opacity: 0 }} 
                      animate={{ opacity: 1 }}
                      className="px-6 py-32 text-center text-slate-600 italic font-medium"
                    >
                      Aguardando dados... Preencha os campos e inicie uma captura.
                    </motion.div>
                  ) : (
                    corretores.map((corretor) => (
                      <motion.div 
                        layout
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        key={corretor.id} 
                        className="grid grid-cols-12 items-center px-6 py-4 hover:bg-white/5 transition-all group"
                      >
                        <div className="col-span-4 font-medium flex flex-col">
                          <span className="text-white text-sm group-hover:text-sky-400 transition-colors uppercase tracking-tight font-semibold">
                            {corretor.nome}
                          </span>
                          <span className="text-[9px] text-slate-500 uppercase tracking-widest font-black mt-0.5">
                            {corretor.imobiliaria || "Corretor Independente"}
                          </span>
                        </div>
                        
                        <div className="col-span-2 select-all">
                          <span className="inline-block text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2 py-1 rounded border border-slate-700/50">
                            {corretor.creci || "N/A"}
                          </span>
                        </div>
                        
                        <div className="col-span-2">
                          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium lowercase first-letter:uppercase">
                            <MapPin className="w-3 h-3 text-slate-700" />
                            {corretor.cidade} - {corretor.estado}
                          </div>
                        </div>
                        
                        <div className="col-span-2 select-all">
                          <div className="text-sky-400 font-mono font-bold text-sm tracking-tight">
                            {corretor.telefone}
                          </div>
                        </div>
                        
                        <div className="col-span-2 text-right pr-6">
                          <a 
                            href={getWhatsAppUrl(corretor.telefone)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-[10px] font-black uppercase tracking-tighter hover:bg-emerald-500 hover:text-slate-950 hover:border-emerald-500 transition-all active:scale-95"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            WhatsApp
                          </a>
                        </div>
                      </motion.div>
                    ))
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-slate-800 bg-slate-900/50 flex justify-between items-center text-[10px] uppercase font-black shrink-0">
            <div className="flex gap-6 text-slate-500">
              <span className="flex items-center gap-2">Mapeamento <b className="text-slate-300 font-mono">__NEXT_DATA__</b></span>
              <span className="flex items-center gap-2">Crawler <b className="text-slate-300 font-mono">PLAYWRIGHT</b></span>
            </div>
            <div className="flex items-center gap-1.5 text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              Cloudflare Bypass Active
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

// Sub-components ou imports auxiliares que precisam ser declarados no mesmo arquivo para evitar erros
function ChevronDown(props: any) {
  return <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>;
}

function ShieldCheck(props: any) {
  return <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>;
}
