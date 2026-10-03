import {
  createAnthropic,
  type AnthropicLanguageModelOptions,
} from "@ai-sdk/anthropic";
import { createGateway, type LanguageModel } from "ai";

export interface ClaudeProvider {
  model: LanguageModel;
  modelId: string;
  source: "claude_anthropic" | "claude_ai_gateway";
  providerOptions: { anthropic: { effort: "low" } };
  maxOutputTokens: number;
}

/** Select one provider before inference; a configured direct key never falls through to Gateway. */
export function getClaudeProvider(
  env: NodeJS.ProcessEnv = process.env,
): ClaudeProvider | null {
  const providerOptions = {
    anthropic: { effort: "low" } satisfies AnthropicLanguageModelOptions,
  };
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) {
    const workspaceId = env.ANTHROPIC_WORKSPACE_ID?.trim();
    const modelId = env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
    const anthropic = createAnthropic({
      apiKey,
      ...(workspaceId
        ? { headers: { "anthropic-workspace-id": workspaceId } }
        : {}),
    });
    return {
      model: anthropic(modelId),
      modelId,
      source: "claude_anthropic",
      providerOptions,
      maxOutputTokens: 4096,
    };
  }
  if (env.AI_GATEWAY_API_KEY?.trim() || env.VERCEL_OIDC_TOKEN?.trim()) {
    const modelId =
      env.PUENTE_CLAUDE_MODEL?.trim() || "anthropic/claude-opus-5.5";
    const gateway = createGateway({
      ...(env.AI_GATEWAY_API_KEY?.trim()
        ? { apiKey: env.AI_GATEWAY_API_KEY.trim() }
        : {}),
    });
    return {
      model: gateway(modelId),
      modelId,
      source: "claude_ai_gateway",
      providerOptions,
      maxOutputTokens: 4096,
    };
  }
  return null;
}
