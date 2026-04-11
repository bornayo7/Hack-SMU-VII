/**
 * TranslateSettings.jsx — Translation provider selector for VisionTranslate.
 *
 * WHAT THIS DOES:
 * After OCR extracts text from an image, we need to translate it. This component
 * lets the user choose which translation service to use and configure its
 * credentials.
 *
 * AVAILABLE PROVIDERS:
 *
 *   Google Cloud Translation
 *   - Google's commercial translation API. Supports 100+ languages.
 *   - Requires a Google Cloud API key with Translation API enabled.
 *   - Can share the same API key as Google Cloud Vision if both are enabled.
 *
 *   OpenAI (GPT)
 *   - Uses OpenAI's chat completion API for translation. GPT-4 produces very
 *     natural-sounding translations, especially for nuanced or literary text.
 *   - Requires an OpenAI API key.
 *   - User can select which model to use (gpt-4, gpt-4o, gpt-3.5-turbo).
 *
 *   Claude (Anthropic)
 *   - Uses Anthropic's Claude API. Claude excels at maintaining context and
 *     tone in translations, particularly for longer passages.
 *   - Requires an Anthropic API key.
 *   - User can select which model to use (claude-3-opus, claude-3-sonnet, etc.).
 *
 *   LibreTranslate / MyMemory
 *   - Free, open-source translation. No API key needed for MyMemory (rate-limited).
 *   - LibreTranslate can be self-hosted or used via public instances.
 *   - Less accurate than commercial options but completely free.
 *
 * PROPS:
 *   provider                  — Currently selected provider ID
 *   onProviderChange          — Callback when provider changes
 *   openaiApiKey              — Current OpenAI API key
 *   onOpenaiApiKeyChange      — Callback for OpenAI key changes
 *   claudeApiKey              — Current Claude API key
 *   onClaudeApiKeyChange      — Callback for Claude key changes
 *   googleCloudApiKey         — Current Google Cloud API key
 *   onGoogleCloudApiKeyChange — Callback for Google key changes
 *   llmModel                  — Currently selected LLM model
 *   onLlmModelChange          — Callback when LLM model changes
 */

import React from "react";
import ApiKeyInput from "./ApiKeyInput.jsx";

/**
 * PROVIDER_OPTIONS — Available translation services.
 * Each entry has an id, display name, description, and whether it needs
 * an API key or supports model selection.
 */
const PROVIDER_OPTIONS = [
  {
    id: "google",
    name: "Google Cloud Translation",
    description:
      "Fast, reliable translation API supporting 100+ languages. Great for most use cases.",
    needsApiKey: "google",
    needsModel: false,
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    description:
      "LLM-powered translation. Produces natural, context-aware translations. Best for literary or nuanced text.",
    needsApiKey: "openai",
    needsModel: true,
  },
  {
    id: "claude",
    name: "Claude (Anthropic)",
    description:
      "Anthropic's LLM. Excellent at preserving tone and context across longer passages.",
    needsApiKey: "claude",
    needsModel: true,
  },
  {
    id: "libre",
    name: "LibreTranslate / MyMemory",
    description:
      "Free and open-source. No API key needed. Less accurate but great for quick translations.",
    needsApiKey: null,
    needsModel: false,
  },
];

/**
 * MODEL_OPTIONS — Available models for LLM-based providers.
 * Grouped by provider so we can show the relevant models.
 */
const MODEL_OPTIONS = {
  openai: [
    { id: "gpt-4", name: "GPT-4", description: "Most capable, slower" },
    {
      id: "gpt-4o",
      name: "GPT-4o",
      description: "Fast and capable, recommended",
    },
    {
      id: "gpt-4o-mini",
      name: "GPT-4o Mini",
      description: "Fastest, good for simple text",
    },
    {
      id: "gpt-3.5-turbo",
      name: "GPT-3.5 Turbo",
      description: "Legacy, cheapest option",
    },
  ],
  claude: [
    {
      id: "claude-sonnet-4-20250514",
      name: "Claude Sonnet 4",
      description: "Balanced speed and quality",
    },
    {
      id: "claude-3-5-sonnet-20241022",
      name: "Claude 3.5 Sonnet",
      description: "Fast, high quality",
    },
    {
      id: "claude-3-opus-20240229",
      name: "Claude 3 Opus",
      description: "Most capable, slower",
    },
    {
      id: "claude-3-haiku-20240307",
      name: "Claude 3 Haiku",
      description: "Fastest, lightweight tasks",
    },
  ],
};

