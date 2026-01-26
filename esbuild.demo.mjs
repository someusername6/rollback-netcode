import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["examples/local-transport/demo.ts"],
  bundle: true,
  outfile: "examples/local-transport/demo.js",
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  minify: process.argv.includes("--minify"),
});

console.log("Demo built successfully: examples/local-transport/demo.js");
