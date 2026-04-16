import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

function randomLicenseKey() {
  const hex = randomBytes(16).toString("hex").toUpperCase();
  return hex.match(/.{1,4}/g)?.join("-") ?? hex;
}

const countArg = Number(process.argv[2] ?? "50");
const outputArg = process.argv[3] ?? "src-tauri/license_keys.txt";

if (!Number.isInteger(countArg) || countArg <= 0) {
  console.error("Uzycie: npm run license:pool -- <liczba_kluczy> [plik_wyjsciowy]");
  process.exit(1);
}

const outputPath = resolve(outputArg);
const keys = new Set();
while (keys.size < countArg) {
  keys.add(randomLicenseKey());
}

const lines = [
  "# Wpisz tutaj dozwolone klucze licencji (jeden klucz w jednej linii).",
  "# Linie zaczynajace sie od # sa ignorowane.",
  ...Array.from(keys),
];

writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Wygenerowano ${countArg} kluczy: ${outputPath}`);
