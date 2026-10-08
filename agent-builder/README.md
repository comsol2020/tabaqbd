# Agent Builder

আপনি কন্ডিশন ও রিকোয়ারমেন্ট দেবেন। বিল্ডার এজেন্টের ইনস্ট্রাকশন লিখে প্রতিটা কন্ডিশন মিলিয়ে দেখে, সব পাস হলেই n8n ওয়ার্কফ্লো দেয়। আপনি n8n-এ শুধু API key বসাবেন।

ডিফল্ট API Miarouter (`https://api.maiarouter.ai/v1`, মডেল `maia/gemini-2.5-flash`)। আরও OpenAI-কম্প্যাটিবল API `EXTRA_PROVIDERS_JSON` দিয়ে যোগ করা যায়।

`prepare_agent` যতক্ষণ `ready: true` না হয়, ওয়ার্কফ্লো বের হয় না। প্রতিটা রিকোয়ারমেন্টের বাক্য ইনস্ট্রাকশনে না থাকলে সেই চেক ফেল হয়।

## চালু করা

```bash
cd agent-builder
cp .env.example .env
npx @cursor/bdk dev
```

প্লেগ্রাউন্ড: [http://127.0.0.1:3000/playground](http://127.0.0.1:3000/playground)

## n8n

1. JSON ইমপোর্ট করুন (Chat Trigger, AI Agent, মেমোরি, OpenAI Chat Model)।
2. OpenAI credential বানিয়ে শুধু API key দিন। Base URL ফিল্ড থাকলে ওয়ার্কফ্লোতে যে URL আছে সেটা বসান।
3. মডেল নোডে credential সিলেক্ট করে চ্যাট ট্রিগার থেকে টেস্ট করুন।

মডেল নোড `responsesApiEnabled: false`, যাতে Miarouter-এর chat completions এন্ডপয়েন্টে যায়।

## আরেকটা API

`bot/skills/add-provider.md` দেখুন। হোস্ট বদলালে `bot/agent.ts`-এর `hosting.egressDomains`-এ সেই হোস্ট যোগ করে ডিপ্লয় করুন।
