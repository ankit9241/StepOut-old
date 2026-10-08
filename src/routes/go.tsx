import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/go")({
  head: () => ({
    meta: [
      { title: "GO. — Physical CAPTCHA" },
      { name: "description", content: "Your challenge is waiting outside." },
      { property: "og:title", content: "GO. — Physical CAPTCHA" },
      { property: "og:description", content: "No maps. No scrolling. No AI. Just go." },
    ],
  }),
  component: Go,
});

function Go() {
  return (
    <main className="flex min-h-screen flex-col justify-between px-6 py-10 md:px-16 md:py-14">
      <p className="label fade-slow">Physical CAPTCHA</p>
      <div>
        <h1 className="display rise text-[9rem] leading-none md:text-[16rem]">
          GO<span className="text-primary">.</span>
        </h1>
        <p className="rise-3 mt-6 text-xl">Your challenge is waiting outside.</p>
        <p className="rise-4 mt-2 text-sm text-muted-foreground">
          No maps. No scrolling. No AI. Just go.
        </p>
      </div>
      <Link to="/return" className="btn fade-slow self-start [animation-delay:1.5s]">
        I’m back
      </Link>
    </main>
  );
}
