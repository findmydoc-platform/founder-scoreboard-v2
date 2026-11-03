import { useState } from "react";
import { renderToString } from "react-dom/server";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { AppSidebar } from "./app-sidebar";
import { desktopSidebarBootstrapScript } from "../model/desktop-sidebar-preference";

function SidebarJourney() {
  const [generation, setGeneration] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  return <div>
    <AppSidebar key={generation} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
    <main className="app-sidebar-main">
      <button className="lg:hidden" onClick={() => setMobileOpen(true)}>Navigation öffnen</button>
      <button onClick={() => setGeneration(value => value + 1)}>Finish loading</button>
    </main>
  </div>;
}

const meta = {
  title: "Features/Planning/Organisms/AppSidebar",
  component: SidebarJourney,
  parameters: { layout: "fullscreen" },
  beforeEach: () => {
    const previous = localStorage.getItem("founderops.desktop-sidebar-expanded");
    const previousAttribute = document.documentElement.dataset.desktopSidebarExpanded;
    localStorage.setItem("founderops.desktop-sidebar-expanded", "false");
    document.documentElement.dataset.desktopSidebarExpanded = "false";
    return () => {
      if (previous === null) localStorage.removeItem("founderops.desktop-sidebar-expanded");
      else localStorage.setItem("founderops.desktop-sidebar-expanded", previous);
      if (previousAttribute === undefined) delete document.documentElement.dataset.desktopSidebarExpanded;
      else document.documentElement.dataset.desktopSidebarExpanded = previousAttribute;
    };
  },
} satisfies Meta<typeof SidebarJourney>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Preview: Story = {};

export const RestoresWithoutAnimating: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Navigation ausklappen" })).toBeVisible();
    const sidebar = canvas.getByRole("navigation", { name: "Hauptnavigation" }).parentElement!;
    await expect(getComputedStyle(sidebar).width).toBe("64px");
    await expect(getComputedStyle(sidebar).transitionDuration).toBe("0s");
    await expect(getComputedStyle(canvas.getByRole("main")).paddingLeft).toBe("64px");
    await expect(getComputedStyle(canvas.getByRole("main")).transitionDuration).toBe("0s");
    await userEvent.click(canvas.getByRole("button", { name: "Finish loading" }));
    await expect(canvas.getByRole("button", { name: "Navigation ausklappen" })).toBeVisible();
    await expect(getComputedStyle(canvas.getByRole("navigation", { name: "Hauptnavigation" }).parentElement!).transitionDuration).toBe("0s");
  },
};

export const RemembersBothUserChoices: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const sidebar = canvas.getByRole("navigation", { name: "Hauptnavigation" }).parentElement!;
    let widthTransitions = 0;
    const countTransitions = (event: Event) => {
      if (event.target === sidebar && (event as TransitionEvent).propertyName === "width") widthTransitions++;
    };
    sidebar.addEventListener("transitionrun", countTransitions);
    try {
      await userEvent.click(canvas.getByRole("button", { name: "Navigation ausklappen" }));
      await waitFor(() => expect(getComputedStyle(sidebar).width).toBe("256px"));
      await expect(getComputedStyle(canvas.getByRole("link", { name: "Planung" }).querySelector("span")!).clipPath).toBe("none");
      await expect(widthTransitions).toBe(1);
      await expect(localStorage.getItem("founderops.desktop-sidebar-expanded")).toBe("true");
      await userEvent.click(canvas.getByRole("button", { name: "Finish loading" }));
      await expect(canvas.getByRole("button", { name: "Navigation einklappen" })).toBeVisible();
      const replacement = canvas.getByRole("navigation", { name: "Hauptnavigation" }).parentElement!;
      await expect(getComputedStyle(replacement).width).toBe("256px");
      await expect(getComputedStyle(replacement).transitionDuration).toBe("0s");
      await userEvent.click(canvas.getByRole("button", { name: "Navigation einklappen" }));
      await waitFor(() => expect(getComputedStyle(replacement).width).toBe("64px"));
      await expect(localStorage.getItem("founderops.desktop-sidebar-expanded")).toBe("false");
    } finally {
      sidebar.removeEventListener("transitionrun", countTransitions);
    }
  },
};

