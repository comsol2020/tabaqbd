import { defineEval, includes } from "@cursor/bdk/evals";

export default defineEval({
  tags: ["smoke"],
  cases: [
    {
      id: "support",
      description: "A Bengali support agent is checked and returned as an n8n workflow.",
      async test(t) {
        await t.send(
          "একটা সাপোর্ট এজেন্ট বানাও। রিকোয়ারমেন্ট: প্রতিটি উত্তর বাংলায় হবে। আমি শুধু ক্রিডেনশিয়াল দেব। n8n-এ চালানোর ওয়ার্কফ্লো দাও।",
        );
        t.succeeded();
        t.calledTool("prepare_agent");
        t.notCalledTool("complete");
        t.check(t.reply, includes(/n8n/i));
        t.check(t.reply, includes(/credential|ক্রিডেনশিয়াল|API key/i));
      },
    },
  ],
});
