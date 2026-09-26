const SIZES = {
  sm: "h-7 w-7 text-xs",
  md: "h-9 w-9 text-sm",
};

export default function Avatar({ name, size = "md" }) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full
        bg-index font-medium text-white ${SIZES[size]}`}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
