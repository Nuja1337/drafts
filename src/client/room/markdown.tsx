// Minimal, safe markdown renderer for coach output: paragraphs, headings, bullet/numbered lists, **bold**, `code`.
// Builds React elements (never innerHTML), so model output can't inject markup.
import type { ReactNode } from "react";

type Block = { kind: "p"; text: string } | { kind: "h"; text: string } | { kind: "ul" | "ol"; items: string[] };

function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flush();
    } else if (h) {
      flush();
      blocks.push({ kind: "h", text: h[1] });
    } else if (ul || ol) {
      flush();
      const kind = ul ? "ul" : "ol";
      const text = (ul ?? ol)![1];
      const last = blocks[blocks.length - 1];
      if (last && last.kind === kind) last.items.push(text);
      else blocks.push({ kind, items: [text] });
    } else {
      const last = blocks[blocks.length - 1];
      // Continuation line of a list item (indented, no marker).
      if (!para.length && last && (last.kind === "ul" || last.kind === "ol") && /^\s{2,}\S/.test(raw)) {
        last.items[last.items.length - 1] += ` ${line.trim()}`;
      } else {
        para.push(line.trim());
      }
    }
  }
  flush();
  return blocks;
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={k++} className="font-semibold text-text">{m[1]}</strong>);
    else out.push(<code key={k++} className="rounded bg-panel-3 px-1 text-[0.9em]">{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-2 text-sm leading-relaxed text-muted">
      {blocks.map((b, i) => {
        if (b.kind === "h") return <p key={i} className="font-display font-semibold text-text">{inline(b.text)}</p>;
        if (b.kind === "p") return <p key={i}>{inline(b.text)}</p>;
        const items = b.items.map((it, j) => <li key={j}>{inline(it)}</li>);
        return b.kind === "ul" ? (
          <ul key={i} className="list-disc space-y-1 pl-5 marker:text-accent">
            {items}
          </ul>
        ) : (
          <ol key={i} className="list-decimal space-y-1 pl-5 marker:text-accent">
            {items}
          </ol>
        );
      })}
    </div>
  );
}
