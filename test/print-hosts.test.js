// PrusaLink and OctoPrint uploads against a local fake server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import {
  uploadToPrusaLink,
  uploadToOctoPrint,
  prusaLinkTargetFromEnv,
  octoPrintTargetFromEnv,
  parseDigestChallenge,
} from "../build/print-hosts.js";

const md5 = (s) => createHash("md5").update(s).digest("hex");

/** A PrusaLink-like server with digest auth (qop=auth) or an API key. */
async function fakePrinter({ password, apiKey, storageList = true, existing = [] }) {
  const requests = [];
  const realm = "Printer API";
  let nonce = "n0nce1";

  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });

      const authorized = (() => {
        if (apiKey) return req.headers["x-api-key"] === apiKey;
        const auth = req.headers.authorization ?? "";
        if (!auth.startsWith("Digest ")) return false;
        const p = Object.fromEntries([...auth.matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)].map((m) => [m[1], m[2] ?? m[3]]));
        if (p.nonce !== nonce || p.uri !== req.url) return false;
        const ha1 = md5(`${p.username}:${realm}:${password}`);
        const ha2 = md5(`${req.method}:${p.uri}`);
        return p.response === md5(`${ha1}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`);
      })();

      if (!authorized) {
        res.writeHead(401, apiKey ? {} : { "WWW-Authenticate": `Digest realm="${realm}", nonce="${nonce}", qop="auth"` });
        return res.end();
      }
      if (req.url === "/api/v1/storage") {
        if (!storageList) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ storage_list: [{ name: "USB", path: "/usb", available: true, read_only: false }] }));
      }
      if (req.method === "PUT" && req.url.startsWith("/api/v1/files/")) {
        const name = decodeURIComponent(req.url.split("/").pop());
        if (existing.includes(name) && req.headers["overwrite-file"] !== "?1") { res.writeHead(409); return res.end(); }
        res.writeHead(201);
        return res.end();
      }
      res.writeHead(404);
      res.end();
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { baseUrl, requests, close: () => new Promise((r) => server.close(r)), rotateNonce: () => { nonce = "n0nce2"; } };
}

const upload = (overrides = {}) => ({
  fileName: "egel hoekstuk #2.bgcode",
  data: Buffer.from("GCDE....payload"),
  startPrint: true,
  overwrite: false,
  ...overrides,
});

test("PrusaLink with digest auth: storage detected, name encoded, headers set, body sent once", async (t) => {
  const printer = await fakePrinter({ password: "s3cret" });
  t.after(printer.close);

  const result = await uploadToPrusaLink({ baseUrl: printer.baseUrl, user: "maker", password: "s3cret" }, upload());
  assert.deepEqual([result.ok, result.status, result.storage], [true, 201, "usb"]);

  const puts = printer.requests.filter((r) => r.method === "PUT");
  assert.equal(puts.length, 1);
  assert.equal(puts[0].url, "/api/v1/files/usb/egel%20hoekstuk%20%232.bgcode");
  assert.equal(puts[0].headers["print-after-upload"], "?1");
  assert.equal(puts[0].headers["overwrite-file"], "?0");
  assert.equal(puts[0].body.toString(), "GCDE....payload");
});

test("PrusaLink: a stale nonce is answered once more", async (t) => {
  const printer = await fakePrinter({ password: "pw", storageList: false });
  t.after(printer.close);
  // The client fetches the challenge first; rotating now makes its PUT use an expired nonce.
  const original = globalThis.fetch;
  let rotated = false;
  globalThis.fetch = async (url, init) => {
    if (!rotated && init?.method === "PUT") { rotated = true; printer.rotateNonce(); }
    return original(url, init);
  };
  t.after(() => { globalThis.fetch = original; });

  const result = await uploadToPrusaLink({ baseUrl: printer.baseUrl, password: "pw", storage: "usb" }, upload());
  assert.equal(result.ok, true);
  assert.equal(printer.requests.filter((r) => r.method === "PUT").length, 2);
});

test("PrusaLink with API key, wrong password, and existing files", async (t) => {
  const keyed = await fakePrinter({ apiKey: "k3y", existing: ["a.gcode"] });
  t.after(keyed.close);
  const ok = await uploadToPrusaLink({ baseUrl: keyed.baseUrl, apiKey: "k3y", storage: "usb" }, upload({ fileName: "b.gcode" }));
  assert.equal(ok.ok, true);
  assert.ok(keyed.requests.every((r) => r.headers["x-api-key"] === "k3y" && !r.headers.authorization));

  const exists = await uploadToPrusaLink({ baseUrl: keyed.baseUrl, apiKey: "k3y", storage: "usb" }, upload({ fileName: "a.gcode" }));
  assert.deepEqual([exists.ok, exists.status], [false, 409]);
  assert.match(exists.message, /overwrite/);
  const replaced = await uploadToPrusaLink({ baseUrl: keyed.baseUrl, apiKey: "k3y", storage: "usb" }, upload({ fileName: "a.gcode", overwrite: true }));
  assert.equal(replaced.ok, true);

  const digest = await fakePrinter({ password: "right" });
  t.after(digest.close);
  const denied = await uploadToPrusaLink({ baseUrl: digest.baseUrl, password: "wrong", storage: "usb" }, upload());
  assert.deepEqual([denied.ok, denied.status], [false, 401]);
  assert.match(denied.message, /PRUSALINK_PASSWORD/);
});

test("OctoPrint: multipart with select and print", async (t) => {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      requests.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
      res.writeHead(req.headers["x-api-key"] === "oct" ? 201 : 403);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((r) => server.close(r)));

  const result = await uploadToOctoPrint({ baseUrl: `http://127.0.0.1:${server.address().port}`, apiKey: "oct" }, upload());
  assert.equal(result.ok, true);
  assert.equal(requests[0].url, "/api/files/local");
  assert.match(requests[0].headers["content-type"], /^multipart\/form-data; boundary=/);
  assert.match(requests[0].body, /name="file"; filename="egel hoekstuk #2.bgcode"/);
  assert.match(requests[0].body, /name="print"\r\n\r\ntrue/);
});

test("credentials come from the environment", () => {
  assert.match(prusaLinkTargetFromEnv({}), /PRUSALINK_URL/);
  assert.match(prusaLinkTargetFromEnv({ PRUSALINK_URL: "http://p" }), /PRUSALINK_PASSWORD/);
  assert.deepEqual(prusaLinkTargetFromEnv({ PRUSALINK_URL: "http://p/", PRUSALINK_PASSWORD: "x" }), { baseUrl: "http://p", user: "maker", password: "x" });
  assert.deepEqual(prusaLinkTargetFromEnv({ PRUSALINK_URL: "http://p", PRUSALINK_API_KEY: "k" }, "http://q"), { baseUrl: "http://q", apiKey: "k" });
  assert.match(octoPrintTargetFromEnv({ OCTOPRINT_URL: "http://o" }), /OCTOPRINT_API_KEY/);
  assert.deepEqual(parseDigestChallenge('Digest realm="Printer API", nonce="abc", qop="auth"'), { realm: "Printer API", nonce: "abc", qop: "auth", opaque: undefined, algorithm: undefined });
  assert.equal(parseDigestChallenge("Basic realm=x"), null);
});
