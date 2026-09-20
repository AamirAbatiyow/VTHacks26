import { useId, useRef, useState } from "react";
import { USER_ROLES, type UserRole } from "@shared/events";
import { playSfx } from "../audio/sfx";
import "./RoleQuestion.css";

interface Props {
  value: UserRole | undefined;
  invalid: boolean;
  onChange: (role: UserRole) => void;
}

// Unique asymmetric edges and notches stay clear of each label.
const PAD_SHAPES = [
  "M76 17 L103 40 L102 12 C165 0 240 24 248 62 C261 107 195 132 123 128 C60 136 7 107 13 68 C16 42 39 25 76 17 Z",
  "M175 13 L156 38 L202 23 C236 37 253 60 242 85 C226 121 168 132 106 125 C48 120 9 99 14 64 C21 22 109 3 175 13 Z",
  "M228 40 L199 52 L246 62 C258 93 216 124 157 130 C94 137 20 121 12 85 C0 47 44 18 102 13 C159 3 205 18 228 40 Z",
  "M26 41 L63 51 L40 26 C80 7 139 7 186 19 C232 29 257 58 246 89 C236 120 177 133 116 126 C58 132 10 107 12 76 C12 62 17 49 26 41 Z",
  "M121 11 L142 37 L159 14 C215 18 251 44 248 76 C245 112 193 133 127 129 C61 131 13 111 11 79 C4 41 57 11 121 11 Z",
  "M197 20 L181 46 L225 33 C247 49 254 70 241 93 C220 124 154 135 98 125 C43 119 9 96 15 64 C23 26 74 7 130 11 C157 8 179 13 197 20 Z",
];

/** Native radios shaped as lily pads; rings animate separately from their labels. */
export function RoleQuestion({ value, invalid, onChange }: Props) {
  const shadingId = useId();
  const nextRipple = useRef(0);
  const [ripples, setRipples] = useState<Record<string, number>>({});

  function ripple(role: UserRole) {
    playSfx("pad-select");
    const id = ++nextRipple.current;
    setRipples((current) => ({ ...current, [role]: id }));
  }

  return (
    <fieldset className="role-pond" aria-invalid={invalid} aria-describedby={invalid ? "setup-hint setup-error" : "setup-hint"}>
      <legend className="visually-hidden">What role best suits you?</legend>
      <div className="role-pond__water" aria-hidden="true" />
      {USER_ROLES.map((role, index) => (
        <label key={role} className="role-pad">
          <input
            type="radio"
            name="userRole"
            value={role}
            checked={value === role}
            onChange={() => { onChange(role); ripple(role); }}
            onClick={() => { if (value === role) ripple(role); }}
          />
          {ripples[role] && (
            <span key={ripples[role]} className="role-pad__ripples" aria-hidden="true">
              <span /><span /><span />
            </span>
          )}
          <svg className="role-pad__leaf" viewBox="0 0 260 140" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <defs>
              <linearGradient id={`${shadingId}-${index}`} x1="20%" y1="0%" x2="65%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.65" />
                <stop offset="48%" stopColor="#ffffff" stopOpacity="0.12" />
                <stop offset="100%" stopColor="#42684a" stopOpacity="0.24" />
              </linearGradient>
            </defs>
            <path className="role-pad__shape" d={PAD_SHAPES[index % PAD_SHAPES.length]} />
            <path d={PAD_SHAPES[index % PAD_SHAPES.length]} fill={`url(#${shadingId}-${index})`} />
            <path className="role-pad__veins" d="M130 111 Q101 108 80 99 M131 112 Q165 108 185 96 M132 109 L133 97" />
          </svg>
          <span className="role-pad__label">{role}</span>
          <span className="role-pad__selected" aria-hidden="true">✓</span>
        </label>
      ))}
    </fieldset>
  );
}
