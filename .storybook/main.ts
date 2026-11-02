import type { StorybookConfig } from "@storybook/nextjs-vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  addons: ["@storybook/addon-a11y", "@storybook/addon-docs", "@storybook/addon-vitest"],
  framework: "@storybook/nextjs-vite",
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  viteFinal: async (viteConfig) => {
    viteConfig.resolve ??= {};
    viteConfig.resolve.alias = {
      ...(viteConfig.resolve.alias as Record<string, string>),
      "@": path.resolve(dirname, "../src"),
      "next/link": fileURLToPath(import.meta.resolve("@storybook/nextjs-vite/link.mock")),
    };
    viteConfig.plugins ??= [];
    viteConfig.plugins.push({
      name: "storybook-public-auth-fixture",
      enforce: "post",
      config(configuration) {
        const authUrl = configuration.define?.["process.env.NEXT_PUBLIC_SUPABASE_URL"];
        if (authUrl !== undefined && authUrl !== JSON.stringify("")) return;
        return {
          define: {
            "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify("https://supabase.example.test"),
          },
        };
      },
    });
    viteConfig.optimizeDeps ??= {};
    viteConfig.optimizeDeps.include = [
      ...(viteConfig.optimizeDeps.include || []),
      "@storybook/react-dom-shim",
      "@supabase/ssr",
      "@supabase/supabase-js",
      "react-markdown",
      "remark-breaks",
      "remark-gfm",
    ];
    return viteConfig;
  },
};

export default config;
