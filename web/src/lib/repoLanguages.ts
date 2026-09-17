/** RepoBrowser's established monochrome palette: dominant language first.
 * Shared by the full repo browser and the compact project-card strip. */
export const languageShade = (index: number): number => Math.max(0.14, 0.86 - index * 0.15);

/** Repo language shares are fractions (0–1), not whole percentages. */
export const languagePercent = (share: number): string => `${(share * 100).toFixed(share >= 0.1 ? 0 : 1)}%`;
