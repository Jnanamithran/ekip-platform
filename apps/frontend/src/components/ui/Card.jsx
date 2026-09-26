export default function Card({ className = "", children, ...props }) {
  return (
    <div
      className={`rounded-lg border border-hairline bg-paper-raised
        shadow-[0_1px_2px_rgba(20,23,31,0.04)] ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
