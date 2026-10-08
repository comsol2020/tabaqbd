# Agent Builder

Miarouter API দিয়ে এজেন্ট ড্রাফট করা এবং প্রম্পট চালানোর এজেন্ট। আরও API একই জায়গায় যোগ করা যায়।

ডিফল্ট প্রোভাইডার `miarouter`। হোস্ট `https://api.maiarouter.ai/v1`, মডেল `maia/gemini-2.5-flash`। চাবি `MIAROUTER_API_KEY`।

## চালু করা

```bash
cd agent-builder
cp .env.example .env
npx @cursor/bdk dev
```

প্লেগ্রাউন্ড: [http://127.0.0.1:3000/playground](http://127.0.0.1:3000/playground)

`.env` লোড করতে শেল থেকে এক্সপোর্ট করে দিন, অথবা হোস্টেড ডিপ্লয়ে `bdk secrets set` ব্যবহার করুন। এই ফোল্ডার ছাড়া অন্য ডিরেক্টরিতে `bdk serve` চালাবেন না।

## আরেকটা API

OpenAI-কম্প্যাটিবল API হলে কোড বদলাতে হয় না। `EXTRA_PROVIDERS_JSON`-এ একটা অবজেক্ট দিন এবং চাবি আলাদা env-তে রাখুন। ধাপগুলো `bot/skills/add-provider.md`-এ আছে।

অন্য প্রোটোকল লাগলে `bot/lib/providers.ts`-এ নতুন ব্রাঞ্চ যোগ করুন। `list_providers` কখনো চাবি ফেরত দেয় না।

হোস্ট বদলালে `bot/agent.ts`-এর `hosting.egressDomains`-এ সেই হোস্ট যোগ করে তারপর ডিপ্লয় করুন।
