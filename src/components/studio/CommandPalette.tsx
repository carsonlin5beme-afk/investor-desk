"use client";
import { useMemo, useState } from "react";
import { Search, ArrowUpRight, Command } from "lucide-react";
import { DeskModal } from "@/components/DeskModal";
export type CommandItem = {
  id: string;
  label: string;
  detail?: string;
  run: () => void;
};
export function CommandPalette({
  items,
  close,
}: {
  items: CommandItem[];
  close: () => void;
}) {
  const [query, setQuery] = useState(""),
    [index, setIndex] = useState(0);
  const results = useMemo(
    () =>
      items
        .filter((i) =>
          `${i.label} ${i.detail ?? ""}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .slice(0, 12),
    [items, query],
  );
  return (
    <DeskModal
      title="Find your next move"
      kicker="Your workspace, at your fingertips"
      close={close}
    >
      <div className="modal-body command-body">
        <label className="command-search">
          <Search size={20} />
          <input
            autoFocus
            placeholder="Search portfolios, holdings, and actions…"
            aria-label="Search commands"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="command-results"
            aria-activedescendant={
              results[index] ? `command-${results[index].id}` : undefined
            }
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setIndex(
                  (i) =>
                    (i +
                      (e.key === "ArrowDown" ? 1 : -1) +
                      Math.max(1, results.length)) %
                    Math.max(1, results.length),
                );
              }
              if (e.key === "Enter" && results[index]) {
                e.preventDefault();
                close();
                results[index].run();
              }
            }}
          />
        </label>
        <div
          id="command-results"
          role="listbox"
          aria-label="Matching commands"
          className="command-results"
        >
          {results.map((item, i) => (
            <button
              key={item.id}
              id={`command-${item.id}`}
              type="button"
              role="option"
              aria-selected={i === index}
              onPointerMove={() => setIndex(i)}
              onClick={() => {
                close();
                item.run();
              }}
            >
              <span>
                {item.label}
                <small>{item.detail}</small>
              </span>
              <ArrowUpRight size={17} />
            </button>
          ))}
        </div>
        {!results.length && (
          <p className="empty-inline">
            No matches. Try a portfolio name, symbol, or “order”.
          </p>
        )}
        <p className="command-hint">
          <Command size={14} />K to open · ↑↓ to navigate · Enter to select ·
          Escape to close
        </p>
      </div>
    </DeskModal>
  );
}
