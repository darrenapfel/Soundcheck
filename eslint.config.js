import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/", "runs/", "out/", "dist/", "fixtures/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Boundary casts on untyped JSON (Deepgram responses, dynamic imports) are
      // narrowly justified and commented; warn, don't block.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
