/**
 * M6–M9 续传存储验收（项目根目录）：npx tsx scripts/m6-m9-acceptance.ts
 * - MemoryStreamSessionStore：create / append / 5A / markDone·markError
 * - parseEventId、replayAndFollow、createSSEWriter（经 store.appendEvent）
 */
import { webcrypto } from "node:crypto";

if (typeof globalThis.crypto === "undefined") {
  (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as Crypto;
}

import { MemoryStreamSessionStore } from "../lib/sseServer/streamSession.memory";
import {
  createSSEWriter,
  parseEventId,
  replayAndFollow,
} from "../lib/sseServer/streamSession";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[FAIL] ${msg}`);
}

let passed = 0;
function ok(name: string): void {
  passed += 1;
  console.log(`[OK] ${name}`);
}

async function run(): Promise<void> {
  const p = parseEventId("550e8400-e29b-41d4-a716-446655440000:42");
  assert(p !== null && p.streamId === "550e8400-e29b-41d4-a716-446655440000" && p.seq === 42, "parseEventId uuid:seq");
  assert(parseEventId("nocolon") === null, "parseEventId invalid");
  ok("M6 parseEventId");

  const store = new MemoryStreamSessionStore();
  const session = await store.create("guest-m69");
  assert(session.guestId === "guest-m69" && session.seq === 0 && session.events.length === 0, "create initial");
  ok("M7 create");

  const sid = session.streamId;
  const opts = { maxEvents: 100, maxBytes: 1_000_000 };
  const r1 = await store.appendEvent(
    sid,
    { seq: 1, id: `${sid}:1`, sse: "event:x\ndata:1\n\n" },
    opts,
  );
  assert(r1.dropped === 0, "append first");
  const s1 = await store.get(sid);
  assert(s1 && s1.seq === 1 && s1.events.length === 1, "get after append");
  ok("M7 appendEvent + get");

  const tight = { maxEvents: 2, maxBytes: 10_000 };
  await store.appendEvent(sid, { seq: 2, id: `${sid}:2`, sse: "b" }, tight);
  const r3 = await store.appendEvent(sid, { seq: 3, id: `${sid}:3`, sse: "c" }, tight);
  assert(r3.dropped >= 1, "5A should drop when over maxEvents");
  const sTight = await store.get(sid);
  assert(sTight && sTight.events.length === 2, "length capped at maxEvents");
  assert(
    sTight!.events[0].seq === 2 && sTight!.events[1].seq === 3,
    "keeps newest seq after drop",
  );
  ok("M7/M9 5A maxEvents");

  let threw = false;
  try {
    await store.appendEvent("00000000-0000-0000-0000-000000000000", { seq: 1, id: "x:1", sse: "x" }, opts);
  } catch {
    threw = true;
  }
  assert(threw, "appendEvent missing session throws");
  ok("M6 appendEvent guard");

  const encoder = new TextEncoder();
  const replayChunks: Uint8Array[] = [];
  const outStream = new WritableStream<Uint8Array>({
    write(chunk) {
      replayChunks.push(new Uint8Array(chunk));
    },
  });
  const writer = outStream.getWriter();
  const replayStore = new MemoryStreamSessionStore();
  const rs = await replayStore.create("g2");
  await replayStore.appendEvent(
    rs.streamId,
    { seq: 1, id: `${rs.streamId}:1`, sse: "e1\n\n" },
    opts,
  );
  await replayStore.appendEvent(
    rs.streamId,
    { seq: 2, id: `${rs.streamId}:2`, sse: "e2\n\n" },
    opts,
  );
  await replayStore.markDone(rs.streamId);
  await replayAndFollow(replayStore, rs.streamId, 0, writer, encoder);
  await writer.close();
  const collected = Buffer.concat(replayChunks.map((u) => Buffer.from(u))).toString("utf8");
  assert(collected.includes("e1") && collected.includes("e2"), "replay both events");
  ok("M9 replayAndFollow + markDone");

  const wStore = new MemoryStreamSessionStore();
  const ws = await wStore.create("g3");
  const wRef = { current: null as WritableStreamDefaultWriter<Uint8Array> | null };
  const writeSSE = createSSEWriter(ws, new TextEncoder(), wRef, {
    store: wStore,
    buffer: { maxEvents: 50, maxBytes: 100_000 },
  });
  await writeSSE("delta", { content: "hello" });
  const after = await wStore.get(ws.streamId);
  assert(after && after.events.length === 1 && after.seq === 1, "createSSEWriter → appendEvent");
  ok("M9 createSSEWriter → store");

  console.log("");
  console.log(`All passed: ${passed} checks`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
