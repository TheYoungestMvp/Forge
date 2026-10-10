export type FieldActivity = "idle" | "working" | "complete" | "error";

export type FieldIntent = {
  activity: FieldActivity;
  phase: number;
  engagement: number;
  pointerX: number;
  pointerY: number;
  reducedMotion: boolean;
};

export type FieldView = {
  width: number;
  height: number;
  pixelRatio: number;
  compact: boolean;
  color: string;
};

export type FieldMessage =
  | {
      type: "init";
      canvas: OffscreenCanvas;
      view: FieldView;
      intent: FieldIntent;
    }
  | { type: "view"; view: FieldView }
  | { type: "intent"; intent: FieldIntent }
  | { type: "pause"; paused: boolean };

type Surface = HTMLCanvasElement | OffscreenCanvas;
type Clock = {
  request: (callback: (time: number) => void) => number;
  cancel: (handle: number) => void;
};

export type FieldRenderer = ReturnType<typeof createFieldRenderer>;

/** The same bounded renderer runs in a worker or, if needed, on the main thread. */
export function createFieldRenderer(
  canvas: Surface,
  initialView: FieldView,
  initialIntent: FieldIntent,
  clock: Clock,
) {
  const context = canvas.getContext("2d") as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error("Canvas drawing unavailable");
  let view = initialView;
  let intent = initialIntent;
  let current = { ...initialIntent };
  let frame: number | null = null;
  let paused = false;
  let disposed = false;
  let lastTime: number | null = null;
  let flowTime = 0;
  let drawnActivity = intent.activity;
  let scale = intent.activity === "complete" ? 0.64 : 1;

  function resize() {
    const ratio = Math.min(view.pixelRatio, view.compact ? 1.25 : 1.75);
    canvas.width = Math.max(1, Math.round(view.width * ratio));
    canvas.height = Math.max(1, Math.round(view.height * ratio));
    context!.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw() {
    const ctx = context!;
    const { width, height, compact, color } = view;
    ctx.clearRect(0, 0, width, height);
    if (!width || !height) return;
    const count = compact ? 9 : 15;
    const samples = compact ? 80 : 128;
    const energy = current.engagement;
    const phase = Math.max(0, Math.min(4, current.phase));
    const working = intent.activity === "working";
    const t = intent.reducedMotion ? 0 : flowTime;
    const cx = width * (0.5 + current.pointerX * 0.018);
    const cy = height * (0.5 + current.pointerY * 0.035);
    ctx.strokeStyle = color;
    ctx.lineWidth = compact ? 0.8 : 1;
    for (let ring = 0; ring < count; ring++) {
      const level = ring / (count - 1);
      const rx = width * (0.16 + level * 0.3) * scale;
      const ry = height * (0.18 + level * 0.29) * scale;
      const twist = phase * 0.22 + energy * 0.3;
      ctx.globalAlpha =
        (0.18 + energy * 0.17 + (working ? 0.09 : 0)) *
        (0.6 + Math.sin(level * Math.PI) * 0.4);
      ctx.beginPath();
      for (let point = 0; point <= samples; point++) {
        const angle = (point / samples) * Math.PI * 2;
        // Nested contours share a continuous field, rather than independent particles.
        const displacement =
          Math.sin(angle * 3 + twist + t * 0.55 - level * 2.5) *
            (0.06 + energy * 0.045) +
          Math.cos(angle * 2 - twist - t * 0.32 + level) * 0.065;
        const pinch = 1 - energy * 0.1 * (1 - level);
        const x = cx + Math.cos(angle) * rx * (1 + displacement) * pinch;
        const y = cy + Math.sin(angle) * ry * (1 + displacement);
        if (!point) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function schedule() {
    if (!disposed && !paused && !intent.reducedMotion && frame === null)
      frame = clock.request(tick);
  }

  function stop() {
    if (frame !== null) clock.cancel(frame);
    frame = null;
    lastTime = null;
  }

  function tick(time: number) {
    frame = null;
    if (disposed || paused || intent.reducedMotion) return;
    const delta =
      lastTime === null ? 1 / 60 : Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;
    if (intent.activity === "working") flowTime += delta;
    const easing = 1 - Math.exp(-delta * 10);
    let unsettled = false;
    for (const key of [
      "engagement",
      "phase",
      "pointerX",
      "pointerY",
    ] as const) {
      const distance = intent[key] - current[key];
      if (Math.abs(distance) > 0.002) {
        current[key] += distance * easing;
        unsettled = true;
      } else current[key] = intent[key];
    }
    const targetScale = intent.activity === "complete" ? 0.64 : 1;
    if (Math.abs(scale - targetScale) > 0.002) {
      scale += (targetScale - scale) * easing;
      unsettled = true;
    } else scale = targetScale;
    draw();
    drawnActivity = intent.activity;
    if (intent.activity === "working" || unsettled) schedule();
    else lastTime = null;
  }

  resize();
  draw();
  if (intent.activity === "working") schedule();

  return {
    update(next: FieldIntent) {
      if (disposed) return;
      intent = next;
      if (intent.reducedMotion) {
        stop();
        current = { ...intent };
        scale = intent.activity === "complete" ? 0.64 : 1;
        if (!paused) draw();
      } else if (
        drawnActivity !== intent.activity ||
        intent.activity === "working" ||
        (Object.keys(current) as (keyof FieldIntent)[]).some(
          (key) => current[key] !== intent[key],
        )
      )
        schedule();
    },
    resize(next: FieldView) {
      if (disposed) return;
      view = next;
      resize();
      draw();
    },
    pause(next: boolean) {
      if (disposed || paused === next) return;
      paused = next;
      if (paused) stop();
      else {
        draw();
        schedule();
      }
    },
    dispose() {
      disposed = true;
      stop();
      // Release the backing store, including when a transferred canvas goes away.
      canvas.width = canvas.height = 1;
    },
  };
}
