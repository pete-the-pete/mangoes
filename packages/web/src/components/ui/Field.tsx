"use client";

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { cn } from "./cn";
import { Label } from "./Label";

// "use client" because useId is a hook — a server component importing this
// would fail at runtime. Forms are interactive anyway, so the boundary costs
// nothing here.
const CONTROL =
  "text-ink bg-white border-5 border-ink rounded-20 shadow-sticker-md shadow-ink " +
  "min-h-11 w-full px-3.5 py-2 outline-none " +
  "focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ink " +
  "disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Which face the control's own text is set in.
 *
 * `display` is the handoff's look for a field holding a *label-like* value —
 * a session name, a role. It is Anton, and Anton is always uppercase.
 *
 * `plain` exists because that is wrong for anything the user types verbatim.
 * An email in `display` renders as NAME@GMAIL.COM while the submitted value
 * is still lowercase — the field shows the user something other than what
 * they are sending, which is worse than merely being unstyled.
 */
const FACE = {
  display: "font-display text-20",
  plain: "font-sans text-16 normal-case",
} as const;

interface FieldChrome {
  /** Small-caps label above the control (screens 4 and 7). */
  label: ReactNode;
  hint?: ReactNode;
  /** Defaults to `display`. Use `plain` for emails and any free text. */
  face?: keyof typeof FACE;
  className?: string;
}

export type TextFieldProps = FieldChrome &
  InputHTMLAttributes<HTMLInputElement>;

/**
 * Label + control as one unit, wired together by a generated id so the label
 * is always clickable and always announced — the thing that quietly goes
 * missing when every form hand-rolls its own markup.
 */
export function TextField({
  label,
  hint,
  face = "display",
  className,
  id,
  ...rest
}: TextFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label size={10} as="label" htmlFor={fieldId} className="text-rust">
        {label}
      </Label>
      <input
        id={fieldId}
        aria-describedby={hintId}
        className={cn(CONTROL, FACE[face])}
        {...rest}
      />
      {hint && (
        <Label size={9} as="p" id={hintId} className="text-rust">
          {hint}
        </Label>
      )}
    </div>
  );
}

export type SelectFieldProps = FieldChrome &
  SelectHTMLAttributes<HTMLSelectElement>;

export function SelectField({
  label,
  hint,
  face = "display",
  className,
  id,
  children,
  ...rest
}: SelectFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label size={10} as="label" htmlFor={fieldId} className="text-rust">
        {label}
      </Label>
      <select
        id={fieldId}
        aria-describedby={hintId}
        className={cn(CONTROL, FACE[face], "cursor-pointer")}
        {...rest}
      >
        {children}
      </select>
      {hint && (
        <Label size={9} as="p" id={hintId} className="text-rust">
          {hint}
        </Label>
      )}
    </div>
  );
}
