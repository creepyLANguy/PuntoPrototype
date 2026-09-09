import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const publicOrigin = process.env.PUBLIC_ORIGIN?.trim().replace(/\/$/, "");

if (!publicOrigin) {
  throw new Error("PUBLIC_ORIGIN is required (for example: https://www.padelpush.co.za)");
}

let parsedOrigin;
try {
  parsedOrigin = new URL(publicOrigin);
} catch {
  throw new Error(`PUBLIC_ORIGIN is not a valid URL: ${publicOrigin}`);
}

if (parsedOrigin.protocol !== "https:" || parsedOrigin.pathname !== "/" || parsedOrigin.search || parsedOrigin.hash) {
  throw new Error(`PUBLIC_ORIGIN must be an HTTPS origin without a path, query, or hash: ${publicOrigin}`);
}

const sourceOrigin = "https://www.padelpush.co.za";
const htmlFiles = [
  "index.html",
  "app/index.html",
];

for (const relativeFile of htmlFiles) {
  const filePath = path.resolve(relativeFile);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Expected HTML file does not exist: ${relativeFile}`);
  }

  const original = fs.readFileSync(filePath, "utf8");
  const updated = original.replaceAll(sourceOrigin, publicOrigin);

  if (updated === original && publicOrigin !== sourceOrigin) {
    console.warn(`No ${sourceOrigin} references found in ${relativeFile}`);
  }

  fs.writeFileSync(filePath, updated);
  console.log(`Configured ${relativeFile} for ${publicOrigin}`);
}
