This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

# Souling Lite — Identity Graph Engine

> An AI-powered prototype that maps a personal memory into emotion, belief, behavior, and an alternative identity path.

---

<img width="1281" height="799" alt="Screenshot 2026-05-03 at 1 40 12 PM" src="https://github.com/user-attachments/assets/47ce4555-0d09-487e-b00c-aaac032130b1" />

---

## What it does

Souling Lite is built on one core thesis:

> Human identity is not random. It is a graph. A memory creates an emotion. An emotion creates a belief. A belief creates a behavior. And all of it can be redesigned.

The app walks a user through their own identity graph — starting from a childhood photo — and uses AI to generate an alternative path: a new belief, a new behavior, and one small action they can take today.

---

## The Identity Graph Engine

This is the core innovation. Not a chatbot. Not a journal. A structured map of the subconscious — and an editable alternative.

---

## Flow

**Step 1 — Anchor**
Upload a childhood photo. It stays local, never sent to a server.

<img width="1286" height="846" alt="Screenshot 2026-05-03 at 1 16 56 PM" src="https://github.com/user-attachments/assets/90c614a8-ba5a-458e-a85a-b7ad6b945f61" />

---

**Step 2 — Memory**
"What memory comes up when you look at this photo?"

<img width="1282" height="807" alt="Screenshot 2026-05-03 at 1 21 54 PM" src="https://github.com/user-attachments/assets/1f493bff-5a14-402c-a7cb-aa9a78f6c344" />

---

**Step 3 — Emotion**
"What emotion did that memory create?"

<img width="1283" height="835" alt="Screenshot 2026-05-03 at 1 23 00 PM" src="https://github.com/user-attachments/assets/a919f730-c5d8-41b9-8793-8c42f084c697" />

---

**Step 4 — Belief**
"What belief about yourself formed from that feeling?"

<img width="1284" height="854" alt="Screenshot 2026-05-03 at 1 23 45 PM" src="https://github.com/user-attachments/assets/14325a07-7517-4e3d-9d97-63b80e9a926e" />

---

**Step 5 — Behavior**
"How does that belief show up in your life today?"

<img width="1281" height="838" alt="Screenshot 2026-05-03 at 1 25 05 PM" src="https://github.com/user-attachments/assets/6140bdfa-0bd8-46ad-8356-e5dcaef3ad76" />

---

**Result — Identity Graph**
The AI generates your current identity map as luminous connected nodes, then opens an alternative path.

<img width="1284" height="930" alt="Screenshot 2026-05-03 at 1 25 40 PM" src="https://github.com/user-attachments/assets/6af30916-34e3-47d4-a9bb-270161267777" />

---

**Saveable Card**
The reflection card can be saved as an image and kept or shared.

<img width="419" height="117" alt="Screenshot 2026-05-03 at 1 39 09 PM" src="https://github.com/user-attachments/assets/5aeeaad8-d622-429f-a0d0-8efcdef14560" />

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS + inline styles |
| AI — Identity Graph | Anthropic Claude API |
| AI — Image Analysis | Google Gemini API |
| Font | Outfit (Google Fonts) |
| Deployment | Vercel |
| Storage | None — fully local, no database |

---

## Run Locally

**1. Clone the repo**
```bash
git clone https://github.com/LeiaAnapaula/souling-lite.git
cd souling-lite
```

**2. Install dependencies**
```bash
npm install
```

**3. Set up environment variables**
```bash
cp .env.example .env.local
```

Open `.env.local` and add:

ANTHROPIC_API_KEY=your-claude-key-here

GEMINI_API_KEY=your-gemini-key-here

Get your keys:
- Claude: [console.anthropic.com](https://console.anthropic.com)
- Gemini: [aistudio.google.com](https://aistudio.google.com)

**4. Run**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Deploy to Vercel

```bash
npx vercel
```

Add both environment variables when prompted, or set them in the Vercel project dashboard.

---

## Project Structure

<img width="424" height="729" alt="Screenshot 2026-05-03 at 1 13 44 PM" src="https://github.com/user-attachments/assets/4b624ce2-186c-4cf1-963b-c56ef58bd536" />

---

## Avatar Slot

Reserved for a future embed. When the SDK docs are ready, uncomment in `page.tsx`:

```tsx
{/* AVATAR SLOT */}
{/* <AvatarEmbed reflection={result} /> */}
```

---

## Safety Note

Souling Lite is a reflective journaling tool. It is not therapy, not medical advice, and not a substitute for professional mental health support.

---

## Built by

Leia Anapaula — CS & Economics, UC Berkeley
Founder, Souling
[leiaanapaula.com](https://www.leiaanapaula.com)

---

*Souling Lite is a doorway. The universe behind it is Souling.*

<img width="1024" height="1024" alt="Souling_New Logo" src="https://github.com/user-attachments/assets/34d0bbe5-5621-4d7e-9ce5-8f7206601f0d" />



