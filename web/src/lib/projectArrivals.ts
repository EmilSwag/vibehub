/**
 * Detects a project that showed up on `ProjectsPage` without this tab causing it —
 * the `PublishFromAI` flow POSTs straight to the API from an external agent, so
 * there is no local `saved()` call to toast from. A snapshot refresh (mount, or a
 * `visibilitychange` back to the tab) is the only place that can notice it.
 */

interface ArrivalCandidate {
  id: string;
  name: string;
}

/**
 * Projects in `incoming` that neither the last known snapshot nor this tab's own
 * publish/edit/delete/like activity (`locallyChanged`) explains.
 *
 * `known === null` means "no snapshot yet" (the very first load): every project is
 * technically new then, but none of it just arrived — so it never counts.
 */
export function externalArrivals<T extends ArrivalCandidate>(
  incoming: T[],
  known: Set<string> | null,
  locallyChanged: Set<string>
): T[] {
  if (!known) return [];
  return incoming.filter((project) => !known.has(project.id) && !locallyChanged.has(project.id));
}

/** One toast for 1..N arrivals — never one per project. */
export function arrivalToast(arrived: ArrivalCandidate[]): { title: string; body: string } | null {
  if (arrived.length === 0) return null;
  if (arrived.length === 1) return { title: "Published", body: `${arrived[0].name} is now on your profile.` };
  return { title: "Published", body: `${arrived.length} new projects are now on your profile.` };
}
