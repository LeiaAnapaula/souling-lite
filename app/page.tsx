"use client";
import { useState, useRef } from "react";

interface FormState {
  memory: string;
  emotion: string;
  belief: string;
  behavior: string;
}

const EMPTY: FormState = { memory: "", emotion: "", belief: "", behavior: "" };

const STEPS = [
  {
    key: "memory" as keyof FormState,
    label: "Memory",
    heading: "What memory comes up?",
    sub: "When you look at this photo, what moment surfaces?",
    placeholder: "A place, a moment, a feeling...",
    color: "#7C5CBF",
  },
  {
    key: "emotion" as keyof FormState,
    label: "Emotion",
    heading: "What emotion did it create?",
    sub: "What did that memory make you feel as a child?",
    placeholder: "Fear, happiness, loneliness, joy...",
    color: "#C45C8A",
  },
  {
    key: "belief" as keyof FormState,
    label: "Belief",
    heading: "What belief formed?",
    sub: "What did you decide about yourself because of that feeling?",
    placeholder: "I am not enough. I have to be perfect. I have to earn love...",
    color: "#3A7BD5",
  },
  {
    key: "behavior" as keyof FormState,
    label: "Behavior",
    heading: "How does it show up today?",
    sub: "What does that belief make you do (or avoid) in your life now?",
    placeholder: "I overwork. I overgive. I avoid closeness. I avoid being truly seen...",
    color: "#5B8FA8",
  },
];

const NODE_COLORS = ["#7C5CBF", "#C45C8A", "#3A7BD5", "#5B8FA8"];
const ALT_COLORS = ["#A78BFA", "#34D399"];

function SoulSphere({ color, size = 40, glow = false }: {
  color: string; size?: number; glow?: boolean;
}) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: `radial-gradient(circle at 35% 35%, ${color}ff, ${color}88 60%, ${color}22)`,
      boxShadow: glow
        ? `0 0 24px ${color}99, 0 0 48px ${color}33, inset 0 0 14px rgba(255,255,255,0.25)`
        : `0 0 12px ${color}55, inset 0 0 8px rgba(255,255,255,0.2)`,
      border: `1px solid ${color}66`,
      flexShrink: 0,
      transition: "all 0.3s",
    }} />
  );
}

function GraphConnector({ fromColor, toColor }: { fromColor: string; toColor: string }) {
  const id = `lg${fromColor.replace("#", "")}${toColor.replace("#", "")}`;
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "0 2px",
        marginTop: 0,
        cursor: "pointer",
        height: 44,
      }}
    >
      <svg width="56" height="44" style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={fromColor} stopOpacity={hovered ? 1 : 0.4} />
            <stop offset="100%" stopColor={toColor} stopOpacity={hovered ? 1 : 0.4} />
          </linearGradient>
          <filter id={`glow-${id}`} x="-20%" y="-100%" width="140%" height="300%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Stick / shaft */}
        <line
          x1="0" y1="22"
          x2="42" y2="22"
          stroke={`url(#${id})`}
          strokeWidth={hovered ? 3 : 1.5}
          strokeLinecap="round"
          filter={hovered ? `url(#glow-${id})` : "none"}
          style={{ transition: "stroke-width 0.2s" }}
        />

        {/* Arrowhead */}
        <polygon
          points="40,16 56,22 40,28"
          fill={`url(#${id})`}
          opacity={hovered ? 1 : 0.4}
          filter={hovered ? `url(#glow-${id})` : "none"}
          style={{ transition: "opacity 0.2s" }}
        />

        {/* Invisible wide hit area for easy hover */}
        <rect x="0" y="12" width="56" height="20" fill="transparent" />
      </svg>
    </div>
  );
}

