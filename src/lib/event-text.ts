/** Conservative heuristic: an explicit roundup label plus multiple list items. */
export function isNewsDigest(title = '', description = ''): boolean {
  const text = `${title}\n${description}`;
  const label = /(?:главное\s+за|коротко\s*#|дайджест|обзор\s+новостей|news\s+(?:roundup|digest)|daily\s+briefing)/iu.test(text);
  const items = text.match(/[♦◆🔹🔸•]|(?:^|\n)\s*(?:[-–]|\d+[.)])\s/gu) ?? [];
  return label && items.length >= 2;
}

/** Plain text only; preserve real paragraphs and separate inline digest bullets. */
export function formatEventText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+([♦◆🔹🔸•])[ \t]*/gu, '\n\n$1 ').trim();
}
