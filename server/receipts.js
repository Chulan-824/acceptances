import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { forbiddenName } from "./validation-assets.js";
import { RULESET_VERSION } from "./validation-rules-v0.1.0.js";
import { validateRoundDirectory } from "./validation.js";
import { shanghaiNow } from "./time.js";

function receiptFile(root, subject, round) {
  return path.join(root, ".meta", subject, `${round}.json`);
}

function rawFiles(roundDir) {
  const files = [];
  const roundStat = fs.lstatSync(roundDir);
  if (roundStat.isSymbolicLink() || !roundStat.isDirectory()) throw new Error("round is not a regular directory");
  const add = (file, relative) => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`not a regular raw file: ${relative}`);
    if (forbiddenName(relative)) throw new Error(`forbidden raw file: ${relative}`);
    files.push({ file, relative });
  };
  add(path.join(roundDir, "result.json"), "result.json");
  add(path.join(roundDir, "report.md"), "report.md");
  const trace = path.join(roundDir, "interaction-trace.jsonl");
  if (fs.existsSync(trace)) add(trace, "interaction-trace.jsonl");
  const assets = path.join(roundDir, "assets");
  const assetsStat = fs.lstatSync(assets);
  if (assetsStat.isSymbolicLink() || !assetsStat.isDirectory()) throw new Error("assets is not a regular directory");
  const walk = (directory, prefix) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relative = `${prefix}/${entry.name}`;
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`not a regular raw file: ${relative}`);
      if (stat.isDirectory()) walk(file, relative);
      else add(file, relative);
    }
  };
  walk(assets, "assets");
  return files.sort((left, right) => left.relative.localeCompare(right.relative));
}

export function computeRoundDigest(roundDir) {
  const hash = crypto.createHash("sha256");
  for (const entry of rawFiles(roundDir)) {
    hash.update(entry.relative);
    hash.update("\0");
    hash.update(fs.readFileSync(entry.file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function loadReceipt(root, subject, round) {
  const file = receiptFile(root, subject, round);
  if (!fs.existsSync(file)) return { state: "legacy", file, receipt: null };
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return { state: "invalid", file, receipt: null };
    const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      receipt?.schema !== "acceptances.roundReceipt@1" ||
      typeof receipt.digest !== "string" ||
      typeof receipt.ruleset !== "string" ||
      !Number.isInteger(receipt.sequence) ||
      receipt.sequence < 1 ||
      typeof receipt.sealedAt !== "string"
    ) {
      return { state: "invalid", file, receipt: null };
    }
    return { state: "sealed", file, receipt };
  } catch {
    return { state: "invalid", file, receipt: null };
  }
}

function existingSequences(root, subject) {
  const directory = path.join(root, ".meta", subject);
  if (!fs.existsSync(directory)) return [];
  const values = [];
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith(".json")) continue;
    try {
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`invalid receipt: ${file}`);
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (value.schema !== "acceptances.roundReceipt@1" || !Number.isInteger(value.sequence)) {
        throw new Error(`invalid receipt: ${path.join(directory, name)}`);
      }
      values.push(value.sequence);
    } catch {
      throw new Error(`invalid receipt: ${path.join(directory, name)}`);
    }
  }
  return values;
}

function acquireLocks(groups) {
  const locks = [];
  try {
    for (const { root, subject } of groups) {
      const directory = path.join(root, ".meta", subject);
      fs.mkdirSync(directory, { recursive: true });
      const lock = path.join(directory, ".seal.lock");
      const descriptor = fs.openSync(lock, "wx");
      locks.push({ descriptor, lock });
    }
    return locks;
  } catch (error) {
    releaseLocks(locks);
    throw error;
  }
}

function releaseLocks(locks) {
  for (const { descriptor, lock } of [...locks].reverse()) {
    try { fs.closeSync(descriptor); } catch { /* best-effort lock cleanup */ }
    try { fs.unlinkSync(lock); } catch { /* best-effort lock cleanup */ }
  }
}

export function sealRounds(targets) {
  if (targets.some((target) => target.validation.outcome === "rejected")) {
    throw new Error("cannot seal rejected rounds");
  }
  const groups = [...new Map(targets.map((target) => [`${target.root}\0${target.subject}`, { root: target.root, subject: target.subject }])).values()]
    .sort((left, right) => `${left.root}/${left.subject}`.localeCompare(`${right.root}/${right.subject}`));
  const locks = acquireLocks(groups);
  const staged = [];
  const committed = [];
  try {
    const nextByGroup = new Map(groups.map((group) => {
      const values = existingSequences(group.root, group.subject);
      return [`${group.root}\0${group.subject}`, Math.max(0, ...values) + 1];
    }));
    for (const target of targets) {
      const loaded = loadReceipt(target.root, target.subject, target.round);
      const before = computeRoundDigest(target.dir);
      const currentValidation = validateRoundDirectory(target.dir, { subject: target.subject });
      if (currentValidation.outcome === "rejected") throw new Error(`validation changed before seal: ${target.dir}`);
      const digest = computeRoundDigest(target.dir);
      if (before !== digest) throw new Error(`ROUND_CHANGED_DURING_SEAL: ${target.dir}`);
      if (loaded.state === "sealed") {
        if (loaded.receipt.digest !== digest || loaded.receipt.ruleset !== RULESET_VERSION) {
          throw new Error(`ROUND_TAMPERED: ${target.dir}`);
        }
        continue;
      }
      if (loaded.state === "invalid") throw new Error(`invalid receipt: ${loaded.file}`);
      const group = `${target.root}\0${target.subject}`;
      const sequence = nextByGroup.get(group);
      nextByGroup.set(group, sequence + 1);
      const receipt = {
        schema: "acceptances.roundReceipt@1",
        digest,
        ruleset: RULESET_VERSION,
        sequence,
        sealedAt: shanghaiNow(),
      };
      fs.mkdirSync(path.dirname(loaded.file), { recursive: true });
      const temporary = `${loaded.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
      staged.push({ temporary, destination: loaded.file, receipt });
    }
    for (const entry of staged) {
      fs.renameSync(entry.temporary, entry.destination);
      committed.push(entry.destination);
    }
    return targets.map((target) => loadReceipt(target.root, target.subject, target.round).receipt);
  } catch (error) {
    for (const entry of staged) {
      try { fs.unlinkSync(entry.temporary); } catch { /* best-effort rollback */ }
    }
    for (const file of committed) {
      try { fs.unlinkSync(file); } catch { /* best-effort rollback */ }
    }
    throw error;
  } finally {
    releaseLocks(locks);
  }
}
