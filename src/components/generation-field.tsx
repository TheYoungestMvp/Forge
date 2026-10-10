"use client";

import { useEffect, useRef } from "react";
import {
  createFieldRenderer,
  type FieldActivity,
  type FieldIntent,
  type FieldMessage,
  type FieldRenderer,
  type FieldView,
} from "@/lib/effects/generation-field";

type Props = {
  variant: "entry" | "preview";
  activity: FieldActivity;
  phase?: number;
  engagement?: number;
};

export function GenerationField({
  variant,
  activity,
  phase = 0,
  engagement = 0,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<{
    update: (intent: Partial<FieldIntent>) => void;
  } | null>(null);

  useEffect(() => {
    controlsRef.current?.update({ activity, phase, engagement });
  }, [activity, phase, engagement]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarse = window.matchMedia("(pointer: coarse)");
    let intent: FieldIntent = {
      activity,
      phase,
      engagement,
      pointerX: 0,
      pointerY: 0,
      reducedMotion: reduced.matches,
    };
    let view: FieldView;
    let worker: Worker | null = null;
    let renderer: FieldRenderer | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let visible = false;
    let disposed = false;
    let initTimer: ReturnType<typeof setTimeout> | undefined;
    let pointerFrame: number | null = null;
    let pointerX = 0;
    let pointerY = 0;

    function post(message: FieldMessage) {
      try {
        worker?.postMessage(message);
      } catch {
        fallback();
      }
    }

    function freshCanvas() {
      const next = document.createElement("canvas");
      next.setAttribute("aria-hidden", "true");
      if (canvas) canvas.replaceWith(next);
      else host!.append(next);
      canvas = next;
      return next;
    }

    function fallback() {
      if (disposed) return;
      clearTimeout(initTimer);
      worker?.terminate();
      worker = null;
      renderer?.dispose();
      renderer = null;
      try {
        renderer = createFieldRenderer(freshCanvas(), view, intent, {
          request: (callback) => window.requestAnimationFrame(callback),
          cancel: (handle) => window.cancelAnimationFrame(handle),
        });
        host!.dataset.renderer = intent.reducedMotion ? "static" : "main";
        renderer.pause(!visible || document.hidden);
      } catch {
        canvas?.remove();
        canvas = null;
        host!.dataset.renderer = "unavailable";
      }
    }

    function initialize() {
      if (
        worker ||
        renderer ||
        disposed ||
        (variant === "preview" && intent.activity === "complete")
      )
        return;
      const target = freshCanvas();
      if (
        !intent.reducedMotion &&
        typeof Worker !== "undefined" &&
        typeof target.transferControlToOffscreen === "function"
      ) {
        try {
          worker = new Worker(
            new URL(
              "../lib/effects/generation-field.worker.ts",
              import.meta.url,
            ),
            { type: "module" },
          );
          worker.onmessage = (event: MessageEvent<{ type: string }>) => {
            if (disposed) return;
            if (event.data.type === "ready") {
              clearTimeout(initTimer);
              host!.dataset.renderer = "worker";
              syncVisibility();
            } else if (event.data.type === "unavailable") fallback();
          };
          worker.onerror = (event) => {
            event.preventDefault();
            fallback();
          };
          const offscreen = target.transferControlToOffscreen();
          worker.postMessage(
            {
              type: "init",
              canvas: offscreen,
              view,
              intent,
            } satisfies FieldMessage,
            [offscreen],
          );
          initTimer = setTimeout(fallback, 1800);
          return;
        } catch {
          // A transferred canvas cannot be reclaimed; fallback creates a fresh one.
        }
      }
      fallback();
    }

    function update(next: Partial<FieldIntent>) {
      intent = { ...intent, ...next };
      if (!worker && !renderer && visible && !document.hidden) initialize();
      renderer?.update(intent);
      if (worker) post({ type: "intent", intent });
    }

    function measure() {
      const rect = host!.getBoundingClientRect();
      view = {
        width: Math.min(rect.width, 1600),
        height: Math.min(rect.height, 1000),
        pixelRatio: window.devicePixelRatio || 1,
        compact: coarse.matches || rect.width < 600,
        color:
          getComputedStyle(host!).getPropertyValue("--accent").trim() ||
          "#567e64",
      };
      renderer?.resize(view);
      if (worker) post({ type: "view", view });
    }

    function syncVisibility() {
      const inactive = !visible || document.hidden;
      if (!inactive) initialize();
      renderer?.pause(inactive);
      if (worker) post({ type: "pause", paused: inactive });
      // State changes still paint a static field when motion is reduced.
      if (intent.reducedMotion) renderer?.update(intent);
    }

    function preferences() {
      update({ reducedMotion: reduced.matches });
      measure();
      host!.dataset.motion = reduced.matches ? "reduced" : "full";
    }

    function pointer(event: PointerEvent) {
      if (
        event.pointerType !== "mouse" ||
        coarse.matches ||
        reduced.matches ||
        !visible ||
        document.hidden ||
        intent.activity === "complete" ||
        intent.activity === "error"
      )
        return;
      const rect = host!.getBoundingClientRect();
      pointerX = Math.max(
        -1,
        Math.min(
          1,
          ((event.clientX - rect.left) / Math.max(rect.width, 1) - 0.5) * 2,
        ),
      );
      pointerY = Math.max(
        -1,
        Math.min(
          1,
          ((event.clientY - rect.top) / Math.max(rect.height, 1) - 0.5) * 2,
        ),
      );
      if (pointerFrame === null)
        pointerFrame = requestAnimationFrame(() => {
          pointerFrame = null;
          update({ pointerX, pointerY });
        });
    }

    function leave() {
      if (pointerFrame !== null) cancelAnimationFrame(pointerFrame);
      pointerFrame = null;
      update({ pointerX: 0, pointerY: 0 });
    }

    const scene = host.closest(".workspace") || host;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      syncVisibility();
    });
    const sizeObserver = new ResizeObserver(measure);
    controlsRef.current = { update };
    measure();
    preferences();
    observer.observe(host);
    sizeObserver.observe(host);
    document.addEventListener("visibilitychange", syncVisibility);
    reduced.addEventListener("change", preferences);
    coarse.addEventListener("change", preferences);
    scene.addEventListener("pointermove", pointer as EventListener, {
      passive: true,
    });
    scene.addEventListener("pointerleave", leave);
    return () => {
      disposed = true;
      controlsRef.current = null;
      clearTimeout(initTimer);
      if (pointerFrame !== null) cancelAnimationFrame(pointerFrame);
      observer.disconnect();
      sizeObserver.disconnect();
      document.removeEventListener("visibilitychange", syncVisibility);
      reduced.removeEventListener("change", preferences);
      coarse.removeEventListener("change", preferences);
      scene.removeEventListener("pointermove", pointer as EventListener);
      scene.removeEventListener("pointerleave", leave);
      worker?.terminate();
      renderer?.dispose();
      canvas?.remove();
    };
    // The surface is initialized once; current values arrive through controlsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={hostRef}
      className={`generation-field generation-field--${variant}`}
      data-activity={activity}
      aria-hidden="true"
    >
      <svg
        className="generation-field-fallback"
        viewBox="0 0 440 144"
        preserveAspectRatio="none"
      >
        {[0, 1, 2, 3, 4, 5, 6, 7].map((ring) => (
          <ellipse
            key={ring}
            cx="220"
            cy="72"
            rx={74 + ring * 18}
            ry={26 + ring * 6}
          />
        ))}
      </svg>
    </div>
  );
}
