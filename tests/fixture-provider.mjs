// Controlled HTTP fixture for transport/error checks. This is not a real model.
// Run only with a separate Next.js process configured to this local endpoint.
import http from "node:http";
import assert from "node:assert/strict";

const app = {
  title: "Fixture Counter",
  html: '<main><h1>Fixture Counter</h1><output aria-label="Count">0</output><button type="button">Increment</button></main>',
  css: "main{font-family:Arial;padding:32px}button{display:block;margin-top:16px}",
  javascript:
    "const closingTag = '</script>'; let count=0; document.querySelector('button').addEventListener('click',()=>{count++;document.querySelector('output').textContent=String(count)});",
};

http
  .createServer(async (request, response) => {
    try {
      assert.equal(request.url, "/v1/chat/completions");
      let body = "";
      for await (const chunk of request) body += chunk;
      const data = JSON.parse(body);
      const planning = data.messages[0].content.startsWith(
        "Write a concise implementation plan",
      );
      assert.equal(data.response_format.json_schema.strict, true);
      assert.deepEqual(
        data.response_format.json_schema.schema.required,
        planning ? ["steps"] : ["title", "html", "css", "javascript"],
      );
      assert([2, 3].includes(data.messages.length));
      if (data.messages.length === 3) {
        assert.equal(data.messages[1].role, "assistant");
        assert.deepEqual(
          Object.keys(JSON.parse(data.messages[1].content)).sort(),
          ["css", "html", "javascript", "title"],
        );
      }
      const prompt = data.messages.at(-1).content;
      if (planning) {
        response.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    steps: [
                      "Create a visible count with an Increment button",
                      "Update the count on click while preserving the current layout",
                    ],
                  }),
                },
              },
            ],
          }),
        );
        return;
      }
      if (prompt === "provider-auth-error") {
        response.writeHead(401).end();
        return;
      }
      if (prompt === "provider-rate-limit") {
        response.writeHead(429).end();
        return;
      }
      if (prompt === "review-pending") {
        await new Promise((resolve) => setTimeout(resolve, 15000));
      } else if (prompt === "timeout") {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      let content = JSON.stringify(app);
      if (prompt === "code-fence") content = "```json\n" + content + "\n```";
      if (prompt === "invalid-schema")
        content = JSON.stringify({ ...app, extra: "not allowed" });
      if (prompt === "syntax-error")
        content = JSON.stringify({ ...app, javascript: "const broken = ;" });
      if (prompt === "parent-dom")
        content = JSON.stringify({
          ...app,
          javascript: "parent.document.body.textContent='bad'",
        });
      if (prompt === "runtime-error")
        content = JSON.stringify({
          ...app,
          javascript: "throw new Error('Fixture runtime failure');",
        });
      if (prompt === "async-runtime-error")
        content = JSON.stringify({
          ...app,
          javascript: "Promise.reject(new Error('Fixture async failure'));",
        });
      response.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          choices: [
            {
              finish_reason: prompt === "truncated" ? "length" : "stop",
              message: {
                content,
                refusal: prompt === "refusal" ? "Refused" : null,
              },
            },
          ],
        }),
      );
    } catch (error) {
      console.error("Fixture request mismatch:", error.message);
      response.writeHead(500).end();
    }
  })
  .listen(4011, "127.0.0.1", () =>
    console.log(
      "Fixture provider: http://127.0.0.1:4011/v1 (not a real model)",
    ),
  );
