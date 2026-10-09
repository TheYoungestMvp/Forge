# Phase 3 verification

Date: 2026-10-09 (Asia/Shanghai).

## Genuine model generation

Provider: OpenAI-compatible Chat Completions at https://api.deepseek.com. Model: deepseek-flash. JSON mode, max_tokens and disabled thinking used the existing configuration; no credentials were printed or exposed in browser requests.

Three consecutive prompts were submitted through the running App Builder UI in one session:

1. `Build a minimal todo app with adding, deleting and completing tasks. Use a light theme. Do not add task filters yet.`
2. `Change the app to dark mode. Preserve all existing functionality.`
3. `Add filters for All and Unfinished tasks. Keep dark mode and preserve adding, deleting and completing tasks.`

Each real request completed successfully. v1 sent no currentApp. v2 sent exactly v1's complete title/html/css/javascript; v3 sent exactly v2's complete code. Every response was a full validated application, not a diff. The UI accumulated v1, v2 and v3 and six user/assistant messages. Input stayed available after each completion. Existing Preview was kept while modifications were pending, and New app was disabled until the request settled.

## Browser interaction acceptance

Interaction checks replayed the exact captured, unmodified real model responses through the same three-round UI flow to avoid duplicate paid generations. No fixture-generated app or manually repaired model code was used. Captured modification requests were compared against the actual outgoing UI request bodies again.

| Version | Checks | Result |
| --- | --- | --- |
| v1 Todo | Light theme; add via button and Enter; complete/uncomplete; delete; summary counts; empty-input validation | Passed |
| v2 Dark mode | Same task operations; rendered body background changed from rgb(245,247,250) to rgb(15,20,27); HTML and JavaScript exactly equal to v1 | Passed |
| v3 Filter | Same task operations; All/Unfinished switching; completed tasks hidden in Unfinished; add, complete and delete within filtered view; empty filtered state; dark background exactly equal to v2 | Passed |

Additional checks passed:

- Version row grows to three entries and marks the newest as Latest. Chat retains all three prompts and assistant completion messages.
- Previous app can still accept tasks while an update is pending. A new version starts a new iframe runtime, so its task data resets as documented.
- Each preview grants only sandbox=allow-scripts; attempted parent DOM access throws SecurityError; no runtime/page errors occurred.
- Desktop/Mobile switching, 320px workspace, version row and generated app had no horizontal overflow. Task addition and Unfinished filtering worked on mobile.
- Two explicit streamed-error fixtures exercised failure and Retry generation. Both kept the complete v3 srcDoc, three versions and previous runtime data. User/assistant failure messages were appended. After the failed update, completing an existing task still updated the filtered view.
- New app cleared all chat messages, generated versions and Preview, and enabled the empty prompt composer.

## Automated checks

- 26 tests passed: existing output/sandbox constraints plus initial/modification request schema, unsafe/oversized/partial context rejection, exact latest-code forwarding, feature-preservation/full-replacement provider instructions, streamed complete replacement and independent new-app requests.
- Final `npm run lint` passed with no errors or warnings.
- Final `npm run build` passed, including TypeScript and the dynamic `/api/generate` route.
- `git diff --check` passed.

## Scope and limitations

Successful generations create client-state version objects with id, number, parentId, createdAt, prompt, model and complete app. Failures create chat errors without creating an invalid version. Historical restoration and database persistence are not implemented in this phase. Refreshing or choosing New app resets the session; applying/reloading a version resets generated runtime data.

Model instructions request feature preservation; schema/static validation does not prove arbitrary generated app correctness. The functional checks above cover the three actual outputs observed in this run.
