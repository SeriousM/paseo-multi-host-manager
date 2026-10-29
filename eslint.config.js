import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["testenv/**", "docs/**", "dist/**", "coverage/**", ".local/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "separate-type-imports", disallowTypeAnnotations: true }],
      "no-restricted-syntax": [
        "error",
        { selector: "ImportExpression", message: "Use a static import. If a dynamic import is unavoidable, add an eslint-disable comment that names the reason." },
      ],
    },
  },
);
