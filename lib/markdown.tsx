import type { ReactNode } from "react";

// Piccolo renderer Markdown "quanto basta", senza dipendenze esterne: il layer di conversazione
// usa Markdown (titoli, grassetto, separatori, citazioni, liste) per dare risalto al testo, ma
// il sito prima lo mostrava come testo semplice (white-space: pre-wrap) — i simboli comparivano
// grezzi (##, **, ---) invece di essere interpretati. Copre solo il sottoinsieme di sintassi
// realmente osservato nelle risposte: non e' un parser Markdown completo, ma basta a rendere
// bene quello che l'AI scrive davvero, senza aggiungere una libreria esterna al progetto.

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*.+?\*\*)/g).filter((part) => part.length > 0);
  return parts.map((part, index) => {
    const boldMatch = part.match(/^\*\*(.+)\*\*$/);
    if (boldMatch) {
      return <strong key={`${keyPrefix}-b-${index}`}>{boldMatch[1]}</strong>;
    }
    return <span key={`${keyPrefix}-t-${index}`}>{part}</span>;
  });
}

export function renderMarkdown(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraphBuffer: string[] = [];
  let listBuffer: { ordered: boolean; items: string[] } | null = null;
  let quoteBuffer: string[] = [];
  let blockIndex = 0;

  function flushParagraph() {
    if (paragraphBuffer.length === 0) return;
    const joined = paragraphBuffer.join(" ").trim();
    if (joined) {
      blocks.push(<p key={`p-${blockIndex}`}>{renderInline(joined, `p-${blockIndex}`)}</p>);
      blockIndex += 1;
    }
    paragraphBuffer = [];
  }

  function flushList() {
    if (!listBuffer) return;
    const items = listBuffer.items.map((item, i) => (
      <li key={`li-${blockIndex}-${i}`}>{renderInline(item, `li-${blockIndex}-${i}`)}</li>
    ));
    if (listBuffer.ordered) {
      blocks.push(<ol key={`ol-${blockIndex}`}>{items}</ol>);
    } else {
      blocks.push(<ul key={`ul-${blockIndex}`}>{items}</ul>);
    }
    blockIndex += 1;
    listBuffer = null;
  }

  function flushQuote() {
    if (quoteBuffer.length === 0) return;
    const joined = quoteBuffer.join(" ").trim();
    blocks.push(<blockquote key={`bq-${blockIndex}`}>{renderInline(joined, `bq-${blockIndex}`)}</blockquote>);
    blockIndex += 1;
    quoteBuffer = [];
  }

  function flushAll() {
    flushParagraph();
    flushList();
    flushQuote();
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.length === 0) {
      flushAll();
      continue;
    }

    const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      flushAll();
      const level = headerMatch[1].length;
      const content = headerMatch[2];
      blocks.push(
        level <= 2 ? (
          <h3 key={`h-${blockIndex}`}>{renderInline(content, `h-${blockIndex}`)}</h3>
        ) : (
          <h4 key={`h-${blockIndex}`}>{renderInline(content, `h-${blockIndex}`)}</h4>
        )
      );
      blockIndex += 1;
      continue;
    }

    if (/^-{3,}\s*$/.test(line)) {
      flushAll();
      blocks.push(<hr key={`hr-${blockIndex}`} />);
      blockIndex += 1;
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quoteBuffer.push(quoteMatch[1]);
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph();
      flushQuote();
      if (!listBuffer || listBuffer.ordered) {
        flushList();
        listBuffer = { ordered: false, items: [] };
      }
      listBuffer.items.push(bulletMatch[1]);
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      flushQuote();
      if (!listBuffer || !listBuffer.ordered) {
        flushList();
        listBuffer = { ordered: true, items: [] };
      }
      listBuffer.items.push(orderedMatch[1]);
      continue;
    }

    flushList();
    flushQuote();
    paragraphBuffer.push(line);
  }

  flushAll();
  return blocks;
}

export function Markdown({ text }: { text: string }) {
  return <>{renderMarkdown(text)}</>;
}
