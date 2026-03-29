import { ConnectionSecretPrompt } from "./components/common/ConnectionSecretPrompt";
import { AppRouter } from "./routes/router";

export default function App() {
  return (
    <>
      <AppRouter />
      <ConnectionSecretPrompt />
    </>
  );
}
