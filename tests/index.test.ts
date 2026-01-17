import { describe, it, expect } from "vitest";
import { greet, VERSION } from "../src/index.js";

describe("greet", () => {
  it("returns a greeting", () => {
    expect(greet("World")).toBe("Hello, World!");
  });
});

describe("VERSION", () => {
  it("is defined", () => {
    expect(VERSION).toBeDefined();
  });
});
