import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const product = JSON.parse(await readFile(resolve(root, "product.json"), "utf8"));
if (product.schemaVersion !== 1 || !product.name || !product.identifier) {
  throw new Error("product.json is invalid");
}

const tauriPath = resolve(root, "apps/desktop/src-tauri/tauri.conf.json");
const tauri = JSON.parse(await readFile(tauriPath, "utf8"));
tauri.productName = product.name;
tauri.identifier = product.identifier;
for (const window of tauri.app.windows) window.title = product.name;
await writeFile(tauriPath, `${JSON.stringify(tauri, null, 2)}\n`);

const htmlPath = resolve(root, "apps/desktop/index.html");
const html = await readFile(htmlPath, "utf8");
await writeFile(htmlPath, html.replace(/<title>.*?<\/title>/, `<title>${escapeHtml(product.name)}</title>`));

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
