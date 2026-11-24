import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";
import { CustomSelect } from "./custom-select";

const options = [
  { value: "open", label: "Offen" },
  { value: "working", label: "In Arbeit" },
  { value: "done", label: "Erledigt" },
];

function SelectStory() {
  const [value, setValue] = useState("open");
  return (
    <div className="h-48 w-64">
      <CustomSelect aria-label="Status" value={value} options={options} onChange={setValue} />
    </div>
  );
}

const meta = {
  component: SelectStory,
  tags: ["layer:atom", "status:stable"],
  title: "Shared/Atoms/CustomSelect",
} satisfies Meta<typeof SelectStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SelectsAnOption: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("combobox", { name: "Status" }));
    await userEvent.click(page.getByRole("option", { name: "In Arbeit" }));
    await expect(canvas.getByRole("combobox", { name: "Status" })).toHaveTextContent("In Arbeit");
  },
};

function ModalKeyboardSelectStory() {
  const [shown,setShown] = useState(false), [value,setValue] = useState("open");
  const dialogRef = useModalDialog<HTMLDivElement>({open:shown,onClose:()=>setShown(false)});
  return <>
    <button type="button" onClick={()=>setShown(true)}>Filter öffnen</button>
    {shown && <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Status filtern" tabIndex={-1} className="fixed inset-0 z-[100] bg-white p-4">
      <CustomSelect aria-label="Status im Filter" data-autofocus value={value} options={options} onChange={setValue}/>
      <button type="button" onClick={()=>setShown(false)}>Filter schließen</button>
    </div>}
  </>;
}
export const KeyboardFocusWaitsForMountedOptionsInsideModal:Story = {
  render:()=> <ModalKeyboardSelectStory/>,
  play:async({canvasElement})=>{
    const canvas=within(canvasElement),page=within(canvasElement.ownerDocument.body);
    const opening=canvas.getByRole("button",{name:"Filter öffnen"});await userEvent.click(opening);
    const dialog=canvas.getByRole("dialog",{name:"Status filtern"}),trigger=within(dialog).getByRole("combobox",{name:"Status im Filter"});
    await waitFor(()=>expect(trigger).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    const selected=await page.findByRole("option",{name:"Offen"});
    await waitFor(()=>expect(selected).toHaveFocus());
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await waitFor(()=>expect(trigger).toHaveFocus());await expect(trigger).toHaveTextContent("In Arbeit");
    await userEvent.keyboard("{Enter}");
    await waitFor(()=>expect(page.getByRole("option",{name:"In Arbeit"})).toHaveFocus());
    await userEvent.keyboard("{Escape}");await waitFor(()=>expect(trigger).toHaveFocus());
    await expect(page.queryByRole("listbox")).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button",{name:"Filter schließen"}));
    await waitFor(()=>expect(opening).toHaveFocus());
  },
};
