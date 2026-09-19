import { useCallback, useEffect, useRef, useState } from 'react';
import { detectExpression, loadExpressionModel } from '../vision/expressionModel';
import { summarizeExpressions, type ExpressionSummary } from '../vision/expressions';
import './FacialExpressions.css';

const empty: ExpressionSummary = { label: null, scores: [], message: 'Camera is off' };
const displayLabels = { neutral: 'Neutral', happy: 'Happy-looking', sad: 'Sad-looking', angry: 'Angry-looking', fear: 'Fearful-looking', disgust: 'Disgusted-looking', surprise: 'Surprised-looking' };
function errorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access in your browser, then retry.';
    if (error.name === 'NotFoundError') return 'No camera found. Connect a camera and retry.';
    if (error.name === 'NotReadableError') return 'The camera is unavailable. Close other apps using it and retry.';
  }
  return error instanceof Error ? error.message : 'Camera analysis failed. Please retry.';
}
export function FacialExpressions() {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);
  const [state, setState] = useState<'off' | 'loading' | 'running'>('off');
  const [summary, setSummary] = useState(empty);
  const [error, setError] = useState('');
  const release = useCallback(() => {
    generation.current++;
    running.current = false;
    if (timer.current) clearTimeout(timer.current);
    if (startupTimer.current) clearTimeout(startupTimer.current);
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    if (video.current) { video.current.pause(); video.current.srcObject = null; }
  }, []);
  const stop = useCallback(() => { release(); setState('off'); setSummary(empty); }, [release]);
  useEffect(() => {
    // Stop capture when leaving this screen or hiding the tab.
    const onHidden = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', onHidden);
    return () => { document.removeEventListener('visibilitychange', onHidden); release(); };
  }, [release, stop]);

  async function start() {
    if (running.current) return;
    release();
    running.current = true;
    const id = generation.current;
    const current = () => generation.current === id;
    setState('loading'); setError(''); setSummary({ ...empty, message: 'Loading expression model…' });
    startupTimer.current = setTimeout(() => {
      if (current()) { stop(); setError('Camera or model loading timed out. Check your connection and browser permissions, then retry.'); }
    }, 60000);
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS or localhost and a supported browser.');
      // Load before opening the camera so network failures never leave capture active.
      const model = await loadExpressionModel().catch(() => { throw new Error('Could not load the expression model. Check your internet connection and allow cdn.jsdelivr.net, then retry.'); });
      if (!current()) return;
      setSummary({ ...empty, message: 'Waiting for camera permission…' });
      const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
      if (!current()) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      media.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
        if (current()) { stop(); setError('Camera disconnected. Reconnect it and retry.'); }
      }, { once: true }));
      const element = video.current;
      if (!element) { release(); return; }
      element.srcObject = media;
      await element.play();
      if (!current()) return;
      if (startupTimer.current) clearTimeout(startupTimer.current);
      setState('running');
      async function tick() {
        if (!current()) return;
        try {
          if (element!.readyState >= 2) {
            const result = await detectExpression(model, element!, current);
            if (!current()) return;
            if (result?.error) throw new Error('Expression analysis failed. Stop the camera and try again.');
            if (result) setSummary(summarizeExpressions(result));
          }
          if (current()) timer.current = setTimeout(() => void tick(), 500);
        } catch (failure) {
          if (current()) { stop(); setError(errorMessage(failure)); }
        }
      }
      void tick();
    } catch (failure) {
      if (current()) { stop(); setError(errorMessage(failure)); }
    }
  }
  return <section className="facial-expressions" aria-labelledby="facial-expressions-title">
    <div className="facial-expressions__heading"><h2 id="facial-expressions-title">Facial expressions</h2><span>{state === 'running' ? 'Camera on' : state === 'loading' ? 'Starting…' : 'Optional'}</span></div>
    <p>Explore expression estimates while you practice. Expressions don’t reliably tell us someone’s mood.</p>
    <video ref={video} autoPlay muted playsInline aria-label="Your camera preview" hidden={state !== 'running'} />
    <div className="facial-expressions__result" role="status"><strong>{summary.label ? displayLabels[summary.label] : summary.message}</strong>{summary.label && <span>Expression estimate</span>}</div>
    {summary.scores.length > 0 && <ul aria-label="Expression model scores">{summary.scores.slice(0, 3).map(score => <li key={score.emotion}><span>{displayLabels[score.emotion]}</span><meter min={0} max={1} value={score.score} aria-label={`${displayLabels[score.emotion]} model score`} /><span>{Math.round(score.score * 100)}%</span></li>)}</ul>}
    {summary.scores.length > 0 && <p className="facial-expressions__note">Model scores, not probabilities of your mood.</p>}
    {error && <p className="facial-expressions__error" role="alert">{error}</p>}
    <button type="button" onClick={state === 'off' ? () => void start() : stop}>{state === 'off' ? 'Enable camera' : state === 'loading' ? 'Cancel' : 'Stop camera'}</button>
    <p className="facial-expressions__note">Video is processed in your browser and isn’t recorded or uploaded. Starting loads model files from a CDN.</p>
  </section>;
}
