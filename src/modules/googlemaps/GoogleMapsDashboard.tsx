import React, { useState, useEffect, useRef } from "react";
import {
  MapPin,
  Search,
  Loader2,
  Globe,
  Phone,
  Building2,
  ExternalLink,
  Star,
  History,
  X,
  ChevronRight,
  Trash2,
  ShieldCheck,
  Download,
  RefreshCcw,
  Play,
  CheckCircle2,
  MessageCircle
} from "lucide-react";

interface GmapsBusca {
  id: number;
  keyword: string;
  location: string;
  total_leads: number;
  criado_em: string;
}

interface GmapsLead {
  id: number;
  gmb_id: string;
  company_name: string;
  google_rating: number;
  reviews_count: number;
  is_claimed: boolean;
  phone_raw: string | null;
  phone_e164: string | null;
  phone_type: string;
  has_whatsapp: boolean;
  website_url: string | null;
  website_status: string;
  opportunity_score: number;
  primary_pitch: string;
  msg_enviada?: number | boolean;
  busca_id: number;
  criado_em: string;
}

export default function GoogleMapsDashboard() {
  // Buscas State
  const [buscas, setBuscas] = useState<GmapsBusca[]>([]);
  const [activeSearch, setActiveSearch] = useState<string | null>(null);
  const [showBuscas, setShowBuscas] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(25);

  // Scraper State
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("");
  const [loading, setLoading] = useState(false);
  const [scraperRunning, setScraperRunning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [scraperLog, setScraperLog] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);

  // Data State
  const [leads, setLeads] = useState<GmapsLead[]>([]);

  const logEndRef = useRef<HTMLDivElement>(null);
  const pollStatusRef = useRef<() => void>(() => {});

  // ── Initial Fetch ───────────────────────────────────────────────────────────
  useEffect(() => {
    fetchBuscas();
    fetchLeads();
  }, []);

  const fetchBuscas = async () => {
    try {
      const res = await fetch("/api/gmaps/buscas");
      const data = await res.json();
      setBuscas(data || []);
    } catch {}
  };

  const fetchLeads = async (buscaId?: string) => {
    try {
      const url = buscaId && buscaId !== "*" ? `/api/gmaps/leads?buscaId=${buscaId}` : "/api/gmaps/leads";
      const res = await fetch(url);
      const data = await res.json();
      setLeads(data || []);
      setVisibleCount(25);
    } catch {}
  };

  // ── Polling status and logs ──────────────────────────────────────────────────
  const pollStatus = async () => {
    try {
      const res = await fetch("/api/gmaps/status");
      if (!res.ok) return;
      const { running, log } = await res.json();
      setScraperRunning(running);
      setScraperLog(log || []);
      if (!running && loading) {
        setLoading(false);
        fetchBuscas();
        fetchLeads(activeSearch || undefined);
        setStatusMsg("✅ Extração concluída!");
        setTimeout(() => setStatusMsg(null), 5000);
      }
    } catch {}
  };

  useEffect(() => {
    pollStatusRef.current = pollStatus;
  });

  useEffect(() => {
    const statusInterval = setInterval(() => pollStatusRef.current(), 2000);
    return () => clearInterval(statusInterval);
  }, [loading, activeSearch]);

  useEffect(() => {
    if (autoScroll) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [scraperLog, autoScroll]);

  const handleLogScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) <= 5;
    setAutoScroll(isAtBottom);
  };

  // ── Actions ──────────────────────────────────────────────────────────────────
  const startScrape = async () => {
    if (!keyword.trim() || !location.trim()) return;

    setLoading(true);
    setScraperRunning(true);
    setScraperLog([]);
    setStatusMsg(`🚀 Conectando ao Google Maps para buscar "${keyword}" em "${location}"...`);

    try {
      const res = await fetch("/api/gmaps/extract-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, location }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(`❌ Erro: ${data.error || data.message}`);
        setLoading(false);
        setScraperRunning(false);
      } else {
        setStatusMsg(data.message);
      }
    } catch {
      setStatusMsg("❌ Erro ao conectar ao servidor.");
      setLoading(false);
      setScraperRunning(false);
    }
  };

  const stopScrape = async () => {
    try {
      const res = await fetch("/api/gmaps/stop", { method: "POST" });
      const data = await res.json();
      setStatusMsg(data.message);
      setTimeout(() => setStatusMsg(null), 5000);
    } catch {
      setStatusMsg("❌ Erro ao tentar parar a extração.");
    }
  };

  const deleteSearch = async (id: number) => {
    try {
      await fetch(`/api/gmaps/buscas/${id}`, { method: "DELETE" });
      fetchBuscas();
      if (activeSearch === String(id)) {
        setActiveSearch("*");
        fetchLeads("*");
      } else {
        fetchLeads(activeSearch || undefined);
      }
      setDeletingId(null);
    } catch {}
  };

  const markMsgEnviada = async (id: number) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, msg_enviada: 1 } : l));
    try {
      await fetch(`/api/gmaps/leads/${id}/msg_enviada`, { method: "POST" });
    } catch (e) {
      console.error("Erro ao marcar msg_enviada:", e);
    }
  };

  const downloadCSV = () => {
    if (leads.length === 0) return;
    const headers = ["Empresa", "Telefone Limpo", "Telefone Original", "WhatsApp?", "Website", "Status Site", "Rating Google", "Reviews", "Score Oportunidade", "Pitch Comercial", "Data Captura"];
    const rows = leads.map(l => [
      `"${l.company_name.replace(/"/g, '""')}"`,
      `"${l.phone_e164 || ''}"`,
      `"${l.phone_raw || ''}"`,
      `"${l.has_whatsapp ? 'Sim' : 'Não'}"`,
      `"${l.website_url || ''}"`,
      `"${l.website_status}"`,
      `"${l.google_rating}"`,
      `"${l.reviews_count}"`,
      `"${l.opportunity_score}"`,
      `"${l.primary_pitch.replace(/"/g, '""')}"`,
      `"${new Date(l.criado_em).toLocaleString("pt-BR")}"`,
    ]);
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers, ...rows].map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `gmaps_leads_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getWhatsAppUrl = (phone: string) => {
    const clean = phone.replace(/\D/g, "");
    return `https://wa.me/${clean}`;
  };

  const getActiveSearchName = () => {
    if (!activeSearch || activeSearch === "*") return "Todos os contatos";
    const b = buscas.find(x => String(x.id) === activeSearch);
    return b ? `"${b.keyword}" em ${b.location}` : "Busca Selecionada";
  };

  return (
    <main className="flex-1 flex flex-col bg-slate-950 overflow-y-auto custom-scrollbar font-sans relative">
      <div className="absolute top-0 left-0 w-full h-[300px] bg-gradient-to-b from-blue-900/10 to-transparent pointer-events-none" />

      {/* ── Buscas Salvas Modal ── */}
      {showBuscas && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm"
          onClick={() => setShowBuscas(false)}
        >
          <div
            className="w-full max-w-lg mx-4 bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-yellow-500/10 rounded-lg">
                  <History className="w-4 h-4 text-yellow-500" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">Histórico de Buscas (Maps)</h3>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mt-0.5">
                    {buscas.length} buscas salvas no SQLite
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowBuscas(false)}
                className="p-2 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="max-h-[60vh] overflow-y-auto custom-scrollbar divide-y divide-slate-800/40">
              {buscas.length === 0 ? (
                <div className="px-6 py-12 text-center text-slate-500 text-sm">
                  Nenhuma busca salva no banco local ainda.
                </div>
              ) : (
                buscas.map((b, i) => {
                  const isConfirmingDelete = deletingId === b.id;
                  return (
                    <div
                      key={b.id || i}
                      onClick={() => {
                        if (!isConfirmingDelete) {
                          setActiveSearch(String(b.id));
                          fetchLeads(String(b.id));
                          setShowBuscas(false);
                        }
                      }}
                      className={`w-full flex items-center justify-between gap-2 px-6 py-4 transition-all text-left group ${
                        isConfirmingDelete ? "bg-red-950/20 cursor-default" : "hover:bg-white/5 cursor-pointer"
                      }`}
                    >
                      <div className="flex-1 flex items-center gap-4 text-left min-w-0">
                        <div className="p-2 bg-slate-800 rounded-lg shrink-0 group-hover:bg-yellow-500/20 transition-colors">
                          <MapPin className="w-4 h-4 text-slate-500 group-hover:text-yellow-500 transition-colors" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-semibold truncate">
                            Nicho: <span className="text-yellow-400">"{b.keyword}"</span>
                          </p>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="flex items-center gap-1 text-[10px] text-slate-500">
                              📍 {b.location}
                            </span>
                            <span className="flex items-center gap-1 text-[10px] text-slate-500">
                              • {b.total_leads} leads
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 mr-2">
                          <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-yellow-500 transition-colors" />
                        </div>
                      </div>
                      
                      <div className="shrink-0 flex items-center gap-1 z-10" onClick={e => e.stopPropagation()}>
                        {isConfirmingDelete ? (
                          <div className="flex items-center gap-1.5 bg-red-950/40 border border-red-500/30 px-2 py-1 rounded-lg text-[10px] font-bold text-red-400">
                            <span>Excluir?</span>
                            <button onClick={e => { e.stopPropagation(); deleteSearch(b.id); }} className="px-1.5 py-0.5 bg-red-500 text-slate-950 rounded hover:bg-red-400 transition-colors cursor-pointer">
                              Sim
                            </button>
                            <button onClick={e => { e.stopPropagation(); setDeletingId(null); }} className="px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded hover:text-white transition-colors cursor-pointer">
                              Não
                            </button>
                          </div>
                        ) : (
                          <button onClick={e => { e.stopPropagation(); setDeletingId(b.id); }} className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all cursor-pointer" title="Excluir busca">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/50 flex justify-between items-center">
              <p className="text-[10px] text-slate-600 text-center flex-1">Clique para carregar os leads da busca na tabela</p>
              {activeSearch && activeSearch !== "*" && (
                <button onClick={() => { setActiveSearch("*"); fetchLeads("*"); setShowBuscas(false); }} className="text-[10px] font-bold text-yellow-500 uppercase tracking-widest hover:text-yellow-400 cursor-pointer">
                  Ver Todas
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex justify-between items-start p-8 pb-0 shrink-0 z-10 relative">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500 via-orange-500 to-[#E60000] flex items-center justify-center shadow-lg shadow-yellow-500/20">
              <MapPin className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-3xl font-bold text-white tracking-tight">Google Maps Scraper</h2>
          </div>
          <p className="text-slate-400 text-sm mt-1">Extração de estabelecimentos locais e B2B Leads com enriquecimento comercial.</p>
        </div>

        <div className="flex items-center gap-4">
          {buscas.length > 0 && (
            <button
              onClick={() => setShowBuscas(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 hover:bg-yellow-500/20 transition-all cursor-pointer shadow-sm active:scale-95"
            >
              <History className="w-4 h-4" />
              <span className="text-sm font-bold">Buscas Salvas</span>
              <span className="bg-yellow-500/20 text-yellow-400 text-[10px] font-black px-2 py-0.5 rounded-full ml-1">
                {buscas.length}
              </span>
            </button>
          )}

          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shadow-sm">
            <CheckCircle2 className="w-4 h-4" />
            <div className="text-right">
              <p className="text-[9px] uppercase font-black tracking-widest opacity-80">Motor Stealth</p>
              <p className="text-sm font-bold">ATIVO</p>
            </div>
          </div>
        </div>
      </header>

      {/* Controls */}
      <section className="shrink-0 px-8 pt-6 z-10 relative">
        <div className="glass rounded-2xl p-6 flex flex-col gap-4 shadow-2xl relative overflow-hidden border border-slate-800 bg-slate-900/45">
          <div className="absolute inset-0 bg-gradient-to-r from-yellow-500/5 via-orange-500/5 to-transparent pointer-events-none" />

          <div className="flex gap-4 relative z-10 items-end">
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Palavra-chave / Nicho</label>
              <input
                type="text"
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !scraperRunning && startScrape()}
                disabled={scraperRunning}
                placeholder="Ex: Barbearia, Dentista, Clínica..."
                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-yellow-500/50 outline-none transition-all placeholder:text-slate-700 font-medium"
              />
            </div>
            
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Localidade</label>
              <input
                type="text"
                value={location}
                onChange={e => setLocation(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !scraperRunning && startScrape()}
                disabled={scraperRunning}
                placeholder="Ex: Duque de Caxias, Rio de Janeiro..."
                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-yellow-500/50 outline-none transition-all placeholder:text-slate-700 font-medium"
              />
            </div>

            <button
              onClick={stopScrape}
              disabled={!scraperRunning}
              className="px-6 bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-400 disabled:opacity-30 disabled:hover:bg-slate-800 disabled:hover:text-slate-400 disabled:cursor-not-allowed font-black h-[46px] rounded-xl transition-all flex items-center gap-2 uppercase text-xs tracking-widest border border-slate-700/50 hover:border-red-500/50 disabled:border-transparent cursor-pointer"
            >
              <X className="w-4 h-4" /> Parar Extração
            </button>
            <button
              onClick={startScrape}
              disabled={loading || scraperRunning}
              className="px-8 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400 text-white font-black h-[46px] rounded-xl transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50 uppercase text-xs tracking-widest shadow-lg shadow-yellow-500/10 cursor-pointer"
            >
              {scraperRunning ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Extraindo...</>
              ) : (
                <><span>Iniciar Scraping</span><Play className="w-4 h-4 fill-current" /></>
              )}
            </button>
          </div>

          <div className="flex items-start gap-3 mt-2 p-3 text-yellow-400 text-sm font-bold border-2 border-yellow-500/50 rounded-xl bg-yellow-500/10 animate-[pulse_2s_ease-in-out_infinite] shadow-[0_0_15px_rgba(234,179,8,0.2)]">
            <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5 text-yellow-400" />
            <p>
              ATENÇÃO: Ao iniciar a busca, o navegador será aberto. Pode ser exigida a resolução manual de um CAPTCHA (teste de imagem) pelo Google. Fique atento à janela do robô!
            </p>
          </div>

          {statusMsg && (
            <div className="mt-2 bg-slate-950 border border-slate-800 px-4 py-2.5 rounded-lg flex items-center gap-3 text-slate-300 text-sm">
              {scraperRunning && <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />}
              {statusMsg}
            </div>
          )}
        </div>
      </section>

      {/* Log Terminal Panel */}
      {scraperRunning && (
        <section className="shrink-0 px-8 pt-4 z-10 relative">
          <div className="bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-inner">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800 bg-slate-900">
              <Globe className="w-3.5 h-3.5 text-yellow-500" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Terminal Google Maps Playwright Stealth</span>
            </div>
            <div
              className="h-32 overflow-y-auto p-3 space-y-1 font-mono text-[11px] custom-scrollbar"
              onScroll={handleLogScroll}
            >
              {scraperLog.map((line, i) => (
                <p key={i} className={`leading-tight ${line.includes("🚨") || line.includes("🔥") ? "text-red-400" : line.includes("💾") || line.includes("✅") ? "text-emerald-400" : "text-slate-400"}`}>
                  {line}
                </p>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </section>
      )}

      {/* Table Section */}
      <section className="mx-8 mt-6 mb-8 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col shadow-xl z-10 relative">
        <div className="border-b border-slate-800 px-6 py-4 flex justify-between items-center bg-slate-900 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-950 rounded-lg border border-slate-800">
              <Building2 className="w-4 h-4 text-yellow-500" />
            </div>
            <div>
              <h3 className="font-bold text-white uppercase tracking-tight text-sm">Leads Extraídos</h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">
                Exibindo: {getActiveSearchName()} ({leads.length} leads)
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={downloadCSV}
              disabled={leads.length === 0}
              className="flex items-center gap-2 px-3 py-1.5 text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-50 rounded-lg text-xs font-bold uppercase transition-colors cursor-pointer border border-slate-800"
            >
              <Download className="w-4 h-4" /> CSV
            </button>
            <button
              onClick={() => fetchLeads(activeSearch || undefined)}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer border border-slate-800"
            >
              <RefreshCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="relative">
          {leads.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8">
              <MapPin className="w-12 h-12 text-slate-800 mb-3" />
              <p className="text-slate-500 font-medium max-w-sm">
                Nenhum lead carregado. Escolha uma busca histórica ou execute um novo scraping.
              </p>
            </div>
          ) : (
            <div className="p-6 space-y-4">
              {leads.slice(0, visibleCount).map((lead, idx) => {
                const score = lead.opportunity_score;
                const isHigh = score >= 80;
                const isMid = score >= 50 && score < 80;
                const isMsgEnviada = lead.msg_enviada === 1 || lead.msg_enviada === true;

                return (
                  <div
                    key={lead.id || idx}
                    className={`bg-slate-950 border border-slate-800/80 rounded-xl p-5 transition-colors flex gap-6 items-center ${
                      lead.website_status === "Inativo/Quebrado" ? "border-l-4 border-l-red-500" : ""
                    } ${isMsgEnviada ? 'bg-emerald-900/20 border-l-2 border-emerald-500/50 hover:bg-emerald-900/30' : 'hover:border-yellow-500/40'}`}
                  >
                    {/* Circle Score */}
                    <div className={`flex flex-col items-center justify-center shrink-0 w-16 h-16 rounded-full border-4 relative ${
                      isHigh ? 'border-green-500/20' : isMid ? 'border-yellow-500/20' : 'border-red-500/20'
                    }`}>
                      <span className={`text-xl font-black ${isHigh ? 'text-green-400' : isMid ? 'text-yellow-400' : 'text-red-400'}`}>
                        {score}
                      </span>
                      <span className="text-[8px] uppercase font-bold text-slate-500 absolute -bottom-2 bg-slate-950 px-1">Score</span>
                    </div>

                    {/* Basic Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h3 className="text-base font-bold text-white truncate max-w-xs">{lead.company_name}</h3>
                        {!lead.is_claimed && (
                          <span className="bg-orange-500/10 text-orange-400 border border-orange-500/20 text-[9px] px-2 py-0.5 rounded-full font-bold uppercase">
                            Não Reivindicado
                          </span>
                        )}
                        {lead.website_status === "Inativo/Quebrado" && (
                          <span className="bg-red-500/10 text-red-400 border border-red-500/20 text-[9px] px-2 py-0.5 rounded-full font-bold uppercase">
                            Site Off/Quebrado
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-2.5 text-xs text-slate-400">
                        <span className="flex items-center gap-1.5" title="Google Rating">
                          <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                          <span className="font-bold text-slate-200">{lead.google_rating}</span>
                          <span className="text-slate-500">({lead.reviews_count} avaliações)</span>
                        </span>

                        {lead.phone_e164 && lead.phone_type === "MOBILE" ? (
                          <a
                            href={getWhatsAppUrl(lead.phone_e164)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => markMsgEnviada(lead.id)}
                            className="flex items-center gap-1.5 hover:text-green-400 transition-colors font-semibold"
                            title="Chamar no WhatsApp"
                          >
                            <MessageCircle className="w-3.5 h-3.5 text-green-500" />
                            {lead.phone_e164}
                            <span className="text-[8px] bg-green-500/10 text-green-400 px-1 rounded uppercase font-bold">Cel</span>
                          </a>
                        ) : (
                          <span className="flex items-center gap-1.5 text-slate-500">
                            <Phone className="w-3.5 h-3.5 opacity-60" />
                            {lead.phone_e164 || lead.phone_raw || "Sem Telefone"}
                          </span>
                        )}

                        {lead.website_url ? (
                          <a
                            href={lead.website_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`flex items-center gap-1.5 hover:underline transition-colors ${
                              lead.website_status === "Ativo" ? "text-blue-400" : "text-red-400"
                            }`}
                            title={lead.website_url}
                          >
                            <Globe className="w-3.5 h-3.5" />
                            {lead.website_status === "Ativo" ? "Website Ativo" : "Website Inativo"}
                            <ExternalLink className="w-3 h-3 opacity-60" />
                          </a>
                        ) : (
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <Globe className="w-3.5 h-3.5" /> Sem Site
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Outreach Pitch */}
                    <div className="w-1/3 border-l border-slate-800/80 pl-6 flex flex-col justify-center shrink-0">
                      <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Pitch Comercial</span>
                      <p className="text-xs text-slate-300 leading-relaxed line-clamp-2">{lead.primary_pitch}</p>
                    </div>
                  </div>
                );
              })}
              {leads.length > visibleCount && (
                <div className="px-6 py-3 bg-slate-950/30 flex justify-center border-t border-slate-800/50 mt-4 rounded-xl">
                  <button 
                    onClick={() => setVisibleCount(prev => prev + 25)}
                    className="text-[10px] font-bold uppercase tracking-widest text-yellow-400 hover:text-white bg-yellow-500/10 hover:bg-yellow-500/30 border border-yellow-500/20 px-4 py-2 rounded-lg transition-all flex items-center gap-2"
                  >
                    <RefreshCcw className="w-3 h-3" />
                    Carregar mais (+25 de {leads.length - visibleCount} restantes)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-900/50 flex justify-between items-center text-[10px] uppercase font-black shrink-0">
          <span className="text-slate-500">Módulo Google Maps Independente</span>
          <div className="flex items-center gap-1.5 text-yellow-500">
            <ShieldCheck className="w-3.5 h-3.5" /> Anti-Bloqueio & Caching SQLite Ativos
          </div>
        </div>
      </section>
    </main>
  );
}
