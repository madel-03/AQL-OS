export default function BrainPanels({ result }) {
  if (!result) return null;

  const isGemini = result.thinking_source === 'gemini';

  return (
    <>
      {/* شريحة مصدر التفكير */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <span
          style={{
            padding: '7px 14px',
            borderRadius: '999px',
            border: isGemini
              ? '1px solid rgba(139, 92, 246, 0.35)'
              : '1px solid rgba(148, 163, 184, 0.25)',
            background: isGemini ? 'rgba(139, 92, 246, 0.12)' : 'rgba(148, 163, 184, 0.08)',
            color: isGemini ? '#c4b5fd' : '#94a3b8',
            fontSize: '0.8rem',
            fontWeight: 800,
          }}
        >
          {isGemini ? '🧠 بَصِير يفكر عبر Gemini' : '⚙️ محرك القواعد (AI غير متصل)'}
        </span>
      </div>

      {/* سؤال المحقق */}
      {result.detective_question && (
        <div className="glass-panel deduction-panel" style={{ padding: '1.8rem' }}>
          <h4
            style={{
              marginTop: 0,
              color: '#c4b5fd',
              fontSize: '1.15rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>🕵️</span> سؤال المحقق:
          </h4>
          <p style={{ margin: 0, fontSize: '1.1rem', lineHeight: 1.8, color: '#e2e8f0', fontStyle: 'italic' }}>
            "{result.detective_question}"
          </p>
        </div>
      )}

      {/* التوصية التنفيذية */}
      {result.recommendation && (
        <div className="glass-panel hud-panel" style={{ padding: '1.8rem' }}>
          <h4
            style={{
              marginTop: 0,
              color: '#38bdf8',
              fontSize: '1.15rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>🧭</span> توصية بَصِير التنفيذية:
          </h4>
          <p style={{ margin: 0, fontSize: '1.05rem', lineHeight: 1.8, color: '#e2e8f0' }}>
            {result.recommendation}
          </p>
        </div>
      )}
    </>
  );
}