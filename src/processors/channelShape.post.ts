import { PostProcessor } from 'lua-cli';

/**
 * Reshapes the reply for the channel it is going out on.
 *
 * The same answer cannot be rendered the same way in a web widget and in
 * WhatsApp. The widget renders Lua's `::: component :::` blocks as buttons and
 * cards; WhatsApp shows them as literal colons and stray text. Markdown tables
 * are worse — they rely on monospace alignment that WhatsApp does not have, and
 * in a right-to-left Arabic message a broken table is genuinely unreadable.
 *
 * So: the web channel keeps everything, and WhatsApp gets clean plain text.
 */
export const channelShapeProcessor = new PostProcessor({
  name: 'channel-shape',
  description:
    'Strips rich components and markdown tables from replies going to WhatsApp and other plain-text ' +
    'channels, and leaves web widget replies untouched.',
  priority: 90,

  execute: async (_user, _message, response, channel) => {
    if (isRichChannel(channel)) {
      return { modifiedResponse: response };
    }
    return { modifiedResponse: toPlainText(response) };
  },
});

/** Channels whose renderer understands Lua component blocks. */
function isRichChannel(channel: string): boolean {
  return channel === 'web' || channel === 'webchat' || channel === 'api' || channel === 'dev';
}

export function toPlainText(input: string): string {
  let out = input;

  // Turn a component block into the plain lines it was standing in for, so an
  // action list still reads as a list of options rather than vanishing.
  out = out.replace(/:::\s*(\w[\w-]*)\s*\n([\s\S]*?):::/g, (_all, _kind: string, body: string) =>
    body
      .split('\n')
      .map((line) => line.replace(/^\s*[-*]\s+/, '• ').trimEnd())
      .filter((line) => line.trim().length > 0)
      .join('\n'),
  );
  // Any component fence left over (empty or malformed) goes entirely.
  out = out.replace(/^:::.*$/gm, '');

  out = flattenTables(out);

  // Markdown emphasis: WhatsApp uses *single* asterisks for bold, and renders
  // ** literally. Underscores collide with Arabic transliteration, so drop them.
  out = out.replace(/\*\*(.+?)\*\*/g, '*$1*');
  out = out.replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1$2');

  // Headings have no meaning here; keep the words, drop the hashes.
  out = out.replace(/^#{1,6}\s+/gm, '');

  // Markdown links: keep the label and the bare URL.
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1: $2');

  // Collapse the blank lines all of the above leaves behind.
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Converts a markdown table into "Header: value" lines, one block per row.
 * This is the transformation that matters most for Arabic: a two-column table
 * of label and value becomes a readable list in either direction.
 */
function flattenTables(input: string): string {
  const lines = input.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const next = lines[i + 1];
    const isHeader = /^\s*\|.*\|\s*$/.test(line);
    const isDivider = next !== undefined && /^\s*\|[\s:|-]+\|\s*$/.test(next);

    if (!isHeader || !isDivider) {
      out.push(line);
      i += 1;
      continue;
    }

    const headers = splitRow(line);
    i += 2; // consume header and divider

    const rows: string[][] = [];
    while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) {
      rows.push(splitRow(lines[i]!));
      i += 1;
    }

    for (const row of rows) {
      const rendered = headers
        .map((h, idx) => {
          const cell = row[idx] ?? '';
          if (!cell) return null;
          return h ? `${h}: ${cell}` : cell;
        })
        .filter((v): v is string => v !== null);
      if (rendered.length > 0) out.push(rendered.join('\n'));
      out.push('');
    }
  }

  return out.join('\n');
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}
