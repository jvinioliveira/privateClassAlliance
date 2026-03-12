import { createRoot } from "react-dom/client";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Elemento #root nao encontrado.");
}

const missingEnvVars: string[] = [];
if (!import.meta.env.VITE_SUPABASE_URL) missingEnvVars.push("VITE_SUPABASE_URL");
if (!import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) missingEnvVars.push("VITE_SUPABASE_PUBLISHABLE_KEY");

const root = createRoot(rootElement);

if (missingEnvVars.length > 0) {
  root.render(
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="mb-2 text-lg font-semibold">Configuracao de producao incompleta</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          O app nao pode iniciar porque faltam variaveis no ambiente de deploy.
        </p>
        <p className="mt-4 text-sm">
          Defina em seu provedor (ex.: Vercel):{" "}
          <strong>{missingEnvVars.join(", ")}</strong>
        </p>
      </section>
    </main>,
  );
} else {
  void import("./App.tsx").then(({ default: App }) => {
    root.render(<App />);
  });
}
