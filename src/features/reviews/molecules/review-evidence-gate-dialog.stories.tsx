import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ReviewEvidenceGateDialog } from "./review-evidence-gate-dialog";

const onConfirm = fn(async () => true);

const meta = {
  component: ReviewEvidenceGateDialog,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => (
    <div className="min-h-screen bg-slate-100 p-8">
      <div className="mx-auto max-w-5xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Deliverable · Plattformbetrieb</div>
        <h1 className="mt-2 text-3xl font-semibold text-slate-950">Release-Notizen für Sprint 10 finalisieren</h1>
        <div className="mt-6 flex gap-3 border-y border-slate-200 py-4 text-sm text-slate-600">
          <span>Genehmigt</span>
          <span>·</span>
          <span>Sebastian</span>
          <span>·</span>
          <span>Sprint 10 · 21.09.–04.10.2026</span>
        </div>
      </div>
      <Story />
    </div>
  )],
  tags: ["domain:reviews", "layer:molecule", "status:stable"],
  title: "Features/Reviews/Molecules/ReviewEvidenceGateDialog",
  args: {
    pending: false,
    onClose: fn(),
    onConfirm,
  },
} satisfies Meta<typeof ReviewEvidenceGateDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ExceptionNote: Story = {
  play: async ({ canvasElement }) => {
    onConfirm.mockClear();
    const canvas = within(canvasElement);
    const submit = canvas.getByRole("button", { name: "In Review verschieben" });
    await expect(submit).toBeDisabled();
    await userEvent.type(
      canvas.getByRole("textbox", { name: /Begründung/ }),
      "Ergebnis wurde im Founder-Meeting vom 17.09.2026 abgenommen.",
    );
    await expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await expect(onConfirm).toHaveBeenCalledWith({
      evidenceExceptionNote: "Ergebnis wurde im Founder-Meeting vom 17.09.2026 abgenommen.",
    });
  },
};

export const EvidenceLink: Story = {
  play: async ({ canvasElement }) => {
    onConfirm.mockClear();
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("radio", { name: /Evidence-Link hinzufügen/ }));
    await userEvent.type(canvas.getByRole("textbox", { name: "Evidence-Link" }), "https://example.com/release-notes");
    await userEvent.click(canvas.getByRole("button", { name: "In Review verschieben" }));
    await expect(onConfirm).toHaveBeenCalledWith({ evidenceLink: "https://example.com/release-notes" });
  },
};
