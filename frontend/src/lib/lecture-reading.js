export function lectureBlocks(text = '') {
  const blocks = [];
  for (const line of text.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
    const heading = line.match(/^#{1,6}\s+(.+)/);
    const item = line.match(/^(?:(\d+)[.)]|[-*•])\s+(.+)/);
    const answer = line.match(/^(?:ج|الإجابة|A|Answer)\s*[:：]\s*(.+)/i);
    if (answer && blocks.at(-1)?.type === 'item' && !blocks.at(-1).answer) {
      blocks.at(-1).answer = answer[1];
    } else if (heading) {
      blocks.push({ type: 'heading', text: heading[1] });
    } else if (item) {
      blocks.push({ type: 'item', number: item[1], text: item[2] });
    } else {
      blocks.push({ type: 'paragraph', text: line });
    }
  }
  return blocks;
}

export function lectureInline(text) {
  return text.split(/(\*\*[^*\n]+\*\*|\[[^\]\n]{1,100}\])/g).filter(Boolean).map(part => {
    if (part.startsWith('**') && part.endsWith('**')) return { tag: 'strong', text: part.slice(2, -2) };
    if (/^\[[^\]\n]{1,100}\]$/.test(part)) return { tag: 'bdi', text: part };
    return { tag: null, text: part };
  });
}
