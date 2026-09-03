import { forwardRef } from "react";
import type { InputHTMLAttributes, LabelHTMLAttributes, TextareaHTMLAttributes } from "react";
import styles from "./Input.module.css";

export function FieldLabel(props: LabelHTMLAttributes<HTMLLabelElement>) {
  const { className, ...rest } = props;
  return <label className={[styles.label, className].filter(Boolean).join(" ")} {...rest} />;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    const { className, ...rest } = props;
    return <input ref={ref} className={[styles.field, className].filter(Boolean).join(" ")} {...rest} />;
  }
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea(props, ref) {
    const { className, ...rest } = props;
    return <textarea ref={ref} className={[styles.field, className].filter(Boolean).join(" ")} {...rest} />;
  }
);
