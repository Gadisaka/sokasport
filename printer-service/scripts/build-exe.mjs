import { execSync } from "child_process";
import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const distDir = path.join(root, "dist");

function stopRunningBridge() {
  try {
    execSync("taskkill /F /IM PrinterBridge.exe", { stdio: "ignore" });
    console.log("Stopped running PrinterBridge.exe");
  } catch {
    // Not running — fine
  }
}

function copyNativeDeps() {
  const destRoot = path.join(distDir, "node_modules");
  fs.mkdirSync(destRoot, { recursive: true });

  const copyPackage = (name) => {
    const src = path.join(root, "node_modules", name);
    const dest = path.join(destRoot, name);
    if (fs.existsSync(src)) {
      fs.cpSync(src, dest, { recursive: true });
    }
  };

  copyPackage("printer");
  copyPackage("nan");
  copyPackage("node-gyp-build");
  copyPackage("bindings");
  copyPackage("file-uri-to-path");
}

fs.mkdirSync(distDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "index.js")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: path.join(distDir, "server.cjs"),
  external: ["printer"],
  banner: {
    js: "/* Sokasport PrinterBridge bundled server */",
  },
});

console.log("Bundled dist/server.cjs");

stopRunningBridge();

const exePath = path.join(distDir, "PrinterBridge.exe");
const exeTmp = path.join(distDir, "PrinterBridge.tmp.exe");

execSync(
  `npx pkg dist/server.cjs --targets node18-win-x64 --output dist/PrinterBridge.tmp.exe`,
  { cwd: root, stdio: "inherit" },
);

if (fs.existsSync(exePath)) fs.unlinkSync(exePath);
fs.renameSync(exeTmp, exePath);

copyNativeDeps();

const configTemplate = path.join(root, "config.json");
fs.copyFileSync(configTemplate, path.join(distDir, "config.json"));

const installDir = path.join(root, "install");
const installDest = path.join(distDir, "install");
if (fs.existsSync(installDir)) {
  fs.cpSync(installDir, installDest, { recursive: true });
  const rootLauncher = path.join(installDir, "Install-PrinterBridge.bat");
  if (fs.existsSync(rootLauncher)) {
    fs.copyFileSync(rootLauncher, path.join(distDir, "Install-PrinterBridge.bat"));
  }
}

console.log("Built dist/PrinterBridge.exe (+ node_modules/printer + installer)");
