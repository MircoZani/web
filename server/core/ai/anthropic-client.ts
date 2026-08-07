const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicMessageRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

function extractTextFromResponse(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid Anthropic response payload.");
  }
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error("Anthropic response has no content array.");
  }
  const textBlocks = content
    .filter((item): item is { type?: string; text?: string } => typeof item === "object" && item !== null)
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text ?? "");
  if (textBlocks.length === 0) throw new Error("Anthropic response contains no text blocks.");
  return textBlocks.join("\n").trim();
}

function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text;
}

function parseJsonFromText<T>(text: string): T {
  const cleaned = stripCodeFences(text.trim());
  try {
    return JSON.parse(cleaned) as T;
  } catch (firstError) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("Model did not return valid JSON.");
    }
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch (_secondError) {
      // Response was likely cut off before completion (max_tokens reached mid-structure).
      const reason = firstError instanceof Error ? firstError.message : "unknown parse error";
      throw new Error(`Model response was not valid or complete JSON (possibly truncated): ${reason}`);
    }
  }
}

export async function sendAnthropicMessage(request: AnthropicMessageRequest): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is missing.");
  }
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION
    },
    body: JSON.stringify({
      model,
      system: request.system,
      messages: [{ role: "user", content: request.prompt }],
      max_tokens: request.maxTokens ?? 1200,
      temperature: request.temperature ?? 0.2
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
  }
  const payload = (await response.json()) as unknown;
  return extractTextFromResponse(payload);
}

export async function sendAnthropicForJson<T>(request: AnthropicMessageRequest): Promise<T> {
  const text = await sendAnthropicMessage(request);
  return parseJsonFromText<T>(text);
}
