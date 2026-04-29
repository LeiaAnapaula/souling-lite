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
  },
  {
    key: "emotion" as keyof FormState,
    label: "Emotion",
    heading: "What emotion did it create?",
    sub: "What did that memory make you feel as a child?",
    placeholder: "Fear, happiness, loneliness, joy...",
  },
  {
    key: "belief" as keyof FormState,
    label: "Belief",
    heading: "What belief formed?",
    sub: "What did you decide about yourself because of that feeling?",
    placeholder: "I am not enough. I have to be perfect. I have to earn love...",
  },
  {
    key: "behavior" as keyof FormState,
    label: "Behavior",
    heading: "How does it show up today?",
    sub: "What does that belief make you do (or avoid) in your life now?",
    placeholder: "I overwork. I overgive. I avoid closeness. I avoid being truly seen...",
  },
];

export default function Home() {
  const [photo, setPhoto] = useState<{ url: string; base64: string } | null>(null);
  const [step, setStep] = useState(0); // 0 = photo, 1-4 = prompts, 5 = loading, 6 = result
  const [form, setForm] = useState<FormState>(EMPTY);
  const [result, setResult] = useState<{ new_belief: string; new_behavior: string; small_action: string } | null>(null);
  const [error, setError] = useState("");
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
    if (!form[key].trim()) { setError("Please write something, even a few words."); return; }
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

  const inputClass = "w-full rounded-xl border border-stone-200 px-4 py-3 font-serif text-base text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300 bg-stone-50 resize-none";

  return (
    <main className="min-h-screen bg-stone-50 py-16 px-4">
      <div className="max-w-lg mx-auto space-y-8">

        {/* Header */}
        <div className="text-center space-y-1">
          <p className="text-xs tracking-[0.2em] uppercase text-stone-400">Souling Lite</p>
          <h1 className="font-serif text-3xl font-light text-stone-800">Identity Graph Engine</h1>
          <p className="text-sm text-stone-400">Map your subconscious. Rewrite the pattern.</p>
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-2">
          {[0,1,2,3,4].map(i => (
            <div key={i} className={`rounded-full transition-all duration-300 ${
              i < step ? "w-2 h-2 bg-stone-600" :
              i === step ? "w-3 h-3 bg-stone-800" :
              "w-2 h-2 bg-stone-200"
            }`}/>
          ))}
        </div>

        {/* Step 0: Photo */}
        {step === 0 && (
          <div className="bg-white rounded-2xl border border-stone-100 p-6 space-y-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">step 1 of 5 — anchor</p>
              <h2 className="font-serif text-xl text-stone-800">Upload a childhood photo</h2>
              <p className="text-sm text-stone-400 mt-1">It grounds everything that follows.</p>
            </div>
            <input ref={inputRef} type="file" accept="image/*" className="hidden"
              onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]); }}
              className={`rounded-xl border-2 border-dashed cursor-pointer transition-all overflow-hidden flex flex-col items-center justify-center
                ${photo ? "border-stone-200 border-solid p-0" : "border-stone-200 hover:border-stone-400 p-10 gap-2"}`}
            >
              {photo ? (
                <img src={photo.url} alt="childhood" className="w-full object-cover max-h-64" />
              ) : (
                <>
                  <div className="text-2xl opacity-30">◎</div>
                  <p className="text-sm text-stone-400">drag & drop or tap to browse</p>
                </>
              )}
            </div>
            <button onClick={next} disabled={!photo}
              className="w-full py-3 rounded-xl bg-stone-800 text-white text-sm font-medium disabled:opacity-30 hover:bg-stone-700 transition-colors">
              continue →
            </button>
            <p className="text-xs text-center text-stone-300">Photo stays on your device. Never uploaded to a server.</p>
          </div>
        )}

        {/* Steps 1–4: Prompts */}
        {step >= 1 && step <= 4 && (
          <div className="bg-white rounded-2xl border border-stone-100 p-6 space-y-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-stone-400 mb-1">
                step {step + 1} of 5 — {STEPS[step-1].label.toLowerCase()}
              </p>
              <h2 className="font-serif text-xl text-stone-800">{STEPS[step-1].heading}</h2>
              <p className="text-sm text-stone-400 mt-1">{STEPS[step-1].sub}</p>
            </div>
            {photo && (
              <img src={photo.url} alt="" className="w-full max-h-32 object-cover rounded-lg opacity-60" />
            )}
            <textarea rows={4} className={inputClass}
              placeholder={STEPS[step-1].placeholder}
              value={form[STEPS[step-1].key]}
              onChange={e => setForm({...form, [STEPS[step-1].key]: e.target.value})}
              autoFocus
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button onClick={next}
              className="w-full py-3 rounded-xl bg-stone-800 text-white text-sm font-medium hover:bg-stone-700 transition-colors">
              {step === 4 ? "map my identity →" : "continue →"}
            </button>
            {step > 1 && (
              <button onClick={() => { setStep(step-1); setError(""); }}
                className="w-full py-2 text-sm text-stone-400 hover:text-stone-600 transition-colors">
                ← back
              </button>
            )}
          </div>
        )}

        {/* Step 5: Loading */}
        {step === 5 && (
          <div className="bg-white rounded-2xl border border-stone-100 p-12 flex flex-col items-center gap-4">
            <div className="w-8 h-8 rounded-full border-2 border-stone-200 border-t-stone-600 animate-spin"/>
            <p className="font-serif text-stone-500 italic">mapping your identity graph...</p>
          </div>
        )}

        {/* Step 6: Result */}
        {step === 6 && result && (
          <div className="space-y-4">
            {/* Current map */}
            <div className="bg-white rounded-2xl border border-stone-100 p-6 space-y-4">
              <p className="text-xs uppercase tracking-widest text-stone-400">your current identity map</p>
              {photo && <img src={photo.url} alt="" className="w-full max-h-40 object-cover rounded-lg opacity-70"/>}
              {[
                { label: "Memory", value: form.memory },
                { label: "Emotion", value: form.emotion },
                { label: "Belief", value: form.belief },
                { label: "Behavior", value: form.behavior },
              ].map((node, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <div className="mt-1 w-6 h-6 rounded-full border border-stone-300 flex items-center justify-center flex-shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-stone-400"/>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-widest text-stone-400">{node.label}</p>
                    <p className="font-serif text-stone-700">{node.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Alternative map */}
            <div className="bg-emerald-50 rounded-2xl border border-emerald-100 p-6 space-y-4">
              <p className="text-xs uppercase tracking-widest text-emerald-600">alternative identity path</p>
              {[
                { label: "New Belief", value: result.new_belief },
                { label: "New Behavior", value: result.new_behavior },
              ].map((node, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <div className="mt-1 w-6 h-6 rounded-full border border-emerald-300 flex items-center justify-center flex-shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"/>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-widest text-emerald-500">{node.label}</p>
                    <p className="font-serif text-emerald-900">{node.value}</p>
                  </div>
                </div>
              ))}
              <div className="bg-emerald-100 rounded-xl p-4 mt-2">
                <p className="text-xs uppercase tracking-widest text-emerald-600 mb-1">small action today</p>
                <p className="font-serif text-emerald-900">{result.small_action}</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button onClick={() => navigator.clipboard.writeText(
                `SOULING LITE\n\nMemory: ${form.memory}\nEmotion: ${form.emotion}\nBelief: ${form.belief}\nBehavior: ${form.behavior}\n\nNew Belief: ${result.new_belief}\nNew Behavior: ${result.new_behavior}\nSmall Action: ${result.small_action}`
              )} className="flex-1 py-3 rounded-xl border border-stone-200 text-sm text-stone-600 hover:bg-stone-50 transition-colors">
                copy map
              </button>
              <button onClick={reset}
                className="flex-1 py-3 rounded-xl bg-stone-800 text-white text-sm hover:bg-stone-700 transition-colors">
                start again
              </button>
            </div>
            <p className="text-xs text-center text-stone-300">Souling Lite is a reflective tool, not therapy or medical advice.</p>

            {/* AVATAR SLOT SPATIALREAL LIVEKIT*/}
            {/* <AvatarEmbed reflection={result} /> */}
          </div>
        )}

      </div>
    </main>
  );
}
