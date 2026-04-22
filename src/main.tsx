import { createRoot } from "react-dom/client";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Elemento #root não encontrado.");
}

const missingEnvVars: string[] = [];
if (!import.meta.env.VITE_SUPABASE_URL) missingEnvVars.push("VITE_SUPABASE_URL");
if (!import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) missingEnvVars.push("VITE_SUPABASE_PUBLISHABLE_KEY");

const root = createRoot(rootElement);
const CHUNK_RELOAD_GUARD_KEY = "app:chunk-reload-once";

const isChunkLoadError = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
      ? error
      : "";

  const normalized = message.toLowerCase();
  return (
    normalized.includes("loading chunk") ||
    normalized.includes("failed to fetch dynamically imported module") ||
    normalized.includes("importing a module script failed")
  );
};

const reloadOnceForChunkError = () => {
  const alreadyReloaded = sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) === "1";
  if (alreadyReloaded) return false;
  sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, "1");
  window.location.reload();
  return true;
};

if (missingEnvVars.length > 0) {
  console.error("Missing required env vars:", missingEnvVars.join(", "));
  root.render(
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="mb-2 text-lg font-semibold">Serviço temporariamente indisponível</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Estamos realizando ajustes de configuração. Tente novamente em instantes.
        </p>
      </section>
    </main>,
  );
} else {
  window.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event.reason)) {
      const reloaded = reloadOnceForChunkError();
      if (reloaded) event.preventDefault();
    }
  });

  void import("./App.tsx")
    .then(({ default: App }) => {
      sessionStorage.removeItem(CHUNK_RELOAD_GUARD_KEY);
      root.render(<App />);
    })
    .catch((error) => {
      if (isChunkLoadError(error) && reloadOnceForChunkError()) {
        return;
      }

      root.render(
        <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
          <section className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-sm">
            <h1 className="mb-2 text-lg font-semibold">Falha ao iniciar a aplicação</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Não foi possível carregar os arquivos da página.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              Atualizar agora
            </button>
          </section>
        </main>,
      );
    });
}

