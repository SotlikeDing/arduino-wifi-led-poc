// Turns a PEM root certificate into firmware/uno_r4_led_mqtt/broker_ca.h
// Usage: node make-ca-header.mjs path/to/emqxsl-ca.crt
import { readFileSync, writeFileSync } from "node:fs";

const pem = readFileSync(process.argv[2], "utf8").replace(/\r/g, "").trim().split("\n");
const BS = String.fromCharCode(92); // backslash
const lines = pem.map((l) => `  "${l}${BS}n"`).join("\n");
const out = `// Root CA of the EMQX Cloud Serverless broker: "DigiCert Global Root G2" (valid until 2038).
// Source: https://assets.emqx.com/data/emqxsl-ca.crt - the board trusts ONLY this root for the broker.
#pragma once
static const char EMQX_ROOT_CA[] =
${lines};
`;
writeFileSync(new URL("../firmware/uno_r4_led_mqtt/broker_ca.h", import.meta.url), out);
console.log(out);
