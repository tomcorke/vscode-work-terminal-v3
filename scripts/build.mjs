import * as esbuild from "esbuild";

const watchMode = process.argv.includes("--watch");

const baseConfig = {
  bundle: true,
  logLevel: "info",
  sourcemap: true,
  target: "es2022",
};

const extensionConfig = {
  ...baseConfig,
  entryPoints: ["src/extension.ts"],
  external: ["vscode"],
  format: "cjs",
  outfile: "dist/extension.js",
  platform: "node",
};

const webviewConfig = {
  ...baseConfig,
  entryPoints: ["src/webview/main.ts"],
  format: "iife",
  outdir: "dist/webview",
  platform: "browser",
  loader: {
    ".css": "css",
  },
};

async function runBuild(config) {
  if (watchMode) {
    const context = await esbuild.context(config);
    await context.watch();
    return context;
  }

  await esbuild.build(config);
  return null;
}

async function main() {
  const contexts = await Promise.all([
    runBuild(extensionConfig),
    runBuild(webviewConfig),
  ]);

  if (watchMode) {
    console.log("Watching extension and webview bundles...");
    process.stdin.resume();
    process.on("SIGINT", async () => {
      await Promise.all(contexts.filter(Boolean).map((context) => context.dispose()));
      process.exit(0);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

