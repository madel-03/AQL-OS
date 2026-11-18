import { lectureBlocks, lectureInline } from './lecture-reading.js';

export function studySections(result, en) {
  const refs = new Set((result.sources || []).map(unit => '[' + unit.ref + ']'));
  const clean = text => lectureInline(text)
    .filter(part => part.tag !== 'bdi' || (!refs.has(part.text) && !/^\[(?:pages?|slide|صفحة|شريحة)\s+\d/i.test(part.text)))
    .map(part => part.text).join('').replace(/[ \t]{2,}/g, ' ').trim();
  return [
    [en ? 'Overview' : 'خلاصة المحاضرة', result.summary],
    [en ? 'Key concepts' : 'المفاهيم الأساسية', result.explanation],
    [en ? 'Practice & answers' : 'أسئلة للمراجعة', result.questions],
  ].map(([title, text]) => ({
    title,
    blocks: lectureBlocks(text).map(block => ({ ...block, text: clean(block.text), answer: block.answer ? clean(block.answer) : '' })),
  }));
}

export function studyMap(result, en) {
  const concepts = studySections(result, en)[1].blocks.filter(block => block.type !== 'paragraph');
  return concepts.slice(0, 5).map(block => {
    const label = block.text.split(/[:：]/, 1)[0];
    return label.length > 80 ? label.slice(0, 77) + '…' : label;
  });
}