function UnhydratedSidebar({ storageUnavailable = false }: { storageUnavailable?: boolean }) {
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'), element => element.outerHTML).join("");
  const markup = renderToString(<SidebarJourney />);
  const storageSetup = storageUnavailable ? '<script>Object.defineProperty(window,"localStorage",{get(){throw new DOMException("Storage unavailable","SecurityError")}})</script>' : "";
  return <div role="region" aria-label="Desktop sidebar preview" tabIndex={0} className="max-w-full overflow-auto"><iframe title="Sidebar before hydration" style={{ width: 1440, height: 900 }} className="block border-0" srcDoc={`<!doctype html><html><head>${storageSetup}<script>${desktopSidebarBootstrapScript}</script>${styles}</head><body>${markup}</body></html>`} /></div>;
}

export const CollapsedBeforeHydration: Story = {
  render: () => <UnhydratedSidebar />,
  play: async ({ canvasElement }) => {
    const frame = within(canvasElement).getByTitle("Sidebar before hydration") as HTMLIFrameElement;
    await waitFor(() => expect(frame.contentDocument?.querySelector("nav")).not.toBeNull());
    const document = frame.contentDocument!;
    const sidebar = within(document.body).getByRole("navigation", { name: "Hauptnavigation" }).parentElement!;
    await waitFor(() => expect(frame.contentWindow!.getComputedStyle(sidebar).width).toBe("64px"));
    await expect(frame.contentWindow!.getComputedStyle(document.querySelector("main")!).paddingLeft).toBe("64px");
    await expect(frame.contentWindow!.getComputedStyle(sidebar).transitionDuration).toBe("0s");
  },
};

export const ExpandedBeforeHydration: Story = {
  ...CollapsedBeforeHydration,
  beforeEach: () => { localStorage.setItem("founderops.desktop-sidebar-expanded", "true"); },
  play: async ({ canvasElement }) => {
    const frame = within(canvasElement).getByTitle("Sidebar before hydration") as HTMLIFrameElement;
    await waitFor(() => expect(frame.contentDocument?.querySelector("nav")).not.toBeNull());
    const sidebar = frame.contentDocument!.querySelector("aside")!;
    await waitFor(() => expect(frame.contentWindow!.getComputedStyle(sidebar).width).toBe("256px"));
    await expect(frame.contentWindow!.getComputedStyle(frame.contentDocument!.querySelector("main")!).paddingLeft).toBe("256px");
  },
};

export const DefaultBeforeHydration: Story = {
  ...ExpandedBeforeHydration,
  beforeEach: () => { localStorage.removeItem("founderops.desktop-sidebar-expanded"); },
};

export const InvalidPreferenceBeforeHydration: Story = {
  ...ExpandedBeforeHydration,
  beforeEach: () => { localStorage.setItem("founderops.desktop-sidebar-expanded", "invalid"); },
};

export const StorageWriteUnavailable: Story = {
  beforeEach: () => {
    const descriptor = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem")!;
    Object.defineProperty(Storage.prototype, "setItem", { ...descriptor, value: () => { throw new DOMException("Storage unavailable", "SecurityError"); } });
    return () => { Object.defineProperty(Storage.prototype, "setItem", descriptor); };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Navigation ausklappen" }));
    await expect(canvas.getByRole("button", { name: "Navigation einklappen" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Finish loading" }));
    await expect(canvas.getByRole("button", { name: "Navigation einklappen" })).toBeVisible();
    await expect(getComputedStyle(canvas.getByRole("navigation", { name: "Hauptnavigation" }).parentElement!).width).toBe("256px");
  },
};

export const StorageReadUnavailable: Story = {
  ...ExpandedBeforeHydration,
  render: () => <UnhydratedSidebar storageUnavailable />,
};
