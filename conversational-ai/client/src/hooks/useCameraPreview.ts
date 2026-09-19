import { useCallback, useEffect, useRef, useState } from "react";
/** Optional local mirror. Video never enters the voice session or a network request. */
export function useCameraPreview() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef(0);
  const pendingRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stop = useCallback(() => {
    requestRef.current++;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    pendingRef.current = false;
    setStream(null);
    setPending(false);
  }, []);
  const toggle = useCallback(async () => {
    if (streamRef.current || pendingRef.current) { stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setError("Camera preview isn’t available in this browser."); return; }
    const request = ++requestRef.current;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      if (request !== requestRef.current) { next.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = next;
      setStream(next);
    } catch {
      if (request === requestRef.current) setError("The camera couldn’t open. You can continue practicing without it.");
    } finally {
      if (request === requestRef.current) { pendingRef.current = false; setPending(false); }
    }
  }, [stop]);
  useEffect(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, [stream]);
  useEffect(() => () => { requestRef.current++; streamRef.current?.getTracks().forEach(track => track.stop()); }, []);
  return { stream, pending, error, videoRef, stop, toggle };
}
