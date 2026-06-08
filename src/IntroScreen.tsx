import React, { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";

interface IntroScreenProps {
  onFinished: () => void;
}

export default function IntroScreen({ onFinished }: IntroScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<"playing" | "static" | "fading">("playing");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnded = () => {
      // Vídeo terminou → mostra logo estática por 1.5s depois sai
      setPhase("static");
      setTimeout(() => {
        setPhase("fading");
        setTimeout(() => onFinished(), 800);
      }, 1500);
    };

    video.addEventListener("ended", handleEnded);

    // Fallback: se o vídeo não carregar em 500ms, vai direto para estático
    const fallback = setTimeout(() => {
      if (video.readyState === 0) {
        setPhase("static");
        setTimeout(() => {
          setPhase("fading");
          setTimeout(() => onFinished(), 800);
        }, 2000);
      }
    }, 500);

    video.play().catch(() => {
      // Autoplay bloqueado → pula direto
      clearTimeout(fallback);
      setPhase("static");
      setTimeout(() => {
        setPhase("fading");
        setTimeout(() => onFinished(), 800);
      }, 2500);
    });

    return () => {
      video.removeEventListener("ended", handleEnded);
      clearTimeout(fallback);
    };
  }, [onFinished]);

  return (
    <AnimatePresence>
      {phase !== "fading" && (
        <motion.div
          key="intro"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
          className="fixed inset-0 z-[9999] bg-black flex items-center justify-center"
        >
          {/* Vídeo — visível enquanto playing */}
          <video
            ref={videoRef}
            src="/intro.mp4"
            muted
            playsInline
            preload="auto"
            className={`w-full h-full object-contain transition-opacity duration-500 ${
              phase === "static" ? "opacity-0 absolute" : "opacity-100"
            }`}
          />

          {/* Logo estática — fade in após o vídeo */}
          <AnimatePresence>
            {phase === "static" && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="flex flex-col items-center gap-6 select-none"
              >
                {/* Logo Z */}
                <div
                  className="w-24 h-24 rounded-2xl flex items-center justify-center font-black text-5xl text-black shadow-2xl"
                  style={{
                    background: "linear-gradient(135deg, #38bdf8 0%, #0ea5e9 60%, #7c3aed 100%)",
                    boxShadow: "0 0 80px rgba(56,189,248,0.5), 0 0 160px rgba(56,189,248,0.2)",
                  }}
                >
                  Z
                </div>
                <div className="text-center">
                  <h1
                    className="text-4xl font-black tracking-tight"
                    style={{
                      background: "linear-gradient(90deg, #38bdf8, #a78bfa)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    Z-Scraper
                  </h1>
                  <p className="text-slate-500 text-xs uppercase tracking-[0.3em] font-bold mt-2">
                    v1.1.0-real
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
