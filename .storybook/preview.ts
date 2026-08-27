import type { Preview } from "@storybook/nextjs-vite";
import "../src/app/globals.css";

const preview: Preview = {
  parameters: {
    a11y: {
      test: "error",
    },
    controls: {
      expanded: true,
    },
    layout: "centered",
    nextjs: {
      appDirectory: true,
    },
    options: {
      storySort: {
        order: ["Shared", ["Atoms", "Molecules", "Organisms"], "Features", "*"],
      },
    },
  },
  tags: ["autodocs"],
};

export default preview;
