#!/usr/bin/env node
/**
 * Ersatz für die Anthropic Messages API zum Testen der KI-Funktionen ohne echten Schlüssel (Node, ohne Abhängigkeiten).
 *
 *   node scripts/ki-mock.mjs [port=8964]
 *   im Browser: localStorage["lt-ki-base"] = "http://localhost:8964"
 *
 * Emuliert `POST /v1/messages` mit CORS, Header-Prüfung und Antworten je Werkzeug (fiktive Inhalte, Raum Bern).
 * Schlüssel steuern den Fall:
 *   sk-test-…           gültig (z. B. sk-test-ok)
 *   sk-test-401         Schlüssel ungültig            sk-test-credit   kein Guthaben (400)
 *   sk-test-429         zu viele Anfragen             sk-test-529      immer überlastet
 *   sk-test-529once     einmal überlastet, dann ok    sk-test-500      Störung
 *   sk-test-slow        antwortet nach 75 s (Zeitlimit)  sk-test-junk  Antwort ohne Werkzeug
 *   alles andere        401 (wie bei der echten API)
 * Der Schlüssel wird nie ausgegeben (nur die Art des Falls).
 */
import { createServer } from "node:http";

const PORT = +(process.argv[2] ?? process.env.PORT ?? 8964);
const once = new Set();

const send = (res, status, body, origin) => {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": origin || "*",
    "access-control-expose-headers": "request-id",
    "vary": "origin",
    "request-id": "req_mock_" + Math.random().toString(36).slice(2, 10),
  });
  res.end(JSON.stringify(body));
};
const apiError = (type, message) => ({ type: "error", error: { type, message } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const units = (s) => Math.max(1, Math.round(String(s).length / 3.5));

/** Text aller Nachrichten (ohne Bilddaten) */
function userText(body) {
  return (body.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content) }]))
    .filter((c) => c.type === "text").map((c) => c.text).join("\n");
}
const hasImage = (body) => (body.messages ?? []).some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === "image"));
function listAfter(text, label) {
  const m = new RegExp(`${label}[^:]*:\\s*([^\\n]+)`).exec(text);
  return m ? m[1].split(/,\s*/).map((s) => s.trim()).filter(Boolean) : [];
}

// ---------- Antworten (fiktiv, Raum Bern) ----------
function handschrift(text) {
  const melder = listAfter(text, "Gültige Melder");
  const m = (i) => melder[i % Math.max(1, melder.length)] ?? `H0${i + 1}`;
  const nai = listAfter(text, "- NAI")[0] ?? "NAI 1";
  return {
    zeilen: [
      { zeit: "0712", melder: m(0), text: "3 Pers zu Fuss AK9 Rtg N" },
      { zeit: "0718", melder: m(1), text: `1 ziv Fz (weisser Lieferwagen) ${nai} Rtg Bahnhof`, unsicher: ["Farbe des Fz"] },
      { zeit: "07?5", melder: m(2), text: "2 Pers mit Funkgerät AM11 C", unsicher: ["Zeit", "Unterquadrant"] },
      { text: "", unsicher: [] },
      { zeit: "0731", melder: "X99", text: "Drohne über AL10" },
    ],
    hinweis: "Unterer Rand unscharf – letzte Zeile schlecht lesbar.",
  };
}

function meldung(text) {
  const raw = /«([^»]*)»/.exec(text)?.[1] ?? "";
  const melder = /\bH\s?\d{2}\b/i.exec(raw)?.[0].replace(/\s/, "").toUpperCase() ?? "";
  const zeit = /\b([01]\d|2[0-3])[:.]?([0-5]\d)\b/.exec(raw);
  const n = /(\d+)\s*(Pers|Personen|Leute|Mann|Fz|Fahrzeuge?|Autos?|Drohnen?)/i.exec(raw);
  const what = n ? `${n[1]} ${/^(pers|leute|mann)/i.test(n[2]) ? "Pers" : /^droh/i.test(n[2]) ? "Drohne" : "Fz"}` : "1 Pers";
  const armed = /bewaffnet|waffe|gewehr/i.test(raw) ? " bewaffnet" : "";
  const rtg = /richtung\s+([A-ZÄÖÜ][\wäöü-]*)/i.exec(raw)?.[1];
  const pq = /\b[A-Z]{2}\d{1,2}(?:\s[A-D])?\b/.exec(raw)?.[0] ?? /PQ ([A-Z]{2}\d{1,2}(?: [A-D])?)/.exec(text)?.[1];
  const unsicher = [];
  if (!zeit) unsicher.push("Zeit nicht genannt");
  if (!pq) unsicher.push("Ort nur als Ortsname");
  if (/eventuell|vielleicht|möglicherweise/i.test(raw)) unsicher.push("bewaffnet nicht sicher");
  const kurz = [zeit ? `${zeit[1]}${zeit[2]}` : "", melder ? `${melder}:` : "", what + armed, pq ?? "", rtg ? `Rtg ${rtg}` : ""].filter(Boolean).join(" ");
  return {
    kurz,
    begruendung: `Melder ${melder || "nicht genannt"}; ${what}${armed ? " (bewaffnet gemeldet)" : ""}${pq ? ` in ${pq}` : ""}${rtg ? `, Bewegung Richtung ${rtg}` : ""}.`,
    unsicher,
  };
}