export default function Home() {
  const [photo, setPhoto] = useState<{ url: string; base64: string } | null>(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [result, setResult] = useState<{
    new_belief: string; new_behavior: string; small_action: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setPhoto({ url: dataUrl, base64: dataUrl.split(",")[1] });
    };
    reader.readAsDataURL(file);
  }

  function next() {
    if (step === 0) { setStep(1); return; }
    const key = STEPS[step - 1].key;
    if (!form[key].trim()) { setError("Please write something — even a few words."); return; }
    setError("");
    if (step < 4) { setStep(step + 1); return; }
    generate();
  }

  async function generate() {
    setStep(5);
    try {
      const res = await fetch("/api/reflection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, photoBase64: photo?.base64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      setResult(data);
      setStep(6);
    } catch (e: any) {
      setError(e.message);
      setStep(4);
    }
  }

  function reset() {
    setStep(0); setForm(EMPTY); setPhoto(null); setResult(null); setError("");
  }

  async function saveAsImage() {
    setSaving(true);
    try {
      const el = document.getElementById("reflection-card");
      if (!el) return;
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(el, { backgroundColor: "#0d0a1a", scale: 2 });
      const link = document.createElement("a");
      link.download = "souling-identity-map.png";
      link.href = canvas.toDataURL();
      link.click();
    } catch {
      window.print();
    } finally {
      setSaving(false);
    }
  }

  return (
    <main style={{
      minHeight: "100vh",
      background: "#F4F2FB",
      padding: "0 0 5rem",
      fontFamily: "'Outfit', 'DM Sans', sans-serif",
    }}>

      {/* ── Header ── */}
      <div style={{ textAlign: "center", padding: "2.5rem 1rem 1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: "1rem" }}>
          <img
            src="/souling-logo.png"
            alt="Souling"
            style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover" }}
          />
          <span style={{ fontSize: 11, letterSpacing: "0.22em", textTransform: "uppercase", color: "#7c5cbf" }}>
            Souling Lite
          </span>
        </div>
        <h1 style={{
          fontSize: "clamp(1.75rem, 5vw, 2.6rem)", fontWeight: 300,
          color: "#5B3FA0", letterSpacing: "-0.01em", marginBottom: "0.4rem", lineHeight: 1.15,
        }}>
          Identity Graph Engine
        </h1>
        <p style={{ fontSize: 13, color: "#8B83B0", letterSpacing: "0.04em" }}>
          Map your subconscious. Rewrite the pattern.
        </p>
      </div>

      {/* ── Step dots ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "2rem" }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{ display: "flex", alignItems: "center" }}>
            <div style={{
              width: i === step ? 10 : 7,
              height: i === step ? 10 : 7,
              borderRadius: "50%",
              transition: "all 0.3s",
              background: i < step ? "#7c5cbf" : i === step ? "#a78bfa" : "#E2E0F4",
              boxShadow: i === step ? "0 0 10px #a78bfa88" : "none",
            }} />
            {i < 4 && <div style={{ width: 24, height: 1, background: "#E2E0F4" }} />}
          </div>
        ))}
      </div>

      <div style={{ maxWidth: 560, margin: "0 auto", padding: "0 1.25rem" }}>

        {/* ── Step 0: Photo ── */}
        {step === 0 && (
          <div style={{
            background: "rgba(255,255,255,0.04)",
            border: "0.5px solid rgba(167,139,250,0.2)",
            borderRadius: 20, padding: "1.75rem",
          }}>
            <p style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "#8B83B0", marginBottom: "0.75rem" }}>
              Step 1 of 5 — anchor
            </p>
            <h2 style={{ fontSize: "1.35rem", fontWeight: 300, color: "#f0ebff", marginBottom: "0.4rem" }}>
              A window to your younger self
            </h2>
            <p style={{ fontSize: 13, color: "#8B83B0", marginBottom: "1.25rem", lineHeight: 1.6 }}>
              Upload a childhood photo. It grounds everything that follows.
            </p>
            <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }}
              onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]); }}
              style={{
                border: `1.5px dashed ${photo ? "rgba(167,139,250,0.5)" : "rgba(167,139,250,0.15)"}`,
                borderRadius: 12, cursor: "pointer", overflow: "hidden",
                minHeight: photo ? "auto" : 160,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10,
                transition: "all 0.2s",
              }}
            >
              {photo ? (
                <img src={photo.url} alt="childhood" style={{ width: "100%", maxHeight: 240, objectFit: "cover" }} />
              ) : (
                <>
                  <SoulSphere color="#7C5CBF" size={40} glow />
                  <p style={{ fontSize: 13, color: "#8B83B0" }}>drag & drop or tap to browse</p>
                  <p style={{ fontSize: 11, color: "#3a2f4a" }}>childhood photo</p>
                </>
              )}
            </div>
            <button
              onClick={next}
              disabled={!photo}
              style={{
                width: "100%", marginTop: "1rem", padding: "13px", borderRadius: 10, border: "none",
                background: photo ? "linear-gradient(135deg, #7c5cbf, #5b3fa0)" : "#E2E0F4",
                color: photo ? "#f0ebff" : "#4a3a5a",
                fontSize: 13, cursor: photo ? "pointer" : "not-allowed",
                boxShadow: photo ? "0 0 20px #7c5cbf44" : "none",
                transition: "all 0.3s", letterSpacing: "0.03em",
              }}
            >
              continue →
            </button>
            <p style={{ fontSize: 11, textAlign: "center", color: "#3a2f4a", marginTop: "0.75rem" }}>
              Photo stays on your device. Never uploaded to a server.
            </p>
          </div>
        )}

        {/* ── Steps 1–4: Prompts ── */}
        {step >= 1 && step <= 4 && (
          <div style={{
            background: "rgba(255,255,255,0.04)",
            border: `0.5px solid ${STEPS[step - 1].color}44`,
            borderRadius: 20, padding: "1.75rem",
          }}>
            <p style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "#8B83B0", marginBottom: "0.75rem" }}>
              Step {step + 1} of 5 — {STEPS[step - 1].label.toLowerCase()}
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "0.6rem" }}>
              <SoulSphere color={STEPS[step - 1].color} size={30} glow />
              <h2 style={{ fontSize: "1.25rem", fontWeight: 300, color: "#f0ebff" }}>
                {STEPS[step - 1].heading}
              </h2>
            </div>
            <p style={{ fontSize: 13, color: "#8B83B0", marginBottom: "1.25rem", lineHeight: 1.6 }}>
              {STEPS[step - 1].sub}
            </p>
            {photo && (
              <img src={photo.url} alt="" style={{
                width: "100%", maxHeight: 90, objectFit: "cover",
                borderRadius: 8, marginBottom: "1rem", opacity: 0.45,
              }} />
            )}
            <textarea
              rows={4}
              autoFocus
              placeholder={STEPS[step - 1].placeholder}
              value={form[STEPS[step - 1].key]}
              onChange={e => { setForm({ ...form, [STEPS[step - 1].key]: e.target.value }); setError(""); }}
              style={{
                width: "100%", borderRadius: 10,
                border: `0.5px solid ${STEPS[step - 1].color}44`,
                padding: "12px 14px", fontSize: 14,
                color: "#f0ebff", background: "rgba(255,255,255,0.04)",
                resize: "none", outline: "none", lineHeight: 1.6,
                fontFamily: "inherit",
              }}
            />
            {error && (
              <p style={{ fontSize: 12, color: "#f87171", marginTop: "0.5rem" }}>{error}</p>
            )}
            <button
              onClick={next}
              style={{
                width: "100%", marginTop: "1rem", padding: "13px", borderRadius: 10, border: "none",
                background: `linear-gradient(135deg, ${STEPS[step - 1].color}, ${STEPS[step - 1].color}99)`,
                color: "#f0ebff", fontSize: 13, cursor: "pointer",
                boxShadow: `0 0 20px ${STEPS[step - 1].color}44`,
                letterSpacing: "0.03em", fontFamily: "inherit",
              }}
            >
              {step === 4 ? "map my identity →" : "continue →"}
            </button>
            {step > 1 && (
              <button
                onClick={() => { setStep(step - 1); setError(""); }}
                style={{
                  width: "100%", marginTop: "0.5rem", padding: "10px", borderRadius: 10,
                  border: "0.5px solid #2a1f3d", background: "transparent",
                  color: "#8B83B0", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                ← back
              </button>
            )}
          </div>
        )}

        {/* ── Step 5: Loading ── */}
        {step === 5 && (
          <div style={{
            background: "rgba(255,255,255,0.04)",
            border: "0.5px solid rgba(167,139,250,0.2)",
            borderRadius: 20, padding: "3rem", textAlign: "center",
          }}>
            <style>{`
              @keyframes pulse {
                0%, 100% { transform: scale(1); opacity: 0.5; }
                50% { transform: scale(1.5); opacity: 1; }
              }
            `}</style>
            <div style={{ display: "flex", justifyContent: "center", gap: 14, marginBottom: "1.5rem" }}>
              {NODE_COLORS.map((c, i) => (
                <div key={i} style={{
                  width: 14, height: 14, borderRadius: "50%",
                  background: `radial-gradient(circle at 35% 35%, ${c}ff, ${c}44)`,
                  boxShadow: `0 0 10px ${c}88`,
                  animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
            <p style={{ fontSize: 15, fontWeight: 300, color: "#a78bfa" }}>
              mapping your identity graph...
            </p>
          </div>
        )}

        {/* ── Step 6: Result ── */}
        {step === 6 && result && (
          <div>
            <div id="reflection-card" style={{
              background: "#0d0a1a",
              borderRadius: 20, overflow: "hidden",
              border: "0.5px solid rgba(167,139,250,0.25)",
            }}>
              {/* Photo header */}
              {photo && (
                <img src={photo.url} alt="" style={{
                  width: "100%", maxHeight: 180, objectFit: "cover", opacity: 0.7,
                }} />
              )}

              {/* Current map */}
              <div style={{ padding: "1.5rem 1.5rem 0.75rem" }}>
                <p style={{ fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: "#4a3a5a", marginBottom: "1.25rem" }}>
                  current identity map
                </p>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", overflowX: "auto", paddingBottom: "0.5rem" }}>
                  {[
                    { label: "Memory", val: form.memory, color: NODE_COLORS[0] },
                    { label: "Emotion", val: form.emotion, color: NODE_COLORS[1] },
                    { label: "Belief", val: form.belief, color: NODE_COLORS[2] },
                    { label: "Behavior", val: form.behavior, color: NODE_COLORS[3] },
                  ].map((node, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: 90 }}>
                        <SoulSphere color={node.color} size={44} glow />
                        <p style={{ fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase", color: node.color + "99", textAlign: "center" }}>
                          {node.label}
                        </p>
                        <p style={{ fontSize: 10, color: "#9a8fb4", lineHeight: 1.4, textAlign: "center", fontFamily: "inherit" }}>
                          {node.val.slice(0, 35)}{node.val.length > 35 ? "…" : ""}
                        </p>
                      </div>
                      {i < 3 && <GraphConnector fromColor={NODE_COLORS[i]} toColor={NODE_COLORS[i + 1]} />}
                    </div>
                  ))}
                </div>
              </div>

              {/* Bridge */}
              <div style={{
                display: "flex", alignItems: "center",
                padding: "0.6rem 1.5rem",
                background: "rgba(167,139,250,0.04)",
                borderTop: "0.5px solid rgba(167,139,250,0.1)",
                borderBottom: "0.5px solid rgba(52,211,153,0.1)",
              }}>
                <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, transparent, #7c5cbf55)" }} />
                <span style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "#a78bfa", padding: "0 12px" }}>
                  alternative path opens here
                </span>
                <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, #34d39955, transparent)" }} />
              </div>

              {/* Alternative map */}
              <div style={{ padding: "1rem 1.5rem 1.5rem" }}>
                <p style={{ fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: "#34d39966", marginBottom: "1.25rem" }}>
                  alternative identity path
                </p>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 0, marginBottom: "1.25rem" }}>
                  {[
                    { label: "New Belief", val: result.new_belief, color: ALT_COLORS[0] },
                    { label: "New Behavior", val: result.new_behavior, color: ALT_COLORS[1] },
                  ].map((node, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: 180 }}>
                        <SoulSphere color={node.color} size={56} glow />
                        <p style={{ fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase", color: node.color + "99", textAlign: "center" }}>
                          {node.label}
                        </p>
                        <p style={{ fontSize: 12, color: "#e0d4f4", lineHeight: 1.55, textAlign: "center", fontFamily: "inherit" }}>
                          {node.val}
                        </p>
                      </div>
                      {i === 0 && <GraphConnector fromColor={ALT_COLORS[0]} toColor={ALT_COLORS[1]} />}
                    </div>
                  ))}
                </div>

                {/* Small action */}
                <div style={{
                  background: "rgba(52,211,153,0.06)",
                  border: "0.5px solid rgba(52,211,153,0.2)",
                  borderRadius: 12, padding: "1rem 1.1rem",
                }}>
                  <p style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "#34d399", marginBottom: "0.5rem" }}>
                    small action today
                  </p>
                  <p style={{ fontSize: 14, color: "#a7f3d0", lineHeight: 1.75, fontFamily: "inherit" }}>
                    {result.small_action}
                  </p>
                </div>

                {/* Watermark */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: "1.25rem", opacity: 0.35 }}>
                  <img src="/assets/souling-logo.png" alt="" style={{ width: 14, height: 14, borderRadius: "50%" }} />
                  <span style={{ fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", color: "#8B83B0" }}>
                    Souling Lite
                  </span>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 8, marginTop: "0.75rem" }}>
              <button
                onClick={saveAsImage}
                disabled={saving}
                style={{
                  flex: 1, padding: "12px", borderRadius: 10,
                  border: "0.5px solid rgba(167,139,250,0.3)",
                  background: "transparent", color: "#a78bfa",
                  fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {saving ? "saving..." : "save as image"}
              </button>
              <button
                onClick={reset}
                style={{
                  flex: 1, padding: "12px", borderRadius: 10, border: "none",
                  background: "linear-gradient(135deg, #7c5cbf, #5b3fa0)",
                  color: "#f0ebff", fontSize: 12, cursor: "pointer",
                  boxShadow: "0 0 20px #7c5cbf44", fontFamily: "inherit",
                }}
              >
                start again
              </button>
            </div>
            <p style={{ fontSize: 11, textAlign: "center", color: "#3a2f4a", marginTop: "1rem", lineHeight: 1.6 }}>
              Souling Lite is a reflective tool, not therapy or medical advice.
            </p>
          </div>
        )}

      </div>
    </main>
  );
}
