import { describe, it, expect } from "vitest";
import { buildReportUrl } from "../src/report.js";

describe("buildReportUrl", () => {
  it("builds an issues/new URL with template, labels, title and fields", () => {
    const url = buildReportUrl({
      rule: "n-plus-one",
      anchor: "prisma.post.findMany({ where: { authorId: user.id } })",
      message: 'Query on "post" runs inside a loop (N+1).',
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://github.com/AnujChhikara/cardinal/issues/new");
    expect(u.searchParams.get("template")).toBe("false-positive.yml");
    expect(u.searchParams.get("labels")).toBe("false-positive,corpus-candidate");
    expect(u.searchParams.get("title")).toContain("[false-positive] n-plus-one:");
    expect(u.searchParams.get("rule")).toBe("n-plus-one");
    expect(u.searchParams.get("snippet")).toContain("prisma.post.findMany");
    expect(u.searchParams.get("message")).toContain("runs inside a loop");
  });

  it("truncates long anchors and never throws", () => {
    const url = buildReportUrl({ rule: "n-plus-one", anchor: "x".repeat(10_000) });
    expect(url.length).toBeLessThan(6_000);
    expect(new URL(url).searchParams.get("snippet")!.endsWith("…")).toBe(true);
  });

  it("omits absent optional fields", () => {
    const u = new URL(buildReportUrl({ rule: "over-fetch", anchor: "db.q()" }));
    expect(u.searchParams.has("message")).toBe(false);
    expect(u.searchParams.has("version")).toBe(false);
  });
});
