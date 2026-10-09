# Forge — Phase 2 AI App Generation

A runnable App Builder using Next.js App Router, TypeScript and Tailwind CSS. A real model produces validated HTML/CSS/JavaScript, which runs in an isolated iframe.

## Run locally

Use Node.js 20.9+ (Node.js 24 was used for verification) and npm.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. If port 3000 is occupied, Next.js prints the actual development URL.

On Windows PowerShell, use `Copy-Item .env.example .env.local` to copy the configuration. Before starting the server, fill in LLM_MODEL, LLM_API_KEY and your service's LLM_BASE_URL (the API base, such as `https://api.deepseek.com` or `https://api.openai.com/v1`, without `/chat/completions`). Restart after editing configuration. Keys are only read on the server and must never use a NEXT_PUBLIC_ prefix.

The implemented provider speaks the OpenAI-compatible Chat Completions protocol. LLM_PROVIDER=openai-compatible. LLM_OUTPUT_MODE=json_schema requests strict provider-side structured output. If your service only supports JSON mode, explicitly set json_object; all returned content still passes the same strict server validation. Different API protocols need another provider implementation. There is no fallback mock provider.

The example configuration targets DeepSeek: `LLM_OUTPUT_MODE=json_object` and `LLM_MAX_TOKENS_FIELD=max_tokens`. For services using the newer token parameter, set `LLM_MAX_TOKENS_FIELD=max_completion_tokens` (the default when omitted).

`LLM_THINKING_MODE=disabled` turns off DeepSeek reasoning to keep the 12000-token budget available for app code and reduce generation time. Omit it for services that do not support the `thinking` parameter. It is never sent unless configured.

GENERATION_TIMEOUT_MS defaults to 120000 and accepts 1000–120000. The hosting environment must permit the corresponding request duration; maxDuration=150 is a request to the host, not a guarantee. No API configuration is required to run lint or build.

## Check and build

```sh
npm run lint
npm run build
npm start
```

`npm start` serves the production build at http://localhost:3000 by default.

## What to try

- Enter a prompt and send it using the button or Enter; Shift+Enter adds a line.
- Try the Todo App, Calculator and Habit Tracker prompt suggestions.
- Observe real server stages. Understanding/Planning prepare and constrain the generation request; there is one model call, not a separate planning model or fabricated thought stream.
- Switch the preview between Desktop and Mobile.
- Use the generated app's controls. Reload Preview to reset its in-memory state.
- After success, use New app to create an independent app; editing the current app is intentionally disabled.
- Missing configuration, provider failures, invalid output and timeouts show an error with Retry generation.
- Runtime JavaScript errors show a Preview error without crashing the parent workspace.
- On narrow screens, switch between Agent Chat and Preview using the workspace tabs.

## Phase boundaries

Only initial generation is implemented. Requests contain only the new prompt, never previous code or chat. Each new application starts from scratch. Project, chat, generated code and app interaction data live in browser memory; refreshing the page resets them.

No database, follow-up editing, version history, generated backend, dependency installation or shell execution is implemented. PRD.md and ARCHITECTURE.md describe future scope, not all completed functionality.

## Generate API

POST `/api/generate`, Content-Type application/json, body `{ "prompt": "..." }`. Prompt must contain 1–4000 characters; extra request fields are rejected. Request/config errors return `{ "error": { "code", "message" } }` with an HTTP error status.

Accepted requests return application/x-ndjson. Each line is one event:

```json
{"type":"status","step":2}
{"type":"complete","app":{"title":"...","html":"...","css":"...","javascript":"..."},"model":"..."}
{"type":"error","code":"INVALID_GENERATED_APP","message":"..."}
```

Status steps are 0–3; a stream terminates with either complete or error, not both. Errors after streaming begins are error events in the HTTP 200 stream. The UI rejects an incomplete/invalid stream and never mounts unvalidated model output.

## Validation and preview

- Exact four-key object; required strings, title length, nonempty HTML/JavaScript, byte-size bounds; rejects prose, code fences, extra keys and truncated output.
- parse5 checks body-fragment HTML, forbidden elements, event attributes and resource URLs. Forms are intentionally excluded: the preview only grants allow-scripts, so generated apps use click/keydown listeners.
- Acorn checks classic JavaScript syntax and common unsupported globals. This is a static guard, not proof of functional correctness.
- CSP blocks external resource loads; iframe sandbox=allow-scripts omits allow-same-origin, so generated code cannot access parent DOM.
- Host-controlled JSON escaping and textContent injection avoid accidental closing of style/script tags.
- The app mount point uses display:contents so generated body flex/grid layouts retain their intended structure.
- Runtime messages check the source iframe, per-app token and type; this bridge provides only ready/error UI, no privileged host actions.
- iframe/CSP are browser isolation, not CPU or memory isolation. Generated apps must be self-contained; browser storage and network services are unsupported.

## Main files

- `src/app/page.tsx`: main page.
- `src/app/layout.tsx`: document layout and metadata.
- `src/app/globals.css`: Tailwind import and responsive workspace styling.
- `src/components/app-builder.tsx`: Chat, streaming generation status, errors and preview controls.
- `src/app/api/generate/route.ts`: unified generation API.
- `src/lib/ai/provider.ts`: configured model adapter.
- `src/lib/generation/`: schema, static validation and public errors.
- `src/lib/preview/compose.ts`: isolated srcDoc wrapper.

Real-model Todo, Calculator and Habit Tracker interactive acceptance passed with deepseek-flash. Detailed checks and fixes are recorded in PHASE2_TEST_RESULTS.md.
