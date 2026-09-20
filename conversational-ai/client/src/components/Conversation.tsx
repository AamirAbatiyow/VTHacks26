import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationMode, SessionConfig, SessionMinutes } from "@shared/events";
import { SESSION_MINUTE_OPTIONS } from "@shared/events";
import { useVoiceSession } from "../hooks/useVoiceSession";
import { VocallyWordmark } from "./VocallyWordmark";
import { TherapyTopography } from "./TherapyTopography";
import { VoiceCaptions } from "./VoiceCaptions";
import { SimulationGuide } from "./SimulationGuide";
import { SimulationIcon } from "./SimulationIcon";
import { useCameraPreview } from "../hooks/useCameraPreview";
import { CameraPreview } from "./CameraPreview";
import { formatDuration, formatPracticeMode } from "../progress/practiceHistory";
import type { PracticeSession } from "../progress/practiceHistory";
import { ANALYSIS_LABELS, ANALYSIS_NAMES } from "@shared/sessionSummary";
import { playSfx } from "../audio/sfx";
import "./Conversation.css";

type CaptionPace = "slow" | "natural" | "quick";
const paceLabels: Record<CaptionPace, string> = { slow: "Slow", natural: "Natural", quick: "Quick" };
const previewText = "Hello. Take a comfortable breath, and tell me about a small moment from your day. There’s no need to rush.";
const guideKey = "vocally-simulation-guide-v2";

const modes: { id: ConversationMode; name: string; detail: string; symbol: string }[] = [
  { id: "conversation", name: "Conversation", detail: "Everyday talk. If speech snags, we give the words time.", symbol: "◌" },
  { id: "exercises", name: "Speech Exercises", detail: "A technique chosen for you, then practiced out loud.", symbol: "✦" },
  { id: "endless", name: "Endless", detail: "A living conversation. Keep going — we’ll rest it somewhere kind.", symbol: "∞" },
];

interface ExerciseOption {
  id: string;
  name: string;
  summary: string;
  ages: string;
  reason: string;
}

interface ExerciseRecommendation {
  review: string;
  options: ExerciseOption[];
}

interface ConversationTip {
  title: string;
  text: string;
  technique: string;
}

interface ConversationTipsResult {
  review: string;
  tips: ConversationTip[];
  attribution: string;
  source: "rag" | "heuristic";
}

