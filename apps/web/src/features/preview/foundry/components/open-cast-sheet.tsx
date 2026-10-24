import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { Sheet } from "@orrn/ui/components/sheet";
import { useEffect, useRef, useState } from "react";

import {
  ALLOY_CODES,
  formatBookDate,
  nextCastNumber,
  BOOK_DATE,
  type AlloyCode,
} from "../fixtures";
import { openCast, useFoundryPreview } from "../store";

export function OpenCastSheet({
  open,
  onOpenChange,
  onOpened,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpened: () => void;
}) {
  const { nextSeq } = useFoundryPreview();
  const [alloy, setAlloy] = useState<AlloyCode>("6063");
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | undefined>();
  const busy = useRef(false);
  const nextNumber = nextCastNumber(nextSeq);

  useEffect(() => {
    if (!open) return;
    setAlloy("6063");
    setLegacyOpen(false);
    setManual("");
    setError(undefined);
    busy.current = false;
  }, [open]);

  const confirm = () => {
    if (busy.current) return;
    const result = openCast({ alloy, manual });
    if (!result.ok) {
      setError(result.error);
      setLegacyOpen(true);
      return;
    }
    busy.current = true;
    onOpened();
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Open cast"
      description="Next number from the series. Nothing is saved."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="open-cast-form">
            Open cast
          </Button>
        </>
      }
    >
      <form
        id="open-cast-form"
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          confirm();
        }}
      >
        <div className="flex flex-col gap-1">
          <p className="m-0 text-[13px] font-medium text-muted-foreground">Next number</p>
          <p className="m-0 font-mono text-[40px] font-bold leading-none tabular-nums">{nextNumber}</p>
          <p className="m-0 text-[13px] text-muted-foreground">October 2026 · year stored, not printed</p>
        </div>
        <div className="flex flex-col gap-1">
          <p className="m-0 text-[13px] font-medium text-muted-foreground">Book date</p>
          <p className="m-0 text-[15px] font-semibold tabular-nums">{formatBookDate(BOOK_DATE)}</p>
        </div>
        <Field id="open-cast-alloy" label="Alloy">
          <NativeSelect
            id="open-cast-alloy"
            value={alloy}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "6063" || value === "6061") setAlloy(value);
            }}
          >
            {ALLOY_CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            aria-expanded={legacyOpen}
            onClick={() =>
              setLegacyOpen((value) => {
                if (value) {
                  setManual("");
                  setError(undefined);
                }
                return !value;
              })
            }
          >
            {legacyOpen ? "Hide legacy code" : "Use a legacy code"}
          </Button>
          {legacyOpen ? (
            <Field
              label="Legacy code"
              hint={`Leave blank to take ${nextNumber}. A month-letter number is refused.`}
              error={error}
            >
              <TextInput
                value={manual}
                onChangeText={(text) => {
                  setManual(text);
                  setError(undefined);
                }}
                autoCapitalize="characters"
                aria-label="Legacy code"
              />
            </Field>
          ) : error ? (
            <p className="m-0 text-[13px] font-medium text-destructive">{error}</p>
          ) : null}
        </div>
      </form>
    </Sheet>
  );
}
