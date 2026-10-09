# Forge — Phase 1 UI Demo

A runnable App Builder UI using Next.js App Router, TypeScript and Tailwind CSS.

## Run locally

Use Node.js 20.9+ (Node.js 24 was used for verification) and npm.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. If port 3000 is occupied, Next.js prints the actual development URL.

## Check and build

```sh
npm run lint
npm run build
npm start
```

`npm start` serves the production build at http://localhost:3000 by default.

## What to try

- View the project title, Agent conversation and five-step progress UI.
- Enter a prompt and send it using the button or Enter; Shift+Enter adds a line.
- Observe a simulated run: Understanding requirements → Planning application → Generating code → Validating application → Completed.
- Switch the preview between Desktop and Mobile.
- In the Daylight iframe, add, complete and delete tasks. User task text is rendered as text.
- Reload the preview to reset its tasks.
- On narrow screens, switch between Agent Chat and Preview using the workspace tabs.

## Phase boundaries

Everything is mock data held in browser memory. Prompt submission simulates progress and appends a mock response; it does not interpret requirements or change the example app. Reloading the page resets Chat and progress. The sandboxed preview is a fixed, self-contained HTML/CSS/JavaScript task manager.

No LLM, database, API routes, version history, backend execution or external preview assets are connected. No environment variables are required. The full future scope is recorded in PRD.md and ARCHITECTURE.md; those documents do not describe completed Phase 1 functionality.

## Main files

- `src/app/page.tsx`: main page.
- `src/app/layout.tsx`: document layout and metadata.
- `src/app/globals.css`: Tailwind import and responsive workspace styling.
- `src/components/app-builder.tsx`: Chat, mock run, progress and preview controls.
- `src/lib/mock-preview.ts`: isolated interactive example app.

There are no provider or persistence abstractions in this phase.
