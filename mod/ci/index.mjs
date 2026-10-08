// Crea companion.json, l'indice che il launcher legge per scaricare la mod giusta:
// { modVersion, sourceHash, updated, versions: { "<mc>": { file, sha1, size } }, failed: [...] }
//
// Unisce i jar appena compilati (dist/nexus-companion-<mc>.jar) con l'indice già pubblicato:
// le versioni non ricompilate (o fallite) tengono il jar precedente, che funziona ancora.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const { SOURCE_HASH = "", REPO = "TiclyMusic/nexus-client", MOD_VERSION = "" } = process.env;
const dist = "dist";

let previous = { versions: {} };
try {
	const res = await fetch(`https://github.com/${REPO}/releases/download/companion/companion.json`);
	if (res.ok) previous = await res.json();
} catch {}

const versions = { ...(previous.versions ?? {}) };
for (const file of existsSync(dist) ? readdirSync(dist) : []) {
	const m = file.match(/^nexus-companion-(.+)\.jar$/);
	if (!m) continue;
	const data = readFileSync(`${dist}/${file}`);
	versions[m[1]] = { file, sha1: createHash("sha1").update(data).digest("hex"), size: data.length };
}

const failed = existsSync("failed") ? readdirSync("failed").map((f) => f.replace(/\.log$/, "")) : [];
const index = { modVersion: MOD_VERSION, sourceHash: SOURCE_HASH, updated: new Date().toISOString(), versions, failed };
writeFileSync(`${dist}/companion.json`, JSON.stringify(index, null, 2));
console.log(`${Object.keys(versions).length} versioni nell'indice, ${failed.length} fallite: ${failed.join(", ") || "nessuna"}`);
