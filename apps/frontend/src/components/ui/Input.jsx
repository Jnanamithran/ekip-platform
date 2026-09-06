export default function Input({ label, error, id, className = "", ...props }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-ink-soft">
          {label}
        </label>
      )}
      <input
        id={id}
        className={`rounded-md border border-hairline bg-paper-raised px-3 py-2
          text-sm text-ink placeholder:text-slate-light
          focus:border-index focus:outline-none
          ${error ? "border-danger" : ""} ${className}`}
        aria-invalid={!!error}
        {...props}
      />
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
