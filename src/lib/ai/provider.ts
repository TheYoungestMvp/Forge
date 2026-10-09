import "server-only";
import { appJsonSchema } from "@/lib/generation/schema";
import { GenerationError } from "@/lib/generation/errors";

export interface AppGeneratorProvider {
  model: string;
  generate(prompt: string, signal: AbortSignal): Promise<string>;
}

const systemPrompt = `You create complete, functional, attractive self-contained browser applications.
Return ONLY one JSON object with exactly title, html, css, javascript (all strings).
Never use Markdown, code fences, comments outside JSON, or introductory prose.
html is a body fragment, not a full document. Do not include html/head/body/style/script/meta/link/base tags.
Put all styles in css and all behavior in javascript. Use plain classic JavaScript, no imports, JSX, TypeScript, npm, CDNs or external assets.
The application runs inside an opaque-origin sandboxed iframe. It MUST NOT access parent, top, frameElement, browser storage, cookies, external networks, workers or navigation. Use in-memory state only. No eval or Function constructors.
Do NOT use forms, submit buttons, inline on* event attributes, or javascript: URLs. Use type=button, addEventListener, and Enter key handlers instead.
Use meaningful accessible labels on inputs and buttons. Make the layout responsive and keyboard usable.
Use border-box sizing, min-width:0 on shrinking flex/grid children, and wrapping text so the app works without horizontal scrolling even at 240px width.
All requested controls must actually work: adding, deleting, completing, calculating or tracking as appropriate. Preserve DOM event handlers after updates. Use textContent when displaying user input.
For calculators, keep a separate waiting-for-operand state: a digit or decimal after an operator must start a new operand, not append to the previous one. Verify 7+5=12, 8/2=4, 9-4=5, 6*7=42 and 1.5+2.25=3.75. Clear must reset all calculation state.
Use no external CSS resources, @import or url(). Inline SVG graphics are allowed.
Keep the app focused and compact, with no fake API integrations. Do not use setTimeout to pretend features work.
Keep all output under 128 KiB, with each code field under 64 KiB. JavaScript must provide real interaction.`;

export function createAppGeneratorProvider(): AppGeneratorProvider {
  const provider = process.env.LLM_PROVIDER?.trim() || "openai-compatible";
  const model = process.env.LLM_MODEL?.trim();
  const apiKey = process.env.LLM_API_KEY?.trim();
  if (provider !== "openai-compatible") {
    throw new GenerationError(
      "CONFIGURATION_ERROR",
      "LLM_PROVIDER must be openai-compatible for this phase.",
      503,
    );
  }
  if (!model || !apiKey || model === "your-structured-output-model") {
    throw new GenerationError(
      "CONFIGURATION_ERROR",
      "Configure LLM_MODEL and LLM_API_KEY in .env.local, then restart the server.",
      503,
    );
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(
      process.env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1",
    );
  } catch {
    throw new GenerationError(
      "CONFIGURATION_ERROR",
      "LLM_BASE_URL is not a valid URL.",
      503,
    );
  }
  if (
    !["https:", "http:"].includes(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new GenerationError(
      "CONFIGURATION_ERROR",
      "LLM_BASE_URL must be an HTTP(S) API base URL without credentials or query parameters.",
      503,
    );
  }
  const outputMode = process.env.LLM_OUTPUT_MODE || "json_schema";
  if (outputMode !== "json_schema" && outputMode !== "json_object") {
    throw new GenerationError(
      "CONFIGURATION_ERROR",
      "LLM_OUTPUT_MODE must be json_schema or json_object.",
      503,
    );
  }
  const endpoint = `${baseUrl.toString().replace(/\/$/, "")}/chat/completions`;
  const tokenField = process.env.LLM_MAX_TOKENS_FIELD || "max_completion_tokens";
  if (tokenField !== "max_completion_tokens" && tokenField !== "max_tokens") {
    throw new GenerationError(
      "CONFIGURATION_ERROR",
      "LLM_MAX_TOKENS_FIELD must be max_completion_tokens or max_tokens.",
      503,
    );
  }
  const thinkingMode = process.env.LLM_THINKING_MODE?.trim();
  if (thinkingMode && thinkingMode !== "enabled" && thinkingMode !== "disabled") {
    throw new GenerationError(
      "CONFIGURATION_ERROR",
      "LLM_THINKING_MODE must be enabled, disabled or omitted.",
      503,
    );
  }

  return {
    model,
    async generate(prompt, signal) {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: prompt },
            ],
            response_format:
              outputMode === "json_schema"
                ? {
                    type: "json_schema",
                    json_schema: {
                      name: "generated_app",
                      strict: true,
                      schema: appJsonSchema,
                    },
                  }
                : { type: "json_object" },
            [tokenField]: 12000,
            ...(thinkingMode ? { thinking: { type: thinkingMode } } : {}),
            stream: false,
          }),
          signal,
          cache: "no-store",
        });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new GenerationError(
          "PROVIDER_UNREACHABLE",
          "Cannot reach the model service. Check LLM_BASE_URL and your network connection.",
          503,
        );
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          throw new GenerationError(
            "PROVIDER_AUTH_ERROR",
            "The model service rejected the API key. Check LLM_API_KEY and model permissions.",
            502,
          );
        if (response.status === 429)
          throw new GenerationError(
            "PROVIDER_RATE_LIMIT",
            "The model service is rate-limited or out of quota. Please try again later.",
            429,
          );
        throw new GenerationError(
          "PROVIDER_REQUEST_FAILED",
          "The model service rejected generation. Check the model, output mode and API compatibility.",
        );
      }
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > 1024 * 1024)
        throw new GenerationError(
          "OUTPUT_TOO_LARGE",
          "The model response exceeded the allowed size. Try a smaller application.",
        );
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new GenerationError(
          "INVALID_PROVIDER_RESPONSE",
          "The model service returned invalid JSON.",
        );
      }
      const choice = data?.choices?.[0];
      if (choice?.message?.refusal)
        throw new GenerationError(
          "MODEL_REFUSED",
          "The model declined this request. Please describe a different browser application.",
        );
      if (choice?.finish_reason === "length")
        throw new GenerationError(
          "OUTPUT_TRUNCATED",
          "The generated code was cut off. Try a simpler application or a model with a larger output budget.",
        );
      if (
        typeof choice?.message?.content !== "string" ||
        !choice.message.content.trim()
      )
        throw new GenerationError(
          "EMPTY_MODEL_OUTPUT",
          "The model did not return application code. Please try again.",
        );
      return choice.message.content;
    },
  };
}
