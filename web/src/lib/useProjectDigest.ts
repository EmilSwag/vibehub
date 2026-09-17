import { useEffect, useState, useSyncExternalStore } from "react";
import type { RepoDigest } from "../types";
import { projectsApi } from "./api";
import { authGeneration, isCurrentAuth, onAuthBoundary } from "./authSession";
import { githubRepoOf } from "./projectUrl";

interface CachedDigest {
  repoKey: string;
  generation: number;
  /** undefined = pending; null = unavailable (also cached, with no retry UI). */
  value: RepoDigest | null | undefined;
  promise: Promise<RepoDigest | null>;
}

// Keep both pending and settled requests across list resorts, remounts and StrictMode.
const digestCache = new Map<string, CachedDigest>();
let cacheGeneration = authGeneration();

function currentEntry(id: string, repoKey: string | null, generation: number): CachedDigest | undefined {
  // Never reuse private repo details after logout or an account switch.
  if (cacheGeneration !== generation) {
    digestCache.clear();
    cacheGeneration = generation;
  }
  const entry = digestCache.get(id);
  return entry && entry.repoKey === repoKey && entry.generation === generation ? entry : undefined;
}

function loadDigest(id: string, repoKey: string, generation: number): CachedDigest {
  const cached = currentEntry(id, repoKey, generation);
  if (cached) return cached;
  const entry: CachedDigest = {
    repoKey,
    generation,
    value: undefined,
    // Enrichment is optional: 404/503 (and transport failures) stay silent.
    promise: projectsApi.digest(id).catch(() => null),
  };
  entry.promise = entry.promise.then((digest) => {
    entry.value = isCurrentAuth(generation) ? digest : null;
    return entry.value;
  });
  digestCache.set(id, entry);
  return entry;
}

export function useProjectDigest(projectId: string, repoUrl: string | null, disabled = false) {
  const generation = useSyncExternalStore(onAuthBoundary, authGeneration, authGeneration);
  const repo = githubRepoOf(repoUrl);
  const repoKey = repo ? `${repo.owner}/${repo.repo}`.toLowerCase() : null;
  const enabled = !disabled && repoKey !== null && isCurrentAuth(generation);
  const [, setResolved] = useState<CachedDigest | null>(null);
  const cached = currentEntry(projectId, repoKey, generation);

  useEffect(() => {
    if (!enabled || !repoKey) return;
    let active = true;
    const entry = loadDigest(projectId, repoKey, generation);
    entry.promise.then(() => {
      if (active && isCurrentAuth(generation)) setResolved(entry);
    });
    return () => { active = false; };
  }, [projectId, repoKey, generation, enabled]);

  return {
    digest: enabled ? cached?.value ?? null : null,
    loading: enabled && cached?.value === undefined,
  };
}
