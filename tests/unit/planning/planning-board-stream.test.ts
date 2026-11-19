import { expect, test } from "vitest";
import { consumePlanningBoardStream } from "@/features/planning/model/planning-board-stream";

const basis = { kind: "basis", readId: "one-query", model: { query: {}, board: {} }, readAuthority: { userId: "reader", deadline: 9_000_000_000_000 }, currentProfile: { name: "Ärztin" } };
const end = { kind: "end", readId: "one-query" };
const line = (value: unknown) => `${JSON.stringify(value)}\n`;

test("a complete UTF-8 basis is delivered before the response ends even when bytes split a character", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>, receivedBasis!: () => void;
  const entered = new Promise<void>(resolve => { receivedBasis = resolve; });
  const response = new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }));
  const received: string[] = [];
  let finished = false;
  const pending = consumePlanningBoardStream(response, frame => { received.push(frame.kind); if (frame.kind === "basis") { expect(frame.currentProfile?.name).toBe("Ärztin"); receivedBasis(); } }).then(() => { finished = true; });
  const bytes = new TextEncoder().encode(line(basis)), split = bytes.indexOf(0xc3) + 1;
  controller.enqueue(bytes.slice(0, split)); controller.enqueue(bytes.slice(split));
  await entered;
  expect(received).toEqual(["basis"]); expect(finished).toBe(false);
  controller.enqueue(new TextEncoder().encode(line(end))); controller.close();
  await pending; expect(received).toEqual(["basis", "end"]);
});

test.each([
  ["missing terminal frame", line(basis)],
  ["foreign read identity", line(basis) + line({ kind: "end", readId: "another-query" })],
  ["duplicate basis", line(basis) + line(basis) + line(end)],
  ["malformed JSON", line(basis) + "{broken}\n"],
  ["frame after terminal", line(basis) + line(end) + line({ kind: "failure", readId: "one-query", status: 503 })],
  ["unclassified failure", line(basis) + line({ kind: "failure", readId: "one-query", status: 200 }) + line(end)],
])("the stream rejects %s instead of inventing successful completeness", async (_name, body) => {
  await expect(consumePlanningBoardStream(new Response(body), () => undefined)).rejects.toThrow();
});
