import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import { glob } from "glob";

const inputFiles = await glob("src/**/*.ts", {
  ignore: ["src/**/*.d.ts"],
});

export default {
  input: inputFiles,
  output: {
    dir: "dist",
    format: "esm",
    preserveModules: true,
    preserveModulesRoot: "src",
    entryFileNames: "[name].mjs",
  },
  external: (id) => {
    if (id.startsWith("node:")) return true;
    if (!id.startsWith(".") && !id.startsWith("/")) return true;
    return false;
  },
  plugins: [
    nodeResolve({
      preferBuiltins: true,
    }),
    typescript({
      tsconfig: "./tsconfig.json",
      compilerOptions: {
        declaration: false,
        declarationMap: false,
      },
    }),
  ],
};
