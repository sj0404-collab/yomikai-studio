import type { ReactNode } from 'react';

function renderInline(line: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(line))) {
    if (match.index > last) nodes.push(line.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-b${index}`} className="font-semibold text-[var(--text)]">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <code
          key={`${keyPrefix}-c${index}`}
          className="rounded bg-black/40 px-1 py-[1px] font-mono text-[11.5px] text-[var(--accent)]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = match.index + token.length;
    index += 1;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes;
}

export function Markdown({ text }: { text: string }) {
  const blocks = text.split('```');
  return (
    <div className="space-y-1.5 text-[12.5px] leading-relaxed">
      {blocks.map((block, index) =>
        index % 2 === 1 ? (
          <pre
            key={index}
            className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[#070a0e] p-2.5 font-mono text-[11px] leading-relaxed text-[#9ece6a]"
          >
            {block.replace(/^[a-z]+\n/, '')}
          </pre>
        ) : (
          <div key={index} className="space-y-1">
            {block.split('\n').map((line, lineIndex) => {
              if (!line.trim()) return <div key={lineIndex} className="h-1" />;
              if (line.startsWith('### ')) {
                return (
                  <div key={lineIndex} className="pt-1 text-[12px] font-semibold text-[var(--text)]">
                    {renderInline(line.slice(4), `${index}-${lineIndex}`)}
                  </div>
                );
              }
              if (line.startsWith('- ')) {
                return (
                  <div key={lineIndex} className="flex gap-2 pl-1">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                    <span className="text-[var(--muted)]">{renderInline(line.slice(2), `${index}-${lineIndex}`)}</span>
                  </div>
                );
              }
              return <p key={lineIndex}>{renderInline(line, `${index}-${lineIndex}`)}</p>;
            })}
          </div>
        ),
      )}
    </div>
  );
}
