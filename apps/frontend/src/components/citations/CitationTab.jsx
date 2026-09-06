/**
 * The platform's signature element. Renders a source citation as
 * a small "index card tab" — amber signal color, mono metadata —
 * so a user learns fast: amber + monospace = this is a real,
 * traceable source, not generated text.
 *
 * Shape assumed for `source` (confirm against real API once the
 * Step 9 contract lands — this is a mock-driven guess):
 *   { id, filename, page, excerpt }
 */
export default function CitationTab({ source, index }) {
  return (
    <details className="group rounded-md border border-signal/30 bg-signal-soft/60">
      <summary
        className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs"
      >
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full
            bg-signal text-[10px] font-semibold text-white"
        >
          {index}
        </span>
        <span className="truncate font-mono text-ink-soft">
          {source.filename}
          {source.page != null && (
            <span className="text-slate"> · p.{source.page}</span>
          )}
        </span>
        <span className="ml-auto text-slate-light transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="border-t border-signal/20 px-3 py-2">
        <p className="font-mono text-xs leading-relaxed text-slate">
          {source.excerpt}
        </p>
      </div>
    </details>
  );
}
