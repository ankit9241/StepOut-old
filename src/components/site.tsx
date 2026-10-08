import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

export function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 md:px-10 md:py-8">
      <Link to="/" className="display text-xl md:text-2xl">
        Physical CAPTCHA
      </Link>
      <nav className="hidden items-center gap-8 text-sm md:flex">
        <Link to="/dashboard" className="link-quiet" activeProps={{ className: "text-primary" }}>
          Dashboard
        </Link>
        <Link to="/how-it-works" className="link-quiet" activeProps={{ className: "text-primary" }}>
          How it works
        </Link>
        <Link to="/create" className="btn !py-2.5 !px-4 text-sm">
          Get a challenge
        </Link>
      </nav>
      <button className="label md:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Close" : "Menu"}
      </button>
      {open && (
        <div className="absolute inset-x-0 top-20 z-10 border-b bg-background px-6 pb-8 md:hidden">
          <Link
            to="/dashboard"
            onClick={() => setOpen(false)}
            className="display block py-3 text-3xl"
          >
            Dashboard
          </Link>
          <Link
            to="/how-it-works"
            onClick={() => setOpen(false)}
            className="display block py-3 text-3xl"
          >
            How it works
          </Link>
          <Link
            to="/create"
            onClick={() => setOpen(false)}
            className="display block py-3 text-3xl text-primary"
          >
            Get a challenge
          </Link>
        </div>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mx-auto flex max-w-6xl justify-between px-6 py-10 text-xs text-muted-foreground md:px-10">
      <span>Physical CAPTCHA</span>
      <span>Less interface. More real world.</span>
    </footer>
  );
}

export function OptionGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <fieldset className="border-t py-8">
      <legend className="label float-left mb-5 w-full">{label}</legend>
      <div className="clear-both flex flex-wrap gap-x-6 gap-y-3">
        {options.map((o) => {
          const active = value === o;
          return (
            <button
              type="button"
              key={o}
              onClick={() => onChange(o)}
              aria-pressed={active}
              className={`display text-2xl transition-colors md:text-3xl ${
                active
                  ? "text-primary underline decoration-1 underline-offset-8"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {o}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Page({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return (
    <main
      className={`mx-auto px-6 pb-24 pt-10 md:px-10 md:pt-20 ${narrow ? "max-w-2xl" : "max-w-6xl"}`}
    >
      {children}
    </main>
  );
}
