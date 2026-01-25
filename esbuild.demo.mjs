import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["demo/demo.ts"],
  bundle: true,
  outfile: "demo/demo.js",
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  minify: process.argv.includes("--minify"),
});

console.log("Demo built successfully: demo/demo.js");
