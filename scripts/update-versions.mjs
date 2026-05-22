import { readFileSync, writeFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const versions = JSON.parse(readFileSync("versions.json", "utf8"));

manifest.version = pkg.version;
versions[manifest.version] = manifest.minAppVersion;

writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");

console.log(`Updated versions.json: ${manifest.version} -> ${manifest.minAppVersion}`);
