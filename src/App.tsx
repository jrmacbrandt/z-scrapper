// ─────────────────────────────────────────────────────────────────────────────
// App.tsx — Shell principal: roteamento entre módulos + sidebar accordion
// Não contém lógica de negócio — apenas navega entre módulos isolados.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Database,
  ChevronRight,
  Instagram,
  Search,
  CheckCircle2,
  MapPin,
  Bell,
  X,
  RefreshCw,
  ArrowUp,
  AlertTriangle,
  CheckCircle,
  Loader2,
} from "lucide-react";

import InstagramDashboard from "./modules/instagram/InstagramDashboard";
import LeadsDashboard from "./modules/instagram/LeadsDashboard";
import GoogleMapsDashboard from "./modules/googlemaps/GoogleMapsDashboard";

// null = nenhum módulo ativo (tela inicial/splash)
type Module = "instagram" | "googlemaps" | null;

// ── Tipos do Updater ──────────────────────────────────────────────────────────
interface ModuleUpdate {
  name: string;
  current_version: string;
  new_version: string;
  changelog: string;
  mandatory: boolean;
}

interface UpdateStatus {
  checked_at: string | null;
  modules_with_updates: ModuleUpdate[];
  error: string | null;
  is_checking: boolean;
}

type ApplyState = "idle" | "applying" | "success" | "error";

// ── WelcomeScreen ─────────────────────────────────────────────────────────────
function WelcomeScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleEnded = () => setEnded(true);
    video.addEventListener("ended", handleEnded);
    video.play().catch(() => setEnded(true));
    return () => video.removeEventListener("ended", handleEnded);
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-slate-950 select-none gap-8">
      <div className="w-4/5 aspect-[2.3/1] overflow-hidden rounded-2xl shadow-2xl relative bg-slate-950 flex items-center justify-center">
        <video
          ref={videoRef}
          src="/intro.mp4"
          muted
          playsInline
          preload="auto"
          className="w-full h-auto absolute"
        />
      </div>
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-slate-400 text-sm leading-relaxed">
          Selecione um módulo no menu lateral para começar.
        </p>
        <motion.div
          animate={{ x: [-6, 0, -6] }}
          transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
          className="flex items-center gap-2 text-slate-600 text-xs uppercase tracking-widest font-bold"
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
          Menu lateral
        </motion.div>
      </div>
    </div>
  );
}