export default function TranslateSettings({
  provider,
  onProviderChange,
  openaiApiKey,
  onOpenaiApiKeyChange,
  claudeApiKey,
  onClaudeApiKeyChange,
  googleCloudApiKey,
  onGoogleCloudApiKeyChange,
  llmModel,
  onLlmModelChange,
}) {
  // Find the currently selected provider's metadata
  const selectedProvider = PROVIDER_OPTIONS.find((opt) => opt.id === provider);

  // Get the model list for the selected provider (if applicable)
  const models = MODEL_OPTIONS[provider] || [];

  return (
    <div className="translate-settings">
      {/*
        Dropdown selector for the translation provider.
        Using a <select> instead of radio buttons here because the descriptions
        are longer and a dropdown keeps the UI more compact.
      */}
      <div className="form-group">
        <label className="form-label" htmlFor="translation-provider">
          Translation Service
        </label>
        <select
          id="translation-provider"
          className="form-select"
          value={provider}
          onChange={(e) => onProviderChange(e.target.value)}
        >
          {PROVIDER_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.name}
            </option>
          ))}
        </select>

        {/* Show the selected provider's description */}
        {selectedProvider && (
          <p className="form-hint">{selectedProvider.description}</p>
        )}
      </div>

      {/*
        Conditional: Show API key input based on the selected provider.
        Each provider that needs a key specifies which key it uses via
        the "needsApiKey" field.
      */}
      {selectedProvider && selectedProvider.needsApiKey === "google" && (
        <div className="conditional-config fade-in">
          <ApiKeyInput
            label="Google Cloud Translation API Key"
            placeholder="AIza..."
            storageKey="googleCloudApiKey"
            value={googleCloudApiKey}
            onChange={onGoogleCloudApiKeyChange}
          />
          <p className="form-hint">
            If you already entered a Google Cloud key for Vision OCR, the same
            key works here (as long as the Translation API is also enabled).
          </p>
        </div>
      )}

      {selectedProvider && selectedProvider.needsApiKey === "openai" && (
        <div className="conditional-config fade-in">
          <ApiKeyInput
            label="OpenAI API Key"
            placeholder="sk-..."
            storageKey="openaiApiKey"
            value={openaiApiKey}
            onChange={onOpenaiApiKeyChange}
          />
        </div>
      )}

      {selectedProvider && selectedProvider.needsApiKey === "claude" && (
        <div className="conditional-config fade-in">
          <ApiKeyInput
            label="Anthropic (Claude) API Key"
            placeholder="sk-ant-..."
            storageKey="claudeApiKey"
            value={claudeApiKey}
            onChange={onClaudeApiKeyChange}
          />
        </div>
      )}

      {/*
        Conditional: Model selector for LLM-based providers.
        Only shown when the selected provider supports model selection
        (OpenAI and Claude).
      */}
      {selectedProvider && selectedProvider.needsModel && models.length > 0 && (
        <div className="conditional-config fade-in">
          <div className="form-group">
            <label className="form-label" htmlFor="llm-model">
              Model
            </label>
            <select
              id="llm-model"
              className="form-select"
              value={llmModel}
              onChange={(e) => onLlmModelChange(e.target.value)}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} — {model.description}
                </option>
              ))}
            </select>
            <p className="form-hint">
              More capable models produce better translations but are slower and
              more expensive. For most text, the recommended option is a good
              balance.
            </p>
          </div>
        </div>
      )}

      {/*
        Info note for the free provider — no config needed.
      */}
      {selectedProvider && selectedProvider.needsApiKey === null && (
        <div className="conditional-config fade-in">
          <p className="form-hint">
            No API key required. MyMemory allows up to 5,000 characters/day for
            free. For higher limits, you can self-host LibreTranslate.
          </p>
        </div>
      )}
    </div>
  );
}
