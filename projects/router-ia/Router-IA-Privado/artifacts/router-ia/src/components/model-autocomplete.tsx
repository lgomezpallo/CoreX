import type { ProviderInputKind } from "@workspace/api-client-react";

type ModelSuggestion = {
  id: string;
  detail: string;
};

const suggestionsByProvider: Record<ProviderInputKind, ModelSuggestion[]> = {
  openai: [
    { id: "gpt-5.5", detail: "Más capacidad para tareas complejas" },
    { id: "gpt-5.4-mini", detail: "Rápido y de menor costo" },
    { id: "gpt-4o", detail: "Modelo multimodal" },
    { id: "gpt-4o-mini", detail: "Ligero y rápido" },
  ],
  anthropic: [
    { id: "claude-opus-4-6", detail: "Mayor capacidad" },
    { id: "claude-sonnet-4-6", detail: "Equilibrio entre capacidad y velocidad" },
    { id: "claude-haiku-4-5", detail: "Rápido y eficiente" },
  ],
  gemini: [
    { id: "gemini-3.8-flash", detail: "Rápido para uso general" },
    { id: "gemini-3.7-flash", detail: "Rápido para uso general" },
    { id: "gemini-3.6-flash", detail: "Rápido para uso general" },
    { id: "gemini-3.5-flash", detail: "Rápido para uso general" },
    { id: "gemini-3.1-pro-preview", detail: "Vista previa, tareas complejas" },
  ],
  "openai-compatible": [],
};

const providerNames: Record<ProviderInputKind, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  "openai-compatible": "tu endpoint compatible",
};

type ModelAutocompleteProps = {
  providerKind: ProviderInputKind;
  value: string;
  onChange: (value: string) => void;
};

export function ModelAutocomplete({
  providerKind,
  value,
  onChange,
}: ModelAutocompleteProps) {
  const suggestions = suggestionsByProvider[providerKind];
  const listId = `model-suggestions-${providerKind}`;
  const hintId = `model-hint-${providerKind}`;

  return (
    <label className="block">
      <span className="field-label">ID del modelo</span>
      <input
        data-testid="input-provider-model"
        aria-describedby={hintId}
        list={suggestions.length > 0 ? listId : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={suggestions[0]?.id ?? "ID indicado por el proveedor"}
        className="field-input"
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((suggestion) => (
            <option
              key={suggestion.id}
              value={suggestion.id}
              label={suggestion.detail}
            />
          ))}
        </datalist>
      )}
      <span
        id={hintId}
        className="mt-2 block text-xs leading-5 text-muted-foreground"
      >
        {suggestions.length > 0
          ? `Empieza a escribir para filtrar sugerencias de ${providerNames[providerKind]}; puedes usar otro ID.`
          : `Los IDs dependen de ${providerNames[providerKind]}. Escribe el ID que aparece en su catálogo.`}
      </span>
    </label>
  );
}