import type {
  AppBlueprint,
  AppBuilderExpansionProposal,
  AppBuilderModuleId,
  AppBuilderReference,
  AppBuilderTask,
  AppBuilderTurn,
} from "@workspace/api-client-react";
import type { ReferenceAttachment } from "./reference-files";

export const BUILDER_PROJECTS_STORAGE_KEY = "programa-hablando.builder-projects.v1";
export const MAX_BUILDER_PROJECTS = 12;
export const MAX_BUILDER_SOURCES = 5;
const MAX_SAVED_TURNS = 60;
const MAX_SAVED_SOURCE_TEXT = 5000;

export type BuilderSource = ReferenceAttachment & {
  included: boolean;
  useMode: "reference" | "authorized-base";
  hasVisual: boolean;
  wasTextTrimmed: boolean;
};

export type BuilderProject = {
  id: string;
  name: string;
  messages: AppBuilderTurn[];
  blueprint: AppBlueprint | null;
  taskPlan: AppBuilderTask[];
  expansionProposal: AppBuilderExpansionProposal | null;
  expansionDecision: "pending" | "approved" | "declined" | "unavailable" | null;
  approvedModuleId: AppBuilderModuleId | null;
  sources: BuilderSource[];
};

export type BuilderProjectCollection = {
  projects: BuilderProject[];
  activeProjectId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBlueprint(value: unknown): value is AppBlueprint {
  if (!isRecord(value)) return false;
  if (
    typeof value.title !== "string" ||
    typeof value.subtitle !== "string" ||
    typeof value.description !== "string" ||
    !["violet", "ocean", "mint", "amber"].includes(String(value.accentColor)) ||
    (value.appKind !== undefined && !["tasks", "habits", "expenses", "prototype"].includes(String(value.appKind))) ||
    !Array.isArray(value.sections)
  ) return false;

  return value.sections.every((section) => {
    if (!isRecord(section) || !Array.isArray(section.items)) return false;
    if (
      typeof section.id !== "string" ||
      !["stats", "list", "features", "form", "progress"].includes(String(section.type)) ||
      typeof section.title !== "string" ||
      typeof section.description !== "string" ||
      typeof section.actionLabel !== "string"
    ) return false;
    return section.items.every((item) =>
      isRecord(item) &&
      typeof item.id === "string" &&
      typeof item.title === "string" &&
      typeof item.description === "string" &&
      typeof item.value === "string" &&
      typeof item.checked === "boolean",
    );
  });
}

function normalizeBlueprint(value: unknown): AppBlueprint | null {
  if (!isBlueprint(value)) return null;
  const record = value as unknown as Record<string, unknown>;
  const appKind = ["tasks", "habits", "expenses", "prototype"].includes(String(record.appKind))
    ? record.appKind as AppBlueprint["appKind"]
    : "prototype";
  return { ...value, appKind };
}

const MODULE_KIND_BY_ID: Record<AppBuilderModuleId, Exclude<AppBlueprint["appKind"], "prototype">> = {
  "tasks-v1": "tasks",
  "habits-v1": "habits",
  "expenses-v1": "expenses",
};

function sanitizeExpansionProposal(value: unknown): AppBuilderExpansionProposal | null {
  if (!isRecord(value)) return null;
  const status = value.status;
  if (
    status !== "not-needed" &&
    status !== "approval-required" &&
    status !== "unavailable"
  ) return null;
  if (typeof value.message !== "string" || !Array.isArray(value.options) || value.options.length > 2) {
    return null;
  }
  const options = value.options.flatMap((rawOption) => {
    if (!isRecord(rawOption)) return [];
    const moduleId = rawOption.moduleId;
    if (
      typeof moduleId !== "string" ||
      !Object.hasOwn(MODULE_KIND_BY_ID, moduleId) ||
      rawOption.appKind !== MODULE_KIND_BY_ID[moduleId as AppBuilderModuleId] ||
      rawOption.runtimeCost !== 0 ||
      typeof rawOption.name !== "string" ||
      typeof rawOption.version !== "string" ||
      typeof rawOption.summary !== "string" ||
      typeof rawOption.reason !== "string" ||
      typeof rawOption.recommended !== "boolean" ||
      !Array.isArray(rawOption.capabilities) ||
      !Array.isArray(rawOption.limitations) ||
      !rawOption.capabilities.every((item) => typeof item === "string") ||
      !rawOption.limitations.every((item) => typeof item === "string")
    ) return [];
    return [{
      moduleId: moduleId as AppBuilderModuleId,
      appKind: MODULE_KIND_BY_ID[moduleId as AppBuilderModuleId],
      name: rawOption.name.slice(0, 80),
      version: rawOption.version.slice(0, 24),
      summary: rawOption.summary.slice(0, 240),
      capabilities: rawOption.capabilities.slice(0, 8).map((item) => item.slice(0, 100)),
      limitations: rawOption.limitations.slice(0, 8).map((item) => item.slice(0, 140)),
      reason: rawOption.reason.slice(0, 220),
      recommended: rawOption.recommended,
      runtimeCost: 0 as const,
    }];
  });
  if (status === "approval-required" && options.length === 0) return null;
  return {
    status,
    message: value.message.slice(0, 400),
    options: status === "approval-required" ? options : [],
  };
}

function sanitizeMessages(value: unknown): AppBuilderTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (turn): turn is AppBuilderTurn =>
        isRecord(turn) &&
        (turn.role === "user" || turn.role === "assistant") &&
        typeof turn.content === "string",
    )
    .slice(-MAX_SAVED_TURNS)
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, 1600) }));
}

