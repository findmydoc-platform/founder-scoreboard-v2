import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  UiBadge,
  UiButton,
  UiEmptyState,
  UiField,
  UiNotice,
  UiPanel,
  UiTextArea,
  UiTextInput,
} from "./ui-primitives";

function UiPrimitivesCatalog() {
  return (
    <UiPanel className="grid w-[min(720px,90vw)] gap-5">
      <div className="flex flex-wrap gap-2">
        <UiButton variant="primary">Speichern</UiButton>
        <UiButton>Abbrechen</UiButton>
        <UiButton variant="red">Löschen</UiButton>
      </div>
      <div className="flex flex-wrap gap-2">
        <UiBadge tone="blue">In Arbeit</UiBadge>
        <UiBadge tone="emerald">Erledigt</UiBadge>
        <UiBadge tone="amber">Prüfung</UiBadge>
      </div>
      <div className="grid gap-2">
        <UiNotice tone="info">Planungsdaten wurden aktualisiert.</UiNotice>
        <UiNotice tone="warning">Für diese Änderung fehlt noch eine Freigabe.</UiNotice>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <UiField>
          Titel
          <UiTextInput defaultValue="Clinic onboarding" />
        </UiField>
        <UiField>
          Beschreibung
          <UiTextArea defaultValue="Aktueller fachlicher Kontext." />
        </UiField>
      </div>
      <UiEmptyState>Keine Einträge für den aktuellen Filter.</UiEmptyState>
    </UiPanel>
  );
}

const meta = {
  component: UiPrimitivesCatalog,
  tags: ["layer:atom", "status:stable"],
  title: "Shared/Atoms/UiPrimitives",
} satisfies Meta<typeof UiPrimitivesCatalog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Catalog: Story = {};
