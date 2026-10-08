import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { OptionGroup, Page } from "@/components/site";
import { store } from "@/lib/captcha";

export const Route = createFileRoute("/return")({
  head: () => ({
    meta: [
      { title: "Welcome back — Physical CAPTCHA" },
      { name: "description", content: "Tell us what happened out there." },
      { property: "og:title", content: "Welcome back — Physical CAPTCHA" },
      { property: "og:description", content: "What did you notice?" },
    ],
  }),
  component: Return,
});

function Return() {
  const nav = useNavigate();
  const [text, setText] = useState("");
  const [completed, setCompleted] = useState("Yes");

  const finish = (save: boolean) => {
    store.setReflection(save ? { text, completed } : null);
    nav({ to: "/result" });
  };

  return (
    <Page narrow>
      <h1 className="display rise text-6xl md:text-8xl">Welcome back.</h1>
      <p className="rise-2 mt-4 text-lg text-muted-foreground">What happened?</p>
      <textarea
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="field rise-3 mt-10 text-xl leading-relaxed"
        placeholder="Tell us what you noticed, where you went, what surprised you…"
      />
      <div className="mt-8">
        <OptionGroup
          label="Did you complete it?"
          options={["Yes", "Partly", "Not really"]}
          value={completed}
          onChange={setCompleted}
        />
      </div>
      <div className="flex flex-col gap-6 border-t pt-10 md:flex-row md:items-center md:gap-10">
        <button onClick={() => finish(true)} className="btn justify-center">
          Reflect on this →
        </button>
        <button onClick={() => finish(false)} className="link-quiet text-sm">
          Skip reflection
        </button>
      </div>
    </Page>
  );
}
