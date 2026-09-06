const VARIANTS = {
  primary: "bg-index text-white hover:bg-index-hover",
  secondary: "bg-transparent text-ink border border-hairline hover:bg-paper-raised",
  ghost: "bg-transparent text-slate hover:text-ink hover:bg-index-soft",
  danger: "bg-danger text-white hover:opacity-90",
};

/**
 * Base button. Keep call sites honest: the label should say
 * exactly what happens ("Upload document", not "Submit").
 */
export default function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2
        text-sm font-medium transition-colors disabled:opacity-50
        disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
