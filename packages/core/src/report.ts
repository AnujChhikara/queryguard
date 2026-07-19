const REPO = "https://github.com/AnujChhikara/cardinal";

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export interface ReportInput {
  rule: string;
  /** Normalized query call text — the suppression anchor. */
  anchor: string;
  message?: string;
  version?: string;
}

/**
 * A pre-filled GitHub issue URL for reporting a false positive. Query params
 * map to the issue form's field ids (.github/ISSUE_TEMPLATE/false-positive.yml).
 * Never throws; long inputs are truncated so the URL stays well under browser
 * and GitHub limits.
 */
export function buildReportUrl(input: ReportInput): string {
  const params = new URLSearchParams({
    template: "false-positive.yml",
    labels: "false-positive,corpus-candidate",
    title: `[false-positive] ${input.rule}: ${clip(input.anchor, 60)}`,
    rule: input.rule,
    snippet: clip(input.anchor, 1500),
  });
  if (input.message) params.set("message", clip(input.message, 500));
  if (input.version) params.set("version", input.version);
  return `${REPO}/issues/new?${params.toString()}`;
}
