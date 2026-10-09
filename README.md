# Forge — Phase 5 Version History

A runnable App Builder using Next.js App Router, TypeScript and Tailwind CSS. A real model creates and modifies validated HTML/CSS/JavaScript, which runs in an isolated iframe. Supabase stores projects, conversation history and complete generated versions.

## Run locally

Use Node.js 20.9+ (Node.js 24 was used for verification) and npm.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. If port 3000 is occupied, Next.js prints the actual development URL.

On Windows PowerShell, use `Copy-Item .env.example .env.local` to copy the configuration for a new checkout. Preserve your existing `.env.local` if it is already configured. Before starting the server, fill in LLM_MODEL, LLM_API_KEY and your service's LLM_BASE_URL (the API base, such as `https://api.deepseek.com` or `https://api.openai.com/v1`, without `/chat/completions`). Restart after editing configuration. Server secrets must never use a NEXT_PUBLIC_ prefix.

## Supabase setup

1. Run `supabase/migrations/001_persistence.sql` in the SQL Editor of a dedicated Supabase demo project. This creates the three tables, ordering indexes and the function that saves a version and its assistant reply together.
2. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env.local`. A legacy `SUPABASE_SERVICE_ROLE_KEY` works instead. `NEXT_PUBLIC_SUPABASE_URL` is accepted as a fallback for the address; a publishable/anon key cannot write these tables.
3. Start or restart the local server. Create a named project, or send a prompt to create one automatically.

If your Windows connection needs a system proxy to reach Supabase, Node does not automatically pick up that setting. On the verified local machine the existing proxy is `127.0.0.1:7890`. With Node.js 24, set the following in the same PowerShell window before starting the app (substitute your actual proxy address):

```powershell
$env:HTTPS_PROXY="http://127.0.0.1:7890"
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:NODE_USE_ENV_PROXY="1"
npm run dev
```

This only changes that terminal's environment. A connection that can reach Supabase directly does not need these variables.

These routes use one private demo workspace: anyone who can reach the app can open its projects. Authentication and per-user ownership are outside Phase 4. The tables have RLS enabled and no public browser permissions; the privileged database key is only used inside server routes. Do not expose this demo publicly as a multi-user service without adding application authentication.

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
- Use Create project to save an empty named project. Open project lists saved projects, including those from previous browser sessions.
- After success, describe a modification in the same composer. The latest generated app is supplied as context, and Preview switches to the complete updated app after validation.
- Try Todo → "Change the app to dark mode" → "Add a filter for unfinished tasks". Chat retains all user/assistant messages, and the version row shows v1, v2 and v3.
- The current app remains usable while an update is generating. An unsuccessful update keeps the last successful app and version; use Retry generation or send a revised prompt.
- Refresh the project URL to recover the saved conversation, versions and latest Preview. You can also open it from the project picker in a fresh browser session.
- Expand Version History to see versions newest first, their full prompts and creation times in your browser's local timezone. Click a version to run that exact saved app in Preview.
- Historical Preview shows which version is being viewed and which one is latest. Use Return to latest to resume editing, or Restore to make the historical code current.
- Restore copies the selected code into a new saved version. For example, restoring v1 when v3 is latest creates v4; v1, v2 and v3 remain unchanged. The next AI modification uses v4 as its context.
- Restore does not call the model. A failed restore keeps the existing Preview and history and offers Retry restore.
- Use New project to start an independent application; previously saved projects remain in the picker.
- Database configuration, missing tables and connection problems show a storage error with Retry loading. A failed save keeps the previous successful Preview and never marks an unsaved result as a completed version.
- Missing configuration, provider failures, invalid output and timeouts show an error with Retry generation.
- Runtime JavaScript errors show a Preview error without crashing the parent workspace.
- On narrow screens, switch between Agent Chat and Preview using the workspace tabs.

## Phase boundaries

Initial generation, follow-up modifications, project persistence, historical Preview and Restore are implemented. The server reads the latest complete app code from Supabase for a modification. Prior chat is stored and displayed; it is not sent to the provider because the current app already contains the accumulated changes. The provider is instructed to preserve existing features and return a complete replacement, never a diff.

Every successfully saved generation appends an immutable version object: `{ id, number, parentId, createdAt, prompt, model, app }`. v1 has no parent; each modification points to the previous successful version. Failed generations do not create a version. Version History displays all saved versions, their complete prompts and creation times.

Selecting a historical version changes Preview only. Prompt submission is disabled while viewing an old version, so changes are made against the app the user sees: Return to latest or Restore first. Restore appends an exact copy with a new ID, time, sequential number and `Restore vN` prompt. Its parent is the previous latest version. The original model attribution is retained; restoration itself does not use a model. A user restore action and assistant reply are saved to Chat.

Project metadata, messages and generated source versions survive refresh. Generated app interaction data (for example, tasks entered in Preview) remains in iframe memory. Applying a new version or reloading the page/Preview restarts that app's runtime data.

No generated backend, runtime dependency installation, shell execution, authentication, Git diff, branches or merges are implemented. PRD.md and ARCHITECTURE.md describe the full MVP scope, not all completed functionality.

The required columns are stored in `projects`, `messages` and `versions`. Small additional fields preserve existing version metadata and reliable ordering: `request_id`/`seq` on messages and `version_number`/`parent_id`/`model` on versions. A completed request retried with the same ID returns its saved result without generating another version. A stale base version returns 409, so another browser's newer version is not silently overwritten.

User messages are saved before the model call. The `forge_save_generation` SQL function commits the generated version, assistant response and project metadata in one transaction. The app emits a completion event only after that transaction succeeds. When generation fails, its error response is also saved as an assistant message when the database is available.

Phase 5 reuses that transaction for restoration and needs no additional SQL migration. The server scopes the source version to the requested project and validates stored code before copying it. Restore request IDs make retries idempotent, and a stale base version returns 409. The restore intent is saved before its version transaction; if a transaction fails, no new version is returned, and a retry can finish the same request.

## Restore API

POST `/api/projects/{projectId}/restore`, Content-Type application/json:

```json
{
  "versionId": "historical-version-uuid",
  "requestId": "new-restore-request-uuid",
  "baseVersionId": "latest-version-uuid"
}
```

Returns `{ project, version, message, userMessage }` only after saving. No source is accepted from the browser. Missing/cross-project versions return 404, unsafe stored code returns 422, conflicting request IDs or stale heads return 409, and unavailable storage returns 503. Retrying a completed request returns the same saved version. Historical Preview performs no database write.

## Generate API

GET `/api/projects` lists projects ordered by last update. POST `/api/projects` with `{ "name": "..." }` creates a project. GET `/api/projects/{id}` returns `{ project, messages, versions }`, with messages ordered by their sequence and versions by version number. Reads use `Cache-Control: no-store`.

POST `/api/generate`, Content-Type application/json:

```json
{
  "projectId": "project-uuid",
  "requestId": "new-request-uuid",
  "baseVersionId": null,
  "prompt": "Build a todo app."
}
```

For a modification, `baseVersionId` is the latest saved version ID. The server supplies that version's code to the model. The client does not need to resend source. An optional `currentApp` is still validated if supplied, but stored source remains authoritative.

Prompt must contain 1–4000 characters; extra request fields are rejected. Existing code passes the same schema, syntax, resource, sandbox-compatibility and UTF-8 size checks as model output before reaching the provider. The total encoded request is capped at 1 MiB to allow escaped source context. Request/config errors return `{ "error": { "code", "message" } }` with an HTTP error status.

Accepted requests return application/x-ndjson. Each line is one event:

```json
{"type":"status","step":2}
{"type":"message","message":{"id":"...","project_id":"...","request_id":"...","seq":1,"role":"user","content":"...","created_at":"..."}}
{"type":"complete","saved":{"project":{"id":"...","name":"...","created_at":"...","updated_at":"..."},"version":{"id":"...","project_id":"...","version_number":1,"parent_id":null,"prompt":"...","title":"...","html":"...","css":"...","javascript":"...","model":"...","created_at":"..."},"message":{"id":"...","project_id":"...","request_id":"...","seq":2,"role":"assistant","content":"...","created_at":"..."}}}
{"type":"error","code":"INVALID_GENERATED_APP","message":"..."}
```

Status steps are 0–4 (understanding, planning, generating, validating, saving). The UI marks Completed after a saved completion event. A stream terminates with either complete or error, not both. Errors after streaming begins are error events in the HTTP 200 stream. The UI rejects an incomplete/invalid stream and never mounts unvalidated model output.

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
- `src/app/api/projects/`: create/list/load project routes and the Restore endpoint.
- `src/lib/projects/`: persisted record schemas and the small server-only Supabase helper.
- `supabase/migrations/001_persistence.sql`: tables, permissions and atomic generation save.
- `src/lib/ai/provider.ts`: configured model adapter.
- `src/lib/generation/`: schema, static validation and public errors.
- `src/lib/preview/compose.ts`: isolated srcDoc wrapper.

Real-model Todo, Calculator and Habit Tracker interactive acceptance passed with deepseek-flash. Detailed checks and fixes are recorded in PHASE2_TEST_RESULTS.md.

Phase 3 continuous modification acceptance is recorded in PHASE3_TEST_RESULTS.md. `npm test` runs validation, stored-context forwarding, persistence API and save-failure checks without credentials. Phase 4 reload acceptance is recorded in PHASE4_TEST_RESULTS.md.

Phase 5 historical Preview, Restore and continued modification acceptance is recorded in PHASE5_TEST_RESULTS.md.
