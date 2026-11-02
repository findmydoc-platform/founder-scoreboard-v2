import { expect, userEvent, waitFor, within } from "storybook/test";

/** The observable global contract shared by real full-page hosts. */
export async function expectApplicationHeader(canvasElement: HTMLElement, areaTitle: string) {
  const canvas = within(canvasElement);
  const application = within(canvas.getByLabelText("Anwendung"));
  await expect(application.getByText(areaTitle, { exact: true })).toBeVisible();
  await expect(application.getByRole("button", { name: "Benachrichtigungen" })).toBeVisible();
  await expect(application.getByRole("button", { name: "Account-Menü öffnen" })).toBeVisible();
  if (window.innerWidth < 1024) await expect(application.getByRole("button", { name: "Navigation öffnen" })).toBeVisible();
  if (window.innerWidth < 640) {
    const more = application.getByRole("button", { name: "Mehr" });
    await userEvent.click(more);
    const menu = application.getByRole("menu", { name: "Weitere globale Aktionen" });
    await expect(within(menu).getAllByRole("menuitem").map(item => item.textContent?.trim())).toEqual(["Kuratierte Links", "Kalender", "Hilfe", "GitHub"]);
    await waitFor(() => expect(within(menu).getByRole("menuitem", { name: "Kuratierte Links" })).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await expect(more).toHaveFocus();
  } else {
    const actions = ["Kuratierte Links", "Kalender öffnen", "Benachrichtigungen", "Hilfe öffnen", /GitHub öffnen/, "Account-Menü öffnen"].map(name => application.getByRole("button", { name }));
    for (let index = 0; index < actions.length; index++) {
      await expect(actions[index]).toBeVisible();
      if (index > 0) await expect(actions[index - 1].compareDocumentPosition(actions[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  }
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
}
