import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { memory, emotion, belief, behavior } = body;

    if (!memory || !emotion || !belief || !behavior) {
      return NextResponse.json({ error: "Missing fields." }, { status: 400 });
    }

    const systemPrompt = `You are Souling Lite's Identity Graph Engine.
Given a person's Memory → Emotion → Belief → Behavior chain, generate an alternative identity path.

Rules:
- New Belief must directly counter their stated belief using their own words
- New Behavior must be concrete and utterly specific to what they described
- Small Action must be doable today and that ideally remind them of their childhood comfort, physical or emotional, one sentence. If there are no memories, ask a question to the user about their childhood to draw from.
- Be warm and specific drawing from the user's memories, never generic or clinical. If there are no memories, ask a question to the user about their childhood to draw from.
- Output ONLY valid JSON, no markdown, no extra text

Return exactly:
{
  "new_belief": "...",
  "new_behavior": "...",
  "small_action": "..."
}`;

    const userPrompt = `Memory: "${memory}"
Emotion: "${emotion}"
Belief: "${belief}"
Behavior: "${behavior}"

Generate the alternative identity path.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return NextResponse.json({ error: err.error?.message || "Claude API error" }, { status: 500 });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());

    return NextResponse.json(parsed);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
