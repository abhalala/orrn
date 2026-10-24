/**
 * Search field for the catalogue lists (dies, customers): a visible label, a hint as placeholder,
 * and the term pushed to the URL after a short pause so the server search runs once per pause
 * (W15) and Back keeps the search.
 */
import { Field, TextInput } from "@orrn/ui/components/field";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type ListSearchProps = {
  label: string;
  placeholder: string;
  /** The term in the URL. */
  value: string;
  /** Called after typing pauses, with the trimmed term. */
  onSearch(term: string): void;
  delayMs?: number;
  className?: string;
};

export function ListSearch({ label, placeholder, value, onSearch, delayMs = 220, className }: ListSearchProps) {
  const [text, setText] = useState(value);
  const latest = useRef(onSearch);
  latest.current = onSearch;
  // The last term this field sent. A URL change that isn't ours (Back, a link) replaces the text;
  // our own echo never does, so typing on during a slow navigation is never undone.
  const sent = useRef(value);

  useEffect(() => {
    if (value === sent.current) return;
    sent.current = value;
    setText(value);
  }, [value]);

  useEffect(() => {
    const term = text.trim();
    if (term === sent.current) return;
    const timer = setTimeout(() => {
      sent.current = term;
      latest.current(term);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [text, delayMs]);

  return (
    <Field label={label} className={className}>
      <div className="relative min-w-0">
        <Search
          aria-hidden="true"
          strokeWidth={2}
          className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground"
        />
        <TextInput
          type="search"
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          autoComplete="off"
          enterKeyHint="search"
          className="pl-10"
        />
      </div>
    </Field>
  );
}
