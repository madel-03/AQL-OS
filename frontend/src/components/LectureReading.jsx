import { Fragment } from 'react';
import { lectureBlocks, lectureInline } from '../lib/lecture-reading';

function Inline({ text }) {
  return lectureInline(text).map(({ tag: Tag, text: value }, index) =>
    Tag ? <Tag key={index}>{value}</Tag> : <Fragment key={index}>{value}</Fragment>);
}

export default function LectureReading({ text }) {
  return <div className="lecture-reading">
    {lectureBlocks(text).map((block, index) => {
      if (block.type === 'heading') return <h3 key={index}><Inline text={block.text} /></h3>;
      if (block.type === 'paragraph') return <p key={index}><Inline text={block.text} /></p>;
      return <article className="lecture-reading-item" key={index}>
        <p>{block.number && <strong className="lecture-item-number">{block.number}. </strong>}<Inline text={block.text} /></p>
        {block.answer && <p className="lecture-answer"><Inline text={block.answer} /></p>}
      </article>;
    })}
  </div>;
}
