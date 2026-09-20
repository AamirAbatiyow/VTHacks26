import { useEffect, useId, useRef, useState, type RefObject, type PointerEvent } from "react";

type Position = { x: number; y: number };

export function CameraPreview({ videoRef, onClose }: {
  videoRef: RefObject<HTMLVideoElement | null>;
  onClose: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; clientX: number; clientY: number; origin: Position } | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [dragging, setDragging] = useState(false);
  const instructions = useId();

  function move(next: Position) {
    const element = container.current;
    const parent = element?.offsetParent;
    if (!element || !(parent instanceof HTMLElement)) return;
    setPosition({
      x: Math.max(0, Math.min(next.x, parent.clientWidth - element.offsetWidth)),
      y: Math.max(0, Math.min(next.y, parent.clientHeight - element.offsetHeight)),
    });
  }

  useEffect(() => {
    const element = container.current;
    const parent = element?.offsetParent;
    if (!element || !(parent instanceof HTMLElement)) return;
    const observer = new ResizeObserver(() => {
      setPosition(current => current && ({
        x: Math.max(0, Math.min(current.x, parent.clientWidth - element.offsetWidth)),
        y: Math.max(0, Math.min(current.y, parent.clientHeight - element.offsetHeight)),
      }));
    });
    observer.observe(parent);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div ref={container} className="therapy-simulation__camera" data-dragging={dragging}
    style={position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : undefined}>
    <div className="therapy-simulation__camera-drag" role="group" tabIndex={0}
      aria-label="Move camera preview" aria-describedby={instructions}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        const element = container.current;
        if (!element) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        drag.current = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, origin: { x: element.offsetLeft, y: element.offsetTop } };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={event => {
        const active = drag.current;
        if (!active || active.id !== event.pointerId) return;
        move({ x: active.origin.x + event.clientX - active.clientX, y: active.origin.y + event.clientY - active.clientY });
      }}
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
      onKeyDown={event => {
        const element = container.current;
        if (!element || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const step = event.shiftKey ? 30 : 10;
        move({ x: element.offsetLeft + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0), y: element.offsetTop + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0) });
      }}>
      <video ref={videoRef} autoPlay muted playsInline aria-label="Your camera preview" />
      <span>Only visible to you · Drag to move</span>
    </div>
    <span id={instructions} className="visually-hidden">Drag to reposition, or use arrow keys. Hold Shift to move farther.</span>
    <button type="button" aria-label="Close camera preview" onClick={onClose}>×</button>
  </div>;
}
