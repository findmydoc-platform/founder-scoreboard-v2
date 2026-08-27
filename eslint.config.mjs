import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "src/features/**/atoms/**/*.{ts,tsx}",
      "src/features/**/molecules/**/*.{ts,tsx}",
      "src/features/**/organisms/**/*.{ts,tsx}",
      "src/features/**/templates/**/*.{ts,tsx}",
      "src/shared/atoms/**/*.{ts,tsx}",
      "src/shared/molecules/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          allowTypeImports: true,
          group: [
            "@/features/*/model/*-api-client",
            "@/features/*/server",
            "@/features/*/server/**",
            "@/lib/browser-api-client",
            "@/lib/supabase",
            "@/lib/supabase-*",
            "@supabase/*",
            "../server",
            "../server/**",
            "../../server",
            "../../server/**",
            "../../../server",
            "../../../server/**",
          ],
          message: "UI components must receive data and commands through props or hooks instead of importing persistence, provider, or server modules.",
        }],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "storybook-static/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
