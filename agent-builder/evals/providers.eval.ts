import { defineEval, includes } from "@cursor/bdk/evals";

export default defineEval({
  tags: ["smoke"],
  cases: [
    {
      id: "list",
      description: "Names the configured model APIs without calling one.",
      async test(t) {
        await t.send(
          "Which model APIs can I use right now? Reply with the provider ids only.",
        );
        t.succeeded();
        t.calledTool("list_providers");
        t.notCalledTool("complete");
        t.check(t.reply, includes(/miarouter/));
      },
    },
  ],
});
