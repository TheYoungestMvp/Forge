import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFieldRenderer,
  type FieldIntent,
} from "../src/lib/effects/generation-field";

function setup(
  activity: FieldIntent["activity"] = "idle",
  reducedMotion = false,
) {
  let nextId = 0;
  let now = 0;
  let draws = 0;
  const frames = new Map<number, (time: number) => void>();
  const context = new Proxy(
    {},
    {
      get: (_, key) => (key === "clearRect" ? () => draws++ : () => {}),
      set: () => true,
    },
  );
  const canvas = { width: 0, height: 0, getContext: () => context };
  const intent: FieldIntent = {
    activity,
    phase: 0,
    engagement: 0,
    pointerX: 0,
    pointerY: 0,
    reducedMotion,
  };
  const renderer = createFieldRenderer(
    canvas as unknown as HTMLCanvasElement,
    {
      width: 440,
      height: 128,
      compact: false,
      pixelRatio: 3,
      color: "#567e64",
    },
    intent,
    {
      request(callback) {
        frames.set(++nextId, callback);
        return nextId;
      },
      cancel(handle) {
        frames.delete(handle);
      },
    },
  );
  function advance(count = 1) {
    for (let i = 0; i < count; i++) {
      now += 1000 / 60;
      const queued = [...frames.values()];
      frames.clear();
      queued.forEach((callback) => callback(now));
    }
  }
  return { renderer, intent, canvas, frames, advance, draws: () => draws };
}

test("an idle field stops scheduling after input has settled", () => {
  const field = setup();
  assert.equal(field.frames.size, 0);
  field.renderer.update({ ...field.intent, engagement: 0.9 });
  field.advance(180);
  assert.equal(field.frames.size, 0);
  const draws = field.draws();
  field.advance(180);
  assert.equal(field.draws(), draws);
});

test("generation can pause, resume, settle on success, and release its canvas", () => {
  const field = setup("working");
  field.advance(20);
  assert.equal(field.frames.size, 1);
  field.renderer.pause(true);
  const pausedDraws = field.draws();
  field.renderer.update({ ...field.intent, phase: 2 });
  field.advance(100);
  assert.equal(field.draws(), pausedDraws);
  field.renderer.pause(false);
  field.advance(20);
  assert(field.draws() > pausedDraws);
  field.renderer.update({ ...field.intent, activity: "complete", phase: 4 });
  field.advance(180);
  assert.equal(field.frames.size, 0);
  field.renderer.dispose();
  assert.deepEqual([field.canvas.width, field.canvas.height], [1, 1]);
  field.renderer.update({ ...field.intent, activity: "working" });
  assert.equal(field.frames.size, 0);
});

test("reduced motion remains static, including a preference change during generation", () => {
  const staticField = setup("working", true);
  assert.equal(staticField.frames.size, 0);
  staticField.renderer.update({ ...staticField.intent, phase: 3 });
  assert.equal(staticField.frames.size, 0);
  const liveField = setup("working");
  liveField.advance(3);
  liveField.renderer.update({ ...liveField.intent, reducedMotion: true });
  assert.equal(liveField.frames.size, 0);
  liveField.renderer.pause(true);
  const draws = liveField.draws();
  liveField.renderer.update({
    ...liveField.intent,
    reducedMotion: true,
    phase: 4,
  });
  assert.equal(liveField.draws(), draws);
});

test("drawing resolution is capped for high-density and compact displays", () => {
  const field = setup();
  assert.equal(field.canvas.width, 770);
  field.renderer.resize({
    width: 320,
    height: 104,
    pixelRatio: 3,
    compact: true,
    color: "#567e64",
  });
  assert.deepEqual([field.canvas.width, field.canvas.height], [400, 130]);
});
