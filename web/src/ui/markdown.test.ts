import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("turns common markdown into html", () => {
    expect(renderMarkdown("**loud**")).toContain("<strong>loud</strong>");
    expect(renderMarkdown("- nest\n- roku")).toMatch(/<li>/);
    expect(renderMarkdown("`tcp/443`")).toContain("<code>");
    expect(renderMarkdown("```yaml\nid: pulse\n```")).toMatch(/<code|pre/i);
  });

  it("drops raw html and unsafe links", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("<script>");
    expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain("javascript:");
    expect(renderMarkdown("![x](http://evil/x.png)")).not.toContain("<img");
  });
});