function freitext(body, text) {
  const sys = String(body.system ?? "");
  if (/Lagebericht/i.test(sys) && /Lage eigene/.test(sys)) {
    return [
      "Lage Rot:",
      "- 2 Det Rot im Raum Wabern–Kehrsatz, zuletzt 3 Pers in AK9 (unbestätigt).",
      "- Pendelverkehr 1 ziv Fz zwischen NAI 1 und NAI 2, nächste Durchfahrt ca. 07:40.",
      "Lage eigene:",
      "- H01–H04 in Stellung, letzte Meldung H03 06:55 (AM11).",
      "- H05 seit 50 Min ohne Meldung.",
      "Absicht Rot (Einschätzung):",
      "- Möglicher Zusammenzug in AK9 – Aktion gegen Stao H02 nicht ausgeschlossen.",
      "Offene Punkte / Rückfragen:",
      "- Verbindung H05 prüfen.",
      "- Sichtung AK9 durch zweite Quelle bestätigen lassen.",
    ].join("\n");
  }
  return [
    "Einschätzung: Die Meldungen deuten auf eine mögliche Übergabe hin – zwei Fz hielten kurz nacheinander im gleichen PQ. Das ist ein Hinweis, keine Tatsache; eine zweite Quelle fehlt.",
    "Was prüfen:",
    "- Zweite Beobachtung aus dem Nachbar-PQ einholen",
    "- Kennzeichen oder Merkmale der Fz vergleichen",
    "- Ausweichrouten nach Süden beobachten",
  ].join("\n");
}

// ---------- Server ----------
createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": origin || "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access, anthropic-beta",
      "access-control-max-age": "600",
      "vary": "origin",
    });
    return res.end();
  }
  if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) return send(res, 404, apiError("not_found_error", "Not found"), origin);
  let raw = "";
  for await (const c of req) raw += c;
  let body;
  try { body = JSON.parse(raw); } catch { return send(res, 400, apiError("invalid_request_error", "invalid JSON"), origin); }

  const key = String(req.headers["x-api-key"] ?? "");
  const fall = key.startsWith("sk-test-") ? key.slice(8) : "ungueltig";
  const tool = body.tool_choice?.name ?? body.tools?.[0]?.name ?? "text";
  console.log(`${new Date().toISOString().slice(11, 19)} ${body.model ?? "?"} ${tool}${hasImage(body) ? " +Bild" : ""} · Fall ${fall} · ${raw.length} Zeichen`);

  if (req.headers["anthropic-version"] !== "2023-06-01") return send(res, 400, apiError("invalid_request_error", "anthropic-version header is required"), origin);
  if (origin && req.headers["anthropic-dangerous-direct-browser-access"] !== "true") return send(res, 401, apiError("authentication_error", "CORS requests must set 'anthropic-dangerous-direct-browser-access' header"), origin);
  if (!key || fall === "ungueltig" || fall === "401") return send(res, 401, apiError("authentication_error", "invalid x-api-key"), origin);
  if (!body.model || !Number.isInteger(body.max_tokens) || !Array.isArray(body.messages) || !body.messages.length) return send(res, 400, apiError("invalid_request_error", "model, max_tokens and messages are required"), origin);
  if (body.tools && body.tool_choice?.type === "tool" && !body.tools.some((t) => t.name === body.tool_choice.name)) return send(res, 400, apiError("invalid_request_error", "tool_choice names unknown tool"), origin);

  await sleep(hasImage(body) ? 1800 : 700 + Math.random() * 500);
  if (fall === "credit") return send(res, 400, apiError("invalid_request_error", "Your credit balance is too low to access the Anthropic API."), origin);
  if (fall === "429") return send(res, 429, apiError("rate_limit_error", "Number of requests has exceeded your rate limit"), origin);
  if (fall === "529") return send(res, 529, apiError("overloaded_error", "Overloaded"), origin);
  if (fall === "529once" && !once.has(key + tool)) { once.add(key + tool); return send(res, 529, apiError("overloaded_error", "Overloaded"), origin); }
  if (fall === "500") return send(res, 500, apiError("api_error", "Internal server error"), origin);
  if (fall === "slow") await sleep(75000);
  if (res.destroyed) return;

  const text = userText(body);
  const inTok = units(String(body.system ?? "") + text) + (hasImage(body) ? 1600 : 0);
  const base = { id: "msg_mock_" + Math.random().toString(36).slice(2, 12), type: "message", role: "assistant", model: body.model, stop_sequence: null };
  if (fall === "junk") return send(res, 200, { ...base, content: [{ type: "text", text: "Ich kann das nicht lesen." }], stop_reason: "end_turn", usage: { input_tokens: inTok, output_tokens: 8 } }, origin);
  if (body.max_tokens <= 10) return send(res, 200, { ...base, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: inTok, output_tokens: 1 } }, origin);
  if (body.tools?.length) {
    const input = tool === "meldungen_erkannt" ? handschrift(text) : tool === "meldung" ? meldung(text) : {};
    return send(res, 200, { ...base, content: [{ type: "tool_use", id: "toolu_mock_1", name: tool, input }], stop_reason: "tool_use", usage: { input_tokens: inTok, output_tokens: units(JSON.stringify(input)) } }, origin);
  }
  const out = freitext(body, text);
  return send(res, 200, { ...base, content: [{ type: "text", text: out }], stop_reason: "end_turn", usage: { input_tokens: inTok, output_tokens: units(out) } }, origin);
}).listen(PORT, () => console.log(`KI-Ersatz (Anthropic Messages API) auf http://localhost:${PORT} – localStorage["lt-ki-base"] = "http://localhost:${PORT}"`));