// ── Modal de Update ───────────────────────────────────────────────────────────
function UpdateModal({
  updates,
  onClose,
  onApply,
  applyState,
  applyMessage,
  onCheckNow,
  isChecking,
}: {
  updates: ModuleUpdate[];
  onClose: () => void;
  onApply: (moduleName: string) => void;
  applyState: ApplyState;
  applyMessage: string;
  onCheckNow: () => void;
  isChecking: boolean;
}) {
  const moduleLabel: Record<string, string> = {
    instagram_scraper: "Instagram Scraper",
    google_maps_scraper: "Google Maps Scraper",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-sky-500/10 border border-sky-500/30 rounded-xl flex items-center justify-center">
              <ArrowUp className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <h2 className="text-white font-bold text-sm">Atualizações Disponíveis</h2>
              <p className="text-slate-500 text-xs">{updates.length} módulo(s) com update</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Updates list */}
        <div className="p-5 space-y-4 max-h-72 overflow-y-auto">
          {updates.map((u) => (
            <div key={u.name} className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-semibold text-sm">
                      {moduleLabel[u.name] ?? u.name}
                    </span>
                    {u.mandatory && (
                      <span className="text-[9px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide">
                        Obrigatório
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-slate-500 text-xs font-mono">v{u.current_version}</span>
                    <ChevronRight className="w-3 h-3 text-sky-400" />
                    <span className="text-sky-400 text-xs font-mono font-bold">v{u.new_version}</span>
                  </div>
                </div>
                <button
                  id={`btn-apply-${u.name}`}
                  onClick={() => onApply(u.name)}
                  disabled={applyState === "applying"}
                  className="shrink-0 px-3 py-1.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5"
                >
                  {applyState === "applying" ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <ArrowUp className="w-3 h-3" />
                  )}
                  Atualizar
                </button>
              </div>
              <p className="text-slate-400 text-xs leading-relaxed">{u.changelog}</p>
            </div>
          ))}
        </div>

        {/* Result feedback */}
        <AnimatePresence>
          {applyState !== "idle" && applyMessage && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className={`mx-5 mb-1 px-4 py-3 rounded-xl text-xs flex items-center gap-2 ${
                applyState === "success"
                  ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                  : applyState === "error"
                  ? "bg-red-500/10 border border-red-500/30 text-red-400"
                  : "bg-sky-500/10 border border-sky-500/30 text-sky-400"
              }`}
            >
              {applyState === "success" && <CheckCircle className="w-4 h-4 shrink-0" />}
              {applyState === "error" && <AlertTriangle className="w-4 h-4 shrink-0" />}
              {applyState === "applying" && <Loader2 className="w-4 h-4 shrink-0 animate-spin" />}
              <span>{applyMessage}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 flex items-center justify-between">
          <button
            onClick={onCheckNow}
            disabled={isChecking}
            className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 text-xs transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isChecking ? "animate-spin" : ""}`} />
            {isChecking ? "Verificando..." : "Verificar agora"}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-slate-400 hover:text-white text-xs border border-slate-700 hover:border-slate-500 rounded-lg transition-colors"
          >
            Fechar
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [activeModule, setActiveModule] = useState<Module>(null);
  const [instaExpanded, setInstaExpanded] = useState(false);
  const [mapsExpanded, setMapsExpanded] = useState(false);
  const [igSectionRequest, setIgSectionRequest] = useState<string>("profile");
  const [mapsSectionRequest, setMapsSectionRequest] = useState<string | null>(null);

  // ── Update state ────────────────────────────────────────────────────────────
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    checked_at: null,
    modules_with_updates: [],
    error: null,
    is_checking: false,
  });
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [applyState, setApplyState] = useState<ApplyState>("idle");
  const [applyMessage, setApplyMessage] = useState("");

  const hasUpdates = updateStatus.modules_with_updates.length > 0;

  // Polling de status a cada 30s (leve — só GET, sem side effects)
  const fetchUpdateStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/updates/status");
      if (res.ok) {
        const data: UpdateStatus = await res.json();
        setUpdateStatus(data);
      }
    } catch {
      // Silencioso — não interrompe o usuário
    }
  }, []);

  useEffect(() => {
    fetchUpdateStatus();
    const interval = setInterval(fetchUpdateStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchUpdateStatus]);

  const handleCheckNow = async () => {
    setUpdateStatus(s => ({ ...s, is_checking: true }));
    try {
      const res = await fetch("/api/updates/check", { method: "POST" });
      if (res.ok) {
        const data: UpdateStatus = await res.json();
        setUpdateStatus(data);
      }
    } catch {
      setUpdateStatus(s => ({ ...s, is_checking: false, error: "Sem conexão com o servidor." }));
    }
  };

  const handleApplyUpdate = async (moduleName: string) => {
    setApplyState("applying");
    setApplyMessage(`Baixando e aplicando update de ${moduleName}...`);
    try {
      const res = await fetch("/api/updates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: moduleName }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setApplyState("success");
        setApplyMessage(data.message ?? "Update aplicado com sucesso!");
        await fetchUpdateStatus();
        setTimeout(() => {
          setApplyState("idle");
          setApplyMessage("");
          if (updateStatus.modules_with_updates.length === 0) setShowUpdateModal(false);
        }, 3000);
      } else {
        setApplyState("error");
        setApplyMessage(data.message ?? "Falha no update. Versão anterior restaurada.");
      }
    } catch (err: any) {
      setApplyState("error");
      setApplyMessage(`Erro de conexão: ${err.message}`);
    }
  };

  // ── Navigation ──────────────────────────────────────────────────────────────
  const toggleInstagram = () => {
    const next = !instaExpanded;
    setInstaExpanded(next);
    if (next) { setActiveModule("instagram"); setMapsExpanded(false); }
  };

  const toggleMaps = () => {
    const next = !mapsExpanded;
    setMapsExpanded(next);
    if (next) { setActiveModule("googlemaps"); setInstaExpanded(false); }
  };

  const openIgSection = (section: string) => {
    setActiveModule("instagram");
    setInstaExpanded(true);
    setMapsExpanded(false);
    setIgSectionRequest(section);
  };

  const openMapsSection = (section: string | null) => {
    setActiveModule("googlemaps");
    setMapsExpanded(true);
    setInstaExpanded(false);
    setMapsSectionRequest(null);
    setTimeout(() => setMapsSectionRequest(section), 0);
  };

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-200 overflow-hidden font-sans">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="w-64 border-r border-slate-800 bg-slate-950 flex flex-col shrink-0">
        {/* Logo — Clicável para voltar à Home */}
        <button
          onClick={() => { setActiveModule(null); setInstaExpanded(false); setMapsExpanded(false); }}
          className="p-6 border-b border-slate-800 text-left hover:bg-slate-900/50 transition-colors w-full cursor-pointer group"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-sky-500 rounded flex items-center justify-center font-bold text-slate-950 shadow-lg shadow-sky-500/20 group-hover:scale-105 transition-transform">
              Z
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white group-hover:text-sky-400 transition-colors">Z-Scraper</h1>
          </div>
          <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest font-semibold">
            v1.1.0
          </p>
        </button>

        {/* Nav acordeão */}
        <nav className="flex-1 overflow-y-auto py-3 space-y-1">

          {/* ── Dashboard Instagram ── */}
          <div>
            <button
              onClick={toggleInstagram}
              className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-sm font-bold transition-all ${
                activeModule === "instagram" ? "text-pink-400" : "text-slate-300 hover:text-white"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-6 h-6 rounded flex items-center justify-center shadow-sm ${
                  activeModule === "instagram"
                    ? "bg-gradient-to-br from-pink-500 to-purple-500 shadow-pink-500/30"
                    : "bg-slate-800"
                }`}>
                  <Instagram className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="uppercase tracking-widest text-[11px]">Dashboard Instagram</span>
              </div>
              <motion.div animate={{ rotate: instaExpanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
                <ChevronRight className="w-4 h-4" />
              </motion.div>
            </button>

            <AnimatePresence initial={false}>
              {instaExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="pl-4 pb-2 space-y-0.5">
                    {[
                      { id: "profile", label: "Profile Scraper", icon: Search },
                      { id: "leads", label: "Leads Qualificados", icon: CheckCircle2 },
                    ].map(item => (
                      <button
                        key={item.id}
                        onClick={() => openIgSection(item.id)}
                        className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm transition-all group ${
                          igSectionRequest === item.id && activeModule === "instagram"
                            ? "bg-slate-900 text-white"
                            : "text-slate-400 hover:bg-slate-900 hover:text-white"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <item.icon className={`w-3.5 h-3.5 ${igSectionRequest === item.id && activeModule === "instagram" ? "text-pink-400" : "group-hover:text-pink-400"}`} />
                          <span>{item.label}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Dashboard Google Maps ── */}
          <div>
            <button
              onClick={toggleMaps}
              className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-sm font-bold transition-all ${
                activeModule === "googlemaps" ? "text-yellow-400" : "text-slate-300 hover:text-white"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-6 h-6 rounded flex items-center justify-center shadow-sm ${
                  activeModule === "googlemaps"
                    ? "bg-[#E60000] shadow-[#E60000]/30 text-yellow-400"
                    : "bg-slate-800 text-slate-400"
                }`}>
                  <MapPin className="w-3.5 h-3.5" />
                </div>
                <span className="uppercase tracking-widest text-[11px]">Dashboard Google Maps</span>
              </div>
              <motion.div animate={{ rotate: mapsExpanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
                <ChevronRight className="w-4 h-4" />
              </motion.div>
            </button>

            <AnimatePresence initial={false}>
              {mapsExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="pl-4 pb-2 space-y-0.5">
                    <button
                      onClick={() => openMapsSection(null)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        activeModule === "googlemaps" && !mapsSectionRequest
                          ? "bg-slate-900 text-white"
                          : "text-slate-400 hover:bg-slate-900 hover:text-white"
                      }`}
                    >
                      <Database className="w-4 h-4 text-blue-400" />
                      Dashboard
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

        </nav>

        {/* ── Sino de Updates (footer da sidebar) ─────────────────────────── */}
        <div className="p-4 border-t border-slate-800">
          <button
            id="btn-updates"
            onClick={() => setShowUpdateModal(true)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all group ${
              hasUpdates
                ? "bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/20"
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 border border-transparent"
            }`}
          >
            <div className="relative">
              <Bell className={`w-4 h-4 ${hasUpdates ? "text-sky-400" : "text-slate-500 group-hover:text-slate-300"}`} />
              {hasUpdates && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-sky-500 rounded-full flex items-center justify-center text-[8px] font-bold text-slate-950"
                >
                  {updateStatus.modules_with_updates.length}
                </motion.span>
              )}
            </div>
            <span>
              {updateStatus.is_checking
                ? "Verificando..."
                : hasUpdates
                ? `${updateStatus.modules_with_updates.length} update(s) disponível`
                : "Sistema atualizado"}
            </span>
            {updateStatus.is_checking && (
              <RefreshCw className="w-3 h-3 ml-auto animate-spin text-slate-500" />
            )}
          </button>
        </div>
      </aside>

      {/* ── Conteúdo principal ─────────────────────────────────────────────── */}
      <div className="flex-1 relative flex overflow-hidden">
        {/* Welcome screen */}
        <AnimatePresence>
          {activeModule === null && (
            <motion.div
              key="welcome"
              className="absolute inset-0 flex overflow-hidden bg-slate-950 z-10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <WelcomeScreen />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Instagram */}
        <div className={`absolute inset-0 flex overflow-hidden ${activeModule === "instagram" ? "" : "hidden"}`}>
          {igSectionRequest === "leads" ? (
            <LeadsDashboard sectionRequest={igSectionRequest} />
          ) : (
            <InstagramDashboard sectionRequest={igSectionRequest} />
          )}
        </div>

        {/* Google Maps */}
        <div className={`absolute inset-0 flex overflow-hidden ${activeModule === "googlemaps" ? "" : "hidden"}`}>
          <GoogleMapsDashboard sectionRequest={mapsSectionRequest} />
        </div>
      </div>

      {/* ── Modal de Updates ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showUpdateModal && (
          <UpdateModal
            updates={updateStatus.modules_with_updates}
            onClose={() => { setShowUpdateModal(false); setApplyState("idle"); setApplyMessage(""); }}
            onApply={handleApplyUpdate}
            applyState={applyState}
            applyMessage={applyMessage}
            onCheckNow={handleCheckNow}
            isChecking={updateStatus.is_checking}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
