/**
 * Chat completions for the admin assistant: TensorX (DeepSeek) first, Mistral as
 * fallback — the same chain as crm-mistral-flow, but with plain fetch against the
 * OpenAI-compatible API instead of the openai SDK (no new dependency).
 * Keys live in the VPS .env only (LLM_*, MISTRAL_API_KEY); never NEXT_PUBLIC_.
 */

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string }

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } }

export type ToolDef = {
  type: "function"
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

type Provider = { name: string; baseUrl: string; apiKey: string; model: string; reasoningEffort?: string }

function providers(): Provider[] {
  const chain: Provider[] = []
  const { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_REASONING_EFFORT, MISTRAL_API_KEY, MISTRAL_MODEL } = process.env
  if (LLM_BASE_URL && LLM_API_KEY && LLM_MODEL) {
    // DeepSeek on TensorX doesn't think without reasoning_effort and then misreads tool output
    chain.push({ name: "tensorx", baseUrl: LLM_BASE_URL, apiKey: LLM_API_KEY, model: LLM_MODEL, reasoningEffort: LLM_REASONING_EFFORT || "medium" })
  }
  if (MISTRAL_API_KEY) {
    chain.push({ name: "mistral", baseUrl: "https://api.mistral.ai/v1", apiKey: MISTRAL_API_KEY, model: MISTRAL_MODEL || "mistral-medium-3.5" })
  }
  return chain
}

export function llmConfigured(): boolean {
  return providers().length > 0
}

/**
 * One completion with fallback. Each provider gets one try plus one quick retry
 * on 429/5xx/timeout, then the next provider.
 */
export async function chat(messages: ChatMessage[], tools: ToolDef[], cacheKey?: string): Promise<{ message: Extract<ChatMessage, { role: "assistant" }>; provider: string }> {
  const chain = providers()
  if (chain.length === 0) throw new Error("Ingen modell konfigurerad (LLM_* eller MISTRAL_API_KEY saknas).")
  let lastErr: unknown
  for (const p of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${p.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` },
          body: JSON.stringify({
            model: p.model,
            messages,
            tools,
            tool_choice: "auto",
            temperature: 0.2,
            ...(p.reasoningEffort ? { reasoning_effort: p.reasoningEffort } : {}),
            ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
          }),
          signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS || 60000)),
        })
        if (!res.ok) {
          // Never log the body of the request (it holds the conversation); status is enough
          const err = new Error(`${p.name} svarade ${res.status}`)
          if (res.status === 429 || res.status >= 500) { lastErr = err; continue }
          throw err
        }
        const body = await res.json()
        const m = body?.choices?.[0]?.message
        if (!m) throw new Error(`${p.name}: tomt svar`)
        return {
          message: { role: "assistant", content: m.content ?? null, ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) },
          provider: p.name,
        }
      } catch (err) {
        lastErr = err
        if ((err as Error).name !== "TimeoutError" && attempt === 0 && !(err as Error).message?.includes("svarade 4")) continue
        break
      }
    }
    console.warn(`[assistant] ${p.name} misslyckades (${(lastErr as Error)?.message}), provar nästa`)
  }
  throw lastErr
}