function sanitizeTaskPlan(value: unknown): AppBuilderTask[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((task): task is Record<string, unknown> =>
      isRecord(task) &&
      typeof task.id === "string" &&
      typeof task.title === "string" &&
      (task.capability === "planning" || task.capability === "structured-output") &&
      typeof task.providerId === "string" &&
      typeof task.providerName === "string" &&
      typeof task.attempts === "number",
    )
    .slice(0, 6)
    .map((task) => ({
      id: (task.id as string).slice(0, 80),
      title: (task.title as string).slice(0, 140),
      capability: task.capability as AppBuilderTask["capability"],
      providerId: (task.providerId as string).slice(0, 60),
      providerName: (task.providerName as string).slice(0, 80),
      attempts: Math.max(1, Math.min(5, Math.round(task.attempts as number))),
    }));
}

function sanitizeSources(value: unknown): BuilderSource[] {
  if (!Array.isArray(value)) return [];
  const sources: BuilderSource[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isRecord(item.payload)) continue;
    const payload = item.payload;
    const kind = payload.kind;
    if (
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.detail !== "string" ||
      typeof payload.name !== "string" ||
      typeof payload.extractedText !== "string" ||
      !["image", "document", "code", "archive", "apk"].includes(String(kind))
    ) continue;

    const imageDataUrl = typeof payload.imageDataUrl === "string"
      ? payload.imageDataUrl.slice(0, 1_200_000)
      : undefined;
    const sanitizedPayload: AppBuilderReference = {
      name: payload.name.slice(0, 160),
      kind: kind as AppBuilderReference["kind"],
      extractedText: payload.extractedText.slice(0, 12_000),
      ...(imageDataUrl ? { imageDataUrl } : {}),
    };
    sources.push({
      id: item.id.slice(0, 100),
      name: item.name.slice(0, 180),
      detail: item.detail.slice(0, 240),
      payload: sanitizedPayload,
      included: item.included !== false,
      useMode: item.useMode === "authorized-base" ? "authorized-base" : "reference",
      hasVisual: item.hasVisual === true || Boolean(imageDataUrl),
      wasTextTrimmed: item.wasTextTrimmed === true,
    });
    if (sources.length >= MAX_BUILDER_SOURCES) break;
  }
  return sources;
}

function sanitizeProject(value: unknown): BuilderProject | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) return null;
  const name = typeof value.name === "string" && value.name.trim()
    ? value.name.trim().slice(0, 64)
    : "Mi app";
  return {
    id: value.id.trim().slice(0, 80),
    name,
    messages: sanitizeMessages(value.messages),
    blueprint: normalizeBlueprint(value.blueprint),
    taskPlan: sanitizeTaskPlan(value.taskPlan),
    expansionProposal: sanitizeExpansionProposal(value.expansionProposal),
    expansionDecision:
      value.expansionDecision === "pending" ||
      value.expansionDecision === "approved" ||
      value.expansionDecision === "declined" ||
      value.expansionDecision === "unavailable"
        ? value.expansionDecision
        : null,
    approvedModuleId:
      typeof value.approvedModuleId === "string" &&
      Object.hasOwn(MODULE_KIND_BY_ID, value.approvedModuleId)
        ? value.approvedModuleId as AppBuilderModuleId
        : null,
    sources: sanitizeSources(value.sources),
  };
}

export function serializeBuilderProjectCollection(collection: BuilderProjectCollection): string {
  const persisted: BuilderProjectCollection = {
    ...collection,
    projects: collection.projects.map((project) => ({
      ...project,
      sources: project.sources.map((source) => {
        const wasTextTrimmed = source.wasTextTrimmed || source.payload.extractedText.length > MAX_SAVED_SOURCE_TEXT;
        return {
          ...source,
          hasVisual: source.hasVisual || Boolean(source.payload.imageDataUrl),
          wasTextTrimmed,
          payload: {
            ...source.payload,
            extractedText: source.payload.extractedText.slice(0, MAX_SAVED_SOURCE_TEXT),
            imageDataUrl: undefined,
          },
        };
      }),
    })),
  };
  return JSON.stringify(persisted);
}

export function createBuilderProjectId(): string {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `app-${id}`;
}

export function createBuilderProject(name = "Mi primera app"): BuilderProject {
  return {
    id: createBuilderProjectId(),
    name: name.trim().slice(0, 64) || "Mi app",
    messages: [],
    blueprint: null,
    taskPlan: [],
    expansionProposal: null,
    expansionDecision: null,
    approvedModuleId: null,
    sources: [],
  };
}

export function createDefaultBuilderCollection(): BuilderProjectCollection {
  const project = {
    id: "app-principal",
    name: "Mi primera app",
    messages: [],
    blueprint: null,
    taskPlan: [],
    expansionProposal: null,
    expansionDecision: null,
    approvedModuleId: null,
    sources: [],
  };
  return { projects: [project], activeProjectId: project.id };
}

export function loadBuilderProjectCollection(): BuilderProjectCollection {
  const fallback = createDefaultBuilderCollection();
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(BUILDER_PROJECTS_STORAGE_KEY);
    if (!raw) return fallback;
    const saved: unknown = JSON.parse(raw);
    if (!isRecord(saved) || !Array.isArray(saved.projects)) return fallback;

    const projects: BuilderProject[] = [];
    const seenIds = new Set<string>();
    for (const value of saved.projects) {
      const project = sanitizeProject(value);
      if (!project || seenIds.has(project.id)) continue;
      seenIds.add(project.id);
      projects.push(project);
      if (projects.length >= MAX_BUILDER_PROJECTS) break;
    }
    if (!projects.length) return fallback;

    const activeProjectId =
      typeof saved.activeProjectId === "string" &&
      projects.some((project) => project.id === saved.activeProjectId)
        ? saved.activeProjectId
        : projects[0].id;
    return { projects, activeProjectId };
  } catch {
    return fallback;
  }
}