function parseAge(value: string): number | undefined {
  const age = Number(value);
  if (!Number.isFinite(age) || age < 2 || age > 120) return undefined;
  return Math.round(age);
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function Conversation({ initialConfig, onBack, onSessionComplete }: { initialConfig?: SessionConfig | null; onBack?: () => void; onSessionComplete?: (entry: PracticeSession) => void }) {
  const [completed, setCompleted] = useState<PracticeSession | null>(null);
  const session = useVoiceSession((entry) => {
    setCompleted(entry);
    onSessionComplete?.(entry);
  });
  const camera = useCameraPreview();
  const [mode, setMode] = useState<ConversationMode>(
    initialConfig?.conversationMode === "exercises" || initialConfig?.conversationMode === "endless"
      ? initialConfig.conversationMode
      : "conversation",
  );
  const [age, setAge] = useState(initialConfig?.age ? String(initialConfig.age) : "");
  const [struggle, setStruggle] = useState(initialConfig?.needsDescription ?? "");
  const [technique, setTechnique] = useState(initialConfig?.exerciseTechnique ?? "");
  const [sessionMinutes, setSessionMinutes] = useState<SessionMinutes | null>(initialConfig?.sessionMinutes ?? null);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [recommendation, setRecommendation] = useState<ExerciseRecommendation | null>(null);
  const [recStatus, setRecStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [pace, setPace] = useState<CaptionPace>("natural");
  const [paceOpen, setPaceOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tourOpen, setTourOpen] = useState(() => {
    try { return localStorage.getItem(guideKey) !== "done"; } catch { return true; }
  });
  const [tourStep, setTourStep] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [previewId, setPreviewId] = useState(0);
  const [hasPreview, setHasPreview] = useState(false);
  const [praises, setPraises] = useState<{ id: number; text: string }[]>([]);
  const [tips, setTips] = useState<ConversationTipsResult | null>(null);
  const [tipsStatus, setTipsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const paceRef = useRef<HTMLDivElement>(null);
  const paceButton = useRef<HTMLButtonElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const settledId = useRef<string | null>(null);
  const busy = session.sessionActive || session.isStarting || session.connected || session.isEnding;
  const selectedMode = modes.find(item => item.id === mode)!;
  const selectedExercise = recommendation?.options.find(item => item.id === technique);
  const latestAssistant = [...session.transcripts].reverse().find(entry => entry.role === "assistant");
  const captionText = hasPreview ? previewText : session.assistantStreaming || latestAssistant?.text || "";
  const captionId = hasPreview ? `preview-${previewId}` : session.assistantUtteranceId || latestAssistant?.id || "idle";
  const speaking = session.assistantSpeaking || previewing;
  const canStart = mode === "exercises" ? Boolean(technique) : mode === "conversation" ? Boolean(sessionMinutes) : true;
  const remainingMs = endsAt == null ? null : endsAt - now;
  const wrappingUp = session.wrappingUp || Boolean(busy && remainingMs != null && remainingMs <= 0);
  const status = previewing ? "Animation preview" : session.isStarting ? "Getting ready…" : wrappingUp ? (mode === "endless" ? "A good place to rest…" : "That’s all for today…") : session.assistantSpeaking ? "Vocally is speaking" : session.sessionActive ? session.micMuted ? "Microphone is muted" : session.activeGenerationId ? "A moment to think…" : remainingMs != null ? `${formatClock(remainingMs)} left` : "Listening to you" : "Ready when you are";

  useEffect(() => {
    if (!previewing) return;
    const timer = window.setTimeout(() => setPreviewing(false), 16_000);
    return () => window.clearTimeout(timer);
  }, [previewing, previewId]);

  useEffect(() => {
    if (!session.sessionActive || mode !== "conversation" || !sessionMinutes) {
      setEndsAt(null);
      return;
    }
    setEndsAt(Date.now() + sessionMinutes * 60_000);
  }, [session.sessionActive, sessionMinutes, mode]);

  useEffect(() => {
    if (!session.praiseCue || session.praiseCueId < 1) return;
    const id = session.praiseCueId;
    const text = session.praiseCue;
    playSfx("sparkle");
    setPraises((list) => [...list, { id, text }]);
    const timer = window.setTimeout(() => {
      setPraises((list) => list.filter((item) => item.id !== id));
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [session.praiseCue, session.praiseCueId]);

  useEffect(() => {
    if (!completed || busy || completed.mode !== "conversation") {
      if (!completed) {
        setTips(null);
        setTipsStatus("idle");
      }
      return;
    }
    const sessionKey = completed.id;
    let cancelled = false;
    setTipsStatus("loading");
    setTips(null);
    void fetch("/conversation-tips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        childName: initialConfig?.childName,
        userRole: initialConfig?.userRole,
        age: parseAge(age),
        interests: initialConfig?.interests,
        practiceGoals: initialConfig?.practiceGoals,
        needsDescription: struggle.trim() || initialConfig?.needsDescription,
        analysis: completed.analysis,
      }),
    }).then(async (response) => {
      if (!response.ok) throw new Error("Could not load tips.");
      const data = await response.json() as ConversationTipsResult;
      if (!Array.isArray(data.tips) || data.tips.length < 1) throw new Error("No tips returned.");
      if (cancelled || completed.id !== sessionKey) return;
      setTips(data);
      setTipsStatus("ready");
    }).catch(() => {
      if (!cancelled) setTipsStatus("error");
    });
    return () => { cancelled = true; };
  }, [completed, busy, age, struggle, initialConfig]);

  useEffect(() => {
    if (endsAt == null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  useEffect(() => {
    if (!paceOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!paceRef.current?.contains(event.target as Node)) setPaceOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [paceOpen]);

  useEffect(() => {
    if (tourOpen) {
      setSidebarOpen(true);
      playSfx("whoosh");
    }
  }, [tourOpen]);

  useEffect(() => {
    if (!completed || busy) return;
    if (settledId.current === completed.id) return;
    settledId.current = completed.id;
    playSfx("settle");
  }, [completed, busy]);

  const dismissTour = useCallback(() => {
    playSfx("step");
    try { localStorage.setItem(guideKey, "done"); } catch { /* Dismiss for this visit even if storage is unavailable. */ }
    setTourOpen(false);
    window.requestAnimationFrame(() => startButton.current?.focus());
  }, []);

  async function loadRecommendations() {
    setRecStatus("loading");
    try {
      const response = await fetch("/exercise-recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          childName: initialConfig?.childName,
          userRole: initialConfig?.userRole,
          age: parseAge(age),
          interests: initialConfig?.interests,
          practiceGoals: initialConfig?.practiceGoals,
          needsDescription: struggle.trim() || undefined,
        }),
      });
      if (!response.ok) throw new Error("Could not review practice.");
      const data = await response.json() as ExerciseRecommendation;
      if (!Array.isArray(data.options) || data.options.length < 1) throw new Error("No exercises returned.");
      setRecommendation(data);
      setTechnique(current => data.options.some(item => item.id === current) ? current : "");
      setRecStatus("ready");
    } catch {
      setRecStatus("error");
    }
  }

  async function startOrEnd() {
    setPreviewing(false);
    setHasPreview(false);
    if (busy) { camera.stop(); await session.endConversation(); return; }
    if (!canStart) return;
    playSfx("begin");
    setCompleted(null);
    setPraises([]);
    setTips(null);
    setTipsStatus("idle");
    void session.startConversation({
      ...initialConfig,
      conversationMode: mode,
      age: parseAge(age),
      needsDescription: struggle.trim() || undefined,
      exerciseTechnique: mode === "exercises" ? technique : undefined,
      sessionMinutes: mode === "conversation" ? sessionMinutes ?? undefined : undefined,
    });
  }
  async function returnToDashboard() {
    playSfx("step");
    camera.stop();
    await session.endConversation();
    onBack?.();
  }

  return (
    <div className="therapy-simulation" id="conversation" data-sidebar={sidebarOpen ? "open" : "closed"} data-mode={mode} tabIndex={-1}>
      <header className="therapy-simulation__header">
        <div className="therapy-simulation__identity"><span className="therapy-simulation__wordmark"><VocallyWordmark /></span><span className="therapy-simulation__header-divider" /><span className="therapy-simulation__page-name">Therapy simulation</span></div>
        <div className="therapy-simulation__header-actions"><span className="therapy-simulation__private-note"><SimulationIcon name="spark" />A little practice. A little possibility.</span>{onBack && <button className="therapy-simulation__progress" onClick={() => void returnToDashboard()} disabled={session.isEnding}><SimulationIcon name="chart" />Your progress<span aria-hidden="true">↗</span></button>}</div>
      </header>
      <div className="therapy-simulation__layout">
        <aside className="therapy-simulation__sidebar" aria-label="Practice settings">
          <div className="therapy-simulation__sidebar-heading"><span className="therapy-simulation__sidebar-title">Your space</span><button className="therapy-simulation__icon-button" onClick={() => { setSidebarOpen(open => !open); setPaceOpen(false); }} aria-expanded={sidebarOpen} aria-controls="simulation-settings" aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}><SimulationIcon name="sidebar" /></button></div>
          <div id="simulation-settings" className="therapy-simulation__settings" hidden={!sidebarOpen}>
            <section className="therapy-simulation__modes" data-guide={tourOpen && tourStep === 0} aria-labelledby="conversation-mode-label">
              <p className="therapy-simulation__eyebrow" id="conversation-mode-label">Practice mode</p>
              <div className="therapy-simulation__mode-list" role="group" aria-labelledby="conversation-mode-label">{modes.map(item => <button type="button" key={item.id} className="therapy-simulation__mode" aria-pressed={mode === item.id} onClick={() => { if (item.id !== mode) playSfx("select"); setMode(item.id); }} disabled={busy}><span className="therapy-simulation__mode-icon" aria-hidden="true">{item.symbol}</span><span>{item.name}</span><span className="therapy-simulation__mode-dot" aria-hidden="true" /></button>)}</div>
              <p className="therapy-simulation__mode-description">{busy ? "End your session to choose another mode." : selectedMode.detail}</p>
            </section>
            {mode === "conversation" && (
              <section className="therapy-simulation__duration" aria-labelledby="conversation-duration-label">
                <p className="therapy-simulation__eyebrow" id="conversation-duration-label">How long today</p>
                <div className="therapy-simulation__duration-list" role="group" aria-labelledby="conversation-duration-label">
                  {SESSION_MINUTE_OPTIONS.map(minutes => (
                      <button type="button" key={minutes} className="therapy-simulation__duration-option" aria-pressed={sessionMinutes === minutes} disabled={busy} onClick={() => { if (sessionMinutes !== minutes) playSfx("select"); setSessionMinutes(minutes); }}>
                      {minutes} min
                    </button>
                  ))}
                </div>
                <p className="therapy-simulation__rec-note">{busy && remainingMs != null ? `${formatClock(remainingMs)} remaining.` : "Pick a length before you start. When time is up, we’ll close gently."}</p>
              </section>
            )}
            {mode === "endless" && (
              <p className="therapy-simulation__rec-note therapy-simulation__endless-note">Keep the talk going. When it is time to rest, we’ll leave it on a kind beat — never on a miss.</p>
            )}
            {mode === "exercises" && (
              <section className="therapy-simulation__exercises" aria-labelledby="exercise-review-label">
                <p className="therapy-simulation__eyebrow" id="exercise-review-label">What you’re working on</p>
                <label className="therapy-simulation__field">Age
                  <input type="number" min={2} max={120} inputMode="numeric" value={age} disabled={busy} onChange={event => setAge(event.target.value)} placeholder="16" />
                </label>
                <label className="therapy-simulation__field">What feels hard right now?
                  <textarea rows={3} maxLength={1000} value={struggle} disabled={busy} onChange={event => setStruggle(event.target.value)} placeholder="Blocks on first words, rushing, or fear of speaking up…" />
                </label>
                <button type="button" className="therapy-simulation__review-button" onClick={() => void loadRecommendations()} disabled={busy || recStatus === "loading"}>{recStatus === "loading" ? "Reviewing…" : recommendation ? "Review again" : "Review my practice"}</button>
                {recStatus === "error" && <p className="therapy-simulation__rec-note" role="alert">We couldn’t reach the review just now. Try again in a moment.</p>}
                {recommendation && (
                  <>
                    <p className="therapy-simulation__review">{recommendation.review}</p>
                    <p className="therapy-simulation__eyebrow">Your top three</p>
                    <div className="therapy-simulation__exercise-list" role="group" aria-label="Recommended exercises">
                      {recommendation.options.map(item => (
                        <button type="button" key={item.id} className="therapy-simulation__exercise" aria-pressed={technique === item.id} disabled={busy} onClick={() => { if (technique !== item.id) playSfx("select"); setTechnique(item.id); }}>
                          <strong>{item.name}</strong>
                          <span>{item.summary}</span>
                          <small>{item.reason}</small>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {recStatus === "idle" && <p className="therapy-simulation__rec-note">Share your age and what is hard. We’ll pick three techniques that fit you.</p>}
              </section>
            )}
            <div className="therapy-simulation__sidebar-bottom">
              {mode === "conversation" && !sessionMinutes && <div className="therapy-simulation__invitation"><span aria-hidden="true">✳</span><p>No perfect words needed.<br />Just begin where you are.</p></div>}
              {mode === "endless" && !busy && <div className="therapy-simulation__invitation"><span aria-hidden="true">∞</span><p>Speak as fully as you like.<br />We’ll catch the good sentences.</p></div>}
              <div className="therapy-simulation__start-area" data-guide={tourOpen && tourStep === 1}>
                <button ref={startButton} type="button" className="therapy-simulation__start" onClick={() => void startOrEnd()} disabled={session.isEnding || wrappingUp || (!busy && !canStart)}><SimulationIcon name={busy ? "stop" : "play"} />{session.isEnding ? "Saving session…" : session.isStarting ? "Cancel" : wrappingUp ? "Closing…" : busy ? "End session" : "Start session"}<span aria-hidden="true">{busy ? "" : "↗"}</span></button>
                <p className="therapy-simulation__mic-note">{busy ? wrappingUp ? mode === "endless" ? "We’ll leave it here — that was a good stretch." : "That’s all the time we have for today." : "Take all the time you need." : mode === "exercises" && !technique ? "Pick one of the three exercises to begin." : mode === "conversation" && !sessionMinutes ? "Choose a conversation length to begin." : "Your microphone connects when you start."}</p>
              </div>
              <div className="therapy-simulation__tools" data-guide={tourOpen && tourStep === 2}>
                <div className="therapy-simulation__pace-wrap" ref={paceRef} onKeyDown={event => { if (event.key === "Escape") { setPaceOpen(false); paceButton.current?.focus(); } }}>
                  <button ref={paceButton} type="button" className="therapy-simulation__tool" aria-label={`Caption speed: ${paceLabels[pace]}`} aria-expanded={paceOpen} aria-controls="caption-pace-options" onClick={() => setPaceOpen(open => !open)}><SimulationIcon name="speed" /><span>Speed</span><small>{paceLabels[pace]}</small></button>
                  {paceOpen && <div className="therapy-simulation__pace-menu" id="caption-pace-options"><p>Subtitle pace</p>{(["slow", "natural", "quick"] as const).map(value => <button key={value} type="button" aria-pressed={pace === value} onClick={() => { setPace(value); setPaceOpen(false); paceButton.current?.focus(); }}>{paceLabels[value]}<span aria-hidden="true">{pace === value ? "✓" : ""}</span></button>)}<small>Changes how quickly words appear.</small></div>}
                </div>
                <button type="button" className="therapy-simulation__tool" aria-label={session.micMuted ? "Unmute microphone" : "Mute microphone"} aria-pressed={session.micMuted} disabled={session.isStarting} onClick={session.toggleMicrophone}><SimulationIcon name={session.micMuted ? "mic-off" : "mic"} /><span>Mic</span><small>{session.micMuted ? "Muted" : busy ? "On" : "Ready"}</small></button>
                <button type="button" className="therapy-simulation__tool" aria-label={camera.stream ? "Turn off camera preview" : "Enable camera preview"} aria-pressed={Boolean(camera.stream)} disabled={camera.pending} onClick={() => void camera.toggle()}><SimulationIcon name={camera.stream ? "camera" : "camera-off"} /><span>Camera</span><small>{camera.pending ? "Opening" : camera.stream ? "On" : "Off"}</small></button>
              </div>
              <button className="therapy-simulation__help" onClick={() => { setSidebarOpen(true); setTourStep(0); setTourOpen(true); }} aria-haspopup="dialog"><SimulationIcon name="help" />A quick tour</button>
            </div>
          </div>
        </aside>
        <div className="therapy-simulation__main">
          {(session.error || camera.error) && <div className="therapy-simulation__error" role="alert">{session.error || camera.error}</div>}
          {completed && !busy && (
            <section className="therapy-simulation__results" aria-labelledby="session-results-title">
              {completed.mode === "endless" ? (
                <>
                  <p className="therapy-simulation__eyebrow">Endless</p>
                  <h2 id="session-results-title">A good place to <em>rest.</em></h2>
                  {completed.score && (
                    <p className="therapy-simulation__endless-score">
                      <span>Score</span>
                      <strong>{completed.score.total.toLocaleString()}</strong>
                    </p>
                  )}
                  <dl className="therapy-simulation__result-stats">
                    <div><dt>Time together</dt><dd>{formatDuration(completed.seconds)}</dd></div>
                    <div><dt>Speaking turns</dt><dd>{completed.turns}</dd></div>
                    <div><dt>Sentence richness</dt><dd>{completed.score ? `${Math.round(completed.score.complexity * 100)}%` : "—"}</dd></div>
                  </dl>
                  <p className="therapy-simulation__rec-note">Richer sentences lift the score. Long stretches of simple talk don’t.</p>
                </>
              ) : (
                <>
                  <p className="therapy-simulation__eyebrow">This session</p>
                  <h2 id="session-results-title">That’s all for <em>today.</em></h2>
                  <dl className="therapy-simulation__result-stats">
                    <div><dt>Time together</dt><dd>{formatDuration(completed.seconds)}</dd></div>
                    <div><dt>Speaking turns</dt><dd>{completed.turns}</dd></div>
                    <div><dt>Turns with flags</dt><dd>{completed.analysis?.flaggedTurns ?? 0}</dd></div>
                  </dl>
                  {completed.analysis && completed.analysis.analyzedTurns > 0 ? (
                    <>
                      <p className="therapy-simulation__rec-note">{completed.analysis.analyzedTurns} speaking {completed.analysis.analyzedTurns === 1 ? "turn" : "turns"} analyzed.</p>
                      <ul className="therapy-simulation__result-flags">
                        {ANALYSIS_LABELS.filter(label => (completed.analysis?.categories[label] ?? 0) > 0).map(label => (
                          <li key={label}><span>{ANALYSIS_NAMES[label]}</span><strong>{completed.analysis?.categories[label]}</strong></li>
                        ))}
                      </ul>
                      <p className="therapy-simulation__rec-note">Audio model observations, not a diagnosis.</p>
                    </>
                  ) : (
                    <p className="therapy-simulation__rec-note">No audio-analysis results for this session yet. Unanalyzed turns aren’t counted as fluent.</p>
                  )}
                  <section className="therapy-simulation__tips" aria-labelledby="conversation-tips-title">
                    <p className="therapy-simulation__eyebrow" id="conversation-tips-title">Tips for this stretch</p>
                    {tipsStatus === "loading" && <p className="therapy-simulation__rec-note">Matching what showed up today with SLP Stephen’s techniques…</p>}
                    {tipsStatus === "error" && <p className="therapy-simulation__rec-note">We couldn’t load tailored tips just now. The pattern counts above are still yours.</p>}
                    {tips && (
                      <>
                        <p className="therapy-simulation__review">{tips.review}</p>
                        <ol className="therapy-simulation__tip-list">
                          {tips.tips.map((tip) => (
                            <li key={tip.title}>
                              <strong>{tip.title}</strong>
                              <span>{tip.text}</span>
                            </li>
                          ))}
                        </ol>
                        <p className="therapy-simulation__rec-note">{tips.attribution}</p>
                      </>
                    )}
                  </section>
                </>
              )}
              <div className="therapy-simulation__result-actions">
                <button type="button" className="therapy-simulation__start" onClick={() => { playSfx("step"); setCompleted(null); }}>Practice again</button>
                {onBack && <button type="button" className="therapy-simulation__result-progress" onClick={() => void returnToDashboard()}>Your progress<span aria-hidden="true">↗</span></button>}
              </div>
            </section>
          )}
          {!(completed && !busy) && <>
          <section className="therapy-simulation__stage" aria-labelledby="practice-title" data-speaking={speaking}>
            <div className="therapy-simulation__stage-heading"><div><p className="therapy-simulation__eyebrow">One conversation at a time</p><h2 id="practice-title">Find your <em>flow.</em></h2></div><span className="therapy-simulation__status" role="status"><i aria-hidden="true" />{status}</span></div>
            <div className="therapy-simulation__contours"><TherapyTopography speaking={session.assistantSpeaking} previewing={previewing} /></div>
            {mode === "conversation" && session.stutterCue && (
              <p className="therapy-simulation__stutter-cue" key={session.stutterCueId} role="status">{session.stutterCue}</p>
            )}
            {mode === "endless" && praises.length > 0 && (
              <div className="therapy-simulation__praise-layer" aria-live="polite">
                {praises.map((item) => (
                  <p className="therapy-simulation__praise" key={item.id}>{item.text}</p>
                ))}
              </div>
            )}
            {camera.stream && <CameraPreview videoRef={camera.videoRef} onClose={camera.stop} />}
            <div className="therapy-simulation__stage-footer"><span className="therapy-simulation__stage-note"><SimulationIcon name="sound" />{previewing ? "Visual preview · no audio" : wrappingUp ? (mode === "endless" ? "Leaving it on a kind beat." : "That’s all the time we have for today.") : session.assistantSpeaking ? "Follow the words. Find your rhythm." : "A quiet space for your voice."}</span>{session.assistantSpeaking && !wrappingUp ? <button className="therapy-simulation__preview" onClick={session.manualInterrupt}><SimulationIcon name="stop" />Pause reply</button> : !busy && <button className="therapy-simulation__preview" onClick={() => { if (previewing) setPreviewing(false); else { setHasPreview(true); setPreviewId(id => id + 1); setPreviewing(true); } }}><SimulationIcon name={previewing ? "stop" : "play"} />{previewing ? "Stop preview" : "Preview animation"}</button>}</div>
          </section>
          <section className="therapy-simulation__captions" aria-labelledby="captions-label"><div className="therapy-simulation__caption-heading"><p id="captions-label" className="therapy-simulation__eyebrow"><SimulationIcon name="captions" />{hasPreview ? "Preview subtitles" : "Live subtitles"}</p><span>{paceLabels[pace]} pace</span></div><VoiceCaptions text={captionText} utteranceId={captionId} speaking={speaking} complete={hasPreview || Boolean(latestAssistant?.id === captionId)} interrupted={Boolean(latestAssistant?.id === captionId && latestAssistant.interrupted)} pace={pace} placeholder="Your companion’s words will appear here." /></section>
          <footer className="therapy-simulation__footer"><span>{session.interimText ? `You: ${session.interimText}` : "A little space to pause, practice, and grow."}</span><span><i aria-hidden="true" />{selectedExercise ? selectedExercise.name : remainingMs != null ? formatClock(remainingMs) : formatPracticeMode(mode)}</span></footer>
          </>}
        </div>
      </div>
      <SimulationGuide open={tourOpen} step={tourStep} onStepChange={setTourStep} onDismiss={dismissTour} />
    </div>
  );
}
