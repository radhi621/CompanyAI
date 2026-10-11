import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AuthScreen from "../components/AuthScreen";
import MarkdownMessage from "../components/MarkdownMessage";

describe("MarkdownMessage", () => {
  it("renders bold text and tables instead of raw Markdown", () => {
    const text = [
      "**2 patients** found.",
      "",
      "| Name | CIN | ID |",
      "| --- | --- | --- |",
      "| Youssef Amrani | AB123456 | `665f1c2a9b3e4d0012345678` |",
      "| Salma Idrissi | CD654321 | `665f1c2a9b3e4d0087654321` |",
    ].join("\n");

    const { container } = render(<MarkdownMessage text={text} />);

    expect(screen.getByText("2 patients").tagName).toBe("STRONG");
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Name", "CIN", "ID"]);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("665f1c2a9b3e4d0012345678").tagName).toBe("CODE");
    expect(container.textContent).not.toContain("**");
  });

  it("does not render HTML from the AI answer", () => {
    const { container } = render(
      <MarkdownMessage text={'Hi <img src="x" onerror="alert(1)"> <script>alert(2)</script>'} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("opens links in a new tab without giving the page access to the opener", () => {
    render(<MarkdownMessage text="See [the guideline](https://example.org/guide)." />);

    const link = screen.getByRole("link", { name: "the guideline" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("AuthScreen", () => {
  const baseProps = {
    bootstrapForm: { bootstrapKey: "", name: "", email: "", password: "" },
    setBootstrapForm: vi.fn(),
    loginForm: { email: "", password: "" },
    setLoginForm: vi.fn(),
    handleBootstrapAdmin: vi.fn(async () => {}),
    handleLogin: vi.fn(async () => {}),
    busy: false,
    feedback: null,
  };

  it("shows first-run setup only on a fresh install", () => {
    render(<AuthScreen {...baseProps} setupStatus="needed" />);

    expect(screen.getByRole("heading", { name: "Set up MediAssist" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  });

  it("shows sign-in once the app is set up", () => {
    render(<AuthScreen {...baseProps} setupStatus="done" feedback="Invalid credentials" />);

    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Set up MediAssist" })).toBeNull();
    expect(screen.getByText("Invalid credentials")).toBeTruthy();
  });

  it("shows neither form while checking", () => {
    render(<AuthScreen {...baseProps} setupStatus="checking" />);

    expect(screen.getByText("Connecting to MediAssist...")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  });
});
