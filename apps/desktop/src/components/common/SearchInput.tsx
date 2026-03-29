import { cn } from "../../lib/utils";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search",
  className,
}: SearchInputProps) {
  return (
    <label className={cn("relative block", className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[8px] uppercase tracking-[0.16em] text-slate-500">
        Find
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-800/80 bg-slate-950/80 px-12 py-1.5 text-[13px] text-slate-100 outline-none transition focus:border-emerald-400/60 focus:bg-slate-950 focus:ring-2 focus:ring-emerald-400/20"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
        >
          Clear
        </button>
      ) : null}
    </label>
  );
}
