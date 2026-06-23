// ─────────────────────────────────────────────────────────────────────────────
// App.tsx — Shell principal: roteamento entre módulos + sidebar accordion
// Não contém lógica de negócio — apenas navega entre módulos isolados.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Database,
  ChevronRight,
  Instagram,
  Search,
  CheckCircle2,
  MapPin,
} from "lucide-react";

import InstagramDashboard from "./modules/instagram/InstagramDashboard";
import LeadsDashboard from "./modules/instagram/LeadsDashboard";
import GoogleMapsDashboard from "./modules/googlemaps/GoogleMapsDashboard";

// null = nenhum módulo ativo (tela inicial/splash)
type Module = "instagram" | "googlemaps" | null;

// ── WelcomeScreen inline (com vídeo embutido) ─────────────────────────────────
function WelcomeScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnded = () => {
      // Deixa o vídeo parado no último frame — não faz nada além de marcar como terminado
      setEnded(true);
    };

    video.addEventListener("ended", handleEnded);
    video.play().catch(() => setEnded(true));

    return () => video.removeEventListener("ended", handleEnded);
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-slate-950 select-none gap-8">

      {/* Vídeo — Mantendo a largura total, mas ocultando as bordas superior e inferior (onde fica o "Veo") */}
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

      {/* Instrução + seta — sempre visíveis */}
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


// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  // Nenhum módulo ativo ao iniciar — menus fechados
  const [activeModule, setActiveModule] = useState<Module>(null);
  const [instaExpanded, setInstaExpanded] = useState(false);
  const [mapsExpanded, setMapsExpanded] = useState(false);

  // Pedido de seção para o módulo Instagram
  const [igSectionRequest, setIgSectionRequest] = useState<string>("profile");

  // Pedido de seção para o módulo Google Maps
  const [mapsSectionRequest, setMapsSectionRequest] = useState<string | null>(null);

  const toggleInstagram = () => {
    const next = !instaExpanded;
    setInstaExpanded(next);
    if (next) {
      setActiveModule("instagram");
      setMapsExpanded(false);
    }
  };

  const toggleMaps = () => {
    const next = !mapsExpanded;
    setMapsExpanded(next);
    if (next) {
      setActiveModule("googlemaps");
      setInstaExpanded(false);
    }
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
          onClick={() => {
            setActiveModule(null);
            setInstaExpanded(false);
            setMapsExpanded(false);
          }}
          className="p-6 border-b border-slate-800 text-left hover:bg-slate-900/50 transition-colors w-full cursor-pointer group"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-sky-500 rounded flex items-center justify-center font-bold text-slate-950 shadow-lg shadow-sky-500/20 group-hover:scale-105 transition-transform">
              Z
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white group-hover:text-sky-400 transition-colors">Z-Scraper</h1>
          </div>
          <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest font-semibold">
            v1.1.0-real
          </p>
        </button>

        {/* Nav acordeão */}
        <nav className="flex-1 overflow-y-auto py-3 space-y-1">

          {/* ── Dashboard Instagram ── */}
          <div>
            <button
              onClick={toggleInstagram}
              className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-sm font-bold transition-all ${
                activeModule === "instagram"
                  ? "text-pink-400"
                  : "text-slate-300 hover:text-white"
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
                activeModule === "googlemaps"
                  ? "text-yellow-400"
                  : "text-slate-300 hover:text-white"
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
      </aside>

      {/* ── Conteúdo principal ─────────────────────────────────────────────── */}
      <div className="flex-1 relative flex overflow-hidden">
        {/* Welcome screen (vídeo + logo estática + instruções) */}
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
    </div>
  );
}
