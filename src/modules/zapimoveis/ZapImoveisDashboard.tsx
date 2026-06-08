// ─────────────────────────────────────────────────────────────────────────────
// ZapImoveisDashboard — Módulo isolado: toda lógica e UI do ZapImóveis
// NÃO altere este arquivo sem autorização explícita do módulo.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef } from "react";
import {
  MapPin,
  MessageCircle,
  Database,
  Play,
  RefreshCcw,
  Zap,
  Terminal,
  X,
  Download,
  History,
  Clock,
  Users,
  ChevronRight,
  Trash2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// ── Interfaces ────────────────────────────────────────────────────────────────
interface Corretor {
  id: string;
  nome: string;
  creci: string;
  telefone: string;
  estado: string;
  cidade: string;
  imobiliaria: string;
  msg_enviada?: number | boolean;
  criado_em: string;
}

interface Busca {
  id?: string;
  estado: string;
  cidade: string;
  total_contatos: number;
  criado_em: string;
}

export interface ZapStatus {
  running: boolean;
  isLive: boolean;
  buscasCount: number;
  showLog: boolean;
}

export interface ZapImoveisDashboardProps {
  /** Seção solicitada pelo menu lateral pai: 'log' | 'buscas' | null */
  sectionRequest: string | null;
  /** Callback chamado quando o estado interno muda (para atualizar o menu pai) */
  onStatusChange: (status: ZapStatus) => void;
}

// ── UF List ───────────────────────────────────────────────────────────────────
const UF_LIST = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function ZapImoveisDashboard({
  sectionRequest,
  onStatusChange,
}: ZapImoveisDashboardProps) {
  const [state, setState] = useState("RJ");
  const [city, setCity] = useState("");
  const [corretores, setCorretores] = useState<Corretor[]>([]);
  const [loading, setLoading] = useState(false);
  const [scraperRunning, setScraperRunning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [scraperLog, setScraperLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [isLive, setIsLive] = useState(true);
  const [showBuscas, setShowBuscas] = useState(false);
  const [buscas, setBuscas] = useState<Busca[]>([]);
  const [loadingBusca, setLoadingBusca] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const activeSearchRef = useRef<{ estado: string; cidade: string } | null>(null);
  const loadingRef = useRef(false);
  const dataReadyRef = useRef(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // ── Repassa status para o menu pai ─────────────────────────────────────────
  useEffect(() => {
    onStatusChange({ running: scraperRunning, isLive, buscasCount: buscas.length, showLog });
  }, [scraperRunning, isLive, buscas.length, showLog]);

  // ── Responde a pedidos de seção vindos do menu pai ─────────────────────────
  useEffect(() => {
    if (!sectionRequest) return;
    if (sectionRequest === "buscas") {
      fetchBuscas();
      setShowBuscas(true);
    }
  }, [sectionRequest]);

  // ── Fetch contacts ──────────────────────────────────────────────────────────
  const fetchCorretores = async () => {
    if (!dataReadyRef.current) return;
    try {
      const filter = activeSearchRef.current;
      if (filter) {
        const res = await fetch("/api/buscas/load", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: filter.estado, city: filter.cidade }),
        });
        if (!res.ok) return;
        const data = await res.json();
        setCorretores(data);
      } else {
        const res = await fetch("/api/corretores");
        if (!res.ok) return;
        const data = await res.json();
        setCorretores(data);
      }
    } catch (err) {
      console.error("Erro ao buscar corretores:", err);
    }
  };

  // ── Fetch saved searches ──────────────────────────────────────────────────
  const fetchBuscas = async () => {
    try {
      const res = await fetch("/api/buscas");
      if (!res.ok) return;
      const data = await res.json();
      setBuscas(data);
    } catch {}
  };

  // ── Load a saved search's contacts ──────────────────────────────────────
  const loadBusca = async (busca: Busca) => {
    const key = `${busca.estado}-${busca.cidade}`;
    setLoadingBusca(key);
    try {
      const res = await fetch("/api/buscas/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: busca.estado, city: busca.cidade }),
      });
      if (!res.ok) throw new Error("Erro ao carregar busca");
      const data = await res.json();
      dataReadyRef.current = true;
      activeSearchRef.current = { estado: busca.estado, cidade: busca.cidade };
      setCorretores(data);
      setState(busca.estado);
      setCity(busca.cidade);
      setShowBuscas(false);
      setStatusMsg(`✅ Busca carregada: ${busca.estado}/${busca.cidade} — ${data.length} contatos.`);
      setTimeout(() => setStatusMsg(null), 5000);
    } catch {
      setStatusMsg("❌ Erro ao carregar busca salva.");
    } finally {
      setLoadingBusca(null);
    }
  };

  // ── Delete a saved search and its contacts ──────────────────────────────────
  const deleteBusca = async (busca: Busca) => {
    if (!busca.id) return;
    setIsDeleting(true);
    try {
      const res = await fetch(
        `/api/buscas/${busca.id}?estado=${encodeURIComponent(busca.estado)}&cidade=${encodeURIComponent(busca.cidade)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Erro ao excluir busca");
      setBuscas(prev => prev.filter(b => b.id !== busca.id));
      if (state === busca.estado && city === busca.cidade) {
        activeSearchRef.current = null;
        setCorretores([]);
      }
      setStatusMsg(`🗑️ Busca de ${busca.estado}/${busca.cidade} e seus contatos foram excluídos.`);
      setTimeout(() => setStatusMsg(null), 5000);
    } catch {
      setStatusMsg("❌ Erro ao excluir busca.");
      setTimeout(() => setStatusMsg(null), 5000);
    } finally {
      setIsDeleting(false);
      setDeletingId(null);
    }
  };

  // ── Poll scraper status ─────────────────────────────────────────────────────
  const pollStatus = async () => {
    try {
      const res = await fetch("/api/scrape-status");
      if (!res.ok) return;
      const { running, log } = await res.json();
      setScraperRunning(running);
      setScraperLog(log || []);
      if (!running && loadingRef.current) {
        loadingRef.current = false;
        setLoading(false);
        setStatusMsg("✅ Extração concluída! Carregando resultados...");
        fetchCorretores();
        fetchBuscas();
        // Fecha o log automaticamente 3s após a extração terminar
        setTimeout(() => setShowLog(false), 3000);
        setTimeout(() => setStatusMsg(null), 5000);
      }
    } catch {}
  };


  // ── Live polling (refs para evitar stale closure) ───────────────────────────
  const fetchCorretoresRef = useRef(fetchCorretores);
  const pollStatusRef = useRef(pollStatus);
  const fetchBuscasRef = useRef(fetchBuscas);
  useEffect(() => { fetchCorretoresRef.current = fetchCorretores; });
  useEffect(() => { pollStatusRef.current = pollStatus; });
  useEffect(() => { fetchBuscasRef.current = fetchBuscas; });

  useEffect(() => {
    fetchBuscasRef.current();
    pollStatusRef.current();

    const dataInterval = isLive
      ? setInterval(() => fetchCorretoresRef.current(), 4000)
      : null;
    const statusInterval = setInterval(() => pollStatusRef.current(), 2000);

    return () => {
      if (dataInterval) clearInterval(dataInterval);
      clearInterval(statusInterval);
    };
  }, [isLive]);

  // ── Auto-scroll log ─────────────────────────────────────────────────────────
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [scraperLog]);

  // ── Start scrape ────────────────────────────────────────────────────────────
  const startScrape = async () => {
    if (!city.trim()) return;

    let parsedCity = city;
    let parsedNeighborhood = "";

    if (city.includes("-")) {
      [parsedCity, parsedNeighborhood] = city.split("-").map(s => s.trim());
    } else if (city.includes("/")) {
      [parsedCity, parsedNeighborhood] = city.split("/").map(s => s.trim());
    } else if (city.includes(",")) {
      [parsedCity, parsedNeighborhood] = city.split(",").map(s => s.trim());
    }

    loadingRef.current = true;
    dataReadyRef.current = true;
    setLoading(true);
    setScraperRunning(true);
    setScraperLog([]);
    setCorretores([]);
    activeSearchRef.current = { estado: state, cidade: parsedCity };
    setShowLog(true);
    try {
      await fetch(
        `/api/corretores?estado=${encodeURIComponent(state)}&cidade=${encodeURIComponent(parsedCity)}`,
        { method: "DELETE" }
      );
      setStatusMsg("🚀 Conectando ao Zap Imóveis...");
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, city: parsedCity, neighborhood: parsedNeighborhood }),
      });
      const data = await res.json();
      setStatusMsg(data.message);
      if (!data.running) {
        loadingRef.current = false;
        setLoading(false);
        setTimeout(() => setStatusMsg(null), 5000);
      }
    } catch {
      setStatusMsg("❌ Erro ao conectar ao servidor.");
      loadingRef.current = false;
      setLoading(false);
      setTimeout(() => setStatusMsg(null), 5000);
    }
  };

  const getWhatsAppUrl = (phone: string) => {
    const clean = phone.replace(/\D/g, "");
    return `https://wa.me/55${clean}`;
  };

  const markMsgEnviada = async (id: string) => {
    setCorretores(prev => prev.map(c => c.id === id ? { ...c, msg_enviada: 1 } : c));
    try {
      await fetch(`/api/corretores/${id}/msg_enviada`, { method: "POST" });
    } catch (e) {
      console.error("Erro ao marcar msg_enviada:", e);
    }
  };

  const stopScrape = async () => {
    try {
      const res = await fetch("/api/stop", { method: "POST" });
      const data = await res.json();
      setStatusMsg(data.message);
      setTimeout(() => setStatusMsg(null), 5000);
    } catch {
      setStatusMsg("❌ Erro ao tentar parar a busca.");
    }
  };

  const downloadCSV = () => {
    if (corretores.length === 0) return;
    const headers = ["Nome", "Imobiliária", "CRECI", "Telefone", "Estado", "Cidade", "Data de Captura"];
    const rows = corretores.map(c => [
      `"${c.nome}"`,
      `"${c.imobiliaria}"`,
      `"${c.creci}"`,
      `"${c.telefone}"`,
      `"${c.estado}"`,
      `"${c.cidade}"`,
      `"${new Date(c.criado_em).toLocaleString("pt-BR")}"`,
    ]);
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers, ...rows].map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `corretores_${city}_${state}_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
      {/* ── Buscas Salvas Modal ── */}
      <AnimatePresence>
        {showBuscas && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm"
            onClick={() => setShowBuscas(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="w-full max-w-lg mx-4 bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-500/10 rounded-lg">
                    <History className="w-4 h-4 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-sm">Buscas Salvas</h3>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mt-0.5">
                      {buscas.length} busca{buscas.length !== 1 ? "s" : ""} no banco
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowBuscas(false)}
                  className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto custom-scrollbar divide-y divide-slate-800/40">
                {buscas.length === 0 ? (
                  <div className="px-6 py-16 text-center">
                    <History className="w-10 h-10 text-slate-700 mx-auto mb-4" />
                    <p className="text-slate-500 text-sm">Nenhuma busca salva ainda.</p>
                    <p className="text-slate-600 text-xs mt-1">As buscas são salvas automaticamente ao concluir uma extração.</p>
                  </div>
                ) : (
                  buscas.map((busca, i) => {
                    const key = `${busca.estado}-${busca.cidade}`;
                    const isLoadingThis = loadingBusca === key;
                    const isConfirmingDelete = deletingId === busca.id;
                    return (
                      <motion.div
                        key={busca.id || i}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.04 }}
                        onClick={() => !loadingBusca && !isConfirmingDelete && loadBusca(busca)}
                        className={`w-full flex items-center justify-between gap-2 px-6 py-4 transition-all text-left group ${
                          isConfirmingDelete ? "bg-red-950/20 cursor-default" : "hover:bg-white/5 cursor-pointer"
                        }`}
                      >
                        <div className={`flex-1 flex items-center gap-4 text-left min-w-0 ${loadingBusca ? "opacity-60" : ""}`}>
                          <div className="p-2 bg-slate-800 rounded-lg shrink-0 group-hover:bg-purple-500/20 transition-colors">
                            <MapPin className="w-4 h-4 text-slate-500 group-hover:text-purple-400 transition-colors" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-semibold truncate">
                              <span className="text-purple-400">{busca.estado}</span>
                              {" / "}{busca.cidade}
                            </p>
                            <div className="flex items-center gap-3 mt-0.5">
                              <span className="flex items-center gap-1 text-[10px] text-slate-500">
                                <Users className="w-3 h-3" />{busca.total_contatos} contatos
                              </span>
                              <span className="flex items-center gap-1 text-[10px] text-slate-600">
                                <Clock className="w-3 h-3" />{new Date(busca.criado_em).toLocaleString("pt-BR")}
                              </span>
                            </div>
                          </div>
                          <div className="shrink-0 mr-2">
                            {isLoadingThis ? (
                              <RefreshCcw className="w-4 h-4 text-purple-400 animate-spin" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-purple-400 transition-colors" />
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 flex items-center gap-1 z-10" onClick={e => e.stopPropagation()}>
                          {isConfirmingDelete ? (
                            <div className="flex items-center gap-1.5 bg-red-950/40 border border-red-500/30 px-2 py-1 rounded-lg text-[10px] font-bold text-red-400">
                              <span>Excluir dados?</span>
                              <button onClick={e => { e.stopPropagation(); deleteBusca(busca); }} disabled={isDeleting} className="px-1.5 py-0.5 bg-red-500 text-slate-950 rounded hover:bg-red-400 transition-colors cursor-pointer">
                                {isDeleting ? "..." : "Sim"}
                              </button>
                              <button onClick={e => { e.stopPropagation(); setDeletingId(null); }} disabled={isDeleting} className="px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded hover:text-white transition-colors cursor-pointer">
                                Não
                              </button>
                            </div>
                          ) : (
                            <button onClick={e => { e.stopPropagation(); setDeletingId(busca.id || null); }} disabled={!!loadingBusca} className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all cursor-pointer" title="Excluir busca e liberar espaço">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
              <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/50">
                <p className="text-[10px] text-slate-600 text-center">Clique em uma busca para carregar os contatos na tabela</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="flex justify-between items-start p-8 pb-0 shrink-0">
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight">Painel de Leads</h2>
          <p className="text-slate-400 text-sm mt-1">Extração real de corretores do Zap Imóveis em tempo real.</p>
        </div>
        <div className="flex items-center gap-4">

          {/* Botão Buscas Salvas — mesmo padrão do Instagram */}
          {buscas.length > 0 && (
            <button
              onClick={() => { fetchBuscas(); setShowBuscas(true); }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 transition-all cursor-pointer shadow-sm active:scale-95"
            >
              <History className="w-4 h-4" />
              <span className="text-sm font-bold">Buscas Salvas</span>
              <span className="bg-purple-500/20 text-purple-400 text-[10px] font-black px-2 py-0.5 rounded-full ml-1">
                {buscas.length}
              </span>
            </button>
          )}

          {/* Contadores */}
          <div className="text-right">
            <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Total Capturado</p>
            <p className="text-2xl font-bold text-sky-400 font-mono leading-none">{corretores.length.toLocaleString()}</p>
          </div>
          <div className="h-10 w-[1px] bg-slate-800" />
          <div className="text-right">
            <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Bypass Cloudflare</p>
            <p className="text-2xl font-bold text-emerald-400 font-mono leading-none">ACTIVE</p>
          </div>
        </div>
      </header>

      {/* Filters */}
      <section className="shrink-0 px-8 pt-6">
        <div className="glass rounded-2xl p-6 flex items-end gap-6 shadow-2xl">
          <div className="w-32 flex-none space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">Estado (UF)</label>
            <div className="relative">
              <select
                value={state}
                onChange={e => setState(e.target.value)}
                disabled={scraperRunning}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-sky-500/50 outline-none appearance-none cursor-pointer transition-all hover:border-slate-600 disabled:opacity-50"
              >
                {UF_LIST.map(uf => <option key={uf} value={uf}>{uf}</option>)}
              </select>
              <ChevronDownIcon className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            </div>
          </div>
          <div className="flex-1 space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1">Cidade / Bairro</label>
            <input
              type="text"
              value={city}
              onChange={e => setCity(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !scraperRunning && startScrape()}
              disabled={scraperRunning}
              placeholder="Ex: Niterói, ou Rio de Janeiro - Freguesia"
              className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-sky-500/50 outline-none transition-all hover:border-slate-600 placeholder:text-slate-600 disabled:opacity-50"
            />
          </div>
          <div className="flex gap-3 shrink-0">
            <button onClick={stopScrape} disabled={!scraperRunning} className="h-[52px] px-6 bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-400 disabled:opacity-30 disabled:hover:bg-slate-800 disabled:hover:text-slate-400 disabled:cursor-not-allowed font-black rounded-xl transition-all flex items-center gap-2 uppercase text-xs tracking-widest border border-slate-700/50 hover:border-red-500/50 disabled:border-transparent">
              <X className="w-4 h-4" /> Parar Busca
            </button>
            <button onClick={startScrape} disabled={loading || scraperRunning} className="h-[52px] px-8 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-black rounded-xl transition-all flex items-center gap-2 active:scale-[0.98] shadow-lg shadow-sky-500/20 uppercase text-xs tracking-widest">
              {scraperRunning ? (
                <><RefreshCcw className="w-4 h-4 animate-spin" /> Extraindo...</>
              ) : (
                <><span>Iniciar Captura</span><Play className="w-4 h-4 fill-current" /></>
              )}
            </button>
          </div>
        </div>
        <AnimatePresence>
          {statusMsg && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="mt-3 bg-sky-500/10 border border-sky-500/30 px-5 py-3 rounded-xl flex items-center gap-3 text-sky-400 text-sm font-medium">
              <div className="w-2 h-2 bg-sky-500 rounded-full animate-pulse shrink-0" />
              <span className="flex-1">{statusMsg}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Log Panel */}
      <AnimatePresence>
        {showLog && (
          <motion.section initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="shrink-0 px-8 pt-4 overflow-hidden">
            <div className="glass rounded-xl overflow-hidden border border-slate-800">
              <div className="flex items-center justify-between px-4 py-2 bg-slate-900/80 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-yellow-400" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Log do Motor de Extração</span>
                  {scraperRunning && <span className="text-[9px] bg-yellow-400/20 text-yellow-400 px-2 py-0.5 rounded-full font-bold animate-pulse">AO VIVO</span>}
                </div>
                <button onClick={() => setShowLog(false)} className="text-slate-500 hover:text-white transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="h-28 overflow-y-auto p-3 space-y-0.5 font-mono text-[11px] bg-slate-950/80">
                {scraperLog.length === 0 ? (
                  <p className="text-slate-600 italic">Aguardando início da extração...</p>
                ) : (
                  [...scraperLog].reverse().map((line, i) => (
                    <p key={i} className={`leading-5 ${
                      line.includes("❌") || line.includes("🔥") || line.includes("⚠️") ? "text-red-400"
                      : line.includes("✅") || line.includes("🏁") ? "text-emerald-400"
                      : line.includes("🚀") || line.includes("📞") ? "text-sky-400"
                      : "text-slate-400"
                    }`}>{line}</p>
                  ))
                )}
                <div ref={logEndRef} />
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Table */}
      <section className="flex-1 min-h-0 mx-8 mt-4 mb-8 glass rounded-2xl flex flex-col overflow-hidden shadow-2xl">
        <div className="border-b border-slate-800 px-6 py-4 flex justify-between items-center bg-slate-900/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-800 rounded-lg"><Database className="w-4 h-4 text-sky-500" /></div>
            <h3 className="font-bold text-white uppercase tracking-tight text-sm">Base de Corretores Capturados</h3>
          </div>
          <div className="flex gap-2">
            <button onClick={downloadCSV} disabled={corretores.length === 0} className="flex items-center gap-2 px-3 py-1.5 text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-all text-xs font-bold uppercase" title="Baixar em CSV (Excel)">
              <Download className="w-4 h-4" /> Baixar Planilha
            </button>
            <button onClick={() => { dataReadyRef.current = true; fetchCorretores(); }} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all" title="Sincronizar agora">
              <RefreshCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="min-w-[800px]">
            <div className="grid grid-cols-12 text-[10px] uppercase font-black tracking-widest text-slate-500 border-b border-slate-800 sticky top-0 bg-slate-900/95 backdrop-blur-md z-10 px-6 py-4">
              <div className="col-span-4">Nome / Imobiliária</div>
              <div className="col-span-2">CRECI</div>
              <div className="col-span-2">Região</div>
              <div className="col-span-2">Contato</div>
              <div className="col-span-2 text-right pr-6">Ação</div>
            </div>
            <div className="divide-y divide-slate-800/40">
              <AnimatePresence mode="popLayout">
                {corretores.length === 0 ? (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-6 py-24 text-center">
                    <Database className="w-10 h-10 text-slate-700 mx-auto mb-4" />
                    <p className="text-slate-500 font-medium">
                      {scraperRunning ? "⏳ Extraindo contatos reais do Zap Imóveis..." : "Aguardando dados... Preencha os campos e inicie uma captura."}
                    </p>
                  </motion.div>
                ) : (
                  corretores.map(corretor => {
                    const isMsgEnviada = corretor.msg_enviada === 1 || corretor.msg_enviada === true;
                    return (
                    <motion.div layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, scale: 0.98 }} key={corretor.id} className={`grid grid-cols-12 items-center px-6 py-4 transition-all group ${isMsgEnviada ? 'bg-emerald-900/20 border-l-2 border-emerald-500/50 hover:bg-emerald-900/30' : 'hover:bg-white/5'}`}>
                      <div className="col-span-4 flex flex-col">
                        <span className="text-white text-sm group-hover:text-sky-400 transition-colors uppercase tracking-tight font-semibold">{corretor.nome}</span>
                        <span className="text-[9px] text-slate-500 uppercase tracking-widest font-black mt-0.5">{corretor.imobiliaria || "Corretor Independente"}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="inline-block text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2 py-1 rounded border border-slate-700/50">{corretor.creci || "N/A"}</span>
                      </div>
                      <div className="col-span-2">
                        <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
                          <MapPin className="w-3 h-3 text-slate-700" />{corretor.cidade} - {corretor.estado}
                        </div>
                      </div>
                      <div className="col-span-2 select-all">
                        <span className="text-sky-400 font-mono font-bold text-sm tracking-tight">{corretor.telefone}</span>
                      </div>
                      <div className="col-span-2 text-right pr-6">
                        {corretor.telefone && corretor.telefone !== "Não informado" ? (
                          (() => {
                            const clean = corretor.telefone.replace(/\D/g, "");
                            const isCelular = (clean.length === 11 && clean[2] === "9") || (clean.length === 13 && clean.startsWith("55") && clean[4] === "9");
                            if (isCelular) {
                              return (
                                <a href={getWhatsAppUrl(corretor.telefone)} target="_blank" rel="noreferrer" onClick={() => markMsgEnviada(corretor.id)} className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-[10px] font-black uppercase tracking-tighter hover:bg-emerald-500 hover:text-slate-950 hover:border-emerald-500 transition-all active:scale-95">
                                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                                </a>
                              );
                            }
                            return <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-4 py-2">Ligar</span>;
                          })()
                        ) : (
                          <span className="text-[10px] text-slate-600 font-mono">Sem telefone</span>
                        )}
                      </div>
                    </motion.div>
                    );
                  })
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
          <div className="flex items-center gap-5">
            <span className="flex items-center gap-2 text-slate-400">
              Status Scraper
              <span className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${scraperRunning ? "bg-yellow-400 animate-pulse" : "bg-emerald-400"}`} />
                <span className={scraperRunning ? "text-yellow-400" : "text-emerald-400"}>{scraperRunning ? "Running" : "Idle"}</span>
              </span>
            </span>
            <span className="w-px h-4 bg-slate-700" />
            <span className="flex items-center gap-2 text-slate-400">
              Modo Live
              <span className={`px-2 py-0.5 rounded text-[9px] font-black ${isLive ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-500"}`}>
                {isLive ? "ON" : "OFF"}
              </span>
            </span>
            <span className="w-px h-4 bg-slate-700" />
            <div className="flex items-center gap-1.5 text-emerald-400">
              <ShieldCheckIcon className="w-3.5 h-3.5" /> Cloudflare Bypass Active
            </div>
          </div>
        </div>

      </section>
    </main>
  );
}

// ── Inline SVG helpers ─────────────────────────────────────────────────────────
function ChevronDownIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ShieldCheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}
