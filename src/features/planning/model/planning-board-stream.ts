import type { PlanningBoardStreamFrame } from "./planning-board-delivery";

// The transport can split a JSON line at any byte, including within UTF-8.
// Delivery is incremental; a held sibling never gates an already complete line.
export async function consumePlanningBoardStream(response: Response, receive: (frame: PlanningBoardStreamFrame) => void) {
  if (!response.body) throw new Error("Die Planungsantwort ist unvollständig.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffered = "", readId: string | undefined, ended = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
        if (!line.trim()) continue;
        const frame = JSON.parse(line) as PlanningBoardStreamFrame;
        if (!frame || typeof frame !== "object" || ended || typeof frame.readId !== "string" || !frame.readId
          || !["basis", "column", "failure", "end"].includes(frame.kind)) throw new Error("Die Planungsantwort ist ungültig.");
        if (frame.kind === "basis") {
          if (readId || !frame.model?.board || !frame.model.query || !frame.readAuthority) throw new Error("Die Planungsbasis ist ungültig.");
          readId = frame.readId;
        } else if (!readId || frame.readId !== readId) throw new Error("Die Planungsantwort gehört zu einem anderen Abruf.");
        if (frame.kind === "column" && (!Array.isArray(frame.items) || !Array.isArray(frame.cardIds) || !Array.isArray(frame.relationships) || !frame.columnState)) throw new Error("Die Spaltenantwort ist ungültig.");
        if (frame.kind === "failure" && ![403, 409, 503].includes(frame.status)) throw new Error("Der Spaltenfehler ist ungültig.");
        if (frame.kind === "end") ended = true;
        receive(frame);
      }
      if (done) {
        if (!ended || buffered.trim()) throw new Error("Die Planungsantwort wurde unterbrochen.");
        return;
      }
    }
  } finally { await reader.cancel().catch(() => undefined); }
}
