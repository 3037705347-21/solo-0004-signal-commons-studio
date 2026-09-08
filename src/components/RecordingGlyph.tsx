export function RecordingGlyph({
  color,
  size = "medium",
}: {
  color: string;
  size?: "small" | "medium" | "large";
}) {
  return (
    <span
      className={`recording-glyph recording-glyph-${size}`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      <span />
    </span>
  );
}
