# Forge — Phase 3 Build and Refine

A runnable App Builder using Next.js App Router, TypeScript and Tailwind CSS. A real model creates and modifies validated HTML/CSS/JavaScript, which runs in an isolated iframe. Each successful generation adds a complete version in client state.

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
- After success, describe a modification in the same composer. The latest generated app is supplied as context, and Preview switches to the complete updated app after validation.
- Try Todo → "Change the app to dark mode" → "Add a filter for unfinished tasks". Chat retains all user/assistant messages, and the version row shows v1, v2 and v3.
- The current app remains usable while an update is generating. An unsuccessful update keeps the last successful app and version; use Retry generation or send a revised prompt.
- Use New app to clear this session and start an independent application.
- Missing configuration, provider failures, invalid output and timeouts show an error with Retry generation.
- Runtime JavaScript errors show a Preview error without crashing the parent workspace.
- On narrow screens, switch between Agent Chat and Preview using the workspace tabs.

## Phase boundaries

Initial generation and follow-up modifications are implemented. A modification sends the new prompt and the latest complete app code. Prior chat is displayed locally; it is not sent to the provider because the current app already contains the accumulated changes. The provider is instructed to preserve existing features and return a complete replacement, never a diff.

Every successful generation appends an immutable version object: `{ id, number, parentId, createdAt, prompt, model, app }`. v1 has no parent; each modification points to the previous successful version. Failed generations do not create a version. The version row is informational; historical version restoration is not implemented in this phase.

Project, chat, versions and app interaction data live in browser memory; refreshing the page or choosing New app resets them. Applying a new version or reloading Preview restarts the generated app's in-memory data; this phase preserves code functionality, not running task data.

No database, generated backend, dependency installation or shell execution is implemented. PRD.md and ARCHITECTURE.md describe future scope, not all completed functionality.

## Generate API

POST `/api/generate`, Content-Type application/json. Initial body: `{ "prompt": "..." }`. Modification body: `{ "prompt": "...", "currentApp": { "title": "...", "html": "...", "css": "...", "javascript": "..." } }`.

Prompt must contain 1–4000 characters; extra request fields are rejected. Existing code passes the same schema, syntax, resource, sandbox-compatibility and UTF-8 size checks as model output before reaching the provider. The total encoded request is capped at 1 MiB to allow escaped source context. Request/config errors return `{ "error": { "code", "message" } }` with an HTTP error status.

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

Phase 3 continuous modification acceptance is recorded in PHASE3_TEST_RESULTS.md. `npm test` runs validation, context-forwarding and API replacement checks without credentials.
