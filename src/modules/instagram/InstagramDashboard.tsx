import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Instagram,
  Search,
  Key,
  Terminal,
  Database,
  X,
  Play,
  RefreshCcw,
  CheckCircle2,
  AlertCircle,
  MessageCircle,
  Download,
  ShieldCheck,
  Send,
  Users,
  History,
  MapPin,
  Clock,
  Trash2,
  ChevronRight,
  Check
} from "lucide-react";

interface IgPerfil {
  id: string;
  username: string;
  nome_completo: string;
  bio: string;
  seguidores: number;
  seguindo: number;
  posts: number;
  telefone_extraido: string | null;
  link_bio: string | null;
  email_extraido?: string | null;
  is_business: boolean;
  criado_em: string;
  perfil_pai?: string | null;
  dm_enviado?: boolean;
}

export default function InstagramDashboard({ sectionRequest = "profile" }: { sectionRequest?: string }) {
  // Session State
  const [hasSession, setHasSession] = useState(false);
  const [sessionCookie, setSessionCookie] = useState("");
  const [sessionUsername, setSessionUsername] = useState("");
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [savingSession, setSavingSession] = useState(false);

  // Scraper State
  const [targetUser, setTargetUser] = useState("");
  const [loading, setLoading] = useState(false);
  const [scraperRunning, setScraperRunning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  
  // Data State
  const [perfis, setPerfis] = useState<IgPerfil[]>([]);
  const [scraperLog, setScraperLog] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  
  // Bulk DM State
  const [selectedFollowers, setSelectedFollowers] = useState<string[]>([]);
  const [showDmPanel, setShowDmPanel] = useState(false);
  const [messageTemplate, setMessageTemplate] = useState("Olá {nome}, tudo bem?");
  const [sendingDMs, setSendingDMs] = useState(false);

  // Search Filter
  const [activeSearch, setActiveSearch] = useState<string | null>(null);
  const [showBuscas, setShowBuscas] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [visibleFollowersMap, setVisibleFollowersMap] = useState<Record<string, number>>({});
  
  const logEndRef = useRef<HTMLDivElement>(null);
  const pollStatusRef = useRef<() => void>(() => {});

  // ── Initial Data ────────────────────────────────────────────────────────────
  useEffect(() => {
    checkSession();
    fetchPerfis();
  }, []);

  const checkSession = async () => {
    try {
      const res = await fetch("/api/ig/session");
      const data = await res.json();
      setHasSession(data.hasSession);
    } catch {}
  };

  const fetchPerfis = async () => {
    try {
      const res = await fetch("/api/ig/perfis");
      const data = await res.json();
      setPerfis(data);
    } catch {}
  };

  // ── Polling ────────────────────────────────────────────────────────────────
  const pollStatus = async () => {
    try {
      const res = await fetch("/api/ig/status");
      if (!res.ok) return;
      const { running, log } = await res.json();
      setScraperRunning(running);
      setScraperLog(log || []);
      if (!running) {
        if (loading) {
          setLoading(false);
          fetchPerfis(); // Atualiza após terminar
          setStatusMsg("✅ Extração concluída!");
          setTimeout(() => setStatusMsg(null), 5000);
        } else if (sendingDMs) {
          setSendingDMs(false);
          fetchPerfis(); // Atualiza após terminar
          setStatusMsg("✅ Disparo concluído!");
          setTimeout(() => setStatusMsg(null), 5000);
        }
      }
    } catch {}
  };

  useEffect(() => {
    pollStatusRef.current = pollStatus;
  });

  useEffect(() => {
    const statusInterval = setInterval(() => pollStatusRef.current(), 2000);
    return () => clearInterval(statusInterval);
  }, []);

  useEffect(() => {
    if (autoScroll) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [scraperLog, autoScroll]);

  const handleLogScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) <= 5;
    setAutoScroll(isAtBottom);
  };

  // ── Actions ────────────────────────────────────────────────────────────────
  const interactiveLogin = async () => {
    setSavingSession(true);
    setStatusMsg("🚀 Abrindo navegador para Login...");
    try {
      const res = await fetch("/api/ig/interactive-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "MinhaConta" })
      });
      const data = await res.json();
      if (res.ok) {
        setHasSession(true);
        alert("Sessão capturada com sucesso!");
        setStatusMsg(null);
      } else {
        alert("Erro: " + data.error);
        setStatusMsg(null);
      }
    } catch {
      alert("Erro ao conectar ao backend.");
      setStatusMsg(null);
    }
    setSavingSession(false);
  };

  const logout = async () => {
    if (!confirm("Tem certeza que deseja desconectar?")) return;
    try {
      await fetch("/api/ig/logout", { method: "POST" });
      setHasSession(false);
      alert("Logout realizado.");
    } catch {}
  };

  const deleteSearch = async (pai: string) => {
    try {
      await fetch(`/api/ig/buscas/${pai}`, { method: "DELETE" });
      fetchPerfis();
    } catch {}
  };

  const startScrape = async () => {
    if (!targetUser.trim()) return;
    if (!hasSession) {
      setShowSessionModal(true);
      return;
    }
    
    const cleanUser = targetUser.replace("@", "").trim();
    setActiveSearch(cleanUser);
    
    setLoading(true);
    setScraperRunning(true);
    setScraperLog([]);
    setStatusMsg(`🚀 Conectando ao Instagram para buscar @${cleanUser}...`);
    
    try {
      const res = await fetch("/api/ig/scrape-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUsername: cleanUser }),
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
      const res = await fetch("/api/ig/stop", { method: "POST" });
      const data = await res.json();
      setStatusMsg(data.message);
      setTimeout(() => setStatusMsg(null), 5000);
    } catch {
      setStatusMsg("❌ Erro ao tentar parar a extração.");
    }
  };

  // ── Bulk DM Logic ───────────────────────────────────────────────────────────
  const toggleFollower = (username: string) => {
    setSelectedFollowers(prev => 
      prev.includes(username) ? prev.filter(u => u !== username) : [...prev, username]
    );
  };

  const toggleAllFollowers = (followersList: IgPerfil[]) => {
    const allUsernames = followersList.map(f => f.username);
    const areAllSelected = allUsernames.every(u => selectedFollowers.includes(u));
    if (areAllSelected) {
      setSelectedFollowers(prev => prev.filter(u => !allUsernames.includes(u)));
    } else {
      setSelectedFollowers(prev => [...new Set([...prev, ...allUsernames])]);
      setShowDmPanel(true); // Abre automaticamente ao selecionar todos
    }
  };

  const sendBulkDMs = async () => {
    if (selectedFollowers.length === 0) return;
    if (!messageTemplate.trim()) {
      alert("A mensagem não pode estar vazia.");
      return;
    }
    
    setSendingDMs(true);
    setScraperRunning(true);
    setScraperLog([]);
    setStatusMsg(`🚀 Iniciando disparo de DMs para ${selectedFollowers.length} perfis...`);

    try {
      const res = await fetch("/api/ig/send-bulk-dms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          targets: selectedFollowers,
          template: messageTemplate 
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(`❌ Erro: ${data.error || data.message}`);
        setSendingDMs(false);
        setScraperRunning(false);
      } else {
        setStatusMsg(data.message);
        // Marca como enviado no banco
        try {
          await fetch("/api/ig/marcar-dm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ usernames: selectedFollowers }),
          });
          fetchPerfis(); // Atualiza a tabela
        } catch {}
      }
    } catch {
      setStatusMsg("❌ Erro ao conectar ao servidor para enviar DMs.");
      setSendingDMs(false);
      setScraperRunning(false);
    }
  };

  const getWhatsAppUrl = (phone: string) => {
    const clean = phone.replace(/\D/g, "");
    return `https://wa.me/55${clean}`;
  };

  const downloadCSV = () => {
    if (perfis.length === 0) return;
    const headers = ["Username", "Nome", "Bio", "Seguidores", "Email", "Telefone", "Data Captura"];
    const rows = perfis.map(p => [
      `"${p.username}"`,
      `"${p.nome_completo || ''}"`,
      `"${(p.bio || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
      `"${p.seguidores}"`,
      `"${p.email_extraido || ''}"`,
      `"${p.telefone_extraido || ''}"`,
      `"${new Date(p.criado_em).toLocaleString("pt-BR")}"`,
    ]);
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers, ...rows].map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `instagram_perfis_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <main className="flex-1 flex flex-col bg-slate-950 overflow-hidden font-sans relative">
      
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
                      {perfis.filter(p => !p.perfil_pai).length} buscas no banco
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
                {perfis.filter(p => !p.perfil_pai).map((busca, i) => {
                  const followerCount = perfis.filter(p => p.perfil_pai === busca.username).length;
                  const isConfirmingDelete = deletingId === busca.username;
                  return (
                    <motion.div
                      key={busca.id || i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      onClick={() => {
                        if (!isConfirmingDelete) {
                          setActiveSearch(busca.username);
                          setShowBuscas(false);
                        }
                      }}
                      className={`w-full flex items-center justify-between gap-2 px-6 py-4 transition-all text-left group ${
                        isConfirmingDelete ? "bg-red-950/20 cursor-default" : "hover:bg-white/5 cursor-pointer"
                      }`}
                    >
                      <div className="flex-1 flex items-center gap-4 text-left min-w-0">
                        <div className="p-2 bg-slate-800 rounded-lg shrink-0 group-hover:bg-purple-500/20 transition-colors">
                          <MapPin className="w-4 h-4 text-slate-500 group-hover:text-purple-400 transition-colors" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-semibold truncate">
                            Busca: <span className="text-purple-400">@{busca.username}</span>
                          </p>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="flex items-center gap-1 text-[10px] text-slate-500">
                              <Users className="w-3 h-3" />{followerCount} contatos
                            </span>
                            <span className="flex items-center gap-1 text-[10px] text-slate-600">
                              <Clock className="w-3 h-3" />{new Date(busca.criado_em).toLocaleString("pt-BR")}
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 mr-2">
                          <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-purple-400 transition-colors" />
                        </div>
                      </div>
                      <div className="shrink-0 flex items-center gap-1 z-10" onClick={e => e.stopPropagation()}>
                        {isConfirmingDelete ? (
                          <div className="flex items-center gap-1.5 bg-red-950/40 border border-red-500/30 px-2 py-1 rounded-lg text-[10px] font-bold text-red-400">
                            <span>Excluir dados?</span>
                            <button onClick={e => { e.stopPropagation(); deleteSearch(busca.username); }} className="px-1.5 py-0.5 bg-red-500 text-slate-950 rounded hover:bg-red-400 transition-colors cursor-pointer">
                              Sim
                            </button>
                            <button onClick={e => { e.stopPropagation(); setDeletingId(null); }} className="px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded hover:text-white transition-colors cursor-pointer">
                              Não
                            </button>
                          </div>
                        ) : (
                          <button onClick={e => { e.stopPropagation(); setDeletingId(busca.username); }} className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all cursor-pointer" title="Excluir busca e liberar espaço">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
              <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/50 flex justify-between items-center">
                <p className="text-[10px] text-slate-600 text-center flex-1">Clique em uma busca para carregar os contatos na tabela</p>
                {activeSearch && activeSearch !== "*" && (
                  <button onClick={() => { setActiveSearch("*"); setShowBuscas(false); }} className="text-[10px] font-bold text-purple-400 uppercase tracking-widest hover:text-purple-300">
                    Ver Todas
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="flex justify-between items-start p-8 pb-0 shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 via-purple-500 to-orange-400 flex items-center justify-center shadow-lg shadow-purple-500/30">
              <Instagram className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-3xl font-bold text-white tracking-tight">Profile Scraper</h2>
          </div>
          <p className="text-slate-400 text-sm mt-1">Extração de perfis do Instagram simulando navegação humana.</p>
        </div>
        
        {/* Actions Widget (Login/Logout & Saved Searches) */}
        <div className="flex items-center gap-4">
          
          {/* Buscas Salvas Button */}
          {perfis.filter(p => !p.perfil_pai).length > 0 && (
            <button
              onClick={() => setShowBuscas(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 transition-all cursor-pointer shadow-sm active:scale-95"
            >
              <History className="w-4 h-4" />
              <span className="text-sm font-bold">Buscas Salvas</span>
              <span className="bg-purple-500/20 text-purple-400 text-[10px] font-black px-2 py-0.5 rounded-full ml-1">
                {perfis.filter(p => !p.perfil_pai).length}
              </span>
            </button>
          )}
          
          {/* Status Connection Widget */}
          {hasSession ? (
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shadow-sm">
              <CheckCircle2 className="w-4 h-4" />
              <div className="text-right">
                <p className="text-[9px] uppercase font-black tracking-widest opacity-80">Sessão Scraper</p>
                <p className="text-sm font-bold">CONECTADA</p>
              </div>
              <div className="w-px h-6 bg-emerald-500/20 mx-1" />
              <button onClick={logout} className="text-xs font-bold hover:text-white uppercase tracking-wider text-emerald-500 hover:bg-emerald-500/20 px-2 py-1 rounded transition-colors">
                Logout
              </button>
            </div>
          ) : (
            <button onClick={interactiveLogin} disabled={savingSession} className="flex items-center gap-3 px-5 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white transition-all shadow-sm active:scale-95 disabled:opacity-50">
              {savingSession ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Instagram className="w-4 h-4" />}
              <div className="text-right flex flex-col items-end">
                <span className="text-[9px] uppercase font-black tracking-widest opacity-80">Sessão Ausente</span>
                <span className="text-sm font-bold">{savingSession ? "Conectando..." : "Login no Instagram"}</span>
              </div>
            </button>
          )}
        </div>
      </header>

      {sectionRequest === "profile" ? (
        <>
          {/* Controls */}
          <section className="shrink-0 px-8 pt-6">
        <div className="glass rounded-2xl p-6 flex flex-col gap-4 shadow-2xl relative overflow-hidden border border-slate-800">
          <div className="absolute inset-0 bg-gradient-to-r from-pink-500/5 via-purple-500/5 to-transparent pointer-events-none" />
          
          <div className="flex gap-4 relative z-10">
            <div className="flex-1 relative">
              <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={targetUser}
                onChange={e => setTargetUser(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !scraperRunning && startScrape()}
                disabled={scraperRunning}
                placeholder="Nome de usuário do perfil (Ex: neymarjr, casimiro)"
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl pl-12 pr-4 py-3.5 focus:ring-2 focus:ring-pink-500/50 outline-none transition-all placeholder:text-slate-600 font-medium"
              />
            </div>

            <button
              onClick={stopScrape}
              disabled={!scraperRunning}
              className="px-6 bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-400 disabled:opacity-30 disabled:hover:bg-slate-800 disabled:hover:text-slate-400 disabled:cursor-not-allowed font-black rounded-xl transition-all flex items-center gap-2 uppercase text-xs tracking-widest border border-slate-700/50 hover:border-red-500/50 disabled:border-transparent"
            >
              <X className="w-4 h-4" /> Parar Extração
            </button>
            <button
              onClick={startScrape}
              disabled={loading || scraperRunning}
              className="px-8 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-400 hover:to-purple-400 text-white font-black rounded-xl transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50 uppercase text-xs tracking-widest shadow-lg shadow-pink-500/20"
            >
              {scraperRunning ? (
                <><RefreshCcw className="w-4 h-4 animate-spin" /> Extraindo...</>
              ) : (
                <><span>Iniciar Scraping</span><Play className="w-4 h-4 fill-current" /></>
              )}
            </button>
          </div>

          <AnimatePresence>
            <div className="flex items-start gap-3 mt-2 p-3 text-pink-400 text-sm font-bold border-2 border-pink-500/50 rounded-xl bg-pink-500/10 animate-[pulse_2s_ease-in-out_infinite] shadow-[0_0_15px_rgba(236,72,153,0.2)]">
              <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5 text-pink-400" />
              <p>
                ATENÇÃO: Ao iniciar a busca, o navegador será aberto. Pode ser exigida a resolução manual de um CAPTCHA (teste de imagem) do Instagram. Fique atento à janela do robô!
              </p>
            </div>

            {statusMsg && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                <div className="mt-2 bg-slate-900 border border-slate-700 px-4 py-2.5 rounded-lg flex items-center gap-3 text-slate-300 text-sm">
                  {scraperRunning && <div className="w-2 h-2 bg-pink-500 rounded-full animate-pulse" />}
                  {statusMsg}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* Log Panel */}
      <AnimatePresence>
        {scraperRunning && (
          <motion.section initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="shrink-0 px-8 pt-4">
            <div className="bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-inner">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800 bg-slate-900">
                <Terminal className="w-3.5 h-3.5 text-pink-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Terminal Stealth Playwright</span>
              </div>
              <div 
                className="h-32 overflow-y-auto p-3 space-y-1 font-mono text-[11px]"
                onScroll={handleLogScroll}
              >
                {scraperLog.map((line, i) => (
                  <p key={i} className={`leading-tight ${line.includes("❌") || line.includes("🔥") ? "text-red-400" : line.includes("✅") ? "text-emerald-400" : "text-slate-400"}`}>
                    {line}
                  </p>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Table Section */}
      <section className="flex-1 min-h-0 mx-8 mt-6 mb-8 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col overflow-hidden shadow-xl">
        <div className="border-b border-slate-800 px-6 py-4 flex justify-between items-center bg-slate-900 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-950 rounded-lg border border-slate-800"><Database className="w-4 h-4 text-pink-500" /></div>
            <h3 className="font-bold text-white uppercase tracking-tight text-sm">Base de Perfis</h3>
          </div>
          <div className="flex gap-2">
            <button onClick={downloadCSV} disabled={perfis.length === 0} className="flex items-center gap-2 px-3 py-1.5 text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-50 rounded-lg text-xs font-bold uppercase transition-colors">
              <Download className="w-4 h-4" /> CSV
            </button>
            <button onClick={fetchPerfis} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
              <RefreshCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar relative">
          


          <div className="min-w-[1000px]">
            {/* Header */}
            <div className="grid grid-cols-[3fr_3fr_2fr_3fr_1.5fr] text-[10px] uppercase font-black tracking-widest text-slate-500 border-b border-slate-800 sticky top-0 bg-slate-900/95 backdrop-blur-md z-10 px-6 py-3 items-center">
              <div>Username</div>
              <div className="text-center">Bio</div>
              <div className="text-center">Métricas</div>
              <div className="text-center">Ação Externa</div>
              <div className="text-center">Direct</div>
            </div>

            {/* Body */}
            <div className="divide-y divide-slate-800/40 pb-32">
              {perfis.length === 0 || !activeSearch ? (
                <div className="px-6 py-20 text-center">
                  <Instagram className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                  <p className="text-slate-500 font-medium">
                    {!activeSearch 
                      ? "Nenhuma busca selecionada. Faça uma nova busca ou carregue uma busca salva."
                      : "Nenhum perfil extraído ainda."}
                  </p>
                </div>
              ) : (
                (() => {
                  // Agrupa: perfis principais (sem perfil_pai) e seus seguidores
                  const mainProfiles = activeSearch === "*" 
                    ? perfis.filter(p => !p.perfil_pai) 
                    : perfis.filter(p => !p.perfil_pai && p.username === activeSearch);
                  const followerMap = new Map<string, IgPerfil[]>();
                  perfis.filter(p => p.perfil_pai).forEach(p => {
                    const list = followerMap.get(p.perfil_pai!) || [];
                    list.push(p);
                    followerMap.set(p.perfil_pai!, list);
                  });

                  const renderRow = (p: IgPerfil, isFollower: boolean = false) => {
                    const isSelected = selectedFollowers.includes(p.username);

                    const bgClass = p.dm_enviado 
                      ? 'bg-emerald-900/20 border-l-2 border-emerald-500/50' 
                      : (isFollower ? 'bg-slate-950/30' : '');

                    return (
                      <div key={p.id} className={`grid grid-cols-[3fr_3fr_2fr_3fr_1.5fr] items-center px-6 ${isFollower ? 'py-1.5' : 'py-4'} hover:bg-slate-800/30 transition-colors ${bgClass}`}>
                        
                        <div className="flex items-center gap-2">
                          {isFollower ? (
                            <div className="flex items-center gap-2 mr-1">
                              <span className="text-slate-700 text-xs select-none">└</span>
                              <input 
                                type="checkbox" 
                                checked={isSelected}
                                onChange={() => toggleFollower(p.username)}
                                className="w-3.5 h-3.5 rounded border-slate-700 text-pink-500 focus:ring-pink-500/20 bg-slate-900 cursor-pointer"
                              />
                            </div>
                          ) : (
                            <div className="w-5" /> // Spacer for alignment
                          )}
                          <div className="flex flex-col">
                            <a href={`https://instagram.com/${p.username}`} target="_blank" rel="noreferrer" className={`text-sm font-bold hover:text-pink-400 hover:underline inline-flex items-center gap-1 ${isFollower ? 'text-slate-300' : 'text-white'}`}>
                              @{p.username}
                              {p.is_business === 1 && <span className="text-[8px] bg-blue-500/20 text-blue-400 px-1 py-0.5 rounded uppercase">Biz</span>}
                            </a>
                            <span className="text-xs text-slate-400 mt-0.5 truncate pr-4">{p.nome_completo || 'Sem nome'}</span>
                          </div>
                        </div>

                        <div className="flex flex-col items-center justify-center text-center">
                          <p className={`text-[10px] ${isFollower ? 'text-slate-600 font-bold' : 'text-slate-500'} line-clamp-2 leading-relaxed`} title={p.bio}>
                            {p.bio || (isFollower ? "-" : <span className="italic">Sem biografia</span>)}
                          </p>
                        </div>

                        <div className="flex flex-col items-center justify-center text-center">
                          {isFollower ? (
                            <span className="text-xs font-bold text-slate-600">-</span>
                          ) : (
                            <>
                              <span className="text-xs font-bold text-slate-200">
                                {p.seguidores.toLocaleString()} <span className="text-[9px] text-slate-500 uppercase">Seguidores</span>
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {p.posts.toLocaleString()} posts
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex items-center justify-center gap-2 flex-wrap">
                          {p.link_bio && (
                            <a href={p.link_bio.startsWith('http') ? p.link_bio : `https://${p.link_bio}`} target="_blank" rel="noreferrer" title={p.link_bio} className="px-2 py-1 bg-indigo-500/10 hover:bg-indigo-500 hover:text-white text-indigo-400 rounded text-[10px] font-bold border border-indigo-500/20 transition-all inline-block">
                              🔗 Link
                            </a>
                          )}
                          {p.email_extraido && (
                            <a href={`mailto:${p.email_extraido}`} className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-mono border border-slate-700 truncate max-w-[120px]">
                              {p.email_extraido}
                            </a>
                          )}
                          
                          {p.telefone_extraido && (
                            (() => {
                              const clean = p.telefone_extraido.replace(/\D/g, "");
                              const isCelular = clean.length >= 10 && clean.length <= 13;
                              if (isCelular) {
                                 return (
                                  <a href={getWhatsAppUrl(p.telefone_extraido)} onClick={() => markDmEnviado(p.username)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md text-[10px] font-bold uppercase hover:bg-emerald-500 hover:text-slate-950 transition-all">
                                    <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                                  </a>
                                );
                              }
                              return <span className="px-3 py-1.5 bg-slate-800 text-slate-400 rounded-md text-[10px] font-bold uppercase">{p.telefone_extraido}</span>;
                            })()
                          )}

                          {!p.email_extraido && !p.telefone_extraido && !p.link_bio && (
                            <span className="text-[10px] text-slate-600 font-mono font-bold">{isFollower ? "-" : "Nenhum"}</span>
                          )}
                        </div>

                        {/* Direct Column */}
                        <div className="flex items-center justify-center">
                          {isFollower && (
                            p.dm_enviado ? (
                              <a
                                href={`https://ig.me/m/${p.username}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg text-[10px] font-bold uppercase hover:bg-emerald-500 hover:text-white transition-all active:scale-95"
                              >
                                <Check className="w-3.5 h-3.5" /> Enviado
                              </a>
                            ) : (
                              <a
                                href={`https://ig.me/m/${p.username}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-pink-500/10 to-purple-500/10 text-pink-400 border border-pink-500/20 rounded-lg text-[10px] font-bold uppercase hover:from-pink-500 hover:to-purple-500 hover:text-white transition-all active:scale-95"
                              >
                                <Send className="w-3.5 h-3.5" />
                              </a>
                            )
                          )}
                        </div>
                      </div>
                    );
                  };

                  return mainProfiles.map(main => {
                    const followers = followerMap.get(main.username) || [];
                    const allFollowersSelected = followers.length > 0 && followers.every(f => selectedFollowers.includes(f.username));

                    return (
                      <React.Fragment key={main.id}>
                        {renderRow(main, false)}
                        {followers.length > 0 && (
                          <div className="border-l-2 border-pink-500/20 ml-4">
                            <div className="flex items-center justify-between px-6 py-2 bg-slate-950/50">
                              <div className="flex items-center gap-2">
                                <Users className="w-3.5 h-3.5 text-pink-400" />
                                <span className="text-[10px] font-black uppercase tracking-widest text-pink-400/70">
                                  {followers.length} Seguidores de @{main.username}
                                </span>
                              </div>
                              <label className="flex items-center gap-2 cursor-pointer text-[10px] font-bold text-slate-400 uppercase hover:text-white">
                                <input 
                                  type="checkbox" 
                                  checked={allFollowersSelected}
                                  onChange={() => toggleAllFollowers(followers)}
                                  className="w-3.5 h-3.5 rounded border-slate-700 text-pink-500 focus:ring-pink-500/20 bg-slate-900 cursor-pointer"
                                />
                                Selecionar Todos ({followers.length})
                              </label>
                            </div>
                            
                            {/* Rendereização com Paginação Limitada */}
                            {followers.slice(0, visibleFollowersMap[main.username] || 100).map(f => renderRow(f, true))}
                            
                            {followers.length > (visibleFollowersMap[main.username] || 100) && (
                              <div className="px-6 py-3 bg-slate-950/30 flex justify-center border-t border-slate-800/50">
                                <button 
                                  onClick={() => setVisibleFollowersMap(prev => ({...prev, [main.username]: (prev[main.username] || 100) + 100}))}
                                  className="text-[10px] font-bold uppercase tracking-widest text-pink-400 hover:text-white bg-pink-500/10 hover:bg-pink-500/30 border border-pink-500/20 px-4 py-2 rounded-lg transition-all flex items-center gap-2"
                                >
                                  <RefreshCcw className="w-3 h-3" />
                                  Carregar mais seguidores (+100 de {followers.length - (visibleFollowersMap[main.username] || 100)} restantes)
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  });
                })()
              )}
            </div>
          </div>
        </div>
        
        {/* Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-900/50 flex justify-between items-center text-[10px] uppercase font-black shrink-0">
          <span className="text-slate-500">Módulo Instagram Independente</span>
          <div className="flex items-center gap-1.5 text-pink-400">
            <ShieldCheck className="w-3.5 h-3.5" /> Human-like Delays Ativos
          </div>
        </div>
      </section>
      </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="w-24 h-24 rounded-3xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-6">
             <Instagram className="w-10 h-10 text-slate-500" />
          </div>
          <h3 className="text-2xl font-bold text-white mb-2">
            Módulo <span className="capitalize">{sectionRequest.replace("-", " ")}</span>
          </h3>
          <p className="text-slate-400 text-sm max-w-md">
            Esta funcionalidade está sendo desenvolvida. Em breve você poderá utilizá-la diretamente por aqui!
          </p>
        </div>
      )}
      {/* Floating Action Button & DM Panel - Outside scrolling container */}
      <AnimatePresence>
        {selectedFollowers.length > 0 && !showDmPanel && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-6 right-6 z-20"
          >
            <button
              onClick={() => setShowDmPanel(true)}
              className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-400 hover:to-purple-400 text-white font-bold rounded-full shadow-lg shadow-pink-500/20 active:scale-95 transition-all text-sm"
            >
              <Send className="w-4 h-4" />
              Preparar Mensagem ({selectedFollowers.length})
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedFollowers.length > 0 && showDmPanel && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute bottom-6 right-6 z-20 bg-slate-900 border border-pink-500/30 p-4 rounded-2xl shadow-2xl shadow-pink-500/20 w-[400px] flex flex-col gap-3 backdrop-blur-md"
          >
            <div className="flex justify-between items-center">
              <h4 className="text-white font-bold text-sm flex items-center gap-2">
                <Send className="w-4 h-4 text-pink-400" />
                Disparar ({selectedFollowers.length})
              </h4>
              <button onClick={() => setShowDmPanel(false)} className="text-slate-500 hover:text-white text-xs">Ocultar</button>
            </div>
            <div>
              <textarea 
                value={messageTemplate}
                onChange={(e) => setMessageTemplate(e.target.value)}
                className="w-full h-24 bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white focus:border-pink-500 outline-none resize-none"
                placeholder="Use {nome} e {username}"
              />
              <div className="flex justify-between items-center mt-2">
                <span className="text-[10px] text-slate-500">
                  <code className="text-pink-400">{"{nome}"}</code> <code className="text-pink-400">{"{username}"}</code>
                </span>
                <button
                  onClick={sendBulkDMs}
                  disabled={sendingDMs || scraperRunning}
                  className="px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-400 hover:to-purple-400 text-white text-xs font-bold uppercase rounded-lg disabled:opacity-50 transition-all flex items-center gap-2"
                >
                  {sendingDMs ? <RefreshCcw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                  Enviar
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </main>
  );
}
