import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PublishDemoButton } from "./PublishDemoButton";
import { publishDemoToWebflow } from "./actions";

// The real module is a "use server" file that pulls in the whole server
// stack (Supabase, Anthropic, env parsing) — none of which this UI test needs.
vi.mock("./actions", () => ({
  publishDemoToWebflow: vi.fn(async () => ({ error: null, ok: true })),
}));

const action = vi.mocked(publishDemoToWebflow);

beforeEach(() => {
  action.mockClear();
});

describe("PublishDemoButton (Webflow not configured)", () => {
  it("disables publishing and names the missing env vars", () => {
    render(<PublishDemoButton businessId="biz-1" configured={false} />);

    const button = screen.getByRole("button", { name: "Publicar en Webflow" });
    expect(button).toHaveProperty("disabled", true);
    expect(screen.getByText(/WEBFLOW_API_TOKEN/)).toBeTruthy();
    expect(screen.getByText(/WEBFLOW_SITE_ID/)).toBeTruthy();
  });
});

describe("PublishDemoButton (configured)", () => {
  it("does not publish on the first click — it asks for confirmation", () => {
    render(<PublishDemoButton businessId="biz-1" configured />);

    fireEvent.click(screen.getByRole("button", { name: "Publicar en Webflow" }));

    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sí, publicar ahora" })).toBeTruthy();
  });

  it("warns that the configured Webflow site goes live, not the in-app preview", () => {
    render(<PublishDemoButton businessId="biz-1" configured />);
    fireEvent.click(screen.getByRole("button", { name: "Publicar en Webflow" }));

    expect(screen.getByText(/WEBFLOW_SITE_ID/)).toBeTruthy();
    expect(screen.getByText(/no se sube a Webflow/)).toBeTruthy();
  });

  it("submits the confirmation flag the server action requires", () => {
    const { container } = render(<PublishDemoButton businessId="biz-1" configured />);
    fireEvent.click(screen.getByRole("button", { name: "Publicar en Webflow" }));

    const confirmField = container.querySelector<HTMLInputElement>('input[name="confirm"]');
    expect(confirmField?.value).toBe("yes");
  });

  it("backs out of the confirmation without publishing", () => {
    render(<PublishDemoButton businessId="biz-1" configured />);
    fireEvent.click(screen.getByRole("button", { name: "Publicar en Webflow" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Publicar en Webflow" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sí, publicar ahora" })).toBeNull();
  });
});
