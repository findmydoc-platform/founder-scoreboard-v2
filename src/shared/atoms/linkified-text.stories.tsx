import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { LinkifiedText } from "./linkified-text";

const meta = {
  component: LinkifiedText,
  args: {
    value: "Prüfgrundlage: https://example.com/review, weitere Quelle: https://notion.so/page. HTTP-Quelle: http://example.org/legacy. Klammer: (https://example.com/docs). Ungültig: javascript:alert(1), https:// <img src=x onerror=alert(1)>",
  },
  tags: ["layer:atom", "status:stable"],
  title: "Shared/Atoms/LinkifiedText",
} satisfies Meta<typeof LinkifiedText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PlainTextUrls: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstLink = canvas.getByRole("link", { name: "https://example.com/review (öffnet in neuem Tab)" });
    const secondLink = canvas.getByRole("link", { name: "https://notion.so/page (öffnet in neuem Tab)" });
    const httpLink = canvas.getByRole("link", { name: "http://example.org/legacy (öffnet in neuem Tab)" });
    const parenthesizedLink = canvas.getByRole("link", { name: "https://example.com/docs (öffnet in neuem Tab)" });

    await expect(firstLink).toHaveAttribute("href", "https://example.com/review");
    await expect(firstLink).toHaveAttribute("target", "_blank");
    await expect(firstLink).toHaveAttribute("rel", "noopener noreferrer");
    await expect(secondLink).toHaveAttribute("href", "https://notion.so/page");
    await expect(httpLink).toHaveAttribute("href", "http://example.org/legacy");
    await expect(parenthesizedLink).toHaveAttribute("href", "https://example.com/docs");
    await expect(canvas.getAllByRole("link")).toHaveLength(4);
    await expect(canvas.queryByRole("img")).not.toBeInTheDocument();
    await expect(canvasElement.textContent).toBe(meta.args.value);
  },
};
