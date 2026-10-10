import {
  createFieldRenderer,
  type FieldMessage,
  type FieldRenderer,
} from "./generation-field";

let renderer: FieldRenderer | undefined;
const scope = self as unknown as {
  postMessage: (message: { type: "ready" | "unavailable" }) => void;
};

self.addEventListener("message", (event: MessageEvent<FieldMessage>) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      renderer?.dispose();
      renderer = createFieldRenderer(
        message.canvas,
        message.view,
        message.intent,
        {
          request: (callback) =>
            typeof requestAnimationFrame === "function"
              ? requestAnimationFrame(callback)
              : (setTimeout(
                  () => callback(performance.now()),
                  16,
                ) as unknown as number),
          cancel: (handle) =>
            typeof cancelAnimationFrame === "function"
              ? cancelAnimationFrame(handle)
              : clearTimeout(handle),
        },
      );
      scope.postMessage({ type: "ready" });
    } else if (message.type === "intent") renderer?.update(message.intent);
    else if (message.type === "view") renderer?.resize(message.view);
    else if (message.type === "pause") renderer?.pause(message.paused);
  } catch {
    renderer?.dispose();
    scope.postMessage({ type: "unavailable" });
  }
});
